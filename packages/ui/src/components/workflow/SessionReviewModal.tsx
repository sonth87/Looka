import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send, X, CheckCircle2, Download, FolderOpen, ImageOff, Camera } from 'lucide-react';
import { CaptureSession } from '@face/core';
import { cn } from '../../lib/utils.js';
import { CenterShotStrip, ShotCountBadge } from './CenterShotStrip.js';

/** What "Chụp lại" and "Chụp thêm" share on a step tile — each adds only its own hover colour (and, for "Chụp thêm", disabled styling). */
const TILE_ACTION_BUTTON_BASE =
  'absolute inset-x-1.5 bottom-1.5 px-2 py-1.5 rounded-lg bg-slate-950/80 text-slate-100 hover:text-white text-[10px] sm:text-[11px] font-bold border border-slate-700 backdrop-blur-xs shadow-md transition-all active:scale-95 flex items-center justify-center gap-1 cursor-pointer';

/**
 * Multi-shot CENTER camera (desktop kiosk): the center step may hold several
 * photos and the operator picks the best one with the arrow keys. Passed only
 * when the feature is on and the step has at least one shot — see
 * `FaceCaptureApp.tsx`'s `<SessionReviewModal multiShot={...}>`.
 */
export interface SessionReviewMultiShot {
  /** The workflow step the shots belong to (the modal swaps that step's "Chụp lại" for "Chụp thêm"). */
  stepId: string;
  shots: { attempt: number; imagePath: string }[];
  /** Small pre-scaled preview per shot, keyed by `attempt`. A shot without one falls back to its full `imagePath`. */
  thumbnails: Record<number, string>;
  selectedIndex: number;
  /** No further shot may be taken once `shots.length` reaches this. */
  maxShots: number;
  onSelect: (index: number) => void;
  onCaptureMore: () => void;
}

export interface SessionReviewModalProps {
  session: CaptureSession | null;
  onAccept: () => void;
  onRetake: () => void;
  /** Return to live capture on one step, replacing only that step's photo. */
  onRetakeStep: (stepId: string) => void;
  onClose: () => void;
  className?: string;
  /**
   * `onAccept` is mid-flight (2026-09-09 field bug: a kiosk operator's
   * double-tap fired `onAccept` a second time while — or immediately after —
   * the first call's IPC round-trip to `approveSessionUpload` was still
   * settling; the first call had already released this run's staged photos,
   * so the second one legitimately found nothing left to approve and surfaced
   * a scary "no photos found" error even though the save had actually
   * succeeded). Disables the button so a second tap cannot re-enter
   * `onAccept` while one is already in progress, and swaps the label so a
   * slow save reads as "in progress," not "did my tap register at all" —
   * that ambiguity is what invited the second tap in the first place.
   */
  isAccepting?: boolean;
  /** Multi-shot CENTER camera — see `SessionReviewMultiShot`. Absent leaves the modal exactly as it always was. */
  multiShot?: SessionReviewMultiShot;
  /**
   * A capture is still resolving (a shutter press, or the engine's own
   * AUTO/gesture-triggered shot). Disables "Xác nhận & Lưu hồ sơ" — saving
   * mid-shot could approve a session whose newest photo has not landed yet —
   * without changing its label (unlike `isAccepting`, nothing is being saved).
   */
  captureInFlight?: boolean;
}

export const SessionReviewModal: React.FC<SessionReviewModalProps> = ({
  session,
  onAccept,
  onRetake,
  onRetakeStep,
  onClose,
  className,
  isAccepting = false,
  multiShot,
  captureInFlight = false,
}) => {
  const [exportNotice, setExportNotice] = useState<{ path: string; count: number } | null>(null);

  // The modal takes keyboard focus the moment it opens. Enter / the arrow keys
  // are handled by a window-level listener in FaceCaptureApp, which by design
  // stands down while a <button> has focus (the button's own click would fire
  // instead) — and the button that had focus was very often the shutter /
  // "Bắt đầu" button the operator had just clicked with the mouse, now sitting
  // behind this overlay, still focused, silently swallowing every Enter. A
  // non-button focus target (this root, tabIndex -1) removes that trap.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  if (!session) return null;

  const capturedSteps = session.steps.filter((s) => s.capturedImagePath);
  // Reviewing mid-session is allowed, so completeness is read off the photos
  // rather than off the session status, which a running retake reopens.
  const isComplete = capturedSteps.length === session.steps.length;

  const handleRetakeConfirm = () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Bạn có chắc chắn muốn hủy kết quả hiện tại để chụp lại từ đầu không?');
      if (confirmed) {
        onRetake();
      }
    } else {
      onRetake();
    }
  };

  const handleExportNative = async () => {
    if (typeof window === 'undefined') return;
    const faceAPI = (window as any).faceAPI;
    const validImages = capturedSteps.map((s) => ({
      stepId: s.stepId,
      imagePath: s.capturedImagePath!,
    }));

    if (faceAPI?.exportSessionImages) {
      const res = await faceAPI.exportSessionImages({ sessionId: session.id, images: validImages });
      if (res.success && res.exportPath) {
        setExportNotice({ path: res.exportPath, count: res.fileCount || validImages.length });
      } else {
        alert(res.error || 'Xuất ảnh thất bại.');
      }
    } else {
      alert(`Đã lưu ${validImages.length} ảnh trong bộ nhớ phiên làm việc.`);
    }
  };

  const handleOpenFolder = () => {
    if (typeof window === 'undefined') return;
    const faceAPI = (window as any).faceAPI;
    if (exportNotice && faceAPI?.openExportDir) {
      faceAPI.openExportDir(exportNotice.path);
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      // Lets FaceCaptureApp's key handler tell "a button inside this modal" (its
      // own click should fire) from "a stale button behind it" (must not).
      data-session-review-modal=""
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 outline-none',
        className
      )}
    >
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl shadow-2xl max-w-2xl w-full p-4 sm:p-6 space-y-4 sm:space-y-6 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
          <div>
            <h3 className="text-base sm:text-xl font-bold tracking-tight flex items-center gap-2">
              <CheckCircle2 className={cn('w-5 h-5', isComplete ? 'text-emerald-400' : 'text-amber-400')} />
              Kết quả chụp ảnh khuôn mặt
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              {isComplete
                ? 'Vui lòng xem lại chất lượng các góc chụp trước khi hoàn tất.'
                : `Đã chụp ${capturedSteps.length}/${session.steps.length} góc. Bạn có thể chụp lại từng góc bất kỳ lúc nào.`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="Đóng modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Export Notification Toast */}
        {exportNotice && (
          <div className="px-3.5 py-2.5 rounded-2xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between gap-2 shadow-lg animate-in fade-in shrink-0">
            <div className="truncate">
              <span className="font-bold">✓ Đã xuất {exportNotice.count} tệp ảnh ra máy tính:</span>
              <p className="text-[10px] text-emerald-400 font-mono truncate">{exportNotice.path}</p>
            </div>
            <button
              onClick={handleOpenFolder}
              className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 shrink-0 shadow-md cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Mở thư mục
            </button>
          </div>
        )}

        {/* Step Images Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4 overflow-y-auto flex-1 p-1">
          {session.steps.map((step) => (
            <div
              key={step.stepId}
              className="bg-slate-950 rounded-2xl border border-slate-800/80 overflow-hidden flex flex-col p-2 space-y-1.5"
            >
              <div className="aspect-square bg-slate-900 rounded-xl overflow-hidden relative flex items-center justify-center text-slate-600 font-medium">
                {step.capturedImagePath ? (
                  <>
                    <img
                      src={step.capturedImagePath}
                      alt={step.stepType}
                      className="w-full h-full object-cover"
                    />
                    {multiShot && multiShot.stepId === step.stepId ? (
                      <button
                        onClick={multiShot.onCaptureMore}
                        disabled={
                          multiShot.shots.length >= multiShot.maxShots || isAccepting || captureInFlight
                        }
                        className={cn(
                          TILE_ACTION_BUTTON_BASE,
                          'hover:bg-blue-600 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:bg-slate-950/80 disabled:hover:border-slate-700'
                        )}
                        title={
                          multiShot.shots.length >= multiShot.maxShots
                            ? `Đã đạt tối đa ${multiShot.maxShots} ảnh camera giữa`
                            : 'Chụp thêm một ảnh camera giữa (phím Enter)'
                        }
                      >
                        <Camera className="w-3 h-3" />
                        Chụp thêm (Enter)
                      </button>
                    ) : (
                      <button
                        onClick={() => onRetakeStep(step.stepId)}
                        disabled={isAccepting || captureInFlight}
                        className={cn(
                          TILE_ACTION_BUTTON_BASE,
                          'hover:bg-amber-600 hover:border-amber-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:bg-slate-950/80 disabled:hover:border-slate-700'
                        )}
                        title={`Chụp lại góc ${step.stepType}`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        Chụp lại
                      </button>
                    )}
                    {multiShot && multiShot.stepId === step.stepId && multiShot.shots.length > 0 && (
                      <ShotCountBadge
                        selectedIndex={multiShot.selectedIndex}
                        count={multiShot.shots.length}
                        className="absolute top-1.5 right-1.5 px-2 py-0.5 text-[9px] sm:text-[10px] rounded-md border border-blue-400/60 backdrop-blur-xs"
                      />
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-slate-500">
                    <ImageOff className="w-5 h-5" />
                    <span className="text-[10px] sm:text-xs font-semibold">Chưa chụp</span>
                  </div>
                )}
                <span className="absolute top-1.5 left-1.5 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold bg-slate-900/85 text-blue-400 rounded-md border border-slate-700 backdrop-blur-xs">
                  {step.stepType}
                </span>
              </div>

              <div className="flex items-center justify-between text-[10px] sm:text-[11px] px-1 text-slate-400 font-mono">
                {step.capturedImagePath ? (
                  <>
                    <span>Góc: {step.pose?.yaw ?? 0}°</span>
                    <span className="text-emerald-400 font-bold">
                      {step.quality?.overallScore ? `${Math.round(step.quality.overallScore * 100)}%` : 'OK'}
                    </span>
                  </>
                ) : (
                  <>
                    <span>Góc: —</span>
                    <span className="text-slate-600 font-bold">—</span>
                  </>
                )}
              </div>

            </div>
          ))}
        </div>

        {/* Multi-shot CENTER camera: every photo taken so far, the selected one highlighted */}
        {multiShot && multiShot.shots.length >= 2 && (
          <div className="shrink-0 space-y-1.5">
            <p className="text-[11px] sm:text-xs text-slate-400">
              Ảnh camera giữa ({multiShot.shots.length}) — dùng <span className="font-bold text-slate-200">←</span>{' '}
              <span className="font-bold text-slate-200">→</span> để chọn
            </p>
            <CenterShotStrip
              count={multiShot.shots.length}
              // A shot whose small preview is not ready yet falls back to its full image.
              thumbnails={multiShot.shots.map((shot) => multiShot.thumbnails[shot.attempt] ?? shot.imagePath)}
              itemKeys={multiShot.shots.map((shot) => shot.attempt)}
              selectedIndex={multiShot.selectedIndex}
              onSelect={multiShot.onSelect}
              className="gap-2 overflow-x-auto p-1"
              tileClassName="w-20 sm:w-24 rounded-xl"
              imageClassName="aspect-square"
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 sm:gap-3 pt-3 border-t border-slate-800 shrink-0">
          <button
            onClick={handleExportNative}
            disabled={capturedSteps.length === 0}
            className="px-3 sm:px-4 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-700 shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            title="Lưu tất cả ảnh chụp thành tệp PNG ra máy tính"
          >
            <Download className="w-4 h-4 text-sky-400" />
            <span className="hidden sm:inline">Xuất ảnh ra máy tính</span>
            <span className="sm:hidden">Xuất ảnh</span>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={handleRetakeConfirm}
              disabled={isAccepting}
              className="px-3.5 sm:px-4 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-700 shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Chụp lại toàn bộ</span>
              <span className="sm:hidden">Chụp lại</span>
            </button>

            <button
              onClick={onAccept}
              disabled={!isComplete || isAccepting || captureInFlight}
              className="px-4 sm:px-6 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
              title={isComplete ? 'Lưu hồ sơ khuôn mặt' : 'Cần chụp đủ tất cả các góc trước khi lưu hồ sơ'}
            >
              <Send className="w-4 h-4 fill-white" />
              <span className="hidden sm:inline">{isAccepting ? 'Đang lưu...' : 'Xác nhận & Lưu hồ sơ'}</span>
              <span className="sm:hidden">{isAccepting ? 'Đang lưu...' : 'Gửi hồ sơ'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
