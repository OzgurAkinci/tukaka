import { useState } from 'react';
import { Settings } from 'lucide-react';

import type { AppSettings } from '../hooks/useSettings';
import Modal, {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './Modal';

interface SettingsDialogProps {
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value) || min));

export default function SettingsDialog({
  settings,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const [maxRows, setMaxRows] = useState(String(settings.maxRows));
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(settings.timeoutSeconds),
  );
  const [pageSize, setPageSize] = useState(String(settings.pageSize));
  const [theme, setTheme] = useState(settings.theme);

  const submit = () => {
    onSave({
      maxRows: clamp(Number(maxRows), 1, 100_000),
      timeoutSeconds: clamp(Number(timeoutSeconds), 1, 600),
      pageSize: clamp(Number(pageSize), 1, 10_000),
      theme,
    });
  };

  return (
    <Modal
      title="Settings"
      subtitle="Stored on this device"
      icon={<Settings size={18} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" form="settings-form" className={primaryButtonClass}>
            Save
          </button>
        </>
      }
    >
      <form
        id="settings-form"
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div>
          <span className={labelClass}>Theme</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
            {(
              [
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['system', 'System'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={`rounded-md border px-3 py-2 text-sm transition ${
                  theme === value
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'border-(--c-343a46) bg-(--c-171b24) text-gray-400 hover:border-(--c-596273)'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="setting-max-rows">
            Query result row limit
          </label>
          <input
            id="setting-max-rows"
            type="number"
            min={1}
            max={100000}
            value={maxRows}
            onChange={(event) => setMaxRows(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] text-(--c-737d8d)">
            Results from the SQL editor are cut off after this many rows (1–100,000).
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="setting-timeout">
            Query timeout (seconds)
          </label>
          <input
            id="setting-timeout"
            type="number"
            min={1}
            max={600}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] text-(--c-737d8d)">
            PostgreSQL and MySQL only (1–600). SQLite queries cannot be interrupted.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="setting-page-size">
            Data viewer page size
          </label>
          <input
            id="setting-page-size"
            type="number"
            min={1}
            max={10000}
            value={pageSize}
            onChange={(event) => setPageSize(event.target.value)}
            className={inputClass}
          />
        </div>
      </form>
    </Modal>
  );
}
