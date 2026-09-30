import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyPlus, Download } from 'lucide-react';
import {
  createEditorStore,
  projectInfoOf,
  saveProject,
  setProjectInfo,
  type ProjectInfo,
} from '@interiorai/app-state';
import { download } from '../media';
import { exportProjectFile, PROJECT_EXT } from '../projectFile';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';

/** 專案屬性（FE-PRJ-07）：地址、客戶、預算、備註；另存新檔；匯出專案檔（FE-PRJ-06） */
export function ProjectInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  // 選取器回傳 scene（穩定參考），在外面計算，避免每次回傳新物件造成重繪迴圈
  const info = projectInfoOf(useEditor((s) => s.scene));
  const name = useEditor((s) => s.projectName);
  const [saveAs, setSaveAs] = useState('');
  const patch = (p: ProjectInfo) => store.getState().exec(setProjectInfo(p));
  const text = (k: 'address' | 'client' | 'notes', multiline = false) => {
    const common = {
      className: 'field w-full',
      defaultValue: info[k] ?? '',
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        e.target.value !== (info[k] ?? '') && patch({ [k]: e.target.value }),
      'data-testid': `info-${k}`,
    };
    return (
      <label className="block text-xs">
        <span className="mb-1 block text-muted">{t(`projectInfo.${k}`)}</span>
        {multiline ? <textarea rows={4} {...common} /> : <input {...common} />}
      </label>
    );
  };
  const doSaveAs = async () => {
    const s = store.getState();
    const id = createEditorStore().getState().projectId;
    const nm = saveAs.trim() || t('projects.copyName', { name });
    await saveProject({ id, name: nm, scene: s.scene });
    window.location.href = `/p/${id}/edit`;
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('projectInfo.title')}
      testId="project-info"
      width={520}
    >
      <div className="space-y-3">
        {text('client')}
        {text('address')}
        <label className="block text-xs">
          <span className="mb-1 block text-muted">{t('projectInfo.budget')}</span>
          <input
            className="field w-full"
            type="number"
            min={0}
            step={10000}
            defaultValue={info.budget ?? ''}
            onBlur={(e) => {
              const v = e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value)));
              if (v !== info.budget) patch({ budget: v });
            }}
            data-testid="info-budget"
          />
        </label>
        {text('notes', true)}
        <div className="hud-section space-y-2 p-3">
          <p className="text-xs text-muted">{t('projectInfo.saveAsHint')}</p>
          <div className="flex gap-2">
            <input
              className="field flex-1"
              placeholder={t('projects.copyName', { name })}
              value={saveAs}
              onChange={(e) => setSaveAs(e.target.value)}
              aria-label={t('projectInfo.saveAs')}
            />
            <button className="btn" onClick={() => void doSaveAs()} data-testid="save-as">
              <CopyPlus size={14} aria-hidden /> {t('projectInfo.saveAs')}
            </button>
          </div>
          <button
            className="btn"
            onClick={async () =>
              download(
                await exportProjectFile(store.getState().scene, name),
                `${name || 'project'}${PROJECT_EXT}`,
              )
            }
            data-testid="export-project-file"
          >
            <Download size={14} aria-hidden /> {t('projects.exportFile')}
          </button>
        </div>
      </div>
    </HudDialog>
  );
}
