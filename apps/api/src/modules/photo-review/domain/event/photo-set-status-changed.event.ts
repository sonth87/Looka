import { DomainEvent } from '@app/shared/domain/domain-event';
import { PhotoReviewSetStatus } from '../../photo-review.constants';

/**
 * Raised whenever `subject_photo_sets.status` actually changes (never for a
 * no-op reassignment to the same status — every raise site in
 * `PhotoReviewService` guards on `fromStatus !== toStatus`).
 *
 * This is the one-directional seam between `PhotoReviewModule` and
 * `PrintModule`: neither module structurally depends on the other (see each
 * module's own top doc comment), but the centralized print flow's
 * "cứ duyệt xong thì sẽ có trong đợt in" rule needs to react to a set
 * entering/leaving `APPROVED`. `PhotoReviewService` raises this generic
 * event with no knowledge of print at all; `PrintModule` supplies the one
 * `@OnDomainEvent('PhotoSetStatusChanged')` handler that currently cares
 * about it (`PhotoSetStatusChangedHandler`).
 *
 * Dispatched INSIDE the same DB transaction/manager as the status write —
 * see `PhotoReviewService`'s own raise sites, which bind the transaction's
 * `manager` into `TransactionContext` around the dispatch call so a
 * handler's `TransactionContext.manager()` resolves to it. A handler that
 * throws a genuine error rolls the status change back too (dispatcher's
 * documented semantics, `shared/cqrs/domain-event.dispatcher.ts`).
 */
export class PhotoSetStatusChangedEvent extends DomainEvent {
  readonly eventName = 'PhotoSetStatusChanged';

  constructor(
    setId: string,
    public readonly campaignId: string,
    public readonly fromStatus: PhotoReviewSetStatus,
    public readonly toStatus: PhotoReviewSetStatus,
    correlationId?: string,
  ) {
    super(setId, correlationId);
  }
}
