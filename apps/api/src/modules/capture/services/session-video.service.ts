import { CustomException, ERROR_CODE } from '@app/common/errors';
import { CommonService } from '@app/modules/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionSource } from '../capture.constants';
import { SessionVideo } from '../entities/session-video.entity';
import { SessionService } from './session.service';

/**
 * Mirrors `PhotoService`'s view-link support (`resolveViewContext`) for
 * videos — see that method's own doc comment for the tenant-name reasoning,
 * identical here since a video lives on the same per-device tenant its
 * session's photos do.
 */
@Injectable()
export class SessionVideoService extends CommonService<SessionVideo> {
  constructor(
    @InjectRepository(SessionVideo)
    repository: Repository<SessionVideo>,
    private readonly sessionService: SessionService,
  ) {
    super(repository);
  }

  async resolveViewContext(
    videoId: string,
  ): Promise<{ fsFileId: string; tenantName?: string }> {
    const video = await this.findById(videoId);
    if (!video) {
      throw new CustomException(
        'Video not found',
        ERROR_CODE.VIDEO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    if (!video.fsFileId) {
      throw new CustomException(
        'This video has not reached the file-service yet',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const session = await this.sessionService.findById(video.sessionId);
    const tenantName =
      session?.source === SessionSource.KIOSK && session.deviceId
        ? session.deviceId
        : undefined;

    return { fsFileId: video.fsFileId, tenantName };
  }
}
