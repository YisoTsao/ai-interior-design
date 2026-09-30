import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCompare, History, RotateCcw, Save, Trash2 } from 'lucide-react';
import { diffScenes, restoreScene, type SceneDiff } from '@interiorai/app-state';
import { plan2dApi } from '@interiorai/editor-2d';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { addVersion, listVersions, removeVersion, shrink, type VersionRecord } from '../media';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/** 擷取目前畫面縮圖（版本、專案封面共用） */
export async function captureThumb(view: '2d' | '3d'): Promise<string | undefined> {
  const url = view === '3d' ? viewer3dApi.get()?.screenshot() : plan2dApi.get()?.snapshot(800);
  return url ? shrink(url, 320) : undefined;
}

/**
 * 版本歷史（FE-SHR-04）：時間軸（自動每 10 分鐘一版、手動命名版本）、縮圖預覽、與目前比較
 * （新增／刪除／移動／修改，選取差異物件高亮）、還原（可 undo）。
 */
export function VersionsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const projectId = useEditor((s) => s.projectId);
  const view = useEditor((s) => s.view);
  const [list, setList] = useState<VersionRecord[]>([]);
  const [name, setName] = useState('');
  const [diff, setDiff] = useState<{ id: string; d: SceneDiff } | null>(null);
  const refresh = () => listVersions(projectId).then(setList);
  useEffect(() => {
    if (open) void refresh();
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    await addVersion(projectId, {
      name: name.trim() || t('versions.manual'),
      auto: false,
      scene: store.getState().scene,
      thumb: await captureThumb(view),
    });
    setName('');
    void refresh();
  };
  const count = (v: VersionRecord) => v.scene.levels.reduce((s, l) => s + l.objects.length, 0);
  return (
    <HudDialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setDiff(null);
      }}
      title={
        <span className="flex items-center gap-2">
          <History size={16} aria-hidden /> {t('versions.title')}
        </span>
      }
      side="right"
      width={420}
      testId="versions-panel"
    >
      <div className="mb-3 flex gap-2">
        <input
          className="field flex-1"
          placeholder={t('versions.namePlaceholder')}
          aria-label={t('versions.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="version-name"
        />
        <button className="btn btn-primary" onClick={() => void save()} data-testid="version-save">
          <Save size={14} aria-hidden /> {t('versions.save')}
        </button>
      </div>
      <p className="mb-2 text-[11px] text-muted">{t('versions.hint')}</p>
      {list.length === 0 && <p className="p-6 text-center text-sm text-muted">{t('versions.empty')}</p>}
      <ol className="relative space-y-2 border-l border-border pl-3" data-testid="version-list">
        {list.map((v) => (
          <li key={v.id} className="hud-section p-2" data-testid="version-row">
            <div className="flex gap-2">
              {v.thumb ? (
                <img src={v.thumb} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />
              ) : (
                <span className="h-14 w-20 shrink-0 rounded bg-bg" />
              )}
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-medium">
                  {v.name}
                  {v.auto && <span className="ml-1 text-muted">{`(${t('versions.auto')})`}</span>}
                </p>
                <p className="text-muted">{new Date(v.at).toLocaleString(i18n.language)}</p>
                <p className="text-muted">{t('versions.stats', { n: count(v) })}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              <button
                className="btn"
                onClick={() => {
                  const d = diffScenes(v.scene, store.getState().scene);
                  setDiff({ id: v.id, d });
                  const cur = store.getState();
                  const ids = [...d.added, ...d.moved, ...d.changed].filter((id) =>
                    cur.scene.levels.some(
                      (l) => l.objects.some((o) => o.id === id) || l.walls.some((w) => w.id === id),
                    ),
                  );
                  cur.select(ids);
                }}
                data-testid="version-compare"
              >
                <GitCompare size={12} aria-hidden /> {t('versions.compare')}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (store.getState().exec(restoreScene(v.scene)))
                    store.getState().notify('info', t('versions.restored', { name: v.name }));
                }}
                data-testid="version-restore"
              >
                <RotateCcw size={12} aria-hidden /> {t('versions.restore')}
              </button>
              <button
                className="icon-btn ml-auto"
                title={t('versions.delete')}
                onClick={async () => {
                  await removeVersion(projectId, v.id);
                  void refresh();
                }}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
            {diff?.id === v.id && (
              <p className="mt-2 text-[11px]" data-testid="version-diff">
                {t('versions.diff', {
                  added: diff.d.summary.objects[0],
                  removed: diff.d.summary.objects[1],
                  moved: diff.d.summary.objects[2],
                  changed: diff.d.summary.objects[3],
                  walls: diff.d.summary.walls[0] + diff.d.summary.walls[1] + diff.d.summary.walls[2],
                })}
              </p>
            )}
          </li>
        ))}
      </ol>
    </HudDialog>
  );
}
