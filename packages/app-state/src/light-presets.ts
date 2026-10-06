import type { Catalog } from '@interiorai/catalog';
import type { Level, LightOverride } from '@interiorai/scene-schema';
import { batch } from './edit-ops.js';
import { updateObject } from './commands.js';
import type { Command } from './history.js';

/**
 * 燈光方案（FE-LGT-02）：一鍵調整所有燈具的開關、色溫、亮度（相對目錄預設流明）與顏色；單一 undo。
 * 保留使用者設定的方向（tilt／pan）、光束角與陰影。
 */
export const LIGHT_PRESETS = ['cozy', 'bright', 'cinema', 'party', 'reset'] as const;
export type LightPreset = (typeof LIGHT_PRESETS)[number];
const PARTY = ['#ff3d7f', '#7c4dff', '#00e5ff', '#ffd400', '#39ff88'];
const CEILING_TYPES = new Set(['lamp_downlight', 'lamp_pendant', 'lamp_chandelier', 'lamp_track']);

export function lightingPreset(
  levelId: string,
  level: Level,
  catalog: Catalog,
  preset: LightPreset,
): Command | null {
  const cmds: Command[] = [];
  let k = 0;
  for (const o of level.objects) {
    const e = catalog.get(o.catalogId);
    const L = e?.light;
    if (!e || !L) continue;
    const type = e.model.kind === 'parametric' ? e.model.type : '';
    const keep: LightOverride = {
      ...(o.light?.tiltDeg !== undefined ? { tiltDeg: o.light.tiltDeg } : {}),
      ...(o.light?.panDeg !== undefined ? { panDeg: o.light.panDeg } : {}),
      ...(o.light?.beamDeg !== undefined ? { beamDeg: o.light.beamDeg } : {}),
      ...(o.light?.castShadow !== undefined ? { castShadow: o.light.castShadow } : {}),
    };
    const lm = (f: number) => Math.round(L.lumens * f);
    let light: LightOverride;
    switch (preset) {
      case 'cozy':
        light = { ...keep, on: true, kelvin: 2700, lumens: lm(0.6) };
        break;
      case 'bright':
        light = { ...keep, on: true, kelvin: 4000, lumens: lm(1.25) };
        break;
      case 'cinema':
        // 天花主燈關閉，只留低位的氛圍光
        light =
          CEILING_TYPES.has(type) || e.anchor === 'ceiling'
            ? { ...keep, on: false }
            : { ...keep, on: true, kelvin: 2400, lumens: lm(0.35) };
        break;
      case 'party':
        light = { ...keep, on: true, color: PARTY[k++ % PARTY.length]!, lumens: lm(0.8) };
        break;
      case 'reset':
        light = keep;
        break;
    }
    cmds.push(updateObject(levelId, o.id, { light }));
  }
  return cmds.length ? batch(cmds, 'command.lightPreset') : null;
}
