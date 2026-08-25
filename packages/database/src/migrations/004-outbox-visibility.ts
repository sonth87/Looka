import type { Migration } from './index.js';

/**
 * Visibility for the file-service upload, decided at capture time.
 *
 * Deliberately not defaulted in this table: 'private' is what every capture
 * enqueued today should carry, but that is a decision for whoever calls
 * `queueCapture()` (it knows whether this is a card photo, a face image, or
 * something else) — not a default this migration should bake in, which would
 * make a future non-biometric use of the same queue silently private too.
 * NULL simply means "let the file-service apply its own default."
 */
export const MIGRATION_004_OUTBOX_VISIBILITY: Migration = {
  version: 4,
  name: 'outbox-visibility',
  up: [
    `ALTER TABLE upload_outbox ADD COLUMN visibility TEXT
       CHECK (visibility IS NULL OR visibility IN ('public','private'))`,
  ],
};
