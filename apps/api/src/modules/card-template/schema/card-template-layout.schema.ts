import { z } from 'zod';
import {
  BARCODE_SYMBOLOGIES,
  CARD_TEMPLATE_FIELD_CODES,
} from '../card-template.constants';

/**
 * `front`/`back` jsonb shape — cms-8-screens-api-plan.md §2.6's exact
 * example (background + `elements[]`), validated with `zod` the same way
 * `workflow-config.schema.ts` validates `workflow_versions.config` (already
 * a dependency, no new package needed).
 *
 * `field` on TEXT/BARCODE elements is validated only against the catalog
 * of KNOWN field codes, not against which ones make semantic sense for
 * that element type (e.g. nothing stops a TEXT element referencing
 * `cardPhoto`) — same "loose schema, real check happens where the value is
 * actually consumed" choice `workflow-config.schema.ts` makes for
 * `capture.angles`. `CardTemplateRenderService` simply renders whatever
 * string `resolveFieldValues` produces for that field.
 */

const unitSchema = z.literal('mm');

const fontSchema = z.object({
  family: z.string().min(1),
  size: z.number().positive(),
  weight: z.number().int().optional(),
  color: z.string().min(1),
});

const baseElementSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  unit: unitSchema.default('mm'),
  z: z.number().int().default(1),
});

const photoElementSchema = baseElementSchema.extend({
  type: z.literal('PHOTO'),
  field: z.literal('cardPhoto'),
});

const textElementSchema = baseElementSchema.extend({
  type: z.literal('TEXT'),
  field: z.enum(CARD_TEMPLATE_FIELD_CODES),
  font: fontSchema,
  autoShrink: z
    .object({
      minSize: z.number().positive(),
      maxChars: z.number().int().positive(),
    })
    .optional(),
  align: z.enum(['left', 'center', 'right']).default('left'),
  uppercase: z.boolean().default(false),
});

const barcodeElementSchema = baseElementSchema.extend({
  type: z.literal('BARCODE'),
  field: z.enum(CARD_TEMPLATE_FIELD_CODES),
  symbology: z.enum(BARCODE_SYMBOLOGIES),
});

const imageElementSchema = baseElementSchema.extend({
  type: z.literal('IMAGE'),
  assetId: z.string().uuid(),
});

const staticTextElementSchema = baseElementSchema.extend({
  type: z.literal('STATIC_TEXT'),
  text: z.string(),
  font: fontSchema,
  align: z.enum(['left', 'center', 'right']).default('left'),
});

const elementSchema = z.discriminatedUnion('type', [
  photoElementSchema,
  textElementSchema,
  barcodeElementSchema,
  imageElementSchema,
  staticTextElementSchema,
]);

export const cardTemplateSideSchema = z.object({
  background: z.object({
    color: z.string().default('#FFFFFF'),
    assetId: z.string().uuid().nullable().default(null),
  }),
  elements: z.array(elementSchema).default([]),
});

export type CardTemplateSide = z.infer<typeof cardTemplateSideSchema>;
export type CardTemplateElement = z.infer<typeof elementSchema>;
export type CardTemplateTextElement = z.infer<typeof textElementSchema>;
export type CardTemplateBarcodeElement = z.infer<typeof barcodeElementSchema>;
export type CardTemplateImageElement = z.infer<typeof imageElementSchema>;
export type CardTemplatePhotoElement = z.infer<typeof photoElementSchema>;
export type CardTemplateStaticTextElement = z.infer<
  typeof staticTextElementSchema
>;

export const DEFAULT_CARD_TEMPLATE_SIDE: CardTemplateSide = {
  background: { color: '#FFFFFF', assetId: null },
  elements: [],
};

/** Throws a plain `Error` with a readable message on invalid input — callers (CardTemplateService) wrap it as a `BadRequestException`. */
export function validateCardTemplateSide(input: unknown): CardTemplateSide {
  const result = cardTemplateSideSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(message);
  }
  return result.data;
}
