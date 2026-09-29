import { useEffect, useId, useState } from 'react';
import { formatLength, parseLength, type LengthUnit } from '@interiorai/editor-2d';

/** 長度欄位：依偏好單位顯示；Enter 提交成一個 Command（02 §4） */
export function LengthField({
  label,
  mm,
  unit,
  onCommit,
  testId,
}: {
  label: string;
  mm: number;
  unit: LengthUnit;
  onCommit: (mm: number) => void;
  testId?: string;
}) {
  const id = useId();
  const shown = formatLength(mm, unit).replace(/\s*(mm|cm|m)$/, '');
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <label htmlFor={id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          id={id}
          className="field w-full"
          value={text}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(shown)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = parseLength(text, unit);
              if (v !== null) onCommit(v);
              else setText(shown);
            } else if (e.key === 'Escape') setText(shown);
          }}
        />
        <span className="text-muted">{unit}</span>
      </span>
    </label>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  suffix,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  suffix?: string;
  testId?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label htmlFor={id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          id={id}
          className="field w-full"
          inputMode="decimal"
          step={step}
          value={text}
          data-testid={testId}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText(String(value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = Number(text);
              if (Number.isFinite(v)) onCommit(v);
              else setText(String(value));
            }
          }}
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span>{label}</span>
      <select id={id} className="field w-full" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
