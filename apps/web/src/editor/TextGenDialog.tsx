import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { activeLevel, addObject } from '@interiorai/app-state';
import { defaultElevation } from '@interiorai/catalog';
import { textToFurniture, textToMaterial } from '../ai/textGen';
import { catalog } from '../catalogData';
import { saveMaterialRecord } from '../userMaterials';
import { useEditorStore } from './context';
import { HudDialog } from './HudDialog';
import { targetPoint } from './SetsList';
import { swatchCss } from './swatch';
import { useThumbnail } from './thumbs';

/**
 * 文字生成（FE-AI-05）：描述 → 程序化材質（加入材質庫）或參數化家具（依描述的尺寸與顏色放置）。
 * 規則式本機解析，介面標示；放置為單一 Command。
 */
export function TextGenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const [tab, setTab] = useState<'material' | 'furniture'>('material');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const mat = useMemo(() => (tab === 'material' && text.trim() ? textToMaterial(text) : null), [tab, text]);
  const fur = useMemo(
    () => (tab === 'furniture' && text.trim() ? textToFurniture(text, catalog) : null),
    [tab, text],
  );
  const thumb = useThumbnail(fur?.entry);
  const place = () => {
    if (!fur) return;
    const s = store.getState();
    const lv = activeLevel(s);
    const [x, z] = targetPoint(lv, s.selection);
    const before = new Set(lv.objects.map((o) => o.id));
    const ok = s.exec(
      addObject(s.levelId, {
        catalogId: fur.entry.id,
        position: [Math.round(x), defaultElevation(fur.entry, lv.height), Math.round(z)],
        rotationY: 0,
        ...(Object.keys(fur.params).length ? { params: fur.params } : {}),
        ...(fur.color ? { appearance: { color: fur.color } } : {}),
      }),
    );
    if (!ok) return;
    const added = activeLevel(store.getState()).objects.find((o) => !before.has(o.id));
    if (added) s.select([added.id]);
    setMsg(t('textGen.placed'));
  };
  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('textGen.title')}
      testId="text-gen"
      width={560}
    >
      <p className="text-[11px] text-warn">{t('textGen.note')}</p>
      <div className="hud-seg">
        {(['material', 'furniture'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={tab === k}
            onClick={() => {
              setTab(k);
              setMsg(null);
            }}
            data-testid={`text-gen-tab-${k}`}
          >
            {t(`textGen.tabs.${k}`)}
          </button>
        ))}
      </div>
      <textarea
        className="field w-full font-sans"
        rows={3}
        value={text}
        placeholder={t(`textGen.ph.${tab}`)}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        aria-label={t('textGen.prompt')}
        data-testid="text-gen-input"
      />
      {mat && (
        <div className="flex items-center gap-3 text-xs" data-testid="text-gen-material">
          <span
            className="block h-16 w-16 shrink-0 border border-border"
            style={{ background: swatchCss(mat) }}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-2">
            <dt className="text-muted">{t('textGen.category')}</dt>
            <dd>{t(`textGen.cats.${mat.category}`)}</dd>
            <dt className="text-muted">{t('textGen.pattern')}</dt>
            <dd>{mat.motif ?? mat.pattern}</dd>
            <dt className="text-muted">{t('textGen.size')}</dt>
            <dd>{`${mat.realSizeMm.w}×${mat.realSizeMm.h} mm`}</dd>
            <dt className="text-muted">{t('textGen.rough')}</dt>
            <dd>{mat.roughness}</dd>
          </dl>
          <button
            className="btn btn-primary ml-auto"
            onClick={async () => {
              await saveMaterialRecord(mat);
              setMsg(t('textGen.saved'));
            }}
            data-testid="text-gen-save"
          >
            {t('textGen.addMaterial')}
          </button>
        </div>
      )}
      {tab === 'furniture' && text.trim() && !fur && (
        <p className="text-xs text-muted">{t('textGen.noMatch')}</p>
      )}
      {fur && (
        <div className="flex items-center gap-3 text-xs" data-testid="text-gen-furniture">
          {thumb ? (
            <img src={thumb} alt="" className="h-20 w-20 object-contain" />
          ) : (
            <span className="h-20 w-20" />
          )}
          <div className="space-y-0.5">
            <b>{i18n.language === 'en' ? (fur.entry.nameEn ?? fur.entry.nameZh) : fur.entry.nameZh}</b>
            <p className="font-mono">
              {['w', 'd', 'h']
                .map((k) => `${k.toUpperCase()} ${fur.params[k] ?? fur.entry.dimsMm[k as 'w' | 'd' | 'h']}`)
                .join(' · ')}
            </p>
            {fur.color && (
              <p className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 border border-border"
                  style={{ background: fur.color }}
                />
                {fur.color}
              </p>
            )}
          </div>
          <button className="btn btn-primary ml-auto" onClick={place} data-testid="text-gen-place">
            {t('textGen.place')}
          </button>
        </div>
      )}
      {msg && <p className="text-xs text-accent">{msg}</p>}
    </HudDialog>
  );
}
