import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AI_EDIT_JOB_CONCURRENCY } from '../photo-review.constants';
import type { AiEditLane as Lane } from './ai-edit.job';

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
}

/**
 * In-process semaphore (2026-09-29, user-priority-preemption rework) that
 * both `AiEditProcessor` (user lane) and `AiEditBackgroundProcessor`
 * (background lane) acquire a slot from before actually running a job, and
 * release once it settles — capacity `AI_EDIT_JOB_CONCURRENCY` (3), the
 * TOTAL cap across both BullMQ queues in this one process.
 *
 * This exists because BullMQ's own `opts.priority` cannot do what "a
 * user's click must always jump ahead of already-queued background work"
 * actually needs: priority only decides who gets picked FIRST once a slot
 * is free, it cannot RESERVE a slot ahead of time. With one shared queue
 * and priority alone, 3 background (recovery-requeued/kiosk-auto) jobs
 * could still legitimately claim all 3 BullMQ-level concurrency slots
 * first and run for however long the GPU call takes (up to
 * `AI_IMAGE_EDIT_TIMEOUT_MS`, minutes) before a higher-priority user job
 * arriving after them gets a turn — exactly the starvation this whole
 * rework exists to prevent.
 *
 * The two-queue-plus-gate design instead separates "which BullMQ queue a
 * job sits in" (decided once, at enqueue time, by
 * `PhotoReviewService.enqueueAiEditJob`'s caller) from "which slot a
 * released capacity unit goes to next" (decided HERE, every time a slot
 * frees up): a released slot always goes to a WAITING user-lane acquirer
 * first, a background-lane one only if no user-lane waiter exists. Combined
 * with `AI_EDIT_BACKGROUND_CONCURRENCY` (1, BullMQ's own per-queue option)
 * — which keeps the background lane from ever even TRYING to hold more than
 * 1 of these 3 slots at once — a freshly-clicked user job is guaranteed to
 * find at least 2 of the 3 slots reachable (either free, or freed by the
 * next release, since a background waiter never jumps a user one).
 *
 * What this deliberately does NOT do (see the task's own plan for why, and
 * the README-level risk this is reported under): abort an ALREADY-RUNNING
 * job to instantly free its slot for a new arrival. BullMQ 6.3.9 CAN cancel
 * a job it started (`Worker.cancelJob` + an `AbortSignal` threaded into the
 * processor), but the real `/edit` GPU service processes one request at a
 * time, FIFO, and its integration guide does not document whether it drops
 * a request once the caller disconnects — aborting our own HTTP call likely
 * does not free any GPU capacity at all, so it would only double the GPU's
 * own work (the aborted request keeps running there; a new one starts too)
 * without actually helping the user's job arrive any sooner. Because
 * `AI_EDIT_BACKGROUND_CONCURRENCY` is 1, the worst case is a new user click
 * waiting behind exactly one already-running background job — bounded, and
 * arguably better than aborting-and-wasting a GPU call that was already
 * most of the way done.
 *
 * IMPORTANT (2026-09-29 fix): "a released slot always goes to a WAITING
 * user-lane acquirer first" only actually matters if a freshly-clicked user
 * job can BECOME a waiter here before the slot is handed out. With
 * `AiEditProcessor`'s own BullMQ concurrency exactly equal to `capacity`
 * (the bug this fix closes), a 4th user job sitting in Redis was never
 * fetched — and so never reached `acquire()` — until an already-running
 * user job's slot freed, by which point `handRelease` had already handed
 * that very slot to a waiting BACKGROUND acquirer instead (`userWaiters`
 * was empty at the moment of the check). `AI_EDIT_USER_WORKER_CONCURRENCY`
 * (see that constant's own doc comment) fixes this by fetching a small
 * buffer of extra user jobs ahead of a free gate slot, so they show up in
 * `userWaiters` in time to actually win the race this class's whole design
 * exists for.
 */
@Injectable()
export class AiEditSlotGate implements OnApplicationShutdown {
  private readonly logger = new Logger(AiEditSlotGate.name);
  private readonly capacity = AI_EDIT_JOB_CONCURRENCY;
  private inUse = 0;
  private readonly userWaiters: Waiter[] = [];
  private readonly backgroundWaiters: Waiter[] = [];

  /**
   * Resolves once a slot is held, with an idempotent release function the
   * caller MUST call exactly once (a `finally` block) when its job settles.
   * A `background`-lane acquire can wait behind any number of `user`-lane
   * waiters that arrived after it — that is the whole point (see this
   * class's own doc comment).
   */
  acquire(lane: Lane): Promise<() => void> {
    if (this.inUse < this.capacity) {
      this.inUse += 1;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      (lane === 'user' ? this.userWaiters : this.backgroundWaiters).push(
        waiter,
      );
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.handRelease();
    };
  }

  private handRelease(): void {
    // User waiters always win the next free slot over background waiters,
    // regardless of arrival order — see this class's own top doc comment.
    const next = this.userWaiters.shift() ?? this.backgroundWaiters.shift();
    if (!next) {
      this.inUse -= 1;
      return;
    }
    // Slot handed directly to the next waiter — `inUse` stays the same
    // (one job's slot becomes another's), no decrement/increment race.
    next.resolve(this.makeRelease());
  }

  /**
   * `OnApplicationShutdown` hook (2026-09-29 fix — this used to be dead code
   * outside its own spec: the doc comment on `rejectAllWaiters` below always
   * claimed shutdown handling that nothing ever wired up). `main.ts` already
   * calls `app.enableShutdownHooks()`, so this now actually runs when the
   * process is asked to stop.
   */
  onApplicationShutdown(signal?: string): void {
    this.rejectAllWaiters(
      `AiEditSlotGate shutting down${signal ? ` (signal=${signal})` : ''}`,
    );
  }

  /**
   * Rejects every still-waiting acquirer (never the ones already holding a
   * slot) — called on app shutdown (via `onApplicationShutdown` above) so a
   * queued-but-not-yet-started job does not hang the shutdown sequence
   * forever. The variant stays `PROCESSING`
   * (already claimed before this gate is reached — see
   * `PhotoReviewService.runQueuedAiEditJob`) and BullMQ itself will mark the
   * job stalled/failed once this process stops renewing its lock; either
   * way, `AiEditRecoveryService`'s next sweep recovers it cleanly.
   */
  rejectAllWaiters(reason = 'AiEditSlotGate shutting down'): void {
    const all = [...this.userWaiters, ...this.backgroundWaiters];
    this.userWaiters.length = 0;
    this.backgroundWaiters.length = 0;
    if (all.length > 0) {
      this.logger.warn(
        `rejecting ${all.length} waiting acquirer(s): ${reason}`,
      );
    }
    for (const waiter of all) {
      waiter.reject(new Error(reason));
    }
  }
}
