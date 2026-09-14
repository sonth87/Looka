import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCardTemplateDto } from './create-card-template.dto';

/** `PATCH /v1/card-templates/:id` — `code` is immutable once created (no rename-of-identity route exists elsewhere in this codebase either, e.g. `workflows.code`). */
export class UpdateCardTemplateDto extends PartialType(
  OmitType(CreateCardTemplateDto, ['code'] as const),
) {}
