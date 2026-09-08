import { ApiKeyOrSsoGuard, SsoAuthGuard } from '@app/common/guards';
import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoController } from './controllers/photo.controller';
import { SessionController } from './controllers/session.controller';
import { StudentController } from './controllers/student.controller';
import { VideoController } from './controllers/video.controller';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { SessionVideo } from './entities/session-video.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { CaptureReportService } from './services/capture-report.service';
import { PhotoService } from './services/photo.service';
import { SessionService } from './services/session.service';
import { SessionVideoService } from './services/session-video.service';
import { StudentService } from './services/student.service';
import { UploadWorkerService } from './services/upload-worker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, Photo, SessionVideo, UploadOutboxEntry]),
    FileStorageModule,
  ],
  controllers: [SessionController, PhotoController, VideoController, StudentController],
  providers: [
    SessionService,
    PhotoService,
    SessionVideoService,
    StudentService,
    UploadWorkerService,
    CaptureReportService,
    // Guards `@UseGuards()` on SessionController's two CMS-facing GET routes,
    // and PhotoController's/VideoController's view-link routes - see those
    // controllers' own doc comments.
    SsoAuthGuard,
    // Guards StudentController only - see that controller's own doc comment
    // for why it needs a different guard than the three above.
    ApiKeyOrSsoGuard,
  ],
  exports: [SessionService, PhotoService, CaptureReportService],
})
export class CaptureModule {}
