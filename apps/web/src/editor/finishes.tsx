import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activeLevel,
  autoDecorate,
  batch,
  deleteEntities,
  planBath,
  planKitchen,
  updateRoom,
  updateWall,
  type KitchenShape,
} from '@interiorai/app-state';
import { detectRooms, pointInPolygon } from '@interiorai/core-geometry';
import { catalog } from '../catalogData';
import {
  CEILING_TYPES,
  MOLDING_PROFILES,
  WAINSCOT_STYLES,
  type Appearance,
  type Level,
  type Wall,
} from '@interiorai/scene-schema';
import { useEditor, useEditorStore } from './context';
import { ColorField, Section, SelectField, SliderField, ToggleField } from './fields';

/** 護牆板／腰牆、頂角線、踢腳板斷面（FE-FIN-02／04） */
export function WallFinishSection({ w, levelId }: { w: Wall; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const up = (p: Parameters<typeof updateWall>[2]) => exec(updateWall(levelId, w.id, p));
  const ws = w.wainscot;
  return (
    <Section title={t('finish.title')} defaultOpen={!!(ws || w.crown)} testId="section-finish">
      <ToggleField
        label={t('finish.wainscot')}
        checked={!!ws}
        onChange={(v) =>
          up({ wainscot: v ? { height: 900, style: 'panel', sides: 'both', color: '#eee8dc' } : undefined })
        }
        testId="finish-wainscot"
      />
      {ws && (
        <>
          <SliderField
            label={t('finish.height')}
            value={ws.height}
            min={300}
            max={2000}
            step={10}
            suffix="mm"
            onCommit={(v) => up({ wainscot: { ...ws, height: v } })}
          />
          <SelectField
            label={t('finish.style')}
            value={ws.style}
            onChange={(v) => up({ wainscot: { ...ws, style: v } })}
            options={WAINSCOT_STYLES.map((s) => ({ value: s, label: t(`finish.styles.${s}`) }))}
          />
          <SelectField
            label={t('finish.sides')}
            value={ws.sides}
            onChange={(v) => up({ wainscot: { ...ws, sides: v } })}
            options={(['both', 'A', 'B'] as const).map((s) => ({
              value: s,
              label: t(`finish.sideOpts.${s}`),
            }))}
          />
          <ColorField
            label={t('finish.color')}
            value={ws.color}
            fallback="#eee8dc"
            onCommit={(c) => up({ wainscot: { ...ws, color: c } })}
          />
        </>
      )}
      <ToggleField
        label={t('finish.crown')}
        checked={!!w.crown}
        onChange={(v) => up({ crown: v ? { height: 80, profile: 'cove' } : undefined })}
        testId="finish-crown"
      />
      {w.crown && (
        <>
          <SliderField
            label={t('finish.crownHeight')}
            value={w.crown.height}
            min={20}
            max={300}
            step={5}
            suffix="mm"
            onCommit={(v) => up({ crown: { ...w.crown!, height: v } })}
          />
          <SelectField
            label={t('finish.profile')}
            value={w.crown.profile}
            onChange={(v) => up({ crown: { ...w.crown!, profile: v } })}
            options={MOLDING_PROFILES.map((p) => ({ value: p, label: t(`finish.profiles.${p}`) }))}
          />
        </>
      )}
      <SelectField
        label={t('finish.baseboardProfile')}
        value={w.baseboardProfile ?? 'flat'}
        onChange={(v) => up({ baseboardProfile: v === 'flat' ? undefined : v })}
        options={MOLDING_PROFILES.map((p) => ({ value: p, label: t(`finish.profiles.${p}`) }))}
      />
    </Section>
  );
}

/** 貼圖參數（FE-PROP-04）：縮放、旋轉、偏移（每個面各自） */
export function UvSection({
  look,
  onChange,
  title,
}: {
  look: Appearance | undefined;
  onChange: (p: Partial<Appearance>) => void;
  title?: string;
}) {
  const { t } = useTranslation();
  const off = look?.uvOffset ?? [0, 0];
  return (
    <Section
      title={title ?? t('uv.title')}
      defaultOpen={!!(look?.uvScale || look?.uvRotation || look?.uvOffset)}
      testId="section-uv"
    >
      <SliderField
        label={t('uv.scale')}
        value={look?.uvScale ?? 1}
        min={0.25}
        max={4}
        step={0.05}
        suffix="×"
        onCommit={(v) => onChange({ uvScale: v === 1 ? undefined : v })}
        testId="uv-scale"
      />
      <SliderField
        label={t('uv.rotation')}
        value={look?.uvRotation ?? 0}
        min={-180}
        max={180}
        step={5}
        suffix="°"
        onCommit={(v) => onChange({ uvRotation: v || undefined })}
        testId="uv-rotation"
      />
      <SliderField
        label={t('uv.offsetX')}
        value={off[0]}
        min={-1000}
        max={1000}
        step={10}
        suffix="mm"
        onCommit={(v) => onChange({ uvOffset: v || off[1] ? [v, off[1]] : undefined })}
      />
      <SliderField
        label={t('uv.offsetY')}
        value={off[1]}
        min={-1000}
        max={1000}
        step={10}
        suffix="mm"
        onCommit={(v) => onChange({ uvOffset: v || off[0] ? [off[0], v] : undefined })}
      />
    </Section>
  );
}

/** 天花造型（FE-FIN-03）：平頂、降板、跌級、間接燈槽 */
export function CeilingSection({ room, levelId }: { room: Level['rooms'][number]; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const c = room.ceiling ?? { type: 'flat' as const, dropMm: 150, borderMm: 600 };
  const up = (p: Partial<typeof c>) => {
    const next = { ...c, ...p };
    exec(updateRoom(levelId, room.id, { ceiling: next.type === 'flat' ? undefined : next }));
  };
  return (
    <Section title={t('ceiling.title')} defaultOpen={!!room.ceiling} testId="section-ceiling">
      <SelectField
        label={t('ceiling.type')}
        value={c.type}
        onChange={(v) => up({ type: v, ...(v === 'cove' && !c.coveKelvin ? { coveKelvin: 2700 } : {}) })}
        options={CEILING_TYPES.map((x) => ({ value: x, label: t(`ceiling.types.${x}`) }))}
        testId="ceiling-type"
      />
      {c.type !== 'flat' && (
        <SliderField
          label={t('ceiling.drop')}
          value={c.dropMm}
          min={30}
          max={800}
          step={10}
          suffix="mm"
          onCommit={(v) => up({ dropMm: v })}
        />
      )}
      {(c.type === 'tray' || c.type === 'cove') && (
        <SliderField
          label={t('ceiling.border')}
          value={c.borderMm}
          min={150}
          max={2000}
          step={50}
          suffix="mm"
          onCommit={(v) => up({ borderMm: v })}
        />
      )}
      {c.type === 'cove' && (
        <SliderField
          label={t('ceiling.kelvin')}
          value={c.coveKelvin ?? 2700}
          min={1800}
          max={6500}
          step={100}
          suffix="K"
          kelvin
          onCommit={(v) => up({ coveKelvin: v })}
        />
      )}
      <p className="text-[11px] text-muted">{t('ceiling.hint')}</p>
    </Section>
  );
}

const KITCHEN_TYPES = new Set(['counter', 'upper_cabinet', 'fridge', 'stove', 'sink', 'range_hood']);
const BATH_TYPES = new Set(['toilet', 'basin', 'shower', 'bathtub', 'mirror']);

/** 廚房／衛浴自動佈局（FE-AST-08）：I／L／U 型；可選擇先移除房內既有廚具／衛浴設備（一次 undo） */
export function KitchenSection({ room }: { room: Level['rooms'][number] }) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const level = useEditor(activeLevel);
  const [shape, setShape] = useState<KitchenShape>('L');
  const [replace, setReplace] = useState(true);
  const run = (kind: 'kitchen' | 'bath') => {
    const s = store.getState();
    const pl =
      kind === 'kitchen' ? planKitchen(level, catalog, room.id, shape) : planBath(level, catalog, room.id);
    if (!pl.length) return s.notify('warn', t('kitchen.none'));
    const types = kind === 'kitchen' ? KITCHEN_TYPES : BATH_TYPES;
    const det = detectRooms(level).rooms.find((d) => d.key === [...room.wallIds].sort().join('|'));
    const old =
      replace && det
        ? level.objects.filter((o) => {
            const e = catalog.get(o.catalogId);
            return (
              e?.model.kind === 'parametric' &&
              types.has(e.model.type) &&
              pointInPolygon([o.position[0], o.position[2]], det.floor)
            );
          })
        : [];
    const cmds = [
      ...(old.length
        ? [
            deleteEntities(
              level.id,
              old.map((o) => o.id),
            ),
          ]
        : []),
      autoDecorate(level.id, pl),
    ];
    if (s.exec(batch(cmds, 'command.autoLayout'))) s.notify('info', t('kitchen.done', { n: pl.length }));
  };
  return (
    <Section
      title={t('kitchen.title')}
      defaultOpen={room.kind === 'kitchen' || room.kind === 'bath'}
      testId="section-kitchen"
    >
      <SelectField
        label={t('kitchen.shape')}
        value={shape}
        onChange={setShape}
        options={(['I', 'L', 'U'] as const).map((x) => ({ value: x, label: t(`kitchen.shapes.${x}`) }))}
        testId="kitchen-shape"
      />
      <ToggleField label={t('kitchen.replace')} checked={replace} onChange={setReplace} />
      <div className="flex gap-2">
        <button
          className="btn flex-1 justify-center"
          onClick={() => run('kitchen')}
          data-testid="kitchen-run"
        >
          {t('kitchen.runKitchen')}
        </button>
        <button className="btn flex-1 justify-center" onClick={() => run('bath')} data-testid="bath-run">
          {t('kitchen.runBath')}
        </button>
      </div>
    </Section>
  );
}
