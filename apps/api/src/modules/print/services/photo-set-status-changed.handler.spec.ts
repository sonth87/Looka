import { PhotoSetStatusChangedEvent } from '@app/modules/photo-review/domain/event/photo-set-status-changed.event';
import { PhotoReviewSetStatus } from '@app/modules/photo-review/photo-review.constants';
import { PhotoSetStatusChangedHandler } from './photo-set-status-changed.handler';

/**
 * `PhotoSetStatusChangedHandler` — thin dispatcher over
 * `PrintItemService.onSetApproved`/`onSetLeftApproved` (see that class's
 * own spec for the actual create/attach/cancel behavior). What this spec
 * verifies is just the routing rule (toStatus/fromStatus === APPROVED) and
 * that the manager `TransactionContext.manager()` hands back is threaded
 * straight through — same fake-object style as
 * `print-item.service.auto-attach.spec.ts`.
 */
describe('PhotoSetStatusChangedHandler', () => {
  function build() {
    const manager = { __fake: 'manager' };
    const transactionContext = { manager: jest.fn().mockReturnValue(manager) };
    const printItemService = {
      onSetApproved: jest.fn().mockResolvedValue(undefined),
      onSetLeftApproved: jest.fn().mockResolvedValue(undefined),
    };
    const handler = new PhotoSetStatusChangedHandler(
      transactionContext as never,
      printItemService as never,
    );
    return { handler, manager, transactionContext, printItemService };
  }

  it('calls onSetApproved when a set transitions INTO APPROVED', async () => {
    const { handler, manager, printItemService } = build();
    const event = new PhotoSetStatusChangedEvent(
      'set-1',
      'campaign-1',
      PhotoReviewSetStatus.READY,
      PhotoReviewSetStatus.APPROVED,
    );

    await handler.handle(event);

    expect(printItemService.onSetApproved).toHaveBeenCalledWith(
      manager,
      'set-1',
      'campaign-1',
    );
    expect(printItemService.onSetLeftApproved).not.toHaveBeenCalled();
  });

  it('calls onSetLeftApproved when a set transitions OUT of APPROVED', async () => {
    const { handler, manager, printItemService } = build();
    const event = new PhotoSetStatusChangedEvent(
      'set-1',
      'campaign-1',
      PhotoReviewSetStatus.APPROVED,
      PhotoReviewSetStatus.REJECTED,
    );

    await handler.handle(event);

    expect(printItemService.onSetLeftApproved).toHaveBeenCalledWith(
      manager,
      'set-1',
    );
    expect(printItemService.onSetApproved).not.toHaveBeenCalled();
  });

  it('does nothing for a transition that neither enters nor leaves APPROVED', async () => {
    const { handler, printItemService } = build();
    const event = new PhotoSetStatusChangedEvent(
      'set-1',
      'campaign-1',
      PhotoReviewSetStatus.READY,
      PhotoReviewSetStatus.IN_REVIEW,
    );

    await handler.handle(event);

    expect(printItemService.onSetApproved).not.toHaveBeenCalled();
    expect(printItemService.onSetLeftApproved).not.toHaveBeenCalled();
  });

  it('re-approving an already-APPROVED set (APPROVED -> APPROVED) still calls onSetApproved, not onSetLeftApproved', async () => {
    // In practice PhotoReviewService's own `fromStatus !== toStatus` guard
    // means this event is never actually raised for a no-op reassignment —
    // this just documents the handler's own routing is unambiguous
    // (`toStatus === APPROVED` wins) if it ever were.
    const { handler, printItemService } = build();
    const event = new PhotoSetStatusChangedEvent(
      'set-1',
      'campaign-1',
      PhotoReviewSetStatus.APPROVED,
      PhotoReviewSetStatus.APPROVED,
    );

    await handler.handle(event);

    expect(printItemService.onSetApproved).toHaveBeenCalledTimes(1);
    expect(printItemService.onSetLeftApproved).not.toHaveBeenCalled();
  });
});
