import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import {
  DiscoveredPermission,
  PermissionCatalogReadRepository,
} from '../infrastructure/read/permission-catalog.read-repository';
import { REQUIRE_PERMISSION_METADATA } from '../presentation/guards/require-permission.decorator';

type PermissionMeta = { code: string; description?: string };

/**
 * At boot, walks every controller looking for `@RequirePermission(code)`
 * and upserts one `permissions` row per code found — the auto-generated
 * catalog cms-8-screens-api-plan.md §1.1 E1/E4 calls for ("danh sách các
 * quyền được truy cập vào các đầu API" stays in sync with the code, never
 * hand-maintained).
 *
 * Checks BOTH class-level and method-level metadata via raw
 * `Reflect.getMetadata` (not `Reflector.get()` — that method's overload
 * signature wants a `Function | Type<any>` target and its generic did not
 * infer cleanly against a union return type here), method taking
 * precedence when both are present — the same order
 * `PermissionsGuard.canActivate()` uses via `Reflector.getAllAndOverride()`.
 * A class-level-only decorator (e.g. `RoleQueryController`'s
 * `@RequirePermission('role:read')` covering all its routes) is real
 * enforcement, not just documentation, so it must appear in the catalog
 * too — confirmed live at boot: without this, the catalog undercounted by
 * exactly the number of class-level-only decorators (5 found vs 7 actually
 * enforced, before this fix).
 *
 * `path` here is BEST-EFFORT (controller prefix + handler path, joined —
 * it does not attempt to reproduce the `/v1` version prefix `main.ts`
 * applies, since that is resolved by Nest's router at a point this static
 * walk does not reach). It is informational only, shown in the CMS
 * catalog listing; the guard itself (`permissions.guard.ts`) never reads
 * `path` — only `code`.
 */
@Injectable()
export class PermissionCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly repository: PermissionCatalogReadRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const discovered = this.discoverPermissions();
    if (discovered.length === 0) {
      this.logger.warn('No @RequirePermission decorators found at boot.');
      return;
    }
    await this.repository.upsertMany(discovered);
    this.logger.log(
      `Permission catalog: upserted ${discovered.length} code(s).`,
    );
  }

  private discoverPermissions(): DiscoveredPermission[] {
    const byCode = new Map<string, DiscoveredPermission>();
    const controllers = this.discovery.getControllers();

    for (const wrapper of controllers) {
      const instance = wrapper.instance as object | undefined;
      if (!instance || !wrapper.metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPath = this.pathOf(wrapper.metatype);
      const classMeta = this.metaOf(wrapper.metatype);

      this.metadataScanner
        .getAllMethodNames(prototype)
        .forEach((methodName) => {
          const handler = (prototype as Record<string, unknown>)[methodName] as
            ((...args: unknown[]) => unknown) | undefined;
          if (typeof handler !== 'function') return;

          // Method-level wins over class-level — same precedence
          // `PermissionsGuard` applies via `getAllAndOverride()`.
          const meta = this.metaOf(handler) ?? classMeta;
          if (!meta) return;

          const handlerPath = this.pathOf(handler);
          const fullPath = ['', controllerPath, handlerPath]
            .filter((segment) => segment && segment !== '/')
            .join('/')
            .replace(/\/+/g, '/');

          byCode.set(meta.code, {
            code: meta.code,
            group: meta.code.split(':')[0] ?? meta.code,
            method: null,
            path: fullPath || '/',
            description: meta.description ?? null,
          });
        });
    }

    return [...byCode.values()];
  }

  private metaOf(target: unknown): PermissionMeta | undefined {
    return Reflect.getMetadata(
      REQUIRE_PERMISSION_METADATA,
      target as object,
    ) as PermissionMeta | undefined;
  }

  private pathOf(target: unknown): string {
    const raw = Reflect.getMetadata(PATH_METADATA, target as object) as
      string | string[] | undefined;
    if (!raw) return '';
    return Array.isArray(raw) ? (raw[0] ?? '') : raw;
  }
}
