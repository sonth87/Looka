import { CAMERA_ROLE_LABELS, CAPTURE_STEP_DEFS, STEP_LABELS, StepType, cameraRoleForStep } from '../captureAngles';

const ALL_STEP_TYPES = Object.keys(CAPTURE_STEP_DEFS) as StepType[];
const MIN_FRAMES = 3;

/**
 * Shared by `CreateCampaignForm` (CampaignList.tsx) and `CampaignSettingsForm`
 * (CampaignDetail.tsx): the 5-angle toggle editor plus the `simultaneousCapture`
 * switch and a read-only preview of what the kiosk screen will show.
 */
export function CaptureFramesEditor({
  enabled,
  onToggle,
  simultaneous,
  onSimultaneousChange,
}: {
  enabled: Set<StepType>;
  onToggle: (type: StepType) => void;
  simultaneous: boolean;
  onSimultaneousChange: (v: boolean) => void;
}) {
  const enabledTypes = ALL_STEP_TYPES.filter((type) => enabled.has(type));
  const count = enabledTypes.length;
  const belowMin = count < MIN_FRAMES;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-500 mb-1">
          Khung hình chụp (FRONT luôn bắt buộc — ảnh chính dùng để in)
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_STEP_TYPES.map((type) => (
            <label
              key={type}
              className={`flex flex-col gap-0.5 text-sm px-2.5 py-1.5 rounded-lg border ${
                enabled.has(type) ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'
              }`}
            >
              <span className={`flex items-center gap-1.5 ${type === 'FRONT' ? 'text-gray-400' : 'text-gray-700'}`}>
                <input
                  type="checkbox"
                  checked={enabled.has(type)}
                  disabled={type === 'FRONT'}
                  onChange={() => onToggle(type)}
                  className="rounded border-gray-300"
                />
                {STEP_LABELS[type]}
              </span>
              <span className="text-xs text-gray-400 pl-5">· {CAMERA_ROLE_LABELS[cameraRoleForStep(type)]}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
          <span className="text-gray-500">
            Đã chọn {count}/{ALL_STEP_TYPES.length} khung hình
          </span>
          {belowMin && <span className="text-red-600 font-medium">Cần tối thiểu {MIN_FRAMES} khung hình</span>}
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={simultaneous}
          onChange={(e) => onSimultaneousChange(e.target.checked)}
          className="rounded border-gray-300 mt-0.5"
        />
        <span>
          <span className="block font-medium text-gray-700">Chụp đồng thời</span>
          <span className="block text-xs text-gray-500">
            Mỗi khung hình cần một camera riêng trên kiosk; kiosk sẽ không cho bắt đầu phiên nếu thiếu camera.
          </span>
        </span>
      </label>

      {count > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Xem trước màn hình kiosk</div>
          <div className="flex gap-2">
            {enabledTypes.map((type) => (
              <div
                key={type}
                className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-center"
              >
                <div className="text-xs font-semibold text-gray-700 truncate">{type}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 truncate">{CAMERA_ROLE_LABELS[cameraRoleForStep(type)]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
