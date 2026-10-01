import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, Trash2 } from 'lucide-react';
import {
  activeLevel,
  applyLightScene,
  deleteLightScene,
  isLight,
  lightGroups,
  lightStateOf,
  saveLightScene,
  setGroupLights,
  setLightGroup,
} from '@interiorai/app-state';
import type { SceneObject } from '@interiorai/scene-schema';
import { lightPreview } from '@interiorai/viewer-3d';
import { catalog } from '../catalogData';
import { useEditor, useEditorStore } from './context';
import { Section } from './fields';

/**
 * 燈光群組與情境（FE-LGT-05）：群組一起開關／調光；把目前燈光存成情境、一鍵套用；
 * 時間軸播放＝依序預覽各情境（不改 Scene、不進 undo），停止後回到場景狀態。
 */
export function LightScenesSection() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const exec = store.getState().exec;
  const level = useEditor(activeLevel);
  const scenesRaw = useEditor((s) => s.scene.lightScenes);
  const scenes = scenesRaw ?? [];
  const groups = useMemo(() => lightGroups(level), [level]);
  const lights = level.objects.filter((o) => isLight(o, catalog));
  const [name, setName] = useState('');
  const [playing, setPlaying] = useState<number | null>(null);
  const [interval, setIntervalS] = useState(3);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setPlaying(null);
    lightPreview.set(null);
  };
  useEffect(() => stop, []);
  const play = () => {
    if (!scenes.length) return;
    let i = 0;
    const show = () => {
      const sc = store.getState().scene.lightScenes?.[i % (store.getState().scene.lightScenes?.length || 1)];
      if (!sc) return stop();
      lightPreview.set(new Map(Object.entries(sc.states)));
      setPlaying(i % scenes.length);
      i++;
    };
    show();
    timer.current = window.setInterval(show, interval * 1000);
  };

  return (
    <Section title={t('lightScene.title')} testId="section-light-scenes">
      {!lights.length && <p className="text-[11px] text-muted">{t('lightScene.noLights')}</p>}
      {groups.length > 0 && (
        <div className="space-y-1" data-testid="light-groups">
          <p className="hud-title text-[11px]">{t('lightScene.groups')}</p>
          {groups.map((g) => {
            const members = level.objects.filter((o) => o.light?.group === g);
            const on = members.some((o) => o.light?.on !== false);
            const lv = members.length ? (lightStateOf(members[0]!, catalog).level ?? 1) : 1;
            return (
              <div key={g} className="flex items-center gap-2 text-xs" data-testid={`light-group-${g}`}>
                <input
                  type="checkbox"
                  checked={on}
                  aria-label={t('lightScene.groupOn', { name: g })}
                  onChange={(e) =>
                    exec(setGroupLights(level.id, level, catalog, g, { on: e.target.checked }))
                  }
                />
                <span className="w-16 truncate" title={g}>
                  {g} · {members.length}
                </span>
                <input
                  type="range"
                  className="hud-range flex-1"
                  min={0}
                  max={100}
                  defaultValue={Math.round(lv * 100)}
                  key={`${g}-${lv}`}
                  aria-label={t('lightScene.groupLevel', { name: g })}
                  onPointerUp={(e) =>
                    exec(
                      setGroupLights(level.id, level, catalog, g, {
                        on: true,
                        level: Number((e.target as HTMLInputElement).value) / 100,
                      }),
                    )
                  }
                  onKeyUp={(e) =>
                    exec(
                      setGroupLights(level.id, level, catalog, g, {
                        on: true,
                        level: Number((e.target as HTMLInputElement).value) / 100,
                      }),
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      )}
      <p className="hud-title text-[11px]">{t('lightScene.scenes')}</p>
      <ul className="space-y-1" data-testid="light-scene-list">
        {scenes.map((sc, i) => (
          <li key={sc.id} className="flex items-center gap-1 text-xs">
            <button
              className={`btn flex-1 justify-start px-2 py-0.5 ${playing === i ? 'border-primary text-primary' : ''}`}
              onClick={() => exec(applyLightScene(level.id, sc, catalog))}
              data-testid={`light-scene-apply-${i}`}
            >
              {sc.name}
              <span className="ml-auto text-muted">{Object.keys(sc.states).length}</span>
            </button>
            <button
              className="icon-btn h-6 w-6"
              aria-label={t('lightScene.delete', { name: sc.name })}
              onClick={() => exec(deleteLightScene(sc.id))}
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <input
          className="field min-w-0 flex-1"
          placeholder={t('lightScene.namePh')}
          aria-label={t('lightScene.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="light-scene-name"
        />
        <button
          className="btn px-2"
          disabled={!lights.length}
          onClick={() => {
            exec(
              saveLightScene(name || t('lightScene.defaultName', { n: scenes.length + 1 }), level, catalog),
            );
            setName('');
          }}
          data-testid="light-scene-save"
        >
          {t('lightScene.save')}
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <button
          className="btn px-2"
          disabled={scenes.length < 2}
          onClick={() => (playing === null ? play() : stop())}
          data-testid="light-scene-play"
        >
          {playing === null ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}{' '}
          {t(playing === null ? 'lightScene.play' : 'lightScene.stop')}
        </button>
        <label className="flex items-center gap-1">
          <input
            type="number"
            className="field w-14 py-0.5"
            min={1}
            max={30}
            value={interval}
            onChange={(e) => setIntervalS(Math.max(1, Math.min(30, Number(e.target.value) || 3)))}
            aria-label={t('lightScene.interval')}
          />
          {t('lightScene.seconds')}
        </label>
      </div>
      <p className="text-[11px] text-muted">{t('lightScene.hint')}</p>
    </Section>
  );
}

/** 燈具屬性中的群組欄位（輸入或選既有群組） */
export function LightGroupField({ obj, levelId }: { obj: SceneObject; levelId: string }) {
  const { t } = useTranslation();
  const exec = useEditorStore().getState().exec;
  const level = useEditor(activeLevel);
  const groups = lightGroups(level);
  const [v, setV] = useState(obj.light?.group ?? '');
  useEffect(() => setV(obj.light?.group ?? ''), [obj.light?.group]);
  const commit = () => {
    const g = v.trim();
    if (g !== (obj.light?.group ?? '')) exec(setLightGroup(levelId, [obj.id], g || undefined));
  };
  return (
    <label className="grid gap-1 text-xs">
      <span>{t('lightScene.group')}</span>
      <input
        className="field"
        list="light-group-options"
        value={v}
        placeholder={t('lightScene.groupPh')}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        data-testid="light-group-input"
      />
      <datalist id="light-group-options">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </label>
  );
}
