import { createCanvas } from '@napi-rs/canvas';

/**
 * Renders a printed-looking numeric string onto a PNG buffer, for
 * `test/ocr.test.ts` — this is the "programmatically draw digits onto a
 * canvas/PNG at build/test time" fixture the product brief asks for, so the
 * real OCR-to-regex-extraction pipeline (`recognizeCccdFrame` in
 * src/renderer/ocr.ts) can be exercised against an actual rendered image
 * without any camera or physical card involved.
 *
 * Uses @napi-rs/canvas (prebuilt native binary, "0 system dependencies")
 * rather than the classic `canvas` package specifically because it needs no
 * separate Cairo/Pango system install to render text reliably in a plain
 * Node test process on a Windows dev machine.
 */
export function renderDigitsFixture(digits: string, options: { width?: number; height?: number } = {}): Buffer {
  const width = options.width ?? 900;
  const height = options.height ?? 220;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // White background, high-contrast black text — mirrors the clean,
  // machine-printed look of the "Số / No." field on a real CCCD card, which
  // is what makes that field comparatively OCR-friendly (see ocr.ts's own
  // doc comment).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 96px "Arial", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Explicit letter-spacing-like layout: draw digit-by-digit with a small
  // gap so glyphs never touch, which is what a real printed ID number looks
  // like and what Tesseract's segmentation expects.
  const glyphWidth = width / (digits.length + 1);
  for (let i = 0; i < digits.length; i++) {
    const x = glyphWidth * (i + 1);
    ctx.fillText(digits[i], x, height / 2);
  }

  return canvas.toBuffer('image/png');
}
