import 'reflect-metadata';
import { Controller, Get, Post } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { RequirePermission } from '../presentation/guards/require-permission.decorator';
import { PermissionCatalogReadRepository } from '../infrastructure/read/permission-catalog.read-repository';
import { PermissionCatalogService } from './permission-catalog.service';

/**
 * Real Nest decorators (`@Controller`/`@Get`/`@RequirePermission`) attach
 * `reflect-metadata` straight onto the class/prototype regardless of
 * whether it ever goes through Nest's DI container — so faking only
 * `DiscoveryService.getControllers()` (the one piece that genuinely needs a
 * running application) is enough to exercise `discoverPermissions()` for
 * real, without booting a `Test.createTestingModule()`.
 */
@Controller('widgets')
class FakeWidgetController {
  @Get()
  @RequirePermission('widget:read')
  list(): void {}

  @Post()
  @RequirePermission('widget:write', 'Tạo widget')
  create(): void {}
}

function discoveryReturning(instance: object): DiscoveryService {
  return {
    getControllers: () => [
      { instance, metatype: instance.constructor as new () => unknown },
    ],
  } as unknown as DiscoveryService;
}

function fakeRepo(): PermissionCatalogReadRepository {
  return {
    upsertMany: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermissionCatalogReadRepository;
}

describe('PermissionCatalogService', () => {
  it('records the real HTTP method for each discovered @RequirePermission route, not a hard-coded null', async () => {
    const repo = fakeRepo();
    const service = new PermissionCatalogService(
      discoveryReturning(new FakeWidgetController()),
      new MetadataScanner(),
      repo,
    );

    await service.onApplicationBootstrap();

    const calls = (repo.upsertMany as jest.Mock).mock.calls as [
      Array<{ code: string; method: string | null; path: string | null }>,
    ][];
    const byCode = new Map(calls[0][0].map((d) => [d.code, d]));

    expect(byCode.get('widget:read')?.method).toBe('GET');
    expect(byCode.get('widget:write')?.method).toBe('POST');
  });
});
