import { RecognitionResult, RecognitionStatus } from '@face/core';

export type TemporalMode = 'M_OF_N' | 'N_CONSECUTIVE';

export interface TemporalPolicy {
  /** How the window is judged. Default M_OF_N. */
  mode?: TemporalMode;
  /** Window size — how many recent frames are considered. Default 5. */
  n?: number;
  /** Agreeing frames needed inside the window. Default 3. Ignored for N_CONSECUTIVE. */
  m?: number;
  /**
   * How long a confirmed identity stays locked in, so the person is not
   * re-confirmed on every frame while they stand there. Default 3000 ms.
   */
  identityLockMs?: number;
  /**
   * Drop the lock as soon as the face leaves. Default true.
   *
   * Without this, one person can walk away and the next person to step in
   * inherits the identity that is still held.
   */
  expireOnFaceLost?: boolean;
  /**
   * Frames older than this are dropped from the window even if few arrived.
   * Prevents evidence from a minute ago counting towards a decision now.
   * Default 2000 ms.
   */
  frameTtlMs?: number;
}

export interface TemporalDecision {
  /** CONFIRMED only after the window agrees; everything else keeps observing. */
  state: 'OBSERVING' | 'CONFIRMED' | 'LOCKED' | 'IDLE';
  personId?: string;
  /** Mean score of the agreeing frames, for the audit record. */
  score?: number;
  /** How many frames in the window backed this identity. */
  agreeing: number;
  /** How many frames are currently in the window. */
  windowSize: number;
  /** Why no identity was confirmed, when none was. */
  reason?: 'INSUFFICIENT_EVIDENCE' | 'NO_FACE' | 'NOT_A_MATCH' | 'CONFLICTING';
}

interface Observation {
  at: number;
  personId: string | null;
  score: number;
  status: RecognitionStatus;
}

const DEFAULTS: Required<TemporalPolicy> = {
  mode: 'M_OF_N',
  n: 5,
  m: 3,
  identityLockMs: 3_000,
  expireOnFaceLost: true,
  frameTtlMs: 2_000,
};

/**
 * Turns a stream of per-frame recognition results into one identity decision.
 *
 * A single frame is not evidence: a blink, a motion blur or an unlucky angle can
 * make one frame agree with the wrong person, and attendance built on one frame
 * inherits that mistake permanently. Requiring several frames to agree costs a
 * fraction of a second and removes the whole class of error.
 *
 * After confirming, the identity is held for a short lock so the caller is not
 * asked to decide again on every frame while the same person is still standing
 * there — but the lock is dropped the moment the face disappears.
 */
export class TemporalConfirmer {
  private readonly policy: Required<TemporalPolicy>;
  private window: Observation[] = [];
  private lockedPersonId: string | null = null;
  private lockedUntil = 0;
  private lockedScore = 0;

  constructor(policy: TemporalPolicy = {}) {
    this.policy = { ...DEFAULTS, ...policy };
    if (this.policy.m > this.policy.n) {
      throw new Error(`Temporal policy needs m (${this.policy.m}) <= n (${this.policy.n})`);
    }
  }

  public reset(): void {
    this.window = [];
    this.lockedPersonId = null;
    this.lockedUntil = 0;
    this.lockedScore = 0;
  }

  /** Identity currently held, or null. */
  public current(now = Date.now()): string | null {
    return this.lockedPersonId && now < this.lockedUntil ? this.lockedPersonId : null;
  }

  /**
   * Feed one frame's result and get the current decision.
   *
   * `CONFIRMED` is returned once, on the frame that completes the evidence;
   * subsequent frames report `LOCKED` so a caller can act exactly once without
   * tracking that itself.
   */
  public observe(result: RecognitionResult, now = Date.now()): TemporalDecision {
    this.expireLock(now);

    // A face leaving ends the current identity immediately — the next person to
    // appear must earn their own confirmation.
    if (this.policy.expireOnFaceLost && isFaceAbsent(result.status)) {
      this.window = [];
      this.lockedPersonId = null;
      this.lockedUntil = 0;
      return { state: 'IDLE', agreeing: 0, windowSize: 0, reason: 'NO_FACE' };
    }

    this.window.push({
      at: now,
      personId: result.status === 'MATCH' ? (result.personId ?? null) : null,
      score: result.score ?? 0,
      status: result.status,
    });
    this.prune(now);

    // Already locked: keep reporting the held identity without re-deciding.
    if (this.lockedPersonId && now < this.lockedUntil) {
      const agreeing = this.window.filter((o) => o.personId === this.lockedPersonId).length;
      return {
        state: 'LOCKED',
        personId: this.lockedPersonId,
        score: this.lockedScore,
        agreeing,
        windowSize: this.window.length,
      };
    }

    const verdict =
      this.policy.mode === 'N_CONSECUTIVE' ? this.judgeConsecutive() : this.judgeMOfN();

    if (!verdict) {
      return {
        state: 'OBSERVING',
        agreeing: this.bestAgreement().count,
        windowSize: this.window.length,
        reason: this.explainMiss(),
      };
    }

    this.lockedPersonId = verdict.personId;
    this.lockedScore = verdict.score;
    this.lockedUntil = now + this.policy.identityLockMs;

    return {
      state: 'CONFIRMED',
      personId: verdict.personId,
      score: verdict.score,
      agreeing: verdict.agreeing,
      windowSize: this.window.length,
    };
  }

  /** Drop frames outside the window, by count and by age. */
  private prune(now: number): void {
    const cutoff = now - this.policy.frameTtlMs;
    this.window = this.window.filter((o) => o.at >= cutoff).slice(-this.policy.n);
  }

  private expireLock(now: number): void {
    if (this.lockedPersonId && now >= this.lockedUntil) {
      this.lockedPersonId = null;
      this.lockedScore = 0;
    }
  }

  /** m of the last n frames agree on one identity. Tolerates isolated outliers. */
  private judgeMOfN(): { personId: string; score: number; agreeing: number } | null {
    const best = this.bestAgreement();
    if (!best.personId || best.count < this.policy.m) return null;
    return { personId: best.personId, score: best.meanScore, agreeing: best.count };
  }

  /** The most recent m frames all agree. Stricter, and slower to accept. */
  private judgeConsecutive(): { personId: string; score: number; agreeing: number } | null {
    const need = this.policy.m;
    if (this.window.length < need) return null;

    const tail = this.window.slice(-need);
    const first = tail[0].personId;
    if (!first || !tail.every((o) => o.personId === first)) return null;

    const meanScore = tail.reduce((sum, o) => sum + o.score, 0) / tail.length;
    return { personId: first, score: round(meanScore), agreeing: need };
  }

  private bestAgreement(): { personId: string | null; count: number; meanScore: number } {
    const groups = new Map<string, number[]>();
    for (const o of this.window) {
      if (!o.personId) continue;
      const scores = groups.get(o.personId) ?? [];
      scores.push(o.score);
      groups.set(o.personId, scores);
    }

    let bestId: string | null = null;
    let bestScores: number[] = [];
    for (const [personId, scores] of groups) {
      if (scores.length > bestScores.length) {
        bestId = personId;
        bestScores = scores;
      }
    }

    return {
      personId: bestId,
      count: bestScores.length,
      meanScore: bestScores.length
        ? round(bestScores.reduce((a, b) => a + b, 0) / bestScores.length)
        : 0,
    };
  }

  private explainMiss(): TemporalDecision['reason'] {
    const matches = this.window.filter((o) => o.personId !== null);
    if (matches.length === 0) return 'NOT_A_MATCH';

    const distinct = new Set(matches.map((o) => o.personId)).size;
    // More than one candidate in the window is a different problem from simply
    // not having seen enough frames yet, and worth distinguishing in diagnostics.
    return distinct > 1 ? 'CONFLICTING' : 'INSUFFICIENT_EVIDENCE';
  }
}

function isFaceAbsent(status: RecognitionStatus): boolean {
  return status === 'NO_FACE' || status === 'MULTIPLE_FACES';
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
