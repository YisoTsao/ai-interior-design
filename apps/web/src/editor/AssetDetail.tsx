import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MousePointerClick, Star } from 'lucide-react';
import { materialMap, type CatalogEntry } from '@interiorai/catalog';
import { ModelPreview } from '@interiorai/viewer-3d';
import { ArButton } from './ArButton';
import { catalog, materials } from '../catalogData';
import { recordRecent, toggleFavorite, useAssetPrefs } from './assetPrefs';
import { useEditorStore } from './context';
import { HudDialog } from './HudDialog';
import { swatchCss } from './swatch';
import { usePlaceMaterial } from './placeMaterial';

const matMap = materialMap(materials);

/**
 * 資產詳情（FE-AST-05）：可旋轉 3D 預覽、尺寸圖、材質選項（同類材質即時預覽）、參考價、風格、授權；
 * 可直接以選定材質放置。
 */
export function AssetDetail({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const prefs = useAssetPrefs();
  const e: CatalogEntry | undefined = entryId ? catalog.get(entryId) : undefined;
  const slot = e?.materialSlots[0];
  const [mat, setMat] = useState<string | undefined>(undefined);
  const options = useMemo(() => {
    const def = slot ? matMap.get(slot.defaultMaterialId) : undefined;
    if (!def || !slot?.swappable) return [];
    // 家具用材質：布、木、金屬、石；預設材質的類別排前面
    const FURN: string[] = ['fabric', 'wood', 'metal', 'stone'];
    const order = FURN.includes(def.category)
      ? [def.category, ...FURN.filter((c) => c !== def.category)]
      : FURN;
    return order.flatMap((c) => materials.filter((m) => m.category === c)).slice(0, 45);
  }, [slot]);
  if (!e) return null;
  const nm = i18n.language === 'en' ? (e.nameEn ?? e.nameZh) : e.nameZh;
  const matName = (id: string) => {
    const m = matMap.get(id);
    return m ? (i18n.language === 'en' ? (m.nameEn ?? m.nameZh) : m.nameZh) : id;
  };
  const place = () => {
    const s = store.getState();
    recordRecent(e.id);
    usePlaceMaterial
      .getState()
      .set(mat && slot ? { catalogId: e.id, slot: slot.name, materialId: mat } : null);
    if (s.view === '3d') s.setView('2d');
    if (e.model.kind === 'parametric' && (e.model.type === 'door' || e.model.type === 'window'))
      s.setTool(e.model.type, e.id);
    else s.setTool('place', e.id);
    onClose();
  };
  const fav = prefs.fav.includes(e.id);
  const W = 220;
  const k = W / Math.max(e.dimsMm.w, e.dimsMm.d, 1);
  return (
    <HudDialog
      open={!!entryId}
      onOpenChange={(v) => {
        if (!v) {
          setMat(undefined);
          onClose();
        }
      }}
      title={nm}
      testId="asset-detail"
      width={760}
      footer={
        <>
          <button className="btn" onClick={() => toggleFavorite(e.id)} aria-pressed={fav}>
            <Star size={14} fill={fav ? 'currentColor' : 'none'} aria-hidden />{' '}
            {t(fav ? 'assets.unfavorite' : 'assets.favorite', { name: '' })}
          </button>
          <ArButton entry={e} materials={matMap} materialId={mat} />
          <button className="btn btn-primary" onClick={place} data-testid="asset-detail-place">
            <MousePointerClick size={14} aria-hidden />{' '}
            {mat ? t('assetDetail.placeWith', { mat: matName(mat) }) : t('assetDetail.place')}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <ModelPreview entry={e} materials={matMap} materialId={mat} className="h-72 w-full rounded bg-bg" />
          {options.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted">{t('assetDetail.materials')}</p>
              <div className="grid grid-cols-9 gap-1" role="radiogroup">
                {options.map((m) => (
                  <button
                    key={m.id}
                    className="h-8 rounded border-2"
                    style={{
                      background: swatchCss(m),
                      borderColor:
                        (mat ?? slot?.defaultMaterialId) === m.id ? 'var(--primary)' : 'transparent',
                    }}
                    title={matName(m.id)}
                    aria-label={matName(m.id)}
                    aria-pressed={(mat ?? slot?.defaultMaterialId) === m.id}
                    onClick={() => setMat(m.id === slot?.defaultMaterialId ? undefined : m.id)}
                    data-testid={`detail-mat-${m.id}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3 text-sm">
          <svg
            viewBox={`-20 -20 ${W + 70} ${e.dimsMm.d * k + 70}`}
            className="w-full"
            role="img"
            aria-label={t('assetDetail.dims')}
          >
            <rect
              x={0}
              y={0}
              width={e.dimsMm.w * k}
              height={e.dimsMm.d * k}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
            />
            <line
              x1={0}
              y1={e.dimsMm.d * k + 18}
              x2={e.dimsMm.w * k}
              y2={e.dimsMm.d * k + 18}
              stroke="var(--muted)"
            />
            <text
              x={(e.dimsMm.w * k) / 2}
              y={e.dimsMm.d * k + 34}
              fill="var(--text)"
              fontSize={12}
              textAnchor="middle"
            >{`W ${e.dimsMm.w}`}</text>
            <line
              x1={e.dimsMm.w * k + 14}
              y1={0}
              x2={e.dimsMm.w * k + 14}
              y2={e.dimsMm.d * k}
              stroke="var(--muted)"
            />
            <text
              x={e.dimsMm.w * k + 20}
              y={(e.dimsMm.d * k) / 2}
              fill="var(--text)"
              fontSize={12}
            >{`D ${e.dimsMm.d}`}</text>
          </svg>
          <dl className="space-y-1 text-xs">
            <div className="hud-stat">
              <dt>{t('assetDetail.size')}</dt>
              <dd>{`${e.dimsMm.w} × ${e.dimsMm.d} × ${e.dimsMm.h} mm`}</dd>
            </div>
            <div className="hud-stat">
              <dt>{t('assetDetail.category')}</dt>
              <dd>{t(`assets.categories.${e.category}`)}</dd>
            </div>
            <div className="hud-stat">
              <dt>{t('assetDetail.anchor')}</dt>
              <dd>{t(`upload.anchors.${e.anchor}`)}</dd>
            </div>
            {e.unitPriceTwd !== undefined && (
              <div className="hud-stat">
                <dt>{t('assetDetail.price')}</dt>
                <dd>{t('assets.price', { n: e.unitPriceTwd.toLocaleString() })}</dd>
              </div>
            )}
            {slot && (
              <div className="hud-stat">
                <dt>{t('assetDetail.material')}</dt>
                <dd>{matName(mat ?? slot.defaultMaterialId)}</dd>
              </div>
            )}
            {e.light && (
              <div className="hud-stat">
                <dt>{t('assetDetail.light')}</dt>
                <dd>{`${e.light.lumens} lm`}</dd>
              </div>
            )}
          </dl>
          {e.styleTags.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {e.styleTags.map((s) => (
                <span key={s} className="inv-badge static">
                  {t(`assets.styles.${s}`, { defaultValue: s })}
                </span>
              ))}
            </p>
          )}
          {e.license && (
            <div className="hud-section p-2 text-[11px] text-muted" data-testid="asset-license">
              <p>{`${t('assetDetail.license')}: ${e.license.type}`}</p>
              <p>{`${t('assetDetail.source')}: ${e.license.source}`}</p>
              <p>{`${t('assetDetail.allowed')}: ${e.license.allowedUse.map((u) => t(`assetDetail.uses.${u}`)).join('、')}`}</p>
              {e.license.attribution && <p>{e.license.attribution}</p>}
            </div>
          )}
        </div>
      </div>
    </HudDialog>
  );
}
