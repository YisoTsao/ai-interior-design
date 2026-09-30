import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Pause, Play, StickyNote, X } from 'lucide-react';
import { presentationNotesOf, setPresentationNote } from '@interiorai/app-state';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { useEditor, useEditorStore } from './context';

const NO_CAMS: never[] = [];

/**
 * 簡報模式（FE-SHR-02）：全螢幕、隱藏編輯介面，依相機書籤逐頁切換（←／→、空白鍵播放、Esc 離開），
 * 可自動輪播（每頁 6 秒），講者備註可編輯（存在場景中）。
 */
export function Presentation({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const cams = useEditor((s) => s.scene.cameras) ?? NO_CAMS;
  const notes = presentationNotesOf(useEditor((s) => s.scene));
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const cam = cams[i];
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const onFs = () => !document.fullscreenElement && onExit();
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onExit]);
  useEffect(() => {
    if (cam) viewer3dApi.get()?.setCamera(cam);
    else viewer3dApi.get()?.frameAll();
  }, [cam]);
  useEffect(() => {
    if (!playing || cams.length < 2) return;
    const h = window.setInterval(() => setI((x) => (x + 1) % cams.length), 6000);
    return () => window.clearInterval(h);
  }, [playing, cams.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setI((x) => Math.min(cams.length - 1, x + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'Escape') onExit();
      else return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [cams.length, onExit]);
  return (
    <div
      className="game-ui pointer-events-none fixed inset-0 z-[55]"
      style={{ background: 'transparent' }}
      data-testid="presentation"
    >
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 hud-panel px-3 py-2">
        <button
          className="icon-btn"
          onClick={() => setI((x) => Math.max(0, x - 1))}
          aria-label={t('present.prev')}
          disabled={i === 0}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="min-w-40 text-center text-sm" data-testid="present-title">
          {cam ? `${i + 1} / ${cams.length} · ${cam.name}` : t('present.noCams')}
        </span>
        <button
          className="icon-btn"
          onClick={() => setI((x) => Math.min(cams.length - 1, x + 1))}
          aria-label={t('present.next')}
          disabled={i >= cams.length - 1}
          data-testid="present-next"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
        <button
          className="icon-btn"
          onClick={() => setPlaying(!playing)}
          aria-label={t(playing ? 'present.pause' : 'present.play')}
          aria-pressed={playing}
        >
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowNotes(!showNotes)}
          aria-label={t('present.notes')}
          aria-pressed={showNotes}
        >
          <StickyNote size={16} aria-hidden />
        </button>
        <button
          className="icon-btn"
          onClick={onExit}
          aria-label={t('present.exit')}
          data-testid="present-exit"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {showNotes && cam && (
        <div className="pointer-events-auto absolute right-4 bottom-20 w-80 hud-panel p-3">
          <p className="mb-1 text-xs text-muted">{t('present.notes')}</p>
          <textarea
            key={cam.id}
            className="field h-32 w-full"
            defaultValue={notes[cam.id] ?? ''}
            onBlur={(e) =>
              e.target.value !== (notes[cam.id] ?? '') &&
              store.getState().exec(setPresentationNote(cam.id, e.target.value))
            }
            data-testid="present-note"
          />
        </div>
      )}
    </div>
  );
}
