import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSpreadsheet, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { setQuote, type QuoteSettings } from '@interiorai/app-state';
import type { BomKind } from '@interiorai/core-geometry';
import { plan2dApi } from '@interiorai/editor-2d';
import { viewer3dApi } from '@interiorai/viewer-3d';
import { download } from '../media';
import { useEditor, useEditorStore } from './context';
import { HudDialog } from './HudDialog';
import { buildQuote, quoteCsv, type Quote } from './quote';

const KINDS: BomKind[] = ['object', 'opening', 'floor_finish', 'wall_finish', 'ceiling_finish'];
const money = (n: number) => `NT$ ${Math.round(n).toLocaleString()}`;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * BOM／報價面板（FE-DOC-01／02）：分類明細、可編輯單價、材質損耗、分房間小計、其他費用、折扣、稅；
 * 匯出 CSV（Excel）與可列印的報價單（含封面與效果圖，瀏覽器「另存 PDF」）。
 */
export function QuotePanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const store = useEditorStore();
  const scene = useEditor((s) => s.scene);
  const projectName = useEditor((s) => s.projectName);
  const q = useMemo(() => buildQuote(scene, i18n.language), [scene, i18n.language]);
  const [tab, setTab] = useState<'items' | 'rooms'>('items');
  const patch = (p: QuoteSettings) => store.getState().exec(setQuote(p));
  const setPrice = (key: string, v: number | null) => {
    const prices = { ...(q.settings.prices ?? {}) };
    if (v === null) delete prices[key];
    else prices[key] = Math.max(0, Math.round(v));
    patch({ prices });
  };
  const summary = (qq: Quote): [string, number][] => [
    [t('quote.subtotal'), qq.subtotal],
    ...(qq.settings.extras ?? []).map((e) => [e.label, e.amount] as [string, number]),
    [t('quote.discount'), -qq.discount],
    [t('quote.tax', { pct: Math.round(qq.settings.taxRate * 100) }), qq.tax],
    [t('quote.total'), qq.total],
  ];

  const exportCsv = () => {
    const csv = quoteCsv(q, {
      headers: [
        t('quote.col.kind'),
        t('quote.col.name'),
        t('quote.col.code'),
        t('quote.col.qty'),
        t('quote.col.unit'),
        t('quote.col.price'),
        t('quote.col.subtotal'),
      ],
      kind: (k) => t(`quote.kind.${k}`),
      summary: summary(q),
    });
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${projectName || 'quote'}.csv`);
  };

  const exportPdf = () => {
    const shot = viewer3dApi.get()?.screenshot() ?? plan2dApi.get()?.snapshot(1600) ?? null;
    const rows = q.lines
      .map(
        (l) =>
          `<tr><td>${esc(t(`quote.kind.${l.kind}`))}</td><td>${esc(l.name)}</td><td class=n>${l.billedQty}</td><td>${esc(
            t(`quote.unit.${l.unit}`),
          )}</td><td class=n>${l.unitPriceTwd !== undefined ? money(l.unitPriceTwd) : '—'}</td><td class=n>${
            l.subtotalTwd !== undefined ? money(l.subtotalTwd) : '—'
          }</td></tr>`,
      )
      .join('');
    const sum = summary(q)
      .map(
        ([k, v], i, a) =>
          `<tr class="${i === a.length - 1 ? 'total' : ''}"><td>${esc(k)}</td><td class=n>${money(v)}</td></tr>`,
      )
      .join('');
    const html = `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8"><title>${esc(projectName)}</title>
<style>
body{font-family:system-ui,"Noto Sans TC",sans-serif;color:#222;margin:32px}
h1{font-size:28px;margin:0 0 4px}.muted{color:#777;font-size:12px}
.cover{page-break-after:always}.cover img{width:100%;max-height:60vh;object-fit:cover;border-radius:8px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}
th{background:#f3f3f3}.n{text-align:right;white-space:nowrap}.sum{width:50%;margin:16px 0 0 auto}.total td{font-weight:700;font-size:14px;border-top:2px solid #222}
.brand{font-weight:800;letter-spacing:.2em;color:#0e7c86}
</style></head><body>
<section class=cover><div class=brand>INTERIOR·AI</div><h1>${esc(t('quote.docTitle'))}</h1>
<div>${esc(projectName)}</div>
<div class=muted>${esc(t('quote.client'))}：${esc(q.settings.client ?? '—')} · ${esc(new Date().toLocaleDateString(i18n.language))}</div>
${shot ? `<img src="${shot}" alt="">` : ''}
<p>${esc(q.settings.note ?? '')}</p>
<table class=sum>${sum}</table></section>
<h2>${esc(t('quote.items'))}</h2>
<table><thead><tr><th>${esc(t('quote.col.kind'))}</th><th>${esc(t('quote.col.name'))}</th><th class=n>${esc(
      t('quote.col.qty'),
    )}</th><th>${esc(t('quote.col.unit'))}</th><th class=n>${esc(t('quote.col.price'))}</th><th class=n>${esc(
      t('quote.col.subtotal'),
    )}</th></tr></thead><tbody>${rows}</tbody></table>
<h2>${esc(t('quote.byRoom'))}</h2><table>${q.rooms
      .map((r) => `<tr><td>${esc(r.name)}</td><td class=n>${money(r.total)}</td></tr>`)
      .join('')}</table>
<table class=sum>${sum}</table>
<script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      // 彈出視窗被阻擋 → 下載 HTML
      download(new Blob([html], { type: 'text/html' }), `${projectName || 'quote'}.html`);
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  return (
    <HudDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('quote.title')}
      testId="quote-panel"
      side="right"
      width={640}
      footer={
        <>
          <button className="btn" onClick={exportCsv} data-testid="quote-csv">
            <FileSpreadsheet size={16} aria-hidden /> {t('quote.csv')}
          </button>
          <button className="btn btn-primary" onClick={exportPdf} data-testid="quote-pdf">
            <Printer size={16} aria-hidden /> {t('quote.pdf')}
          </button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
        <label>
          <span className="mb-1 block text-muted">{t('quote.client')}</span>
          <input
            className="field w-full"
            defaultValue={q.settings.client ?? ''}
            onBlur={(e) => e.target.value !== (q.settings.client ?? '') && patch({ client: e.target.value })}
          />
        </label>
        <label>
          <span className="mb-1 block text-muted">{t('quote.note')}</span>
          <input
            className="field w-full"
            defaultValue={q.settings.note ?? ''}
            onBlur={(e) => e.target.value !== (q.settings.note ?? '') && patch({ note: e.target.value })}
          />
        </label>
      </div>
      <div className="hud-seg mb-2">
        <button aria-pressed={tab === 'items'} onClick={() => setTab('items')}>
          {t('quote.items')}
        </button>
        <button aria-pressed={tab === 'rooms'} onClick={() => setTab('rooms')} data-testid="quote-tab-rooms">
          {t('quote.byRoom')}
        </button>
      </div>
      {tab === 'items' ? (
        <table className="w-full text-xs" data-testid="quote-lines">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left">{t('quote.col.name')}</th>
              <th className="text-right">{t('quote.col.qty')}</th>
              <th className="text-right">{t('quote.col.price')}</th>
              <th className="text-right">{t('quote.col.subtotal')}</th>
            </tr>
          </thead>
          {KINDS.map((k) => {
            const ls = q.lines.filter((l) => l.kind === k);
            if (!ls.length) return null;
            return (
              <tbody key={k}>
                <tr>
                  <th colSpan={4} className="pt-3 pb-1 text-left text-primary">
                    {t(`quote.kind.${k}`)}
                  </th>
                </tr>
                {ls.map((l) => (
                  <tr key={l.key} className="border-t border-border/40">
                    <td className="py-1">{l.name}</td>
                    <td className="text-right whitespace-nowrap">
                      {`${l.billedQty} ${t(`quote.unit.${l.unit}`)}`}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <input
                          className="field w-24 text-right"
                          type="number"
                          min={0}
                          key={`${l.key}-${l.unitPriceTwd ?? ''}`}
                          defaultValue={l.unitPriceTwd ?? ''}
                          aria-label={t('quote.editPrice', { name: l.name })}
                          onBlur={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            if (v !== (l.unitPriceTwd ?? null)) setPrice(l.key, v);
                          }}
                          data-testid={`quote-price-${l.key}`}
                        />
                        {l.overridden && (
                          <button
                            className="icon-btn"
                            title={t('quote.resetPrice')}
                            onClick={() => setPrice(l.key, null)}
                          >
                            <RotateCcw size={12} aria-hidden />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {l.subtotalTwd !== undefined ? money(l.subtotalTwd) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="quote-rooms">
          {q.rooms.map((r) => (
            <li key={r.id} className="flex justify-between border-b border-border/40 py-1">
              <span>{r.name}</span>
              <span>{money(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="hud-section mt-4 space-y-2 p-3 text-xs">
        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className="mb-1 block text-muted">{t('quote.waste')}</span>
            <input
              className="field w-full"
              type="number"
              min={0}
              max={50}
              defaultValue={Math.round(q.settings.wastePct * 100)}
              onBlur={(e) =>
                patch({ wastePct: Math.max(0, Math.min(50, Number(e.target.value) || 0)) / 100 })
              }
            />
          </label>
          <label>
            <span className="mb-1 block text-muted">{t('quote.taxRate')}</span>
            <input
              className="field w-full"
              type="number"
              min={0}
              max={30}
              defaultValue={Math.round(q.settings.taxRate * 100)}
              onBlur={(e) => patch({ taxRate: Math.max(0, Math.min(30, Number(e.target.value) || 0)) / 100 })}
            />
          </label>
          <label>
            <span className="mb-1 block text-muted">{t('quote.discount')}</span>
            <input
              className="field w-full"
              type="number"
              min={0}
              defaultValue={q.discount}
              onBlur={(e) => patch({ discount: Math.max(0, Number(e.target.value) || 0) })}
              data-testid="quote-discount"
            />
          </label>
        </div>
        <div>
          <div className="mb-1 flex items-center text-muted">
            <span className="flex-1">{t('quote.extras')}</span>
            <button
              className="icon-btn"
              title={t('quote.addExtra')}
              onClick={() =>
                patch({ extras: [...(q.settings.extras ?? []), { label: t('quote.designFee'), amount: 0 }] })
              }
            >
              <Plus size={12} aria-hidden />
            </button>
          </div>
          {(q.settings.extras ?? []).map((e, i) => (
            <div key={`${i}-${e.label}-${e.amount}`} className="mb-1 flex gap-1">
              <input
                className="field flex-1"
                defaultValue={e.label}
                aria-label={t('quote.extraLabel')}
                onBlur={(ev) =>
                  patch({
                    extras: q.settings.extras!.map((x, k) =>
                      k === i ? { ...x, label: ev.target.value } : x,
                    ),
                  })
                }
              />
              <input
                className="field w-28 text-right"
                type="number"
                defaultValue={e.amount}
                aria-label={t('quote.extraAmount')}
                onBlur={(ev) =>
                  patch({
                    extras: q.settings.extras!.map((x, k) =>
                      k === i ? { ...x, amount: Math.round(Number(ev.target.value) || 0) } : x,
                    ),
                  })
                }
              />
              <button
                className="icon-btn"
                title={t('quote.removeExtra')}
                onClick={() => patch({ extras: q.settings.extras!.filter((_, k) => k !== i) })}
              >
                <Trash2 size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <dl className="space-y-0.5 border-t border-border pt-2" data-testid="quote-summary">
          {summary(q).map(([k, v], i, a) => (
            <div
              key={i}
              className={`flex justify-between ${i === a.length - 1 ? 'text-base font-bold text-primary' : ''}`}
            >
              <dt>{k}</dt>
              <dd data-testid={i === a.length - 1 ? 'quote-total' : undefined}>{money(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </HudDialog>
  );
}
