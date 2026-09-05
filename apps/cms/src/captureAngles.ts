import type { Campaign } from './api';

export type StepType = 'FRONT' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

/** Physical kiosk camera a capture step maps to when `simultaneousCapture` is on. */
export type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

/**
 * Simple toggle only — matches the "chỉ bật/tắt trong 5 góc có sẵn" option
 * from docs/plans/multi-camera-device-management-discussion.md §3.6 open
 * question #13, not the free-form editor its other option describes. Pose
 * targets/instructions here are a deliberate copy of `defaultWorkflow` in
 * packages/ui/src/components/screens/FaceCaptureApp.tsx — the app already
 * falls back to that exact workflow when a campaign sets no `captureAngles`,
 * so a campaign that enables all 5 here produces the same steps whether or
 * not this form ever touched it.
 *
 * Each def carries an explicit `cameraRole` — the physical kiosk camera it
 * maps to when a campaign turns on `simultaneousCapture` — set to the
 * default role per step type: FRONT→CENTER, LEFT→LEFT, RIGHT→RIGHT,
 * UP→UP, DOWN→DOWN.
 *
 * Shared between `CreateCampaignForm` (CampaignList.tsx) and
 * `CampaignSettingsForm` (CampaignDetail.tsx) via `CaptureFramesEditor`.
 */
export const CAPTURE_STEP_DEFS: Record<StepType, Record<string, unknown>> = {
  FRONT: {
    id: 'step-front',
    type: 'FRONT',
    cameraRole: 'CENTER',
    instruction: 'Nhìn thẳng vào camera',
    pose: { yaw: { target: 0, tolerance: 12 }, pitch: { target: 0, tolerance: 12 }, roll: { target: 0, tolerance: 12 } },
    postureCheck: false,
    capture: { enabled: true },
  },
  LEFT: {
    id: 'step-left',
    type: 'LEFT',
    cameraRole: 'LEFT',
    instruction: 'Quay mặt sang trái (15° - 30°)',
    pose: { yaw: { target: -22.5, tolerance: 7.5 } },
    postureCheck: false,
    capture: { enabled: true },
  },
  RIGHT: {
    id: 'step-right',
    type: 'RIGHT',
    cameraRole: 'RIGHT',
    instruction: 'Quay mặt sang phải (15° - 30°)',
    pose: { yaw: { target: 22.5, tolerance: 7.5 } },
    postureCheck: false,
    capture: { enabled: true },
  },
  UP: {
    id: 'step-up',
    type: 'UP',
    cameraRole: 'UP',
    instruction: 'Ngẩng đầu lên (15° - 35°)',
    pose: { pitch: { target: 25, tolerance: 10 } },
    capture: { enabled: true },
  },
  DOWN: {
    id: 'step-down',
    type: 'DOWN',
    cameraRole: 'DOWN',
    instruction: 'Cúi đầu xuống (15° - 35°)',
    pose: { pitch: { target: -25, tolerance: 10 } },
    capture: { enabled: true },
  },
};

export const STEP_LABELS: Record<StepType, string> = {
  FRONT: 'FRONT — nhìn thẳng',
  LEFT: 'LEFT — quay trái',
  RIGHT: 'RIGHT — quay phải',
  UP: 'UP — ngẩng lên',
  DOWN: 'DOWN — cúi xuống',
};

export const CAMERA_ROLE_LABELS: Record<CameraRole, string> = {
  CENTER: 'Camera giữa',
  LEFT: 'Camera trái',
  RIGHT: 'Camera phải',
  UP: 'Camera trên',
  DOWN: 'Camera dưới',
};

/** The camera role a given step type defaults to (see `CAPTURE_STEP_DEFS`). */
export function cameraRoleForStep(type: StepType): CameraRole {
  return CAPTURE_STEP_DEFS[type].cameraRole as CameraRole;
}

/** Every campaign's declared angles is either empty (app default = all 5) or a subset of the 5 fixed types above — CUSTOM angles aren't offered by this simple toggle editor. */
export function enabledAnglesFromCampaign(campaign: Campaign): Set<StepType> {
  const angles = campaign.captureAngles;
  if (!angles || angles.length === 0) return new Set(Object.keys(CAPTURE_STEP_DEFS) as StepType[]);
  return new Set(angles.map((a) => a.type as StepType).filter((t) => t in CAPTURE_STEP_DEFS));
}
