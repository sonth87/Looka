import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateSessionDto {
  @ApiPropertyOptional({ description: 'Mã định danh người được chụp, nếu có' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subjectCode?: string;

  @ApiPropertyOptional({ description: 'Tên người được chụp, nếu có' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subjectName?: string;

  @ApiPropertyOptional({ description: 'Dữ liệu bổ sung tuỳ ý' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /**
   * This route stays behind `ApiKeyMiddleware`, not `SsoAuthGuard` (see
   * `SessionController`'s own doc comment), so there is no `req.user` to
   * read the operator from - the caller (apps/web, once it grows its own
   * SSO layer per §3.2.3) passes it explicitly instead.
   */
  @ApiPropertyOptional({
    description: 'Id người vận hành đã tạo phiên này, nếu có',
  })
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;

  /**
   * The campaign this WEB-path session belongs to, if any (2026-09-16) —
   * previously only ever populated for KIOSK sessions (see
   * `session.entity.ts`'s own `campaignId` doc comment), which left the
   * backend with no way to look up a web session's campaign (and thus its
   * `requiresEmbedding` setting) until now. `apps/web`'s `WebCampaignGate`/
   * `HttpCaptureSink.startSession` supply this once a campaign has been
   * selected; omitted for the legacy no-campaign path, same as
   * `operatorUserId` above.
   */
  @ApiPropertyOptional({
    description: 'Id campaign chứa phiên này, nếu có (phiên từ web)',
  })
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
