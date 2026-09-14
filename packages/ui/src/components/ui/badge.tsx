import * as React from 'react';
import { cn } from '../../lib/utils.js';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-kiosk-accent-2/15 text-kiosk-accent-2 ring-1 ring-kiosk-accent-2/30',
  warning: 'bg-kiosk-warning/15 text-kiosk-warning ring-1 ring-kiosk-warning/30',
  danger: 'bg-kiosk-danger/15 text-kiosk-danger ring-1 ring-kiosk-danger/30',
  info: 'bg-kiosk-accent/15 text-kiosk-accent ring-1 ring-kiosk-accent/30',
  neutral: 'bg-kiosk-surface-2 text-kiosk-text-muted ring-1 ring-kiosk-border',
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'neutral', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    />
  )
);
Badge.displayName = 'Badge';
