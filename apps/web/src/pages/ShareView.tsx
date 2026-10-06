import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Box, Copy, Footprints, Globe2, Map as MapIcon } from 'lucide-react';
import { createEditorStore, saveProject } from '@interiorai/app-state';
import type { Scene } from '@interiorai/scene-schema';
import { Plan2D } from '@interiorai/editor-2d';
import { PanoramaViewer, Viewer3D, viewer3dApi } from '@interiorai/viewer-3d';
import { catalog, useCatalogVersion, useMaterials } from '../catalogData';
import { LangToggle } from '../editor/common';
import { usePrefs } from '../prefs';
import { decodeShare } from '../share';
import { useCanvasTheme } from '../theme';

type Tab = '2d' | '3d' | 'pano';

/**
 * 分享檢視頁（FE-SHR-01）：唯讀的 2D／3D／720° 全景分頁，手機可看。場景來自 URL hash（#s=…）。
 * 唯讀：store 的 exec 一律拒絕（可選取、查看，不能改）。可「複製到我的專案」後編輯。
 */
export function ShareViewPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<{ name: string; scene: Scene } | null>(null);
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
  return <ShareBody name={data.name} scene={data.scene} />;
}

function ShareBody({ name, scene }: { name: string; scene: Scene }) {
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
  const [pano, setPano] = useState<string | null>(null);
  const [lighting, setLighting] = useState<'day' | 'night'>('day');
  const tt = useCallback((k: string, v?: Record<string, string | number>) => t(k, v), [t]);

  const makePano = () => {
    const url = viewer3dApi.get()?.panorama({ width: 3072 });
    if (url) {
      setPano(url);
      setTab('pano');
    }
  };
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
        {tab === 'pano' && pano && <PanoramaViewer src={pano} />}
      </main>
    </div>
  );
}
