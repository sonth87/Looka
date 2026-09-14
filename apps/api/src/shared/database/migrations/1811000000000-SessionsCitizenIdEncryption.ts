import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * cms-8-screens-api-plan.md §8 I-Q1, decided 2026-09-11: the CCCD number
 * currently lives in plaintext inside `sessions.metadata->>'identityNumber'`
 * (a free-form jsonb blob a web/desktop client sends at
 * `POST /v1/sessions`, see `SessionService.createSession`) and is
 * ILIKE-searchable via `GET /v1/students?q=`. Nghị định 13/2023 treats a
 * citizen id as personal data; the original `DESIGN-photo-station.md`
 * §1.5 design only ever stored a salted hash + last 4 digits, never the
 * plaintext.
 *
 * Three new, NULLABLE columns — additive only, per plan §9.1 rule 1:
 * - `citizen_id_enc`: AES-256-GCM ciphertext (base64: iv + ciphertext +
 *   authTag), decryptable only with `CITIZEN_ID_ENCRYPTION_KEY`
 *   (`shared/security/citizen-id.codec.ts`).
 * - `citizen_id_hash`: sha256 hex of the normalized (digits-only) CCCD —
 *   deterministic, so an exact-match lookup never has to decrypt anything.
 * - `citizen_id_last4`: last 4 digits, for display without decrypting.
 *
 * `sessions.metadata->>'identityNumber'` is left untouched this pass (same
 * backward-compat rule) — `SessionService.createSession` now DUAL-WRITES
 * both the legacy plaintext field and these three, so existing readers
 * (`student.service.ts`'s ILIKE search, `photo-review.service.ts`'s
 * `identityNumber` for file-path building) see no behaviour change.
 * Scrubbing the plaintext, and switching the file-path key from CCCD to
 * student code (plan D-Q16), are follow-up work once callers migrate.
 */
export class SessionsCitizenIdEncryption1811000000000 implements MigrationInterface {
  name = 'SessionsCitizenIdEncryption1811000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD COLUMN "citizen_id_enc" text,
        ADD COLUMN "citizen_id_hash" character varying(64),
        ADD COLUMN "citizen_id_last4" character varying(4)
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sessions_citizen_id_hash" ON "sessions" ("citizen_id_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sessions_citizen_id_hash"`);
    await queryRunner.query(`
      ALTER TABLE "sessions"
        DROP COLUMN "citizen_id_last4",
        DROP COLUMN "citizen_id_hash",
        DROP COLUMN "citizen_id_enc"
    `);
  }
}
