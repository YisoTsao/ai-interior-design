import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { Section } from '@interiorai/viewer-3d';

/** 剖切狀態（FE-V3D-07；檢視用，不存入場景） */
export const useSection = create<{ section: Section; set(s: Section): void }>((set) => ({
  section: { kind: 'none' },
  set: (section) => set({ section }),
}));

/** HUD 的剖切控制：無／水平（高度）／沿 X／沿 Z，滑桿調位置 */
export function SectionControl() {
  const { t } = useTranslation();
  const { section, set } = useSection();
  const value = section.kind === 'h' ? section.y : section.kind === 'none' ? 0 : section.value;
  return (
    <span className="flex items-center gap-1">
      <select
        className="field w-24 font-sans"
        aria-label={t('section.title')}
        value={section.kind}
        onChange={(e) => {
          const k = e.target.value as Section['kind'];
          set(k === 'none' ? { kind: 'none' } : k === 'h' ? { kind: 'h', y: 1200 } : { kind: k, value: 0 });
        }}
        data-testid="view-section"
      >
        {(['none', 'h', 'x', 'z'] as const).map((k) => (
          <option key={k} value={k}>
            {t(`section.kinds.${k}`)}
          </option>
        ))}
      </select>
      {section.kind !== 'none' && (
        <input
          className="hud-range w-24"
          type="range"
          aria-label={t('section.position')}
          min={section.kind === 'h' ? 100 : -20000}
          max={section.kind === 'h' ? 3500 : 20000}
          step={section.kind === 'h' ? 50 : 100}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            set(section.kind === 'h' ? { kind: 'h', y: v } : ({ ...section, value: v } as Section));
          }}
          data-testid="section-slider"
        />
      )}
    </span>
  );
}
