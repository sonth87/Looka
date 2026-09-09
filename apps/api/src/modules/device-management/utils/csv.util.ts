/**
 * Minimal RFC4180-ish CSV parser for the campaign roster bulk import
 * (`CampaignStudentRosterService.importRoster`). This app has no CSV parsing
 * library as a dependency — `review.controller.ts`'s own `manifest.csv`
 * writer is the existing precedent for hand-rolling CSV here rather than
 * adding one — and a roster CSV an admin exports from Excel/Google Sheets or
 * pastes by hand never needs more than: comma-separated fields, optional
 * double-quote wrapping with `""` as the escaped quote, and `\r\n`/`\n` line
 * endings. Not a general-purpose parser (no custom delimiters, no streaming).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  // Strip a UTF-8 BOM (Excel prepends one) and normalize line endings.
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      pushField();
      continue;
    }
    if (ch === '\n') {
      pushRow();
      continue;
    }
    field += ch;
  }
  // Last field/row, if the text didn't end with a trailing newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop fully-blank lines (a trailing newline, or a blank line someone left
  // in the middle of a pasted CSV) rather than treating them as data rows.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** Lowercases, strips diacritics/punctuation/spaces — so "Mã SV", "ma_sv", and "studentCode" all normalize to a comparable token for header matching. */
export function normalizeHeaderCell(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}
