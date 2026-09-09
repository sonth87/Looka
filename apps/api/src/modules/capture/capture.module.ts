import { ApiKeyOrSsoGuard, SsoAuthGuard } from '@app/common/guards';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { PhotoReviewModule } from '@app/modules/photo-review/photo-review.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoContentController } from './controllers/photo-content.controller';
import { PhotoController } from './controllers/photo.controller';
import { SessionController } from './controllers/session.controller';
import { StudentController } from './controllers/student.controller';
import { VideoContentController } from './controllers/video-content.controller';
import { VideoController } from './controllers/video.controller';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { SessionVideo } from './entities/session-video.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { VideoUploadOutboxEntry } from './entities/video-upload-outbox.entity';
import { CaptureReportService } from './services/capture-report.service';
import { PhotoService } from './services/photo.service';
import { SessionService } from './services/session.service';
import { SessionVideoService } from './services/session-video.service';
import { StudentService } from './services/student.service';
import { UploadWorkerService } from './services/upload-worker.service';
import { VideoUploadWorkerService } from './services/video-upload-worker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Session,
      Photo,
      SessionVideo,
      UploadOutboxEntry,
      VideoUploadOutboxEntry,
    ]),
    FileStorageModule,
    // For SessionService.completeSession()'s best-effort
    // PhotoReviewService.ensureSetForApprovedSession() call (the web-path
    // half of the photo-review "hồ sơ ảnh" auto-creation hook — see that
    // service's own doc comment; the kiosk-path half is wired in
    // DeviceEventService instead, since that's where SESSION_REPORT lands).
    PhotoReviewModule,
  ],
  controllers: [
    SessionController,
    PhotoController,
    PhotoContentController,
    VideoController,
    VideoContentController,
    StudentController,
  ],
  providers: [
    SessionService,
    PhotoService,
    SessionVideoService,
    StudentService,
    UploadWorkerService,
    VideoUploadWorkerService,
    CaptureReportService,
    // Guards `@UseGuards()` on SessionController's two CMS-facing GET routes,
    // and PhotoController's/VideoController's view-link routes - see those
    // controllers' own doc comments.
    SsoAuthGuard,
    // Guards StudentController only - see that controller's own doc comment
    // for why it needs a different guard than the three above.
    ApiKeyOrSsoGuard,
  ],
  // SessionVideoService exported alongside PhotoService (2026-09-09) so
  // DeviceManagementModule's DeviceSelfController can push a video the exact
  // same way it already pushes a photo — see DeviceSelfController.pushVideo.
  exports: [SessionService, PhotoService, SessionVideoService, CaptureReportService],
})
export class CaptureModule {}
