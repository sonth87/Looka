import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Minus, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { LiquidGlassSvgFilter } from '../theme/LiquidGlassSvgFilter.js';
import { getPanelState, updatePanelState } from '../../lib/settingsStore.js';

export interface DraggablePanelProps {
  storageKey: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
  theme?: 'dark' | 'light';
  isFullscreen?: boolean;
  defaultPosition?: { x: number; y: number };
  defaultCollapsed?: boolean;
  className?: string;
}

export const DraggablePanel: React.FC<DraggablePanelProps> = ({
  storageKey,
  title,
  icon,
  children,
  theme = 'dark',
  isFullscreen = false,
  defaultPosition = { x: 20, y: 75 },
  defaultCollapsed = typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  className,
}) => {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 640;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return defaultPosition;
    const panelState = getPanelState(storageKey);
    return panelState.position || defaultPosition;
  });

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultCollapsed;
    const panelState = getPanelState(storageKey);
    return panelState.collapsed ?? defaultCollapsed;
  });

  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const lastPosRef = useRef(position);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Clamp position so panel always fits strictly inside viewport screen
   */
  const clampPositionToViewport = (pos: { x: number; y: number }) => {
    if (typeof window === 'undefined') return pos;

    const width = panelRef.current?.offsetWidth || (collapsed ? 44 : 288);
    const height = panelRef.current?.offsetHeight || (collapsed ? 44 : 350);

    const maxX = Math.max(10, window.innerWidth - width - 12);
    const maxY = Math.max(10, window.innerHeight - height - 12);

    const clampedX = Math.min(Math.max(10, pos.x), maxX);
    const clampedY = Math.min(Math.max(10, pos.y), maxY);

    return { x: clampedX, y: clampedY };
  };

  /**
   * Automatically re-clamp position immediately after expanding so panel never overflows screen
   */
  useLayoutEffect(() => {
    if (!collapsed && panelRef.current && !isMobile) {
      const rect = panelRef.current.getBoundingClientRect();
      const maxX = Math.max(10, window.innerWidth - rect.width - 12);
      const maxY = Math.max(10, window.innerHeight - rect.height - 12);

      const clampedX = Math.min(Math.max(10, position.x), maxX);
      const clampedY = Math.min(Math.max(10, position.y), maxY);

      if (clampedX !== position.x || clampedY !== position.y) {
        const safePos = { x: clampedX, y: clampedY };
        setPosition(safePos);
        lastPosRef.current = safePos;
        updatePanelState(storageKey, { position: safePos });
      }
    }
  }, [collapsed, storageKey, position.x, position.y, isMobile]);

  const toggleCollapsed = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const nextState = !collapsed;
    setCollapsed(nextState);
    updatePanelState(storageKey, { collapsed: nextState });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!panelRef.current || isMobile) return;
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - lastPosRef.current.x,
      y: e.clientY - lastPosRef.current.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const rawX = ev.clientX - dragOffsetRef.current.x;
      const rawY = ev.clientY - dragOffsetRef.current.y;
      const newPos = clampPositionToViewport({ x: rawX, y: rawY });
      lastPosRef.current = newPos;
      setPosition(newPos);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        updatePanelState(storageKey, { position: lastPosRef.current });
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!panelRef.current || e.touches.length !== 1 || isMobile) return;
    const touch = e.touches[0];
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: touch.clientX - lastPosRef.current.x,
      y: touch.clientY - lastPosRef.current.y,
    };

    const handleTouchMove = (ev: TouchEvent) => {
      if (!isDraggingRef.current || ev.touches.length !== 1) return;
      const t = ev.touches[0];
      const rawX = t.clientX - dragOffsetRef.current.x;
      const rawY = t.clientY - dragOffsetRef.current.y;
      const newPos = clampPositionToViewport({ x: rawX, y: rawY });
      lastPosRef.current = newPos;
      setPosition(newPos);
    };

    const handleTouchEnd = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        updatePanelState(storageKey, { position: lastPosRef.current });
      }
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  };

  useEffect(() => {
    lastPosRef.current = position;
    updatePanelState(storageKey, { position });
  }, [position, storageKey]);

  const liquidGlassStyle: React.CSSProperties = {
    backdropFilter: 'url(#liquid-glass-refraction) blur(18px) saturate(180%)',
    WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(18px) saturate(180%)',
    boxShadow:
      theme === 'dark'
        ? '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0.5px rgba(255,255,255,0.4)'
        : '0 20px 45px rgba(0,0,0,0.08), inset 0 1px 0.5px rgba(255,255,255,0.9)',
  };

  const [sheetHeightVh, setSheetHeightVh] = useState<number>(60);
  const touchStartYRef = useRef<number | null>(null);
  const initialHeightRef = useRef<number>(60);

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartYRef.current = e.touches[0].clientY;
    initialHeightRef.current = sheetHeightVh;
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - touchStartYRef.current;
    const deltaVh = (deltaY / window.innerHeight) * 100;
    const newHeight = Math.min(85, Math.max(25, initialHeightRef.current - deltaVh));
    setSheetHeightVh(newHeight);
  };

  const handleSheetTouchEnd = () => {
    touchStartYRef.current = null;
    if (sheetHeightVh < 35) {
      setCollapsed(true);
      setSheetHeightVh(60);
    }
  };

  // ── Mobile View: Render Bottom Sheet ──
  if (isMobile) {
    const pillLeftClass = storageKey.includes('overlay') ? 'left-3' : 'left-15';

    return (
      <>
        <LiquidGlassSvgFilter />
        {collapsed ? (
          /* Mobile Collapsed: Bottom Trigger Pill FAB */
          <button
            onClick={toggleCollapsed}
            style={liquidGlassStyle}
            className={cn(
              'fixed bottom-3.5 z-50 w-10 h-10 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-90 border backdrop-blur-xl',
              pillLeftClass,
              theme === 'dark'
                ? 'bg-slate-950/70 border-white/30 text-blue-400'
                : 'bg-white/70 border-white/70 text-blue-600'
            )}
            title="Mở Bottom Sheet"
          >
            {icon}
          </button>
        ) : (
          /* Mobile Expanded: Native Bottom Sheet Drawer with Drag-to-Resize */
          <>
            {/* Backdrop Dim */}
            <div
              onClick={toggleCollapsed}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[65] animate-in fade-in duration-200 overscroll-none touch-none"
            />

            {/* Bottom Sheet Modal Container */}
            <div
              style={{
                ...liquidGlassStyle,
                height: `${sheetHeightVh}vh`,
              }}
              className={cn(
                'fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-3xl border-t shadow-2xl transition-all duration-150 overflow-hidden select-none animate-in slide-in-from-bottom duration-300 overscroll-contain',
                theme === 'dark'
                  ? 'bg-slate-950/95 border-white/25 text-slate-100'
                  : 'bg-white/95 border-white/60 text-slate-900'
              )}
            >
              {/* Drag Handle Bar at top of Bottom Sheet (Drag up/down to resize) */}
              <div
                onTouchStart={handleSheetTouchStart}
                onTouchMove={handleSheetTouchMove}
                onTouchEnd={handleSheetTouchEnd}
                onClick={toggleCollapsed}
                className="w-full py-3 flex flex-col justify-center items-center cursor-grab active:cursor-grabbing border-b border-white/10 touch-none select-none shrink-0"
              >
                <div className="w-12 h-1.5 rounded-full bg-white/50 shadow-inner" />
                <span className="text-[10px] text-slate-400 mt-1 font-sans">Kéo để chỉnh độ cao / Vuốt xuống để đóng</span>
              </div>

              {/* Header */}
              <div className="px-4 py-2.5 flex items-center justify-between font-medium border-b border-white/15 shrink-0">
                <div className="flex items-center gap-2 font-sans font-bold">{title}</div>
                <button
                  onClick={toggleCollapsed}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>
              </div>

              {/* Body (Scrollable inside fixed sheet height) */}
              <div className="p-4 overflow-y-auto overscroll-contain flex-1 font-mono text-xs touch-pan-y">
                {children}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // ── Desktop View: Floating Draggable Panel ──
  return (
    <>
      <LiquidGlassSvgFilter />
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 50,
        }}
        className="select-none max-w-[calc(100vw-24px)]"
      >
        {collapsed ? (
          /* Collapsed — Circular Refractive SVG Liquid Glass FAB */
          <button
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onClick={toggleCollapsed}
            title="Mở rộng panel"
            style={liquidGlassStyle}
            className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 cursor-grab active:cursor-grabbing relative overflow-hidden touch-none',
              theme === 'dark'
                ? 'bg-slate-950/40 border border-white/30 text-blue-400 hover:bg-slate-900/50 hover:border-white/50'
                : 'bg-white/45 border border-white/70 text-blue-600 hover:bg-white/65 hover:border-white'
            )}
          >
            {/* Specular sheen gradient overlay */}
            <span className="absolute inset-0 bg-gradient-to-br from-white/35 via-transparent to-black/20 pointer-events-none" />
            <span className="relative z-10">{icon}</span>
          </button>
        ) : (
          /* Expanded — True Refractive SVG Liquid Glass Card Panel */
          <div
            style={liquidGlassStyle}
            className={cn(
              'font-mono text-xs rounded-2xl relative overflow-hidden transition-all duration-300 backdrop-contrast-125 max-w-[calc(100vw-24px)]',
              theme === 'dark'
                ? isFullscreen
                  ? 'bg-slate-950/15 text-slate-100 border border-white/35 shadow-black/80'
                  : 'bg-slate-950/35 text-slate-100 border border-white/25'
                : isFullscreen
                ? 'bg-white/18 text-slate-900 border border-white/80'
                : 'bg-white/40 text-slate-900 border border-white/60',
              className
            )}
          >
            {/* Diagonal Glass Reflection Sheen */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-white/5 pointer-events-none rounded-2xl" />

            {/* Top Specular Edge Highlight Line */}
            <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none" />

            {/* Drag Handle Header with Refractive Bezel */}
            <div
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              className={cn(
                'px-4 py-3 flex items-center justify-between cursor-grab active:cursor-grabbing font-medium transition-colors border-b relative z-10 touch-none',
                theme === 'dark'
                  ? isFullscreen
                    ? 'bg-slate-900/10 border-white/20 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]'
                    : 'bg-slate-900/25 border-white/15 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                  : isFullscreen
                  ? 'bg-white/15 border-white/65 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]'
                  : 'bg-white/25 border-white/50 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
              )}
            >
              <div className="flex items-center gap-2 pointer-events-none">
                {title}
              </div>

              <button
                onClick={toggleCollapsed}
                title="Thu gọn thành nút tròn"
                className={cn(
                  'p-1 rounded-lg transition-all cursor-pointer ml-2 backdrop-blur-sm',
                  theme === 'dark'
                    ? 'text-slate-300 hover:text-white hover:bg-white/15'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-black/10'
                )}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Panel Body */}
            <div className="p-4 relative z-10 overflow-x-auto max-w-[calc(100vw-24px)]">{children}</div>
          </div>
        )}
      </div>
    </>
  );
};
