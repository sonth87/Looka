import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'face-primary': 'hsl(var(--face-primary) / <alpha-value>)',
        'face-success': 'hsl(var(--face-success) / <alpha-value>)',
        'face-warning': 'hsl(var(--face-warning) / <alpha-value>)',
        'face-error': 'hsl(var(--face-error) / <alpha-value>)',
        'face-guide': 'hsl(var(--face-guide) / <alpha-value>)',
        'face-overlay': 'hsl(var(--face-overlay) / <alpha-value>)',
        'kiosk-bg': 'hsl(var(--kiosk-bg) / <alpha-value>)',
        'kiosk-surface': 'hsl(var(--kiosk-surface) / <alpha-value>)',
        'kiosk-surface-2': 'hsl(var(--kiosk-surface-2) / <alpha-value>)',
        'kiosk-border': 'hsl(var(--kiosk-border) / <alpha-value>)',
        'kiosk-text': 'hsl(var(--kiosk-text) / <alpha-value>)',
        'kiosk-text-muted': 'hsl(var(--kiosk-text-muted) / <alpha-value>)',
        'kiosk-accent': 'hsl(var(--kiosk-accent) / <alpha-value>)',
        'kiosk-accent-2': 'hsl(var(--kiosk-accent-2) / <alpha-value>)',
        'kiosk-warning': 'hsl(var(--kiosk-warning) / <alpha-value>)',
        'kiosk-danger': 'hsl(var(--kiosk-danger) / <alpha-value>)',
      },
      animation: {
        'face-pulse': 'face-pulse 2s ease-in-out infinite',
        'capture-flash': 'capture-flash 0.3s ease-out',
      },
      keyframes: {
        'face-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'capture-flash': {
          '0%': { opacity: '1', backgroundColor: '#ffffff' },
          '100%': { opacity: '0' },
        },
      },
    },
  },
} satisfies Config;
