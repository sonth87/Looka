import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  decryptCitizenId,
  hashCitizenId,
} from '../../security/citizen-id.codec';

/**
 * Recomputes every `sessions.citizen_id_hash` using the new keyed
 * HMAC-SHA256 (`shared/security/citizen-id.codec.ts`), replacing the
 * original unkeyed `SHA-256` — 2026-09-16 database audit §2.2: a 12-digit
 * CCCD's real entropy is low enough that an unkeyed hash lets anyone with a
 * DB dump precompute every plausible value and reverse the column outright.
 *
 * Runs entirely through the shared codec functions (`decryptCitizenId` /
 * `hashCitizenId`), never a raw-SQL reimplementation of HMAC — this
 * migration is exactly the kind of one-off PII-touching data change where a
 * byte-for-byte mismatch between a SQL version and the real Node
 * implementation would silently produce hashes the application's own
 * `hashCitizenId(query)` could never match again. Sourced from
 * `citizen_id_enc` (decrypt, then rehash) rather than the plaintext
 * `metadata->>'identityNumber'` dual-write — this keeps working regardless
 * of whether that plaintext copy is ever removed later.
 *
 * `down()` cannot restore the original unkeyed hashes (the old algorithm is
 * being retired on purpose) — it intentionally re-derives the SAME keyed
 * hash again, which is a no-op rollback for this column. A true revert to
 * the old, weaker hash would require re-introducing the vulnerable
 * algorithm, which this migration exists specifically to stop doing.
 */
export class RehashCitizenIdWithHmac1826000000000 implements MigrationInterface {
  name = 'RehashCitizenIdWithHmac1826000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT id, citizen_id_enc FROM sessions WHERE citizen_id_enc IS NOT NULL`,
    )) as Array<{ id: string; citizen_id_enc: string }>;

    for (const row of rows) {
      const plain = decryptCitizenId(row.citizen_id_enc);
      const newHash = hashCitizenId(plain);
      await queryRunner.query(
        `UPDATE sessions SET citizen_id_hash = $1 WHERE id = $2`,
        [newHash, row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.up(queryRunner);
  }
}
