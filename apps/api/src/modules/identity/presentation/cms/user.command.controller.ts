import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { ApiResponseDecorator } from '@app/shared/http/api-response.decorator';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from '../guards/require-permission.decorator';
import { CreateUserCommand } from '../../application/commands/command/create-user.command';
import { FindOrCreateUserByEmailCommand } from '../../application/commands/command/find-or-create-user-by-email.command';
import type { FindOrCreateUserByEmailResult } from '../../application/commands/handler/find-or-create-user-by-email.handler';
import { UpdateUserProfileCommand } from '../../application/commands/command/update-user-profile.command';
import { SetUserStatusCommand } from '../../application/commands/command/set-user-status.command';
import { SetUserAvatarCommand } from '../../application/commands/command/set-user-avatar.command';
import { SyncUsersCommand } from '../../application/commands/command/sync-users.command';
import { CreateUserDto } from '../../application/commands/transfer-model/create-user.dto';
import { FindOrCreateUserByEmailDto } from '../../application/commands/transfer-model/find-or-create-user-by-email.dto';
import { UpdateUserDto } from '../../application/commands/transfer-model/update-user.dto';
import { UserDirectorySyncStatus } from '../../application/user-directory-sync.service';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Multer's own runtime shape for `@UploadedFile()` — declared locally
 * rather than typed as `Express.Multer.File`, same reasoning
 * `review.controller.ts`'s own `UploadedMulterFile` already documents:
 * this app has no `@types/multer` installed (multer ships no `.d.ts` of
 * its own either), and `FileInterceptor` itself does not require multer's
 * types to compile — only this parameter annotation does.
 */
interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Controller({ path: 'users', version: '1' })
@ApiTags('identity')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('user:write', 'Quản lý người dùng')
@ApiBearerAuth('sso')
export class UserCommandController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly fileStorage: FileStorageService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Thêm người dùng bằng tay — phân quyền ngay hoặc để trống',
  })
  @ApiResponseDecorator(Object, { status: 201 })
  create(
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.commandBus.execute(
      new CreateUserCommand(
        dto.displayName,
        dto.email,
        dto.title,
        dto.code,
        dto.phone,
        dto.department,
        dto.faculty,
        dto.roleIds,
        req.user?.id ?? null,
      ),
    );
  }

  /**
   * "Gán người vào campaign theo email" (plan item 14, 2026-09-17) — CMS
   * calls this first to resolve an email to a `userId` (creating a MANUAL
   * placeholder if no account exists yet), then calls the existing
   * kiosk-assignment endpoint with that id. See
   * `FindOrCreateUserByEmailHandler`'s own doc comment for why this is a
   * second entry point into the same "MANUAL placeholder, merged by
   * `SsoAuthGuard` on first real login" mechanism `POST /v1/users` (above)
   * already established, not a new concept.
   */
  @Post('find-or-create-by-email')
  @ApiOperation({
    summary:
      'Tìm user theo email (không phân biệt hoa/thường), tạo placeholder MANUAL nếu chưa có',
  })
  @ApiResponseDecorator(Object, { status: 200 })
  findOrCreateByEmail(
    @Body() dto: FindOrCreateUserByEmailDto,
    @Req() req: Request,
  ): Promise<FindOrCreateUserByEmailResult> {
    return this.commandBus.execute(
      new FindOrCreateUserByEmailCommand(
        dto.email,
        dto.displayName,
        req.user?.id ?? null,
      ),
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa hồ sơ người dùng (tên, chức danh, mã, SĐT)' })
  @ApiResponseDecorator(Object)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<{ id: string }> {
    return this.commandBus.execute(
      new UpdateUserProfileCommand(
        id,
        dto.displayName,
        dto.title,
        dto.code,
        dto.phone,
        dto.department,
        dto.faculty,
      ),
    );
  }

  @Post(':id/disable')
  @ApiOperation({ summary: 'Vô hiệu hóa tài khoản' })
  @ApiResponseDecorator(Object)
  disable(@Param('id') id: string): Promise<{ id: string }> {
    return this.commandBus.execute(new SetUserStatusCommand(id, 'DISABLED'));
  }

  @Post(':id/enable')
  @ApiOperation({ summary: 'Kích hoạt lại tài khoản' })
  @ApiResponseDecorator(Object)
  enable(@Param('id') id: string): Promise<{ id: string }> {
    return this.commandBus.execute(new SetUserStatusCommand(id, 'ACTIVE'));
  }

  @Post(':id/avatar')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tải ảnh thẻ (avatar) — trường multipart tên "file"',
  })
  @ApiResponseDecorator(Object)
  async uploadAvatar(
    @Param('id') id: string,
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<{ id: string; avatarFsFileId: string }> {
    // Uploaded synchronously (not through the outbox+worker pattern the
    // capture pipeline uses for photos/videos) — an avatar image is small
    // and this is an interactive CMS action a person is waiting on, not an
    // unattended kiosk write that must survive a network blip on its own.
    const result = await this.fileStorage.uploadRaw({
      virtualPath: `users/${id}/avatar-${randomUUID()}.${extensionOf(file.mimetype)}`,
      mimeType: file.mimetype,
      data: new Uint8Array(file.buffer),
      idempotencyKey: randomUUID(),
      // 'public' not 'private': file-service's owner-based read ACL always
      // denies a private file here (Looka never sends X-Owner-User-Id —
      // pure API-key auth leaves owner_user_id null server-side), so a
      // private avatar would be permanently unreadable via issueViewLink.
      // Access control stays Looka's own @RequirePermission guards.
      visibility: 'public',
    });

    return this.commandBus.execute(new SetUserAvatarCommand(id, result.fileId));
  }

  @Post('sync')
  @ApiOperation({
    summary:
      'Đồng bộ danh bạ cán bộ từ hệ thống ngoài (D-Q10) — trả lỗi rõ ràng nếu USER_DIRECTORY_URL chưa cấu hình',
  })
  @ApiResponseDecorator(Object)
  sync(): Promise<UserDirectorySyncStatus> {
    return this.commandBus.execute(new SyncUsersCommand());
  }
}

function extensionOf(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}
