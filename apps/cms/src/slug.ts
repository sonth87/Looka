/**
 * Derives a `Mã` (code) from a human-entered name — shared by every "Mã tự
 * sinh" form (`PhotoKindsPage.tsx`, `WorkflowsPage.tsx`, `CampaignForm.tsx`,
 * 2026-09-22 product ask: stop asking admins to type a code by hand).
 * Strips Vietnamese diacritics (including `đ`, which `normalize('NFD')`
 * alone doesn't decompose), uppercases, collapses anything non-alphanumeric
 * into `_`. `maxLength` matches whichever backend DTO's `@MaxLength(...)`
 * the caller is feeding.
 */
export function slugifyCode(text: string, maxLength = 100): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
}
