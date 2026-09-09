import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Camera, Monitor } from 'lucide-react';
import {
  CameraDevice,
  CameraRole,
  CaptureSession,
  CaptureSensitivity,
  CaptureTriggerMode,
  CaptureWorkflow,
  FaceState,
  FrameInput,
  GestureState,
  GuidanceState,
  defaultCameraRoleForStepType,
} from '@face/core';
import { BrowserCameraService } from '@face/camera';
import { MockCVEngine, FramePipeline } from '@face/cv-engine';
import { MediaPipeCVEngine } from '@face/cv-mediapipe';
import { MediaPipeGestureEngine } from '@face/hand-gesture';
import { WorkflowEngine, CaptureTriggerEvaluator } from '@face/workflow-engine';
import {
  framesForWorkflow,
  checkFramesReadiness,
  snapshotVideoFrame,
  allSideFramesReady,
  firstNotReadyFrameRole,
  CAMERA_ROLE_LABELS_VI,
  FramePreflight,
  FrameSpec,
  FrameReadiness,
  planCaptureRounds,
  CapturePlan,
} from '../../lib/multiFrame.js';
import {
  shouldRecordSingleStream,
  shouldRecordMultiChannel,
  isRecordingOverCap,
  MAX_RECORDING_DURATION_MS,
} from '../../lib/recordingGate.js';
import {
  createRecordingLivenessState,
  recordLivenessData,
  checkRecordingLiveness,
  RECORDING_TIMESLICE_MS,
  RECORDING_LIVENESS_CHECK_INTERVAL_MS,
} from '../../lib/recordingLiveness.js';
import { deviceUnauthorizedMessage, type DeviceRejectReason } from '../../lib/deviceBlockMessage.js';

/**
 * What a caller that already resolved access some other way (2026-09-08:
 * SSO login + `CampaignMemberGuard`'s APPROVED-membership-of-an-OPEN-
 * campaign check, both already satisfied before `FaceCaptureApp` ever
 * mounts — see `apps/desktop/src/renderer/CampaignGate.tsx`) hands in via
 * `FaceCaptureAppProps.campaignConfig` to skip the legacy per-device-secret
 * path entirely. Deliberately NOT the full `CampaignConfig` from
 * `campaignPortalApi.ts` — only the handful of fields `resolveActiveWorkflow`
 * actually needs, so this file does not have to track that interface's
 * unrelated fields (id/name/cardSpec/…).
 */
export interface CampaignWorkflowConfig {
  captureAngles?: unknown[] | null;
  recordVideo?: boolean;
}

/**
 * Capped bitrate for session recordings (2026-09-08) — `MediaRecorder`'s own
 * default is uncapped and scales with resolution/motion, which is how a
 * real capture session recorded a ~234MB file (see `recordingGate.ts`'s own
 * doc comment on that field incident). This footage exists as process
 * evidence, not a print-quality artifact, so 1 Mbps is deliberately modest —
 * resolution is untouched, only the encoder's target bitrate is capped.
 */
const VIDEO_BITRATE_BPS = 1_000_000;
import type { MultiFrameViewProps, MultiFrameViewFrame } from './views/types.js';
import { GuidedCaptureScreen } from './GuidedCaptureScreen.js';
import { StudentIdEntryScreen } from './StudentIdEntryScreen.js';
import { CccdScanWaitingScreen, type CccdRosterLookupResult } from './CccdScanWaitingScreen.js';
import { lookupStudent, type StudentLookupResult } from '../../lib/studentLookup.js';
import type { AuthClient } from '../../lib/authClient.js';
import { SessionReviewModal } from '../workflow/SessionReviewModal.js';
import { CAPTURE_MIRRORED } from '../camera/CameraPreview.js';
import { StepItem } from '../workflow/StepProgress.js';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip.js';
import { getSettings, updateSettings } from '../../lib/settingsStore.js';
import { CaptureSink, RunScopedCaptureSession } from '../../lib/CaptureSink.js';
import type { ApprovalStepInfo, StudentSubjectInfo } from '../../lib/CaptureSink.js';
import { SQLiteStorageAdapter, SessionRepository } from '@face/database';

const defaultWorkflow: CaptureWorkflow = {
  id: 'workflow_standard_5step',
  name: 'Quy trình 5 hướng chuẩn',
  version: 1,
  steps: [
    {
      id: 'step-front',
      type: 'FRONT',
      instruction: 'Nhìn thẳng vào camera',
      // Widened for real degrees. The 7 here was set when pitch and yaw came
      // from a 2D proxy whose numbers stayed small whatever the head did; a
      // solved 3D pose reports the actual angle, and a webcam sitting below eye
      // level already puts a seated person 10 degrees or so off axis before
      // they have moved at all.
      //
      // roll was missing entirely here, so a tilted head passed FRONT
      // unflagged — StepEvaluator only checks an axis the step actually
      // declares a target for, and this is meant to be the one straight,
      // level reference shot of the five.
      pose: {
        yaw: { target: 0, tolerance: 12 },
        pitch: { target: 0, tolerance: 12 },
        roll: { target: 0, tolerance: 12 },
      },
      // Posture/shoulder-level checking is skipped for every step, not just
      // LEFT/RIGHT — see postureCheck on those steps for the mechanism.
      postureCheck: false,
      capture: { enabled: true },
    },
    {
      id: 'step-left',
      type: 'LEFT',
      instruction: 'Quay mặt sang trái (15° - 30°)',
      // Was target -65/tolerance 25 (a 40-90 degree window) — a much shallower
      // turn than the operator actually wants for this angle. At 15-30 degrees
      // perspective foreshortening (~cos(yaw)) is negligible (0.97x-0.87x), so
      // the FACE_TOO_SMALL floor this used to need at the old, deeper angle
      // no longer applies — MEDIUM's default minFaceSizeRatio is fine here.
      pose: { yaw: { target: -22.5, tolerance: 7.5 } },
      postureCheck: false,
      capture: { enabled: true },
    },
    {
      id: 'step-right',
      type: 'RIGHT',
      instruction: 'Quay mặt sang phải (15° - 30°)',
      pose: { yaw: { target: 22.5, tolerance: 7.5 } },
      postureCheck: false,
      capture: { enabled: true },
    },
    {
      id: 'step-up',
      type: 'UP',
      instruction: 'Ngẩng đầu lên (15° - 35°)',
      // Positive pitch is looking up — the convention documented on
      // PoseEstimator. These two were swapped, so the step asked the subject
      // to look down while the hint told them the opposite, and it could not
      // be completed by following its own instruction.
      // Real degrees now: the angle comes from MediaPipe's solved 3D pose
      // rather than from how far the nose appears to sit below the eye line.
      pose: { pitch: { target: 25, tolerance: 10 } },
      capture: { enabled: true },
    },
    {
      id: 'step-down',
      type: 'DOWN',
      instruction: 'Cúi đầu xuống (15° - 35°)',
      pose: { pitch: { target: -25, tolerance: 10 } },
      capture: { enabled: true },
    },
  ],
};

/**
 * The steps a session actually runs — `defaultWorkflow` above, unless the
 * kiosk's campaign configures its own set (`captureAngles`, see
 * docs/plans/multi-camera-device-management-discussion.md §3.6).
 *
 * Two access models, picked by whether `campaignConfig` is passed in:
 *
 *  - **Campaign + login (2026-09-08 pivot, current desktop flow)**:
 *    `campaignConfig` non-null means the caller (`CampaignGate.tsx`) already
 *    gated entry on SSO login + `CampaignMemberGuard` (APPROVED member of an
 *    OPEN campaign) before this component ever mounted — there is no
 *    separate device identity to check here at all, so `blockedReason` is
 *    always `null` on this path. `captureMode`/`autoHoldMs`/
 *    `simultaneousCapture` are kiosk-local settings now, not campaign
 *    fields (moved off `CampaignConfigDao` server-side the same day) — read
 *    from `getSettings()`/`getCaptureSequencing()` exactly like
 *    `CampaignHomeScreen` already does, never from `campaignConfig`.
 *  - **Legacy per-device secret** (`campaignConfig` omitted — an app build
 *    with no `CampaignGate`, e.g. `apps/web`, or a desktop build that
 *    predates the pivot): the original §3.3 fail-closed policy, reading
 *    `window.faceAPI.getDeviceAccessStatus()`'s own cached device-secret
 *    verdict and config. Kept only for that backward compatibility — do not
 *    add new features to this branch.
 *
 * Called at the start of every session, not cached here, so either path
 * picks up an admin's config change without needing a restart.
 *
 * `(window as any).faceAPI` rather than a typed global: matches how the rest
 * of this package already reaches the preload bridge (see CaptureSink.ts and
 * SessionReviewModal.tsx) without pulling apps/desktop's preload types into a
 * package the web app also builds, where that global does not exist at all —
 * which is also why this is wrapped in try/catch and always has
 * `defaultWorkflow` to fall back to: the web build, and any error reaching
 * the admin portal, must never block a session from starting.
 */
async function resolveActiveWorkflow(campaignConfig?: CampaignWorkflowConfig | null): Promise<{
  workflow: CaptureWorkflow;
  triggerConfig: {
    mode: CaptureTriggerMode;
    autoHoldMs: number;
    /**
     * True when the campaign itself set `captureMode` (`config?.captureMode`
     * below was non-null/non-undefined) — carried through to
     * `effectiveTriggerConfig.fromCampaign` in FaceCaptureApp so the settings
     * UI (DesktopCaptureView's mode picker, OverlayConfigPanel) can show
     * "Theo cấu hình campaign" and stop the operator from locally picking a
     * mode the WorkflowEngine was never actually told to honour. See the bug
     * this field fixes, 2026-09-05: a campaign-forced OFF/MANUAL mode used to
     * never reach the capture views at all, which kept rendering whatever
     * this machine's own local settings said instead.
     */
    fromCampaign: boolean;
  };
  /**
   * §3.3's fail-closed verdict — non-null means the caller must refuse to
   * start a session at all, not merely fall back to defaultWorkflow. Distinct
   * from a config-fetch error (handled below by falling back, same as
   * always): this is the admin portal actively saying this device may not
   * capture, or having said nothing confirmable in over 24h.
   */
  blockedReason: 'unauthorized' | 'unreachable-too-long' | null;
  /**
   * Set only when `blockedReason === 'unauthorized'` — the specific
   * server-side cause (secret rotated, revoked, campaign expired, device
   * gone), so the overlay can explain the actual problem instead of one
   * undifferentiated message (2026-09-08 "kiosk 3" incident: an operator
   * went looking at campaign expiry when the real cause was a rotated
   * device secret). `null` for every other `blockedReason`, an app build
   * predating this, or an API predating this (see `deviceBlockMessage.ts`).
   */
  rejectReason: DeviceRejectReason | null;
  /**
   * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture)
   * — true only when the campaign explicitly turns it on. Absent/undefined
   * on older builds' config is treated as false, same fallback-is-safe
   * reasoning as every other campaign-config field here.
   */
  simultaneousCapture: boolean;
  /**
   * Campaign-level "Quay video trong lúc chụp" switch (§3.1, 2026-09-05) —
   * true only when the campaign explicitly turns it on. Absent/undefined
   * (older server, or no campaign at all) is treated as false, same
   * fallback-is-safe reasoning as `simultaneousCapture` above: no
   * `capture_streams` row is created and neither recording effect in this
   * file runs unless this is true.
   */
  recordVideo: boolean;
}> {
  const faceAPI = (window as any).faceAPI;
  let workflow = defaultWorkflow;
  // Campaign-configured capture mode/hold time (§3.8) — undefined/null when
  // the campaign hasn't set one, in which case this machine's own local
  // settings (debug panel) decide, same as before this existed.
  let campaignMode: CaptureTriggerMode | null | undefined;
  let campaignAutoHoldMs: number | null | undefined;
  let blockedReason: 'unauthorized' | 'unreachable-too-long' | null = null;
  let rejectReason: DeviceRejectReason | null = null;
  let simultaneousCapture = false;
  let recordVideo = false;

  if (campaignConfig) {
    // Campaign + login model — see this function's own doc comment. No
    // device-secret check at all: access was already decided before this
    // component mounted.
    try {
      if (
        campaignConfig.captureAngles &&
        Array.isArray(campaignConfig.captureAngles) &&
        campaignConfig.captureAngles.length > 0
      ) {
        workflow = { ...defaultWorkflow, steps: campaignConfig.captureAngles as unknown as CaptureWorkflow['steps'] };
      }
      recordVideo = campaignConfig.recordVideo === true;
      // "Cách chụp" (Tuần tự/Đồng thời) is kiosk-local (§3.9) — see
      // CampaignGate.tsx's own `sequencing` state, read the same way.
      const sequencing = await faceAPI?.getCaptureSequencing?.();
      simultaneousCapture = sequencing === 'simultaneous';
    } catch (err) {
      console.error('[FaceCaptureApp] resolveActiveWorkflow (campaign config) failed:', err);
    }
  } else {
    try {
      const status = await faceAPI?.getDeviceAccessStatus?.();
      blockedReason = status?.blocked ? status.reason ?? 'unauthorized' : null;
      rejectReason = blockedReason === 'unauthorized' ? status?.rejectReason ?? 'UNKNOWN' : null;
      const config = status?.config;
      if (config?.captureAngles && Array.isArray(config.captureAngles) && config.captureAngles.length > 0) {
        workflow = { ...defaultWorkflow, steps: config.captureAngles };
      }
      campaignMode = config?.captureMode;
      campaignAutoHoldMs = config?.autoHoldMs;
      simultaneousCapture = config?.simultaneousCapture === true;
      recordVideo = config?.recordVideo === true;
    } catch (err) {
      console.error('[FaceCaptureApp] resolveActiveWorkflow failed, using defaultWorkflow:', err);
    }
  }

  const settings = getSettings();
  return {
    workflow,
    triggerConfig: {
      mode: campaignMode ?? settings.captureMode ?? 'MANUAL',
      autoHoldMs: campaignAutoHoldMs ?? settings.autoHoldMs ?? 2000,
      fromCampaign: campaignMode != null,
    },
    blockedReason,
    rejectReason,
    simultaneousCapture,
    recordVideo,
  };
}

type StatsEventType =
  | 'SESSION_COMPLETED'
  | 'UPLOAD_SUCCESS'
  | 'UPLOAD_FAILED'
  | 'RETAKE'
  | 'CB_HELP_INTERVENTION'
  | 'SESSION_REPORT'
  | 'PHOTO_STATUS';

/**
 * Reports a stats-worthy moment (§3.4) to the desktop main process, if this
 * is running under the desktop app at all — a no-op on the web build, same
 * `(window as any).faceAPI` guard as `resolveActiveWorkflow`. Never throws:
 * a failed/impossible report must not interrupt the capture flow that
 * triggered it, so this is fire-and-forget from every call site.
 */
function reportStatsEvent(type: StatsEventType, metadata?: Record<string, unknown>): void {
  try {
    void (window as any).faceAPI?.recordStatsEvent?.({ type, metadata });
  } catch {
    /* no bridge, or not running under the desktop app — fine either way */
  }
}

/**
 * The CB Help extended-display window's own capture-frames snapshot (§3.5,
 * 2026-09-05 product decision — the window shows only the capture frames
 * live + captured, not a mirror of this whole app; see cbHelpWindow.ts's own
 * doc comment). Kept local to this file — the desktop app's preload bridge
 * (`apps/desktop/src/preload/index.ts`) declares its own copy of this same
 * shape rather than importing it, the same "duplicate the IPC payload shape
 * on each side" pattern every other `faceAPI` method here already follows.
 */
type CbHelpFrameStatus = 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED';

/** Mirrors `apps/desktop/src/main/cbHelpWindow.ts`'s own copy — see `CbHelpPublishState.greeting`'s doc comment below for when this is set. */
interface CbHelpGreeting {
  code: string;
  name: string;
  className: string;
  major: string;
  academicYear: string;
}

interface CbHelpFrame {
  stepId: string;
  stepType: string;
  role: string;
  label: string;
  deviceId: string | null;
  status: CbHelpFrameStatus;
  capturedDataUrl?: string;
  attempt: number;
}

interface CbHelpPublishState {
  running: boolean;
  /**
   * The CB Help window's own presentation mode (§3.5, 2026-09-05 second
   * product decision: captured photos must stay visible after the shot).
   * `running` alone can no longer tell the window what to render, because
   * "not running" now covers two different things — a finished session
   * whose photos must stay up (`'review'` while SessionReviewModal is still
   * open, `'done'` once the operator has accepted it) vs. a genuinely empty
   * window with nothing to show (`'idle'`: no session yet, cancelled,
   * restarted, or live mode was left). `'live'` always matches
   * `running: true`. See `publishCbHelpState` below for how this is chosen.
   */
  phase: 'idle' | 'live' | 'review' | 'done';
  simultaneous: boolean;
  currentStepId: string | null;
  frames: CbHelpFrame[];
  /**
   * Pre-session student greeting (2026-09-07) — set only for the brief
   * window between a `lookupStudent()` FOUND result and the capture session
   * actually starting (`handleStudentSubmit` below). Independent of `phase`:
   * a greeting always publishes with `phase: 'idle'`/no frames (no session
   * exists yet), so the CB Help renderer treats this field's presence, not
   * `phase`, as "show the full-screen greeting."
   */
  greeting: CbHelpGreeting | null;
  /**
   * Item 12b (2026-09-09): `CbHelpFrames.tsx` used to open its own
   * independent `getUserMedia` for CENTER, alongside this window's own
   * already-open CENTER stream (`cameraServiceRef`) — a known field bug
   * (2026-09-08 report: CB Help's CENTER tile stays blank even though the
   * main window's CENTER camera is clearly live), most likely the OS/driver
   * refusing a second concurrent reader of one physical camera. Fixed by
   * feeding that tile from THIS window's own live feed instead of a second
   * competing stream: a periodic still (see the `centerPreviewInterval`
   * effect below), refreshed a few times a second — plenty for an "extended
   * monitor," not a full second video pipeline. `null`/absent outside
   * `phase: 'live'`, or when `cameraServiceRef` has nothing to snapshot yet.
   */
  centerPreviewDataUrl?: string | null;
  /**
   * CCCD-scan capture-identification (2026-09-09) — set only for the brief
   * window between a scanned CCCD number failing to match the (campaign-
   * agnostic) roster and the next scan attempt (`handleCccdScan` below). Same
   * "presence, not `phase`, is what the renderer branches on" convention as
   * `greeting`: the CB Help window shows this as a full-screen error
   * overlay regardless of `phase`, since capture must not proceed while it
   * is up. `null`/absent the rest of the time.
   */
  errorMessage?: string | null;
  /**
   * Post-save "Cảm ơn" overlay (2026-09-09, "cảm ơn phải hiển thị trên màn
   * extend") — same "presence, not `phase`" convention as `greeting`/
   * `errorMessage`. Set only for the fixed window right after `onAccept`
   * succeeds (see `thankYouStudent`'s own doc comment). `null`/absent the
   * rest of the time.
   */
  thankYou?: { name: string } | null;
}

/**
 * Builds the CB Help window's per-frame snapshot from the live engine's own
 * session/state.
 *
 * One shape for both capture modes: sequential mode only fills in a
 * `deviceId` for whichever frame is CURRENT (falling back to the main
 * camera's own `selectedDeviceId`, since sequential mode already switches
 * that per step — see the role-mapping effect further down); simultaneous
 * mode fills in every frame's own mapped device regardless of which one is
 * "current", since every not-yet-COMPLETED frame is meant to go live at
 * once there. Deciding which frames actually go live in the CB Help window
 * itself is `CbHelpFrames.tsx`'s own call (simultaneous: everything not
 * COMPLETED; sequential: only CURRENT), not encoded in this payload.
 *
 * CENTER is special-cased to `currentDeviceId` in both modes, same as the
 * main window's own multi-frame grid does (`frame.role === 'CENTER' ?
 * selectedDeviceId : cameraRoleMapping[frame.role]` a bit further down) —
 * CENTER is deliberately never a key in `roleMapping` (it stays the one
 * analysed/active camera, not something the camera-setup screen assigns),
 * so reading `roleMapping['CENTER']` alone always misses and, in
 * simultaneous mode, fell through to `null` (the sequential-only fallback
 * below it never applied) — the CB Help window's CENTER tile then never
 * qualified as "live" and stayed blank even though the same camera was
 * clearly showing in the main window.
 */
function buildCbHelpFrames(
  workflow: CaptureWorkflow,
  session: CaptureSession | null,
  currentStepIndex: number,
  simultaneous: boolean,
  roleMapping: Record<string, string>,
  currentDeviceId: string,
  connectedDevices: CameraDevice[]
): CbHelpFrame[] {
  return framesForWorkflow(workflow).map((frame, idx) => {
    const sessionStep = session?.steps.find((st) => st.stepId === frame.stepId);
    const isCompleted = sessionStep?.status === 'COMPLETED';
    const isCurrent = !isCompleted && idx === currentStepIndex;
    const status: CbHelpFrameStatus = isCompleted
      ? 'COMPLETED'
      : isCurrent
      ? 'CURRENT'
      : sessionStep?.status === 'FAILED'
      ? 'FAILED'
      : 'PENDING';
    // A role-mapped device id is only worth forwarding if it's actually
    // connected right now — same check `isFrameMissingDevice` already does
    // for the main window (see this function's own doc comment, 2026-09-09
    // fix). A camera unplugged since `roleMapping` was last set must not be
    // reported as this frame's device — CbHelpFrames.tsx would then keep
    // trying (and failing) to open a stream for it every time this frame
    // becomes live again.
    const roleMappedDeviceId = roleMapping[frame.role];
    const roleMappedDeviceConnected =
      !!roleMappedDeviceId && connectedDevices.some((d) => d.id === roleMappedDeviceId);
    const mappedDeviceId =
      frame.role === 'CENTER'
        ? currentDeviceId || null
        : roleMappedDeviceConnected
        ? roleMappedDeviceId
        : null;

    return {
      stepId: frame.stepId,
      stepType: frame.type,
      role: frame.role,
      label: frame.label,
      deviceId: mappedDeviceId ?? (!simultaneous && isCurrent ? currentDeviceId || null : null),
      status,
      capturedDataUrl: sessionStep?.capturedImagePath,
      attempt: sessionStep?.attempts ?? 0,
    };
  });
}

/**
 * Resolves once `video` has genuinely rendered a real frame — not merely
 * "has a stream attached." 2026-09-05 field bug this defends against: a
 * side camera's offscreen `<video>` can already report `videoWidth > 0`
 * while still delivering the driver's placeholder/negotiation buffer, so
 * checking `videoWidth`/`readyState` alone at the instant the shutter fires
 * is not enough — see `snapshotVideoFrame`'s own luminance guard in
 * lib/multiFrame.ts for the second, pixel-level layer of this same fix.
 *
 * Prefers `requestVideoFrameCallback` — every Chromium build this app ships
 * on (Electron) supports it, and it only fires once a decoded frame has
 * actually been presented to the compositor. Falls back to polling
 * `readyState`/`videoWidth` where it's unavailable (e.g. a test
 * environment's stubbed `HTMLVideoElement`).
 */
function markFrameReadyWhenPlaying(video: HTMLVideoElement, onReady: () => void): void {
  let settled = false;
  const markReady = () => {
    if (settled) return;
    settled = true;
    onReady();
  };

  const rvfc = (video as any).requestVideoFrameCallback;
  if (typeof rvfc === 'function') {
    rvfc.call(video, markReady);
    return;
  }

  const poll = () => {
    if (settled) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      markReady();
      return;
    }
    requestAnimationFrame(poll);
  };
  poll();
}

export interface FaceCaptureAppProps {
  appId?: string;
  windowId?: string;
  /**
   * Where captures are kept.
   *
   * Supplied by the host application: the desktop kiosk hands photos to its
   * main process, the web app posts them to a backend. Without one the screen
   * captures but stores nothing, and says so rather than appearing to work.
   */
  sink?: CaptureSink;
  /**
   * Present → campaign + login access model; omitted/null → legacy
   * per-device-secret model. See `resolveActiveWorkflow`'s own doc comment
   * for what each does. `apps/desktop/src/renderer/CampaignGate.tsx` fetches
   * this (`fetchCampaignConfig` in `campaignPortalApi.ts`) once the operator
   * presses "Thực hiện chụp ảnh" and passes it through here.
   */
  campaignConfig?: CampaignWorkflowConfig | null;
  /**
   * The logged-in operator's server-side `users.id` (2026-09-09,
   * "thống kê phần giảng viên chụp" — `apps/api`'s
   * `DeviceEventService.campaignOperatorStats()` groups completed sessions
   * by this), passed straight through to `CaptureSink.approveUpload`'s
   * `operatorUserId` option at the moment a session is approved
   * ("Xác nhận & Lưu hồ sơ"). `apps/desktop/src/renderer/App.tsx` reads it
   * from `authClient.getOperatorUserId()`. `undefined`/`null` on the legacy
   * device-secret path or `apps/web` (no SSO identity at all) — a session
   * with no operator id just reports under the server's "Không rõ" bucket,
   * never blocks approval.
   */
  operatorUserId?: string | null;
  /**
   * The selected campaign's id (2026-09-09, CCCD-scan capture-identification
   * feature) — `apps/desktop/src/renderer/CampaignGate.tsx` threads this
   * through the same `children(props, campaignConfig, campaignId)` callback
   * `campaignConfig` already comes through, since it is only known inside
   * that gate's own closure (the `campaign` it fetched, chosen, and joined).
   * Together with `authClient` below, its mere presence is only used to
   * decide which pre-session identification screen to render below
   * (`CccdScanWaitingScreen` vs. `StudentIdEntryScreen`'s manual form) — NOT
   * to scope a roster lookup. A same-day architecture correction removed
   * the earlier campaign-scoped `GET /v1/campaigns/:id/roster/lookup` call
   * this doc comment used to describe: the real roster
   * (`D:\Work\camera_server\response.json`) is one campaign-agnostic file,
   * checked entirely inside the desktop app's main process (see
   * `apps/desktop/src/main/cccdRosterWatcher.ts`), never through this API.
   * `undefined`/`null` on the legacy device-secret path or `apps/web` —
   * both of those keep using `StudentIdEntryScreen`'s manual "nhập mã sinh
   * viên" form instead (see `handleCccdScan`'s own doc comment for why this
   * couldn't just be dropped as dead code).
   */
  campaignId?: string | null;
  /**
   * Same `AuthClient` `CampaignPickerScreen`/`CampaignHomeScreen` already
   * take as a prop — reused here (not a new, narrower "just give me a
   * header" abstraction) purely so its presence, alongside `campaignId`
   * above, marks this as the kiosk's campaign+login build. `apps/desktop/
   * src/renderer/App.tsx` passes the same `authClient` singleton
   * `CampaignGate.tsx` exports.
   */
  authClient?: AuthClient;
}

export function FaceCaptureApp(props: FaceCaptureAppProps) {
  const sink = props.sink ?? null;

  const [theme, setTheme] = useState<'dark' | 'light'>(() => getSettings().theme || 'light');

  const toggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      updateSettings({ theme: nextTheme });
      return nextTheme;
    });
  };

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [faceState, setFaceState] = useState<FaceState | null>(null);
  const [gestureState, setGestureState] = useState<GestureState | null>(null);
  const [gestureProgress, setGestureProgress] = useState<number>(0);

  const initialGuidance: GuidanceState = {
    status: 'INITIALIZING',
    primaryInstruction: 'Đang khởi tạo camera...',
    primaryReason: 'NO_FACE',
    progress: 0,
    hints: [],
    currentStepIndex: 0,
    totalSteps: 5,
    stepId: 'step-front',
    stepType: 'FRONT',
  };

  const [liveGuidance, setLiveGuidance] = useState<GuidanceState>(initialGuidance);

  const [session, setSession] = useState<CaptureSession | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  /**
   * True while `SessionReviewModal`'s `onAccept` handler is mid-flight — see
   * `SessionReviewModal.tsx`'s own `isAccepting` doc comment for the exact
   * field bug this guards against (a double-tap re-entering `onAccept` while
   * the first tap's approve call was still settling, which threw a scary but
   * spurious "no photos found" error on the already-succeeded second call).
   * `isAcceptingRef` is the actual re-entrancy guard (checked synchronously
   * at the top of the handler, before React has committed the state update
   * this triggers); the state twin only drives the button's disabled/label
   * UI.
   */
  const [isAcceptingSession, setIsAcceptingSession] = useState(false);
  const isAcceptingRef = useRef(false);
  const [cameraFps] = useState(30);
  const [cvFps, setCvFps] = useState(0);
  const [latestCapturedImage, setLatestCapturedImage] = useState<{ stepId: string; imagePath: string } | null>(null);
  const [sensitivity, setSensitivity] = useState<CaptureSensitivity>(() => getSettings().sensitivity || 'MEDIUM');
  const [showScreenDebugStats, setShowScreenDebugStats] = useState<boolean>(() => getSettings().showScreenDebugStats ?? true);

  const handleToggleShowScreenDebugStats = useCallback((show: boolean) => {
    setShowScreenDebugStats(show);
    updateSettings({ showScreenDebugStats: show });
  }, []);

  const [isWorkflowStarted, setIsWorkflowStarted] = useState<boolean>(false);
  const isWorkflowStartedRef = useRef(false);

  useEffect(() => {
    isWorkflowStartedRef.current = isWorkflowStarted;
  }, [isWorkflowStarted]);

  /**
   * The workflow actually running — `defaultWorkflow` until
   * `resolveActiveWorkflow()` resolves, at every session start, to whatever
   * the kiosk's campaign configures instead (see that function's own doc
   * comment). `stepsList` below renders from this, not `defaultWorkflow`
   * directly, so the on-screen step indicator matches whatever was actually
   * passed to `startSession`.
   */
  const [activeWorkflow, setActiveWorkflow] = useState<CaptureWorkflow>(defaultWorkflow);
  /**
   * §3.3's fail-closed verdict — non-null means every session-start call site
   * below must refuse to start one at all, and the render below replaces the
   * whole capture screen with a blocking message instead. Cleared the moment
   * a later `resolveActiveWorkflow()` call comes back unblocked (device
   * reactivated, connectivity restored within the 24h window, etc.).
   */
  const [deviceBlockedReason, setDeviceBlockedReason] = useState<'unauthorized' | 'unreachable-too-long' | null>(
    null
  );
  /**
   * The specific `'unauthorized'` cause — see `resolveActiveWorkflow`'s
   * `rejectReason` doc comment. Set alongside `deviceBlockedReason` at every
   * call site below, and read only by the overlay's message selection
   * (`deviceUnauthorizedMessage`); every other blocked-reason branch ignores
   * it.
   */
  const [deviceRejectReason, setDeviceRejectReason] = useState<DeviceRejectReason | null>(null);

  /**
   * Pre-session "nhập mã sinh viên" step (2026-09-07 product request) — the
   * kiosk boots straight into this instead of the old direct "Bắt đầu"
   * affordance, and falls back to it automatically after every session
   * finishes (see `SessionReviewModal`'s `onAccept` below), so walking up to
   * an idle kiosk always starts with entering a code. See
   * `handleStudentSubmit` for the lookup → greeting → session-start sequence
   * this gates.
   */
  const [awaitingStudent, setAwaitingStudent] = useState(true);
  const [studentSubmitting, setStudentSubmitting] = useState(false);
  const [studentLookupError, setStudentLookupError] = useState<string | null>(null);
  /**
   * The just-saved student, while the post-save "Cảm ơn" overlay is up
   * (2026-09-09, product request — "chụp xong chưa có lời cảm ơn"). Set by
   * `onAccept` right after a successful save, alongside keeping
   * `awaitingStudent` false for the same few seconds — the CCCD scanner
   * screen is gated on `awaitingStudent` (see its own render below), so this
   * doubles as the fix for "don't scan a new card while this student's
   * confirmation is still on screen." Non-null only for that fixed window;
   * `null` the rest of the time, including the whole active-capture session
   * (this is not the same thing as the pre-session greeting, which lives in
   * `handleLookupResult`/CB Help's own `greeting` field). Mirrored onto the
   * CB Help extended display too, via `publishCbHelpState({ thankYou })` —
   * see that field's own doc comment in `cbHelpWindow.ts`.
   */
  const [thankYouStudent, setThankYouStudent] = useState<StudentSubjectInfo | null>(null);
  /**
   * Ref mirror of `awaitingStudent` — read from `handleCccdScan`, which
   * `CccdScanWaitingScreen`'s `onScanResult` prop calls as a plain closure
   * captured once at render time inside a JSX callback, not from a
   * `useCallback`, so it cannot rely on the `awaitingStudent` state
   * variable staying fresh across renders either way. Guards against a
   * scan result arriving while a session is already in progress (or
   * another scan result is already being processed) from wrongly starting
   * a second session.
   */
  const awaitingStudentRef = useRef(awaitingStudent);
  useEffect(() => {
    awaitingStudentRef.current = awaitingStudent;
  }, [awaitingStudent]);
  /** Reentrancy guard for `handleCccdScan` — see its own doc comment. */
  const processingCccdScanRef = useRef(false);

  /**
   * Ref mirror of `activeWorkflow`, readable from inside the live engine's
   * capture-trigger handler below — that handler is registered once, inside
   * a mount-only effect (`useEffect(..., [])`), so it would otherwise only
   * ever see the `defaultWorkflow` this state started as. Same pattern as
   * `isWorkflowStartedRef`/`faceStateRef` elsewhere in this file.
   */
  const activeWorkflowRef = useRef<CaptureWorkflow>(defaultWorkflow);
  useEffect(() => {
    activeWorkflowRef.current = activeWorkflow;
  }, [activeWorkflow]);

  /**
   * The capture-trigger config actually in effect for whichever engine
   * (sim/live) the UI is currently showing — set at every call site that
   * hands a resolved config to an engine via `setCaptureTriggerConfig`
   * (`resolveActiveWorkflow`'s init/start/restart/cancel sites below), and by
   * `handleCaptureModeChange`/`handleAutoHoldMsChange` when the operator
   * changes it locally. Passed down to DesktopCaptureView/MobileCaptureView
   * as `captureMode`/`autoHoldMs` instead of letting them (via
   * GuidedCaptureScreen) fall back to their own copy read straight from the
   * local settings store — see the bug this fixes, 2026-09-05: a
   * campaign-forced OFF/MANUAL mode reached the engine (`WorkflowEngine.
   * setCaptureTriggerConfig`) but never reached the views, so a campaign set
   * to OFF still rendered the AUTO/MANUAL UI (no shutter button, a
   * misleading countdown ring) while the engine silently waited for a
   * shutter press that had no way to happen.
   */
  const [effectiveTriggerConfig, setEffectiveTriggerConfig] = useState<{
    mode: CaptureTriggerMode;
    autoHoldMs: number;
    /** True while `mode` came from the campaign, not this machine's local settings. */
    fromCampaign: boolean;
  }>({ mode: 'MANUAL', autoHoldMs: 2000, fromCampaign: false });

  /**
   * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture)
   * — the campaign's own `simultaneousCapture` flag, refreshed at every
   * session start/restart/cancel by `resolveActiveWorkflow()`, same cadence
   * as `deviceBlockedReason` above. Only ever acted on in live mode — see
   * the `multiFrame` prop built further down, which simulation mode never
   * receives regardless of this flag.
   */
  const [simultaneousCapture, setSimultaneousCapture] = useState<boolean>(false);
  /** Ref mirror of `simultaneousCapture`, for the same reason `activeWorkflowRef` exists above. */
  const simultaneousCaptureRef = useRef<boolean>(false);
  useEffect(() => {
    simultaneousCaptureRef.current = simultaneousCapture;
  }, [simultaneousCapture]);

  /**
   * Campaign-level "Quay video trong lúc chụp" switch (§3.1, 2026-09-05) —
   * the campaign's own `recordVideo` flag, refreshed at every session
   * start/restart/cancel by `resolveActiveWorkflow()`, same cadence as
   * `simultaneousCapture` above. Both recording effects further down are
   * gated on this: false means neither ever opens a `MediaRecorder` or
   * creates a `capture_streams` row.
   */
  const [recordVideo, setRecordVideo] = useState<boolean>(false);

  /**
   * The engine session actually being recorded, for the two recording
   * effects further down ONLY — `null` whenever no real (operator-started)
   * session is open. Deliberately keyed on the session's own id rather than
   * a plain boolean — see `recordingGate.ts`'s own doc comment for the full
   * mechanism this replaces and why.
   *
   * **2026-09-05 field bug this fixes**: a Windows kiosk running a 3-camera
   * simultaneous campaign with `recordVideo=true` had a session started,
   * abandoned by the operator with no cancel/complete ever firing, and its
   * recorders kept running — two `capture_streams` rows eventually closed at
   * ~234 MB each, one was left OPEN (`size_bytes=0`, `ended_at=null`). The
   * *next* real session then created NO recording rows at all. Root cause:
   * an earlier fix (still visible in ROADMAP.md's §3.1 history) replaced
   * gating these effects on `isWorkflowStarted` with a dedicated
   * `isRecordingSession` **boolean** — correctly separating "is a session
   * running" from "should recording be on" — but a boolean can't tell two
   * different sessions apart. The abandoned run left it stuck at `true`
   * (nothing resets it on mere inactivity — there was no idle/runaway cap at
   * all), so the next session's `setIsRecordingSession(true)` was a no-op
   * (same value in, no re-render), the effects' dependency arrays never
   * changed, and they never re-ran: the stale recorder from the abandoned
   * run just kept going while the new session got no recorder of its own.
   *
   * **Fix**: this key is set to the engine's actual `currentSession.id` the
   * moment a real session starts (`handleStartWorkflow`, the only call site
   * that ever set the old flag `true`) — a brand-new session always has a
   * genuinely different id, so the effects' dependency arrays always change
   * and always restart, even if the previous session's teardown never ran.
   * Reset to `null` at every real end-of-session point, same set of call
   * sites the old flag used — the engine's `completed` event (live and
   * simulation), `handleCancelWorkflow`, `handleRestart`, and leaving live
   * mode — each of which also causes the effects to clean up (stop every
   * recorder, finalize via `endVideoStream`) since the key changes away from
   * a real value. A session with no operator action *at all* (this bug's
   * exact scenario) is additionally bounded by a runaway cap inside the
   * effects themselves (`isRecordingOverCap`/`MAX_RECORDING_DURATION_MS` in
   * recordingGate.ts) — after 10 minutes the recording stops and finalizes
   * on its own, logged, regardless of whether anything else ever happens.
   */
  const [recordingSessionKey, setRecordingSessionKey] = useState<string | null>(null);

  /**
   * §3.10 layer 2 ("Trong phiên") — which recording channels have been
   * declared failed by the byte-liveness monitor in the two recording
   * effects below (a 3s data gap, one automatic restart attempt, then
   * another 3s gap — see recordingLiveness.ts). Keyed the same way each
   * effect keys `faceAPI.startVideoStream`'s `cameraId`: the single-stream
   * effect uses `selectedDeviceId || 'default'`, the multi-channel effect
   * uses each mapped device id. Cleared per-key at the start of whichever
   * effect owns that key, so a new recording session (or a device that
   * drops out of the mapping) never inherits a stale failed flag.
   *
   * Not yet consumed by any view — exposed here (component state, plus
   * threaded into `SharedCaptureViewProps.recordingFailed` below) so a
   * later UI pass can render the "● REC" / failure indicators
   * ui-redesign-plan.md's S5 mockup calls for, without this file's own
   * reliability fix waiting on that UI work.
   */
  const [recordingFailed, setRecordingFailed] = useState<Record<string, boolean>>({});

  /**
   * Latest simultaneous-capture readiness check — non-null once
   * `runFramePreflight` has run at least once. `!ok` means the session must
   * not start; rendered via GuidedCaptureScreen's `multiFrame.blocked` prop.
   */
  const [framePreflight, setFramePreflight] = useState<FramePreflight | null>(null);
  /**
   * One MediaStream per non-CENTER frame's physical camera, opened by
   * `openFrameStreams` right before a simultaneous-capture session starts.
   * The ref is what every other piece of logic here actually reads (capture
   * snapshots, the multi-channel recording effect's reuse path below); the
   * state mirror exists only so FrameTile's `stream` prop re-renders when a
   * stream opens or closes.
   */
  const frameStreamsRef = useRef<Record<string, MediaStream>>({});
  const [frameStreams, setFrameStreams] = useState<Record<string, MediaStream>>({});
  /**
   * One offscreen `<video>` per non-CENTER frame, fed from the same stream
   * in `frameStreamsRef` and kept playing — so a CENTER capture's snapshot
   * of every other frame (see the capture-trigger handler below) never has
   * to wait on `play()` at the exact instant the shutter fires.
   */
  const frameVideoElsRef = useRef<Record<string, HTMLVideoElement>>({});
  /**
   * Whether each non-CENTER frame's offscreen `<video>` (`frameVideoElsRef`)
   * has actually rendered a real frame yet — 2026-09-05 black-frame fix (see
   * `allSideFramesReady`/`snapshotVideoFrame` in lib/multiFrame.ts): a
   * stream being attached (`frameStreamsRef`) is not the same thing as the
   * camera actually delivering pixels, and the RIGHT camera's tile still
   * read "not ready" at the exact instant the shutter fired in the field
   * report this fixes. Absent from the map (not just `false`) also means
   * "not ready" — see the pure helpers' own doc comments. The ref is read
   * everywhere gating actually happens (the shutter-enable computation
   * below reads `frameReadiness` state instead, since that's what needs to
   * re-render); `frameReadinessRef` exists only so `openFrameStreams`'
   * readiness callback (which can fire well after the function that started
   * it has returned) always sees the latest map instead of a stale closure.
   */
  const frameReadinessRef = useRef<Record<string, boolean>>({});
  const [frameReadiness, setFrameReadiness] = useState<Record<string, boolean>>({});

  /**
   * Round planning (§3.1.5 "Quy tắc phủ N ảnh bằng K camera", wired in
   * 2026-09-08 — see `planCaptureRounds` in lib/multiFrame.ts for the
   * algorithm itself, fully implemented and unit-tested well before this).
   * Built once per session start (`runSimultaneousCaptureGate`) from the
   * campaign's steps and this kiosk's camera role mapping — a session is
   * only ever blocked when the kiosk has literally zero cameras mapped
   * (`plan.blocked`); otherwise the plan always finds *some* grouping,
   * firing as many steps at once as this kiosk's camera count allows and
   * falling back to one step at a time for the rest. `null` outside
   * simultaneous mode (sequential/simulation never build a plan).
   *
   * `stepRoundIndexRef`/`roundDrivingStepRef` are derived from the same
   * plan for O(1) lookups from the capture-trigger handler and
   * `captureRetakingSideFrame`: `stepRoundIndexRef` maps every step to
   * which round it belongs, `roundDrivingStepRef` maps a round to the one
   * step in it that actually goes through the engine's own pose-gated
   * capture path (CENTER-resolved when the round has one, so the CV
   * pipeline's already-live face analysis drives it; otherwise the round's
   * first step — see `captureRetakingSideFrame`'s extended stepId
   * derivation below for how a non-CENTER driving step still gets its
   * photo from its own physical camera, not the CENTER-only engine
   * snapshot). Every other step in a round rides along, captured via
   * `recordExternalCapture` the instant the driving step's capture fires
   * — see the `capture-trigger` listener in the mount effect below.
   */
  const capturePlanRef = useRef<CapturePlan | null>(null);
  const stepRoundIndexRef = useRef<Map<string, number>>(new Map());
  const roundDrivingStepRef = useRef<Map<number, string>>(new Map());

  /**
   * Stops and clears open frame streams. Omitting `stepIds` closes every
   * one (session end/cancel/restart, unchanged behaviour); passing an
   * explicit list closes only those — used when a round finishes and the
   * next round's streams are about to open, so a kiosk with fewer cameras
   * than rounds never holds more physical cameras open at once than the
   * current round actually needs.
   */
  const closeFrameStreams = (stepIds?: string[]) => {
    const targets = stepIds ?? Object.keys(frameStreamsRef.current);
    for (const stepId of targets) {
      const mediaStream = frameStreamsRef.current[stepId];
      if (!mediaStream) continue;
      mediaStream.getTracks().forEach((t) => t.stop());
      const videoEl = frameVideoElsRef.current[stepId];
      if (videoEl) videoEl.srcObject = null;
      delete frameStreamsRef.current[stepId];
      delete frameReadinessRef.current[stepId];
    }
    setFrameStreams({ ...frameStreamsRef.current });
    setFrameReadiness({ ...frameReadinessRef.current });
  };

  /**
   * Refreshes the camera role mapping and connected devices, then checks
   * every frame the workflow needs against them (see `checkFramesReadiness`
   * in lib/multiFrame.ts). Always re-reads both rather than trusting
   * whatever `cameraRoleMapping`/`devices` state already holds — the same
   * reasoning `resolveActiveWorkflow` gives for re-reading campaign config
   * on every session start: an admin can change the mapping, or a camera
   * can be plugged/unplugged, between sessions with no restart in between.
   */
  const runFramePreflight = async (workflow: CaptureWorkflow): Promise<FramePreflight> => {
    const faceAPI = (window as any).faceAPI;
    let mapping: Record<string, string> = {};
    try {
      mapping = (await faceAPI?.getCameraRoleMapping?.()) ?? {};
    } catch {
      /* no bridge, or no mapping saved yet — stay on {} */
    }
    setCameraRoleMapping(mapping);

    let devs = devices;
    try {
      devs = (await cameraServiceRef.current?.enumerateDevices()) ?? devices;
      setDevices(devs);
      // Keep `devicesRef` in lockstep synchronously (2026-09-09 fix) — the
      // effect that normally mirrors `devices` into it only runs after
      // `setDevices` above actually commits a render, which is too late for
      // `buildRoundPlan` right below (same call chain, same tick): it needs
      // this function's own freshly-enumerated list, not last render's, to
      // correctly tell a stale/hidden `cameraRoleMapping` entry apart from a
      // genuinely connected camera — see `planCaptureRounds`'s
      // `connectedDeviceIds` doc comment for why that distinction matters.
      devicesRef.current = devs;
    } catch (err) {
      console.error('[FaceCaptureApp] runFramePreflight enumerateDevices failed:', err);
    }

    const frames: FrameSpec[] = framesForWorkflow(workflow);
    const preflight = checkFramesReadiness(frames, mapping, devs);
    setFramePreflight(preflight);
    return preflight;
  };

  /**
   * Opens one dedicated getUserMedia stream per non-CENTER frame (CENTER
   * keeps using `cameraServiceRef`'s already-open stream — see the CENTER
   * device-switch in `runSimultaneousCaptureGate` below). Idempotent: a
   * frame whose stream from a previous call is still live is left alone
   * instead of opened a second time, so a restart/cancel that resolves back
   * to the same mapping never double-opens a physical camera — the same
   * kind of USB/driver contention this file's other multi-camera effects
   * already warn about.
   *
   * Same double-open fix as the multi-channel recording effect's own
   * `reusedCvStream` (2026-09-09, hardware-confirmed: the CB Help window hit
   * the identical conflict cross-process — see `CbHelpFrames.tsx`'s
   * `isFrameLive`/`centerDeviceId` doc comment — for a role that resolves to
   * the exact same physical device as CENTER's, the "1 camera covers
   * multiple roles" fallback (`planCaptureRounds`, lib/multiFrame.ts) this
   * function had no equivalent for): a fresh `getUserMedia` for a device
   * that is *also* the CV pipeline's own already-open CENTER stream clones
   * that stream instead of opening a second one, since a UVC driver that
   * only serves one exclusive capture session (this kiosk's actual
   * hardware) can reject the second independent open with `NotReadableError:
   * Device in use` even from within the same renderer.
   */
  const openFrameStreams = async (frames: FrameReadiness[]): Promise<boolean> => {
    for (const frame of frames) {
      if (frame.role === 'CENTER' || !frame.deviceId) continue;

      const existing = frameStreamsRef.current[frame.stepId];
      if (existing && existing.getTracks().some((t) => t.readyState === 'live')) continue;

      try {
        const cvService = cameraServiceRef.current;
        const reusedCvStream =
          cvService?.getSelectedDevice()?.id === frame.deviceId ? cvService.getActiveStream() : null;
        const mediaStream = reusedCvStream
          ? reusedCvStream.clone()
          : await navigator.mediaDevices.getUserMedia({
              audio: false,
              // 1280x720, not 1920x1080: these are process-evidence frames, not
              // the printed/matched photo (§2.8's resolution floor is FRONT-only
              // by product decision 2026-09-05), and three cameras sharing one
              // USB bus need the FRONT camera to keep the bandwidth for its own
              // 1080p capture rather than splitting it three ways.
              video: { deviceId: { exact: frame.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
            });
        frameStreamsRef.current[frame.stepId] = mediaStream;

        // 2026-09-05 black-frame fix: a genuinely new stream starts "not
        // ready" until it actually renders a frame — see
        // `frameReadinessRef`'s own doc comment and `markFrameReadyWhenPlaying`
        // below. Not reset on the idempotent reuse path above (an already-live
        // stream this function left alone is presumably already ready).
        frameReadinessRef.current[frame.stepId] = false;
        setFrameReadiness((prev) => ({ ...prev, [frame.stepId]: false }));

        let videoEl = frameVideoElsRef.current[frame.stepId];
        if (!videoEl) {
          videoEl = document.createElement('video');
          videoEl.muted = true;
          videoEl.playsInline = true;
          frameVideoElsRef.current[frame.stepId] = videoEl;
        }
        videoEl.srcObject = mediaStream;
        videoEl.play().catch((err: any) =>
          console.error(
            `[FaceCaptureApp] frame stream failed for ${frame.label}: ${err?.name}: ${err?.message}`
          )
        );
        markFrameReadyWhenPlaying(videoEl, () => {
          frameReadinessRef.current[frame.stepId] = true;
          setFrameReadiness((prev) => ({ ...prev, [frame.stepId]: true }));
        });

        // Diagnostic for the field issue "FRONT face < 250px with three
        // cameras open": records what the OS/driver actually granted this
        // side camera, so a kiosk with three cameras contending for one USB
        // bus shows the trade-off in main.log instead of only showing up
        // later as a downstream quality failure on the FRONT frame.
        //
        // Formatted as one string (JSON.stringify), not a message + object:
        // Electron's `console-message` forwarding to the main process only
        // carries the renderer console call's first string argument — a
        // second object argument used to be dropped before reaching
        // main.log, showing up there as just this bare message with no
        // resolution at all.
        const settings = mediaStream.getVideoTracks()[0]?.getSettings();
        console.warn(
          `[FaceCaptureApp] frame stream opened ${JSON.stringify({
            label: frame.label,
            role: frame.role,
            width: settings?.width,
            height: settings?.height,
          })}`
        );
      } catch (err: any) {
        console.error(`[FaceCaptureApp] frame stream failed for ${frame.label}: ${err?.name}: ${err?.message}`);
        setStoreError(
          `Khung ${frame.label} (${CAMERA_ROLE_LABELS_VI[frame.role]}): không mở được camera — ${err?.message ?? 'lỗi không rõ'}.`
        );
        return false;
      }
    }

    setFrameStreams({ ...frameStreamsRef.current });
    return true;
  };

  /**
   * Builds this session's round plan (`planCaptureRounds`) and rewrites
   * `workflow.steps` into round order, one step per physical camera per
   * round: every step's `cameraRole` becomes its *resolved* role (its own
   * preference when a camera is mapped for it, otherwise the §3.1.5
   * fallback — CENTER, or the kiosk's sole camera), and its `pose` becomes
   * the round's own `effectiveYaw`/`effectivePitch` (the pose target
   * expressed on the CENTER-analysed camera, already adjusted for whichever
   * physical camera actually resolves this step — see `RoundStepPlan`'s own
   * doc comment in lib/multiFrame.ts). Every downstream piece of this file
   * that reads `step.cameraRole`/`step.pose` (`framesForWorkflow`,
   * `openFrameStreams`, `captureRetakingSideFrame`, CB Help) therefore sees
   * the *resolved* camera and the *correct* gate pose automatically, with no
   * separate round-awareness of their own — the workflow itself already
   * carries it.
   *
   * Within each round the CENTER-resolved step (if the round has one) is
   * ordered first, so it becomes the step the engine's own pose-gated
   * `triggerManualCapture`/AUTO path drives — the CV pipeline only ever
   * analyses the CENTER stream. A round with no CENTER-resolved step (only
   * possible once the campaign's one CENTER step has already been used up by
   * an earlier round) still gates correctly: `captureRetakingSideFrame`'s
   * extended `stepId` fallback below routes ANY current step whose resolved
   * role isn't CENTER through `recordExternalCapture` instead, so the CV
   * pipeline still gates on the CENTER feed (reading this step's own
   * `effectiveYaw`/`effectivePitch`) while the photo itself comes from that
   * step's own physical camera.
   */
  const buildRoundPlan = (
    workflow: CaptureWorkflow,
    mapping: Record<string, string>,
    sequencing: 'sequential' | 'simultaneous',
    physicalAngles?: Record<string, { yaw: number; pitch: number }>
  ): { plan: CapturePlan; workflow: CaptureWorkflow } => {
    // `devicesRef.current`, not `devices` state: the caller
    // (`runSimultaneousCaptureGate`) runs this synchronously right after
    // `runFramePreflight`'s own fresh `enumerateDevices()` call, and
    // `devices` state from that call may not have re-rendered into this
    // closure yet — see `planCaptureRounds`'s `connectedDeviceIds` doc
    // comment for why routing a step to a stale/disconnected device instead
    // of falling back is exactly the bug this closes.
    const plan = planCaptureRounds(workflow.steps, mapping, {
      sequencing,
      physicalAngles,
      connectedDeviceIds: devicesRef.current.map((d) => d.id),
    });
    stepRoundIndexRef.current = new Map();
    roundDrivingStepRef.current = new Map();

    const orderedSteps = plan.rounds.flatMap((round, roundIdx) => {
      const ordered = [...round.steps].sort((a, b) => {
        if (a.cameraRole === 'CENTER') return -1;
        if (b.cameraRole === 'CENTER') return 1;
        return 0;
      });
      ordered.forEach((rsp, i) => {
        stepRoundIndexRef.current.set(rsp.step.id, roundIdx);
        if (i === 0) roundDrivingStepRef.current.set(roundIdx, rsp.step.id);
      });
      return ordered.map((rsp) => {
        const pose = { ...rsp.step.pose };
        if (rsp.effectiveYaw !== undefined) {
          pose.yaw = { tolerance: 10, ...pose.yaw, target: rsp.effectiveYaw };
        }
        if (rsp.effectivePitch !== undefined) {
          pose.pitch = { tolerance: 10, ...pose.pitch, target: rsp.effectivePitch };
        }
        return { ...rsp.step, cameraRole: rsp.cameraRole, pose };
      });
    });

    return { plan, workflow: { ...workflow, steps: orderedSteps } };
  };

  /**
   * Opens every non-CENTER stream the given round needs (idempotent, same as
   * `openFrameStreams` itself) and closes whichever previously-open streams
   * that round does not reuse — so a kiosk with fewer cameras than rounds
   * never holds more physical cameras open at once than the round actually
   * in progress needs. `roleMapping` is passed in rather than re-read, since
   * this can run mid-session (round transitions), unlike the initial
   * `runFramePreflight` re-read at session start.
   */
  const openRoundStreams = async (
    plan: CapturePlan,
    roundIdx: number,
    roleMapping: Record<string, string>
  ): Promise<boolean> => {
    const round = plan.rounds[roundIdx];
    if (!round) return true;

    const neededStepIds = new Set(round.steps.filter((s) => s.cameraRole !== 'CENTER').map((s) => s.step.id));
    const staleStepIds = Object.keys(frameStreamsRef.current).filter((id) => !neededStepIds.has(id));
    if (staleStepIds.length > 0) closeFrameStreams(staleStepIds);

    const frames: FrameReadiness[] = round.steps
      .filter((s) => s.cameraRole !== 'CENTER')
      .map((s) => {
        const deviceId = roleMapping[s.cameraRole] ?? null;
        return {
          stepId: s.step.id,
          type: s.step.type,
          role: s.cameraRole,
          label: s.step.type,
          instruction: s.step.instruction,
          deviceId,
          deviceLabel: null,
          connected: !!deviceId,
        };
      });

    return openFrameStreams(frames);
  };

  /**
   * The simultaneous-capture gate every engine session start goes through
   * (handleStartWorkflow, handleRestart, handleCancelWorkflow, and the
   * initial mount-effect start below). Per §3.1.5's product decision
   * (2026-09-08), a session is only ever refused for *zero* cameras mapped
   * at all (`plan.blocked`) — a kiosk with fewer cameras than the campaign
   * has steps still runs, in as many simultaneous rounds as its camera count
   * requires (see `buildRoundPlan`'s own doc comment), never blocked outright
   * the way the old "every step needs its own distinct camera" rule used to.
   *
   * Returns the round-ordered, pose-adjusted workflow the caller must
   * actually pass to `engine.startSession(...)` (not the original `workflow`
   * argument) — `null` only when `plan.blocked`. Sequential mode skips round
   * planning entirely and returns `workflow` unchanged, same as before this
   * existed.
   */
  const runSimultaneousCaptureGate = async (
    simultaneous: boolean,
    workflow: CaptureWorkflow
  ): Promise<CaptureWorkflow | null> => {
    setSimultaneousCapture(simultaneous);
    if (!simultaneous) {
      closeFrameStreams();
      capturePlanRef.current = null;
      stepRoundIndexRef.current = new Map();
      roundDrivingStepRef.current = new Map();
      return workflow;
    }

    const faceAPI = (window as any).faceAPI;
    let mapping: Record<string, string> = {};
    try {
      mapping = (await faceAPI?.getCameraRoleMapping?.()) ?? {};
    } catch {
      /* no bridge, or no mapping saved yet — stay on {} */
    }
    setCameraRoleMapping(mapping);
    // Per-role physical mounting angle override (§3.9, item 2 2026-09-09) —
    // set from CameraSetupScreen, consumed here so a step's subject-facing
    // pose target gets translated into the correct gate pose for whichever
    // physical camera actually resolves it, instead of always assuming
    // `DEFAULT_PHYSICAL_ANGLES`. Absent/unreachable bridge falls back to
    // `undefined`, which `planCaptureRounds` already treats as "use the
    // defaults for every role" — same fail-open reasoning as `mapping` above.
    let physicalAngles: Record<string, { yaw: number; pitch: number }> | undefined;
    try {
      physicalAngles = (await faceAPI?.getCameraPhysicalAngles?.()) ?? undefined;
    } catch {
      /* no bridge, or none saved yet — stay on undefined (defaults) */
    }
    // checkFramesReadiness still runs (unchanged) purely for the hot-unplug
    // diagnostics UI (`framePreflight`) — its stricter "every step needs its
    // own distinct camera" verdict is no longer what decides whether the
    // session may start; `plan.blocked` below is.
    await runFramePreflight(workflow);

    const { plan, workflow: roundWorkflow } = buildRoundPlan(workflow, mapping, 'simultaneous', physicalAngles);
    capturePlanRef.current = plan;
    if (plan.blocked) return null;
    currentRoundIdxRef.current = 0;

    const centerDeviceId = mapping['CENTER'];
    if (centerDeviceId && centerDeviceId !== cameraServiceRef.current?.getSelectedDevice()?.id) {
      await handleSelectCamera(centerDeviceId);
    }

    const opened = await openRoundStreams(plan, 0, mapping);
    if (!opened) return null;
    return roundWorkflow;
  };

  /**
   * Called from the live engine's `state-change` listener whenever
   * `currentState.stepId` changes — advances the open camera streams to
   * match whichever round that step belongs to, opening the new round's
   * streams and closing the previous round's. A no-op for sequential mode
   * (`capturePlanRef.current` is `null`) and for a step change within the
   * same round (a round's own non-driving steps complete via
   * `recordExternalCapture`, which does not change `currentState.stepId`
   * away from the round's driving step until the whole round is done).
   */
  const currentRoundIdxRef = useRef<number>(0);
  const advanceRoundStreamsForStep = (stepId: string) => {
    const plan = capturePlanRef.current;
    if (!plan) return;
    const roundIdx = stepRoundIndexRef.current.get(stepId);
    if (roundIdx === undefined || roundIdx === currentRoundIdxRef.current) return;
    currentRoundIdxRef.current = roundIdx;
    void openRoundStreams(plan, roundIdx, cameraRoleMappingRef.current);
  };

  /**
   * Simultaneous capture (§ desktop kiosk multi-camera capture, product
   * decision 2026-09-05 #3, second pass): while a side frame is being
   * retaken — `engine.retakingStepId` is set by `handleRetakeStep` below via
   * `WorkflowEngine.retakeStep(stepId, { externalCapture: true })` — no
   * trigger mode may complete that step through the engine's own capture
   * path. `triggerManualCapture`'s snapshot always comes from this engine's
   * shared snapshot provider, which only ever reads the CENTER-analysed
   * camera (see `liveEngine.setSnapshotProvider` in the mount effect below);
   * for a side frame that is simply the wrong physical camera. Every trigger
   * call site — the shutter button, the gesture loop, and the engine's own
   * AUTO auto-fire (re-emitted here as `external-capture-ready`, see
   * WorkflowEngine.processFrame) — routes through this first instead:
   * snapshot that frame's own `<video>` element and hand it to
   * `recordExternalCapture` directly, the same mechanism the initial
   * simultaneous shot's fan-out already uses.
   *
   * Returns true when it handled the trigger this way — the caller must not
   * also run its normal `triggerManualCapture` path — and false for every
   * other case (not simultaneous, no retake/current step to act on, or the
   * step resolves to CENTER, which still goes through the normal
   * capture-trigger path unmodified).
   *
   * Also the general driving mechanism for a round with no CENTER-resolved
   * step (§3.1.5 round planning, 2026-09-08): `engine.currentState.stepId`
   * is the fallback when there is no explicit retake, so a round whose
   * driving step's own resolved camera isn't CENTER routes through here too
   * — the CV pipeline still gates on the CENTER feed (that step's own
   * `effectiveYaw`/`effectivePitch`, baked into its `pose` by
   * `buildRoundPlan`), but the photo comes from this step's own physical
   * camera instead of the engine's CENTER-only snapshot provider.
   */
  const captureRetakingSideFrame = (engine: WorkflowEngine, stepIdOverride?: string): boolean => {
    if (!simultaneousCaptureRef.current) return false;
    const stepId = stepIdOverride ?? engine.retakingStepId ?? engine.currentState.stepId ?? null;
    if (!stepId) return false;

    const frame = framesForWorkflow(activeWorkflowRef.current).find((f) => f.stepId === stepId);
    if (!frame || frame.role === 'CENTER') return false;

    const videoEl = frameVideoElsRef.current[stepId];
    const dataUrl = videoEl ? snapshotVideoFrame(videoEl) : null;
    if (!dataUrl) {
      // 2026-09-05 black-frame fix: `snapshotVideoFrame` now also returns
      // null for a near-black/blank frame (see its own doc comment), not
      // just "no video element yet" — either way this is "treat as no
      // snapshot," but the operator needs to actually see it to know a
      // retake is still needed, not just a line in main.log.
      console.warn(`[FaceCaptureApp] retake trigger: no snapshot for ${frame.label} (${frame.role})`);
      setStoreError(
        `Khung ${frame.label} (${CAMERA_ROLE_LABELS_VI[frame.role]}): camera chưa sẵn sàng, chụp lại góc này.`
      );
      return true; // still "handled" — the normal path must not run for this frame either
    }
    engine.recordExternalCapture(stepId, dataUrl);
    return true;
  };

  /** How long the greeting stays on the CB Help window before the capture session (and recording) starts — picked from the requested 2-5s range. */
  const GREETING_DURATION_MS = 3000;
  /** How long the post-save "Cảm ơn" overlay stays up before the screen falls back to awaiting the next student — see `thankYouStudent`'s own doc comment. */
  const THANK_YOU_DURATION_MS = 3000;

  /**
   * NOT_FOUND branch of `handleLookupResult` below, for the manual "nhập mã
   * sinh viên" path (`StudentIdEntryScreen`, `apps/web`/legacy only as of
   * 2026-09-09 — see `handleCccdScan`'s own doc comment).
   */
  const MANUAL_ENTRY_NOT_FOUND_MESSAGE =
    'Không tìm thấy mã sinh viên này. Vui lòng liên hệ giáo viên hướng dẫn.';

  /**
   * Exact copy required by the CCCD-scan NOT_FOUND branch (product spec,
   * 2026-09-09) — shown identically on this kiosk's own "waiting for scan"
   * screen (via `studentLookupError`) and on the CB Help extended display
   * (via `publishCbHelpState`'s `errorMessage`). Do not reword — the product
   * brief specifies this string verbatim.
   */
  const CCCD_SCAN_NOT_FOUND_MESSAGE =
    'Thông tin của bạn không có trong dữ liệu, hãy báo với giáo viên hướng dẫn để xử lý';

  /**
   * The shared tail of both `handleStudentSubmit` (manual "nhập mã sinh
   * viên", `lookupStudent()`) and `handleCccdScan` (CCCD scan, roster
   * lookup) — extracted 2026-09-09 so the file-watch-driven flow fires
   * through the *exact same* FOUND/NOT_FOUND branching the manual flow
   * already had, per the task's own requirement ("make this same downstream
   * flow fire from a file-watch event instead of a manual form submit").
   * Only the NOT_FOUND message (and whether it also needs to be echoed to
   * the CB Help window) differs by source — everything else, including the
   * post-save-retake short-circuit and the exact `setAwaitingStudent(false)`
   * ordering, is identical regardless of how `result` was obtained. See the
   * original (pre-refactor) doc comment below for why that ordering matters.
   *
   * `setAwaitingStudent(false)` deliberately runs AFTER `handleStartWorkflow`
   * resolves, not before it (2026-09-08 audit fix — was the other way
   * around). `handleStartWorkflow` is where `activeSession` (the live
   * engine's own `currentSession`), `stepsList`'s completion markers,
   * `multiFrameProp`'s per-frame status, and `activeGuidance` all actually
   * get overwritten for the new session — the engine keeps serving the
   * *previous* student's completed session/guidance right up until its
   * `startSession()` call, mid-way through `handleStartWorkflow`, replaces
   * it (see `WorkflowEngine.startSession`'s synchronous `state-change` emit
   * and `activeSession`'s own doc comment below). Closing this overlay
   * before that finishes would flash the previous student's fully-completed
   * step thumbnails/frames at the next student for however long
   * `resolveActiveWorkflow`/`runSimultaneousCaptureGate` take. Awaiting
   * first means every one of those pieces is already fresh by the time this
   * screen actually disappears.
   */
  const handleLookupResult = async (
    result: StudentLookupResult,
    options: { notFoundMessage: string; publishNotFoundToCbHelp?: boolean }
  ): Promise<void> => {
    if (result.status === 'NOT_FOUND') {
      setStudentLookupError(options.notFoundMessage);
      if (options.publishNotFoundToCbHelp) {
        publishCbHelpState({ errorMessage: options.notFoundMessage });
      }
      return;
    }
    const subject: StudentSubjectInfo = {
      subjectCode: result.code,
      subjectName: result.name,
      className: result.className,
      major: result.major,
      academicYear: result.academicYear,
      identityNumber: result.identityNumber,
    };
    // Cached for RunScopedCaptureSession's own startSession()/approveUpload()
    // calls, made further down inside handleStartWorkflow()/onAccept — see
    // setSubject()'s own doc comment. This is the only place a real (not
    // simulated) student identity ever enters the capture pipeline; without
    // it every session's subjectCode/subjectName stays NULL centrally.
    runSessionRef.current.setSubject(subject);
    // Kept alongside (not just inside RunScopedCaptureSession) so onAccept
    // can stash it on lastCompletedSessionRef without re-deriving it — see
    // that ref's own doc comment.
    currentStudentRef.current = subject;

    // Post-save retake (2026-09-08): same mã SV re-entered/re-scanned, same
    // kiosk sitting, before anyone else used the machine — reopen the review
    // for the session just saved instead of starting a brand-new one. See
    // the plan's §2 for why this branch skips the greeting/handleStartWorkflow
    // path entirely: the engine's own session/workflow were never torn
    // down after that save (see lastCompletedSessionRef's own doc comment),
    // so there is nothing to "start" — only to resume and reopen.
    const lastCompleted = lastCompletedSessionRef.current;
    if (lastCompleted && lastCompleted.subjectCode === result.code) {
      // setSubject() was already called with this fresh lookup's `subject`
      // above — not re-set here from `lastCompleted.subject`, so a
      // name/class correction made between the two lookups (however
      // unlikely within one kiosk sitting) is what actually gets approved.
      runSessionRef.current.resume(lastCompleted.outboxSessionId);
      setIsWorkflowStarted(true);
      isWorkflowStartedRef.current = true;
      retookSinceReopenRef.current = false;
      setIsPostSaveReview(true);
      setSession(lastCompleted.session);
      setShowReviewModal(true);
      setAwaitingStudent(false);
      return;
    }
    // A genuinely different student's session is starting — the previous
    // one can no longer be reopened via this path (see this ref's own doc
    // comment on why staleness is only a concern once the NEXT session
    // actually begins, not merely once the code differs at lookup time).
    // Also clears any post-save-review flags left over from a reopened
    // review the operator closed (SessionReviewModal's onClose) without
    // confirming — without this, this brand-new session's own review
    // would wrongly route "chụp lại toàn bộ" through
    // `handlePostSaveRetakeAll` instead of the normal `handleRestart`.
    lastCompletedSessionRef.current = null;
    setIsPostSaveReview(false);
    retookSinceReopenRef.current = false;

    publishCbHelpState({
      greeting: {
        code: result.code,
        name: result.name,
        className: result.className,
        major: result.major,
        academicYear: result.academicYear,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, GREETING_DURATION_MS));
    await handleStartWorkflow(true);
    setAwaitingStudent(false);
  };

  /**
   * Handles a submit from `StudentIdEntryScreen` — the pre-session step
   * (2026-09-07 product request). `lookupStudent()` is currently simulated
   * (see that function's own doc comment); everything downstream of it is
   * real (`handleLookupResult` above) and will not need to change once it
   * calls a real API instead.
   *
   * As of 2026-09-09 this manual-entry path only matters for the
   * non-kiosk/legacy build (`apps/web`, or the legacy per-device-secret
   * desktop path) — see `handleCccdScan`'s own doc comment for why the
   * kiosk's own campaign+login path replaces this outright with CCCD
   * scanning instead of running both side by side.
   */
  const handleStudentSubmit = async (code: string) => {
    setStudentSubmitting(true);
    setStudentLookupError(null);
    try {
      const result = await lookupStudent(code);
      await handleLookupResult(result, { notFoundMessage: MANUAL_ENTRY_NOT_FOUND_MESSAGE });
    } finally {
      setStudentSubmitting(false);
    }
  };

  /**
   * `onScanResult` passed down to `CccdScanWaitingScreen` -> `ScanMonitorCorner`
   * (2026-09-09 architecture correction) — the kiosk's CCCD-scan replacement
   * for `handleStudentSubmit` above. The corner already did the actual
   * lookup itself (`faceAPI.lookupCccdByIdentityNumber`, against the WHOLE
   * external roster, no campaign-scoping — see that IPC handler's own doc
   * comment in `apps/desktop/src/main/index.ts`) before calling this; this
   * function's only job is mapping its result onto the exact
   * `StudentLookupResult` shape `handleLookupResult` already expects, then
   * running that same tail `handleStudentSubmit` already uses — FOUND
   * behaves identically either way; NOT_FOUND shows the product-specified
   * message on both this screen AND the CB Help extended display
   * (`publishNotFoundToCbHelp: true`), which the manual path never needed
   * to do.
   *
   * This used to be an IPC-push subscription (`faceAPI.onCccdScan`) that
   * ALSO made its own `GET /v1/campaigns/:id/roster/lookup` call — both
   * gone the same day: there is no push anymore (the corner calls this
   * directly as a plain callback prop once it has a result), and no
   * campaign-scoped API roster either (the corrected product decision is a
   * single, campaign-agnostic external file, checked entirely inside the
   * desktop app's main process).
   */
  const handleCccdScan = async (scanResult: CccdRosterLookupResult) => {
    if (!awaitingStudentRef.current) return; // a session is already in progress
    if (processingCccdScanRef.current) return; // already handling a previous result
    processingCccdScanRef.current = true;
    setStudentSubmitting(true);
    setStudentLookupError(null);
    // Clears any error/greeting left over on the CB Help window from a
    // previous attempt now that a fresh one is starting. Must be an explicit
    // `{ greeting: null, errorMessage: null }`, not a bare call — see
    // `cbHelpOverlayRef`'s own doc comment on why a bare `publishCbHelpState()`
    // now preserves these fields instead of blanking them.
    publishCbHelpState({ greeting: null, errorMessage: null });
    try {
      const result: StudentLookupResult = scanResult.found
        ? {
            status: 'FOUND',
            code: scanResult.record.studentCode ?? '',
            name: scanResult.record.fullName ?? '',
            className: scanResult.record.className ?? '',
            major: scanResult.record.majorName ?? '',
            // `course_year` is the closest thing the real roster has to an
            // "academic year" — not the same thing, but the best available;
            // see `apps/desktop/src/main/cccdRoster.ts`'s own doc comment.
            academicYear: scanResult.record.courseYear ?? '',
            identityNumber: scanResult.record.identityNumber,
          }
        : { status: 'NOT_FOUND', code: '' };
      await handleLookupResult(result, {
        notFoundMessage: CCCD_SCAN_NOT_FOUND_MESSAGE,
        publishNotFoundToCbHelp: true,
      });
    } catch (err) {
      console.error('[FaceCaptureApp] handling CCCD scan result failed:', err);
      setStudentLookupError('Không thể xử lý thông tin lúc này. Vui lòng thử quét lại.');
    } finally {
      setStudentSubmitting(false);
      processingCccdScanRef.current = false;
    }
  };

  /**
   * `fromIdentification` (2026-09-09 fix, "quét căn cước công dân xong mới
   * được ấn bắt đầu"): a plain manual click on the "Bắt đầu" button
   * (`onStartWorkflow={handleStartWorkflow}` below) — while
   * `awaitingStudentRef.current` is still true (no student identified yet
   * this sitting) — must be a no-op instead of starting a session. The one
   * legitimate internal caller, `handleLookupResult`'s FOUND branch, passes
   * `true`: it calls this WHILE `awaitingStudent` is still true (only set
   * false right after this call resolves — see that function's own doc
   * comment on why), so a plain `awaitingStudentRef.current` check alone
   * cannot tell "the real auto-start" apart from "operator clicked early".
   *
   * The check below is `fromIdentification !== true`, NOT `!fromIdentification`
   * — a real bug this exact shape caused (2026-09-09, caught by testing):
   * `onClick={onStartWorkflow}` passes the DOM click event as the button's
   * onClick handler's first argument, which lands right in this function's
   * first parameter. A `MouseEvent` is truthy, so a plain `!fromIdentification`
   * check was always `false` for a real click — the guard below it never
   * actually ran, and Start worked regardless of identification the entire
   * time this fix was "in place". Strict `!== true` means only the literal
   * `handleStartWorkflow(true)` call site bypasses the gate; anything else
   * passed here (an event object, `undefined`, garbage) is treated as "not
   * identification" and blocked while awaiting.
   *
   * This was previously attempted as a CSS pointer-events block on the
   * whole "Quét thẻ CCCD" overlay (`CccdScanWaitingScreen.tsx`) — reverted
   * (2026-09-09) because that also silently ate clicks meant for the
   * always-available "Màn hình mở rộng"/"Cài đặt camera" toolbar buttons,
   * which sit in the same overlay region but must stay usable at any time
   * (operator/admin controls, not gated on identification) — see that
   * file's own comment. Gating the actual function instead of a screen
   * region avoids that collateral blocking entirely.
   */
  const handleStartWorkflow = async (fromIdentification?: true) => {
    if (fromIdentification !== true && awaitingStudentRef.current) return;
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;
    const activeEngine = liveWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        rejectReason,
        simultaneousCapture: campaignSimultaneous,
        recordVideo: campaignRecordVideo,
      } = await resolveActiveWorkflow(props.campaignConfig);
      setDeviceBlockedReason(blockedReason);
      setDeviceRejectReason(rejectReason);
      if (blockedReason) {
        setIsWorkflowStarted(false);
        isWorkflowStartedRef.current = false;
        return;
      }
      activeEngine.setCaptureTriggerConfig(triggerConfig);
      setEffectiveTriggerConfig(triggerConfig);
      captureTriggerRef.current.updateConfig({ mode: triggerConfig.mode, autoHoldMs: triggerConfig.autoHoldMs });
      setRecordVideo(campaignRecordVideo);

      // `runSimultaneousCaptureGate` returns the round-ordered, pose-adjusted
      // workflow to actually run — not the original `workflow` above — or
      // `null` only when this kiosk has zero cameras mapped at all (§3.1.5).
      const preparedWorkflow = await runSimultaneousCaptureGate(campaignSimultaneous, workflow);
      if (!preparedWorkflow) {
        setIsWorkflowStarted(false);
        isWorkflowStartedRef.current = false;
        return;
      }
      setActiveWorkflow(preparedWorkflow);

      // Keys both recording effects to THIS session specifically (see
      // `recordingSessionKey`'s own doc comment) — reading the id off the
      // engine's return value rather than `activeEngine.currentSession?.id`
      // read later, so there is no gap where a stale render still sees the
      // previous session's id.
      const startedSession = await activeEngine.startSession(preparedWorkflow);
      setRecordingSessionKey(startedSession.id);

      // Clears the CB Help overlay's sticky `greeting` now that the session
      // has actually started (2026-09-09 bug: the `cbHelpOverlayRef` sticky
      // pattern — added so a CCCD NOT_FOUND message survives the 800ms
      // heartbeat — made `greeting` sticky too, with nothing left to null it
      // back out once real capture begins. `CbHelpFrames.tsx`'s own doc
      // comment on `greeting` says it "goes back to null once the real
      // session starts publishing" — true before that fix, no longer true
      // after it. A non-null `greeting` keeps arriving as a *new* object
      // every push (IPC re-serializes it each time even though the
      // underlying ref never changes), which re-triggers CbHelpFrames.tsx's
      // greeting-received effect on every single heartbeat tick and
      // force-uncollapses the full-screen greeting — fighting the one-shot
      // "collapse once real frames arrive" effect, whose own dependency
      // (`frames.length`) stops changing after the first push. Net field
      // symptom: the extend screen collapses to the corner badge for an
      // instant, then snaps back to the full-screen greeting within under a
      // second and stays there for the rest of the session, even though the
      // main kiosk window (which never depended on this field) captures
      // normally. This call is placed after `startSession()` specifically —
      // not before — because `showFrames`/`phase` in `publishCbHelpState`
      // already read `session.status === 'RUNNING'` by this point, so this
      // push carries the real frames immediately alongside `greeting: null`
      // instead of a transient idle/empty snapshot that would also wipe
      // `CbHelpFrames.tsx`'s locally-remembered corner badge.
      publishCbHelpState({ greeting: null });
    }
  };

  const cameraServiceRef = useRef<BrowserCameraService | null>(null);
  const liveWorkflowEngineRef = useRef<WorkflowEngine | null>(null);
  /**
   * The CB Help window's greeting/errorMessage are "sticky, until explicitly
   * changed" overlays, not a snapshot of this render — most `publishCbHelpState()`
   * call sites throughout this file (the 800ms heartbeat below, step-change/
   * capture-trigger progress refreshes, `{ phase: 'idle'|'review'|'done' }`
   * calls) pass neither field, and must NOT blank out a greeting or a CCCD
   * NOT_FOUND message that's currently showing just because they happened to
   * fire afterward (2026-09-09 bug: the extend screen's NOT_FOUND message was
   * visible for well under a second before the next 800ms heartbeat tick — the
   * one call site that always ran with no `opts` at all — silently reset it to
   * null; `greeting` had the same latent exposure). `publishCbHelpState` below
   * only ever updates this ref when a call explicitly names the field (`'foo'
   * in opts`, so an explicit `{ errorMessage: null }` clear still works) — see
   * `handleCccdScan`'s reset call for the one place that means it.
   */
  const cbHelpOverlayRef = useRef<{
    greeting: CbHelpGreeting | null;
    errorMessage: string | null;
    /** Post-save "Cảm ơn" overlay (2026-09-09) — same sticky reasoning as `greeting`/`errorMessage` above. */
    thankYou: { name: string } | null;
  }>({
    greeting: null,
    errorMessage: null,
    thankYou: null,
  });
  /**
   * Same "sticky until explicitly changed" reasoning as `cbHelpOverlayRef`
   * above, for `phase` specifically — see `publishCbHelpState`'s own comment
   * at its `phase` computation for the exact 2026-09-09 bug this closes
   * (the 800ms heartbeat's bare calls used to snap `review`/`done` back to
   * `idle` within under a second). `null` means "no explicit override in
   * effect" — the session's own `RUNNING` status alone decides `live` vs
   * `idle` in that case, same as before this ref existed.
   */
  const cbHelpPhaseOverrideRef = useRef<'idle' | 'review' | 'done' | null>(null);
  const livePipelineRef = useRef<FramePipeline | null>(null);
  /**
   * Fallback CV engine for LIVE mode itself — NOT simulation mode (removed,
   * item 8 2026-09-09). `startLiveMode`'s CV-init step falls back to this
   * when `MediaPipeCVEngine` fails or times out to initialize (bad GPU/WASM
   * environment), so the live pipeline still has *something* to drive the
   * capture screen with (no face ever detected, effectively a degraded/no-op
   * CV reading) instead of `livePipelineRef.current` staying null and the
   * whole guidance UI never coming alive. Lazily created once, on first use
   * — see `startLiveMode`'s own CV-init block.
   */
  const mockEngineRef = useRef<MockCVEngine | null>(null);
  /** Set when a capture could not be stored; surfaced, never swallowed. */
  const [storeError, setStoreError] = useState<string | null>(null);
  /**
   * Fixed at no-zoom/centred now that auto-zoom has been removed (see the
   * removal note further down) — CameraPreview still takes scale/origin
   * props, so these stay as the values that mean "native framing."
   */
  const digitalZoomScale = 1;
  const digitalZoomCenter = { x: 0.5, y: 0.5 };
  /**
   * Caches the sink's session id for the run currently in progress. See
   * RunScopedCaptureSession's own doc comment for why a run that is
   * abandoned (cancelled, or "Chụp lại toàn bộ") must call `.reset()` rather
   * than let the next run silently reuse this id.
   */
  const runSessionRef = useRef<RunScopedCaptureSession>(new RunScopedCaptureSession(sink));

  /**
   * The student `setSubject()` was last given — cached here (not just
   * inside `RunScopedCaptureSession`) so `onAccept` can also stash it on
   * `lastCompletedSessionRef` below without re-deriving it. Cleared whenever
   * a genuinely different student's session starts (see
   * `handleStudentSubmit`), so it can never leak into an unrelated run.
   */
  const currentStudentRef = useRef<StudentSubjectInfo | null>(null);

  /**
   * "Chụp lại sau khi đã lưu" (2026-09-08 post-save retake feature): the
   * session `onAccept` most recently saved successfully, kept around so
   * that if the SAME student re-enters their code before anyone else uses
   * this kiosk, `handleStudentSubmit` can reopen `SessionReviewModal`
   * against it instead of starting a brand-new session — see
   * `handleStudentSubmit`'s own doc comment for the exact branch. Cleared
   * the moment a genuinely different student's session starts, so a stale
   * entry can never be offered to the wrong person.
   *
   * `outboxSessionId`/`videoSessionId` are captured here (not re-read later)
   * because `onAccept` clears both `runSessionRef` and `recordingSessionKey`
   * right after saving — this is the only place that still has them.
   */
  const lastCompletedSessionRef = useRef<{
    subjectCode: string;
    subject: StudentSubjectInfo;
    session: CaptureSession;
    outboxSessionId: string;
    videoSessionId: string;
    steps: ApprovalStepInfo[] | undefined;
  } | null>(null);

  /**
   * Set by the post-save-retake handlers below the instant an actual retake
   * capture happens, so `onAccept` can tell "reopened just to look, then
   * re-confirmed with nothing changed" (a harmless no-op — there is nothing
   * new to approve) from "something was genuinely retaken" (approve again
   * for real). Without this, re-confirming an unchanged reopened session
   * would call `runSessionRef.current.approve()` with no staged rows behind
   * it, and `ElectronCaptureSink.approveUpload` throws on `approved: 0`.
   */
  const retookSinceReopenRef = useRef(false);

  /** True while `SessionReviewModal` is open for a post-save retake (mục 2/3 of the plan) rather than the normal pre-save review — see `handleStudentSubmit`'s matching branch and the modal's own `onRetake` prop below for what this changes. */
  const [isPostSaveReview, setIsPostSaveReview] = useState(false);

  /**
   * Local record of the session, in the browser's own sql.js database.
   *
   * Kept alongside the API sink rather than instead of it: the sink is what
   * makes the photo durable (sql.js is in-memory and gone on reload), while this
   * is what lets the review screen and any offline tooling read a session back
   * without a round trip, and it is what @face/database's tests and the desktop
   * app's repository code already assume exists.
   */
  const repoRef = useRef<SessionRepository | null>(null);
  const gestureEngineRef = useRef<MediaPipeGestureEngine | null>(null);
  const captureTriggerRef = useRef<CaptureTriggerEvaluator>(new CaptureTriggerEvaluator());
  const gestureAnimRef = useRef<number | null>(null);
  const mediaPipeCvRef = useRef<MediaPipeCVEngine | null>(null);

  /** Most recent grabbed frame, shared so only one GPU readback happens per tick. */
  const latestFrameRef = useRef<FrameInput | null>(null);

  /**
   * Face state readable from inside the animation loops.
   *
   * The gesture loop read `faceState` directly, which forced it into the
   * effect's dependency list — so every processed frame cancelled and recreated
   * the requestAnimationFrame loop, dozens of times a second.
   */
  const faceStateRef = useRef<FaceState | null>(null);
  useEffect(() => {
    faceStateRef.current = faceState;
  }, [faceState]);

  /**
   * Store one capture as its step completes.
   *
   * A failure is shown rather than logged: the operator is the only one who can
   * tell whether to retake now, and a photo silently missing from a finished
   * session is discovered far too late to do anything about. The record this
   * run's photos attach to is opened lazily, on this first call, by
   * RunScopedCaptureSession itself — so idly opening the screen does not leave
   * empty sessions behind.
   */
  const storePhoto = async (stepId: string, dataUrl: string, attempt: number) => {
    if (!sink) {
      setStoreError('Chưa cấu hình nơi lưu ảnh — ảnh chụp sẽ không được giữ lại.');
      return;
    }
    try {
      await runSessionRef.current.savePhoto({ stepId, attempt, dataUrl });
      setStoreError(null);
    } catch (err) {
      console.error('[FaceCaptureApp] storePhoto failed:', err);
      setStoreError(`Không lưu được ảnh ${stepId}: ${(err as Error).message}`);
    }
  };

  /**
   * Release this run's staged captures for upload, now that the operator has
   * reviewed and confirmed them in SessionReviewModal.
   *
   * Called from onAccept, before finishSession — see RunScopedCaptureSession's
   * own doc comment on why the order matters: finishSession drops the cached
   * session id, and calling this after that would silently find nothing to
   * approve. Returns whether it succeeded so onAccept can decide whether it is
   * safe to close the review screen: on failure, the captures are still safe
   * (they simply remain staged, exactly as an abandoned run would), so the
   * modal is left open and the operator can retry by pressing the same button
   * again rather than losing the chance to approve this run at all.
   *
   * `steps` (built by onAccept from the completed session) carries per-step
   * stepType/cameraRole/capturedAt through to the main process — see
   * `ApprovalStepInfo`'s own doc comment for why the outbox row alone cannot
   * supply those.
   *
   * `videoSessionId` is the workflow engine's own `CaptureSession.id`
   * (`completedSession.id` in onAccept below) — a different id space than
   * `runSessionRef`'s own sessionId (see `CaptureSink.approveUpload`'s doc
   * comment). It is what the recording effects tagged this run's
   * `capture_streams` rows with, so it — not the outbox sessionId — is what
   * lets the main process find this run's video when releasing it for
   * upload.
   */
  const approveUpload = async (steps?: ApprovalStepInfo[], videoSessionId?: string): Promise<boolean> => {
    // Diagnostic only (2026-09-05 field bug — operator confirms, modal
    // closes, nothing ever gets approved, with no trace anywhere). Logging
    // the id this run is about to approve, before the call, means a future
    // mismatch between this id and whatever `session:approveUpload`'s own
    // warn line reports on the main-process side is visible from the
    // renderer's console/devtools even if the main-process log is not at
    // hand.
    console.warn('[FaceCaptureApp] onAccept: approving sessionId=', runSessionRef.current.cachedSessionId);
    try {
      await runSessionRef.current.approve(steps, videoSessionId, props.operatorUserId);
      setStoreError(null);
      return true;
    } catch (err) {
      console.error('[FaceCaptureApp] approveUpload failed:', err);
      setStoreError(
        `Không xác nhận được lượt tải lên (ảnh vẫn được giữ an toàn trên máy) — vui lòng bấm "Xác nhận & Lưu hồ sơ" để thử lại: ${(err as Error).message}`
      );
      return false;
    }
  };

  /** Close the record. The photos are already stored; this only ends the run. */
  const finishSession = async () => {
    try {
      await runSessionRef.current.complete();
    } catch (err) {
      console.error('[FaceCaptureApp] finishSession failed:', err);
      setStoreError(`Không đóng được phiên: ${(err as Error).message}`);
    } finally {
      closeFrameStreams();
    }
  };

  useEffect(() => {
    async function init() {
      // Guarded on its own, separate from the try below: a database that fails
      // to open must degrade the local cache, not the whole screen. The two were
      // once one try/catch, so a browser that could not open sql.js never got as
      // far as starting the camera either.
      try {
        // Relative, not '/wasm/' (the adapter's default): under file:// (the
        // packaged desktop app) an absolute path resolves to file:///wasm/,
        // which doesn't exist — './wasm/' resolves next to the loaded
        // document (dist/index.html → dist/wasm/) and is equally correct for
        // the web build, which is served from '/'.
        const adapter = new SQLiteStorageAdapter({ wasmBaseUrl: './wasm/' });
        await adapter.initialize();
        repoRef.current = new SessionRepository(adapter);
      } catch (err) {
        console.warn('[FaceCaptureApp] local SQLite cache unavailable:', err);
      }

      try {
        const liveEngine = new WorkflowEngine();
        liveEngine.setSensitivity(sensitivity);
        liveEngine.setCaptureTriggerConfig({
          mode: getSettings().captureMode || 'MANUAL',
          autoHoldMs: getSettings().autoHoldMs || 2000,
        });
        liveEngine.setSnapshotProvider(() => {
          if (cameraServiceRef.current) {
            return cameraServiceRef.current.captureBase64Snapshot();
          }
          return null;
        });
        liveWorkflowEngineRef.current = liveEngine;

        liveEngine.on('state-change', (state: GuidanceState) => {
          setLiveGuidance({ ...state });

          // Round planning (§3.1.5): the engine just moved to a step from a
          // different round than the one currently open — advance which
          // physical cameras are streaming to match. See
          // `advanceRoundStreamsForStep`'s own doc comment.
          if (state.stepId) advanceRoundStreamsForStep(state.stepId);

          // Round planning bug fix (2026-09-09, item 5): a round's driving
          // step is not always CENTER-resolved — once an earlier round has
          // used up the campaign's one CENTER step, a later round can be
          // driven entirely by a non-CENTER step (e.g. a second LEFT-angle
          // shot). `WorkflowEngine.processFrame`'s AUTO branch only skips its
          // own CENTER-only snapshot path when `externalCaptureOnly` is
          // armed, which used to happen only for an explicit retake
          // (`retakeStep`) — a *first* pass through such a round silently
          // captured the CENTER feed and stored it mislabeled as the
          // non-CENTER step. `setExternalCaptureOnly` (see its own doc
          // comment) is the fix: re-armed on every step change here, from the
          // same resolved `cameraRole` `captureRetakingSideFrame` already
          // trusts, so AUTO mode routes through `external-capture-ready` (and
          // MANUAL/gesture through `captureRetakingSideFrame`'s existing
          // check) for ANY non-CENTER current step, not just a retaken one.
          // Sequential mode never builds a round plan, and its own
          // role-switch effect keeps `cameraServiceRef`'s single stream
          // pointed at whichever physical camera the current step actually
          // needs — so the engine's own snapshot provider is always correct
          // there, and this must stay a no-op outside simultaneous mode.
          if (state.stepId && simultaneousCaptureRef.current) {
            const frame = framesForWorkflow(activeWorkflowRef.current).find((f) => f.stepId === state.stepId);
            liveEngine.setExternalCaptureOnly(!!frame && frame.role !== 'CENTER');
          }

          // CB Help "step change" (§3.5) — de-duped against this event's
          // real firing rate (once per processed frame) via
          // `lastCbHelpKeyRef`; only an actual session start or step change
          // is worth a `cbhelp:publish` call. See publishCbHelpState's own
          // doc comment.
          const cbHelpKey = `${liveEngine.currentSession?.id ?? ''}:${state.currentStepIndex}`;
          if (cbHelpKey !== lastCbHelpKeyRef.current) {
            lastCbHelpKeyRef.current = cbHelpKey;
            publishCbHelpState();
          }
        });

        liveEngine.on('capture-trigger', (data: { stepId: string; imagePath: string }) => {
          setLatestCapturedImage({ ...data });

          // attempts counts completed retakes, so the wire value is 1-based: a
          // first capture and its first retake must not share a key, or the
          // retake is taken for a duplicate and dropped.
          const step = liveEngine.currentSession?.steps.find((st) => st.stepId === data.stepId);
          void storePhoto(data.stepId, data.imagePath, (step?.attempts ?? 0) + 1);

          // Round planning (§3.1.5): the step that just captured feeds every
          // OTHER step of its OWN round at once — not the whole workflow the
          // way this used to work before rounds existed. Gated on the
          // triggering step being its round's *driving* step, not on call
          // order or a re-entrancy flag: `engine.recordExternalCapture` below
          // re-emits this very 'capture-trigger' event for each round-mate it
          // marks COMPLETED, which re-enters this same handler synchronously
          // — but none of those re-entrant calls' steps are ever a round's
          // own driving step, so this block simply does not run for them,
          // and there is no second fan-out.
          if (simultaneousCaptureRef.current) {
            const plan = capturePlanRef.current;
            const roundIdx = stepRoundIndexRef.current.get(data.stepId);
            const isDrivingStep = roundIdx !== undefined && roundDrivingStepRef.current.get(roundIdx) === data.stepId;
            if (plan && isDrivingStep) {
              const round = plan.rounds[roundIdx];
              for (const rsp of round.steps) {
                if (rsp.step.id === data.stepId) continue;
                const sessionStep = liveEngine.currentSession?.steps.find((st) => st.stepId === rsp.step.id);
                if (sessionStep?.status === 'COMPLETED') continue;

                const videoEl = frameVideoElsRef.current[rsp.step.id];
                const dataUrl = videoEl ? snapshotVideoFrame(videoEl) : null;
                if (!dataUrl) {
                  // 2026-09-05 black-frame fix: this is the exact path the
                  // field bug went through — `snapshotVideoFrame` now rejects
                  // a near-black/blank frame instead of returning it, so a
                  // not-yet-ready side camera leaves its frame pending for
                  // retake (unchanged mechanism) instead of storing/
                  // uploading a black still. Surfaced to the operator, not
                  // just main.log, since a retake is actually needed here.
                  console.warn(
                    `[FaceCaptureApp] simultaneous capture: no snapshot for ${rsp.step.type} (${rsp.cameraRole}) — left pending for retake`
                  );
                  setStoreError(
                    `Khung ${rsp.step.type} (${CAMERA_ROLE_LABELS_VI[rsp.cameraRole]}): camera chưa sẵn sàng, chụp lại góc này.`
                  );
                  continue;
                }
                liveEngine.recordExternalCapture(rsp.step.id, dataUrl);
              }
            }
          }

          // CB Help (§3.5): a fresh photo for this frame — refresh the
          // published snapshot so the extended display swaps that tile's
          // live video for the captured still. Runs once per real capture,
          // plus once more per side frame the block above just fanned out to
          // (each of those is its own re-entrant 'capture-trigger') — a few
          // redundant IPC calls in a single burst, not a correctness issue.
          publishCbHelpState();
        });

        // AUTO mode's auto-fire for a simultaneous-capture side frame being
        // retaken (§ desktop kiosk multi-camera capture, product decision
        // 2026-09-05 #3, second pass) — the engine re-emits this instead of
        // completing the step itself once stability is reached, since its
        // own snapshot provider only ever reads the CENTER-analysed camera
        // (see WorkflowEngine's `externalCaptureOnly` doc comment). Routes
        // through the exact same helper the shutter/gesture call sites use.
        liveEngine.on('external-capture-ready', (data: { stepId: string }) => {
          captureRetakingSideFrame(liveEngine, data.stepId);
        });

        liveEngine.on('completed', (completedSession: CaptureSession) => {
          setSession(completedSession);
          setShowReviewModal(true);
          if (repoRef.current) void repoRef.current.saveSession(completedSession);
          // CB Help (§3.5, 2026-09-05 second pass): the finished photos must
          // STAY on the extended display, not drop to idle — `phase:
          // 'review'` publishes a running:false snapshot built from this
          // very session (every step's `capturedImagePath`, already
          // COMPLETED) while SessionReviewModal is open. It only goes idle
          // on a genuinely abandoned/replaced run: cancel, "Chụp lại toàn
          // bộ", or a fresh session starting.
          publishCbHelpState({ phase: 'review' });
          // Used to call finishSession() right here — wrong once approval was
          // introduced. finishSession() -> runSessionRef.current.complete()
          // clears the cached session id (see RunScopedCaptureSession's own
          // doc comment: approve() must run BEFORE complete(), never after).
          // Calling it the instant the workflow completes tore down the
          // session before the operator had even seen the review screen this
          // handler just opened, so clicking "Xác nhận & Lưu hồ sơ" moments
          // later always found no session left to approve — every natural
          // (non-manual-review) completion hit this, which is the common
          // case. finishSession() now runs only from onAccept, after
          // approveUpload() succeeds, which is the one place with the
          // correct ordering.
          //
          // Stop-recording hook (§3.1 fix, 2026-09-05) — see
          // `recordingSessionKey`'s own doc comment: this is the real
          // end-of-session boundary the recording effects need, which
          // `isWorkflowStarted` alone never reliably reaches on this path.
          setRecordingSessionKey(null);
        });

        const {
          workflow: liveWorkflow,
          triggerConfig: liveTriggerConfig,
          blockedReason: liveBlockedReason,
          rejectReason: liveRejectReason,
          simultaneousCapture: liveSimultaneous,
          recordVideo: liveRecordVideo,
        } = await resolveActiveWorkflow(props.campaignConfig);
        setDeviceBlockedReason(liveBlockedReason);
        setDeviceRejectReason(liveRejectReason);
        liveEngine.setCaptureTriggerConfig(liveTriggerConfig);
        setEffectiveTriggerConfig(liveTriggerConfig);
        captureTriggerRef.current.updateConfig({ mode: liveTriggerConfig.mode, autoHoldMs: liveTriggerConfig.autoHoldMs });
        setRecordVideo(liveRecordVideo);
        const preparedLiveWorkflow = liveBlockedReason
          ? null
          : await runSimultaneousCaptureGate(liveSimultaneous, liveWorkflow);
        setActiveWorkflow(preparedLiveWorkflow ?? liveWorkflow);
        if (preparedLiveWorkflow) await liveEngine.startSession(preparedLiveWorkflow);

        // Opening the camera was gated behind a user-agent test, so a desktop
        // showed a live-mode interface with no picture in it: stream stayed
        // null and the face overlay, which needs one, drew nothing.
        startLiveMode();
      } catch (err) {
        console.error('❌ [FaceCaptureApp] Initialization error:', err);
      }
    }

    init();

    return () => {
      cameraServiceRef.current?.stop();
      closeFrameStreams();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let animId: number;

    const processFrameLoop = () => {
      if (cameraServiceRef.current && livePipelineRef.current) {
        const frame = cameraServiceRef.current.getFrame();
        if (frame) {
          // Reading pixels back from the GPU is the expensive part of a frame,
          // so the gesture loop reuses this one instead of taking its own.
          latestFrameRef.current = frame;
          livePipelineRef.current.pushFrame(frame);
        }
      }
      animId = requestAnimationFrame(processFrameLoop);
    };

    animId = requestAnimationFrame(processFrameLoop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, []);

  useEffect(() => {
    let lastGestureTime = 0;
    const gestureLoop = async () => {
      if (cameraServiceRef.current && gestureEngineRef.current?.isInitialized) {
        const now = Date.now();
        if (now - lastGestureTime >= 80) {
          lastGestureTime = now;
          const frame = latestFrameRef.current;
          if (frame) {
            try {
              const gs = await gestureEngineRef.current.processFrame(frame);
              setGestureState(gs);

              const currentFaceState = faceStateRef.current;
              const isFaceReady =
                currentFaceState?.detected === true &&
                currentFaceState?.presence === 'SINGLE_FACE' &&
                currentFaceState?.quality?.accepted === true;

              const decision = captureTriggerRef.current.evaluate({
                faceReady: isFaceReady,
                faceStabilityProgress: 0,
                gestureState: gs,
                currentTime: now,
              });
              setGestureProgress(decision.gestureProgress ?? 0);

              if (decision.capture && liveWorkflowEngineRef.current) {
                captureTriggerRef.current.reset();
                const engine = liveWorkflowEngineRef.current;
                // Simultaneous capture: a side frame being retaken (MANUAL
                // mode's gesture) must snapshot its own camera, never the
                // engine's normal (CENTER-only) capture path — see
                // captureRetakingSideFrame's own doc comment.
                if (!captureRetakingSideFrame(engine)) {
                  const wf = engine as any;
                  // Pass the same frame isFaceReady was just computed from, so
                  // the engine's own quality gate (WorkflowEngine.
                  // triggerManualCapture) has something real to re-check at the
                  // moment the gesture actually fires. Calling this with no
                  // faceState at all used to skip that check silently — this
                  // gesture path had nothing else standing between a smiling
                  // face and a completed capture.
                  //
                  // `{ source: 'GESTURE', gesture: gs.gesture }` is pure
                  // additive plumbing for the auto-vs-manual capture stats
                  // feature (discussion doc §3.7.1) — this is the one place
                  // that knows the capture was decided by a hand gesture
                  // rather than AUTO stability or the shutter button.
                  if (wf.triggerManualCapture)
                    wf.triggerManualCapture(currentFaceState, { source: 'GESTURE', gesture: gs.gesture });
                }
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }
      gestureAnimRef.current = requestAnimationFrame(gestureLoop);
    };

    gestureAnimRef.current = requestAnimationFrame(gestureLoop);
    return () => {
      if (gestureAnimRef.current) cancelAnimationFrame(gestureAnimRef.current);
    };
  }, []);

  const handleShutterCapture = useCallback(() => {
    const engine = liveWorkflowEngineRef.current;
    if (!engine) return;

    // Simultaneous capture: a side frame being retaken (OFF mode's shutter
    // button) must snapshot its own camera, never the engine's normal
    // (CENTER-only) capture path — see captureRetakingSideFrame's own doc
    // comment. Checked ahead of the `faceState?.detected` gate below: a side
    // frame's retake does not depend on CENTER seeing a face at all.
    if (captureRetakingSideFrame(engine)) return;

    if (faceState?.detected) {
      const wf = engine as any;
      // Same reasoning as the gesture trigger above: pass the faceState this
      // click was actually decided under so the engine's quality gate has
      // real data to re-check, instead of silently accepting whatever the
      // shutter button's own `enabled` prop happened to miss (e.g. a smile
      // that started the instant before the click landed).
      //
      // `{ source: 'SHUTTER' }` — pure additive plumbing (discussion doc
      // §3.7.1), same as the gesture loop's own trigger info above.
      if (wf.triggerManualCapture) wf.triggerManualCapture(faceState, { source: 'SHUTTER' });
    }
  }, [faceState]);

  const handleSensitivityChange = useCallback((newSensitivity: CaptureSensitivity) => {
    setSensitivity(newSensitivity);
    liveWorkflowEngineRef.current?.setSensitivity(newSensitivity);
    mediaPipeCvRef.current?.setSensitivity?.(newSensitivity);
  }, []);

  const handleCaptureModeChange = useCallback((newMode: CaptureTriggerMode) => {
    // The settings UI disables the mode picker entirely while the campaign
    // dictates the mode (`effectiveTriggerConfig.fromCampaign`) — this guard
    // is a second line of defense against the same case, so a local change
    // can never again silently drift from what the engine actually honours.
    if (effectiveTriggerConfig.fromCampaign) return;
    captureTriggerRef.current.updateConfig({ mode: newMode });
    liveWorkflowEngineRef.current?.setCaptureTriggerConfig({ mode: newMode });
    setEffectiveTriggerConfig((prev) => ({ ...prev, mode: newMode, fromCampaign: false }));
  }, [effectiveTriggerConfig.fromCampaign]);

  const handleAutoHoldMsChange = useCallback((newMs: number) => {
    captureTriggerRef.current.updateConfig({ autoHoldMs: newMs });
    liveWorkflowEngineRef.current?.setCaptureTriggerConfig({ autoHoldMs: newMs });
    setEffectiveTriggerConfig((prev) => ({ ...prev, autoHoldMs: newMs }));
  }, []);

  const startLiveMode = async () => {
    updateSettings({ engineMode: 'live' });
    setFaceState(null);
    setCameraError(null);
    setIsCameraLoading(true);

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      alert(
        'Trình duyệt đã chặn Camera do bạn đang truy cập qua địa chỉ IP HTTP từ máy khác.\n\n' +
          'Cách bật Camera cho máy này trên Chrome:\n' +
          '1. Mở tab mới: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n' +
          '2. Thêm URL: ' +
          window.location.origin +
          '\n' +
          '3. Chuyển sang "Enabled" và bấm Relaunch.'
      );
    }

    // Preview first, CV second: the camera is started and rendered before the
    // MediaPipe CV engine (GPU/WASM) is ever touched. Previously the CV and
    // gesture engines were awaited before `camera.start()`, so a hung/slow
    // WebGL or WASM init on a kiosk with a bad GPU meant the camera never
    // started and the user saw a black preview with no error. Now
    // getUserMedia is requested first so the preview appears as soon as it
    // resolves, and the CV engine below is bounded by a hard timeout and can
    // only ever fall back to the mock engine — it can no longer hide the
    // camera. The frame loop (`processFrameLoop` in the effect keyed on
    // `[mode]`) re-checks `livePipelineRef.current`/`cameraServiceRef.current`
    // via requestAnimationFrame on every tick rather than once in an effect
    // keyed on `stream`, so it needs no extra "CV ready" state: it naturally
    // starts pushing frames the moment `livePipelineRef.current` is assigned
    // below, whenever that happens relative to `setStream`.
    try {
      const isNewCameraService = !cameraServiceRef.current;
      const camera = cameraServiceRef.current || new BrowserCameraService();
      cameraServiceRef.current = camera;

      if (isNewCameraService) {
        // Hot-plug detection (item 12a, 2026-09-09): `BrowserCameraService`'s
        // own constructor already wires up `navigator.mediaDevices.
        // ondevicechange` and emits `'device-change'` with a fresh
        // `enumerateDevices()` result on every plug/unplug (see
        // `setupDeviceChangeMonitoring` in packages/camera) — this file
        // simply never listened for it, so `devices` (the camera picker;
        // also what `multiChannelDeviceIds`/the recording gate and
        // `runFramePreflight` read) stayed frozen at whatever was connected
        // when the app launched until a full restart. Registered once per
        // camera instance (this function reuses `cameraServiceRef.current`
        // on a later call, see the `isNewCameraService` guard) rather than
        // re-attaching a duplicate listener every time `startLiveMode` runs.
        // Deliberately does not touch `selectedDeviceId` — a newly plugged
        // camera should show up as an option, not silently steal the active
        // selection out from under whatever the operator/CameraSetupScreen
        // already chose.
        camera.on('device-change', (devs: CameraDevice[]) => {
          setDevices(devs);
        });
      }

      const devs = await camera.enumerateDevices().catch(() => []);
      setDevices(devs);
      if (devs.length > 0) setSelectedDeviceId(devs[0].id);

      const st = await camera.start();
      setStream(st);
      setIsCameraLoading(false);
    } catch (err: any) {
      console.warn('Live camera error:', err);
      setStream(null);
      setIsCameraLoading(false);

      const errStr = String(err?.message || err || '');
      if (errStr.includes('Permission') || errStr.includes('NotAllowedError')) {
        setCameraError('Trình duyệt hoặc hệ thống đã từ chối quyền truy cập Camera. Vui lòng cho phép quyền Camera trên ô địa chỉ trình duyệt.');
      } else if (errStr.includes('NotFound') || errStr.includes('DevicesNotFoundError')) {
        setCameraError('Không tìm thấy thiết bị Camera nào trên máy tính/thiết bị này.');
      } else {
        setCameraError(`Không thể khởi động Camera: ${errStr || 'Vui lòng kiểm tra lại thiết bị camera.'}`);
      }
    }

    // CV init runs after the camera is already showing, in its own try/catch
    // isolated from the one above: a hung/slow/failing MediaPipe init must
    // only log and fall back to mockEngineRef, never touch setCameraError or
    // clear the stream the block above just set.
    try {
      if (!mediaPipeCvRef.current) {
        const mpCv = new MediaPipeCVEngine();
        const CV_INIT_TIMEOUT_MS = 20000;
        const initPromise = mpCv.initialize();
        await Promise.race([
          initPromise,
          new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error(`MediaPipe init timed out after ${CV_INIT_TIMEOUT_MS}ms`)),
              CV_INIT_TIMEOUT_MS
            )
          ),
        ]).catch((e: any) => {
          console.warn('[FaceCaptureApp] MediaPipe initialization fallback to MockCVEngine:', e);
        });
        // If the timeout above won the race, `initialize()` is still running
        // in the background; swallow whatever it eventually settles with so
        // it doesn't surface as an unhandled promise rejection later.
        initPromise.catch(() => {});
        if (mpCv.isInitialized) {
          mpCv.setSensitivity(sensitivity);
          mediaPipeCvRef.current = mpCv;
        }
      } else {
        mediaPipeCvRef.current.setSensitivity(sensitivity);
      }

      if (!gestureEngineRef.current) {
        const ge = new MediaPipeGestureEngine();
        ge.initialize().catch((e: any) =>
          console.warn('GestureEngine failed to init, MANUAL mode will be unavailable:', e)
        );
        gestureEngineRef.current = ge;
      }

      // Lazy fallback: only actually created if MediaPipe above never
      // initialized — see `mockEngineRef`'s own doc comment for why this
      // exists post-item-8 (it is not simulation mode's old sliders-driven
      // engine, which is gone; this is purely "keep the live pipeline from
      // having nothing at all to drive it").
      if (!mediaPipeCvRef.current?.isInitialized && !mockEngineRef.current) {
        const mockCv = new MockCVEngine({ simulatedDelayMs: 10 });
        mockCv.updateSettings({ detected: false, faceCount: 0 });
        await mockCv.initialize();
        mockEngineRef.current = mockCv;
      }

      const engineToUse =
        mediaPipeCvRef.current && mediaPipeCvRef.current.isInitialized
          ? mediaPipeCvRef.current
          : mockEngineRef.current;

      if (engineToUse) {
        const newLivePipeline = new FramePipeline(engineToUse);
        livePipelineRef.current = newLivePipeline;
        newLivePipeline.onResult(async (state: FaceState, fps: number) => {
          setFaceState(state);
          setCvFps(fps);
          if (liveWorkflowEngineRef.current && isWorkflowStartedRef.current) {
            await liveWorkflowEngineRef.current.processFrame(state);
          }
        });
      }
    } catch (e: any) {
      console.warn('[FaceCaptureApp] CV engine initialization failed, continuing with camera preview only:', e);
    }
  };

  const handleSelectCamera = async (devId: string) => {
    setSelectedDeviceId(devId);
    if (cameraServiceRef.current) {
      try {
        setIsCameraLoading(true);
        const st = await cameraServiceRef.current.start({ deviceId: devId });
        setStream(st);
        setIsCameraLoading(false);
      } catch (err: any) {
        setIsCameraLoading(false);
        setCameraError(`Không thể chuyển sang camera đã chọn: ${err?.message || err}`);
      }
    }
  };


  // Auto-zoom (both the face-size seeking and its digital-crop-based
  // recentring) was removed at the operator's request — it kept fighting
  // real-world framing (tight crops, false FACE_TOO_SMALL at a turned
  // profile, zoom chasing perspective foreshortening as if the subject had
  // moved). Centring is handled by the existing OFF_CENTER quality check
  // instead: the operator physically moves into frame, guided by
  // GuidanceEngine's own instruction text, the same as FACE_TOO_SMALL/
  // FACE_TOO_LARGE already ask them to step closer or back off. The camera
  // now always runs at its native 1x framing — see BrowserCameraService's
  // digital-zoom methods, still there but unused unless something calls them.

  /**
   * Per-frame retake (§ desktop kiosk multi-camera capture, product decision
   * 2026-09-05 #3, second pass): pressing "Chụp lại" on one frame in the
   * review modal must return the operator to a LIVE capture screen showing
   * only that frame — not, as this used to, snapshot a side frame instantly
   * with no gate and no live view (the operator saw nothing happen, and the
   * extended display never went live). `engine.retakeStep()` already does
   * the session bookkeeping (marks the frame CURRENT/PENDING, leaves every
   * other frame's COMPLETED photo untouched); this function's job is putting
   * the UI back into a state where a real trigger can land a real photo:
   * - CENTER: the normal capture-trigger path (shutter/gesture/AUTO) already
   *   handles it unchanged, and that handler's own not-COMPLETED filter
   *   guarantees the fan-out will not re-touch the still-COMPLETED side
   *   frames — see the field regression `SimultaneousRetake.test.ts` covers.
   * - A side frame: has no capture path of its own inside the engine (its
   *   photo comes from a different physical camera than the one the
   *   engine's snapshot provider reads) — `{ externalCapture: true }` tells
   *   the engine so neither its own AUTO auto-fire nor a stray
   *   `triggerManualCapture` call can complete it from the wrong camera;
   *   `captureRetakingSideFrame` is what every trigger mode (shutter,
   *   gesture, and the engine's re-emitted `external-capture-ready` for
   *   AUTO) now routes through instead. See both doc comments for the full
   *   mechanism.
   */
  const handleRetakeStep = async (stepId: string) => {
    const engine = liveWorkflowEngineRef.current;
    if (!engine) return;

    // Post-save retake (2026-09-08): harmless when called from the normal
    // pre-save review (only read inside onAccept's post-save-review branch)
    // — marks that a real retake actually happened this time round, so
    // re-confirming afterwards approves it for real instead of no-op'ing.
    retookSinceReopenRef.current = true;

    const frame = simultaneousCaptureRef.current
      ? framesForWorkflow(activeWorkflowRef.current).find((f) => f.stepId === stepId)
      : null;
    const isSideFrameRetake = !!frame && frame.role !== 'CENTER';

    const started = await engine.retakeStep(stepId, { externalCapture: isSideFrameRetake });
    if (!started) return;

    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;

    if (simultaneousCaptureRef.current && capturePlanRef.current) {
      // Frame streams normally stay open from session start straight through
      // review (nothing closes them until finishSession/cancel/restart — see
      // closeFrameStreams' call sites), but re-open defensively in case one
      // was lost for an unrelated reason: openFrameStreams is idempotent
      // (see its own doc comment), so this is a harmless no-op in the common
      // case and the only thing standing between a lost stream and a side
      // frame that silently never goes live again. Reopens whichever round
      // `stepId` itself belongs to (retakeStep just moved the engine's
      // current step there), not necessarily the round in progress before
      // this retake started.
      const roundIdx = stepRoundIndexRef.current.get(stepId) ?? currentRoundIdxRef.current;
      await openRoundStreams(capturePlanRef.current, roundIdx, cameraRoleMappingRef.current);
    }

    // CB Help (§3.5): show this frame live on the extended display right
    // away. `retakeStep()`'s own 'state-change' emit above already triggers
    // a republish via the live engine's listener, but that dedupes against
    // the session/step key and could be swallowed if this step already
    // looked CURRENT from before review opened — publish explicitly rather
    // than rely on the dedupe not eating it.
    publishCbHelpState();
  };

  const handleRestart = async () => {
    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    // Stop-recording hook (§3.1 fix, 2026-09-05) — see `recordingSessionKey`'s
    // own doc comment. Already null here for a run that reached 'completed'
    // naturally (that handler above already cleared it); a harmless no-op in
    // that case, and the fix for retaking mid-session before 'completed' ever
    // fired. The `startSession` call further down (this restart's own
    // pre-armed session) deliberately does NOT set this key back — same as
    // before this fix, recording only (re)arms from a real
    // `handleStartWorkflow`, once the operator presses Start again.
    //
    // Video cleanup (plan §4, 2026-09-08): a retaken run's video was never
    // approved, so approveSessionUpload() never enqueued it (see that
    // function's own doc comment in uploads.ts) — nothing else will ever
    // reclaim its disk space. Fire-and-forget: a failed discard leaves an
    // orphaned file, a disk-space nag rather than a correctness problem, and
    // must not block the retake itself. `recordingSessionKey` here reads the
    // run being abandoned, not the one this function may go on to start.
    if (recordingSessionKey) {
      const faceAPI = (window as any).faceAPI;
      void faceAPI?.discardSessionVideos?.(recordingSessionKey).catch((err: unknown) => {
        console.warn('[FaceCaptureApp] discardSessionVideos failed:', err);
      });
    }
    setRecordingSessionKey(null);
    reportStatsEvent('RETAKE');
    // CB Help (§3.5): an abandoned run must not leave its last frame/photo
    // showing on the extended display — the fresh session started below (if
    // any) re-publishes for real via the engine's own 'state-change'.
    publishCbHelpState({ phase: 'idle' });
    // "Chụp lại toàn bộ" reaches here before the session has necessarily
    // completed (SessionReviewModal allows reviewing, and retaking
    // everything, from as little as one captured step). Without this, the
    // next run's first capture of each step reuses the abandoned run's
    // sink session id and collides in idemKey space with it — see
    // RunScopedCaptureSession's doc comment for the full mechanism. Already
    // reset (a run that finished naturally clears it via finishSession) is a
    // harmless no-op here.
    runSessionRef.current.reset();
    const activeEngine = liveWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        rejectReason,
        simultaneousCapture: campaignSimultaneous,
        recordVideo: campaignRecordVideo,
      } = await resolveActiveWorkflow(props.campaignConfig);
      setDeviceBlockedReason(blockedReason);
      setDeviceRejectReason(rejectReason);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
      setEffectiveTriggerConfig(triggerConfig);
      captureTriggerRef.current.updateConfig({ mode: triggerConfig.mode, autoHoldMs: triggerConfig.autoHoldMs });
      setRecordVideo(campaignRecordVideo);
      if (!blockedReason) {
        const preparedWorkflow = await runSimultaneousCaptureGate(campaignSimultaneous, workflow);
        if (preparedWorkflow) {
          setActiveWorkflow(preparedWorkflow);
          await activeEngine.startSession(preparedWorkflow);
        }
      } else {
        setActiveWorkflow(workflow);
      }
    }
  };

  /**
   * Post-save retake, "chụp lại toàn bộ" (2026-09-08 plan §3) — the
   * post-save counterpart to `handleRestart`, used only while
   * `isPostSaveReview` is true. Deliberately does NOT reuse `handleRestart`:
   * that function resets `runSessionRef` and calls `activeEngine.startSession`,
   * both of which mint a brand-new session id — exactly what must NOT happen
   * here, since the whole point is that the retaken photos/video land under
   * the SAME session id so the supersede mechanism
   * (`UploadOutboxRepository.supersedeOlderApprovedAttempts`) recognizes them
   * as replacing the earlier approved attempt rather than starting an
   * unrelated run. `runSessionRef` is already pointed at the old session id
   * via `resume()` (see `handleStudentSubmit`'s matching branch) and stays
   * that way — nothing here touches it.
   *
   * Also does not discard the old video the way `handleRestart` does: the
   * old recording is still the currently-approved one until the new
   * recording actually finishes and supersedes it centrally (§4/§5 of the
   * plan) — discarding it here, before a replacement exists, would leave the
   * session with no video at all if the operator backs out.
   */
  const handlePostSaveRetakeAll = () => {
    const engine = liveWorkflowEngineRef.current;
    if (!engine) return;
    const started = engine.retakeAllSteps();
    if (!started) return;

    setShowReviewModal(false);
    setLatestCapturedImage(null);
    setIsWorkflowStarted(true);
    isWorkflowStartedRef.current = true;
    retookSinceReopenRef.current = true;
    reportStatsEvent('RETAKE');

    // Re-arms the SAME video session id this run was already keyed under
    // (see `lastCompletedSessionRef`'s own doc comment) — going from `null`
    // to that id is what the recording effects' own dependency arrays treat
    // as "a session started, begin recording" (see `recordingGate.ts`'s
    // tests), so this alone is enough to resume recording without any other
    // change to those effects.
    if (recordVideo && lastCompletedSessionRef.current) {
      setRecordingSessionKey(lastCompletedSessionRef.current.videoSessionId);
    }

    if (simultaneousCaptureRef.current && capturePlanRef.current) {
      // retakeAllSteps() rewound the engine back to step 0 — round 0.
      currentRoundIdxRef.current = 0;
      void openRoundStreams(capturePlanRef.current, 0, cameraRoleMappingRef.current);
    }

    publishCbHelpState();
  };

  const activeGuidance = liveGuidance;
  const activeEngine = liveWorkflowEngineRef.current;
  const activeSession = activeEngine?.currentSession;

  /**
   * Camera role mapping (§2.1) — which physical camera plays CENTER/LEFT/
   * RIGHT, set once via the desktop app's camera setup screen
   * (`Ctrl/Cmd+Shift+K`). Fetched once on mount; `(window as any).faceAPI`
   * is undefined on the web build, so `cameraRoleMapping` just stays `{}`
   * there and every effect below becomes a no-op — exactly today's
   * single-camera behavior, unchanged.
   */
  const [cameraRoleMapping, setCameraRoleMapping] = useState<Record<string, string>>({});
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    faceAPI?.getCameraRoleMapping?.()
      .then((m: Record<string, string>) => setCameraRoleMapping(m ?? {}))
      .catch(() => {
        /* no bridge, or no mapping saved yet — stay on {} */
      });
  }, []);

  /**
   * The CB Help extended-display window's open/closed state (§3.5) —
   * reflects the "Màn hình mở rộng" toggle button below. Note the window it
   * toggles is no longer a mirror of this whole app (that decision was
   * reversed 2026-09-05): it now shows only the capture frames, live +
   * captured — see `publishCbHelpState` further down for what feeds it, and
   * cbHelpWindow.ts's own doc comment. `toggleCbHelpWindow`/
   * `isCbHelpWindowOpen` only exist under the desktop app's preload bridge,
   * never on the web build, so this stays `false` there and the button
   * itself does not render at all (see `cbHelpButton` below) — same
   * `(window as any).faceAPI` guard pattern as `cameraRoleMapping` above.
   */
  const [cbHelpOpen, setCbHelpOpen] = useState(false);
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    faceAPI?.isCbHelpWindowOpen?.()
      .then((open: boolean) => setCbHelpOpen(!!open))
      .catch(() => {
        /* no bridge — stay closed */
      });
  }, []);

  const handleToggleCbHelp = useCallback(async () => {
    const faceAPI = (window as any).faceAPI;
    try {
      const result = await faceAPI?.toggleCbHelpWindow?.();
      if (result) setCbHelpOpen(!!result.open);
    } catch {
      /* no bridge, or the window failed to open/close — leave state as-is */
    }
  }, []);

  /** Ref mirror of `cameraRoleMapping`, read from `publishCbHelpState` below when it is called from inside the mount-only engine-event handlers (stale-closure concern — same reason `activeWorkflowRef` exists). */
  const cameraRoleMappingRef = useRef<Record<string, string>>({});
  useEffect(() => {
    cameraRoleMappingRef.current = cameraRoleMapping;
  }, [cameraRoleMapping]);

  /** Ref mirror of `selectedDeviceId`, same reason as `cameraRoleMappingRef` above. */
  const selectedDeviceIdRef = useRef<string>('');
  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  /**
   * Ref mirror of `devices` (2026-09-09 fix), same reason as
   * `cameraRoleMappingRef` above — `buildCbHelpFrames` needs to know which
   * role-mapped device ids are ACTUALLY connected right now, the same
   * `devices.some((d) => d.id === ...)` check `isFrameMissingDevice` already
   * does for the main window. Without this, a camera unplugged after
   * `cameraRoleMapping` was set (persisted from an earlier setup session)
   * kept getting forwarded to the CB Help window as a real device id — which
   * then endlessly tried and failed to open it, the "màn extend vẫn lặp lỗi
   * camera" field report this fixes. The main window already avoided this
   * (see `isFrameMissingDevice`'s own doc comment); this brings CB Help's
   * own frame-building up to the same standard instead of blindly trusting
   * a stale role mapping.
   */
  const devicesRef = useRef<CameraDevice[]>([]);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  /**
   * De-dupes the CB Help "step change" publish (see the live engine's
   * `state-change` handler below) against that event's real firing rate —
   * once per processed video frame, many times a second — so only an actual
   * session start or step change reaches the `cbhelp:publish` IPC call, not
   * every frame `processFrame` evaluates.
   */
  const lastCbHelpKeyRef = useRef<string | null>(null);

  /**
   * Publishes a capture-frames snapshot to the CB Help window over the
   * `cbhelp:publish` bridge (§3.5, 2026-09-05 product decision — see
   * cbHelpWindow.ts's own doc comment for what the window shows now: only
   * the capture frames, live + captured, not a mirror of this whole app).
   * Live-mode only — simulation mode has no physical cameras/`deviceId`s for
   * the CB Help window to open a stream against.
   *
   * Reads everything through refs (`activeWorkflowRef`,
   * `simultaneousCaptureRef`, `cameraRoleMappingRef`, `selectedDeviceIdRef`)
   * plus the live engine's own `currentSession`/`currentState`, rather than
   * this component's React state directly — the engine instance itself
   * never goes stale (it is created once and kept in
   * `liveWorkflowEngineRef`), so this stays correct however it's called:
   * from a regular event handler here, or from inside the mount-only
   * effect's engine event listeners below, which would otherwise only ever
   * see the render they were registered on.
   *
   * `opts.phase` picks the CB Help window's presentation mode explicitly —
   * see `CbHelpPublishState.phase`'s own doc comment for what each value
   * means. Omitted (the plain per-frame/per-step republish below) derives it
   * the same way this always has: `'live'` while the engine's own session is
   * RUNNING, `'idle'` otherwise. `'review'`/`'done'` still build `frames`
   * from the engine's session exactly like `'live'` does — a session that
   * just completed (or is COMPLETED and being reviewed/accepted) still holds
   * every step's `capturedImagePath`, `status: 'COMPLETED'`, on
   * `currentSession` until the next `startSession()` overwrites it, so the
   * snapshot is simply "every frame, already completed." Only an explicit
   * `phase: 'idle'` (cancel, restart, or leaving live mode) forces an empty
   * `frames` list regardless of what the engine still holds — an abandoned
   * or restarted run must not leave its last frame/photo showing on the
   * extended display.
   */
  const publishCbHelpState = useCallback(
    (opts?: {
      phase?: 'idle' | 'review' | 'done';
      greeting?: CbHelpGreeting | null;
      /** CCCD-scan NOT_FOUND message (2026-09-09) — see `CbHelpPublishState.errorMessage`'s own doc comment. */
      errorMessage?: string | null;
      /** Post-save "Cảm ơn" overlay (2026-09-09) — see `CbHelpPublishState.thankYou`'s own doc comment. */
      thankYou?: { name: string } | null;
    }) => {
      const faceAPI = (window as any).faceAPI;
      if (!faceAPI?.publishCbHelpState) return; // web build, or no bridge

      // See `cbHelpOverlayRef`'s own doc comment: only touch the sticky
      // greeting/errorMessage/thankYou overlay when the caller explicitly
      // names the field (`in`, not `?.`, so an explicit `{ errorMessage:
      // null }` clear still works) — every other call just republishes
      // whatever is currently set, unchanged.
      if (opts && 'greeting' in opts) cbHelpOverlayRef.current.greeting = opts.greeting ?? null;
      if (opts && 'errorMessage' in opts) cbHelpOverlayRef.current.errorMessage = opts.errorMessage ?? null;
      if (opts && 'thankYou' in opts) cbHelpOverlayRef.current.thankYou = opts.thankYou ?? null;

      const engine = liveWorkflowEngineRef.current;
      const session = engine?.currentSession ?? null;
      // `phase` needs the exact same "sticky until explicitly changed"
      // handling as `greeting`/`errorMessage` above (2026-09-09 bug): the
      // 800ms heartbeat's own bare `publishCbHelpState()` calls (no `opts`
      // at all) used to fall through to `session?.status === 'RUNNING' ?
      // 'live' : 'idle'` unconditionally, which meant the very first
      // heartbeat tick after the 'completed' handler's explicit `{ phase:
      // 'review' }` (session.status is 'COMPLETED', not 'RUNNING') snapped
      // it straight back to 'idle' — wiping the frame grid back to "Chưa có
      // phiên chụp nào đang diễn ra" within under a second, contradicting
      // this function's own doc comment ("review/done still build frames…
      // only an explicit phase: 'idle' forces empty frames"). A genuinely
      // `RUNNING` session always wins outright (a fresh `startSession()` is
      // real news, not staleness to guard against) — only once it is NOT
      // running does a bare call fall back to whatever was last explicitly
      // set, rather than recomputing from scratch.
      if (session?.status === 'RUNNING') {
        cbHelpPhaseOverrideRef.current = null;
      } else if (opts && 'phase' in opts) {
        cbHelpPhaseOverrideRef.current = opts.phase ?? null;
      }
      const phase: 'idle' | 'live' | 'review' | 'done' =
        session?.status === 'RUNNING' ? 'live' : cbHelpPhaseOverrideRef.current ?? 'idle';
      const running = phase === 'live';
      const showFrames = phase !== 'idle';

      const state: CbHelpPublishState = {
        running,
        phase,
        simultaneous: simultaneousCaptureRef.current,
        currentStepId: running ? engine!.currentState.stepId : null,
        frames: showFrames
          ? buildCbHelpFrames(
              activeWorkflowRef.current,
              session,
              engine?.currentState.currentStepIndex ?? 0,
              simultaneousCaptureRef.current,
              cameraRoleMappingRef.current,
              selectedDeviceIdRef.current,
              devicesRef.current
            )
          : [],
        greeting: cbHelpOverlayRef.current.greeting,
        // Item 12b: only meaningful while genuinely live — `captureController`'s
        // own snapshot path (reused here, not a second implementation) already
        // no-ops safely to `null` if the video element isn't ready yet.
        centerPreviewDataUrl: running ? cameraServiceRef.current?.captureBase64Snapshot() ?? null : null,
        errorMessage: cbHelpOverlayRef.current.errorMessage,
        thankYou: cbHelpOverlayRef.current.thankYou,
      };
      void faceAPI.publishCbHelpState(state);
    },
    []
  );

  /**
   * Item 12b (2026-09-09): periodically refreshes `centerPreviewDataUrl`
   * (see that field's own doc comment) independent of step/session-change
   * driven publishes — a single step can run for many seconds (posing,
   * holding), during which nothing else would trigger a republish, leaving
   * CB Help's CENTER tile frozen on a stale still. 800ms is "a few times a
   * second," plenty for an extended-monitor preview without building a real
   * second video pipeline over IPC. Reuses the exact same `publishCbHelpState`
   * every other call site already uses (cheap: one JPEG encode of a frame
   * already being decoded for the live preview, plus one local IPC send),
   * rather than a separate, narrower "just the preview" push path. Runs for
   * the component's whole lifetime now that live is the only mode — no more
   * "leaving live mode" case to gate on (cancel/restart already publish
   * `phase: 'idle'` themselves, which zeroes out `frames`/`centerPreviewDataUrl`
   * on the next tick regardless of this timer).
   */
  useEffect(() => {
    const id = setInterval(() => publishCbHelpState(), 800);
    return () => clearInterval(id);
  }, [publishCbHelpState]);

  /**
   * Unique, currently-plugged-in physical devices behind the CENTER/LEFT/
   * RIGHT role mapping above — decides which of the two video-recording
   * effects below applies. Two roles can point at the same physical device
   * (e.g. C0 covering for a failed C1, see §2.1), so this dedupes by device
   * id rather than counting roles.
   */
  const multiChannelDeviceIds = useMemo(
    () =>
      Array.from(new Set(Object.values(cameraRoleMapping))).filter(
        (id): id is string => !!id && devices.some((d) => d.id === id)
      ),
    [cameraRoleMapping, devices]
  );

  /**
   * Local video recording alongside the session — see
   * docs/plans/multi-camera-device-management-discussion.md §3.1. A
   * self-contained effect, independent of the capture/quality-gate logic
   * elsewhere in this file: it only watches whether the campaign has
   * `recordVideo` on, a session is actually running, and a camera stream
   * exists, and starts/stops a `MediaRecorder` accordingly.
   *
   * Gated via `shouldRecordSingleStream` (recordingGate.ts) on `recordVideo`,
   * `recordingSessionKey`, `stream`, and `multiChannelDeviceIds.length < 2` —
   * see that state's own doc comment for the 2026-09-05 field bug this fixes
   * (a stuck boolean meant a new session's recorder never started while an
   * abandoned session's kept running) and why keying on the session id
   * itself, not a boolean, is the fix: `recordingSessionKey` changing to a
   * genuinely new value is what actually makes this effect's dependency
   * array change and restart, which is the only thing that runs this
   * effect's cleanup (the only place that calls `recorder.stop()` and
   * therefore `faceAPI.endVideoStream()`).
   *
   * Also bounded by a runaway cap (`isRecordingOverCap`): a session left
   * abandoned with no operator action at all — this bug's exact field
   * scenario — still gets its recording stopped, finalized, and logged after
   * `MAX_RECORDING_DURATION_MS`, instead of running until the kiosk quits.
   *
   * No upload path here on purpose — whether video ever leaves the kiosk is
   * still an open question (that doc's §4 #3, and explicitly out of scope
   * per the 2026-09-05 product decision); this only ever writes to local
   * disk.
   *
   * Fallback only: once ≥2 physical cameras are mapped to roles, the
   * multi-channel effect below takes over instead, so this skips out to
   * avoid double-recording whichever camera happens to be active.
   */
  useEffect(() => {
    if (
      !shouldRecordSingleStream({
        recordVideo,
        recordingSessionKey,
        hasStream: !!stream,
        multiChannelDeviceCount: multiChannelDeviceIds.length,
      })
    )
      return;
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.startVideoStream) return; // web build, or no bridge to a desktop main process

    let cancelled = false;
    let recorder: MediaRecorder | null = null;
    let streamId: string | null = null;
    let capTimerId: ReturnType<typeof setInterval> | null = null;
    let livenessTimerId: ReturnType<typeof setInterval> | null = null;
    const chunks: BlobPart[] = [];
    const startedAt = Date.now();
    // Read once, at effect-start: `recordingSessionKey` IS the real session
    // id already (unlike the old `activeSession?.id` read, which could
    // briefly still name the previous run in the gap between arming the
    // flag and the engine actually creating the new session).
    const sessionIdForLog = recordingSessionKey ?? 'unknown';
    // Same key `startVideoStream` below is called with — used to namespace
    // `recordingFailed` so a later session (or the multi-channel effect,
    // which keys by every mapped device id instead) never collides with it.
    const recordingKey = selectedDeviceId || 'default';
    setRecordingFailed((prev) => {
      if (!(recordingKey in prev)) return prev;
      const next = { ...prev };
      delete next[recordingKey];
      return next;
    });
    // §3.10 layer 2 ("Trong phiên") — see recordingLiveness.ts's own header
    // comment. Mutated by `ondataavailable` and the liveness-check interval
    // below; read fresh each check, never stale-closed-over since both live
    // in this same effect closure.
    let liveness = createRecordingLivenessState(Date.now());

    /** Stops the recorder (if still active) and finalizes via `endVideoStream`, logging what happened either way. Idempotent: a recorder already `inactive` (already stopped by the cap, or never started) is a no-op. */
    const stopAndFinalize = (): Promise<void> => {
      if (!recorder || (recorder as MediaRecorder).state === 'inactive') return Promise.resolve();

      const finishedRecorder = recorder;
      const finishedStreamId = streamId;
      return new Promise<void>((resolve) => {
        finishedRecorder.onstop = async () => {
          let files: string[] = [];
          if (finishedStreamId) {
            try {
              const blob = new Blob(chunks, { type: finishedRecorder.mimeType });
              const data = new Uint8Array(await blob.arrayBuffer());
              const result = await faceAPI.endVideoStream({
                streamId: finishedStreamId,
                data,
                durationMs: Date.now() - startedAt,
              });
              // Previously ignored entirely — a `{ ok: false, error }` reply
              // (e.g. the main process's Uint8Array validation, or a disk
              // write failure) used to vanish silently. Surfaced now so a
              // real save failure at least reaches main.log instead of just
              // leaving the capture_streams row unfinalized with no trace of
              // why.
              if (!result?.ok) {
                console.error(`[FaceCaptureApp] video recording failed to save: ${result?.error ?? 'unknown error'}`);
              } else {
                files = [finishedStreamId];
              }
            } catch (err) {
              console.error('[FaceCaptureApp] video recording failed to save:', err);
            }
          }
          console.warn('[FaceCaptureApp] recording stopped', { sessionId: sessionIdForLog, files });
          resolve();
        };
        finishedRecorder.stop();
      });
    };

    void (async () => {
      const mimeType =
        typeof MediaRecorder !== 'undefined'
          ? ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      /** Wires up `ondataavailable`/timeslice identically for the initial start and every liveness-driven restart — see recordingLiveness.ts's header comment. */
      const startRecorder = (targetStream: MediaStream): MediaRecorder => {
        const r = new MediaRecorder(targetStream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: VIDEO_BITRATE_BPS,
        });
        r.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
            liveness = recordLivenessData(liveness, e.data.size, Date.now());
          }
        };
        // `timeslice` (1s) — without this, `ondataavailable` only ever fired
        // once, at `stop()`, so there was no signal at all for the liveness
        // check below to react to (discussion doc §3.10, §7.1 point 6).
        r.start(RECORDING_TIMESLICE_MS);
        return r;
      };

      try {
        const result = await faceAPI.startVideoStream({
          sessionId: sessionIdForLog,
          cameraId: recordingKey,
          mimeType,
        });
        if (cancelled) return;
        streamId = result.streamId;

        recorder = startRecorder(stream!);

        // Runaway-recording cap (2026-09-05 fix) — see `recordingSessionKey`'s
        // own doc comment and recordingGate.ts's `isRecordingOverCap`: a
        // session abandoned with no cancel/complete/restart ever firing must
        // not record forever. Checked periodically rather than a single
        // `setTimeout` so it stays correct even if the tab/process was
        // suspended (e.g. laptop sleep) for part of the interval.
        capTimerId = setInterval(() => {
          if (cancelled || !isRecordingOverCap(startedAt)) return;
          console.warn('[FaceCaptureApp] recording exceeded max duration, stopping', {
            sessionId: sessionIdForLog,
            maxMs: MAX_RECORDING_DURATION_MS,
          });
          if (capTimerId) clearInterval(capTimerId);
          void stopAndFinalize();
          setRecordingSessionKey((current) => (current === recordingSessionKey ? null : current));
        }, 30_000);

        // Byte-liveness monitor (discussion doc §3.10 layer 2) — 3s with no
        // new data attempts one automatic restart on the same stream; a
        // second 3s gap after that marks this channel failed so S5/S6 (once
        // wired — see recordingLiveness.ts) can surface it without cutting
        // the session short (Q23).
        livenessTimerId = setInterval(() => {
          if (cancelled || !recorder || recorder.state === 'inactive') return;
          const check = checkRecordingLiveness(liveness, Date.now());
          liveness = check.state;
          if (check.action === 'RESTART') {
            console.warn('[FaceCaptureApp] recording data gap detected, restarting recorder', {
              sessionId: sessionIdForLog,
              cameraId: recordingKey,
            });
            try {
              const stale = recorder;
              if (stale.state !== 'inactive') stale.stop();
              recorder = startRecorder(stream!);
            } catch (err: any) {
              console.error(
                `[FaceCaptureApp] recording restart failed: ${err?.name}: ${err?.message}`
              );
              setRecordingFailed((prev) => ({ ...prev, [recordingKey]: true }));
            }
          } else if (check.action === 'FAIL') {
            console.error('[FaceCaptureApp] recording appears stalled after restart, marking as failed', {
              sessionId: sessionIdForLog,
              cameraId: recordingKey,
            });
            setRecordingFailed((prev) => ({ ...prev, [recordingKey]: true }));
          }
        }, RECORDING_LIVENESS_CHECK_INTERVAL_MS);
      } catch (err: any) {
        // DOMException (e.g. from MediaRecorder/faceAPI) stringifies to
        // "[object DOMException]" once console output is captured into the
        // kiosk's main.log, so bake name/message into the string itself
        // instead of relying on console's own object formatting.
        console.error(`[FaceCaptureApp] video recording failed to start: ${err?.name}: ${err?.message}`);
      }
    })();

    return () => {
      cancelled = true;
      if (capTimerId) clearInterval(capTimerId);
      if (livenessTimerId) clearInterval(livenessTimerId);
      void stopAndFinalize();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordVideo, stream, recordingSessionKey, multiChannelDeviceIds.length]);

  /**
   * True simultaneous multi-channel recording — see ROADMAP.md's "what's
   * actually left, in order" and
   * docs/plans/multi-camera-device-management-discussion.md §3.1. Takes over
   * from the single-stream effect above once ≥2 physical cameras are mapped
   * to roles: instead of recording only whichever camera the CV pipeline
   * currently has active (chopped into a separate clip every time the active
   * camera switches per step — see the role-switch effect below), this opens
   * one dedicated `MediaStream` + `MediaRecorder` per physical camera and
   * keeps all of them rolling for the whole session.
   *
   * Deliberately opens its own streams via raw `getUserMedia`, entirely
   * independent of `cameraServiceRef.current` (the single active stream the
   * CV/capture pipeline switches per step) — this file's own history of
   * subtle capture-trigger bugs is the reason that pipeline is left
   * untouched here, same rationale as the role-switch effect below. No
   * explicit resolution constraint on purpose: this is process evidence, not
   * the print-quality still (see discussion doc §2.5), so the browser's
   * default is lighter on the same USB/GPU bandwidth the CV stream is
   * already drawing on.
   *
   * Double-open risk: when a mapped role's device is also the CV pipeline's
   * currently-active device, that physical camera would otherwise end up
   * opened twice concurrently — the same kind of USB/driver contention
   * docs/plans/multi-camera-device-management-discussion.md §2.1 already
   * documented hitting with even a single camera. Mitigated two ways below,
   * checked in this order for each channel (2026-09-08, discussion doc
   * §3.10 point 5 — "chỗ còn mở hai lần là Tuần tự + có camera bên được
   * gán"):
   *   1. Simultaneous-capture mode (`simultaneousCapture`): when
   *      `frameStreams` already has a stream open for a device (a side
   *      frame's own always-open stream, see `openFrameStreams`), this
   *      reuses that exact `MediaStream` object — owned and torn down by
   *      `openFrameStreams`/`closeFrameStreams`, not by this effect.
   *   2. Otherwise (sequential mode, or a device `frameStreams` doesn't
   *      have): if this device is `cameraServiceRef.current`'s own active
   *      stream *at the moment this effect starts recording*, this clones
   *      that `MediaStream` (`MediaStream.clone()` — independent tracks
   *      sharing the same underlying camera source, no second
   *      `getUserMedia` call) instead of opening a fresh one. This closes
   *      the exact "Tuần tự + có camera bên được gán" gap the discussion
   *      doc names, but only for the device the CV pipeline happens to be
   *      on when the recording session starts — sequential mode's
   *      role-switch effect (below) keeps moving that pipeline's active
   *      device from step to step for the rest of the session, and a later
   *      switch onto a *different* mapped device this effect already opened
   *      independently is not re-checked. Still needs a real multi-camera
   *      hardware pass (V1-V7, discussion doc §3.10) to confirm in
   *      practice — no display/simulator was available to exercise
   *      `MediaRecorder` against real USB contention while writing this.
   *
   * Gated via `shouldRecordMultiChannel` (recordingGate.ts) on `recordVideo`,
   * `recordingSessionKey`, and `multiChannelDeviceIds.length >= 2` — same
   * 2026-09-05 fix and reasoning as the single-stream effect above:
   * `recordingSessionKey` changing to a genuinely new session id is what
   * makes this effect's dependency array change and restart, which is the
   * only thing that runs this effect's cleanup (the only place that stops
   * every channel's `MediaRecorder` and calls `faceAPI.endVideoStream()` for
   * it) — a plain boolean stuck `true` from an abandoned session used to
   * make that never happen. Also bounded by the same runaway cap
   * (`isRecordingOverCap`) as the single-stream effect, applied per channel.
   */
  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    if (
      !shouldRecordMultiChannel({
        recordVideo,
        recordingSessionKey,
        multiChannelDeviceCount: multiChannelDeviceIds.length,
      }) ||
      !faceAPI?.startVideoStream
    )
      return;

    let cancelled = false;
    const sessionId = recordingSessionKey ?? 'unknown';
    const startedAt = Date.now();
    const channels: Array<{
      deviceId: string;
      mediaStream: MediaStream;
      recorder: MediaRecorder;
      streamId: string;
      chunks: BlobPart[];
      /** Whether this effect opened `mediaStream` itself and must stop its tracks — false for a stream reused from `frameStreamsRef`, which openFrameStreams/closeFrameStreams own instead. True for a CV-pipeline stream reused via `.clone()` (see the loop below): the clone's tracks are independent and this effect must stop them itself. */
      ownsStream: boolean;
      /** §3.10 layer 2 — see recordingLiveness.ts. Mutated in place by `ondataavailable` and the liveness-check interval below. */
      liveness: import('../../lib/recordingLiveness.js').RecordingLivenessState;
    }> = [];
    let capTimerId: ReturnType<typeof setInterval> | null = null;
    let livenessTimerId: ReturnType<typeof setInterval> | null = null;
    // Fresh per session — a device no longer in `multiChannelDeviceIds` this
    // time around must not keep showing a stale failed flag from a previous
    // session.
    setRecordingFailed((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [key, value] of Object.entries(prev)) {
        if (multiChannelDeviceIds.includes(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    /** Stops every channel's recorder (if still active) and finalizes each via `endVideoStream`, then logs the whole session's outcome once. Idempotent per channel. */
    const stopAndFinalizeAll = (): Promise<void> => {
      const stopPromises = channels.map(
        (channel) =>
          new Promise<string | null>((resolve) => {
            const { recorder, mediaStream, streamId, chunks, ownsStream } = channel;
            if (recorder.state === 'inactive') {
              if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
              resolve(null);
              return;
            }
            recorder.onstop = async () => {
              if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
              try {
                const blob = new Blob(chunks, { type: recorder.mimeType });
                const data = new Uint8Array(await blob.arrayBuffer());
                const result = await faceAPI.endVideoStream({ streamId, data, durationMs: Date.now() - startedAt });
                // Same previously-ignored-result fix as the single-stream
                // recorder above.
                if (!result?.ok) {
                  console.error(
                    `[FaceCaptureApp] multi-channel recording failed to save for ${streamId}: ${result?.error ?? 'unknown error'}`
                  );
                  resolve(null);
                } else {
                  resolve(streamId);
                }
              } catch (err) {
                console.error(`[FaceCaptureApp] multi-channel recording failed to save for ${streamId}:`, err);
                resolve(null);
              }
            };
            recorder.stop();
          })
      );
      return Promise.all(stopPromises).then((files) => {
        console.warn('[FaceCaptureApp] recording stopped', {
          sessionId,
          files: files.filter((f): f is string => !!f),
        });
      });
    };

    void (async () => {
      const mimeType =
        typeof MediaRecorder !== 'undefined'
          ? ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      for (const deviceId of multiChannelDeviceIds) {
        try {
          const reusedFrameStream = simultaneousCapture
            ? Object.values(frameStreamsRef.current).find(
                (s) => s.getVideoTracks()[0]?.getSettings().deviceId === deviceId
              ) ?? null
            : null;

          // Double-open fix (discussion doc §3.10 point 5, §7.1 point 6 —
          // "chỗ còn mở hai lần là Tuần tự + có camera bên được gán"): if
          // this device is the CV pipeline's own already-open stream right
          // now, clone it instead of a second `getUserMedia` for the same
          // physical camera — see this effect's own doc comment above for
          // exactly what this does and does not cover.
          const cvService = cameraServiceRef.current;
          const reusedCvStream =
            !reusedFrameStream && cvService?.getSelectedDevice()?.id === deviceId
              ? cvService.getActiveStream()
              : null;

          let mediaStream: MediaStream;
          let ownsStream: boolean;
          if (reusedFrameStream) {
            mediaStream = reusedFrameStream;
            ownsStream = false;
          } else if (reusedCvStream) {
            mediaStream = reusedCvStream.clone();
            ownsStream = true; // a clone's tracks are independent — this effect must stop them itself
          } else {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { deviceId: { exact: deviceId } },
            });
            ownsStream = true;
          }
          if (cancelled) {
            if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
            continue;
          }

          const result = await faceAPI.startVideoStream({ sessionId, cameraId: deviceId, mimeType });
          if (cancelled) {
            if (ownsStream) mediaStream.getTracks().forEach((t) => t.stop());
            continue;
          }

          setRecordingFailed((prev) => {
            if (!(deviceId in prev)) return prev;
            const next = { ...prev };
            delete next[deviceId];
            return next;
          });

          const chunks: BlobPart[] = [];
          const channelEntry: (typeof channels)[number] = {
            deviceId,
            mediaStream,
            // Placeholder — `startChannelRecorder` below assigns the real
            // recorder immediately after; typed non-null so `channels.push`
            // below satisfies the array's element type without an `any`.
            recorder: null as unknown as MediaRecorder,
            streamId: result.streamId,
            chunks,
            ownsStream,
            liveness: createRecordingLivenessState(Date.now()),
          };
          channelEntry.recorder = new MediaRecorder(mediaStream, {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: VIDEO_BITRATE_BPS,
          });
          channelEntry.recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              channelEntry.chunks.push(e.data);
              channelEntry.liveness = recordLivenessData(channelEntry.liveness, e.data.size, Date.now());
            }
          };
          // `timeslice` (1s) — see the single-stream effect's identical
          // comment above; this is what makes the liveness check below
          // possible at all.
          channelEntry.recorder.start(RECORDING_TIMESLICE_MS);
          channels.push(channelEntry);
        } catch (err: any) {
          // Same DOMException-stringification fix as the single-stream
          // recorder above — see the comment there.
          console.error(`[FaceCaptureApp] multi-channel recording failed to start for ${deviceId}: ${err?.name}: ${err?.message}`);
        }
      }

      // Runaway-recording cap (2026-09-05 fix), applied once for the whole
      // multi-channel session — see the single-stream effect's identical
      // mechanism and recordingGate.ts's `isRecordingOverCap` for why.
      if (!cancelled && channels.length > 0) {
        capTimerId = setInterval(() => {
          if (cancelled || !isRecordingOverCap(startedAt)) return;
          console.warn('[FaceCaptureApp] recording exceeded max duration, stopping', {
            sessionId,
            maxMs: MAX_RECORDING_DURATION_MS,
          });
          if (capTimerId) clearInterval(capTimerId);
          void stopAndFinalizeAll();
          setRecordingSessionKey((current) => (current === recordingSessionKey ? null : current));
        }, 30_000);
      }

      // Byte-liveness monitor (discussion doc §3.10 layer 2), applied per
      // channel — same restart-once-then-fail state machine as the
      // single-stream effect above, see recordingLiveness.ts.
      if (!cancelled && channels.length > 0) {
        livenessTimerId = setInterval(() => {
          if (cancelled) return;
          for (const channel of channels) {
            if (channel.recorder.state === 'inactive') continue;
            const check = checkRecordingLiveness(channel.liveness, Date.now());
            channel.liveness = check.state;
            if (check.action === 'RESTART') {
              console.warn('[FaceCaptureApp] multi-channel recording data gap detected, restarting recorder', {
                sessionId,
                cameraId: channel.deviceId,
              });
              try {
                const stale = channel.recorder;
                if (stale.state !== 'inactive') stale.stop();
                const fresh = new MediaRecorder(channel.mediaStream, {
                  ...(mimeType ? { mimeType } : {}),
                  videoBitsPerSecond: VIDEO_BITRATE_BPS,
                });
                fresh.ondataavailable = (e) => {
                  if (e.data.size > 0) {
                    channel.chunks.push(e.data);
                    channel.liveness = recordLivenessData(channel.liveness, e.data.size, Date.now());
                  }
                };
                fresh.start(RECORDING_TIMESLICE_MS);
                channel.recorder = fresh;
              } catch (err: any) {
                console.error(
                  `[FaceCaptureApp] multi-channel recording restart failed for ${channel.deviceId}: ${err?.name}: ${err?.message}`
                );
                setRecordingFailed((prev) => ({ ...prev, [channel.deviceId]: true }));
              }
            } else if (check.action === 'FAIL') {
              console.error(
                '[FaceCaptureApp] multi-channel recording appears stalled after restart, marking as failed',
                { sessionId, cameraId: channel.deviceId }
              );
              setRecordingFailed((prev) => ({ ...prev, [channel.deviceId]: true }));
            }
          }
        }, RECORDING_LIVENESS_CHECK_INTERVAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (capTimerId) clearInterval(capTimerId);
      if (livenessTimerId) clearInterval(livenessTimerId);
      void stopAndFinalizeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordVideo, recordingSessionKey, multiChannelDeviceIds.join(','), simultaneousCapture]);

  /**
   * Switches the active camera to whichever one is mapped to the role the
   * current step needs — see docs/plans/multi-camera-device-management-discussion.md
   * §2.1. This is the entire "use multi-camera instead of turning your head"
   * feature: it reuses `handleSelectCamera` exactly as the manual camera
   * picker already does (same `camera.start({ deviceId })` call,
   * `BrowserCameraService`/`WorkflowEngine`/`StepEvaluator` never learn the
   * difference) — deliberately not a new capture path, to avoid touching
   * the step-evaluation/quality-gate code this file's own history of
   * subtle bugs (see the capture-trigger comments elsewhere here) warns
   * against changing without being able to run the app to verify.
   *
   * FRONT/UP/DOWN stay on CENTER (there is no "up" or "down" camera — those
   * two still need the subject to tilt their head, same as today). LEFT/RIGHT
   * switch to their mapped camera when one exists, so the subject can look
   * straight ahead while that camera captures the side angle instead of
   * turning to face a single camera. No mapping configured (today's common
   * case — no site has 3 physical cameras yet) → this never fires, and the
   * app behaves exactly as it does now. Disabled entirely in simultaneous-
   * capture mode (`simultaneousCapture`): CENTER stays the one analysed/
   * active camera there, and side frames get their own always-open streams
   * instead (see `openFrameStreams`).
   */
  useEffect(() => {
    if (simultaneousCapture) return;
    const role =
      activeGuidance.stepType === 'LEFT' ? 'LEFT' : activeGuidance.stepType === 'RIGHT' ? 'RIGHT' : 'CENTER';
    const mappedDeviceId = cameraRoleMapping[role];
    if (!mappedDeviceId) return;
    if (mappedDeviceId === selectedDeviceId) return;
    if (!devices.some((d) => d.id === mappedDeviceId)) return; // mapped camera not plugged in right now

    void handleSelectCamera(mappedDeviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simultaneousCapture, activeGuidance.stepType, activeGuidance.currentStepIndex, cameraRoleMapping]);

  // Annotated on the callback, not just on stepsList: an object literal returned
  // from an unannotated .map() is checked for assignability only, so a misspelt
  // field is dropped in silence — which is how the step thumbnails were passed
  // under a name StepItem does not have and never rendered.
  const stepsList: StepItem[] = activeWorkflow.steps.map((s, idx): StepItem => {
    const sessionStep = activeSession?.steps.find((st) => st.stepId === s.id);
    const isCompleted = sessionStep?.status === 'COMPLETED' || idx < activeGuidance.currentStepIndex;
    const isCurrent = isWorkflowStarted && idx === activeGuidance.currentStepIndex && !isCompleted;

    return {
      id: s.id,
      label: s.type,
      status: isCompleted
        ? 'COMPLETED'
        : isCurrent
        ? 'CURRENT'
        : sessionStep?.status === 'FAILED'
        ? 'FAILED'
        : 'PENDING',
      imagePath: sessionStep?.capturedImagePath,
    };
  });

  /**
   * Multi-frame simultaneous capture (§ desktop kiosk multi-camera capture)
   * — built only while both the campaign flag and live mode are on;
   * `undefined` otherwise, so GuidedCaptureScreen's two views take their
   * `multiFrame` prop's `undefined` branch and render exactly as they did
   * before this feature existed.
   */
  /**
   * Round planning (§3.1.5): every step's `cameraRole` already carries the
   * *resolved* role (fallback-applied) once `buildRoundPlan` has run — see
   * that function's own doc comment — so a step is only genuinely "missing"
   * here if its resolved role has no mapped, connected camera *right now*
   * (a hot-unplug since the round plan was built). Deliberately NOT
   * `framePreflight.missing`/`.duplicates` any more: those are computed over
   * the WHOLE (round-ordered) step list using each step's raw preference,
   * so two different rounds legitimately reusing the same physical camera —
   * the entire point of round planning — used to read as a "duplicate" and
   * permanently block the shutter. `framePreflight` itself is still computed
   * (`runFramePreflight`) purely for the zero-cameras-mapped blocking panel
   * below, where its semantics are still accurate.
   */
  const isFrameMissingDevice = (role: CameraRole): boolean =>
    role !== 'CENTER' && !devices.some((d) => d.id === cameraRoleMapping[role]);

  const currentRoundFrames = (): FrameSpec[] => {
    const plan = capturePlanRef.current;
    const allFrames = framesForWorkflow(activeWorkflow);
    if (!plan) return allFrames;
    return allFrames.filter((f) => stepRoundIndexRef.current.get(f.stepId) === currentRoundIdxRef.current);
  };

  const multiFrameProp: MultiFrameViewProps | undefined =
    simultaneousCapture
      ? {
          frames: framesForWorkflow(activeWorkflow).map((frame): MultiFrameViewFrame => {
            const sessionStep = activeSession?.steps.find((st) => st.stepId === frame.stepId);
            const stepIdx = activeWorkflow.steps.findIndex((s) => s.id === frame.stepId);
            const isCompleted = sessionStep?.status === 'COMPLETED';
            const isCurrent = isWorkflowStarted && stepIdx === activeGuidance.currentStepIndex && !isCompleted;
            const isMissing = isFrameMissingDevice(frame.role);
            const deviceId = frame.role === 'CENTER' ? selectedDeviceId : cameraRoleMapping[frame.role];
            const deviceLabel = devices.find((d) => d.id === deviceId)?.label ?? null;
            const frameStream = frame.role === 'CENTER' ? stream : frameStreams[frame.stepId] ?? null;
            // 2026-09-05 black-frame fix: a side frame whose camera hasn't
            // actually rendered a real frame yet stays 'PENDING' ("Chờ");
            // once it has, it becomes 'READY' ("Sẵn sàng") — see
            // `frameReadiness`'s own doc comment. CENTER never needs this
            // (its readiness is already covered by the face-quality gate).
            const isReady = frame.role !== 'CENTER' && frameReadiness[frame.stepId] === true;

            return {
              stepId: frame.stepId,
              label: frame.label,
              roleLabel: CAMERA_ROLE_LABELS_VI[frame.role],
              deviceLabel,
              stream: frameStream,
              status: isCompleted
                ? 'COMPLETED'
                : isCurrent
                ? 'CURRENT'
                : sessionStep?.status === 'FAILED'
                ? 'FAILED'
                : isMissing
                // A live stream with no mapped/connected device (today's CENTER
                // case, which keeps showing the main preview's stream regardless
                // of role mapping) reads as "not yet assigned", not "broken" —
                // 'MISSING' is reserved for a tile with no stream to show at all.
                ? frameStream
                  ? 'UNASSIGNED'
                  : 'MISSING'
                : isReady
                ? 'READY'
                : 'PENDING',
              imagePath: sessionStep?.capturedImagePath,
            };
          }),
          // Only the zero-cameras-mapped case still blocks outright
          // (`capturePlanRef.current?.blocked`) — `framePreflight` really is
          // "everything missing" in exactly that case, so it is still an
          // accurate `FramesBlockedPanel` payload there. Every other
          // combination of steps × cameras always produces *some* plan (see
          // `planCaptureRounds`), so this is `null` (panel hidden) for a
          // round-planned session even when it needs multiple rounds.
          blocked: capturePlanRef.current?.blocked ? framePreflight : null,
          // 2026-09-05 black-frame fix, round-scoped 2026-09-08: the shutter
          // (OFF mode) stays disabled until every side frame *of the round
          // currently in progress* is actually rendering — a future round's
          // frames have no stream open yet at all (see `openRoundStreams`),
          // so gating on the WHOLE workflow's frames would permanently
          // disable the shutter the moment a session needs more than one
          // round.
          allSideFramesReady: allSideFramesReady(currentRoundFrames(), frameReadiness),
          notReadyRoleLabel: (() => {
            const role = firstNotReadyFrameRole(currentRoundFrames(), frameReadiness);
            return role ? CAMERA_ROLE_LABELS_VI[role] : null;
          })(),
          onOpenCameraSetup: () => {
            void (window as any).faceAPI?.openCameraSetup?.();
          },
          onRecheck: () => {
            void runFramePreflight(activeWorkflow);
          },
        }
      : undefined;

  /*
   * Item 8 (2026-09-09): "Mô phỏng (Simulation)" / "Live Camera" mode-toggle
   * pill pair removed — live mode is the only mode now, so there is nothing
   * left to toggle. `modeButton` itself is kept (name unchanged — it is a
   * typed prop on DesktopCaptureView/MobileCaptureView) since it still holds
   * the CB Help / Camera Setup buttons below, which were never
   * simulation-specific.
   */
  const modeButton = (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {/*
          Only rendered under the desktop app (this bridge method does not
          exist on the web build) — see cbHelpOpen's own doc comment above.
          Same toggle `Ctrl/Cmd+Shift+H` triggers; kept next to the mode
          toggle group and the Camera Setup affordance (§2.1's
          onOpenCameraSetup below) since both are kiosk-operator-only
          controls, never shown to the person being captured on the web
          build.
        */}
        {Boolean((window as any).faceAPI?.toggleCbHelpWindow) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleToggleCbHelp}
                className={`hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer items-center gap-1.5 shadow-inner ${
                  cbHelpOpen
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Màn hình mở rộng
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" theme={theme}>
              {cbHelpOpen
                ? 'Đóng màn hình mở rộng (Ctrl/Cmd+Shift+H)'
                : 'Mở màn hình mở rộng — hiển thị các khung hình chụp (Ctrl/Cmd+Shift+H)'}
            </TooltipContent>
          </Tooltip>
        )}

        {/*
          Same desktop-only gating as the "Màn hình mở rộng" button above —
          `openCameraSetup` does not exist on the web build. Opens the
          per-angle Camera Setup window (Ctrl/Cmd+Shift+K's own window,
          `CameraSetupScreen.tsx`) without the operator needing to know that
          shortcut — see docs/plans/multi-camera-device-management-discussion.md
          §3.6's "Gán camera cho các góc" decision.

          Deliberately NOT gated on `awaitingStudent` (2026-09-09: briefly
          was, then reverted per explicit follow-up feedback — "tôi cần là
          vẫn action được") — these are operator/admin controls an operator
          legitimately needs before the very first student of the day (initial
          setup) or mid-day for troubleshooting, not just between students.
        */}
        {Boolean((window as any).faceAPI?.openCameraSetup) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => void (window as any).faceAPI?.openCameraSetup?.()}
                className="hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer items-center gap-1.5 shadow-inner bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200"
              >
                <Camera className="w-3.5 h-3.5" />
                Cài đặt camera
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" theme={theme}>
              Gán camera vật lý cho từng góc chụp (Ctrl/Cmd+Shift+K)
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );

  const handleCancelWorkflow = useCallback(async () => {
    setIsWorkflowStarted(false);
    isWorkflowStartedRef.current = false;
    // Stop-recording hook (§3.1 fix, 2026-09-05) — see `recordingSessionKey`'s
    // own doc comment. Same "does not re-arm on this function's own
    // pre-armed startSession" reasoning as handleRestart above.
    //
    // Video cleanup (plan §4, 2026-09-08) — same reasoning as handleRestart's
    // identical block: a cancelled run's video was never approved, so
    // nothing else will ever reclaim its disk space.
    if (recordingSessionKey) {
      const faceAPI = (window as any).faceAPI;
      void faceAPI?.discardSessionVideos?.(recordingSessionKey).catch((err: unknown) => {
        console.warn('[FaceCaptureApp] discardSessionVideos failed:', err);
      });
    }
    setRecordingSessionKey(null);
    setLatestCapturedImage(null);
    // Cancelling abandons a run that has not completed, same as "Chụp lại
    // toàn bộ" in handleRestart — see RunScopedCaptureSession's doc comment
    // for why the next run must not inherit this one's session id.
    runSessionRef.current.reset();
    // Frame streams are the multi-camera equivalent of the session reset
    // above: an abandoned simultaneous-capture run must not leave its side
    // cameras open into whatever comes next.
    closeFrameStreams();
    // CB Help (§3.5): same reasoning as handleRestart's identical call.
    publishCbHelpState({ phase: 'idle' });
    const activeEngine = liveWorkflowEngineRef.current;
    if (activeEngine) {
      const {
        workflow,
        triggerConfig,
        blockedReason,
        rejectReason,
        simultaneousCapture: campaignSimultaneous,
        recordVideo: campaignRecordVideo,
      } = await resolveActiveWorkflow(props.campaignConfig);
      setDeviceBlockedReason(blockedReason);
      setDeviceRejectReason(rejectReason);
      activeEngine.setCaptureTriggerConfig(triggerConfig);
      setEffectiveTriggerConfig(triggerConfig);
      captureTriggerRef.current.updateConfig({ mode: triggerConfig.mode, autoHoldMs: triggerConfig.autoHoldMs });
      setRecordVideo(campaignRecordVideo);
      if (!blockedReason) {
        const preparedWorkflow = await runSimultaneousCaptureGate(campaignSimultaneous, workflow);
        if (preparedWorkflow) {
          setActiveWorkflow(preparedWorkflow);
          await activeEngine.startSession(preparedWorkflow);
        }
      } else {
        setActiveWorkflow(workflow);
      }
    }
    // recordingSessionKey added for the video-discard block above: without it
    // in deps, this callback would memoize on whatever recordingSessionKey
    // was at the FIRST render, and every cancel after that would read that
    // stale (often null) snapshot instead of the run actually being
    // cancelled.
  }, [recordingSessionKey]);

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      {/*
        §3.3's fail-closed verdict — a confirmed rejection, or unreachable for
        over 24h. Deliberately opaque and undismissable, unlike storeError
        below: the whole point is that capture must not proceed, not just be
        flagged while continuing underneath. The 'unauthorized' message is
        reason-specific (see `deviceUnauthorizedMessage`) — 2026-09-08 "kiosk
        3" incident fix: a single undifferentiated message here used to send
        operators looking at campaign expiry when the real cause was a
        rotated device secret.
      */}
      {deviceBlockedReason && (
        <div className="absolute inset-0 z-[200] bg-slate-950/98 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-5xl">🔒</span>
          <h2 className="text-xl font-semibold">Thiết bị đã bị khoá</h2>
          <p className="max-w-md text-sm text-slate-300">
            {deviceBlockedReason === 'unauthorized'
              ? deviceUnauthorizedMessage(deviceRejectReason)
              : 'Không thể liên lạc với hệ thống quản trị trong hơn 24 giờ. Vui lòng kiểm tra kết nối mạng hoặc liên hệ quản trị viên.'}
          </p>
        </div>
      )}
      {/*
        Pre-session identification step — shown whenever no session is in
        flight, including automatically again after one finishes (see
        SessionReviewModal's onAccept below). One z-index below the
        device-blocked overlay above: a blocked device must still win if
        both were ever true at once, which can't really happen in practice
        (blockedReason only surfaces once a session actually tries to start)
        but costs nothing to order correctly.

        Two mutually-exclusive screens depending on which access model this
        build has (see `FaceCaptureAppProps.campaignId`'s own doc comment):
        the kiosk's campaign+login path (2026-09-09, CCCD-scan feature) shows
        `CccdScanWaitingScreen` — `StudentIdEntryScreen`'s manual "nhập mã
        sinh viên" form is fully replaced there, not shown alongside it, per
        the product decision. Every other build (apps/web, the legacy
        per-device-secret desktop path — neither has a CCCD scanner attached)
        keeps the original manual-entry screen (2026-09-07) unchanged.
      */}
      {/*
        Post-save "Cảm ơn" overlay (2026-09-09 product request) — see
        `thankYouStudent`'s own doc comment. Rendered ahead of the CCCD
        screen below on purpose: `awaitingStudent` is still false for this
        whole window, so the two are already mutually exclusive, but this
        keeps that invariant visible here too rather than relying solely on
        state timing.
      */}
      {thankYouStudent && (
        <div className="absolute inset-0 z-[90] bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3 text-center px-8">
          <span className="text-6xl">✅</span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-wide">
            Cảm ơn {thankYouStudent.subjectName || 'bạn'}!
          </h1>
          <p className="text-lg text-slate-400">Hồ sơ ảnh đã được lưu thành công.</p>
        </div>
      )}
      {awaitingStudent && !deviceBlockedReason && (
        props.campaignId && props.authClient ? (
          <CccdScanWaitingScreen
            submitting={studentSubmitting}
            error={studentLookupError}
            onScanResult={(result) => void handleCccdScan(result)}
          />
        ) : (
          <StudentIdEntryScreen
            onSubmit={(code) => void handleStudentSubmit(code)}
            submitting={studentSubmitting}
            error={studentLookupError}
          />
        )
      )}
      {/*
        A capture that was not stored has to be visible while the person is
        still standing there. Discovering it once the session is finished is too
        late to retake anything.
      */}
      {storeError && (
        <div className="absolute top-0 inset-x-0 z-[100] bg-amber-500 text-slate-950 text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 shadow-lg">
          <span>⚠️</span>
          <span>{storeError}</span>
          <button onClick={() => setStoreError(null)} className="ml-2 underline cursor-pointer">
            Ẩn
          </button>
        </div>
      )}
      <GuidedCaptureScreen
        stream={stream}
        zoomScale={digitalZoomScale}
        zoomOrigin={digitalZoomCenter}
        isCameraLoading={isCameraLoading}
        cameraError={cameraError}
        faceState={faceState}
        guidance={activeGuidance}
        steps={stepsList}
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={handleSelectCamera}
        cameraFps={cameraFps}
        cvFps={cvFps}
        stabilityProgress={activeGuidance.status === 'STABILIZING' ? activeGuidance.progress : 0}
        countdownValue={activeGuidance.status === 'COUNTDOWN' ? activeGuidance.countdownValue || 3 : 0}
        showDebugPanel={true}
        // Item 8 (2026-09-09): FaceCaptureApp no longer has its own `mode`
        // state (live is the only mode) — passed as a literal rather than
        // dropped entirely, since GuidedCaptureScreen/DesktopCaptureView's
        // own `mode` prop defaults to `"simulation"` when omitted and still
        // branches on it in a couple of places (e.g. the "no stream yet"
        // placeholder). This preserves exactly the rendering this app
        // already got when its own `mode` state was 'live', its only real
        // value since `switchToSimulationMode` no longer exists to change it.
        mode="live"
        theme={theme}
        onToggleTheme={toggleTheme}
        modeButton={modeButton}
        onCancel={handleCancelWorkflow}
        onStartLive={startLiveMode}
        isWorkflowStarted={isWorkflowStarted}
        onStartWorkflow={handleStartWorkflow}
        onOpenReview={() => setShowReviewModal(true)}
        hasCapturedImages={!!activeSession?.steps.some((st) => st.capturedImagePath)}
        showScreenDebugStats={showScreenDebugStats}
        onToggleShowScreenDebugStats={handleToggleShowScreenDebugStats}
        gestureState={gestureState}
        gestureProgress={gestureProgress}
        onShutterCapture={handleShutterCapture}
        sensitivity={sensitivity}
        onSensitivityChange={handleSensitivityChange}
        captureMode={effectiveTriggerConfig.mode}
        autoHoldMs={effectiveTriggerConfig.autoHoldMs}
        captureModeFromCampaign={effectiveTriggerConfig.fromCampaign}
        onCaptureModeChange={handleCaptureModeChange}
        onAutoHoldMsChange={handleAutoHoldMsChange}
        latestCapturedImage={latestCapturedImage}
        multiFrame={multiFrameProp}
        recordingFailed={recordingFailed}
        // ui-redesign-plan.md S5 left zone. `subject`/photo counts are real,
        // already-available state; `round`/`roundCount` are placeholders
        // (1/1) until planCaptureRounds (lib/multiFrame.ts, §3.1.5) is wired
        // into a live session — see the TODO at runSimultaneousCaptureGate
        // above for exactly what that wiring involves. SubjectInfoBadge
        // itself renders nothing while `subject` is null (no code entered
        // yet), so this is safe to pass unconditionally.
        subjectInfo={{
          subject: currentStudentRef.current,
          round: 1,
          roundCount: 1,
          photoCount: activeSession?.steps.filter((s) => s.status === 'COMPLETED').length ?? 0,
          photoTotal: activeSession?.steps.length ?? activeWorkflow.steps.length,
        }}
        // ui-redesign-plan.md S5 right zone — real "đang chụp"/"đã chụp"
        // data (Q19/Q20) is a later integration pass; this proves the
        // layout renders with the panel's own empty state.
        capturedList={{ current: null, recent: [], onOpenSession: () => {} }}
      />

      {showReviewModal && (
        <SessionReviewModal
          // activeSession is the engine's own live session object — it already
          // has whichever steps have been captured so far. `session` (React
          // state) is only ever set by the 'completed' handler below, so
          // before the last step it stays null and this modal would render
          // nothing at all for the "Xem kết quả" button opened mid-session.
          // Falling back to `session` keeps this working after a session ends
          // and a new one has not started yet (activeSession would be gone).
          session={activeSession ?? session}
          // Same source of truth as the capture views' CameraPreview mirror
          // (product decision 2026-09-05) — the operator posed in front of a
          // mirrored preview, so the review grid must match; the underlying
          // files (and anything exported/uploaded from them) stay unmirrored.
          mirrored={CAPTURE_MIRRORED}
          // Captures are staged (written to disk, queued, but not yet
          // eligible for upload — see queueCapture's own doc comment) the
          // instant each step is shot, long before review. This button is the
          // one place that turns "staged" into "sent": approveUpload releases
          // this run's rows to the existing background UploadWorker, which
          // picks them up completely unchanged from here. Only once that
          // succeeds do we close out the local record and the modal — a
          // failed approval leaves the review open so the operator can retry
          // without losing anything (the photos stay safely staged either
          // way; see approveUpload's own doc comment).
          isAccepting={isAcceptingSession}
          onAccept={async () => {
            // Re-entrancy guard (2026-09-09 field bug) — see `isAcceptingRef`'s
            // own doc comment. A second invocation while one is already
            // running (double-tap, or a retry the operator fires before the
            // button's disabled state has visibly updated) must be a pure
            // no-op, not a second real attempt: the first call may have
            // already released this run's staged photos, and a second
            // `approveUpload` against the same session finds nothing left to
            // approve and throws a spurious "no photos found" error even
            // though the save already succeeded.
            if (isAcceptingRef.current) return;
            isAcceptingRef.current = true;
            setIsAcceptingSession(true);
            try {
            const completedSession = activeSession ?? session;
            if (completedSession && repoRef.current) {
              void repoRef.current.saveSession(completedSession);
            }
            // Per-step context the outbox row itself cannot supply — see
            // ApprovalStepInfo's own doc comment. framesForWorkflow() already
            // resolves the same cameraRole fallback a plain
            // defaultCameraRoleForStepType(step.type) call would, keyed by
            // stepId, so it is reused here rather than duplicated; a step
            // absent from the current workflow (should not happen) still
            // gets a role from the same default function directly.
            const steps: ApprovalStepInfo[] | undefined = completedSession
              ? completedSession.steps.map((s) => {
                  const frame = framesForWorkflow(activeWorkflowRef.current).find(
                    (f) => f.stepId === s.stepId
                  );
                  return {
                    stepId: s.stepId,
                    stepType: s.stepType,
                    cameraRole: frame?.role ?? defaultCameraRoleForStepType(s.stepType),
                    attempt: s.attempts,
                    capturedAt: s.timestamp ? new Date(s.timestamp).toISOString() : undefined,
                  };
                })
              : undefined;
            // Post-save retake (2026-09-08, plan §2): the review was
            // reopened against an already-saved session and the operator
            // confirmed without retaking anything — nothing new is staged,
            // so there is nothing for approve() to release. Calling it
            // anyway would find 0 pending outbox rows and the main process
            // would reject the call (see `RunScopedCaptureSession.approve`'s
            // own doc comment on why it throws rather than no-op'ing).
            // Simply close out as a genuine no-op instead.
            if (isPostSaveReview && !retookSinceReopenRef.current) {
              setShowReviewModal(false);
              setIsPostSaveReview(false);
              setAwaitingStudent(true);
              return;
            }
            const approved = await approveUpload(steps, completedSession?.id);
            if (!approved) return;
            await finishSession();
            // The one true "this session is done" moment — the operator
            // confirmed it and approval actually succeeded, not merely that
            // the last capture step was reached (see this handler's own
            // doc comment on why finishSession lives here, not in the
            // engine's 'completed' handler above).
            reportStatsEvent('SESSION_COMPLETED');
            // CB Help (§3.5, 2026-09-05 second pass): the photos stay on the
            // extended display past acceptance too — only the header moves
            // from "awaiting confirmation" to "done" (see CbHelpFrames.tsx).
            // `finishSession()` above never touches the engine's own
            // session, so it still holds every capturedImagePath this reads.
            publishCbHelpState({ phase: 'done' });
            setShowReviewModal(false);
            // Post-save retake (2026-09-08, plan §1): stash this run so a
            // matching mã SV re-entered before another student uses the
            // kiosk can reopen this exact review instead of starting fresh —
            // see `lastCompletedSessionRef`'s own doc comment. Must read
            // `cachedSessionId` here, before `runSessionRef.current.reset()`
            // below clears it.
            if (completedSession && currentStudentRef.current) {
              lastCompletedSessionRef.current = {
                subjectCode: currentStudentRef.current.subjectCode ?? '',
                subject: currentStudentRef.current,
                session: completedSession,
                outboxSessionId: runSessionRef.current.cachedSessionId ?? completedSession.id,
                videoSessionId: completedSession.id,
                steps,
              };
            }
            // Walk-up-kiosk loop (2026-09-07 product request, requirement
            // #5): one student's session just finished — fall straight back
            // to the "nhập mã sinh viên" step for the next one, instead of
            // leaving the kiosk sitting idle on the closed review screen.
            // Reset the same session-scoped state `handleRestart` resets
            // (1781 above), but deliberately do NOT re-call `startSession`
            // the way that "chụp lại toàn bộ" path does — the next session
            // must wait for a new student to be identified first.
            // `publishCbHelpState({ phase: 'done' })` just above is left in
            // place on purpose: the CB Help window keeps showing this
            // student's photos until the next greeting overwrites it, same
            // "stays visible after the shot" behavior CB Help already has
            // elsewhere in this file.
            setIsWorkflowStarted(false);
            isWorkflowStartedRef.current = false;
            setRecordingSessionKey(null);
            runSessionRef.current.reset();
            setStudentLookupError(null);
            setIsPostSaveReview(false);
            retookSinceReopenRef.current = false;
            // "Cảm ơn" overlay (2026-09-09 product request) — holds the
            // walk-up-kiosk loop's own reset above (everything except
            // `awaitingStudent`) for a fixed window before the screen falls
            // back to "chưa quét căn cước", so the student who just sat for
            // this actually sees a confirmation instead of the screen
            // snapping straight to the next person's waiting state.
            // `awaitingStudent` deliberately stays false for this same
            // window — the CCCD scan screen is gated on it (see its render
            // below), so this doubles as "don't scan a new card while this
            // student's confirmation is still up."
            setThankYouStudent(currentStudentRef.current);
            // Also on the CB Help extended display (2026-09-09, "cảm ơn
            // phải hiển thị trên màn extend") — same overlay, same fixed
            // window, published the sticky way so the 800ms heartbeat can't
            // clear it early (see `cbHelpOverlayRef`'s own doc comment).
            publishCbHelpState({ thankYou: { name: currentStudentRef.current?.subjectName ?? '' } });
            setTimeout(() => {
              setThankYouStudent(null);
              publishCbHelpState({ thankYou: null });
              setAwaitingStudent(true);
            }, THANK_YOU_DURATION_MS);
            } finally {
              isAcceptingRef.current = false;
              setIsAcceptingSession(false);
            }
          }}
          onRetake={isPostSaveReview ? handlePostSaveRetakeAll : handleRestart}
          onRetakeStep={handleRetakeStep}
          onClose={() => setShowReviewModal(false)}
        />
      )}
    </div>
  );
}
