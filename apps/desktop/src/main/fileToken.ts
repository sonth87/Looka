/**
 * Sanitise a renderer-supplied string before it becomes part of a file name
 * (or of a value the local outbox stores in place of one).
 *
 * The renderer is untrusted input: a stepId of '../../../evil' would otherwise
 * place the written file outside the export directory. Every character
 * outside `[A-Za-z0-9_-]` becomes `_` and the result is cut to 40 characters;
 * an empty result falls back to `fallback`.
 *
 * Lives in its own module (not `index.ts`) so `uploads.ts` can apply the very
 * same transform when it maps a renderer-supplied stepId onto the
 * `upload_outbox.step_id` column `session:queueCapture` filled with it —
 * the two have to agree exactly or an approval looks up a step id the
 * outbox never stored.
 */
export function safeFileToken(raw: unknown, fallback: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}
