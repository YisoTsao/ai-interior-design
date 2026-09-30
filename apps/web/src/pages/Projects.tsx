import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Copy, FilePlus2, Home, LayoutGrid, List, Search, Trash2 } from 'lucide-react';
import {
  createEditorStore,
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectSummary,
} from '@interiorai/app-state';
import { LangToggle, OfflineBadge } from '../editor/common';
import { ImportPlanButton } from '../features/plan-review/ImportPlanButton';
import { NewProjectDialog } from './NewProjectDialog';
import { deleteProjectMedia, getProjectThumb, setProjectThumb } from '../media';
import { usePrefs } from '../prefs';

type Sort = 'updated' | 'name' | 'area';
const readLS = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 私密模式 */
  }
};

/** 專案列表（FE-PRJ-01／02）：縮圖、坪數、房數；網格／清單；搜尋、排序；複製、刪除 */
export function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const areaUnit = usePrefs((s) => s.areaUnit);
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(() => readLS('projects.sort', 'updated') as Sort);
  const [layout, setLayout] = useState<'grid' | 'list'>(
    () => readLS('projects.layout', 'grid') as 'grid' | 'list',
  );
  const [wizard, setWizard] = useState(false);
  const refresh = async () => {
    const list = await listProjects();
    setItems(list);
    const entries = await Promise.all(list.map(async (p) => [p.id, await getProjectThumb(p.id)] as const));
    setThumbs(Object.fromEntries(entries.filter((e): e is [string, string] => !!e[1])));
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => writeLS('projects.sort', sort), [sort]);
  useEffect(() => writeLS('projects.layout', layout), [layout]);

  const shown = useMemo(() => {
    if (!items) return null;
    const k = q.trim().toLowerCase();
    const f = k ? items.filter((p) => (p.name || t('projects.untitled')).toLowerCase().includes(k)) : items;
    return [...f].sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, i18n.language)
        : sort === 'area'
          ? b.areaM2 - a.areaM2
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [items, q, sort, t, i18n.language]);

  const area = (m2: number) =>
    areaUnit === 'ping' ? `${(m2 / 3.3058).toFixed(1)} ${t('units.ping')}` : `${m2.toFixed(1)} m²`;

  const duplicate = async (p: ProjectSummary) => {
    const rec = await loadProject(p.id);
    if (!rec) return;
    const id = createEditorStore().getState().projectId;
    await saveProject({ id, name: t('projects.copyName', { name: rec.name }), scene: rec.scene });
    const th = thumbs[p.id];
    if (th) await setProjectThumb(id, th);
    void refresh();
  };
  const remove = async (p: ProjectSummary) => {
    if (!window.confirm(t('projects.confirmDelete', { name: p.name }))) return;
    await deleteProject(p.id);
    await deleteProjectMedia(p.id);
    void refresh();
  };

  return (
    <main className="game-ui min-h-full bg-bg">
      <header className="hud-bar flex h-14 items-center gap-3 px-4">
        <span className="font-[Rajdhani] text-lg font-bold tracking-widest text-primary" aria-hidden>
          INTERIOR<span className="text-accent">AI</span>
        </span>
        <h1 className="hud-title text-base">{t('projects.title')}</h1>
        <OfflineBadge />
        <div className="ml-auto flex items-center gap-2">
          <LangToggle />
          <ImportPlanButton />
          <button className="btn btn-primary" onClick={() => setWizard(true)} data-testid="new-project">
            <FilePlus2 size={16} aria-hidden /> {t('projects.newProject')}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={14} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              className="field w-64"
              style={{ paddingLeft: 28 }}
              placeholder={t('projects.search')}
              aria-label={t('projects.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="project-search"
            />
          </label>
          <select
            className="field w-40"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label={t('projects.sort')}
          >
            {(['updated', 'name', 'area'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`projects.sortBy.${s}`)}
              </option>
            ))}
          </select>
          <div className="hud-seg ml-auto" role="radiogroup" aria-label={t('projects.layout')}>
            <button
              aria-pressed={layout === 'grid'}
              onClick={() => setLayout('grid')}
              title={t('projects.grid')}
            >
              <LayoutGrid size={14} aria-hidden />
            </button>
            <button
              aria-pressed={layout === 'list'}
              onClick={() => setLayout('list')}
              title={t('projects.list')}
              data-testid="layout-list"
            >
              <List size={14} aria-hidden />
            </button>
          </div>
        </div>
        {shown === null ? (
          <ul className="grid grid-cols-3 gap-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-48 animate-pulse rounded-xl bg-surface" />
            ))}
          </ul>
        ) : items!.length === 0 ? (
          <section className="hud-panel flex flex-col items-center gap-4 p-16 text-center">
            <Home size={40} className="text-primary" aria-hidden />
            <p className="text-muted">{t('projects.empty')}</p>
            <button className="btn btn-primary" onClick={() => setWizard(true)}>
              <FilePlus2 size={16} aria-hidden /> {t('projects.newProject')}
            </button>
          </section>
        ) : (
          <ul
            className={
              layout === 'grid'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
                : 'flex flex-col gap-2'
            }
            data-testid="project-list"
            data-layout={layout}
          >
            {shown.map((p) => (
              <li
                key={p.id}
                className={`hud-panel overflow-hidden ${layout === 'list' ? 'flex items-center gap-3 p-2' : ''}`}
                data-testid="project-card"
              >
                <Link
                  to={`/p/${p.id}/edit`}
                  className={`block shrink-0 bg-bg ${layout === 'grid' ? 'aspect-[16/10] w-full' : 'h-16 w-24 rounded'}`}
                  aria-label={t('projects.openNamed', { name: p.name || t('projects.untitled') })}
                >
                  {thumbs[p.id] ? (
                    <img
                      src={thumbs[p.id]}
                      alt=""
                      className="h-full w-full object-cover"
                      data-testid="project-thumb"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-muted">
                      <Home size={layout === 'grid' ? 32 : 18} aria-hidden />
                    </div>
                  )}
                </Link>
                <div className={`min-w-0 flex-1 ${layout === 'grid' ? 'p-3' : ''}`}>
                  <Link to={`/p/${p.id}/edit`} className="block truncate font-medium hover:underline">
                    {p.name || t('projects.untitled')}
                  </Link>
                  <p className="mt-1 text-xs text-muted" data-testid="project-stats">
                    {t('projects.summary', {
                      area: area(p.areaM2),
                      rooms: p.roomCount,
                      objects: p.objectCount,
                    })}
                  </p>
                  <p className="text-xs text-muted">
                    {t('projects.updated', { time: new Date(p.updatedAt).toLocaleString(i18n.language) })}
                  </p>
                </div>
                <div className={`flex gap-1 ${layout === 'grid' ? 'px-3 pb-3' : ''}`}>
                  <Link to={`/p/${p.id}/edit`} className="btn btn-primary">
                    {t('projects.open')}
                  </Link>
                  <button
                    className="icon-btn"
                    title={t('projects.duplicate')}
                    onClick={() => void duplicate(p)}
                  >
                    <Copy size={14} aria-hidden />
                  </button>
                  <button className="icon-btn" title={t('projects.delete')} onClick={() => void remove(p)}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {shown && items!.length > 0 && shown.length === 0 && (
          <p className="p-8 text-center text-muted">{t('projects.noMatch')}</p>
        )}
      </div>
      <NewProjectDialog
        open={wizard}
        onOpenChange={setWizard}
        onCreated={(id) => void nav(`/p/${id}/edit`)}
      />
    </main>
  );
}
