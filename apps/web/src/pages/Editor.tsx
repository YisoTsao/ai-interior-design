import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowLeft, Bookmark, Box, Camera, Eye, Leaf, Map, Maximize, Redo2, Undo2 } from 'lucide-react';
import {
  activeLevel,
  addObject,
  autoDecorate,
  canRedo,
  canUndo,
  createEditorStore,
  loadProject,
  planDecor,
  saveCameraBookmark,
  startAutosave,
} from '@interiorai/app-state';
import { defaultElevation } from '@interiorai/catalog';
import { Plan2D, plan2dApi } from '@interiorai/editor-2d';
import { VIEW_PRESETS, Viewer3D, viewer3dApi, type ViewPreset } from '@interiorai/viewer-3d';
import { catalog, materials, useCatalogVersion } from '../catalogData';
import { BottomBar } from '../editor/BottomBar';
import { IconButton, LangToggle, OfflineBadge } from '../editor/common';
import { EditorCtx, useEditor, useEditorStore } from '../editor/context';
import { CanvasBoundary } from '../editor/ErrorBoundary';
import { Inspector } from '../editor/Inspector';
import { LeftPanel } from '../editor/LeftPanel';
import { RenderPanel } from '../editor/RenderPanel';
import { useShortcuts, type TransformMode } from '../editor/shortcuts';
import { usePrefs } from '../prefs';
import { useCanvasTheme } from '../theme';

export function EditorPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const store = useMemo(() => createEditorStore(), []);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | { error: string }>('loading');

  useEffect(() => {
    let dead = false;
    loadProject(id!)
      .then((rec) => {
        if (dead) return;
        if (!rec) return setState('missing');
        store.getState().load({ projectId: rec.id, projectName: rec.name, scene: rec.scene });
        // 平面圖匯入後直接看 3D（/p/:id/edit?view=3d）
        if (new URLSearchParams(window.location.search).get('view') === '3d') store.getState().setView('3d');
        setState('ready');
      })
      .catch((e: unknown) => !dead && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      dead = true;
    };
  }, [id, store]);

  useEffect(() => {
    if (state !== 'ready') return;
    const auto = startAutosave(store);
    const flush = () => void auto.flush();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    // 測試鉤子（03 §9）
    (window as unknown as { __editor: unknown }).__editor = {
      store,
      plan2d: () => plan2dApi.get(),
      viewer3d: () => viewer3dApi.get(),
      flush: () => auto.flush(),
    };
    return () => {
      flush();
      auto.dispose();
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state, store]);

  if (state === 'loading')
    return (
      <div className="grid h-full place-items-center text-muted" aria-busy="true">
        …
      </div>
    );
  if (state === 'missing' || typeof state === 'object')
    return (
      <main className="grid h-full place-items-center">
        <div className="space-y-3 text-center" role="alert">
          <p>
            {state === 'missing' ? t('error.notFound') : t('projects.loadError', { message: state.error })}
          </p>
          <Link to="/" className="btn">
            {t('top.back')}
          </Link>
        </div>
      </main>
    );
  return (
    <EditorCtx.Provider value={store}>
      <Tooltip.Provider>
        <EditorShell />
      </Tooltip.Provider>
    </EditorCtx.Provider>
  );
}

function EditorShell() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const view = useEditor((s) => s.view);
  const revision = useEditor((s) => s.revision);
  const theme = useCanvasTheme();
  const lengthUnit = usePrefs((s) => s.lengthUnit);
  const areaUnit = usePrefs((s) => s.areaUnit);
  const viewStyle = usePrefs((s) => s.viewStyle);
  const lighting = usePrefs((s) => s.lighting);
  const graphics = usePrefs((s) => s.graphics);
  const catalogVersion = useCatalogVersion();
  const [mode, setMode] = useState<TransformMode>('translate');
  const [uniformScale, setUniformScale] = useState(true);
  const [showCeiling, setShowCeiling] = useState(false);
  useShortcuts(store, setMode);
  const tt = useCallback((k: string, v?: Record<string, string | number>) => t(k, v), [t]);

  const onDrop = (e: React.DragEvent) => {
    const catId = e.dataTransfer.getData('application/x-interiorai-catalog');
    const entry = catalog.get(catId);
    const api = plan2dApi.get();
    if (!entry || !api || view !== '2d') return;
    e.preventDefault();
    const [x, z] = api.clientToWorld([e.clientX, e.clientY]);
    const s = store.getState();
    const lvl = activeLevel(s);
    const y = defaultElevation(entry, lvl.height);
    s.exec(
      addObject(s.levelId, {
        catalogId: entry.id,
        position: [Math.round(x), y, Math.round(z)],
        rotationY: 0,
      }),
    );
  };

  return (
    <div className="game-ui flex h-full flex-col">
      <a href="#canvas" className="sr-only focus:not-sr-only">
        {t('app.skip')}
      </a>
      <TopBar mode={mode} setMode={setMode} />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main
          id="canvas"
          className="relative min-w-0 flex-1 bg-bg"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          tabIndex={-1}
          aria-label={t(view === '2d' ? 'top.view2d' : 'top.view3d')}
        >
          <CanvasBoundary
            resetKey={revision}
            fallback={(reset) => (
              <div className="grid h-full place-items-center" role="alert">
                <div className="space-y-2 text-center">
                  <p>{t('error.boundary')}</p>
                  <button
                    className="btn"
                    onClick={async () => {
                      const s = store.getState();
                      const rec = await loadProject(s.projectId);
                      if (rec) s.load({ projectId: rec.id, projectName: rec.name, scene: rec.scene });
                      reset();
                    }}
                  >
                    {t('error.restore')}
                  </button>
                </div>
              </div>
            )}
          >
            {view === '2d' ? (
              <Plan2D
                store={store}
                catalog={catalog}
                t={tt}
                lengthUnit={lengthUnit}
                areaUnit={areaUnit}
                theme={theme}
              />
            ) : (
              <Viewer3D
                store={store}
                catalog={catalog}
                materials={materials}
                theme={theme}
                transformMode={mode}
                uniformScale={uniformScale}
                showCeiling={showCeiling}
                viewStyle={viewStyle}
                lighting={lighting}
                graphics={graphics}
                catalogVersion={catalogVersion}
              />
            )}
          </CanvasBoundary>
          {view === '3d' && <ViewportHud showCeiling={showCeiling} setShowCeiling={setShowCeiling} />}
        </main>
        <Inspector uniformScale={uniformScale} setUniformScale={setUniformScale} />
      </div>
      <BottomBar />
    </div>
  );
}

function TopBar({ mode, setMode }: { mode: TransformMode; setMode: (m: TransformMode) => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const name = useEditor((s) => s.projectName);
  const view = useEditor((s) => s.view);
  const saveStatus = useEditor((s) => s.saveStatus);
  const undoable = useEditor(canUndo);
  const redoable = useEditor(canRedo);
  const lastLabel = useEditor((s) => s.history.past.at(-1)?.label);
  const { lengthUnit, areaUnit, setLength, setArea } = usePrefs();
  return (
    <header className="hud-bar relative z-10 flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-2 whitespace-nowrap">
      <Link to="/" className="icon-btn" aria-label={t('top.back')} title={t('top.back')}>
        <ArrowLeft size={18} aria-hidden />
      </Link>
      <span
        className="hidden font-[Rajdhani] text-lg font-bold tracking-widest text-primary xl:inline"
        aria-hidden
      >
        INTERIOR<span className="text-accent">AI</span>
      </span>
      <input
        className="field w-48 shrink-0 font-sans"
        aria-label={t('top.name')}
        value={name}
        onChange={(e) => store.getState().rename(e.target.value)}
        data-testid="project-name"
      />
      <span
        role="status"
        className={`whitespace-nowrap text-xs ${saveStatus === 'error' ? 'text-danger' : 'text-muted'}`}
        data-testid="save-status"
        data-status={saveStatus}
      >
        {t(`top.save.${saveStatus}`)}
      </span>
      <div className="mx-2 h-6 w-px bg-border" />
      <IconButton
        label={undoable ? t('top.undo', { label: t(lastLabel ?? '') }) : t('top.undoNone')}
        disabled={!undoable}
        onClick={() => store.getState().undo()}
        testId="undo"
      >
        <Undo2 size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={t('top.redo')}
        disabled={!redoable}
        onClick={() => store.getState().redo()}
        testId="redo"
      >
        <Redo2 size={18} aria-hidden />
      </IconButton>
      <div className="mx-2 h-6 w-px bg-border" />
      <div role="radiogroup" aria-label={t('top.view2d')} className="hud-seg">
        <IconButton
          label={t('top.view2d')}
          pressed={view === '2d'}
          onClick={() => store.getState().setView('2d')}
          testId="view-2d"
        >
          <Map size={18} aria-hidden />
        </IconButton>
        <IconButton
          label={t('top.view3d')}
          pressed={view === '3d'}
          onClick={() => store.getState().setView('3d')}
          testId="view-3d"
        >
          <Box size={18} aria-hidden />
        </IconButton>
      </div>
      {view === '3d' && (
        <>
          <div className="hud-seg" role="radiogroup" aria-label={t('tools.translate')}>
            {(['translate', 'rotate', 'scale'] as const).map((m) => (
              <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`tools.${m}`)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        <OfflineBadge />
        <label className="flex items-center gap-1 text-xs">
          <span className="sr-only">{t('units.length')}</span>
          <select
            className="field w-20 font-sans"
            value={lengthUnit}
            onChange={(e) => setLength(e.target.value as typeof lengthUnit)}
            aria-label={t('units.length')}
          >
            {(['mm', 'cm', 'm'] as const).map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </select>
          <select
            className="field w-24 font-sans"
            value={areaUnit}
            onChange={(e) => setArea(e.target.value as typeof areaUnit)}
            aria-label={t('units.area')}
          >
            {(['ping', 'm2'] as const).map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </select>
        </label>
        <LangToggle />
        {view === '3d' && <RenderPanel />}
      </div>
    </header>
  );
}

/**
 * 3D 視埠 HUD（遊戲式浮動工具列）：視角、截圖、軟裝、風格／光線／視角預設、天花板。
 * 放在畫布左上角，頂列只留專案層級的操作。
 */
function ViewportHud({
  showCeiling,
  setShowCeiling,
}: {
  showCeiling: boolean;
  setShowCeiling: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const cams = useEditor((s) => s.scene.cameras?.length ?? 0);
  const { viewStyle, setViewStyle, lighting, setLighting } = usePrefs();
  return (
    <div
      className="hud-panel absolute top-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1 p-1.5"
      role="toolbar"
      aria-label={t('top.view3d')}
    >
      <IconButton label={t('top.personView')} onClick={() => viewer3dApi.get()?.personView()}>
        <Eye size={18} aria-hidden />
      </IconButton>
      <IconButton label={t('top.frameAll')} onClick={() => viewer3dApi.get()?.frameAll()}>
        <Maximize size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={t('top.bookmark')}
        onClick={() => {
          const cam = viewer3dApi.get()?.currentCamera();
          if (!cam) return;
          const nm = t('top.bookmarkName', { n: cams + 1 });
          if (store.getState().exec(saveCameraBookmark({ name: nm, ...cam })))
            store.getState().notify('info', t('saved.camera', { name: nm }));
        }}
      >
        <Bookmark size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={t('top.screenshot')}
        testId="top-screenshot"
        onClick={() => {
          const url = viewer3dApi.get()?.screenshot();
          if (!url) return;
          const a = document.createElement('a');
          a.href = url;
          a.download = `interiorai-${Date.now()}.png`;
          a.click();
        }}
      >
        <Camera size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={t('top.decorate')}
        testId="auto-decorate"
        onClick={() => {
          const s = store.getState();
          const plan = planDecor(activeLevel(s), catalog);
          if (plan.length && s.exec(autoDecorate(s.levelId, plan)))
            s.notify('info', t('top.decorateDone', { n: plan.length }));
          else s.notify('info', t('top.decorateNone'));
        }}
      >
        <Leaf size={18} aria-hidden />
      </IconButton>
      <label className="flex items-center gap-1 text-xs">
        <span className="sr-only">{t('top.style')}</span>
        <select
          className="field w-28 font-sans"
          value={viewStyle}
          onChange={(e) => setViewStyle(e.target.value as typeof viewStyle)}
          data-testid="view-style"
        >
          <option value="dollhouse">{t('top.styleDollhouse')}</option>
          <option value="simple">{t('top.styleSimple')}</option>
        </select>
      </label>
      {viewStyle === 'dollhouse' && (
        <label className="flex items-center gap-1 text-xs">
          <span className="sr-only">{t('top.lighting')}</span>
          <select
            className="field w-28 font-sans"
            value={lighting}
            onChange={(e) => setLighting(e.target.value as typeof lighting)}
            data-testid="view-lighting"
          >
            <option value="night">{t('top.lightingNight')}</option>
            <option value="day">{t('top.lightingDay')}</option>
          </select>
        </label>
      )}
      {viewStyle === 'dollhouse' && (
        <label className="flex items-center gap-1 text-xs">
          <span className="sr-only">{t('top.viewPreset')}</span>
          <select
            className="field w-28 font-sans"
            value=""
            onChange={(e) => e.target.value && viewer3dApi.get()?.viewPreset(e.target.value as ViewPreset)}
            data-testid="view-preset"
          >
            <option value="">{t('top.viewPreset')}</option>
            {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((p) => (
              <option key={p} value={p}>
                {t(`top.preset.${p}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className="hud-chip"
        aria-pressed={showCeiling}
        onClick={() => setShowCeiling(!showCeiling)}
        data-testid="toggle-ceiling"
      >
        {t('top.ceiling')}
      </button>
    </div>
  );
}
