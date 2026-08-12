import React, { useEffect, useState } from 'react';

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlyingThumbnailProps {
  imageSrc: string | null;
  startRect: RectBounds | null;
  targetRect: RectBounds | null;
  onAnimationEnd?: () => void;
}

export const FlyingThumbnail: React.FC<FlyingThumbnailProps> = ({
  imageSrc,
  startRect,
  targetRect,
  onAnimationEnd,
}) => {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const [visible, setVisible] = useState(false);
  const onAnimationEndRef = React.useRef(onAnimationEnd);
  onAnimationEndRef.current = onAnimationEnd;

  useEffect(() => {
    if (!imageSrc || !startRect || !targetRect) {
      setVisible(false);
      return;
    }

    // 1. Initial State (At Face Oval Center)
    const initialStyle: React.CSSProperties = {
      position: 'fixed',
      left: `${startRect.x}px`,
      top: `${startRect.y}px`,
      width: `${startRect.width}px`,
      height: `${startRect.height}px`,
      objectFit: 'cover',
      borderRadius: '24px',
      border: '3px solid #22c55e',
      boxShadow: '0 20px 25px -5px rgba(34, 197, 94, 0.4), 0 8px 10px -6px rgba(34, 197, 94, 0.2)',
      zIndex: 9999,
      pointerEvents: 'none',
      transform: 'translate(0, 0) scale(1)',
      opacity: 1,
      transition: 'all 550ms cubic-bezier(0.16, 1, 0.3, 1)',
    };

    setStyle(initialStyle);
    setVisible(true);

    // 2. Trigger Flight to Target Step Badge
    const animFrame = requestAnimationFrame(() => {
      const targetX = targetRect.x + targetRect.width / 2 - (startRect.x + startRect.width / 2);
      const targetY = targetRect.y + targetRect.height / 2 - (startRect.y + startRect.height / 2);
      const scaleX = targetRect.width / startRect.width;
      const scaleY = targetRect.height / startRect.height;
      const finalScale = Math.min(scaleX, scaleY) || 0.3;

      setStyle({
        ...initialStyle,
        transform: `translate(${targetX}px, ${targetY}px) scale(${finalScale})`,
        opacity: 0.15,
        borderRadius: '12px',
        border: '2px solid #22c55e',
      });
    });

    const timer = setTimeout(() => {
      setVisible(false);
      if (onAnimationEndRef.current) onAnimationEndRef.current();
    }, 580);

    return () => {
      cancelAnimationFrame(animFrame);
      clearTimeout(timer);
    };
  }, [imageSrc, startRect?.x, startRect?.y, targetRect?.x, targetRect?.y]);

  if (!visible || !imageSrc) return null;

  return (
    <img
      src={imageSrc}
      alt="Flying captured face"
      style={style}
    />
  );
};
