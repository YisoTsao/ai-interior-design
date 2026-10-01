import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Copy, Lock, Trash2, Unlock } from 'lucide-react';
import {
  activeLevel,
  batch,
  updateAnnotation,
  deleteEntities,
  duplicateObjects,
  renameRoom,
  resizeWall,
  setEnvironment,
  setMaterial,
  transformObject,
  updateObject,
  updateOpening,
  updateRoom,
  updateWall,
  lightingPreset,
  LIGHT_PRESETS,
  angleDegrees,
} from '@interiorai/app-state';
import { objectDims, resolveParams, type CatalogEntry } from '@interiorai/catalog';
import { detectRooms, wallLength } from '@interiorai/core-geometry';
import { SunStudy } from './SunStudy';
import { PlanSettings } from './PlanSettings';
import { CabinetDesigner } from './CabinetDesigner';
import { CeilingSection, FeatureWallSection, KitchenSection, UvSection, WallFinishSection } from './finishes';
import { LightingAnalysis } from './LightingAnalysis';
import { useLuxResult } from './luxResult';
import { formatArea } from '@interiorai/editor-2d';
import type {
  Appearance,
  Level,
  LightOverride,
  Opening,
  OpeningStyle,
  RoomKind,
  SceneObject,
  Tiling,
  Wall,
} from '@interiorai/scene-schema';
import {
  DEFAULT_SKY,
  SUN_DEFAULT,
  areaLuminance,
  effectiveLight,
  fixtureLights,
  kelvinToHex,
  pointIntensity,
  spotIntensity,
  tileQuantity,
  viewer3dApi,
  type GraphicsQuality,
  type SkyPreset,
} from '@interiorai/viewer-3d';
import { catalog } from '../catalogData';
import { usePrefs } from '../prefs';
import { useEditor, useEditorStore } from './context';
import {
  ColorField,
  LengthField,
  NumberField,
  Section,
  SelectField,
  SliderField,
  ToggleField,
} from './fields';
import { mergeLook } from './look';
import { MaterialPicker } from './MaterialPicker';
import { editActions } from './actions';
import { useThumbnail } from './thumbs';
import { LightGroupField, LightScenesSection } from './LightScenes';
import { IesImport } from './IesImport';
import { useInspectorPrefs } from './inspectorPrefs';
import { StylePresetsSection } from './StylePresets';

export function Inspector({
  uniformScale,
  setUniformScale,
}: {
  uniformScale: boolean;
  setUniformScale: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const selection = useEditor((s) => s.selection);
  const level = activeLevel({ scene, levelId });

  let body: React.ReactNode = <ScenePanel level={level} />;
  if (selection.length > 1) {
    body = <MultiPanel ids={selection} level={level} />;
  } else if (selection.length === 1) {
    const id = selection[0]!;
    const w = level.walls.find((x) => x.id === id);
    const o = level.openings.find((x) => x.id === id);
    const obj = level.objects.find((x) => x.id === id);
    const room = level.rooms.find((x) => x.id === id);
    const ann = level.annotations?.find((x) => x.id === id);
    if (ann) body = <AnnotationPanel id={ann.id} type={ann.type} data={ann.data ?? {}} levelId={levelId} />;
    else if (w) body = <WallPanel w={w} level={level} />;
    else if (o) body = <OpeningPanel o={o} levelId={levelId} />;
    else if (room) {
      const d = detectRooms(level).rooms.find((x) => x.key === [...room.wallIds].sort().join('|'));
      body = <RoomPanel room={room} area={d?.netArea ?? 0} levelId={levelId} />;
    } else if (obj) {
      body = (
        <ObjectPanel
          obj={obj}
          levelId={levelId}
          uniformScale={uniformScale}
          setUniformScale={setUniformScale}
        />
      );
    }
  }
  return (
    <aside
      className="hud-panel hud-panel-right flex shrink-0 flex-col gap-3 overflow-y-auto p-3"
      style={{ width: 'var(--right-w, 320px)' }}
      aria-label={t('inspector.title')}
      data-tour="inspector"
    >
      <h2 className="hud-title">{t('inspector.title')}</h2>
      <InspectorTools />
      <StylePresetsSection />
      {body}
    </aside>
  );
}

/** 介面主題與密度（FE-UX-06） */
function UiSection() {
  const { t } = useTranslation();
  const { uiTheme, setUiTheme, density, setDensity } = usePrefs();
  return (
    <Section title={t('ui.title')} defaultOpen={false} testId="section-ui">
      <SelectField
        label={t('ui.theme')}
        value={uiTheme}
        onChange={setUiTheme}
        options={(['hud', 'pro', 'contrast'] as const).map((v) => ({ value: v, label: t(`ui.themes.${v}`) }))}
        testId="ui-theme"
      />
      <SelectField
        label={t('ui.density')}
        value={density}
        onChange={setDensity}
        options={(['comfortable', 'compact'] as const).map((v) => ({
          value: v,
          label: t(`ui.densities.${v}`),
        }))}
        testId="ui-density"
      />
    </Section>
  );
}

/** 屬性搜尋＋釘選分節跳轉（FE-PROP-07） */
function InspectorTools() {
  const { t } = useTranslation();
  const { query, setQuery, pins } = useInspectorPrefs();
  const jump = (title: string) => {
    const el = document.querySelector<HTMLElement>(`[data-section-title="${CSS.escape(title)}"]`);
    if (!el) return;
    const d = el.querySelector('details');
    if (d) d.open = true;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <div className="space-y-1">
      <input
        type="search"
        className="field w-full"
        placeholder={t('inspector.search')}
        aria-label={t('inspector.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="inspector-search"
      />
      {pins.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label={t('inspector.pinned')} data-testid="inspector-pins">
          {pins.map((p) => (
            <button key={p} className="hud-chip text-[10px]" onClick={() => jump(p)}>
              {t('inspector.pinChip', { name: p })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 物件 ──────────────────────────────────────────────────────────

function ObjectPanel({
  obj,
  levelId,
  uniformScale,
  setUniformScale,
}: {
  obj: SceneObject;
  levelId: string;
  uniformScale: boolean;
  setUniformScale: (v: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const exec = store.getState().exec;
  const id = obj.id;
  const e = catalog.get(obj.catalogId);
  const [designer, setDesigner] = useState(false);
  const thumb = useThumbnail(e);
  const dims = e ? objectDims(e, obj.params, obj.scale) : null;
  const params = e ? resolveParams(e, obj.params) : {};
  const catName = (i18n.language === 'en' ? e?.nameEn : e?.nameZh) ?? obj.catalogId;
  const [name, setName] = useState(obj.name ?? '');
  const look = (p: Partial<Appearance>) =>
    exec(updateObject(levelId, id, { appearance: mergeLook(obj.appearance, p) }));
  const a = obj.appearance ?? {};
  return (
    <div className="space-y-2" data-testid="inspector-object">
      <div className="hud-card">
        {thumb ? <img src={thumb} alt="" /> : <span className="h-10 w-14 bg-border" aria-hidden />}
        <div className="min-w-0 flex-1 space-y-1">
          <input
            className="field w-full py-0.5 font-sans text-sm font-semibold"
            aria-label={t('inspector.objName')}
            placeholder={catName}
            value={name}
            maxLength={60}
            data-testid="obj-name"
            onChange={(ev) => setName(ev.target.value)}
            onBlur={() =>
              name !== (obj.name ?? '') && exec(updateObject(levelId, id, { name: name.trim() || undefined }))
            }
            onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
          />
          <p className="truncate text-[11px] text-muted">{catName}</p>
          {dims && (
            <p className="font-mono text-[10px] text-muted">
              {t('assets.size', { w: Math.round(dims.w), d: Math.round(dims.d), h: Math.round(dims.h) })}
            </p>
          )}
        </div>
      </div>

      <Section title={t('inspector.transform')}>
        <NumberField
          label={t('inspector.posX')}
          value={obj.position[0]}
          suffix="mm"
          onCommit={(v) =>
            exec(transformObject(levelId, id, { position: [v, obj.position[1], obj.position[2]] }))
          }
          testId="obj-x"
        />
        <NumberField
          label={t('inspector.posZ')}
          value={obj.position[2]}
          suffix="mm"
          onCommit={(v) =>
            exec(transformObject(levelId, id, { position: [obj.position[0], obj.position[1], v] }))
          }
          testId="obj-z"
        />
        <NumberField
          label={t('inspector.posY')}
          value={obj.position[1]}
          suffix="mm"
          onCommit={(v) =>
            exec(transformObject(levelId, id, { position: [obj.position[0], v, obj.position[2]] }))
          }
        />
        <NumberField
          label={t('inspector.rotation')}
          value={Math.round((obj.rotationY * 180) / Math.PI)}
          suffix="°"
          onCommit={(v) => exec(transformObject(levelId, id, { rotationY: (v * Math.PI) / 180 }))}
          testId="obj-rot"
        />
        <NumberField
          label={t('inspector.scale')}
          value={Number((obj.scale?.[0] ?? 1).toFixed(3))}
          step={0.05}
          onCommit={(v) => {
            const s = obj.scale ?? [1, 1, 1];
            exec(
              transformObject(levelId, id, {
                scale: uniformScale ? [v, v * (s[1] / s[0]), v * (s[2] / s[0])] : [v, s[1], s[2]],
              }),
            );
          }}
        />
        <ToggleField label={t('inspector.uniform')} checked={uniformScale} onChange={setUniformScale} />
      </Section>

      {e?.model.kind === 'parametric' && Object.keys(e.model.params).length > 0 && (
        <Section title={t('inspector.params')}>
          {Object.entries(e.model.params).map(([k, spec]) =>
            spec.type === 'integer' ? (
              <NumberField
                key={k}
                label={t(spec.labelKey)}
                value={params[k] as number}
                onCommit={(v) =>
                  exec(updateObject(levelId, id, { params: { ...(obj.params ?? {}), [k]: v } }))
                }
              />
            ) : (
              <SelectField
                key={k}
                label={t(spec.labelKey)}
                value={String(params[k])}
                options={(spec.values ?? []).map((v) => ({
                  value: v,
                  label: t(ENUM_LABEL[k] ? `${ENUM_LABEL[k]}.${v}` : `inspector.swings.${v}`, {
                    defaultValue: v,
                  }),
                }))}
                onChange={(v) =>
                  exec(updateObject(levelId, id, { params: { ...(obj.params ?? {}), [k]: v } }))
                }
              />
            ),
          )}
        </Section>
      )}

      {e?.light && <LightSection obj={obj} entry={e} levelId={levelId} />}

      <Section title={t('inspector.appearance')} testId="section-appearance">
        <ColorField
          label={t('inspector.color')}
          value={a.color}
          fallback="#c8b8a0"
          onCommit={(c) => look({ color: c })}
          onReset={() => look({ color: undefined })}
          testId="obj-color"
        />
        <SliderField
          label={t('inspector.roughness')}
          value={a.roughness ?? 0.8}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => look({ roughness: v })}
          onReset={a.roughness !== undefined ? () => look({ roughness: undefined }) : undefined}
          testId="obj-roughness"
        />
        <SliderField
          label={t('inspector.metalness')}
          value={a.metalness ?? 0}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => look({ metalness: v })}
          onReset={a.metalness !== undefined ? () => look({ metalness: undefined }) : undefined}
        />
        <SliderField
          label={t('inspector.opacity')}
          value={a.opacity ?? 1}
          min={0.05}
          max={1}
          step={0.05}
          onCommit={(v) => look({ opacity: v >= 1 ? undefined : v })}
        />
        <ToggleField
          label={t('inspector.castShadow')}
          checked={a.castShadow ?? true}
          onChange={(v) => look({ castShadow: v ? undefined : false })}
        />
        <ToggleField
          label={t('inspector.hidden')}
          checked={!!a.hidden}
          onChange={(v) => look({ hidden: v || undefined })}
          testId="obj-hidden"
        />
        {e?.materialSlots.map((slot) => (
          <MaterialPicker
            key={slot.name}
            name={`slot-${slot.name}`}
            label={t('inspector.material')}
            value={obj.materialOverrides?.[slot.name] ?? slot.defaultMaterialId}
            categories={['fabric', 'wood', 'metal', 'floor', 'stone']}
            onPick={(m) => exec(setMaterial(levelId, { kind: 'object', id, slot: slot.name }, m))}
          />
        ))}
        {e?.model.kind === 'parametric' && !NO_EXTRA_SLOTS.has(e.model.type) && e.category !== 'lighting' && (
          <>
            <MaterialPicker
              name="slot-frame"
              label={t('inspector.slotFrame')}
              value={obj.materialOverrides?.frame}
              categories={['wood', 'metal', 'stone']}
              onPick={(m) => exec(setMaterial(levelId, { kind: 'object', id, slot: 'frame' }, m))}
            />
            <MaterialPicker
              name="slot-accent"
              label={t('inspector.slotAccent')}
              value={obj.materialOverrides?.accent}
              categories={['fabric', 'wood', 'metal']}
              onPick={(m) => exec(setMaterial(levelId, { kind: 'object', id, slot: 'accent' }, m))}
            />
          </>
        )}
      </Section>

      {e?.model.kind === 'parametric' && e.model.type === 'cabinet' && (
        <>
          <button
            className="btn w-full justify-center"
            onClick={() => setDesigner(true)}
            data-testid="open-cabinet-designer"
          >
            {t('cabinet.open')}
          </button>
          <CabinetDesigner open={designer} onOpenChange={setDesigner} obj={obj} entry={e} levelId={levelId} />
        </>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          className="btn"
          onClick={() => exec(updateObject(levelId, id, { locked: !obj.locked }))}
          aria-pressed={!!obj.locked}
        >
          {obj.locked ? <Lock size={14} aria-hidden /> : <Unlock size={14} aria-hidden />}{' '}
          {t('inspector.locked')}
        </button>
        <button
          className="btn"
          onClick={() => {
            const c = duplicateObjects(levelId, [id]);
            if (exec(c)) store.getState().select(c.newIds);
          }}
        >
          <Copy size={14} aria-hidden /> {t('inspector.duplicate')}
        </button>
        <button className="btn btn-danger" onClick={() => exec(deleteEntities(levelId, [id]))}>
          <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
        </button>
      </div>
    </div>
  );
}

/** 燈具光源（物理量）：光通量、色溫/RGB、光束角、邊緣柔化、俯仰/水平角、陰影、衰減距離 */
function LightSection({ obj, entry, levelId }: { obj: SceneObject; entry: CatalogEntry; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const spec = entry.light!;
  const ov: LightOverride = obj.light ?? {};
  const set = (p: Partial<LightOverride>) => exec(updateObject(levelId, obj.id, { light: mergeLook(ov, p) }));
  const eff = effectiveLight(obj, entry);
  const preset = resolveParams(entry, obj.params).color;
  const presetK = typeof preset === 'string' && /^\d{4}K$/.test(preset) ? Number(preset.slice(0, 4)) : 3000;
  const src = useMemo(() => fixtureLights({ objects: [obj] }, catalog)[0], [obj]);
  const beam = ov.beamDeg ?? spec.beamDeg ?? 60;
  const cd = src
    ? spec.kind === 'spot'
      ? spotIntensity(src.lumens, beam) / 1e6
      : spec.kind === 'point'
        ? pointIntensity(src.lumens) / 1e6
        : src.size
          ? areaLuminance(src.lumens, src.size.w, src.size.h)
          : 0
    : 0;
  const maxLm = Math.max(5000, Math.ceil((spec.lumens * 5) / 100) * 100);
  return (
    <Section
      title={t('light.title')}
      testId="section-light"
      right={
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: eff ? eff.color : '#333', boxShadow: eff ? `0 0 8px ${eff.color}` : 'none' }}
          aria-hidden
        />
      }
    >
      <LightGroupField obj={obj} levelId={levelId} />
      <IesImport obj={obj} entry={entry} levelId={levelId} />
      <ToggleField
        label={t('light.on')}
        checked={ov.on !== false}
        onChange={(v) => set({ on: v ? undefined : false })}
        testId="light-on"
      />
      <SliderField
        label={t('light.lumens')}
        value={ov.lumens ?? spec.lumens}
        min={0}
        max={maxLm}
        step={10}
        suffix="lm"
        onCommit={(v) => set({ lumens: v })}
        onReset={ov.lumens !== undefined ? () => set({ lumens: undefined }) : undefined}
        testId="light-lumens"
      />
      <SliderField
        label={t('light.kelvin')}
        value={ov.kelvin ?? presetK}
        min={1800}
        max={10000}
        step={100}
        suffix="K"
        kelvin
        onCommit={(v) => set({ kelvin: v, color: undefined })}
        onReset={ov.kelvin !== undefined ? () => set({ kelvin: undefined }) : undefined}
        testId="light-kelvin"
      />
      <ColorField
        label={t('light.rgb')}
        value={ov.color}
        fallback={ov.kelvin ? kelvinToHex(ov.kelvin) : (eff?.color ?? '#ffffff')}
        onCommit={(c) => set({ color: c })}
        onReset={() => set({ color: undefined })}
        testId="light-color"
      />
      {spec.kind === 'spot' && (
        <>
          <SliderField
            label={t('light.beam')}
            value={beam}
            min={5}
            max={170}
            step={1}
            suffix="°"
            onCommit={(v) => set({ beamDeg: v })}
            onReset={ov.beamDeg !== undefined ? () => set({ beamDeg: undefined }) : undefined}
            testId="light-beam"
          />
          <SliderField
            label={t('light.penumbra')}
            value={ov.penumbra ?? 0.8}
            min={0}
            max={1}
            step={0.05}
            onCommit={(v) => set({ penumbra: v })}
          />
        </>
      )}
      {spec.kind !== 'point' && (
        <>
          <SliderField
            label={t('light.tilt')}
            value={ov.tiltDeg ?? 0}
            min={-90}
            max={90}
            step={1}
            suffix="°"
            onCommit={(v) => set({ tiltDeg: v || undefined })}
            testId="light-tilt"
          />
          <SliderField
            label={t('light.pan')}
            value={ov.panDeg ?? 0}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onCommit={(v) => set({ panDeg: v || undefined })}
            testId="light-pan"
          />
        </>
      )}
      {spec.kind !== 'area' && (
        <>
          <ToggleField
            label={t('light.castShadow')}
            checked={ov.castShadow ?? spec.castShadow}
            onChange={(v) => set({ castShadow: v === spec.castShadow ? undefined : v })}
          />
          <SliderField
            label={t('light.softness')}
            value={ov.shadowSoftness ?? (spec.kind === 'spot' ? 5 : 4)}
            min={0}
            max={20}
            step={0.5}
            onCommit={(v) => set({ shadowSoftness: v })}
          />
          <SliderField
            label={t('light.range')}
            value={ov.rangeMm ?? 0}
            min={0}
            max={20000}
            step={100}
            suffix="mm"
            onCommit={(v) => set({ rangeMm: v || undefined })}
          />
        </>
      )}
      <div className="space-y-0.5 border-t border-border pt-2">
        <p className="hud-stat">
          <span>{t('light.statFlux')}</span>
          <b>{`${Math.round(src?.lumens ?? 0)} lm`}</b>
        </p>
        <p className="hud-stat">
          <span>{spec.kind === 'area' ? t('light.statLuminance') : t('light.statIntensity')}</span>
          <b>
            {cd.toFixed(1)} {spec.kind === 'area' ? 'cd/m²' : 'cd'}
          </b>
        </p>
        {spec.kind !== 'area' && (
          <p className="hud-stat">
            <span>{t('light.statLux2m')}</span>
            <b>{`${(cd / 4).toFixed(1)} lx`}</b>
          </p>
        )}
        <p className="hud-stat">
          <span>{t('light.statWatts')}</span>
          <b>{((src?.lumens ?? 0) / 100).toFixed(1)} W</b>
        </p>
      </div>
      <p className="text-[10px] text-muted">{t('light.nightOnly')}</p>
    </Section>
  );
}

// ── 牆 ──────────────────────────────────────────────────────────

function WallPanel({ w, level }: { w: Wall; level: Level }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const unit = usePrefs((s) => s.lengthUnit);
  const [keep, setKeep] = useState<'start' | 'end' | 'center'>('start');
  const levelId = level.id;
  const lookA = (p: Partial<Appearance>) =>
    exec(updateWall(levelId, w.id, { appearance: mergeLook(w.appearance, p) }));
  const lookB = (p: Partial<Appearance>) =>
    exec(updateWall(levelId, w.id, { appearanceB: mergeLook(w.appearanceB, p) }));
  return (
    <div className="space-y-2" data-testid="inspector-wall">
      <h3 className="font-medium">{t('inspector.wall')}</h3>
      <Section title={t('inspector.geometry')}>
        <LengthField
          label={t('inspector.length')}
          mm={wallLength(w)}
          unit={unit}
          onCommit={(mm) => exec(resizeWall(levelId, w.id, mm, keep))}
          testId="wall-length"
        />
        <SelectField
          label={t('inspector.keep')}
          value={keep}
          onChange={setKeep}
          options={[
            { value: 'start', label: t('inspector.keepStart') },
            { value: 'end', label: t('inspector.keepEnd') },
            { value: 'center', label: t('inspector.keepCenter') },
          ]}
        />
        <LengthField
          label={t('inspector.thickness')}
          mm={w.thickness}
          unit={unit}
          onCommit={(mm) => exec(updateWall(levelId, w.id, { thickness: mm }))}
          testId="wall-thickness"
        />
        <LengthField
          label={t('inspector.wallHeight')}
          mm={w.height ?? level.height}
          unit={unit}
          onCommit={(mm) => exec(updateWall(levelId, w.id, { height: mm >= level.height ? undefined : mm }))}
          testId="wall-height"
        />
        <SliderField
          label={t('inspector.baseboard')}
          value={w.baseboard ?? 0}
          min={0}
          max={300}
          step={10}
          suffix="mm"
          onCommit={(v) => exec(updateWall(levelId, w.id, { baseboard: v || undefined }))}
          testId="wall-baseboard"
        />
        <SelectField
          label={t('inspector.type')}
          value={w.type ?? 'partition'}
          onChange={(v) => exec(updateWall(levelId, w.id, { type: v }))}
          options={(['structural', 'exterior', 'partition', 'curtain'] as const).map((v) => ({
            value: v,
            label: t(`inspector.wallTypes.${v}`),
          }))}
        />
      </Section>
      <Section title={t('inspector.appearance')}>
        <ColorField
          label={t('inspector.colorA')}
          value={w.appearance?.color}
          fallback="#f2f0eb"
          onCommit={(c) => lookA({ color: c })}
          onReset={() => lookA({ color: undefined })}
          testId="wall-color"
        />
        <ColorField
          label={t('inspector.colorB')}
          value={w.appearanceB?.color}
          fallback={w.appearance?.color ?? '#f2f0eb'}
          onCommit={(c) => lookB({ color: c })}
          onReset={() => lookB({ color: undefined })}
        />
        <SliderField
          label={t('inspector.roughness')}
          value={w.appearance?.roughness ?? 0.9}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => lookA({ roughness: v })}
          onReset={w.appearance?.roughness !== undefined ? () => lookA({ roughness: undefined }) : undefined}
        />
        <ToggleField
          label={t('inspector.castShadow')}
          checked={w.appearance?.castShadow ?? true}
          onChange={(v) => lookA({ castShadow: v ? undefined : false })}
        />
        <ToggleField
          label={t('inspector.hidden')}
          checked={!!w.appearance?.hidden}
          onChange={(v) => lookA({ hidden: v || undefined })}
        />
      </Section>
      <TilingSection
        tiling={w.tilingA}
        area={wallLength(w) * (w.height ?? level.height)}
        onChange={(tl) => exec(updateWall(levelId, w.id, { tilingA: tl, tilingB: tl }))}
        defaults={{ pattern: 'straight', tileW: 300, tileH: 600, grout: 2 }}
      />
      <FeatureWallSection w={w} levelId={levelId} />
      <WallFinishSection w={w} levelId={levelId} />
      <UvSection
        look={w.appearance}
        onChange={(p) =>
          exec(
            updateWall(levelId, w.id, {
              appearance: mergeLook(w.appearance, p),
              appearanceB: mergeLook(w.appearanceB, p),
            }),
          )
        }
      />
      <Section title={t('inspector.materials')} defaultOpen={false}>
        <MaterialPicker
          name="wallA"
          label={t('inspector.sideA')}
          value={w.materialId}
          categories={['wall']}
          onPick={(m) => exec(setMaterial(levelId, { kind: 'wall', id: w.id, side: 'A' }, m))}
        />
        <MaterialPicker
          name="wallB"
          label={t('inspector.sideB')}
          value={w.materialIdB}
          categories={['wall']}
          onPick={(m) => exec(setMaterial(levelId, { kind: 'wall', id: w.id, side: 'B' }, m))}
        />
      </Section>
      <button className="btn btn-danger" onClick={() => exec(deleteEntities(levelId, [w.id]))}>
        <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
      </button>
    </div>
  );
}

// ── 門窗 ──────────────────────────────────────────────────────────

function OpeningPanel({ o, levelId }: { o: Opening; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const unit = usePrefs((s) => s.lengthUnit);
  const look = (p: Partial<Appearance>) =>
    exec(updateOpening(levelId, o.id, { appearance: mergeLook(o.appearance, p) }));
  return (
    <div className="space-y-2" data-testid="inspector-opening">
      <h3 className="font-medium">{t(`inspector.${o.type}`)}</h3>
      <Section title={t('inspector.geometry')}>
        <LengthField
          label={t('inspector.offset')}
          mm={o.offset}
          unit={unit}
          onCommit={(mm) => exec(updateOpening(levelId, o.id, { offset: mm }))}
        />
        <LengthField
          label={t('inspector.width')}
          mm={o.width}
          unit={unit}
          onCommit={(mm) => exec(updateOpening(levelId, o.id, { width: mm }))}
          testId="opening-width"
        />
        <LengthField
          label={t('inspector.height')}
          mm={o.height}
          unit={unit}
          onCommit={(mm) => exec(updateOpening(levelId, o.id, { height: mm }))}
        />
        {o.type === 'window' && (
          <LengthField
            label={t('inspector.sill')}
            mm={o.sill ?? 0}
            unit={unit}
            onCommit={(mm) => exec(updateOpening(levelId, o.id, { sill: mm }))}
          />
        )}
        {o.type !== 'passage' && (
          <SelectField<string>
            label={t('param.style')}
            value={o.style ?? (o.type === 'door' ? 'single' : 'sliding')}
            onChange={(v) => exec(updateOpening(levelId, o.id, { style: v as OpeningStyle }))}
            options={(o.type === 'door' ? DOOR_STYLES : WINDOW_STYLES).map((v) => ({
              value: v,
              label: t(`openingStyles.${v}`),
            }))}
          />
        )}
        {o.type === 'door' && !['sliding', 'folding', 'pocket', 'arch'].includes(o.style ?? '') && (
          <SliderField
            label={t('inspector.openAngle')}
            value={o.openAngle ?? 0}
            min={0}
            max={110}
            step={5}
            suffix="°"
            onCommit={(v) => exec(updateOpening(levelId, o.id, { openAngle: v || undefined }))}
          />
        )}
        {o.type === 'door' && (
          <SelectField
            label={t('inspector.swing')}
            value={o.swing ?? 'left'}
            onChange={(v) => exec(updateOpening(levelId, o.id, { swing: v }))}
            options={(['left', 'right', 'double', 'sliding', 'none'] as const).map((v) => ({
              value: v,
              label: t(`inspector.swings.${v}`),
            }))}
          />
        )}
      </Section>
      {o.type !== 'passage' && (
        <Section title={t('inspector.appearance')}>
          <ColorField
            label={t(o.type === 'door' ? 'inspector.doorColor' : 'inspector.frameColor')}
            value={o.appearance?.color}
            fallback={o.type === 'door' ? '#b89a78' : '#f4f2ee'}
            onCommit={(c) => look({ color: c })}
            onReset={() => look({ color: undefined })}
            testId="opening-color"
          />
          {o.type === 'window' && (
            <SliderField
              label={t('inspector.glassOpacity')}
              value={o.appearance?.opacity ?? 0.25}
              min={0.05}
              max={1}
              step={0.05}
              onCommit={(v) => look({ opacity: v })}
              onReset={o.appearance?.opacity !== undefined ? () => look({ opacity: undefined }) : undefined}
            />
          )}
          <ToggleField
            label={t('inspector.hidden')}
            checked={!!o.appearance?.hidden}
            onChange={(v) => look({ hidden: v || undefined })}
          />
        </Section>
      )}
      <button className="btn btn-danger" onClick={() => exec(deleteEntities(levelId, [o.id]))}>
        <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
      </button>
    </div>
  );
}

// ── 房間 ──────────────────────────────────────────────────────────

function RoomPanel({ room, area, levelId }: { room: Level['rooms'][number]; area: number; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const areaUnit = usePrefs((s) => s.areaUnit);
  const label = room.label ?? '';
  const [name, setName] = useState(label);
  const floorLook = (p: Partial<Appearance>) =>
    exec(updateRoom(levelId, room.id, { floorAppearance: mergeLook(room.floorAppearance, p) }));
  return (
    <div className="space-y-2" data-testid="inspector-room">
      <label className="grid gap-1 text-xs">
        <span>{t('inspector.roomName')}</span>
        <input
          className="field w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && exec(renameRoom(levelId, room.id, name))}
          onBlur={() => name !== label && exec(renameRoom(levelId, room.id, name))}
        />
      </label>
      <p className="hud-stat">
        <span>{t('inspector.area')}</span>
        <b>{formatArea(area, areaUnit)}</b>
      </p>
      <SelectField<string>
        label={t('room.kind')}
        value={room.kind ?? 'other'}
        onChange={(v) =>
          exec(updateRoom(levelId, room.id, { kind: v === 'other' ? undefined : (v as RoomKind) }))
        }
        options={ROOM_KINDS.map((k) => ({ value: k, label: t(`roomKinds.${k}`) }))}
      />
      <TilingSection
        tiling={room.floorTiling}
        area={area}
        onChange={(tl) => exec(updateRoom(levelId, room.id, { floorTiling: tl }))}
        withBorder
      />
      <Section title={t('inspector.floor')}>
        <MaterialPicker
          name="floor"
          label={t('inspector.floor')}
          value={room.floorMaterialId}
          categories={['floor']}
          onPick={(m) => exec(setMaterial(levelId, { kind: 'floor', roomId: room.id }, m))}
        />
        <ColorField
          label={t('inspector.tint')}
          value={room.floorAppearance?.color}
          fallback="#ffffff"
          onCommit={(c) => floorLook({ color: c })}
          onReset={() => floorLook({ color: undefined })}
        />
        <SliderField
          label={t('inspector.roughness')}
          value={room.floorAppearance?.roughness ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => floorLook({ roughness: v })}
          onReset={
            room.floorAppearance?.roughness !== undefined
              ? () => floorLook({ roughness: undefined })
              : undefined
          }
          testId="floor-roughness"
        />
      </Section>
      <Section title={t('inspector.ceiling')} defaultOpen={false}>
        <MaterialPicker
          name="ceiling"
          label={t('inspector.ceiling')}
          value={room.ceilingMaterialId ?? 'mat_ceiling_white'}
          categories={['ceiling', 'wall']}
          onPick={(m) => exec(setMaterial(levelId, { kind: 'ceiling', roomId: room.id }, m))}
        />
        <ColorField
          label={t('inspector.tint')}
          value={room.ceilingAppearance?.color}
          fallback="#ffffff"
          onCommit={(c) =>
            exec(
              updateRoom(levelId, room.id, {
                ceilingAppearance: mergeLook(room.ceilingAppearance, { color: c }),
              }),
            )
          }
          onReset={() =>
            exec(
              updateRoom(levelId, room.id, {
                ceilingAppearance: mergeLook(room.ceilingAppearance, { color: undefined }),
              }),
            )
          }
        />
      </Section>
      <UvSection look={room.floorAppearance} onChange={floorLook} title={t('uv.floorTitle')} />
      <CeilingSection room={room} levelId={levelId} />
      <KitchenSection room={room} />
    </div>
  );
}

// ── 場景（沒有選取時）：環境、畫質、統計 ──────────────────────────────

function ScenePanel({ level }: { level: Level }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const env = useEditor((s) => s.scene.environment) ?? {};
  const view = useEditor((s) => s.view);
  const exec = store.getState().exec;
  const { graphics, setGraphics, lighting, viewStyle } = usePrefs();
  const setEnv = (p: Parameters<typeof setEnvironment>[0]) => exec(setEnvironment(p));
  const stats = useMemo(() => {
    const lights = fixtureLights(level, catalog);
    const price = level.objects.reduce((a, o) => a + (catalog.get(o.catalogId)?.unitPriceTwd ?? 0), 0);
    return {
      lights: lights.length,
      lumens: Math.round(lights.reduce((a, l) => a + l.lumens, 0)),
      price,
    };
  }, [level]);
  const night = viewStyle === 'dollhouse' && lighting === 'night';
  const luxResult = useLuxResult((s) => s.result);
  return (
    <div className="space-y-2" data-testid="inspector-scene">
      <p className="text-xs text-muted">{t('inspector.none')}</p>
      {view === '2d' && <PlanSettings />}
      <Section title={t('env.title')} testId="section-env">
        <SelectField<SkyPreset>
          label={t('env.sky')}
          value={env.sky ?? DEFAULT_SKY}
          onChange={(v) => setEnv({ sky: v === DEFAULT_SKY ? undefined : v })}
          options={(['moonless', 'moonlit', 'city', 'dusk'] as const).map((v) => ({
            value: v,
            label: t(`env.skies.${v}`),
          }))}
        />
        <SliderField
          label={t('env.exposure')}
          value={env.exposureEv ?? 0}
          min={-3}
          max={3}
          step={0.1}
          suffix="EV"
          onCommit={(v) => setEnv({ exposureEv: v || undefined })}
          testId="env-exposure"
        />
        <SliderField
          label={t('env.ambient')}
          value={env.ambient ?? 1}
          min={0}
          max={3}
          step={0.05}
          suffix="×"
          onCommit={(v) => setEnv({ ambient: v === 1 ? undefined : v })}
        />
        <SliderField
          label={t('env.sunAzimuth')}
          value={env.sunAzimuthDeg ?? SUN_DEFAULT.azimuthDeg}
          min={-180}
          max={180}
          step={1}
          suffix="°"
          onCommit={(v) => setEnv({ sunAzimuthDeg: v })}
        />
        <SliderField
          label={t('env.sunElevation')}
          value={env.sunElevationDeg ?? SUN_DEFAULT.elevationDeg}
          min={5}
          max={90}
          step={1}
          suffix="°"
          onCommit={(v) => setEnv({ sunElevationDeg: v })}
        />
        <SliderField
          label={t('env.sunIntensity')}
          value={env.sunIntensity ?? SUN_DEFAULT.intensity}
          min={0}
          max={8}
          step={0.1}
          onCommit={(v) => setEnv({ sunIntensity: v })}
        />
        <p className="text-[10px] text-muted">{t(night ? 'env.hintNight' : 'env.hintDay')}</p>
      </Section>
      <Section title={t('gfx.title')} testId="section-gfx">
        <SelectField<GraphicsQuality>
          label={t('gfx.quality')}
          value={graphics.quality}
          onChange={(quality) => setGraphics({ quality })}
          options={(['performance', 'balanced', 'ultra'] as const).map((v) => ({
            value: v,
            label: t(`gfx.qualities.${v}`),
          }))}
        />
        <ToggleField label={t('gfx.ao')} checked={graphics.ao} onChange={(ao) => setGraphics({ ao })} />
        <ToggleField
          label={t('gfx.dynamicRes')}
          checked={graphics.dynamicRes ?? true}
          onChange={(dynamicRes) => setGraphics({ dynamicRes })}
          testId="gfx-dynamic-res"
        />
        <SliderField
          label={t('gfx.bloom')}
          value={graphics.bloom}
          min={0}
          max={2}
          step={0.1}
          onCommit={(bloom) => setGraphics({ bloom })}
        />
        <ToggleField
          label={t('gfx.beams')}
          checked={graphics.beams}
          onChange={(beams) => setGraphics({ beams })}
        />
        <ToggleField
          label={t('gfx.grade')}
          checked={graphics.grade}
          onChange={(grade) => setGraphics({ grade })}
        />
      </Section>
      {!night && <SunStudy />}
      <LightingAnalysis result={luxResult} />
      <Section title={t('lightPreset.title')} testId="section-light-preset">
        <div className="flex flex-wrap gap-1">
          {LIGHT_PRESETS.map((p) => (
            <button
              key={p}
              className="hud-chip"
              data-testid={`light-preset-${p}`}
              onClick={() => {
                const cmd = lightingPreset(level.id, level, catalog, p);
                if (cmd) exec(cmd);
                else store.getState().notify('info', t('lightPreset.none'));
              }}
            >
              {t(`lightPreset.${p}`)}
            </button>
          ))}
        </div>
      </Section>
      <LightScenesSection />
      <UiSection />
      <Section title={t('stats.title')}>
        <p className="hud-stat">
          <span>{t('stats.rooms')}</span>
          <b>{level.rooms.length}</b>
        </p>
        <p className="hud-stat">
          <span>{t('stats.objects')}</span>
          <b>{level.objects.length}</b>
        </p>
        <p className="hud-stat">
          <span>{t('stats.lights')}</span>
          <b>{`${stats.lights} · ${stats.lumens.toLocaleString()} lm`}</b>
        </p>
        <p className="hud-stat">
          <span>{t('stats.price')}</span>
          <b>{t('assets.price', { n: stats.price.toLocaleString() })}</b>
        </p>
      </Section>
      {view === '3d' && (
        <button
          className="btn w-full justify-center"
          data-testid="screenshot"
          onClick={() => {
            const url = viewer3dApi.get()?.screenshot();
            if (!url) return;
            const a = document.createElement('a');
            a.href = url;
            a.download = `interiorai-${Date.now()}.png`;
            a.click();
          }}
        >
          <Camera size={14} aria-hidden /> {t('top.screenshot')}
        </button>
      )}
    </div>
  );
}

// ── 多選批次編輯（FE-PROP-02）──────────────────────────────────────

function MultiPanel({ ids, level }: { ids: string[]; level: Level }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const exec = store.getState().exec;
  const act = useMemo(() => editActions(store), [store]);
  const objs = level.objects.filter((o) => ids.includes(o.id));
  const walls = level.walls.filter((w) => ids.includes(w.id));
  /** 共同值：全部相同才顯示，否則為「混合」 */
  const common = <T,>(xs: T[]): T | undefined =>
    xs.length && xs.every((x) => x === xs[0]) ? xs[0] : undefined;
  const color = common(objs.map((o) => o.appearance?.color));
  const rough = common(objs.map((o) => o.appearance?.roughness));
  const allHidden = objs.length > 0 && objs.every((o) => o.appearance?.hidden);
  const shadowOff = objs.length > 0 && objs.every((o) => o.appearance?.castShadow === false);
  const looks = (p: Partial<Appearance>) =>
    exec(
      batch(
        objs.map((o) => updateObject(level.id, o.id, { appearance: mergeLook(o.appearance, p) })),
        'command.batch',
      ),
    );
  const wallLooks = (p: Partial<Appearance>) =>
    exec(
      batch(
        walls.map((w) => updateWall(level.id, w.id, { appearance: mergeLook(w.appearance, p) })),
        'command.batch',
      ),
    );
  return (
    <div className="space-y-2" data-testid="inspector-multi">
      <p className="text-sm">{t('inspector.multi', { n: ids.length })}</p>
      <p className="text-[11px] text-muted">{t('multi.counts', { o: objs.length, w: walls.length })}</p>
      {objs.length > 0 && (
        <Section title={t('inspector.appearance')}>
          <ColorField
            label={t('inspector.color')}
            value={color}
            fallback="#c8b8a0"
            onCommit={(c) => looks({ color: c })}
            onReset={() => looks({ color: undefined })}
            testId="multi-color"
          />
          {color === undefined && objs.some((o) => o.appearance?.color) && (
            <p className="text-[10px] text-muted">{t('multi.mixed')}</p>
          )}
          <SliderField
            label={t('inspector.roughness')}
            value={rough ?? 0.8}
            min={0}
            max={1}
            step={0.05}
            onCommit={(v) => looks({ roughness: v })}
          />
          <ToggleField
            label={t('inspector.castShadow')}
            checked={!shadowOff}
            onChange={(v) => looks({ castShadow: v ? undefined : false })}
          />
          <ToggleField
            label={t('inspector.hidden')}
            checked={allHidden}
            onChange={(v) => looks({ hidden: v || undefined })}
          />
        </Section>
      )}
      {walls.length > 0 && (
        <Section title={t('multi.walls')}>
          <ColorField
            label={t('inspector.color')}
            value={common(walls.map((w) => w.appearance?.color))}
            fallback="#f2f0eb"
            onCommit={(c) => wallLooks({ color: c })}
            onReset={() => wallLooks({ color: undefined })}
          />
          <SliderField
            label={t('inspector.baseboard')}
            value={common(walls.map((w) => w.baseboard ?? 0)) ?? 0}
            min={0}
            max={300}
            step={10}
            suffix="mm"
            onCommit={(v) =>
              exec(
                batch(
                  walls.map((w) => updateWall(level.id, w.id, { baseboard: v || undefined })),
                  'command.batch',
                ),
              )
            }
          />
        </Section>
      )}
      {objs.length > 1 && (
        <Section title={t('multi.arrange')}>
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'centerX', 'right', 'top', 'centerZ', 'bottom'] as const).map((m) => (
              <button
                key={m}
                className="btn justify-center px-1 py-1 text-[11px]"
                onClick={() => act.align(m)}
                data-testid={`align-${m}`}
              >
                {t(`multi.align.${m}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              className="btn justify-center text-[11px]"
              disabled={objs.length < 3}
              onClick={() => act.distribute('x')}
            >
              {t('ctx.distributeX')}
            </button>
            <button
              className="btn justify-center text-[11px]"
              disabled={objs.length < 3}
              onClick={() => act.distribute('z')}
            >
              {t('ctx.distributeZ')}
            </button>
            <button className="btn justify-center text-[11px]" onClick={act.group} data-testid="multi-group">
              {t('ctx.group')}
            </button>
            <button className="btn justify-center text-[11px]" onClick={act.ungroup}>
              {t('ctx.ungroup')}
            </button>
            <button className="btn justify-center text-[11px]" onClick={() => act.rotate(90)}>
              {t('ctx.rotate90')}
            </button>
            <button className="btn justify-center text-[11px]" onClick={() => act.mirror('x')}>
              {t('ctx.mirrorX')}
            </button>
          </div>
        </Section>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={act.toggleLock}>
          <Lock size={14} aria-hidden /> {t('inspector.locked')}
        </button>
        <button className="btn btn-danger" onClick={() => exec(deleteEntities(level.id, ids))}>
          <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
        </button>
      </div>
    </div>
  );
}

/** 列舉參數的顯示名稱來源 */
/** 沒有框架／點綴部件的類型（不顯示額外材質槽） */
const NO_EXTRA_SLOTS = new Set([
  'door',
  'window',
  'mep',
  'rug',
  'rug_round',
  'column',
  'beam',
  'stairs',
  'platform',
  'curtain',
  'wall_art',
  'plant',
]);
const ENUM_LABEL: Record<string, string> = {
  color: 'lightColors',
  point: 'mep',
  swing: 'inspector.swings',
  style: 'openingStyles',
  shape: 'shapes',
};
const DOOR_STYLES = ['single', 'double', 'unequal', 'sliding', 'folding', 'pocket', 'arch'];
const WINDOW_STYLES = ['sliding', 'casement', 'fixed', 'awning', 'bay', 'corner'];
const ROOM_KINDS = [
  'living',
  'dining',
  'bedroom',
  'kitchen',
  'bath',
  'study',
  'entry',
  'balcony',
  'storage',
  'other',
];
const PATTERNS: Tiling['pattern'][] = [
  'straight',
  'running',
  'diagonal',
  'herringbone',
  'chevron',
  'basketweave',
  'hexagon',
  'versailles',
];

/** 鋪貼設計（FE-FIN-01）：拼法、磚尺寸、縫寬／縫色、旋轉、起鋪點、波打線、損耗與估料 */
function TilingSection({
  tiling,
  area,
  onChange,
  withBorder,
  defaults = { pattern: 'straight', tileW: 600, tileH: 600, grout: 2 },
}: {
  tiling: Tiling | undefined;
  area: number;
  onChange: (t: Tiling | undefined) => void;
  withBorder?: boolean;
  defaults?: Tiling;
}) {
  const { t } = useTranslation();
  const tl = tiling;
  const set = (p: Partial<Tiling>) => onChange({ ...(tl ?? defaults), ...p });
  const q = tl ? tileQuantity(area, tl) : null;
  return (
    <Section title={t('tiling.title')} defaultOpen={!!tl} testId="section-tiling">
      <ToggleField
        label={t('tiling.enable')}
        checked={!!tl}
        onChange={(v) => onChange(v ? defaults : undefined)}
        testId="tiling-enable"
      />
      {tl && (
        <>
          <SelectField<string>
            label={t('tiling.pattern')}
            value={tl.pattern}
            onChange={(v) => set({ pattern: v as Tiling['pattern'] })}
            options={PATTERNS.map((p) => ({ value: p, label: t(`tiling.patterns.${p}`) }))}
          />
          <NumberField
            label={t('tiling.tileW')}
            value={tl.tileW}
            suffix="mm"
            onCommit={(v) => set({ tileW: Math.max(20, Math.round(v)) })}
          />
          <NumberField
            label={t('tiling.tileH')}
            value={tl.tileH}
            suffix="mm"
            onCommit={(v) => set({ tileH: Math.max(20, Math.round(v)) })}
          />
          <SliderField
            label={t('tiling.grout')}
            value={tl.grout ?? 2}
            min={0}
            max={20}
            step={1}
            suffix="mm"
            onCommit={(v) => set({ grout: v })}
          />
          <ColorField
            label={t('tiling.groutColor')}
            value={tl.groutColor}
            fallback="#bdb8ae"
            onCommit={(c) => set({ groutColor: c })}
            onReset={() => set({ groutColor: undefined })}
          />
          <SliderField
            label={t('tiling.rotation')}
            value={tl.rotationDeg ?? 0}
            min={-90}
            max={90}
            step={5}
            suffix="°"
            onCommit={(v) => set({ rotationDeg: v || undefined })}
          />
          <NumberField
            label={t('tiling.offsetX')}
            value={tl.offset?.[0] ?? 0}
            suffix="mm"
            onCommit={(v) => set({ offset: [Math.round(v), tl.offset?.[1] ?? 0] })}
          />
          <NumberField
            label={t('tiling.offsetZ')}
            value={tl.offset?.[1] ?? 0}
            suffix="mm"
            onCommit={(v) => set({ offset: [tl.offset?.[0] ?? 0, Math.round(v)] })}
          />
          {withBorder && (
            <>
              <SliderField
                label={t('tiling.border')}
                value={tl.borderWidth ?? 0}
                min={0}
                max={600}
                step={10}
                suffix="mm"
                onCommit={(v) => set({ borderWidth: v || undefined })}
              />
              {!!tl.borderWidth && (
                <MaterialPicker
                  name="tile-border"
                  label={t('tiling.borderMaterial')}
                  value={tl.borderMaterialId ?? 'mat_stone_marble'}
                  categories={['floor', 'stone']}
                  onPick={(m) => set({ borderMaterialId: m })}
                />
              )}
            </>
          )}
          <SliderField
            label={t('tiling.waste')}
            value={Math.round((tl.waste ?? 0.08) * 100)}
            min={0}
            max={30}
            step={1}
            suffix="%"
            onCommit={(v) => set({ waste: v / 100 })}
          />
          {q && (
            <p className="hud-stat" data-testid="tiling-quantity">
              <span>{t('tiling.quantity')}</span>
              <b>{t('tiling.pieces', { n: q.pieces, m2: q.m2 })}</b>
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/** 標註（FE-PLAN-10）：文字內容／字高／顏色；尺寸線偏移 */
function AnnotationPanel({
  id,
  type,
  data,
  levelId,
}: {
  id: string;
  type: string;
  data: Record<string, unknown>;
  levelId: string;
}) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const [text, setText] = useState(String(data.text ?? ''));
  const upd = (p: Record<string, unknown>) => exec(updateAnnotation(levelId, id, p));
  return (
    <div className="space-y-2" data-testid="inspector-annotation">
      <h3 className="font-medium">{t(`annotation.${type}`)}</h3>
      {type === 'tag' ? (
        <>
          <NumberField
            label={t('annotation.number')}
            value={Number(data.number ?? 1)}
            step={1}
            onCommit={(v) => upd({ number: Math.max(1, Math.round(v)) })}
            testId="tag-number"
          />
          <label className="grid gap-1 text-xs">
            <span>{t('annotation.text')}</span>
            <input
              className="field font-sans"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== (data.text ?? '') && upd({ text: text || undefined })}
              data-testid="annotation-text"
            />
          </label>
        </>
      ) : type === 'angle' ? (
        <p className="font-mono text-xs text-accent" data-testid="angle-value">
          {t('annotation.degrees', {
            deg: angleDegrees(data as unknown as Parameters<typeof angleDegrees>[0]).toFixed(1),
          })}
        </p>
      ) : type === 'arrow' ? null : type !== 'dimension' ? (
        <>
          <label className="grid gap-1 text-xs">
            <span>{t('annotation.text')}</span>
            <textarea
              className="field font-sans"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== data.text && upd({ text })}
              data-testid="annotation-text"
            />
          </label>
          <SliderField
            label={t('annotation.size')}
            value={Number(data.size ?? 250)}
            min={50}
            max={1500}
            step={10}
            suffix="mm"
            onCommit={(v) => upd({ size: v })}
          />
          <ColorField
            label={t('inspector.color')}
            value={typeof data.color === 'string' ? data.color : undefined}
            fallback="#1b1d21"
            onCommit={(c) => upd({ color: c })}
            onReset={() => upd({ color: undefined })}
          />
          <SliderField
            label={t('annotation.rotation')}
            value={Number(data.rotation ?? 0)}
            min={-180}
            max={180}
            step={5}
            suffix="°"
            onCommit={(v) => upd({ rotation: v })}
          />
        </>
      ) : (
        <SliderField
          label={t('annotation.offset')}
          value={Number(data.offset ?? 0)}
          min={-3000}
          max={3000}
          step={50}
          suffix="mm"
          onCommit={(v) => upd({ offset: v })}
        />
      )}
      <button className="btn btn-danger" onClick={() => exec(deleteEntities(levelId, [id]))}>
        <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
      </button>
    </div>
  );
}
