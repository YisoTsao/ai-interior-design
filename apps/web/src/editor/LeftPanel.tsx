import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AppWindow,
  DoorOpen,
  Eye,
  EyeOff,
  Hand,
  Lock,
  Magnet,
  MousePointer2,
  PenLine,
  Square,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { activeLevel, updateObject, type Tool } from '@interiorai/app-state';
import type { CatalogEntry } from '@interiorai/catalog';
import { catalog, useCatalogVersion } from '../catalogData';
import { deleteUserAsset, isUserAsset } from '../userAssets';
import { useEditor, useEditorStore } from './context';
import { mergeLook } from './look';
import { useThumbnail } from './thumbs';
import { UploadModelDialog } from './UploadModelDialog';

const TOOLS: { tool: Tool; icon: typeof MousePointer2; key: string; hotkey?: string }[] = [
  { tool: 'select', icon: MousePointer2, key: 'tools.select', hotkey: 'V' },
  { tool: 'wall', icon: PenLine, key: 'tools.wall', hotkey: 'W' },
  { tool: 'rect', icon: Square, key: 'tools.rect' },
  { tool: 'door', icon: DoorOpen, key: 'tools.door', hotkey: 'D' },
  { tool: 'window', icon: AppWindow, key: 'tools.window', hotkey: 'N' },
  { tool: 'pan', icon: Hand, key: 'tools.pan', hotkey: '␣' },
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
/** 分類色（物品欄「稀有度」色條） */
export const CATEGORY_COLOR: Record<CatalogEntry['category'], string> = {
  living: '#f2c14e',
  dining: '#f08a4b',
  bedroom: '#b48cf2',
  kitchen: '#4fd6c8',
  bathroom: '#5aa9f2',
  office: '#7bd389',
  entry: '#c9a27e',
  lighting: '#ffe27a',
  decor: '#f27aa6',
  openings: '#9fb0c6',
  storage: '#d9b36c',
};

export function LeftPanel() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const layers = useEditor((s) => s.layers);
  const snapOn = useEditor((s) => s.snapEnabled);
  return (
    <aside
      className="hud-panel hud-panel-left flex shrink-0 flex-col"
      style={{ width: 300 }}
      aria-label={t('tools.title')}
    >
      <section className="space-y-3 border-b border-border p-3">
        <h2 className="hud-title">{t('tools.title')}</h2>
        <div className="hotbar" role="toolbar" aria-label={t('tools.title')}>
          {TOOLS.map(({ tool: tl, icon: Icon, key, hotkey }) => (
            <button
              key={tl}
              className="hotbar-slot"
              aria-label={t(key)}
              title={t(key)}
              aria-pressed={tool === tl}
              disabled={view === '3d' && tl !== 'select'}
              onClick={() => store.getState().setTool(tl)}
              data-testid={`tool-${tl}`}
            >
              <Icon size={18} aria-hidden />
              {hotkey && (
                <span className="hotbar-key" aria-hidden>
                  {hotkey}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('layers.title')}>
          {(['structure', 'furniture', 'annotation'] as const).map((k) => (
            <button
              key={k}
              className="hud-chip"
              aria-pressed={layers[k]}
              onClick={() => store.getState().toggleLayer(k)}
            >
              {t(`layers.${k}`)}
            </button>
          ))}
          <button
            className="hud-chip inline-flex items-center gap-1"
            aria-pressed={snapOn}
            onClick={() => store.getState().setSnap(!snapOn)}
          >
            <Magnet size={11} aria-hidden /> {t('layers.snap')}
          </button>
        </div>
      </section>
      <Tabs.Root defaultValue="assets" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex border-b border-border" aria-label={t('assets.title')}>
          <Tabs.Trigger value="assets" className="hud-tab">
            {t('assets.title')}
          </Tabs.Trigger>
          <Tabs.Trigger value="outline" className="hud-tab" data-testid="tab-outline">
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
  const { t } = useTranslation();
  const store = useEditorStore();
  const placeId = useEditor((s) => s.placeCatalogId);
  const version = useCatalogVersion();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CatalogEntry['category'] | 'mine' | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  // 家具在前、門窗在最後（CATS 順序）
  const list = useMemo(
    () =>
      (cat === 'mine'
        ? catalog.search({ text: q }).filter(isUserAsset)
        : catalog.search({ text: q, category: cat ?? undefined })
      )
        .map((e, i) => ({ e, i }))
        .sort((a, b) => CATS.indexOf(a.e.category) - CATS.indexOf(b.e.category) || a.i - b.i)
        .map((x) => x.e),
    [q, cat, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const mine = useMemo(() => catalog.all().filter(isUserAsset).length, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (e: CatalogEntry) => {
    const s = store.getState();
    if (e.model.kind === 'parametric' && (e.model.type === 'door' || e.model.type === 'window'))
      s.setTool(e.model.type);
    else s.setTool('place', e.id);
    if (s.view === '3d') s.setView('2d');
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <input
          className="field min-w-0 flex-1"
          type="search"
          placeholder={t('assets.search')}
          aria-label={t('assets.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="asset-search"
        />
        <button
          className="btn px-2"
          onClick={() => setUploadOpen(true)}
          title={t('upload.open')}
          aria-label={t('upload.open')}
          data-testid="upload-open"
        >
          <Upload size={14} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <button className="hud-chip" aria-pressed={cat === null} onClick={() => setCat(null)}>
          {t('assets.all')}
        </button>
        {CATS.map((c) => (
          <button
            key={c}
            className="hud-chip"
            aria-pressed={cat === c}
            onClick={() => setCat(cat === c ? null : c)}
            style={{ borderLeft: `3px solid ${CATEGORY_COLOR[c]}` }}
          >
            {t(`assets.categories.${c}`)}
          </button>
        ))}
        {mine > 0 && (
          <button
            className="hud-chip"
            aria-pressed={cat === 'mine'}
            onClick={() => setCat(cat === 'mine' ? null : 'mine')}
            data-testid="assets-mine"
          >
            {t('assets.mine', { n: mine })}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">{t('assets.count', { n: list.length })}</p>
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
          {list.map((e) => (
            <li key={e.id}>
              <AssetCard entry={e} active={placeId === e.id} onPick={() => pick(e)} />
            </li>
          ))}
        </ul>
      )}
      <UploadModelDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

function AssetCard({
  entry: e,
  active,
  onPick,
}: {
  entry: CatalogEntry;
  active: boolean;
  onPick: () => void;
}) {
  const { t, i18n } = useTranslation();
  const thumb = useThumbnail(e);
  const nm = i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh;
  const user = isUserAsset(e);
  return (
    <div className="relative">
      <button
        className="inv-slot"
        style={{ ['--rarity' as string]: user ? '#4fd6c8' : CATEGORY_COLOR[e.category] }}
        data-active={active}
        aria-label={t('assets.place', { name: nm })}
        draggable
        onDragStart={(ev) => ev.dataTransfer.setData('application/x-interiorai-catalog', e.id)}
        onClick={onPick}
        data-testid={`asset-${e.id}`}
      >
        <span className="inv-badge" aria-hidden>
          {user ? t('assets.userBadge') : t(`assets.categories.${e.category}`)}
        </span>
        <span className="inv-thumb" aria-hidden>
          {thumb ? (
            <img src={thumb} alt="" draggable={false} />
          ) : (
            <span className="h-8 w-8 animate-pulse bg-border" />
          )}
        </span>
        <span className="line-clamp-1 text-xs font-medium">{nm}</span>
        <span className="flex items-center justify-between gap-1">
          <span className="font-mono text-[9px] text-muted">
            {t('assets.size', { w: e.dimsMm.w, d: e.dimsMm.d, h: e.dimsMm.h })}
          </span>
        </span>
        {e.unitPriceTwd !== undefined && (
          <span className="inv-price text-[11px]">
            {t('assets.price', { n: e.unitPriceTwd.toLocaleString() })}
          </span>
        )}
      </button>
      {user && (
        <button
          className="absolute top-1 right-1 rounded bg-black/40 p-1 text-muted hover:text-danger"
          aria-label={t('upload.delete', { name: nm })}
          title={t('upload.delete', { name: nm })}
          onClick={() => {
            if (window.confirm(t('upload.deleteConfirm', { name: nm }))) void deleteUserAsset(e.id);
          }}
        >
          <Trash2 size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** 物件清單：畫布操作的鍵盤/讀屏等價路徑（02 §9）；物件可直接隱藏、鎖定 */
function Outline() {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const selection = useEditor((s) => s.selection);
  const level = activeLevel({ scene, levelId });
  const exec = store.getState().exec;
  const item = (id: string, label: string, extra?: React.ReactNode, dim?: boolean) => (
    <li key={id} className="flex items-center gap-1">
      <button
        className={`min-w-0 flex-1 truncate px-2 py-1 text-left text-xs hover:bg-surface-2 ${selection.includes(id) ? 'bg-primary text-primary-fg' : ''} ${dim ? 'opacity-50' : ''}`}
        aria-pressed={selection.includes(id)}
        onClick={(e) => store.getState().select([id], e.shiftKey)}
      >
        {label}
      </button>
      {extra}
    </li>
  );
  if (!level.walls.length && !level.objects.length)
    return <p className="text-xs text-muted">{t('outline.empty')}</p>;
  const group = (title: string, n: number, children: React.ReactNode) => (
    <section>
      <h3 className="hud-title mb-1 text-[11px]">
        {title} · {n}
      </h3>
      <ul className="space-y-px">{children}</ul>
    </section>
  );
  return (
    <nav className="space-y-3" aria-label={t('outline.title')} data-testid="outline">
      {group(
        t('outline.rooms'),
        level.rooms.length,
        level.rooms.map((r) => item(r.id, r.label || t('room.unnamed'))),
      )}
      {group(
        t('outline.walls'),
        level.walls.length,
        level.walls.map((w, i) =>
          item(w.id, t('outline.wall', { n: i + 1 }), undefined, w.appearance?.hidden),
        ),
      )}
      {group(
        t('outline.openings'),
        level.openings.length,
        level.openings.map((o, i) =>
          item(o.id, t(o.type === 'window' ? 'outline.window' : 'outline.door', { n: i + 1 })),
        ),
      )}
      {group(
        t('outline.objects'),
        level.objects.length,
        level.objects.map((o) => {
          const e = catalog.get(o.catalogId);
          const nm = o.name || ((i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? o.catalogId);
          const hidden = !!o.appearance?.hidden;
          return item(
            o.id,
            nm,
            <>
              <button
                className="icon-btn h-6 w-6"
                aria-label={t(hidden ? 'outline.show' : 'outline.hide', { name: nm })}
                title={t(hidden ? 'outline.show' : 'outline.hide', { name: nm })}
                onClick={() =>
                  exec(
                    updateObject(levelId, o.id, {
                      appearance: mergeLook(o.appearance, { hidden: hidden ? undefined : true }),
                    }),
                  )
                }
              >
                {hidden ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
              </button>
              <button
                className="icon-btn h-6 w-6"
                aria-label={t(o.locked ? 'outline.unlock' : 'outline.lock', { name: nm })}
                title={t(o.locked ? 'outline.unlock' : 'outline.lock', { name: nm })}
                onClick={() => exec(updateObject(levelId, o.id, { locked: o.locked ? undefined : true }))}
              >
                {o.locked ? <Lock size={12} aria-hidden /> : <Unlock size={12} aria-hidden />}
              </button>
            </>,
            hidden,
          );
        }),
      )}
    </nav>
  );
}
