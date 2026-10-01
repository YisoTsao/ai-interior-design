import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, LayoutTemplate, Sparkles } from 'lucide-react';
import {
  createEditorStore,
  FURNISH_STYLES,
  saveProject,
  updateLevel,
  type FurnishStyle,
} from '@interiorai/app-state';
import type { Scene } from '@interiorai/scene-schema';
import { HudDialog } from '../editor/HudDialog';
import { ImportPlanButton } from '../features/plan-review/ImportPlanButton';
import { buildSampleScene } from '../sample';
import { buildTemplateScene, TEMPLATE_IDS, templateInfo, type TemplateId } from '../templates';
import { floorplanScene, type FloorplanEntry } from '../floorplans';
import { FloorplanLibrary } from './FloorplanLibrary';
import { usePrefs } from '../prefs';

type Tab = 'blank' | 'template' | 'library' | 'import';

/**
 * 新建專案精靈（FE-PRJ-03）：空白（名稱、樓高、單位）／範本（套房、兩房、三房 × 風格，可選擇是否佈置）／
 * 範例專案／匯入平面圖。
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { lengthUnit, setLength, areaUnit } = usePrefs();
  const [tab, setTab] = useState<Tab>('blank');
  const [name, setName] = useState('');
  const [height, setHeight] = useState(2800);
  const [tpl, setTpl] = useState<TemplateId | 'sample'>('twoBed');
  const [style, setStyle] = useState<FurnishStyle>('nordic');
  const [furnish, setFurnish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<FloorplanEntry | null>(null);

  const create = async (scene: Scene, fallbackName: string) => {
    setBusy(true);
    try {
      const s = createEditorStore();
      const id = s.getState().projectId;
      await saveProject({ id, name: name.trim() || fallbackName, scene });
      onOpenChange(false);
      onCreated(id);
    } finally {
      setBusy(false);
    }
  };
  const createBlank = () => {
    const s = createEditorStore();
    s.getState().exec(updateLevel(s.getState().levelId, { height }));
    return create(s.getState().scene, t('projects.untitled'));
  };
  const createTemplate = () => {
    const names = (k: string) => t(`templates.rooms.${k}`);
    if (tpl === 'sample')
      return create(
        buildSampleScene({ living: names('living'), bed1: names('bed1'), bed2: names('bed2') }),
        t('projects.sampleName'),
      );
    return create(
      buildTemplateScene(tpl, { names, style, furnish, height }),
      `${t(`templates.${tpl}`)} · ${t(`furnish.style.${style}`)}`,
    );
  };
  const createLibrary = () => {
    if (!plan) return;
    const names = (k: string) => t(`templates.rooms.${k}`);
    return create(
      floorplanScene(plan, names),
      plan.source === 'sample'
        ? `${t(`templates.${plan.template!.id}`)} ${plan.ping} ${t('units.ping')}`
        : plan.name,
    );
  };
  const area = (m2: number) =>
    areaUnit === 'ping' ? `${(m2 / 3.3058).toFixed(0)} ${t('units.ping')}` : `${m2.toFixed(0)} m²`;

  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('wizard.title')}
      testId="new-project-dialog"
      width={720}
      footer={
        tab === 'import' ? null : (
          <>
            <button className="btn" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || (tab === 'library' && !plan)}
              onClick={() =>
                void (tab === 'blank'
                  ? createBlank()
                  : tab === 'library'
                    ? createLibrary()
                    : createTemplate())
              }
              data-testid="wizard-create"
            >
              <FilePlus2 size={16} aria-hidden /> {t('wizard.create')}
            </button>
          </>
        )
      }
    >
      <div className="hud-seg mb-4" role="tablist">
        {(['blank', 'template', 'library', 'import'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            data-testid={`wizard-tab-${k}`}
          >
            {t(`wizard.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab !== 'import' && (
        <label className="mb-3 block text-xs">
          <span className="mb-1 block text-muted">{t('wizard.name')}</span>
          <input
            className="field w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projects.untitled')}
            data-testid="wizard-name"
          />
        </label>
      )}
      {tab !== 'import' && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted">{t('wizard.height')}</span>
            <input
              className="field w-full"
              type="number"
              min={2000}
              max={6000}
              step={50}
              value={height}
              onChange={(e) => setHeight(Math.max(2000, Math.min(6000, Number(e.target.value) || 2800)))}
              data-testid="wizard-height"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted">{t('units.length')}</span>
            <select
              className="field w-full"
              value={lengthUnit}
              onChange={(e) => setLength(e.target.value as typeof lengthUnit)}
            >
              {(['mm', 'cm', 'm'] as const).map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {tab === 'blank' && <p className="text-xs text-muted">{t('wizard.blankHint')}</p>}
      {tab === 'template' && (
        <>
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-4" role="radiogroup">
            {[...TEMPLATE_IDS, 'sample' as const].map((id) => (
              <li key={id}>
                <button
                  className="inv-slot h-full w-full p-3 text-left"
                  data-active={tpl === id}
                  aria-pressed={tpl === id}
                  onClick={() => setTpl(id)}
                  data-testid={`tpl-${id}`}
                >
                  <LayoutTemplate size={20} className="mb-1 text-primary" aria-hidden />
                  <span className="block text-sm font-medium">{t(`templates.${id}`)}</span>
                  <span className="block text-xs text-muted">
                    {id === 'sample'
                      ? t('templates.sampleDesc')
                      : t('templates.desc', {
                          area: area(templateInfo(id).areaM2),
                          rooms: templateInfo(id).rooms,
                        })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {tpl !== 'sample' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={furnish}
                  onChange={(e) => setFurnish(e.target.checked)}
                  data-testid="tpl-furnish"
                />
                <Sparkles size={14} aria-hidden /> {t('wizard.furnish')}
              </label>
              {furnish && (
                <div className="hud-seg" role="radiogroup" aria-label={t('furnish.styleLabel')}>
                  {FURNISH_STYLES.map((s) => (
                    <button key={s} aria-pressed={style === s} onClick={() => setStyle(s)}>
                      {t(`furnish.style.${s}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'library' && <FloorplanLibrary selected={plan} onSelect={setPlan} />}
      {tab === 'import' && (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-muted">{t('wizard.importHint')}</p>
          <ImportPlanButton className="btn btn-primary" />
        </div>
      )}
    </HudDialog>
  );
}
