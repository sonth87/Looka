import { Module } from '@nestjs/common';
import { FileStorageService } from './services/file-storage.service';

@Module({
  providers: [FileStorageService],
  exports: [FileStorageService],
})
export class FileStorageModule {}
