import type { ComponentType } from 'react';

/**
 * Icon-only action button with a hover tooltip (2026-09-07 — replaced text
 * labels on the device table's per-row actions, which crowded the row once
 * there were three of them). Pure CSS hover reveal (Tailwind
 * `group`/`group-hover`), no extra dependency or JS state.
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = 'default',
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'success';
}) {
  const toneClass = {
    default: 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
    primary: 'text-blue-600 hover:text-blue-800 hover:bg-blue-50',
    success: 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50',
  }[tone];

  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${toneClass}`}
      >
        <Icon className="w-4 h-4" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap
          rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity
          group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
