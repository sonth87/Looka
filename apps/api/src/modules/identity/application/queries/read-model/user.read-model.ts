import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserReadModel {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true }) ssoUserCode: string | null;
  @ApiProperty() email: string;
  @ApiPropertyOptional({ nullable: true }) displayName: string | null;
  @ApiPropertyOptional({ nullable: true }) title: string | null;
  @ApiPropertyOptional({ nullable: true }) code: string | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarFsFileId: string | null;
  @ApiProperty() isAdmin: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ enum: ['SSO', 'MANUAL', 'SYNC'] }) source:
    'SSO' | 'MANUAL' | 'SYNC';
  @ApiProperty({ type: [String] }) roleCodes: string[];
  @ApiPropertyOptional({ nullable: true }) lastLoginAt: Date | null;
  @ApiProperty() createdAt: Date;
}
