import { useEffect, useState } from 'react';

interface CbHelpStep {
  id: string;
  type: string;
  instruction: string;
}

interface CbHelpCapture {
  stepId: string;
  attempt: number;
  dataUrl: string;
  capturedAt: number;
}

interface CbHelpState {
  steps: CbHelpStep[];
  captures: Record<string, CbHelpCapture>;
}

const EMPTY_STATE: CbHelpState = { steps: [], captures: {} };

/**
 * The secondary, read-only display for CB Help — see
 * docs/plans/multi-camera-device-management-discussion.md §3.5. Mounted
 * instead of `<App />` when this window was opened with the `#cb-help` hash
 * (see main.tsx). Purely a viewer: no button here does anything to the
 * system, which is also why it needs no login — see that doc section's own
 * reasoning about this screen doubling as a public, "nothing hidden here"
 * display.
 */
export default function CbHelpMonitor() {
  const [state, setState] = useState<CbHelpState>(EMPTY_STATE);

  useEffect(() => {
    const faceAPI = (window as any).faceAPI;
    if (!faceAPI?.getCbHelpState) return;

    let cancelled = false;
    faceAPI.getCbHelpState().then((s: CbHelpState) => {
      if (!cancelled) setState(s);
    });

    const unsubscribe = faceAPI.onCbHelpUpdate?.((s: CbHelpState) => setState(s));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const steps = state.steps;
  const latestCapture = Object.values(state.captures).sort((a, b) => b.capturedAt - a.capturedAt)[0];

  return (
    <div className="w-screen h-screen bg-slate-950 text-slate-100 flex flex-col p-10 gap-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-wide">Đang chụp ảnh</h1>
        <p className="text-slate-400 mt-1">Màn hình theo dõi — chỉ xem</p>
      </header>

      <div className="flex-1 flex items-center justify-center">
        {latestCapture ? (
          <img
            src={latestCapture.dataUrl}
            alt="Ảnh vừa chụp"
            className="max-h-[60vh] rounded-2xl border-4 border-slate-800 shadow-2xl"
          />
        ) : (
          <div className="text-slate-500 text-xl">Chưa có ảnh nào được chụp</div>
        )}
      </div>

      {steps.length > 0 && (
        <div className="flex justify-center gap-4 flex-wrap">
          {steps.map((step) => {
            const done = Boolean(state.captures[step.id]);
            return (
              <div
                key={step.id}
                className={`px-6 py-3 rounded-xl text-lg font-semibold border-2 ${
                  done
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400'
                }`}
              >
                {step.type} {done ? '✓' : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
