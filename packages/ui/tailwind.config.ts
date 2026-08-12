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
