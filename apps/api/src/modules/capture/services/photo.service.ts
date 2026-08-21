import { CustomException, ERROR_CODE } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import { CommonService } from '@app/modules/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTO_BYTES,
} from '../capture.constants';
import { PhotoDao } from '../dao';
import { AddPhotoDto } from '../dto';
import { Photo } from '../entities/photo.entity';
import { SessionService } from './session.service';

const DATA_URL_PATTERN = /^data:(image\/[a-z+]+);base64,(.+)$/i;

@Injectable()
export class PhotoService extends CommonService<Photo> {
  constructor(
    @InjectRepository(Photo)
    repository: Repository<Photo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly sessionService: SessionService,
  ) {
    super(repository);
  }

  /**
   * Record a capture and queue it for the file-service.
   *
   * The photo row and its outbox entry are written together, in one
   * transaction. Accepting bytes, telling the client they are saved, and then
   * failing to record the intent to upload them is the one outcome worth
   * engineering against - the browser has already discarded its copy by then.
   */
  async addPhoto(
    sessionId: string,
    dto: AddPhotoDto,
  ): Promise<{ photoId: string }> {
    await this.sessionService.findByIdOrFail(sessionId);

    const match = DATA_URL_PATTERN.exec(dto.dataUrl);
    if (!match) {
      throw new CustomException(
        'Expected dataUrl to be a base64 image data URL',
        ERROR_CODE.PHOTO_INVALID_DATA_URL,
        HttpStatus.BAD_REQUEST,
      );
    }

    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(mimeType)) {
      throw new CustomException(
        `Unsupported image type "${mimeType}"`,
        ERROR_CODE.PHOTO_UNSUPPORTED_MIME_TYPE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const data = Buffer.from(match[2], 'base64');
    if (data.byteLength === 0) {
      throw new CustomException(
        'Image payload decoded to zero bytes',
        ERROR_CODE.PHOTO_INVALID_DATA_URL,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (data.byteLength > MAX_PHOTO_BYTES) {
      throw new CustomException(
        `Image is ${data.byteLength} bytes, above the ${MAX_PHOTO_BYTES} limit`,
        ERROR_CODE.PHOTO_TOO_LARGE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const sha256 = createHash('sha256').update(data).digest('hex');
    // Deterministic, so every retry of this exact capture carries the same
    // key and the file-service recognises a repeat instead of storing a
    // second file (see the integration guide, section 4.5).
    const idemKey = `${sessionId}:${dto.stepId}:${dto.attempt}`;
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const virtualPath = `sessions/${sessionId}/${dto.stepId}-${dto.attempt}.${ext}`;

    const photoId = await this.dataSource.transaction(async (manager) => {
      // Raw SQL here rather than `Repository.upsert()`: TypeORM's upsert
      // rewrites every property present on the entity-like on conflict, and
      // this needs to touch ONLY mime_type on a resend - overwriting
      // `fs_file_id`/`fs_status` on a legitimate retry would erase progress a
      // background upload may have already made between the original insert
      // and the retry.
      const rows: Array<{ id: string }> = await manager.query(
        // Column-list form, not `ON CONFLICT ON CONSTRAINT`: the unique index
        // below is a plain `CREATE UNIQUE INDEX` (via the entity's `@Index`),
        // which Postgres does not register in `pg_constraint` - naming it in
        // `ON CONFLICT ON CONSTRAINT` fails at runtime ("constraint ... does
        // not exist"). The column-list form resolves against any applicable
        // unique index regardless of how it was created.
        `INSERT INTO photos (session_id, step_id, attempt, mime_type, bytes, sha256, virtual_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, step_id, attempt) DO UPDATE
           SET mime_type = EXCLUDED.mime_type
         RETURNING id`,
        [
          sessionId,
          dto.stepId,
          dto.attempt,
          mimeType,
          data.byteLength,
          sha256,
          virtualPath,
        ],
      );
      const id = rows[0].id;

      await manager.query(
        `INSERT INTO upload_outbox (photo_id, idem_key, virtual_path, mime_type, content)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idem_key) DO NOTHING`,
        [id, idemKey, virtualPath, mimeType, data],
      );

      return id;
    });

    return { photoId };
  }

  async listBySession(sessionId: string): Promise<PhotoDao[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        step_id: string;
        attempt: number;
        bytes: number;
        mime_type: string;
        created_at: Date;
        fs_file_id: string | null;
        fs_status: string | null;
        upload_status: string;
      }>
    >(
      `SELECT p.id,
              p.step_id,
              p.attempt,
              p.bytes,
              p.mime_type,
              p.created_at,
              p.fs_file_id,
              p.fs_status,
              COALESCE(o.status, 'UPLOADED') AS upload_status
         FROM photos p
         LEFT JOIN upload_outbox o ON o.photo_id = p.id
        WHERE p.session_id = $1
        ORDER BY p.created_at`,
      [sessionId],
    );

    return toDao(
      PhotoDao,
      rows.map((r) => ({
        id: r.id,
        stepId: r.step_id,
        attempt: r.attempt,
        bytes: r.bytes,
        mimeType: r.mime_type,
        capturedAt: r.created_at,
        fsFileId: r.fs_file_id ?? undefined,
        fsStatus: r.fs_status ?? undefined,
        uploadStatus: r.upload_status,
      })),
    );
  }

  async findFsFileIdOrFail(photoId: string): Promise<string> {
    const photo = await this.findById(photoId);
    if (!photo) {
      throw new CustomException(
        'Photo not found',
        ERROR_CODE.PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    if (!photo.fsFileId) {
      throw new CustomException(
        'This photo has not reached the file-service yet',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return photo.fsFileId;
  }
}
