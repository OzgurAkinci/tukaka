import { ShieldCheck } from 'lucide-react';

import Modal, { primaryButtonClass, secondaryButtonClass } from './Modal';

interface ReviewChangesDialogProps {
  title?: string;
  statements: string[];
  applying: boolean;
  error: string | null;
  onApply: () => void;
  onClose: () => void;
}

/**
 * Veritabanına yazmadan önce çalıştırılacak SQL'i gösterir ve onay ister.
 */
export default function ReviewChangesDialog({
  title = 'Review changes',
  statements,
  applying,
  error,
  onApply,
  onClose,
}: ReviewChangesDialogProps) {
  return (
    <Modal
      title={title}
      subtitle={`${statements.length} statement(s) will run in a single transaction`}
      icon={<ShieldCheck size={18} />}
      onClose={onClose}
      widthClass="max-w-[760px]"
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            disabled={applying}
            onClick={onApply}
            className={primaryButtonClass}
          >
            {applying ? 'Applying…' : 'Apply changes'}
          </button>
        </>
      }
    >
      <div className="space-y-3 p-5">
        <p className="text-xs text-gray-400">
          If any statement fails, or an update/delete does not affect exactly one
          row, everything is rolled back.
        </p>

        <pre className="max-h-[45vh] overflow-auto rounded-md border border-(--c-2b303b) bg-(--c-111318) p-3 font-mono text-[11px] leading-relaxed text-gray-200 whitespace-pre-wrap break-all">
          {statements.map((statement) => `${statement};`).join('\n')}
        </pre>

        {error && (
          <p className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-400 whitespace-pre-wrap">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
