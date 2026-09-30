import { useTranslation } from 'react-i18next';
import { ImagePlus, Ruler, Trash2 } from 'lucide-react';
import { plan2dApi, type PlanStyle } from '@interiorai/editor-2d';
import { usePrefs } from '../prefs';
import { useEditorStore } from './context';
import { NumberField, Section, SliderField, ToggleField } from './fields';
import { underlayFromFile, useUnderlay } from './underlay';

/**
 * 平面圖設定（2D）：顯示樣式（FE-PLAN-12）、格線與吸附（FE-PLAN-13）、描圖底圖（FE-PLAN-11）。
 * 底圖比例校正：先用測量工具量一段已知長度，再輸入實際長度。
 */
export function PlanSettings() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const { planStyle, setPlanStyle, snap, setSnap } = usePrefs();
  const { rec, update, replace } = useUnderlay();
  const calibrate = () => {
    const pts = plan2dApi.get()?.measurePoints() ?? [];
    if (pts.length < 2 || !rec) return store.getState().notify('warn', t('plan.calibrateNeed'));
    const [a, b] = pts as [[number, number], [number, number]];
    const measured = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const input = window.prompt(t('plan.calibratePrompt', { mm: Math.round(measured) }));
    const real = input ? Number(input) : NaN;
    if (!(real > 0) || measured <= 0) return;
    const k = real / measured;
    // 以量測起點為中心縮放，讓該點在圖上的位置不變
    update({
      widthMm: Math.round(rec.widthMm * k),
      x: Math.round(a[0] - (a[0] - rec.x) * k),
      z: Math.round(a[1] - (a[1] - rec.z) * k),
    });
    store.getState().notify('info', t('plan.calibrated', { k: k.toFixed(3) }));
  };
  return (
    <>
      <Section title={t('plan.title')} testId="section-plan">
        <div className="hud-seg" role="radiogroup" aria-label={t('plan.style')}>
          {(['blueprint', 'color', 'mono'] as PlanStyle[]).map((s) => (
            <button
              key={s}
              aria-pressed={planStyle === s}
              onClick={() => setPlanStyle(s)}
              data-testid={`plan-style-${s}`}
            >
              {t(`plan.styles.${s}`)}
            </button>
          ))}
        </div>
        <ToggleField
          label={t('plan.showGrid')}
          checked={snap.showGrid}
          onChange={(v) => setSnap({ showGrid: v })}
        />
        <NumberField
          label={t('plan.gridMm')}
          value={snap.gridMm}
          step={10}
          suffix="mm"
          onCommit={(v) => setSnap({ gridMm: Math.max(10, Math.min(1000, Math.round(v))) })}
          testId="plan-grid"
        />
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>{t('plan.angle')}</span>
          <select
            className="field w-24"
            value={snap.angleDeg}
            onChange={(e) => setSnap({ angleDeg: Number(e.target.value) })}
            data-testid="plan-angle"
          >
            {[5, 15, 30, 45, 90].map((d) => (
              <option key={d} value={d}>{`${d}°`}</option>
            ))}
          </select>
        </label>
        <fieldset className="grid grid-cols-2 gap-1 text-xs">
          <legend className="mb-1 text-muted">{t('plan.snapTo')}</legend>
          {(['endpoint', 'wall', 'angle', 'grid'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={snap.targets[k]}
                onChange={(e) => setSnap({ targets: { ...snap.targets, [k]: e.target.checked } })}
                data-testid={`snap-${k}`}
              />
              {t(`plan.targets.${k}`)}
            </label>
          ))}
        </fieldset>
      </Section>
      <Section title={t('plan.underlay')} defaultOpen={!!rec} testId="section-underlay">
        {!rec ? (
          <label className="btn w-full cursor-pointer justify-center">
            <ImagePlus size={14} aria-hidden /> {t('plan.underlayAdd')}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="underlay-file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) replace(await underlayFromFile(f));
                e.target.value = '';
              }}
            />
          </label>
        ) : (
          <>
            <ToggleField
              label={t('plan.underlayVisible')}
              checked={rec.visible}
              onChange={(v) => update({ visible: v })}
            />
            <SliderField
              label={t('plan.opacity')}
              value={Math.round(rec.opacity * 100)}
              min={5}
              max={100}
              step={5}
              suffix="%"
              onCommit={(v) => update({ opacity: v / 100 })}
            />
            <NumberField
              label={t('plan.width')}
              value={rec.widthMm}
              step={100}
              suffix="mm"
              onCommit={(v) => update({ widthMm: Math.max(500, Math.round(v)) })}
              testId="underlay-width"
            />
            <SliderField
              label={t('plan.rotation')}
              value={rec.rotationDeg}
              min={-180}
              max={180}
              step={0.5}
              suffix="°"
              onCommit={(v) => update({ rotationDeg: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="X"
                value={rec.x}
                step={100}
                suffix="mm"
                onCommit={(v) => update({ x: Math.round(v) })}
              />
              <NumberField
                label="Z"
                value={rec.z}
                step={100}
                suffix="mm"
                onCommit={(v) => update({ z: Math.round(v) })}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="btn flex-1 justify-center"
                onClick={calibrate}
                data-testid="underlay-calibrate"
              >
                <Ruler size={14} aria-hidden /> {t('plan.calibrate')}
              </button>
              <button className="icon-btn" title={t('plan.underlayRemove')} onClick={() => replace(null)}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
            <p className="text-[11px] text-muted">{t('plan.calibrateHint')}</p>
          </>
        )}
      </Section>
    </>
  );
}
