import React, { useEffect, useState } from 'react';

export interface ShutterFlashOverlayProps {
  trigger: boolean;
  onFlashComplete?: () => void;
}

export const ShutterFlashOverlay: React.FC<ShutterFlashOverlayProps> = ({
  trigger,
  onFlashComplete,
}) => {
  const [opacity, setOpacity] = useState(0);
  const onFlashCompleteRef = React.useRef(onFlashComplete);
  onFlashCompleteRef.current = onFlashComplete;

  useEffect(() => {
    if (!trigger) {
      setOpacity(0);
      return;
    }

    setOpacity(0.95);
    const timer1 = setTimeout(() => {
      setOpacity(0);
    }, 120);

    const timer2 = setTimeout(() => {
      if (onFlashCompleteRef.current) onFlashCompleteRef.current();
    }, 280);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [trigger]);

  if (opacity === 0) return null;

  return (
    <div
      className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-150 ease-out"
      style={{ opacity }}
    />
  );
};
