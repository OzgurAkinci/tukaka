import { useState } from 'react';
import { Save } from 'lucide-react';

import Modal, {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './Modal';

interface SaveQueryDialogProps {
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

export default function SaveQueryDialog({
  initialName,
  onClose,
  onSave,
}: SaveQueryDialogProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await onSave(name.trim());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save query.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Save Query"
      subtitle="Saved queries appear in the Queries panel"
      icon={<Save size={18} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="submit"
            form="save-query-form"
            disabled={saving || !name.trim()}
            className={primaryButtonClass}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id="save-query-form"
        className="p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className={labelClass} htmlFor="saved-query-name">
          Name
        </label>
        <input
          id="saved-query-name"
          autoFocus
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </form>
    </Modal>
  );
}
