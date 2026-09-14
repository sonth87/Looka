import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import sharp from 'sharp';
import * as bwipjs from 'bwip-js';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import {
  SAMPLE_PREVIEW_DATA,
  type CardTemplateBarcodeSymbology,
  type CardTemplateFieldCode,
} from '../card-template.constants';
import { CardTemplateAsset } from '../entities/card-template-asset.entity';
import { CardTemplate } from '../entities/card-template.entity';
import type {
  CardTemplateSide,
  CardTemplateStaticTextElement,
  CardTemplateTextElement,
} from '../schema/card-template-layout.schema';

interface ResolvedPreviewData {
  fields: Record<CardTemplateFieldCode, string>;
  cardPhoto: Buffer;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

function formatDateValue(value: Date | string | null): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

/** CSS `format()` hint for a `@font-face src` — matches `ASSET_MIME_TYPES.FONT` in `card-template.constants.ts`; unrecognized types fall back to `truetype` (librsvg tolerates a wrong hint, it sniffs the actual bytes). */
function fontFormatFor(mimeType: string): string {
  if (mimeType.includes('woff2')) return 'woff2';
  if (mimeType.includes('woff')) return 'woff';
  if (mimeType.includes('otf') || mimeType.includes('opentype'))
    return 'opentype';
  return 'truetype';
}

/**
 * Server-side render engine (plan §2.6/D-Q13: "render ở server bằng sharp +
 * SVG, để kết quả in ở kiosk và in tập trung giống hệt nhau"). Builds one
 * SVG string per side (background + elements, sorted by `z`) with every
 * bitmap source (card photo, LOGO/BACKGROUND assets, barcode/QR) embedded
 * as a base64 `data:` `<image>` — no nested `<svg>` tricks — then rasterizes
 * it with `sharp` at the template's own `dpi`. `sharp`'s SVG backend is
 * `librsvg`, confirmed live (2026-09-14) to correctly render a base64
 * `@font-face` declared in a `<style>` block — see `loadFontFaces` below —
 * so a FONT asset uploaded via `CardTemplateAssetService` is embedded, not
 * merely stored: any TEXT/STATIC_TEXT element whose `font.family` matches
 * the asset's file name (without extension) picks it up automatically via
 * ordinary CSS font-family resolution, no schema change needed. A template
 * with no FONT assets renders exactly as before this — `font.family` just
 * resolves against whatever is installed on the render host, same as
 * always.
 */
@Injectable()
export class CardTemplateRenderService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CardTemplateAsset)
    private readonly assets: Repository<CardTemplateAsset>,
    private readonly fileStorage: FileStorageService,
  ) {}

  async render(
    template: CardTemplate,
    side: 'front' | 'back',
    input: { setId?: string; sampleData?: Record<string, string> },
  ): Promise<Buffer> {
    const layout = side === 'back' ? template.back : template.front;
    const { fields, cardPhoto } = await this.resolveData(input);

    const backgroundImage = layout.background.assetId
      ? await this.resolveAssetBuffer(layout.background.assetId)
      : null;

    const elementImages = new Map<string, Buffer | null>();
    for (const element of layout.elements) {
      if (element.type === 'PHOTO') {
        elementImages.set(element.id, cardPhoto);
      } else if (element.type === 'IMAGE') {
        elementImages.set(
          element.id,
          await this.resolveAssetBuffer(element.assetId),
        );
      } else if (element.type === 'BARCODE') {
        const text = fields[element.field] ?? '';

        elementImages.set(
          element.id,
          await this.renderBarcodeBuffer(element.symbology, text),
        );
      }
    }

    const fontFaces = await this.loadFontFaces(template.id);

    const svg = this.buildSvg(
      template,
      layout,
      fields,
      backgroundImage,
      elementImages,
      fontFaces,
    );
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * `@font-face` CSS for every FONT-kind asset on this template, keyed by
   * file name (without extension) — e.g. uploading `Roboto-Bold.ttf` makes
   * `font.family: "Roboto-Bold"` resolve to the embedded font on any TEXT/
   * STATIC_TEXT element. Assets that fail to resolve (deleted from
   * file-service, transient fetch failure) are silently skipped — same
   * "never fail the whole render over one missing asset" posture
   * `resolveAssetBuffer`'s own callers already have; that element's text
   * just falls back to the host's own font resolution for that name.
   */
  private async loadFontFaces(templateId: string): Promise<string> {
    const fontAssets = await this.assets.find({
      where: { templateId, kind: 'FONT' },
    });
    if (fontAssets.length === 0) return '';

    const rules = await Promise.all(
      fontAssets.map(async (asset) => {
        const buffer = await this.resolveAssetBuffer(asset.id);
        if (!buffer) return null;
        const family = asset.fileName.replace(/\.[^.]+$/, '');
        const format = fontFormatFor(asset.mimeType);
        return (
          `@font-face { font-family: ${JSON.stringify(family)}; ` +
          `src: url(data:${asset.mimeType};base64,${buffer.toString('base64')}) format(${JSON.stringify(format)}); }`
        );
      }),
    );
    return rules.filter((rule): rule is string => rule !== null).join('\n');
  }

  private async resolveData(input: {
    setId?: string;
    sampleData?: Record<string, string>;
  }): Promise<ResolvedPreviewData> {
    if (input.setId) {
      return this.resolveFromSet(input.setId);
    }
    return this.resolveFromSample(input.sampleData ?? {});
  }

  private async resolveFromSample(
    sampleData: Record<string, string>,
  ): Promise<ResolvedPreviewData> {
    const fields = { ...SAMPLE_PREVIEW_DATA, ...sampleData } as Record<
      CardTemplateFieldCode,
      string
    >;
    return { fields, cardPhoto: await this.placeholderPhoto() };
  }

  /**
   * Cross-module raw SQL against `subject_photo_sets`/`campaign_subjects`/
   * `campaigns`/`photo_variants`/`variant_upload_outbox` — same "no entity
   * import across module boundaries, plain SQL against table names"
   * convention `stats`/`campaign-snapshot.service.ts` already establishes.
   * `subject_photo_sets` already carries `class_name`/`major`/`faculty`/
   * `citizen_id` denormalized by P4; `date_of_birth`/`card_valid_until`
   * still only live on the roster row (`campaign_subjects`), so one LEFT
   * JOIN is still needed for those two fields.
   */
  private async resolveFromSet(setId: string): Promise<ResolvedPreviewData> {
    const rows: Array<{
      subject_name: string | null;
      subject_code: string;
      class_name: string | null;
      major: string | null;
      faculty: string | null;
      citizen_id: string | null;
      current_card_variant_id: string | null;
      date_of_birth: Date | string | null;
      card_valid_until: Date | string | null;
      cohort: string | null;
      campaign_code: string | null;
    }> = await this.dataSource.query(
      `
      SELECT
        sps.subject_name, sps.subject_code, sps.class_name, sps.major, sps.faculty, sps.citizen_id,
        sps.current_card_variant_id,
        cs.date_of_birth, cs.card_valid_until,
        c.cohort, c.code AS campaign_code
      FROM subject_photo_sets sps
      JOIN campaigns c ON c.id = sps.campaign_id
      LEFT JOIN campaign_subjects cs
        ON cs.campaign_id = sps.campaign_id AND cs.subject_code = sps.subject_code AND cs.status = 'VALID'
      WHERE sps.id = $1
      `,
      [setId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Không tìm thấy hồ sơ duyệt ảnh');
    }

    const fields: Record<CardTemplateFieldCode, string> = {
      fullName: row.subject_name ?? '',
      studentCode: row.subject_code ?? '',
      citizenId: row.citizen_id ?? '',
      className: row.class_name ?? '',
      faculty: row.faculty ?? '',
      major: row.major ?? '',
      dateOfBirth: formatDateValue(row.date_of_birth),
      cardValidUntil: formatDateValue(row.card_valid_until),
      cohort: row.cohort ?? '',
      campaignCode: row.campaign_code ?? '',
      cardPhoto: '',
      // No spec anywhere defines QR/barcode payload content for a card —
      // defaults to the student code, same value a CODE128 element would
      // typically encode anyway.
      qrPayload: row.subject_code ?? '',
    };

    const cardPhoto = row.current_card_variant_id
      ? await this.resolveCardPhoto(row.current_card_variant_id)
      : await this.placeholderPhoto();

    return { fields, cardPhoto };
  }

  /**
   * Mirrors `PhotoReviewService.resolveVariantViewSource`/
   * `readLocalVariantContent`'s own remote-then-local fallback, via raw SQL
   * instead of importing photo-review's service (module boundary). Never
   * throws — a photo that cannot be resolved just falls back to a
   * placeholder box, since this endpoint's whole job is producing SOME
   * preview PNG, not failing the request over a transient file-service hiccup.
   */
  private async resolveCardPhoto(variantId: string): Promise<Buffer> {
    const variantRows: Array<{
      fs_file_id: string | null;
      fs_status: string | null;
    }> = await this.dataSource.query(
      `SELECT fs_file_id, fs_status FROM photo_variants WHERE id = $1`,
      [variantId],
    );
    const variant = variantRows[0];
    if (
      variant?.fs_file_id &&
      variant.fs_status !== 'FAILED' &&
      variant.fs_status !== 'QUARANTINED'
    ) {
      try {
        const link = await this.fileStorage.issueViewLink(
          variant.fs_file_id,
          'card-template',
        );
        const response = await fetch(link.url);
        if (response.ok) {
          return Buffer.from(await response.arrayBuffer());
        }
      } catch {
        // fall through to local content / placeholder
      }
    }

    const localRows: Array<{ content: Buffer | null }> =
      await this.dataSource.query(
        `SELECT content FROM variant_upload_outbox
       WHERE variant_id = $1 AND content IS NOT NULL AND length(content) > 0
       ORDER BY created_at DESC LIMIT 1`,
        [variantId],
      );
    if (localRows[0]?.content) {
      return localRows[0].content;
    }
    return this.placeholderPhoto();
  }

  private async placeholderPhoto(): Promise<Buffer> {
    return sharp({
      create: {
        width: 240,
        height: 320,
        channels: 3,
        background: { r: 210, g: 210, b: 210 },
      },
    })
      .png()
      .toBuffer();
  }

  private async resolveAssetBuffer(assetId: string): Promise<Buffer | null> {
    const asset = await this.assets.findOne({ where: { id: assetId } });
    if (!asset) return null;
    try {
      const link = await this.fileStorage.issueViewLink(
        asset.fsFileId,
        'card-template',
      );
      const response = await fetch(link.url);
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  private async renderBarcodeBuffer(
    symbology: CardTemplateBarcodeSymbology,
    text: string,
  ): Promise<Buffer | null> {
    if (!text) return null;
    try {
      return await bwipjs.toBuffer({
        bcid: symbology === 'QRCODE' ? 'qrcode' : 'code128',
        text,
        scale: 3,
        includetext: false,
      });
    } catch {
      return null;
    }
  }

  private buildSvg(
    template: CardTemplate,
    layout: CardTemplateSide,
    fields: Record<CardTemplateFieldCode, string>,
    backgroundImage: Buffer | null,
    elementImages: Map<string, Buffer | null>,
    fontFaces: string,
  ): string {
    const w = template.cardWidthMm;
    const h = template.cardHeightMm;
    // The outer `width`/`height` are explicit PIXEL counts (no unit
    // suffix), computed from mm + dpi ourselves — letting the SVG carry
    // physical `mm` units there and asking sharp to rasterize at a given
    // `density` double-scales (librsvg resolves `mm` against a 96dpi CSS
    // baseline FIRST, then `density` scales that result again), confirmed
    // live: a CR80 template at 300dpi came back ~4200x2650px instead of
    // the expected ~1011x638. `viewBox` stays in mm so every element's
    // x/y/w/h (authored in mm) needs no rescaling.
    const widthPx = Math.round((w * template.dpi) / 25.4);
    const heightPx = Math.round((h * template.dpi) / 25.4);
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${w} ${h}">`,
    ];
    if (fontFaces) {
      parts.push(`<style>${fontFaces}</style>`);
    }

    if (backgroundImage) {
      parts.push(this.imageTag(backgroundImage, 0, 0, w, h));
    } else {
      parts.push(
        `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXmlAttr(layout.background.color)}"/>`,
      );
    }

    const sorted = [...layout.elements].sort((a, b) => a.z - b.z);
    for (const element of sorted) {
      if (element.type === 'TEXT' || element.type === 'STATIC_TEXT') {
        const rawText =
          element.type === 'STATIC_TEXT'
            ? element.text
            : (fields[element.field] ?? '');
        parts.push(this.textTag(element, rawText));
      } else {
        const image = elementImages.get(element.id);
        if (image) {
          parts.push(
            this.imageTag(image, element.x, element.y, element.w, element.h),
          );
        }
      }
    }

    parts.push('</svg>');
    return parts.join('');
  }

  private imageTag(
    buffer: Buffer,
    x: number,
    y: number,
    w: number,
    h: number,
  ): string {
    const base64 = buffer.toString('base64');
    return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${base64}"/>`;
  }

  /** BRD rule (§2.6): full names ≥ 13 chars shrink from 12pt to 10pt — generalized as `autoShrink.maxChars`/`minSize` on any TEXT element, not hardcoded to the name field specifically. */
  private textTag(
    element: CardTemplateTextElement | CardTemplateStaticTextElement,
    rawText: string,
  ): string {
    let text = rawText;
    let fontSize = element.font.size;
    if (
      element.type === 'TEXT' &&
      element.autoShrink &&
      text.length >= element.autoShrink.maxChars
    ) {
      fontSize = element.autoShrink.minSize;
    }
    if (element.type === 'TEXT' && element.uppercase) {
      text = text.toUpperCase();
    }

    const anchor =
      element.align === 'center'
        ? 'middle'
        : element.align === 'right'
          ? 'end'
          : 'start';
    const x =
      element.align === 'center'
        ? element.x + element.w / 2
        : element.align === 'right'
          ? element.x + element.w
          : element.x;
    const y = element.y + element.h / 2 + fontSize * 0.35;

    return (
      `<text x="${x}" y="${y}" font-family="${escapeXmlAttr(element.font.family)}" ` +
      `font-size="${fontSize}" font-weight="${element.font.weight ?? 400}" ` +
      `fill="${escapeXmlAttr(element.font.color)}" text-anchor="${anchor}">${escapeXmlText(text)}</text>`
    );
  }
}
