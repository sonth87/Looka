import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPrintItemsQueryDto } from './list-print-items-query.dto';

/**
 * `status` accepts one value or a comma-separated list (2026-09-30 — lets the
 * CMS offer ONE merged "Chưa in" filter for PENDING + RENDERED in a
 * CENTRALIZED batch instead of two identically-labelled options).
 */
const parse = (status?: string) =>
  plainToInstance(
    ListPrintItemsQueryDto,
    status === undefined ? {} : { status },
  );

describe('ListPrintItemsQueryDto.status', () => {
  it('a single status still works (parsed to a one-element array)', async () => {
    const dto = parse('PRINTED');
    expect(dto.status).toEqual(['PRINTED']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('a comma-separated list is split and trimmed', async () => {
    const dto = parse('PENDING, RENDERED');
    expect(dto.status).toEqual(['PENDING', 'RENDERED']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('omitted status stays undefined (no filter)', async () => {
    const dto = parse(undefined);
    expect(dto.status).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('an unknown value anywhere in the list is rejected', async () => {
    const errors = await validate(parse('PENDING,BOGUS'));
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('empty segments are ignored, not treated as a bad status', async () => {
    const dto = parse('PENDING,,');
    expect(dto.status).toEqual(['PENDING']);
    expect(await validate(dto)).toHaveLength(0);
  });
});
