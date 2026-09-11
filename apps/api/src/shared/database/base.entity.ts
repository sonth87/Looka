import { ApiProperty } from '@nestjs/swagger';
import {
  CreateDateColumn,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export abstract class BaseEntity {
  @ApiProperty({
    description: 'Unique identifier',
    example: 'f0b0c8c0-0b0c-4c0d-8c0e-0b0c8c0d8c0e',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    description: 'Date of creation',
    example: '2026-01-01T00:00:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  createdAt: Date;

  @ApiProperty({
    description: 'Date of last update',
    example: '2026-01-01T00:00:00.000Z',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
