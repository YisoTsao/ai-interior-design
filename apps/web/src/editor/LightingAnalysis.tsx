import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { luxColor, type LuxResult } from '../ai/illuminance';
import { Section, ToggleField } from './fields';

/** 照度熱度圖開關（2D 疊圖）；結果由編輯器計算後共用 */
export const useLuxOverlay = create<{ on: boolean; set(v: boolean): void }>((set) => ({
  on: false,
  set: (on) => set({ on }),
}));

/** 照度分析（FE-LGT-03）：各房間平均／最低／最高 lx 與建議範圍 */
export function LightingAnalysis({ result }: { result: LuxResult | null }) {
  const { t } = useTranslation();
  const { on, set } = useLuxOverlay();
  return (
    <Section title={t('lux.title')} defaultOpen={on} testId="section-lux">
      <ToggleField label={t('lux.heatmap')} checked={on} onChange={set} testId="lux-toggle" />
      {on && result && (
        <>
          <div className="flex items-center gap-1 text-[10px] text-muted" aria-hidden>
            {[0, 50, 150, 300, 750].map((v) => (
              <span key={v} className="flex items-center gap-0.5">
                <span className="inline-block h-2 w-3" style={{ background: luxColor(v) }} />
                {v}
              </span>
            ))}
            <span>{'lx'}</span>
          </div>
          <table className="w-full text-xs" data-testid="lux-table">
            <thead className="text-muted">
              <tr>
                <th className="text-left">{t('lux.room')}</th>
                <th className="text-right">{t('lux.avg')}</th>
                <th className="text-right">{t('lux.minmax')}</th>
                <th className="text-right">{t('lux.target')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rooms.map((r) => (
                <tr key={r.id} className={r.ok ? '' : 'text-warn'}>
                  <td>{r.label ?? t(`roomKinds.${r.kind}`)}</td>
                  <td className="text-right font-mono">{r.avg}</td>
                  <td className="text-right font-mono">{`${r.min}–${r.max}`}</td>
                  <td className="text-right font-mono">{`${r.range[0]}–${r.range[1]}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted">{t('lux.note')}</p>
        </>
      )}
    </Section>
  );
}
