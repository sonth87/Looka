import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhotoController } from './controllers/photo.controller';
import { SessionController } from './controllers/session.controller';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { PhotoService } from './services/photo.service';
import { SessionService } from './services/session.service';
import { UploadWorkerService } from './services/upload-worker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, Photo, UploadOutboxEntry]),
    FileStorageModule,
  ],
  controllers: [SessionController, PhotoController],
  providers: [SessionService, PhotoService, UploadWorkerService],
  exports: [SessionService, PhotoService],
})
export class CaptureModule {}
