import { FileStorageModule } from '@app/modules/file-storage/file-storage.module';
import { IdentityModule } from '@app/modules/identity/identity.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CardTemplateController } from './controllers/card-template.controller';
import { CardTemplateAsset } from './entities/card-template-asset.entity';
import { CardTemplate } from './entities/card-template.entity';
import { CardTemplateAssetService } from './services/card-template-asset.service';
import { CardTemplateRenderService } from './services/card-template-render.service';
import { CardTemplateService } from './services/card-template.service';

/**
 * P5 — cms-8-screens-api-plan.md §2.6/§5. Plain leaf module (matches
 * `device-management`/`photo-review`/`stats`, not the DDD-lite
 * `identity`/`workflow` layout — see `CardTemplateService`'s own doc
 * comment). Imports `IdentityModule` for `PermissionsGuard` — same
 * per-consuming-module DI resolution rule `StatsModule` hit live during P4
 * (`@UseGuards()` resolves a guard's constructor deps against the module
 * that declares the controller, not the module that exports the guard
 * class). Exports `CardTemplateService` for P6 (`print` module) to read
 * template rows when it lands — this module has no dependents yet.
 *
 * 2026-09-14 (P6): also exports `CardTemplateRenderService` — `modules/print`
 * injects it directly to reuse the real render engine for
 * `print_items.rendered_front_fs_file_id`/`rendered_back_fs_file_id`
 * (`PrintItemService.render`) rather than reimplementing it, per the P6
 * task brief's own instruction. This IS a real Nest-level module
 * dependency (unlike every other cross-module reference in this phase,
 * which stays plain SQL — see `modules/print`'s migration doc comment for
 * why even `print_items.template_id` still gets no FK despite this).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CardTemplate, CardTemplateAsset]),
    IdentityModule,
    FileStorageModule,
  ],
  controllers: [CardTemplateController],
  providers: [
    CardTemplateService,
    CardTemplateAssetService,
    CardTemplateRenderService,
  ],
  exports: [CardTemplateService, CardTemplateRenderService],
})
export class CardTemplateModule {}
