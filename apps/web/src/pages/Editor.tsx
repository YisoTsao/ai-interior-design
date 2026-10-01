import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ArrowLeft,
  Bookmark,
  Bot,
  Box,
  Camera,
  CircleHelp,
  Download,
  History,
  Info,
  Palette,
  PanelLeft,
  PanelRight,
  Eye,
  Footprints,
  GitBranch,
  Globe2,
  Images,
  Leaf,
  Map,
  Maximize,
  MessageSquare,
  Presentation as Presentation2,
  Receipt,
  Ruler,
  Redo2,
  Share2,
  Undo2,
  Wand2,
} from 'lucide-react';
import { AssistantPanel } from '../editor/AssistantPanel';
import { FurnishDialog } from '../editor/FurnishDialog';
import { capturePanorama, GalleryPanel } from '../editor/GalleryPanel';
import { QuotePanel } from '../editor/QuotePanel';
import { ShareDialog } from '../editor/ShareDialog';
import { Tour, tourDone } from '../editor/Tour';
import { CommandPalette, type PaletteCommand } from '../editor/CommandPalette';
import { ExportDialog } from '../editor/ExportDialog';
import { MoodboardPanel } from '../editor/MoodboardPanel';
import { Presentation } from '../editor/Presentation';
import { CommentsPanel, useComments } from '../editor/CommentsPanel';
import { captureThumb, VersionsPanel } from '../editor/VersionsPanel';
import { HistoryPanel } from '../editor/HistoryPanel';
import { ProjectInfoDialog } from '../editor/ProjectInfoDialog';
import { ShortcutsDialog } from '../editor/ShortcutsDialog';
import { UploadModelDialog } from '../editor/UploadModelDialog';
import { hasModelFile, requestModelUpload, UPLOAD_MODEL_EVENT } from '../editor/uploadRequest';
import { addVersion, setProjectThumb, shrink } from '../media';
import { useUnderlay } from '../editor/underlay';
import { usePlaceMaterial } from '../editor/placeMaterial';
import { useLuxOverlay } from '../editor/LightingAnalysis';
import { illuminance, luxColor } from '../ai/illuminance';
import { useLuxResult } from '../editor/luxResult';
import { ResizeHandle } from '../editor/ResizeHandle';
import { SectionControl, useSection } from '../editor/SectionControl';
import { placeSetAt } from '../editor/SetsList';
import { BookmarksMenu } from '../editor/BookmarksMenu';
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
  addComment,
  batch,
  commentsOf,
  FURNITURE_SETS,
  setLayout,
  setMaterial,
  stackElevation,
  updateObject,
  startAutosave,
} from '@interiorai/app-state';
import { defaultElevation, objectDims, type CatalogEntry } from '@interiorai/catalog';
import { snapToWall } from '@interiorai/core-geometry';
import { recordRecent } from '../editor/assetPrefs';
import { Plan2D, plan2dApi } from '@interiorai/editor-2d';
import { placementGhost, VIEW_PRESETS, Viewer3D, viewer3dApi, type ViewPreset } from '@interiorai/viewer-3d';
import { dragPayload } from '../editor/dragPayload';
import { catalog, useCatalogVersion, useMaterials } from '../catalogData';
import { BottomBar } from '../editor/BottomBar';
import { IconButton, LangToggle, OfflineBadge } from '../editor/common';
import { EditorCtx, useEditor, useEditorStore } from '../editor/context';
import { CanvasBoundary } from '../editor/ErrorBoundary';
import { Inspector } from '../editor/Inspector';
import { LeftPanel } from '../editor/LeftPanel';
import { RenderPanel } from '../editor/RenderPanel';
import { useShortcuts, type TransformMode } from '../editor/shortcuts';
import { editActions } from '../editor/actions';
import { ContextMenu, type MenuState } from '../editor/ContextMenu';
import { LevelBar } from '../editor/LevelBar';
import { usePrompt } from '../editor/PromptDialog';
import { usePrefs } from '../prefs';
import { useCanvasTheme } from '../theme';

export function EditorPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const store = useMemo(() => createEditorStore(), []);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | { error: string }>('loading');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let dead = false;
    setState('loading');
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
  }, [id, store, retry]);

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
      <div className="game-ui flex h-full flex-col" aria-busy="true" data-testid="editor-skeleton">
        <div className="hud-bar h-12 shrink-0" />
        <div className="flex min-h-0 flex-1 gap-0">
          <div className="hud-panel w-[300px] animate-pulse max-md:hidden" />
          <div className="grid flex-1 place-items-center text-sm text-muted">{t('editor.loading')}</div>
          <div className="hud-panel w-[320px] animate-pulse max-lg:hidden" />
        </div>
      </div>
    );
  if (state === 'missing' || typeof state === 'object')
    return (
      <main className="grid h-full place-items-center">
        <div className="space-y-3 text-center" role="alert">
          <p>
            {state === 'missing' ? t('error.notFound') : t('projects.loadError', { message: state.error })}
          </p>
          <div className="flex justify-center gap-2">
            {state !== 'missing' && (
              <button
                className="btn btn-primary"
                onClick={() => setRetry((n) => n + 1)}
                data-testid="editor-retry"
              >
                {t('editor.retry')}
              </button>
            )}
            <Link to="/" className="btn">
              {t('top.back')}
            </Link>
          </div>
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
  const displayMode = usePrefs((s) => s.displayMode);
  const panelW = usePrefs((s) => s.panelWidths);
  const setPanelW = usePrefs((s) => s.setPanelWidths);
  const section = useSection((s) => s.section);
  const levelsMode = usePrefs((s) => s.levelsMode);
  const catalogVersion = useCatalogVersion();
  const materials = useMaterials();
  const [mode, setMode] = useState<TransformMode>('translate');
  const [uniformScale, setUniformScale] = useState(true);
  const [showCeiling, setShowCeiling] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [tour, setTour] = useState(() => !tourDone());
  const [presenting, setPresenting] = useState(false);
  const startPresent = useCallback(() => {
    store.getState().setView('3d');
    store.getState().select([]);
    setPresenting(true);
  }, [store]);
  const stopPresent = useCallback(() => setPresenting(false), []);
  // 面板收合（FE-UX-07）：\ 鍵切換兩側面板＝全螢幕畫布
  // 窄螢幕（手機、直立平板）預設收合兩側面板，畫布滿版（FE-MOB-02）
  const [showLeft, setShowLeft] = useState(() => window.innerWidth >= 900);
  const [showRight, setShowRight] = useState(() => window.innerWidth >= 1100);
  const togglePanels = useCallback(() => {
    const on = !(showLeft || showRight);
    setShowLeft(on);
    setShowRight(on);
  }, [showLeft, showRight]);
  const openPalette = useCallback(() => setPanel('palette'), []);
  const openHelp = useCallback(() => setPanel('shortcuts'), []);
  const paletteCmds = useMemo<PaletteCommand[]>(() => {
    const g = t('palette.groups.panels');
    const p = (id: Panel, key: string): PaletteCommand => ({
      id: `panel:${id}`,
      label: t(key),
      group: g,
      run: () => setPanel(id),
    });
    return [
      p('furnish', 'furnish.title'),
      p('assistant', 'assistant.title'),
      p('quote', 'quote.title'),
      p('gallery', 'gallery.title'),
      p('share', 'share.title'),
      p('export', 'exports.title'),
      p('mood', 'mood.title'),
      p('versions', 'versions.title'),
      p('comments', 'comments.title'),
      p('info', 'projectInfo.title'),
      p('history', 'history.title'),
      p('shortcuts', 'shortcuts.title'),
      p('upload', 'upload.open'),
      { id: 'tour', label: t('tour.help'), group: g, run: () => setTour(true) },
      { id: 'present', label: t('present.start'), group: g, run: startPresent },
      { id: 'panels', label: t('shortcuts.panels'), group: g, hint: '\\', run: togglePanels },
    ];
  }, [t, togglePanels, startPresent]);
  const prompt = usePrompt();
  // 上傳 3D 模型：資產庫按鈕、指令面板、拖放模型檔（FE-AST-11）
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [fileOver, setFileOver] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      setUploadFiles((e as CustomEvent<File[] | null>).detail);
      setPanel('upload');
    };
    window.addEventListener(UPLOAD_MODEL_EVENT, on);
    return () => window.removeEventListener(UPLOAD_MODEL_EVENT, on);
  }, []);
  // 以資產詳情選的材質放置（FE-AST-05）：新放置的同品項物件套用主材質
  useEffect(
    () =>
      store.subscribe((st, prev) => {
        const p = usePlaceMaterial.getState().pending;
        if (!p) return;
        if (st.tool !== 'place' || st.placeCatalogId !== p.catalogId) {
          if (prev.tool === 'place' && st.tool !== 'place') usePlaceMaterial.getState().set(null);
          return;
        }
        const before = new Set(activeLevel(prev).objects.map((o) => o.id));
        const added = activeLevel(st).objects.filter((o) => !before.has(o.id) && o.catalogId === p.catalogId);
        if (added.length)
          setTimeout(() =>
            store.getState().exec(
              batch(
                added.map((o) =>
                  updateObject(st.levelId, o.id, {
                    materialOverrides: { ...o.materialOverrides, [p.slot]: p.materialId },
                  }),
                ),
                'command.setMaterial',
              ),
            ),
          );
      }),
    [store],
  );
  const projectId = useEditor((s) => s.projectId);
  const snapPrefs = usePrefs((s) => s.snap);
  const planStyle = usePrefs((s) => s.planStyle);
  const underlay = useUnderlay((s) => s.rec);
  // 照度熱度圖（FE-LGT-03）
  const luxOn = useLuxOverlay((s) => s.on);
  const luxLevel = useEditor(activeLevel);
  const lux = useMemo(() => (luxOn ? illuminance(luxLevel, catalog) : null), [luxOn, luxLevel]);
  const heatmap = useMemo(
    () =>
      lux
        ? { step: lux.step, cells: lux.cells.map((c) => ({ x: c.x, z: c.z, color: luxColor(c.lux) })) }
        : null,
    [lux],
  );
  useEffect(() => useLuxResult.getState().set(lux), [lux]);
  useEffect(() => {
    void useUnderlay.getState().load(projectId);
  }, [projectId]);
  const saveStatus = useEditor((s) => s.saveStatus);
  // 專案縮圖（FE-PRJ-01）：存檔完成後擷取目前畫面（最多每 20 秒一次）
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const last = Number(sessionStorage.getItem(`thumbAt:${projectId}`) ?? 0);
    if (Date.now() - last < 20_000) return;
    const h = window.setTimeout(() => {
      const url = view === '3d' ? viewer3dApi.get()?.screenshot() : plan2dApi.get()?.snapshot(960);
      if (!url) return;
      sessionStorage.setItem(`thumbAt:${projectId}`, String(Date.now()));
      void shrink(url, 640).then((u) => setProjectThumb(projectId, u));
      // 自動版本（FE-SHR-04）：距上一個自動版本 ≥ 10 分鐘
      const lastV = Number(localStorage.getItem(`autoVersionAt:${projectId}`) ?? 0);
      if (Date.now() - lastV >= 10 * 60_000) {
        localStorage.setItem(`autoVersionAt:${projectId}`, String(Date.now()));
        void captureThumb(view).then((thumb) =>
          addVersion(projectId, {
            name: t('versions.autoName'),
            auto: true,
            scene: store.getState().scene,
            ...(thumb ? { thumb } : {}),
          }),
        );
      }
    }, 800);
    return () => window.clearTimeout(h);
  }, [saveStatus, revision, projectId, view, store, t]);
  const actions = useMemo(() => editActions(store), [store]);
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  // 留言釘選（FE-SHR-03）
  const comments = commentsOf(scene);
  const commentUi = useComments();
  const pins2d = useMemo(
    () =>
      comments
        .filter((c) => c.levelId === levelId)
        .map((c) => ({
          id: c.id,
          x: c.position[0],
          z: c.position[2],
          label: String(comments.indexOf(c) + 1),
          resolved: c.resolved,
          active: commentUi.active === c.id,
        })),
    [comments, levelId, commentUi.active],
  );
  const pins3d = useMemo(
    () =>
      pins2d.map((p) => ({
        ...p,
        position: [p.x, comments.find((c) => c.id === p.id)?.position[1] ?? 1200, p.z] as [
          number,
          number,
          number,
        ],
      })),
    [pins2d, comments],
  );
  useEffect(() => {
    if (!commentUi.placing) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && useComments.getState().set({ placing: false });
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [commentUi.placing]);
  const openPin = useCallback((id: string) => {
    useComments.getState().set({ active: id });
    setPanel('comments');
  }, []);
  // 下一層（淡色參考）
  const ghost = useMemo(() => {
    const cur = scene.levels.find((l) => l.id === levelId);
    return cur
      ? ([...scene.levels]
          .filter((l) => l.elevation < cur.elevation)
          .sort((a, b) => b.elevation - a.elevation)[0] ?? null)
      : null;
  }, [scene, levelId]);
  const askArray = async () => {
    const r = await prompt.ask(t('ctx.array'), [
      { key: 'count', label: t('ctx.arrayCount'), value: '3', type: 'number' },
      { key: 'dx', label: t('ctx.arrayDx'), value: '600', type: 'number' },
      { key: 'dz', label: t('ctx.arrayDz'), value: '0', type: 'number' },
    ]);
    if (r) actions.array(Math.round(Number(r.count) || 0), [Number(r.dx) || 0, Number(r.dz) || 0]);
  };
  useShortcuts(store, setMode, { palette: openPalette, help: openHelp, togglePanels });
  const tt = useCallback((k: string, v?: Record<string, string | number>) => t(k, v), [t]);

  /** 拖放點：2D 以畫布座標、3D 以地面射線 */
  const dropPoint = (x: number, y: number) =>
    view === '2d' ? plan2dApi.get()?.clientToWorld([x, y]) : viewer3dApi.get()?.clientToFloor(x, y);
  /**
   * 資產放置位置（拖放與 3D 拖曳預覽共用）：壁掛物與靠牆家具自動貼牆並背靠牆、疊放到桌面／櫃面。
   * 門窗不能直接拖放（改用門窗工具）→ null。
   */
  const placementFor = (
    entry: CatalogEntry,
    pt: readonly number[],
  ): { position: [number, number, number]; rotationY: number } | null => {
    if (entry.model.kind === 'parametric' && ['door', 'window'].includes(entry.model.type)) return null;
    const s = store.getState();
    const lvl = activeLevel(s);
    let pos: [number, number] = [Math.round(pt[0]!), Math.round(pt[1]!)];
    let rot = 0;
    const dims = objectDims(entry);
    if (s.snapEnabled && entry.anchor !== 'ceiling') {
      const sn = snapToWall(lvl, pos, dims.d, entry.anchor === 'wall' ? 1500 : 250);
      if (sn) [pos, rot] = [sn.pos, sn.rotationY];
    }
    // 疊放吸附（FE-V3D-04）：拖到桌面／櫃面上
    const y =
      stackElevation(lvl, catalog, { catalogId: entry.id }, pos, rot) ?? defaultElevation(entry, lvl.height);
    return { position: [pos[0], y, pos[1]], rotationY: rot };
  };
  /** 3D 拖曳預覽：游標下即時顯示半透明物件（與放下的結果相同） */
  const ghostFrame = useRef(0);
  const onDragOverCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setFileOver(true);
    const p = dragPayload.get();
    if (view !== '3d' || !p) return;
    const { clientX, clientY } = e;
    if (ghostFrame.current) return;
    ghostFrame.current = requestAnimationFrame(() => {
      ghostFrame.current = 0;
      const pt = viewer3dApi.get()?.clientToFloor(clientX, clientY);
      if (!pt || !dragPayload.get()) return placementGhost.set([]);
      if (p.kind === 'set') {
        const set = FURNITURE_SETS.find((x) => x.id === p.id);
        placementGhost.set(set ? setLayout(set, [Math.round(pt[0]), Math.round(pt[1])]) : []);
        return;
      }
      const entry = catalog.get(p.id);
      const place = entry ? placementFor(entry, pt) : null;
      placementGhost.set(entry && place ? [{ catalogId: entry.id, ...place }] : []);
    });
  };

  /** 拖放資產（FE-V3D-02）；拖放模型檔 → 上傳 */
  const onDrop = (e: React.DragEvent) => {
    setFileOver(false);
    placementGhost.set([]);
    const files = Array.from(e.dataTransfer.files);
    if (files.length && hasModelFile(files)) {
      e.preventDefault();
      requestModelUpload(files);
      return;
    }
    // 材質拖到 3D 表面（FE-V3D-05）
    const matId = e.dataTransfer.getData('application/x-interiorai-material');
    if (matId && view === '3d') {
      e.preventDefault();
      const hit = viewer3dApi.get()?.pickSurface(e.clientX, e.clientY);
      const s = store.getState();
      const lvl = activeLevel(s);
      if (!hit) return;
      if (hit.kind === 'wall')
        s.exec(setMaterial(s.levelId, { kind: 'wall', id: hit.id, side: hit.side }, matId));
      else if (hit.kind === 'floor' || hit.kind === 'ceiling')
        s.exec(setMaterial(s.levelId, { kind: hit.kind, roomId: hit.id }, matId));
      else if (hit.kind === 'object') {
        const o = lvl.objects.find((x) => x.id === hit.id);
        const slot = o && catalog.get(o.catalogId)?.materialSlots[0]?.name;
        if (slot) s.exec(setMaterial(s.levelId, { kind: 'object', id: hit.id, slot }, matId));
      }
      return;
    }
    // 家具套組（FE-AST-06）
    const setId = e.dataTransfer.getData('application/x-interiorai-set');
    const set = setId ? FURNITURE_SETS.find((x) => x.id === setId) : undefined;
    if (set) {
      const at =
        view === '2d'
          ? plan2dApi.get()?.clientToWorld([e.clientX, e.clientY])
          : viewer3dApi.get()?.clientToFloor(e.clientX, e.clientY);
      if (at) {
        e.preventDefault();
        placeSetAt(store, set, [Math.round(at[0]), Math.round(at[1])]);
      }
      return;
    }
    const catId = e.dataTransfer.getData('application/x-interiorai-catalog');
    const entry = catalog.get(catId);
    const pt = dropPoint(e.clientX, e.clientY);
    const place = entry && pt ? placementFor(entry, pt) : null;
    if (!entry || !place) return;
    e.preventDefault();
    const s = store.getState();
    const lvl = activeLevel(s);
    const before = new Set(lvl.objects.map((o) => o.id));
    if (
      s.exec(
        addObject(s.levelId, { catalogId: entry.id, position: place.position, rotationY: place.rotationY }),
      )
    ) {
      const added = activeLevel(store.getState()).objects.find((o) => !before.has(o.id));
      if (added) s.select([added.id]);
      recordRecent(entry.id);
    }
  };

  return (
    <div
      className="game-ui flex h-full flex-col"
      style={{ ['--left-w' as string]: `${panelW.left}px`, ['--right-w' as string]: `${panelW.right}px` }}
    >
      <a href="#canvas" className="sr-only focus:not-sr-only">
        {t('app.skip')}
      </a>
      {!presenting && (
        <TopBar
          onPresent={startPresent}
          mode={mode}
          setMode={setMode}
          setPanel={setPanel}
          onHelp={() => setTour(true)}
          panels={{ left: showLeft, right: showRight, setLeft: setShowLeft, setRight: setShowRight }}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {showLeft && !presenting && (
          <>
            <LeftPanel />
            <ResizeHandle
              side="left"
              width={panelW.left}
              def={300}
              onChange={(v) => setPanelW({ left: v })}
            />
          </>
        )}
        <main
          id="canvas"
          className="relative min-w-0 flex-1 bg-bg"
          onDragOver={onDragOverCanvas}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setFileOver(false);
            placementGhost.set([]);
          }}
          onDrop={onDrop}
          tabIndex={-1}
          aria-label={t(view === '2d' ? 'top.view2d' : 'top.view3d')}
        >
          {fileOver && (
            <div
              className="pointer-events-none absolute inset-2 z-30 grid place-items-center border-2 border-dashed border-primary bg-primary/10 text-sm text-primary"
              data-testid="file-drop-hint"
            >
              {t('upload.dropHint')}
            </div>
          )}
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
                ghostLevel={ghost}
                snapSettings={snapPrefs}
                planStyle={planStyle}
                underlay={underlay}
                heatmap={heatmap}
                pins={pins2d}
                onPinClick={openPin}
                onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, world: e.world })}
                requestText={async (initial) =>
                  (
                    await prompt.ask(t('tools.text'), [
                      { key: 'text', label: t('tools.textPrompt'), value: initial },
                    ])
                  )?.text ?? null
                }
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
                displayMode={displayMode}
                levelsMode={levelsMode}
                section={section}
                pins={pins3d}
                onPinClick={openPin}
                onPerfLow={() => {
                  const g = usePrefs.getState().graphics;
                  const next =
                    g.quality === 'ultra' ? 'balanced' : g.quality === 'balanced' ? 'performance' : null;
                  if (!next) return;
                  usePrefs.getState().setGraphics({ quality: next });
                  store.getState().notify('info', t('perf.lowered', { q: t(`gfx.qualities.${next}`) }));
                }}
                onContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, world: e.world })}
              />
            )}
          </CanvasBoundary>
          {view === '3d' && !presenting && (
            <ViewportHud
              showCeiling={showCeiling}
              setShowCeiling={setShowCeiling}
              onPanorama={async () => {
                store.getState().notify('info', t('gallery.rendering'));
                await new Promise((r) => setTimeout(r, 30));
                const it = await capturePanorama(
                  projectId,
                  `${t('gallery.kind.panorama')} ${new Date().toLocaleString()}`,
                );
                if (it) setPanel('gallery');
              }}
            />
          )}
          {!presenting && <LevelBar ask={prompt.ask} />}
          {commentUi.placing && (
            <div
              className="absolute inset-0 z-20 cursor-crosshair"
              data-testid="comment-overlay"
              onClick={async (e) => {
                const w =
                  view === '2d'
                    ? plan2dApi.get()?.clientToWorld([e.clientX, e.clientY])
                    : viewer3dApi.get()?.clientToFloor(e.clientX, e.clientY);
                useComments.getState().set({ placing: false });
                if (!w) return;
                const r = await prompt.ask(t('comments.add'), [
                  { key: 'text', label: t('comments.text'), value: '' },
                ]);
                if (!r?.text?.trim()) return;
                const cmd = addComment({
                  levelId,
                  position: [Math.round(w[0]), view === '3d' ? 1200 : 0, Math.round(w[1])],
                  author: useComments.getState().name || t('comments.me'),
                  text: r.text.trim(),
                });
                if (store.getState().exec(cmd)) openPin(cmd.commentId);
              }}
            >
              <p className="hud-panel pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs">
                {t('comments.placeHint')}
              </p>
            </div>
          )}
          {presenting && <Presentation onExit={stopPresent} />}
          {menu && (
            <ContextMenu
              state={menu}
              actions={actions}
              onClose={() => setMenu(null)}
              onArray={() => void askArray()}
            />
          )}
          {prompt.node}
        </main>
        {showRight && !presenting && (
          <>
            <ResizeHandle
              side="right"
              width={panelW.right}
              def={320}
              onChange={(v) => setPanelW({ right: v })}
            />
            <Inspector uniformScale={uniformScale} setUniformScale={setUniformScale} />
          </>
        )}
      </div>
      {!presenting && <BottomBar />}
      <FurnishDialog open={panel === 'furnish'} onOpenChange={(v) => setPanel(v ? 'furnish' : null)} />
      <AssistantPanel open={panel === 'assistant'} onOpenChange={(v) => setPanel(v ? 'assistant' : null)} />
      <QuotePanel open={panel === 'quote'} onOpenChange={(v) => setPanel(v ? 'quote' : null)} />
      <GalleryPanel open={panel === 'gallery'} onOpenChange={(v) => setPanel(v ? 'gallery' : null)} />
      <ShareDialog open={panel === 'share'} onOpenChange={(v) => setPanel(v ? 'share' : null)} />
      <CommentsPanel open={panel === 'comments'} onOpenChange={(v) => setPanel(v ? 'comments' : null)} />
      <VersionsPanel open={panel === 'versions'} onOpenChange={(v) => setPanel(v ? 'versions' : null)} />
      <MoodboardPanel open={panel === 'mood'} onOpenChange={(v) => setPanel(v ? 'mood' : null)} />
      <ExportDialog open={panel === 'export'} onOpenChange={(v) => setPanel(v ? 'export' : null)} />
      <ProjectInfoDialog open={panel === 'info'} onOpenChange={(v) => setPanel(v ? 'info' : null)} />
      <HistoryPanel open={panel === 'history'} onOpenChange={(v) => setPanel(v ? 'history' : null)} />
      <ShortcutsDialog open={panel === 'shortcuts'} onOpenChange={(v) => setPanel(v ? 'shortcuts' : null)} />
      <UploadModelDialog
        open={panel === 'upload'}
        initialFiles={uploadFiles}
        onOpenChange={(v) => {
          setPanel(v ? 'upload' : null);
          if (!v) setUploadFiles(null);
        }}
      />
      <CommandPalette
        open={panel === 'palette'}
        onOpenChange={(v) => setPanel(v ? 'palette' : null)}
        panels={paletteCmds}
      />
      <Tour open={tour} onClose={() => setTour(false)} />
    </div>
  );
}

type Panel =
  | 'furnish'
  | 'assistant'
  | 'quote'
  | 'gallery'
  | 'share'
  | 'export'
  | 'info'
  | 'history'
  | 'shortcuts'
  | 'palette'
  | 'mood'
  | 'versions'
  | 'comments'
  | 'upload';

function TopBar({
  mode,
  setMode,
  setPanel,
  onHelp,
  panels,
  onPresent,
}: {
  mode: TransformMode;
  setMode: (m: TransformMode) => void;
  setPanel: (p: Panel) => void;
  onHelp: () => void;
  panels: { left: boolean; right: boolean; setLeft: (v: boolean) => void; setRight: (v: boolean) => void };
  onPresent: () => void;
}) {
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
      <IconButton label={t('projectInfo.title')} onClick={() => setPanel('info')} testId="open-info">
        <Info size={18} aria-hidden />
      </IconButton>
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
      <IconButton label={t('versions.title')} onClick={() => setPanel('versions')} testId="open-versions">
        <GitBranch size={18} aria-hidden />
      </IconButton>
      <IconButton label={t('history.title')} onClick={() => setPanel('history')} testId="open-history">
        <History size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={t('top.toggleLeft')}
        pressed={panels.left}
        onClick={() => panels.setLeft(!panels.left)}
        testId="toggle-left"
      >
        <PanelLeft size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={t('top.toggleRight')}
        pressed={panels.right}
        onClick={() => panels.setRight(!panels.right)}
        testId="toggle-right"
      >
        <PanelRight size={18} aria-hidden />
      </IconButton>
      <div className="mx-2 h-6 w-px bg-border" />
      <div role="radiogroup" aria-label={t('top.view2d')} className="hud-seg" data-tour="view">
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
      <div className="mx-2 h-6 w-px bg-border" />
      <div className="flex items-center gap-1" data-tour="ai">
        <IconButton label={t('furnish.title')} onClick={() => setPanel('furnish')} testId="open-furnish">
          <Wand2 size={18} aria-hidden />
        </IconButton>
        <IconButton
          label={t('assistant.title')}
          onClick={() => setPanel('assistant')}
          testId="open-assistant"
        >
          <Bot size={18} aria-hidden />
        </IconButton>
        <IconButton label={t('mood.title')} onClick={() => setPanel('mood')} testId="open-mood">
          <Palette size={18} aria-hidden />
        </IconButton>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <OfflineBadge />
        <label className="hidden items-center gap-1 text-xs 2xl:flex">
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
        <div className="flex items-center gap-1" data-tour="output">
          <IconButton label={t('quote.title')} onClick={() => setPanel('quote')} testId="open-quote">
            <Receipt size={18} aria-hidden />
          </IconButton>
          <IconButton label={t('gallery.title')} onClick={() => setPanel('gallery')} testId="open-gallery">
            <Images size={18} aria-hidden />
          </IconButton>
          <IconButton label={t('comments.title')} onClick={() => setPanel('comments')} testId="open-comments">
            <MessageSquare size={18} aria-hidden />
          </IconButton>
          <IconButton label={t('share.title')} onClick={() => setPanel('share')} testId="open-share">
            <Share2 size={18} aria-hidden />
          </IconButton>
          <IconButton label={t('present.start')} onClick={onPresent} testId="open-present">
            <Presentation2 size={18} aria-hidden />
          </IconButton>
          <IconButton label={t('exports.title')} onClick={() => setPanel('export')} testId="open-export">
            <Download size={18} aria-hidden />
          </IconButton>
          {view === '3d' && <RenderPanel />}
        </div>
        <IconButton label={t('tour.help')} onClick={onHelp} testId="open-tour">
          <CircleHelp size={18} aria-hidden />
        </IconButton>
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
  onPanorama,
}: {
  showCeiling: boolean;
  setShowCeiling: (v: boolean) => void;
  onPanorama: () => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const cams = useEditor((s) => s.scene.cameras?.length ?? 0);
  const {
    viewStyle,
    setViewStyle,
    lighting,
    setLighting,
    displayMode,
    setDisplayMode,
    levelsMode,
    setLevelsMode,
  } = usePrefs();
  const tool = useEditor((s) => s.tool);
  const levelCount = useEditor((s) => s.scene.levels.length);
  return (
    <div
      className="hud-panel absolute top-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1 p-1.5"
      role="toolbar"
      aria-label={t('top.view3d')}
    >
      <IconButton
        label={t('top.walk')}
        testId="walk-toggle"
        onClick={() => {
          const api = viewer3dApi.get();
          api?.walk(!api.isWalking());
          store.getState().notify('info', t('top.walkHint'));
        }}
      >
        <Footprints size={18} aria-hidden />
      </IconButton>
      <BookmarksMenu />
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
      <IconButton label={t('gallery.pano')} testId="hud-pano" onClick={onPanorama}>
        <Globe2 size={18} aria-hidden />
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
      <IconButton
        label={t('tools.measure')}
        pressed={tool === 'measure'}
        testId="hud-measure"
        onClick={() => store.getState().setTool(tool === 'measure' ? 'select' : 'measure')}
      >
        <Ruler size={18} aria-hidden />
      </IconButton>
      <label className="flex items-center gap-1 text-xs">
        <span className="sr-only">{t('top.display')}</span>
        <select
          className="field w-24 font-sans"
          value={displayMode}
          onChange={(e) => setDisplayMode(e.target.value as typeof displayMode)}
          data-testid="view-display"
        >
          {(['real', 'clay', 'wire', 'xray'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`top.displayModes.${m}`)}
            </option>
          ))}
        </select>
      </label>
      {levelCount > 1 && (
        <select
          className="field w-28 font-sans"
          aria-label={t('top.levelsMode')}
          value={levelsMode}
          onChange={(e) => setLevelsMode(e.target.value as typeof levelsMode)}
          data-testid="view-levels"
        >
          {(['active', 'below', 'all'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`top.levelsModes.${m}`)}
            </option>
          ))}
        </select>
      )}
      <SectionControl />
      <select
        className="field w-20 font-sans"
        aria-label={t('top.lens')}
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'two') viewer3dApi.get()?.twoPoint();
          else if (v) viewer3dApi.get()?.setLens(Number(v));
        }}
        data-testid="view-lens"
      >
        <option value="">{t('top.lens')}</option>
        {[16, 24, 35, 50, 85].map((mm) => (
          <option key={mm} value={mm}>{`${mm} mm`}</option>
        ))}
        <option value="two">{t('top.twoPoint')}</option>
      </select>
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
