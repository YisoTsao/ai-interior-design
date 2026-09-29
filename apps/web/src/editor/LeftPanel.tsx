import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import { DoorOpen, Hand, Magnet, MousePointer2, PenLine, Square, AppWindow } from 'lucide-react';
import { activeLevel, type Tool } from '@interiorai/app-state';
import type { CatalogEntry } from '@interiorai/catalog';
import { catalog } from '../catalogData';
import { IconButton } from './common';
import { useEditor, useEditorStore } from './context';

const TOOLS: { tool: Tool; icon: typeof MousePointer2; key: string }[] = [
  { tool: 'select', icon: MousePointer2, key: 'tools.select' },
  { tool: 'wall', icon: PenLine, key: 'tools.wall' },
  { tool: 'rect', icon: Square, key: 'tools.rect' },
  { tool: 'door', icon: DoorOpen, key: 'tools.door' },
  { tool: 'window', icon: AppWindow, key: 'tools.window' },
  { tool: 'pan', icon: Hand, key: 'tools.pan' },
];
const CATS: CatalogEntry['category'][] = [
  'living',
  'dining',
  'bedroom',
  'kitchen',
  'bathroom',
  'office',
  'storage',
  'entry',
  'lighting',
  'decor',
  'openings',
];

export function LeftPanel() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const layers = useEditor((s) => s.layers);
  const snapOn = useEditor((s) => s.snapEnabled);
  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-border bg-surface"
      aria-label={t('tools.title')}
    >
      <section className="border-b border-border p-3">
        <h2 className="panel-title mb-2">{t('tools.title')}</h2>
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label={t('tools.title')}>
          {TOOLS.map(({ tool: tl, icon: Icon, key }) => (
            <IconButton
              key={tl}
              label={t(key)}
              pressed={tool === tl}
              disabled={view === '3d' && tl !== 'select'}
              onClick={() => store.getState().setTool(tl)}
              testId={`tool-${tl}`}
            >
              <Icon size={18} aria-hidden />
            </IconButton>
          ))}
        </div>
        <h2 className="panel-title mt-3 mb-1">{t('layers.title')}</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {(['structure', 'furniture', 'annotation'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={layers[k]} onChange={() => store.getState().toggleLayer(k)} />{' '}
              {t(`layers.${k}`)}
            </label>
          ))}
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={snapOn}
              onChange={(e) => store.getState().setSnap(e.target.checked)}
            />
            <Magnet size={12} aria-hidden /> {t('layers.snap')}
          </label>
        </div>
      </section>
      <Tabs.Root defaultValue="assets" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex border-b border-border text-sm" aria-label={t('assets.title')}>
          <Tabs.Trigger
            value="assets"
            className="flex-1 px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary"
          >
            {t('assets.title')}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="outline"
            className="flex-1 px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary"
            data-testid="tab-outline"
          >
            {t('outline.title')}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="assets" className="min-h-0 flex-1 overflow-y-auto p-3">
          <AssetLibrary />
        </Tabs.Content>
        <Tabs.Content value="outline" className="min-h-0 flex-1 overflow-y-auto p-3">
          <Outline />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

function AssetLibrary() {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const placeId = useEditor((s) => s.placeCatalogId);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CatalogEntry['category'] | null>(null);
  const list = useMemo(() => catalog.search({ text: q, category: cat ?? undefined }), [q, cat]);
  const pick = (e: CatalogEntry) => {
    const s = store.getState();
    if (e.model.kind === 'parametric' && (e.model.type === 'door' || e.model.type === 'window'))
      s.setTool(e.model.type);
    else s.setTool('place', e.id);
    if (s.view === '3d') s.setView('2d');
  };
  return (
    <div className="space-y-2">
      <input
        className="field w-full"
        type="search"
        placeholder={t('assets.search')}
        aria-label={t('assets.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="asset-search"
      />
      <div className="flex flex-wrap gap-1">
        <button
          className={`rounded-full border px-2 py-0.5 text-xs ${cat === null ? 'border-primary text-primary' : 'border-border'}`}
          aria-pressed={cat === null}
          onClick={() => setCat(null)}
        >
          {t('assets.all')}
        </button>
        {CATS.map((c) => (
          <button
            key={c}
            className={`rounded-full border px-2 py-0.5 text-xs ${cat === c ? 'border-primary text-primary' : 'border-border'}`}
            aria-pressed={cat === c}
            onClick={() => setCat(cat === c ? null : c)}
          >
            {t(`assets.categories.${c}`)}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="space-y-2 py-6 text-center text-xs text-muted">
          <p>{t('assets.empty')}</p>
          <button
            className="btn"
            onClick={() => {
              setQ('');
              setCat(null);
            }}
          >
            {t('assets.clear')}
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2" data-testid="asset-list">
          {list.map((e) => {
            const nm = i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh;
            return (
              <li key={e.id}>
                <button
                  className={`flex w-full flex-col items-start rounded-lg border p-2 text-left text-xs hover:bg-bg ${placeId === e.id ? 'border-primary' : 'border-border'}`}
                  aria-label={t('assets.place', { name: nm })}
                  draggable
                  onDragStart={(ev) => ev.dataTransfer.setData('application/x-interiorai-catalog', e.id)}
                  onClick={() => pick(e)}
                  data-testid={`asset-${e.id}`}
                >
                  <span
                    className="mb-1 block h-10 w-full rounded bg-bg"
                    aria-hidden
                    style={{ background: `linear-gradient(135deg, var(--object), var(--floor))` }}
                  />
                  <span className="line-clamp-1 font-medium">{nm}</span>
                  <span className="font-mono text-[10px] text-muted">
                    {t('assets.size', { w: e.dimsMm.w, d: e.dimsMm.d, h: e.dimsMm.h })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 物件清單：畫布操作的鍵盤/讀屏等價路徑（02 §9） */
function Outline() {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const selection = useEditor((s) => s.selection);
  const level = activeLevel({ scene, levelId });
  const item = (id: string, label: string) => (
    <li key={id}>
      <button
        className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-bg ${selection.includes(id) ? 'bg-primary text-primary-fg' : ''}`}
        aria-pressed={selection.includes(id)}
        onClick={(e) => store.getState().select([id], e.shiftKey)}
      >
        {label}
      </button>
    </li>
  );
  if (!level.walls.length && !level.objects.length)
    return <p className="text-xs text-muted">{t('outline.empty')}</p>;
  return (
    <nav className="space-y-3" aria-label={t('outline.title')} data-testid="outline">
      <section>
        <h3 className="panel-title mb-1">{t('outline.rooms')}</h3>
        <ul>{level.rooms.map((r) => item(r.id, r.label || t('room.unnamed')))}</ul>
      </section>
      <section>
        <h3 className="panel-title mb-1">{t('outline.walls')}</h3>
        <ul>{level.walls.map((w, i) => item(w.id, t('outline.wall', { n: i + 1 })))}</ul>
      </section>
      <section>
        <h3 className="panel-title mb-1">{t('outline.openings')}</h3>
        <ul>
          {level.openings.map((o, i) =>
            item(o.id, t(o.type === 'window' ? 'outline.window' : 'outline.door', { n: i + 1 })),
          )}
        </ul>
      </section>
      <section>
        <h3 className="panel-title mb-1">{t('outline.objects')}</h3>
        <ul>
          {level.objects.map((o) => {
            const e = catalog.get(o.catalogId);
            return item(o.id, (i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? o.catalogId);
          })}
        </ul>
      </section>
    </nav>
  );
}
