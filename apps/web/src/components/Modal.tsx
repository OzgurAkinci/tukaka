import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}

export default function Modal({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  widthClass = 'max-w-[460px]',
}: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[85vh] w-full ${widthClass} flex-col overflow-hidden rounded-xl border border-(--c-343a46) bg-(--c-1a1e27) shadow-2xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-(--c-2b303b) px-5 py-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                {icon}
              </div>
            )}
            <div>
              <h2 className="text-sm font-semibold text-(--c-e5e7eb)">{title}</h2>
              {subtitle && (
                <p className="mt-0.5 text-xs text-(--c-858d9b)">{subtitle}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-md p-2 text-(--c-858d9b) hover:bg-(--c-2b303b) hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--c-2b303b) bg-(--c-171b24) px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-(--c-343a46) bg-(--c-171b24) px-3 py-2 text-sm text-(--c-d5d8df) outline-none transition focus:border-blue-500';

export const labelClass = 'mb-1.5 block text-xs font-medium text-(--c-9ca3af)';

export const secondaryButtonClass =
  'rounded-md border border-(--c-343a46) px-4 py-2 text-sm text-(--c-aab1bd) hover:bg-(--c-252b36)';

export const primaryButtonClass =
  'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-[white] transition hover:bg-blue-500 disabled:opacity-50';
