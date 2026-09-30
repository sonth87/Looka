import { defaultCameraRoleForStepType } from '@face/core';
import type { CaptureSession, CaptureStep, CaptureStepResult, CaptureWorkflow } from '@face/core';

/**
 * Pure helpers for the desktop kiosk's "multi-shot CENTER camera" flow: the
 * CENTER camera may be shot several times, the operator picks the best photo
 * with the arrow keys, and only that photo (plus the single shot of every
 * other angle) is saved. Everything here is free of React/Electron/DOM state
 * so it can be unit-tested directly (see `__tests__/centerShots.test.ts`);
 * `FaceCaptureApp.tsx` is the only caller that wires them to real state.
 */

/** How many photos the multi-shot CENTER step may accumulate in one session. A Canon still is several MB of base64 held in memory, so this is a hard ceiling, not a soft hint. */
export const MAX_CENTER_SHOTS = 10;

/** Shown when the save is refused because the photo the operator picked is not in the local upload queue any more (the main process reported `SELECTED_SHOT_NOT_STAGED`). Nothing was uploaded; the operator can pick again or retake. */
export const SELECTED_SHOT_NOT_STAGED_MESSAGE =
  'Không tìm thấy ảnh camera giữa đã chọn trên máy (có thể ảnh chưa lưu xong). Chưa lưu hồ sơ — vui lòng chọn lại ảnh hoặc chụp thêm rồi bấm lưu lại.';

/** A 1x1 transparent GIF — stands in for a shot whose real thumbnail has not been generated yet, so a published `thumbnails[]` always lines up 1:1 with the shots (a dropped/blank entry would shift every later thumbnail onto the wrong shot). */
export const PENDING_THUMBNAIL_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const roleOf = (step: CaptureStep) => step.cameraRole ?? defaultCameraRoleForStepType(step.type);

/**
 * Picks the (single) step of a workflow that may be shot more than once, or
 * `null` when the feature must stay off.
 *
 * Only steps whose LOGICAL role is CENTER are candidates — judged on the
 * ORIGINAL workflow (`step.cameraRole ?? defaultCameraRoleForStepType(type)`),
 * because in simultaneous mode `buildRoundPlan` rewrites every step's
 * `cameraRole` to the physical camera that ends up serving it (on a one-camera
 * kiosk that is CENTER for every step), which says nothing about which step
 * the operator thinks of as "the center photo". Priority: the `isCardSource`
 * step (the photo the printed card is derived from), else the first FRONT
 * step, else the first CENTER-role step. An `isCardSource` step that is NOT
 * CENTER (e.g. a LEFT profile) is never chosen — multi-shot is about the
 * center camera.
 *
 * `preparedWorkflow` is what will actually run (round-ordered in simultaneous
 * mode, or the very same workflow in sequential mode): the chosen step must
 * still exist there and still resolve to CENTER, otherwise the center camera
 * is not what would take that step's photo and the feature is turned off.
 */
export function resolveMultiShotStepId(
  originalWorkflow: CaptureWorkflow,
  preparedWorkflow: CaptureWorkflow
): string | null {
  const candidates = originalWorkflow.steps.filter((step) => roleOf(step) === 'CENTER');
  if (candidates.length === 0) return null;

  const chosen =
    candidates.find((step) => step.isCardSource === true) ??
    candidates.find((step) => step.type === 'FRONT') ??
    candidates[0];

  const inPrepared = preparedWorkflow.steps.find((step) => step.id === chosen.id);
  if (!inPrepared || roleOf(inPrepared) !== 'CENTER') return null;
  return chosen.id;
}

/**
 * The selection index after moving `delta` steps through `count` shots.
 * Clamped, never wrapping: pressing → on the last shot stays on it, so the
 * operator can tell they reached the end. `current` outside the range (or
 * `count` of 0) collapses to a valid index (0 when there is nothing).
 */
export function stepShotIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  const from = Number.isFinite(current) ? Math.trunc(current) : 0;
  return Math.min(Math.max(from + delta, 0), count - 1);
}

/**
 * Index (into `shots[]`) of the shot currently selected on `stepResult`, or
 * `undefined` when it has no shots (not a multi-shot step / nothing captured
 * yet). No explicit selection means the newest shot; an out-of-range one is
 * clamped, not trusted. The ONE place this default and clamp live — the review
 * modal's badge, the arrow keys' starting point, the extended display and the
 * `selectedAttempt` saved with the session all read it, so they can never
 * disagree about which photo is "Đang chọn".
 */
export function selectedShotIndexOf(stepResult: CaptureStepResult | null | undefined): number | undefined {
  const shots = stepResult?.shots;
  if (!stepResult || !shots || shots.length === 0) return undefined;
  return Math.min(Math.max(stepResult.selectedShotIndex ?? shots.length - 1, 0), shots.length - 1);
}

/** The attempt number of the shot currently selected on `stepResult`, or `undefined` when it has no shots (not a multi-shot step / nothing captured yet). */
export function selectedAttemptOf(stepResult: CaptureStepResult | null | undefined): number | undefined {
  const index = selectedShotIndexOf(stepResult);
  return index === undefined ? undefined : stepResult!.shots![index].attempt;
}

/**
 * The small pre-scaled previews of ONE engine session's center shots, keyed by
 * attempt. A single slot, not a map of sessions: only the session in progress
 * ever has previews worth keeping, and every reader goes through
 * `thumbnailsForSession`, which yields nothing for any other session id — so a
 * previous student's previews can neither leak into the next session nor need
 * pruning (the next session's first preview simply replaces the slot).
 */
export interface CenterShotThumbnailSlot {
  sessionId: string;
  byAttempt: Record<number, string>;
}

/** `slot`'s previews when it belongs to `sessionId`, otherwise none. Never returns the slot's own object for a foreign session. */
export function thumbnailsForSession(
  slot: CenterShotThumbnailSlot | null,
  sessionId: string | null | undefined
): Record<number, string> {
  return slot && sessionId && slot.sessionId === sessionId ? slot.byAttempt : {};
}

/** The slot after storing `thumb` for `attempt` of `sessionId` — a fresh slot when `slot` belongs to a different session (or is empty). Mutates and returns `slot` itself when it already belongs to `sessionId`. */
export function withThumbnail(
  slot: CenterShotThumbnailSlot | null,
  sessionId: string,
  attempt: number,
  thumb: string
): CenterShotThumbnailSlot {
  const target = slot && slot.sessionId === sessionId ? slot : { sessionId, byAttempt: {} };
  target.byAttempt[attempt] = thumb;
  return target;
}

/** What `publishCbHelpState` sends the extended display — see `CbHelpPublishState.centerShots`. */
export interface CenterShotsPublish {
  stepId: string;
  count: number;
  selectedIndex: number;
  thumbnails: string[];
}

/**
 * Builds the extended display's view of the multi-shot step, or `null` when
 * there is nothing to show (no session, step missing, no shots yet).
 *
 * `thumbsByAttempt` is the small pre-scaled preview per shot; pass `null` to
 * send NO thumbnails at all (nobody is looking — the extended display is
 * closed — so encoding/cloning them every heartbeat would be pure waste). When
 * given, `thumbnails` always has one entry per shot, using
 * `PENDING_THUMBNAIL_DATA_URL` for a shot whose preview is still being made.
 */
export function buildCenterShotsPublish(
  session: CaptureSession | null | undefined,
  stepId: string,
  thumbsByAttempt: Record<number, string> | null
): CenterShotsPublish | null {
  const stepResult = session?.steps.find((s) => s.stepId === stepId);
  const shots = stepResult?.shots;
  if (!stepResult || !shots || shots.length === 0) return null;

  return {
    stepId,
    count: shots.length,
    selectedIndex: selectedShotIndexOf(stepResult)!,
    thumbnails: thumbsByAttempt
      ? shots.map((shot) => thumbsByAttempt[shot.attempt] ?? PENDING_THUMBNAIL_DATA_URL)
      : [],
  };
}

/**
 * A copy of `session` fit for the local sql.js cache: the multi-shot step's
 * `shots[]` (every discarded photo, each a full-resolution base64 string) is
 * dropped; `capturedImagePath` — the selected photo — is kept, exactly as for
 * every other step. The live engine session itself is never touched: the
 * review screen and the save still need the shots.
 */
export function stripShotsForPersistence(session: CaptureSession): CaptureSession {
  if (!session.steps.some((s) => s.shots !== undefined || s.selectedShotIndex !== undefined)) return session;
  return {
    ...session,
    steps: session.steps.map((s) => {
      if (s.shots === undefined && s.selectedShotIndex === undefined) return s;
      const { shots: _shots, selectedShotIndex: _selectedShotIndex, ...rest } = s;
      return rest;
    }),
  };
}

/**
 * Downscales an image data URL to at most `maxWidth` pixels wide and
 * re-encodes it as JPEG, for the small per-shot previews the review modal and
 * the extended display show. Resolves `null` (never rejects) on any failure —
 * no DOM (a test/SSR run), an undecodable image, a canvas that will not
 * encode — so a missing preview degrades to "use the full image / a
 * placeholder" instead of breaking a capture.
 *
 * `Image`/`document` are only touched inside the returned promise, never at
 * import time, so importing this module is safe anywhere.
 */
export function downscaleImageDataUrl(dataUrl: string, maxWidth = 320, quality = 0.75): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof Image === 'undefined' || typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const srcWidth = img.naturalWidth || img.width;
          const srcHeight = img.naturalHeight || img.height;
          if (!srcWidth || !srcHeight) {
            resolve(null);
            return;
          }
          const scale = Math.min(1, maxWidth / srcWidth);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(srcWidth * scale));
          canvas.height = Math.max(1, Math.round(srcHeight * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}
