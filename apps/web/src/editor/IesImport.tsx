import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp } from 'lucide-react';
import { updateObject } from '@interiorai/app-state';
import type { CatalogEntry } from '@interiorai/catalog';
import type { SceneObject } from '@interiorai/scene-schema';
import { IesError, parseIes, polarPath, type IesData } from '../ai/ies';
import { useEditorStore } from './context';

/** IES 光域網匯入（FE-LGT-04）：寫回光通量（與聚光燈的光束角），並預覽配光曲線 */
export function IesImport({
  obj,
  entry,
  levelId,
}: {
  obj: SceneObject;
  entry: CatalogEntry;
  levelId: string;
}) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const [d, setD] = useState<(IesData & { file: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const x = parseIes(await f.text());
      setD({ ...x, file: f.name });
      setErr(null);
      const spot = entry.light?.kind === 'spot';
      exec(
        updateObject(levelId, obj.id, {
          light: {
            ...obj.light,
            lumens: Math.min(200_000, x.lumens),
            ...(spot ? { beamDeg: Math.max(5, Math.min(170, x.beamDeg)) } : {}),
          },
        }),
      );
    } catch (e) {
      setErr(e instanceof IesError ? t('ies.invalid') : String(e));
    }
  };
  return (
    <div className="space-y-1 text-xs" data-testid="ies-import">
      <label className="btn w-full cursor-pointer justify-center">
        <FileUp size={14} aria-hidden /> {t('ies.import')}
        <input
          type="file"
          accept=".ies,.IES,text/plain"
          className="sr-only"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
          data-testid="ies-file"
        />
      </label>
      {err && <p className="text-danger">{err}</p>}
      {d && (
        <div className="flex items-center gap-2" data-testid="ies-result">
          <svg
            viewBox="-1.1 -0.1 2.2 1.2"
            className="h-20 w-24 shrink-0"
            role="img"
            aria-label={t('ies.curve')}
          >
            {[0.25, 0.5, 0.75, 1].map((r) => (
              <path
                key={r}
                d={`M${-r},0 A${r},${r} 0 0 0 ${r},0`}
                fill="none"
                stroke="var(--border)"
                strokeWidth={0.01}
              />
            ))}
            <path
              d={polarPath(d)}
              fill="var(--accent)"
              fillOpacity={0.25}
              stroke="var(--accent)"
              strokeWidth={0.02}
            />
          </svg>
          <div className="space-y-0.5 font-mono text-[11px]">
            <p className="truncate" title={d.file}>
              {d.keywords.LUMCAT || d.file}
            </p>
            <p>{t('ies.stats', { lm: d.lumens.toLocaleString(), cd: d.peakCd.toLocaleString() })}</p>
            <p>{t('ies.angles', { beam: d.beamDeg, field: d.fieldDeg })}</p>
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted">{t('ies.hint')}</p>
    </div>
  );
}
