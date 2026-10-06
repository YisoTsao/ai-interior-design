import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { batch, setEnvironment, setSite, siteOf, type SiteInfo } from '@interiorai/app-state';
import { compassToSceneAzimuth, solarPosition } from '@interiorai/core-geometry';
import { SUN_DEFAULT, sunOverride } from '@interiorai/viewer-3d';
import { useEditor, useEditorStore } from './context';
import { Section, SliderField } from './fields';

export const CITIES: { key: string; lat: number; lon: number; tz: number }[] = [
  { key: 'taipei', lat: 25.04, lon: 121.56, tz: 8 },
  { key: 'taichung', lat: 24.15, lon: 120.67, tz: 8 },
  { key: 'kaohsiung', lat: 22.63, lon: 120.3, tz: 8 },
  { key: 'hongkong', lat: 22.32, lon: 114.17, tz: 8 },
  { key: 'shanghai', lat: 31.23, lon: 121.47, tz: 8 },
  { key: 'tokyo', lat: 35.68, lon: 139.69, tz: 9 },
  { key: 'singapore', lat: 1.35, lon: 103.82, tz: 8 },
  { key: 'london', lat: 51.51, lon: -0.13, tz: 0 },
  { key: 'newyork', lat: 40.71, lon: -74.01, tz: -5 },
];

/** 基地＋時刻 → 場景環境的太陽參數（地平線以下＝不發光；低角度逐漸變弱） */
export function sunFor(site: SiteInfo) {
  const [y, m, d] = site.date.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d) + (site.hour - site.tz) * 3_600_000;
  const p = solarPosition(site.lat, site.lon, new Date(utc));
  const k = Math.max(0, Math.min(1, p.elevationDeg / 15));
  return {
    sunAzimuthDeg: Math.round(compassToSceneAzimuth(p.azimuthDeg, site.northDeg) * 10) / 10,
    sunElevationDeg: Math.round(Math.max(2, Math.min(90, p.elevationDeg)) * 10) / 10,
    sunIntensity: Math.round(SUN_DEFAULT.intensity * k * k * 100) / 100,
    compass: p.azimuthDeg,
    elevation: p.elevationDeg,
  };
}
const fmtHour = (h: number) =>
  `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/**
 * 日照模擬（FE-V3D-06）：城市／經緯度、平面圖北向、日期與時間 → 太陽方位與仰角；可播放一天的光影變化
 * （播放中以 sunOverride 暫時覆寫，不進 undo；停止時寫回場景）。
 */
export function SunStudy() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const site = siteOf(useEditor((s) => s.scene));
  const [playing, setPlaying] = useState(false);
  const [hour, setHour] = useState(site.hour);
  const timer = useRef<number | null>(null);
  useEffect(() => setHour(site.hour), [site.hour]);
  const commit = (patch: Partial<SiteInfo>) => {
    const next = { ...site, ...patch };
    const sun = sunFor(next);
    store.getState().exec(
      batch(
        [
          setSite(patch),
          setEnvironment({
            sunAzimuthDeg: sun.sunAzimuthDeg,
            sunElevationDeg: sun.sunElevationDeg,
            sunIntensity: sun.sunIntensity,
          }),
        ],
        'command.site',
      ),
    );
  };
  const stop = (h: number) => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
    sunOverride.set(null);
    commit({ hour: Math.round(h * 4) / 4 });
  };
  const play = () => {
    setPlaying(true);
    let h = hour >= 19 ? 5 : hour;
    timer.current = window.setInterval(() => {
      h += 0.1;
      if (h >= 19.5) return stop(19.5);
      setHour(h);
      const s = sunFor({ ...site, hour: h });
      sunOverride.set({
        sunAzimuthDeg: s.sunAzimuthDeg,
        sunElevationDeg: s.sunElevationDeg,
        sunIntensity: s.sunIntensity,
      });
    }, 80);
  };
  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
      sunOverride.set(null);
    },
    [],
  );
  const now = sunFor({ ...site, hour });
  const city =
    CITIES.find((c) => Math.abs(c.lat - site.lat) < 0.01 && Math.abs(c.lon - site.lon) < 0.01)?.key ?? '';
  return (
    <Section title={t('sun.title')} testId="section-sun">
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>{t('sun.city')}</span>
        <select
          className="field w-36"
          value={city}
          onChange={(e) => {
            const c = CITIES.find((x) => x.key === e.target.value);
            if (c) commit({ lat: c.lat, lon: c.lon, tz: c.tz });
          }}
          data-testid="sun-city"
        >
          <option value="">{t('sun.custom')}</option>
          {CITIES.map((c) => (
            <option key={c.key} value={c.key}>
              {t(`sun.cities.${c.key}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          <span className="text-muted">{t('sun.lat')}</span>
          <input
            className="field w-full"
            type="number"
            step={0.01}
            min={-66}
            max={66}
            defaultValue={site.lat}
            key={`lat${site.lat}`}
            onBlur={(e) =>
              Number(e.target.value) !== site.lat && commit({ lat: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label>
          <span className="text-muted">{t('sun.lon')}</span>
          <input
            className="field w-full"
            type="number"
            step={0.01}
            min={-180}
            max={180}
            defaultValue={site.lon}
            key={`lon${site.lon}`}
            onBlur={(e) =>
              Number(e.target.value) !== site.lon && commit({ lon: Number(e.target.value) || 0 })
            }
          />
        </label>
      </div>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>{t('sun.date')}</span>
        <input
          className="field w-36"
          type="date"
          value={site.date}
          onChange={(e) => e.target.value && commit({ date: e.target.value })}
          data-testid="sun-date"
        />
      </label>
      <SliderField
        label={`${t('sun.time')} ${fmtHour(hour)}`}
        value={Math.round(hour * 4) / 4}
        min={5}
        max={19.5}
        step={0.25}
        onCommit={(v) => commit({ hour: v })}
        testId="sun-time"
      />
      <SliderField
        label={t('sun.north')}
        value={site.northDeg}
        min={-180}
        max={180}
        step={5}
        suffix="°"
        onCommit={(v) => commit({ northDeg: v })}
      />
      <div className="flex items-center gap-2 text-xs">
        <button
          className="btn"
          onClick={() => (playing ? stop(hour) : play())}
          data-testid="sun-play"
          aria-pressed={playing}
        >
          {playing ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}{' '}
          {playing ? t('sun.stop') : t('sun.play')}
        </button>
        <span className="text-muted" data-testid="sun-readout">
          {t('sun.readout', { az: Math.round(now.compass), el: Math.round(now.elevation) })}
        </span>
      </div>
      {now.elevation <= 0 && <p className="text-[11px] text-warn">{t('sun.below')}</p>}
    </Section>
  );
}
