import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Box, Copy, Footprints, Globe2, Map as MapIcon, PenLine } from 'lucide-react';
import { createEditorStore, saveProject } from '@interiorai/app-state';
import type { Scene } from '@interiorai/scene-schema';
import { Plan2D } from '@interiorai/editor-2d';
import { lonToward, PanoramaViewer, Viewer3D, viewer3dApi } from '@interiorai/viewer-3d';
import { detectRooms, pointInPolygon } from '@interiorai/core-geometry';
import { catalog, useCatalogVersion, useMaterials } from '../catalogData';
import { LangToggle } from '../editor/common';
import { usePrefs } from '../prefs';
import { decodeShare, type SharePayload } from '../share';
import { ApprovalDialog } from './ApprovalDialog';
import { useCanvasTheme } from '../theme';

type Tab = '2d' | '3d' | 'pano';

/**
 * 分享檢視頁（FE-SHR-01）：唯讀的 2D／3D／720° 全景分頁，手機可看。場景來自 URL hash（#s=…）。
 * 唯讀：store 的 exec 一律拒絕（可選取、查看，不能改）。可「複製到我的專案」後編輯。
 */
export function ShareViewPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<SharePayload | null>(null);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const m = /[#&]s=([^&]+)/.exec(window.location.hash);
    if (!m) return setErr(t('share.invalid'));
    decodeShare(m[1]!)
      .then(setData)
      .catch((e: unknown) =>
        setErr(t('share.broken', { message: e instanceof Error ? e.message : String(e) })),
      );
  }, [t]);
  if (err)
    return (
      <main className="game-ui grid h-full place-items-center bg-bg p-6 text-center" role="alert">
        <div className="space-y-3">
          <p>{err}</p>
          <Link to="/" className="btn">
            {t('top.back')}
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <div className="grid h-full place-items-center text-muted" aria-busy="true">
        …
      </div>
    );
  // 多方案（FE-SHR-06）：0＝主方案，其餘為替代方案
  const schemes = [{ name: t('approval.mainScheme'), scene: data.scene }, ...data.schemes];
  const cur = schemes[Math.min(pick, schemes.length - 1)]!;
  return (
    <ShareBody
      key={pick}
      name={data.name}
      scene={cur.scene}
      schemes={schemes.map((x) => x.name)}
      pick={pick}
      onPick={setPick}
      approval={data.approval}
    />
  );
}

function ShareBody({
  name,
  scene,
  schemes,
  pick,
  onPick,
  approval,
}: {
  name: string;
  scene: Scene;
  schemes: string[];
  pick: number;
  onPick: (i: number) => void;
  approval: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const { t } = useTranslation();
  const theme = useCanvasTheme();
  const { lengthUnit, areaUnit, graphics } = usePrefs();
  const catalogVersion = useCatalogVersion();
  const materials = useMaterials();
  const store = useMemo(() => {
    const s = createEditorStore({ projectName: name, scene });
    s.setState({ exec: () => false });
    (window as unknown as { __share: unknown }).__share = s;
    return s;
  }, [name, scene]);
  const [tab, setTab] = useState<Tab>('3d');
  const [lighting, setLighting] = useState<'day' | 'night'>('day');
  const tt = useCallback((k: string, v?: Record<string, string | number>) => t(k, v), [t]);

  // 全屋全景導覽（FE-RND-02）：每個房間中央（人眼高 1.6 m）一張全景，熱點跳轉其他房間
  const [tour, setTour] = useState<{ id: string; name: string; c: [number, number]; url: string }[]>([]);
  const [cur, setCur] = useState(0);
  const makePano = () => {
    const v = viewer3dApi.get();
    if (!v) return;
    const lv = scene.levels[0]!;
    const byKey = new Map(lv.rooms.map((r) => [[...r.wallIds].sort().join('|'), r]));
    const rooms = detectRooms(lv)
      .rooms.map((d) => {
        const n = d.floor.length || 1;
        let c: [number, number] = [
          d.floor.reduce((a, p) => a + p[0], 0) / n,
          d.floor.reduce((a, p) => a + p[1], 0) / n,
        ];
        if (!pointInPolygon(c, d.floor)) c = [d.floor[0]![0] + 300, d.floor[0]![1] + 300];
        const r = byKey.get(d.key);
        return { id: r?.id ?? d.key, label: r?.label, c, area: d.netArea };
      })
      .filter((r) => r.area > 2e6)
      .slice(0, 12)
      .map((r, i) => ({ ...r, name: r.label || `${t('room.unnamed')} ${i + 1}` }));
    const list = rooms
      .map((r) => ({ ...r, url: v.panorama({ width: 3072, at: [r.c[0], 1600, r.c[1]] }) ?? '' }))
      .filter((r) => r.url);
    const single = list.length ? null : v.panorama({ width: 3072 });
    setTour(list.length ? list : single ? [{ id: 'here', name: name, c: [0, 0], url: single }] : []);
    setCur(0);
    if (list.length || single) setTab('pano');
  };
  const pano = tour[cur]?.url ?? null;
  const hotspots = useMemo(
    () =>
      tour
        .filter((_, i) => i !== cur)
        .map((r) => ({ id: r.id, label: r.name, lonDeg: lonToward(tour[cur]!.c, r.c) })),
    [tour, cur],
  );
  const copyToMine = async () => {
    const id = createEditorStore().getState().projectId;
    await saveProject({ id, name: t('projects.copyName', { name }), scene });
    window.location.href = `/p/${id}/edit`;
  };

  return (
    <div className="game-ui flex h-full flex-col bg-bg" data-testid="share-view">
      <header className="hud-bar flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-2 whitespace-nowrap">
        <span className="font-[Rajdhani] text-lg font-bold tracking-widest text-primary" aria-hidden>
          INTERIOR<span className="text-accent">AI</span>
        </span>
        <h1 className="truncate text-sm font-medium" data-testid="share-name">
          {name || t('projects.untitled')}
        </h1>
        <span className="hud-chip">{t('share.readOnly')}</span>
        {schemes.length > 1 && (
          <select
            className="field w-36 py-0.5 text-xs"
            value={pick}
            onChange={(e) => onPick(Number(e.target.value))}
            aria-label={t('approval.pickScheme')}
            data-testid="share-scheme"
          >
            {schemes.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
        )}
        <div className="hud-seg ml-auto" role="tablist">
          <button
            role="tab"
            aria-pressed={tab === '2d'}
            aria-selected={tab === '2d'}
            onClick={() => setTab('2d')}
          >
            <MapIcon size={14} aria-hidden /> {t('top.view2d')}
          </button>
          <button
            role="tab"
            aria-pressed={tab === '3d'}
            aria-selected={tab === '3d'}
            onClick={() => setTab('3d')}
            data-testid="share-3d"
          >
            <Box size={14} aria-hidden /> {t('top.view3d')}
          </button>
          <button
            role="tab"
            aria-pressed={tab === 'pano'}
            aria-selected={tab === 'pano'}
            onClick={() => (pano ? setTab('pano') : tab === '3d' && makePano())}
            disabled={!pano && tab !== '3d'}
            data-testid="share-pano"
          >
            <Globe2 size={14} aria-hidden /> {t('share.pano')}
          </button>
        </div>
        <LangToggle />
        {approval && (
          <button className="btn" onClick={() => setApproveOpen(true)} data-testid="share-approve">
            <PenLine size={14} aria-hidden /> {t('approval.open')}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => void copyToMine()} data-testid="share-copy">
          <Copy size={14} aria-hidden /> {t('share.copyToMine')}
        </button>
      </header>
      <main className="relative min-h-0 flex-1">
        {tab === '2d' && (
          <Plan2D
            store={store}
            catalog={catalog}
            t={tt}
            lengthUnit={lengthUnit}
            areaUnit={areaUnit}
            theme={theme}
          />
        )}
        {tab === '3d' && (
          <>
            <Viewer3D
              store={store}
              catalog={catalog}
              materials={materials}
              theme={theme}
              transformMode="translate"
              uniformScale
              viewStyle="dollhouse"
              lighting={lighting}
              graphics={graphics}
              catalogVersion={catalogVersion}
            />
            <div className="hud-panel absolute top-3 left-3 flex gap-1 p-1.5">
              <button
                className="hud-chip"
                aria-pressed={lighting === 'day'}
                onClick={() => setLighting('day')}
              >
                {t('top.lightingDay')}
              </button>
              <button
                className="hud-chip"
                aria-pressed={lighting === 'night'}
                onClick={() => setLighting('night')}
              >
                {t('top.lightingNight')}
              </button>
              <button
                className="hud-chip"
                onClick={() => {
                  const api = viewer3dApi.get();
                  api?.walk(!api.isWalking());
                }}
              >
                <Footprints size={12} aria-hidden /> {t('top.walk')}
              </button>
            </div>
          </>
        )}
        {tab === 'pano' && pano && (
          <>
            <PanoramaViewer
              src={pano}
              hotspots={hotspots}
              onHotspot={(id) =>
                setCur(
                  Math.max(
                    0,
                    tour.findIndex((r) => r.id === id),
                  ),
                )
              }
              labels={{ gyroOn: t('share.gyroOn'), gyroOff: t('share.gyroOff') }}
            />
            {tour.length > 1 && (
              <span
                className="hud-chip absolute top-2 left-2"
                data-testid="pano-room"
                data-room={tour[cur]?.id}
              >
                {tour[cur]?.name}
              </span>
            )}
          </>
        )}
      </main>
      {approval && (
        <ApprovalDialog
          open={approveOpen}
          onOpenChange={setApproveOpen}
          project={name}
          scheme={schemes[pick] ?? ''}
          scene={scene}
        />
      )}
    </div>
  );
}
