import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AppWindow,
  DoorOpen,
  Hexagon,
  Spline,
  Info,
  Ruler,
  MoveHorizontal,
  Type,
  Eye,
  EyeOff,
  Hand,
  Lock,
  Magnet,
  MousePointer2,
  PenLine,
  Square,
  SlidersHorizontal,
  Star,
  Trash2,
  Unlock,
  Upload,
  TriangleRight,
  MoveUpRight,
  Hash,
} from 'lucide-react';
import { activeLevel, updateObject, type Tool } from '@interiorai/app-state';
import { materialMap, STYLE_TAGS, type CatalogEntry, type Material } from '@interiorai/catalog';
import { catalog, materials, useCatalogVersion, useMaterials } from '../catalogData';
import { deleteUserMaterial } from '../userMaterials';
import { UploadMaterialDialog } from './UploadMaterialDialog';
import { recordRecent, toggleFavorite, useAssetPrefs } from './assetPrefs';
import { deleteUserAsset, isUserAsset } from '../userAssets';
import { useEditor, useEditorStore } from './context';
import { mergeLook } from './look';
import { useThumbnail } from './thumbs';
import { requestModelUpload } from './uploadRequest';
import { swatchCss } from './swatch';
import { AssetDetail } from './AssetDetail';
import { SetsList } from './SetsList';
import { UserAssetsDialog } from './UserAssetsDialog';
import { dragPayload } from './dragPayload';
import {
  activeFilters,
  brandOf,
  COLOR_FAMILIES,
  EMPTY_FILTER,
  MATERIAL_KINDS,
  matchAsset,
  OWN_BRAND,
  PRICE_BANDS,
  SWATCH,
  UPLOAD_BRAND,
  type AssetFilter,
} from './assetFilter';

const TOOLS: { tool: Tool; icon: typeof MousePointer2; key: string; hotkey?: string }[] = [
  { tool: 'select', icon: MousePointer2, key: 'tools.select', hotkey: 'V' },
  { tool: 'wall', icon: PenLine, key: 'tools.wall', hotkey: 'W' },
  { tool: 'rect', icon: Square, key: 'tools.rect' },
  { tool: 'polygon', icon: Hexagon, key: 'tools.polygon', hotkey: 'P' },
  { tool: 'arc', icon: Spline, key: 'tools.arc', hotkey: 'C' },
  { tool: 'door', icon: DoorOpen, key: 'tools.door', hotkey: 'D' },
  { tool: 'window', icon: AppWindow, key: 'tools.window', hotkey: 'N' },
  { tool: 'measure', icon: Ruler, key: 'tools.measure', hotkey: 'M' },
  { tool: 'dimension', icon: MoveHorizontal, key: 'tools.dimension', hotkey: 'K' },
  { tool: 'text', icon: Type, key: 'tools.text', hotkey: 'T' },
  { tool: 'angle', icon: TriangleRight, key: 'tools.angle' },
  { tool: 'arrow', icon: MoveUpRight, key: 'tools.arrow' },
  { tool: 'tag', icon: Hash, key: 'tools.tag' },
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
  'structure',
  'mep',
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
  structure: '#8fa3b8',
  mep: '#e08a1e',
};

const materialsById = materialMap(materials);

export function LeftPanel() {
  const { t } = useTranslation();
  const assetScroller = useRef<HTMLDivElement>(null);
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const layers = useEditor((s) => s.layers);
  const snapOn = useEditor((s) => s.snapEnabled);
  return (
    <aside
      className="hud-panel hud-panel-left flex shrink-0 flex-col"
      style={{ width: 'var(--left-w, 300px)' }}
      aria-label={t('tools.title')}
    >
      <section className="space-y-3 border-b border-border p-3">
        <h2 className="hud-title">{t('tools.title')}</h2>
        <div className="hotbar" role="toolbar" aria-label={t('tools.title')} data-tour="tools">
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
      <Tabs.Root defaultValue="assets" className="flex min-h-0 flex-1 flex-col" data-tour="assets">
        <Tabs.List className="flex border-b border-border" aria-label={t('assets.title')}>
          <Tabs.Trigger value="assets" className="hud-tab">
            {t('assets.title')}
          </Tabs.Trigger>
          <Tabs.Trigger value="materials" className="hud-tab" data-testid="tab-materials">
            {t('paint.title')}
          </Tabs.Trigger>
          <Tabs.Trigger value="outline" className="hud-tab" data-testid="tab-outline">
            {t('outline.title')}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content
          value="assets"
          className="relative min-h-0 flex-1 overflow-y-auto p-3"
          ref={assetScroller}
        >
          <AssetLibrary scroller={assetScroller} />
        </Tabs.Content>
        <Tabs.Content value="materials" className="min-h-0 flex-1 overflow-y-auto p-3">
          <MaterialsTab />
        </Tabs.Content>
        <Tabs.Content value="outline" className="min-h-0 flex-1 overflow-y-auto p-3">
          <Outline />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

type Special = 'mine' | 'fav' | 'recent' | 'used' | 'sets';
/** 虛擬化格狀清單（FE-AST-04）：只渲染可見的列，萬件資產也不卡 */
function VirtualGrid<T>({
  items,
  rowHeight,
  cols,
  render,
  scroller,
  testId,
}: {
  items: T[];
  rowHeight: number;
  cols: number;
  render: (it: T) => React.ReactNode;
  scroller: React.RefObject<HTMLElement | null>;
  testId?: string;
}) {
  const [range, setRange] = useState<[number, number]>([0, 12]);
  const top = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const upd = () => {
      const y = el.scrollTop - (top.current?.offsetTop ?? 0);
      const first = Math.max(0, Math.floor(y / rowHeight) - 2);
      const n = Math.ceil(el.clientHeight / rowHeight) + 5;
      setRange([first, first + n]);
    };
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', upd);
      ro.disconnect();
    };
  }, [scroller, rowHeight, items.length]);
  const rows = Math.ceil(items.length / cols);
  const [r0, r1] = [Math.min(range[0], rows), Math.min(range[1], rows)];
  return (
    <ul
      ref={top}
      className="relative"
      style={{ height: rows * rowHeight }}
      data-testid={testId}
      data-total={items.length}
    >
      {items.slice(r0 * cols, r1 * cols).map((it, k) => {
        const i = r0 * cols + k;
        return (
          <li
            key={i}
            className="absolute"
            style={{
              top: Math.floor(i / cols) * rowHeight,
              left: `calc(${(i % cols) * (100 / cols)}% + ${(i % cols) * 4}px)`,
              width: `calc(${100 / cols}% - 4px)`,
              height: rowHeight - 8,
            }}
          >
            {render(it)}
          </li>
        );
      })}
    </ul>
  );
}

function AssetLibrary({ scroller }: { scroller: React.RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const placeId = useEditor((s) => s.placeCatalogId);
  const scene = useEditor((s) => s.scene);
  const version = useCatalogVersion();
  const prefs = useAssetPrefs();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CatalogEntry['category'] | Special | null>(null);
  const [f, setF] = useState<AssetFilter>(EMPTY_FILTER);
  const upd = (p: Partial<AssetFilter>) => setF((x) => ({ ...x, ...p }));
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const used = useMemo(
    () => new Set(scene.levels.flatMap((l) => l.objects.map((o) => o.catalogId))),
    [scene],
  );
  const list = useMemo(() => {
    const base =
      cat === 'mine'
        ? catalog.search({ text: q }).filter(isUserAsset)
        : cat === 'fav'
          ? prefs.fav.map((id) => catalog.get(id)).filter((e): e is CatalogEntry => !!e)
          : cat === 'recent'
            ? prefs.recent.map((id) => catalog.get(id)).filter((e): e is CatalogEntry => !!e)
            : cat === 'used'
              ? catalog.search({ text: q }).filter((e) => used.has(e.id))
              : catalog.search({ text: q, category: cat === 'sets' ? undefined : (cat ?? undefined) });
    const filtered = base.filter((e) => matchAsset(e, f, materialsById));
    if (cat === 'fav' || cat === 'recent') return filtered;
    return filtered
      .map((e, i) => ({ e, i }))
      .sort((a, b) => CATS.indexOf(a.e.category) - CATS.indexOf(b.e.category) || a.i - b.i)
      .map((x) => x.e);
  }, [q, cat, version, prefs, used, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => catalog.all().filter(isUserAsset).length, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (e: CatalogEntry) => {
    const s = store.getState();
    recordRecent(e.id);
    if (e.model.kind === 'parametric' && (e.model.type === 'door' || e.model.type === 'window'))
      s.setTool(e.model.type, e.id);
    else s.setTool('place', e.id);
    if (s.view === '3d' && (e.model.kind !== 'parametric' || ['door', 'window'].includes(e.model.type)))
      s.setView('2d');
    else if (s.view === '3d') s.notify('info', t('assets.dragHint'));
  };
  const active = activeFilters(f);
  const brands = useMemo(() => [...new Set(catalog.all().map(brandOf))].sort(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
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
          aria-pressed={showFilters}
          aria-label={t('assets.filters')}
          title={t('assets.filters')}
          onClick={() => setShowFilters(!showFilters)}
          data-testid="asset-filters"
        >
          <SlidersHorizontal size={14} aria-hidden />
          {active > 0 && <span className="text-[10px] text-primary">{active}</span>}
        </button>
      </div>
      <button
        className="btn w-full justify-center text-xs"
        onClick={() => requestModelUpload()}
        title={t('upload.formats')}
        data-testid="upload-open"
      >
        <Upload size={14} aria-hidden /> {t('upload.open')}
        <span className="font-mono text-[10px] text-muted">{t('upload.formatsShort')}</span>
      </button>
      {showFilters && (
        <div
          className="space-y-2 border border-border bg-black/20 p-2 text-xs"
          data-testid="asset-filter-panel"
        >
          <div className="flex flex-wrap gap-1">
            {STYLE_TAGS.map((st) => (
              <button
                key={st}
                className="hud-chip"
                aria-pressed={f.style === st}
                onClick={() => upd({ style: f.style === st ? null : st })}
                data-testid={`filter-style-${st}`}
              >
                {t(`assets.styles.${st}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('assets.color')}>
            {COLOR_FAMILIES.map((c) => (
              <button
                key={c}
                className="h-5 w-5 border"
                style={{
                  background: SWATCH[c],
                  borderColor: f.color === c ? 'var(--primary)' : 'var(--border)',
                  boxShadow: f.color === c ? 'var(--glow)' : undefined,
                }}
                aria-pressed={f.color === c}
                aria-label={t(`assets.colors.${c}`)}
                title={t(`assets.colors.${c}`)}
                onClick={() => upd({ color: f.color === c ? null : c })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('assets.material')}>
            {MATERIAL_KINDS.map((m) => (
              <button
                key={m}
                className="hud-chip"
                aria-pressed={f.material === m}
                onClick={() => upd({ material: f.material === m ? null : m })}
                data-testid={`filter-material-${m}`}
              >
                {t(`assets.materials.${m}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {PRICE_BANDS.map((b) => (
              <button
                key={b.key}
                className="hud-chip"
                aria-pressed={f.price === b.key}
                onClick={() => upd({ price: f.price === b.key ? null : b.key })}
              >
                {t(`assets.prices.${b.key}`)}
              </button>
            ))}
          </div>
          {(['w', 'd', 'h'] as const).map((k) => (
            <div key={k} className="flex items-center gap-1" data-testid={`filter-size-${k}`}>
              <span className="w-8 whitespace-nowrap">{t(`assets.dim.${k}`)}</span>
              {(['min', 'max'] as const).map((b) => (
                <input
                  key={b}
                  type="number"
                  className="field w-16 px-1 py-0.5"
                  min={0}
                  step={10}
                  placeholder={t(`assets.dim.${b}`)}
                  aria-label={`${t(`assets.dim.${k}`)} ${t(`assets.dim.${b}`)}`}
                  value={f[k][b] ? f[k][b] / 10 : ''}
                  onChange={(e) =>
                    upd({ [k]: { ...f[k], [b]: Math.max(0, Number(e.target.value) || 0) * 10 } })
                  }
                  data-testid={`filter-${k}-${b}`}
                />
              ))}
              <span className="text-muted">{t('units.cm')}</span>
            </div>
          ))}
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">{t('assets.brand')}</span>
            <select
              className="field min-w-0 flex-1 py-0.5"
              value={f.brand ?? ''}
              onChange={(e) => upd({ brand: e.target.value || null })}
              data-testid="filter-brand"
            >
              <option value="">{t('assets.any')}</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b === UPLOAD_BRAND ? t('assets.brandUpload') : b === OWN_BRAND ? t('assets.brandOwn') : b}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={f.customizable}
              onChange={(e) => upd({ customizable: e.target.checked })}
              data-testid="filter-customizable"
            />
            {t('assets.customizable')}
          </label>
          {active > 0 && (
            <button className="btn px-2 py-0.5" onClick={() => setF(EMPTY_FILTER)} data-testid="filter-clear">
              {t('assets.clear')}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <button className="hud-chip" aria-pressed={cat === null} onClick={() => setCat(null)}>
          {t('assets.all')}
        </button>
        {(['sets', 'fav', 'recent', 'used'] as const).map((k) => (
          <button
            key={k}
            className="hud-chip inline-flex items-center gap-1"
            aria-pressed={cat === k}
            onClick={() => setCat(cat === k ? null : k)}
            data-testid={`assets-${k}`}
          >
            {k === 'fav' && <Star size={10} aria-hidden />}
            {t(`assets.special.${k}`)}
          </button>
        ))}
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
        {mine > 0 && (
          <button className="hud-chip" onClick={() => setManageOpen(true)} data-testid="assets-manage">
            {t('userAssets.manage')}
          </button>
        )}
      </div>
      {cat === 'sets' ? (
        <SetsList />
      ) : (
        <>
          <p className="text-[11px] text-muted">{t('assets.count', { n: list.length })}</p>
          {list.length === 0 ? (
            <div className="space-y-2 py-6 text-center text-xs text-muted">
              <p>{t('assets.empty')}</p>
              <button
                className="btn"
                onClick={() => {
                  setQ('');
                  setCat(null);
                  setF(EMPTY_FILTER);
                }}
              >
                {t('assets.clear')}
              </button>
            </div>
          ) : (
            <VirtualGrid
              items={list}
              cols={2}
              rowHeight={176}
              scroller={scroller}
              testId="asset-list"
              render={(e) => (
                <AssetCard
                  entry={e}
                  active={placeId === e.id}
                  fav={prefs.fav.includes(e.id)}
                  onPick={() => pick(e)}
                  onInfo={() => setDetail(e.id)}
                />
              )}
            />
          )}
        </>
      )}
      <AssetDetail entryId={detail} onClose={() => setDetail(null)} />
      <UserAssetsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}

function AssetCard({
  entry: e,
  active,
  fav,
  onPick,
  onInfo,
}: {
  entry: CatalogEntry;
  active: boolean;
  fav: boolean;
  onPick: () => void;
  onInfo: () => void;
}) {
  const { t, i18n } = useTranslation();
  const thumb = useThumbnail(e);
  const nm = i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh;
  const user = isUserAsset(e);
  return (
    <div className="relative h-full">
      <button
        className="inv-slot h-full"
        style={{ ['--rarity' as string]: user ? '#4fd6c8' : CATEGORY_COLOR[e.category] }}
        data-active={active}
        aria-label={t('assets.place', { name: nm })}
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData('application/x-interiorai-catalog', e.id);
          dragPayload.start({ kind: 'catalog', id: e.id });
        }}
        onDragEnd={dragPayload.end}
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
        <span className="font-mono text-[9px] text-muted">
          {t('assets.size', { w: e.dimsMm.w, d: e.dimsMm.d, h: e.dimsMm.h })}
        </span>
        {e.unitPriceTwd !== undefined && (
          <span className="inv-price text-[11px]">
            {t('assets.price', { n: e.unitPriceTwd.toLocaleString() })}
          </span>
        )}
      </button>
      <button
        className={`absolute top-1 right-1 p-1 ${fav ? 'text-primary' : 'text-muted hover:text-primary'}`}
        aria-label={t(fav ? 'assets.unfavorite' : 'assets.favorite', { name: nm })}
        aria-pressed={fav}
        title={t(fav ? 'assets.unfavorite' : 'assets.favorite', { name: nm })}
        onClick={() => toggleFavorite(e.id)}
        data-testid={`fav-${e.id}`}
      >
        <Star size={12} fill={fav ? 'currentColor' : 'none'} aria-hidden />
      </button>
      <button
        className="absolute right-1 bottom-7 p-1 text-muted hover:text-primary"
        aria-label={t('assetDetail.open', { name: nm })}
        title={t('assetDetail.open', { name: nm })}
        onClick={onInfo}
        data-testid={`info-${e.id}`}
      >
        <Info size={12} aria-hidden />
      </button>
      {user && (
        <button
          className="absolute top-6 right-1 rounded bg-black/40 p-1 text-muted hover:text-danger"
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

/** 材質庫（油漆模式，FE-V3D-05）：點選材質後點擊 2D/3D 的牆、地板、天花、家具套用；可拖到 3D 表面；Alt＋點擊＝滴管 */
function MaterialsTab() {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const current = useEditor((s) => s.placeCatalogId);
  const [cat, setCat] = useState<Material['category'] | null>(null);
  const cats: Material['category'][] = ['floor', 'wall', 'wood', 'stone', 'fabric', 'metal', 'ceiling'];
  const all = useMaterials();
  const [upload, setUpload] = useState(false);
  const list = all.filter((m) => !cat || m.category === cat);
  return (
    <div className="space-y-2" data-testid="materials-tab">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] text-muted">{t(tool === 'paint' ? 'paint.active' : 'paint.hint')}</p>
        <button
          className="btn px-2"
          onClick={() => setUpload(true)}
          title={t('userMaterial.title')}
          aria-label={t('userMaterial.title')}
          data-testid="material-upload-open"
        >
          <Upload size={14} aria-hidden />
        </button>
      </div>
      <UploadMaterialDialog open={upload} onOpenChange={setUpload} />
      <div className="flex flex-wrap gap-1">
        <button className="hud-chip" aria-pressed={cat === null} onClick={() => setCat(null)}>
          {t('assets.all')}
        </button>
        {cats.map((c) => (
          <button
            key={c}
            className="hud-chip"
            aria-pressed={cat === c}
            onClick={() => setCat(cat === c ? null : c)}
          >
            {t(`paint.categories.${c}`)}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-3 gap-1.5">
        {list.map((m) => {
          const nm = i18n.language === 'en' ? (m.nameEn ?? m.nameZh) : m.nameZh;
          const on = tool === 'paint' && current === m.id;
          return (
            <li key={m.id} className="relative">
              {m.id.startsWith('um_') && (
                <button
                  className="absolute top-1 right-1 z-10 rounded bg-black/50 p-0.5 text-muted hover:text-danger"
                  title={t('userMaterial.delete', { name: nm })}
                  aria-label={t('userMaterial.delete', { name: nm })}
                  onClick={() =>
                    window.confirm(t('userMaterial.deleteConfirm', { name: nm })) &&
                    void deleteUserMaterial(m.id)
                  }
                >
                  <Trash2 size={10} aria-hidden />
                </button>
              )}
              <button
                className="inv-slot items-center p-1 text-center"
                data-active={on}
                style={{ ['--rarity' as string]: m.color }}
                aria-pressed={on}
                aria-label={t('paint.use', { name: nm })}
                title={nm}
                draggable
                onDragStart={(ev) => ev.dataTransfer.setData('application/x-interiorai-material', m.id)}
                onClick={() => store.getState().setTool(on ? 'select' : 'paint', on ? undefined : m.id)}
                data-testid={`paint-${m.id}`}
              >
                <span className="block h-10 w-full" style={{ background: swatchCss(m) }} aria-hidden />
                <span className="line-clamp-1 w-full text-[10px]">{nm}</span>
              </button>
            </li>
          );
        })}
      </ul>
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
  // 編號標記清單（FE-PLAN-10）：依號碼排序，點選定位
  const tags = (level.annotations ?? [])
    .filter((a) => a.type === 'tag')
    .map((a) => ({
      id: a.id,
      number: Number((a.data as { number?: number } | undefined)?.number ?? 0),
      text: String((a.data as { text?: string } | undefined)?.text ?? ''),
    }))
    .sort((x, y) => x.number - y.number);
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
      {group(
        t('annotation.tagList'),
        tags.length,
        tags.length ? (
          tags.map((a) => item(a.id, `${a.number}. ${a.text || t('annotation.noText')}`))
        ) : (
          <li className="text-[11px] text-muted">{t('annotation.tagEmpty')}</li>
        ),
      )}
    </nav>
  );
}
