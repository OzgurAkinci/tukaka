import { useState } from 'react';
import { Check, FolderPlus, Pencil } from 'lucide-react';

import Modal, {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './Modal';

/** Koleksiyon renk seçenekleri; null varsayılan (tema) rengidir. */
const COLLECTION_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f97316',
  '#f87171',
  '#f472b6',
  '#a78bfa',
  '#2dd4bf',
] as const;

interface CollectionDialogProps {
  mode: 'create' | 'edit';
  initialName?: string;
  initialColor?: string | null;
  onClose: () => void;
  onSave: (value: { name: string; color: string | null }) => Promise<void>;
}

export default function CollectionDialog({
  mode,
  initialName = '',
  initialColor = null,
  onClose,
  onSave,
}: CollectionDialogProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string | null>(initialColor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await onSave({ name: name.trim(), color });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save collection.');
      setSaving(false);
    }
  };

  const swatch = (value: string | null) => {
    const selected = color === value;

    return (
      <button
        key={value ?? 'default'}
        type="button"
        title={value ?? 'Default'}
        aria-label={value ? `Color ${value}` : 'Default color'}
        aria-pressed={selected}
        onClick={() => setColor(value)}
        className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${
          selected
            ? 'border-(--c-e5e7eb) ring-2 ring-blue-500/50'
            : 'border-(--c-343a46) hover:border-(--c-858d9b)'
        }`}
        style={{ backgroundColor: value ?? 'var(--c-4b5563)' }}
      >
        {selected && <Check size={13} className="text-[white]" />}
      </button>
    );
  };

  return (
    <Modal
      title={mode === 'create' ? 'New Collection' : 'Edit Collection'}
      subtitle="Collections group connections in the explorer"
      icon={mode === 'create' ? <FolderPlus size={18} /> : <Pencil size={18} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="submit"
            form="collection-form"
            disabled={saving || !name.trim()}
            className={primaryButtonClass}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id="collection-form"
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className={labelClass} htmlFor="collection-name">
            Name
          </label>
          <input
            id="collection-name"
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Production"
            className={inputClass}
          />
        </div>

        <div>
          <span className={labelClass}>Color</span>
          <div className="flex flex-wrap gap-2">
            {swatch(null)}
            {COLLECTION_COLORS.map((value) => swatch(value))}
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </Modal>
  );
}
