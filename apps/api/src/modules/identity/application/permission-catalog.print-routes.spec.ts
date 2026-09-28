import 'reflect-metadata';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PrintBatchController } from '@app/modules/print/controllers/print-batch.controller';
import { PrintItemController } from '@app/modules/print/controllers/print-item.controller';
import { PrintResultImportController } from '@app/modules/print/controllers/print-result-import.controller';
import { PrinterController } from '@app/modules/print/controllers/printer.controller';
import { PrinterAgentController } from '@app/modules/print/controllers/printer-agent.controller';
import { PrintAgentController } from '@app/modules/print/controllers/print-agent.controller';
import { PermissionCatalogReadRepository } from '../infrastructure/read/permission-catalog.read-repository';
import { PermissionCatalogService } from './permission-catalog.service';

/**
 * Real print-module controller classes fed through the REAL
 * `PermissionCatalogService.discoverPermissions()` walk (same technique
 * `permission-catalog.service.spec.ts` uses with its own `FakeWidgetController`
 * — real Nest decorators attach `reflect-metadata` regardless of DI, so only
 * `DiscoveryService.getControllers()` needs faking). Constructor args are
 * dummies (`{} as any`) — discovery only ever reads prototype metadata, it
 * never calls a handler.
 *
 * Verifies the print RBAC task's area 1: every `@RequirePermission` on the
 * print controllers is discovered and none is silently missing from the
 * catalog `GET /v1/permissions` (and the CMS role editor) would show.
 */
function discoveryReturning(instances: object[]): DiscoveryService {
  return {
    getControllers: () =>
      instances.map((instance) => ({
        instance,
        metatype: instance.constructor as new () => unknown,
      })),
  } as unknown as DiscoveryService;
}

function fakeRepo(): {
  repo: PermissionCatalogReadRepository;
  upsertMany: jest.Mock;
} {
  const upsertMany = jest.fn().mockResolvedValue(undefined);
  return {
    repo: { upsertMany } as unknown as PermissionCatalogReadRepository,
    upsertMany,
  };
}

// The exact Vietnamese descriptions the print controllers' own decorators
// declare for each code (several handlers can share one code with
// different labels — `PermissionCatalogService` keeps only ONE description
// per code, whichever handler the discovery walk visits last, which is an
// accepted implementation detail, not something this test pins down).
// Asserting membership in this set (rather than one exact string) keeps the
// test honest about that ambiguity while still proving the catalog entry
// came from a REAL decorator on a REAL print route, not a stray value.
const VALID_DESCRIPTIONS: Record<string, string[]> = {
  'print-batch:read': [
    'Xem danh sách đợt in',
    'Xem chi tiết đợt in',
    'Tải gói in tập trung',
    'Xem lịch sử upload kết quả in',
    'Xem chi tiết 1 lần upload kết quả in',
  ],
  'print-batch:write': [
    'Tạo đợt in',
    'Sửa đợt in',
    'Thêm item vào đợt in',
    'Gỡ item khỏi đợt in',
    'Gỡ nhiều item khỏi đợt in',
    'Nạp tự động ảnh đã duyệt vào đợt in',
    'Render toàn bộ đợt in',
    'Gửi in đợt in',
    'Xuất gói in tập trung',
    'Hoàn tất đợt in',
    'Hủy đợt in',
    'Upload kết quả in',
  ],
  'print-item:read': [
    'Xem danh sách item in',
    'Xem thống kê gom nhóm item in',
    'Xem chi tiết item in',
    'Xem thử ảnh item in',
  ],
  'print-item:write': [
    'Sửa item in',
    'Render lại mặt trước/sau item in',
    'Tạo bản in lại cho item',
    'Tạo hàng loạt item in từ hồ sơ đã duyệt',
    'Áp phôi in hàng loạt',
  ],
  'printer:read': [
    'Xem danh sách máy in',
    'Xem chi tiết máy in',
    'Xem lịch sử phôi máy in',
  ],
  'printer:write': [
    'Tạo máy in',
    'Sửa máy in',
    'Cập nhật phôi máy in',
    'Vô hiệu hóa máy in',
    'Kích hoạt lại máy in',
    'In thử',
    'Cấp/đổi token agent cho máy in',
  ],
};

describe('PermissionCatalogService — print module routes', () => {
  it('discovers every print-batch/print-item/printer @RequirePermission code, with a real Vietnamese label from the actual decorator', async () => {
    const { repo, upsertMany } = fakeRepo();
    const service = new PermissionCatalogService(
      discoveryReturning([
        new (
          PrintBatchController as unknown as new (...a: unknown[]) => object
        )({}),
        new (PrintItemController as unknown as new (...a: unknown[]) => object)(
          {},
        ),
        new (PrinterController as unknown as new (...a: unknown[]) => object)(
          {},
        ),
        new (
          PrintResultImportController as unknown as new (
            ...a: unknown[]
          ) => object
        )({}),
      ]),
      new MetadataScanner(),
      repo,
    );

    await service.onApplicationBootstrap();

    expect(upsertMany).toHaveBeenCalledTimes(1);
    // Cast `.mock.calls` itself to a typed tuple array (same convention
    // `permission-catalog.service.spec.ts`'s own test already uses) rather
    // than casting the doubly-indexed `.mock.calls[0][0]` expression — the
    // latter still trips `no-unsafe-member-access` on the untyped
    // intermediate indexing, even though the FINAL value ends up cast.
    const calls = upsertMany.mock.calls as [
      Array<{
        code: string;
        group: string;
        method: string | null;
        description: string | null;
      }>,
    ][];
    const discovered = calls[0][0];
    const byCode = new Map(discovered.map((d) => [d.code, d]));

    const expectedCodes = Object.keys(VALID_DESCRIPTIONS);
    for (const code of expectedCodes) {
      const entry = byCode.get(code);
      expect(entry).toBeDefined();
      expect(entry!.group).toBe(code.split(':')[0]);
      expect(entry!.description).not.toBeNull();
      expect(VALID_DESCRIPTIONS[code]).toContain(entry!.description);
    }

    // No decorator silently missing: the print controllers declare exactly
    // these 6 codes and no others (printer-agent/print-agent controllers —
    // checked separately below — deliberately have none).
    const printCodes = [...byCode.keys()].filter(
      (c) =>
        c.startsWith('print-batch:') ||
        c.startsWith('print-item:') ||
        c.startsWith('printer:'),
    );
    expect(new Set(printCodes)).toEqual(new Set(expectedCodes));
  });

  it('the printer-agent/print-agent controllers declare NO @RequirePermission at all (agent-token auth only, see area 4)', () => {
    const { repo, upsertMany } = fakeRepo();
    const service = new PermissionCatalogService(
      discoveryReturning([
        new (
          PrinterAgentController as unknown as new (...a: unknown[]) => object
        )({}),
        new (
          PrintAgentController as unknown as new (...a: unknown[]) => object
        )({}),
      ]),
      new MetadataScanner(),
      repo,
    );

    // Calling the private discovery walk indirectly via bootstrap: with
    // zero decorators found, the service logs a warning and returns without
    // ever calling `upsertMany` — same early-return path
    // `onApplicationBootstrap()`'s own top already documents.
    return service.onApplicationBootstrap().then(() => {
      expect(upsertMany).not.toHaveBeenCalled();
    });
  });
});
