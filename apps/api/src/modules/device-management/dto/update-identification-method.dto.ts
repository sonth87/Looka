import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateIdentificationMethodDto } from './create-identification-method.dto';

/** `code` is immutable once created — `sessions.identification_method` already stores it as free text, renaming the catalog row out from under existing sessions would silently relabel their history. */
export class UpdateIdentificationMethodDto extends PartialType(
  OmitType(CreateIdentificationMethodDto, ['code'] as const),
) {}
