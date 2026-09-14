import * as React from 'react';
import { cn } from '../../lib/utils.js';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 'panel' = solid kiosk surface, 'glass' = translucent blurred panel over live camera views */
  variant?: 'panel' | 'glass';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'panel', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-kiosk-border',
        variant === 'panel' ? 'bg-kiosk-surface' : 'bg-kiosk-surface/70 backdrop-blur-md',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 pt-4 pb-2', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-sm font-semibold tracking-wide text-kiosk-text', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('px-5 pb-5', className)} {...props} />
);
CardContent.displayName = 'CardContent';
