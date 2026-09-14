import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_METADATA = 'REQUIRE_PERMISSION_METADATA';

/**
 * Marks a route as needing one permission code. `PermissionsGuard` reads
 * this metadata; `PermissionCatalogService` reads the SAME metadata at
 * boot (via `DiscoveryService`) to upsert the `permissions` table — a
 * route decorated once shows up both as an enforced check and as a row in
 * `GET /v1/permissions`, with no migration and no second place to keep in
 * sync (cms-8-screens-api-plan.md §1.1 E1/E4).
 *
 * `description` is optional, human-readable text for the catalog listing
 * (e.g. "Xóa đợt chụp") — purely cosmetic, never read by the guard.
 *
 * @example
 * @RequirePermission('campaign:delete', 'Xóa đợt chụp')
 * @Delete(':id')
 * deleteCampaign(...) { ... }
 */
export const RequirePermission = (code: string, description?: string) =>
  SetMetadata(REQUIRE_PERMISSION_METADATA, { code, description });
