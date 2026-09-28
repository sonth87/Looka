import { Injectable } from '@nestjs/common';
import {
  IDomainEventHandler,
  OnDomainEvent,
} from '@app/shared/cqrs/domain-event-handler.decorator';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { PhotoSetStatusChangedEvent } from '@app/modules/photo-review/domain/event/photo-set-status-changed.event';
import { PhotoReviewSetStatus } from '@app/modules/photo-review/photo-review.constants';
import { PrintItemService } from './print-item.service';

/**
 * Reacts to `PhotoSetStatusChangedEvent` (raised by `PhotoReviewService` on
 * every real `subject_photo_sets.status` transition) to keep the
 * CENTRALIZED print flow's "cứ duyệt xong thì sẽ có trong đợt in" invariant
 * — see this task's own brief. `PhotoReviewModule` must not import
 * `PrintModule` (and `PrintModule` must not import `PhotoReviewModule`
 * either — see each module's own top doc comment); this event is the
 * one-directional seam that lets this module react without either module
 * taking a Nest-level dependency on the other. Only a plain TS class (the
 * event itself, `DomainEvent`-derived data, no behavior) is imported across
 * the boundary — no service, no module.
 *
 * MUST be a `PrintModule` provider (`DomainEventDispatcher` discovers
 * handlers via `DiscoveryService` across the whole app's DI graph, but only
 * for providers that are actually registered somewhere — see
 * `print.module.ts`).
 *
 * Runs INSIDE the same manager/transaction as the status write that raised
 * the event — `PhotoReviewService` binds its `manager` into
 * `TransactionContext` around the `dispatcher.dispatch()` call specifically
 * so `this.transactionContext.manager()` here resolves to it. This is what
 * makes "approved" and "in the batch" atomic: if `handle()` throws a
 * genuine error, it propagates back through the dispatcher and rolls the
 * approval back too (dispatcher's documented semantics).
 *
 * Every expected/benign condition (no open batch, item already exists, lost
 * a concurrent create/attach race, set no longer APPROVED by the time this
 * runs, no active item to cancel) is swallowed inside
 * `PrintItemService.onSetApproved`/`onSetLeftApproved` — see their own doc
 * comments; this handler stays a thin, un-try/catch'd dispatcher on
 * purpose, so a genuine DB error is never accidentally caught here.
 */
@Injectable()
@OnDomainEvent('PhotoSetStatusChanged')
export class PhotoSetStatusChangedHandler implements IDomainEventHandler<PhotoSetStatusChangedEvent> {
  constructor(
    private readonly transactionContext: TransactionContext,
    private readonly printItemService: PrintItemService,
  ) {}

  async handle(event: PhotoSetStatusChangedEvent): Promise<void> {
    const manager = this.transactionContext.manager();
    if (event.toStatus === PhotoReviewSetStatus.APPROVED) {
      await this.printItemService.onSetApproved(
        manager,
        event.aggregateId,
        event.campaignId,
      );
    } else if (event.fromStatus === PhotoReviewSetStatus.APPROVED) {
      await this.printItemService.onSetLeftApproved(manager, event.aggregateId);
    }
  }
}
