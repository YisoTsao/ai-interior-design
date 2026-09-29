import { useTranslation } from 'react-i18next';
import type { Material } from '@interiorai/catalog';
import { materials } from '../catalogData';

/** 材質面板（FR-303）：以 radio 群組呈現，鍵盤可操作 */
export function MaterialPicker({
  label,
  value,
  categories,
  onPick,
  name,
}: {
  label: string;
  value: string | undefined;
  categories: Material['category'][];
  onPick: (id: string) => void;
  name: string;
}) {
  const { i18n } = useTranslation();
  const list = materials.filter((m) => categories.includes(m.category));
  return (
    <fieldset className="text-xs">
      <legend className="mb-1">{label}</legend>
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={label}>
        {list.map((m) => {
          const nm = i18n.language === 'en' ? (m.nameEn ?? m.nameZh) : m.nameZh;
          return (
            <label
              key={m.id}
              className="flex cursor-pointer flex-col items-center gap-0.5 rounded p-1 hover:bg-bg"
              title={nm}
            >
              <input
                type="radio"
                name={name}
                className="sr-only peer"
                checked={value === m.id}
                onChange={() => onPick(m.id)}
                aria-label={nm}
                data-testid={`mat-${name}-${m.id}`}
              />
              <span
                className="h-7 w-7 rounded border-2 border-border peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary"
                style={{ background: m.color }}
                aria-hidden
              />
              <span className="line-clamp-1 w-full text-center text-[10px] text-muted">{nm}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
