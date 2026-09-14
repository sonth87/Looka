import * as React from 'react';
import { cn } from '../../lib/utils.js';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'default' | 'lg' | 'xl' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-kiosk-accent to-sky-500 text-slate-950 font-semibold shadow-lg shadow-kiosk-accent/20 hover:brightness-110 disabled:from-kiosk-surface-2 disabled:to-kiosk-surface-2 disabled:text-kiosk-text-muted disabled:shadow-none',
  secondary:
    'bg-kiosk-surface-2 text-kiosk-text hover:bg-kiosk-surface-2/80 disabled:opacity-50',
  outline:
    'border border-kiosk-border bg-transparent text-kiosk-text hover:bg-kiosk-surface-2/60 disabled:opacity-50',
  ghost: 'bg-transparent text-kiosk-text-muted hover:bg-kiosk-surface-2/60 hover:text-kiosk-text',
  danger: 'bg-kiosk-danger/90 text-white hover:bg-kiosk-danger disabled:opacity-50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  default: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-base rounded-xl gap-2',
  xl: 'h-16 px-8 text-lg rounded-2xl gap-3',
  icon: 'h-10 w-10 rounded-xl',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kiosk-accent/60',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';
