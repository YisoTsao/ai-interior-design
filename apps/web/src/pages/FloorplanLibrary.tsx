import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { ROOM_KIND_FILL } from '@interiorai/editor-2d';
import { catalog } from '../catalogData';
import { planToSvg } from '../export/plan';
import {
  floorplanScene,
  importedFloorplans,
  importFloorplanDataset,
  sampleFloorplans,
  searchFloorplans,
  type FloorplanEntry,
} from '../floorplans';

/** 戶型庫分頁（FE-PRJ-05）：篩選、清單、預覽；選定後由精靈的「建立」使用 */
export function FloorplanLibrary({
  selected,
  onSelect,
}: {
  selected: FloorplanEntry | null;
  onSelect: (e: FloorplanEntry) => void;
}) {
  const { t } = useTranslation();
  const [imported, setImported] = useState<FloorplanEntry[]>([]);
  const [text, setText] = useState('');
  const [city, setCity] = useState('');
  const [bed, setBed] = useState(0);
  const [pmin, setPmin] = useState('');
  const [pmax, setPmax] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => void importedFloorplans().then(setImported), []);
  const all = useMemo(() => [...imported, ...sampleFloorplans()], [imported]);
  const cities = [...new Set(all.map((e) => e.city).filter((c): c is string => !!c))].sort();
  const list = searchFloorplans(all, {
    text,
    city: city || undefined,
    bed: bed || undefined,
    pingMin: Number(pmin) || undefined,
    pingMax: Number(pmax) || undefined,
  });
  const names = (k: string) => t(`templates.rooms.${k}`);
  const label = (e: FloorplanEntry) =>
    e.source === 'sample'
      ? t('floorplan.sampleName', { layout: t(`templates.${e.template!.id}`), n: e.name.split('-')[1] })
      : e.name;
  const preview = useMemo(() => {
    if (!selected) return null;
    const scene = floorplanScene(selected, names);
    const lv = scene.levels[0]!;
    const svg = planToSvg(lv, catalog, {
      nameOf: (id) => catalog.get(id)?.nameZh ?? id,
      roomFill: (k) => ROOM_KIND_FILL[k ?? 'other'] ?? '#eee',
      dims: true,
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_260px]" data-testid="floorplan-library">
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-1">
          <input
            className="field min-w-0 flex-1"
            type="search"
            placeholder={t('floorplan.search')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t('floorplan.search')}
            data-testid="floorplan-search"
          />
          <select
            className="field"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            aria-label={t('floorplan.city')}
          >
            <option value="">{t('floorplan.allCities')}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="field"
            value={bed}
            onChange={(e) => setBed(Number(e.target.value))}
            aria-label={t('floorplan.bed')}
            data-testid="floorplan-bed"
          >
            <option value={0}>{t('floorplan.anyBed')}</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {t('floorplan.beds', { n: n >= 4 ? '4+' : n })}
              </option>
            ))}
          </select>
          <input
            className="field w-16"
            type="number"
            placeholder={t('floorplan.min')}
            value={pmin}
            onChange={(e) => setPmin(e.target.value)}
            aria-label={t('floorplan.pingMin')}
            data-testid="floorplan-pmin"
          />
          <input
            className="field w-16"
            type="number"
            placeholder={t('floorplan.max')}
            value={pmax}
            onChange={(e) => setPmax(e.target.value)}
            aria-label={t('floorplan.pingMax')}
          />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="floorplan-list">
          {list.map((e) => (
            <li key={e.id}>
              <button
                className={`btn w-full justify-between ${selected?.id === e.id ? 'border-primary text-primary' : ''}`}
                onClick={() => onSelect(e)}
                data-testid={`floorplan-${e.id}`}
              >
                <span className="truncate">
                  {label(e)}
                  {e.community ? ` · ${e.community}` : ''}
                </span>
                <span className="font-mono text-muted">
                  {t('floorplan.summary', { bed: e.bed, living: e.living, bath: e.bath, ping: e.ping })}
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="text-muted">{t('floorplan.none')}</li>}
        </ul>
        <div className="flex items-center gap-2">
          <label className="btn cursor-pointer" title={t('floorplan.importHint')}>
            <Upload size={14} aria-hidden /> {t('floorplan.import')}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = '';
                if (!f) return;
                try {
                  const r = await importFloorplanDataset(await f.text());
                  setMsg(t('floorplan.imported', r));
                  setImported(await importedFloorplans());
                } catch {
                  setMsg(t('floorplan.badFile'));
                }
              }}
            />
          </label>
          {msg && <span className="text-accent">{msg}</span>}
        </div>
        <p className="text-[11px] text-muted">{t('floorplan.note')}</p>
      </div>
      <div
        className="grid min-h-48 place-items-center border border-border bg-white"
        data-testid="floorplan-preview"
      >
        {preview ? (
          <img src={preview} alt={t('floorplan.preview')} className="max-h-72 w-full object-contain" />
        ) : (
          <span className="text-xs text-muted">{t('floorplan.pick')}</span>
        )}
      </div>
    </div>
  );
}
