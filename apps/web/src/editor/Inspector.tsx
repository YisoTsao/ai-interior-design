import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Lock, Trash2, Unlock } from 'lucide-react';
import {
  activeLevel,
  deleteEntities,
  duplicateObjects,
  renameRoom,
  resizeWall,
  setMaterial,
  transformObject,
  updateObject,
  updateOpening,
  updateWall,
} from '@interiorai/app-state';
import { objectDims, resolveParams } from '@interiorai/catalog';
import { detectRooms, wallLength } from '@interiorai/core-geometry';
import { formatArea } from '@interiorai/editor-2d';
import type { Opening, Wall } from '@interiorai/scene-schema';
import { catalog } from '../catalogData';
import { usePrefs } from '../prefs';
import { useEditor, useEditorStore } from './context';
import { LengthField, NumberField, SelectField } from './fields';
import { MaterialPicker } from './MaterialPicker';

export function Inspector({
  uniformScale,
  setUniformScale,
}: {
  uniformScale: boolean;
  setUniformScale: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const scene = useEditor((s) => s.scene);
  const levelId = useEditor((s) => s.levelId);
  const selection = useEditor((s) => s.selection);
  const level = activeLevel({ scene, levelId });
  const exec = store.getState().exec;

  let body: React.ReactNode = <p className="text-xs text-muted">{t('inspector.none')}</p>;
  if (selection.length > 1) {
    body = (
      <div className="space-y-2">
        <p className="text-sm">{t('inspector.multi', { n: selection.length })}</p>
        <button className="btn" onClick={() => exec(deleteEntities(levelId, selection))}>
          <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
        </button>
      </div>
    );
  } else if (selection.length === 1) {
    const id = selection[0]!;
    const w = level.walls.find((x) => x.id === id);
    const o = level.openings.find((x) => x.id === id);
    const obj = level.objects.find((x) => x.id === id);
    const room = level.rooms.find((x) => x.id === id);
    if (w) body = <WallPanel w={w} levelId={levelId} />;
    else if (o) body = <OpeningPanel o={o} levelId={levelId} />;
    else if (room) {
      const d = detectRooms(level).rooms.find((x) => x.key === [...room.wallIds].sort().join('|'));
      body = (
        <RoomPanel
          roomId={room.id}
          label={room.label ?? ''}
          floor={room.floorMaterialId}
          ceiling={room.ceilingMaterialId}
          area={d?.netArea ?? 0}
          levelId={levelId}
        />
      );
    } else if (obj) {
      const e = catalog.get(obj.catalogId);
      const dims = e ? objectDims(e, obj.params, obj.scale) : null;
      const params = e ? resolveParams(e, obj.params) : {};
      body = (
        <div className="space-y-2" data-testid="inspector-object">
          <h3 className="font-medium">{e?.nameZh ?? obj.catalogId}</h3>
          {dims && (
            <p className="font-mono text-xs text-muted">
              {t('assets.size', { w: Math.round(dims.w), d: Math.round(dims.d), h: Math.round(dims.h) })}
            </p>
          )}
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
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={uniformScale}
              onChange={(e) => setUniformScale(e.target.checked)}
            />{' '}
            {t('inspector.uniform')}
          </label>
          {e?.model.kind === 'parametric' && Object.keys(e.model.params).length > 0 && (
            <fieldset className="space-y-1 border-t border-border pt-2">
              <legend className="panel-title">{t('inspector.params')}</legend>
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
                      label: t(`inspector.swings.${v}`),
                    }))}
                    onChange={(v) =>
                      exec(updateObject(levelId, id, { params: { ...(obj.params ?? {}), [k]: v } }))
                    }
                  />
                ),
              )}
            </fieldset>
          )}
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
          <div className="flex flex-wrap gap-2 border-t border-border pt-2">
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
            <button className="btn" onClick={() => exec(deleteEntities(levelId, [id]))}>
              <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
            </button>
          </div>
        </div>
      );
    }
  }
  return (
    <aside
      className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-3"
      aria-label={t('inspector.title')}
    >
      <h2 className="panel-title">{t('inspector.title')}</h2>
      {body}
    </aside>
  );
}

function WallPanel({ w, levelId }: { w: Wall; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const unit = usePrefs((s) => s.lengthUnit);
  const [keep, setKeep] = useState<'start' | 'end' | 'center'>('start');
  return (
    <div className="space-y-2" data-testid="inspector-wall">
      <h3 className="font-medium">{t('inspector.wall')}</h3>
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
      <SelectField
        label={t('inspector.type')}
        value={w.type ?? 'partition'}
        onChange={(v) => exec(updateWall(levelId, w.id, { type: v }))}
        options={(['structural', 'exterior', 'partition', 'curtain'] as const).map((v) => ({
          value: v,
          label: t(`inspector.wallTypes.${v}`),
        }))}
      />
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
      <button className="btn" onClick={() => exec(deleteEntities(levelId, [w.id]))}>
        <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
      </button>
    </div>
  );
}

function OpeningPanel({ o, levelId }: { o: Opening; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const unit = usePrefs((s) => s.lengthUnit);
  return (
    <div className="space-y-2" data-testid="inspector-opening">
      <h3 className="font-medium">{t(`inspector.${o.type}`)}</h3>
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
      <button className="btn" onClick={() => exec(deleteEntities(levelId, [o.id]))}>
        <Trash2 size={14} aria-hidden /> {t('inspector.delete')}
      </button>
    </div>
  );
}

function RoomPanel({
  roomId,
  label,
  floor,
  ceiling,
  area,
  levelId,
}: {
  roomId: string;
  label: string;
  floor?: string;
  ceiling?: string;
  area: number;
  levelId: string;
}) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const areaUnit = usePrefs((s) => s.areaUnit);
  const [name, setName] = useState(label);
  return (
    <div className="space-y-2" data-testid="inspector-room">
      <label className="grid gap-1 text-xs">
        <span>{t('inspector.roomName')}</span>
        <input
          className="field w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && exec(renameRoom(levelId, roomId, name))}
          onBlur={() => name !== label && exec(renameRoom(levelId, roomId, name))}
        />
      </label>
      <p className="flex justify-between text-xs">
        <span>{t('inspector.area')}</span>
        <span className="font-mono">{formatArea(area, areaUnit)}</span>
      </p>
      <MaterialPicker
        name="floor"
        label={t('inspector.floor')}
        value={floor}
        categories={['floor']}
        onPick={(m) => exec(setMaterial(levelId, { kind: 'floor', roomId }, m))}
      />
      <MaterialPicker
        name="ceiling"
        label={t('inspector.ceiling')}
        value={ceiling ?? 'mat_ceiling_white'}
        categories={['ceiling', 'wall']}
        onPick={(m) => exec(setMaterial(levelId, { kind: 'ceiling', roomId }, m))}
      />
    </div>
  );
}
