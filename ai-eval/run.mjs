// AI 渲染評測 harness（05 §8）。30 場景 × 5 風格，輸出 CSV（結構分數、耗時、成本、失敗）＋ 人工評分 HTML。
// 用法：pnpm ai-eval run --provider mock|openai|flux [--route A|B] [--mode ok|break_structure] [--strictness balanced] [--limit N]
// 真實供應商需要 OPENAI_API_KEY / BFL_API_KEY；mock 結果一律標「未校準」（ADR-012）。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  FluxImageProvider,
  MockImageProvider,
  OpenAIImageProvider,
  STYLES,
  decodePng,
  fill,
  loadModels,
  loadTemplate,
  outputSize,
  resolveRef,
  sanitizeUserExtra,
  summarizeScene,
  validateStructure,
} from '@interiorai/api';

const { values: a } = parseArgs({
  args: process.argv.slice(2).filter((x) => x !== 'run'),
  options: {
    provider: { type: 'string', default: 'mock' },
    route: { type: 'string', default: 'A' },
    mode: { type: 'string', default: 'ok' },
    strictness: { type: 'string', default: 'balanced' },
    limit: { type: 'string' },
    out: { type: 'string' },
  },
});
const models = await loadModels();
const ref = a.route === 'B' ? 'flux.depth_control' : 'openai.image.render_edit';
const entry = resolveRef(models, ref).entry;
const provider =
  a.provider === 'mock'
    ? new MockImageProvider(() => a.mode)
    : a.provider === 'openai'
      ? new OpenAIImageProvider(models.providers.openai.base_url, process.env.OPENAI_API_KEY ?? '')
      : new FluxImageProvider(models.providers.flux.base_url, process.env.BFL_API_KEY ?? '');
if (a.provider !== 'mock' && !(process.env.OPENAI_API_KEY || process.env.BFL_API_KEY))
  throw new Error('真實供應商需要 OPENAI_API_KEY 或 BFL_API_KEY');
const tpl = await loadTemplate(a.route === 'B' ? 'render.strict' : 'render.balanced');

const here = new URL('./', import.meta.url);
const scenes = readdirSync(new URL('scenes/', here))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .slice(0, a.limit ? Number(a.limit) : undefined);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = new URL(a.out ?? `results/${stamp}-${a.provider}-${a.route}-${a.mode}/`, here);
mkdirSync(new URL('images/', outDir), { recursive: true });

const rows = [];
for (const f of scenes) {
  const { id, kind, scene } = JSON.parse(readFileSync(new URL(`scenes/${f}`, here), 'utf8'));
  const dir = new URL(`gbuffers/${id}/`, here);
  const g = Object.fromEntries(
    ['color', 'depth', 'edge', 'objectId'].map((k) => [k, readFileSync(new URL(`${k}.png`, dir))]),
  );
  const edge = decodePng(g.edge);
  const size = outputSize(edge.width, edge.height, '1k');
  const { roomType, materialList } = summarizeScene(scene);
  for (const style of Object.keys(STYLES)) {
    const prompt = fill(tpl, {
      roomType,
      styleTemplate: STYLES[style],
      materialList,
      lighting: 'soft natural daylight with realistic shadows',
      userExtra: sanitizeUserExtra(undefined),
      retryNote: '',
    });
    const row = {
      scene: id,
      kind,
      style,
      provider: a.provider,
      route: a.route,
      mode: a.mode,
      score: '',
      passed: false,
      latencyMs: '',
      costUsd: '',
      error: '',
    };
    try {
      const r = await provider.render(
        { gbuffer: g, size, prompt: prompt.text, seed: 1 },
        {
          signal: AbortSignal.timeout(120_000),
          model: entry.model,
          endpoint: entry.endpoint,
          costUsd: a.provider === 'mock' ? 0 : (entry.cost_usd_per_image ?? 0),
        },
      );
      const v = validateStructure(
        decodePng(r.image),
        edge,
        a.strictness,
        models.structure_validation,
        decodePng(g.color),
      );
      Object.assign(row, { score: v.score, passed: v.passed, latencyMs: r.latencyMs, costUsd: r.costUsd });
      writeFileSync(new URL(`images/${id}-${style}.png`, outDir), r.image);
    } catch (e) {
      row.error = String(e.message ?? e).slice(0, 200);
    }
    rows.push(row);
  }
  process.stdout.write('.');
}

const cols = Object.keys(rows[0]);
writeFileSync(
  new URL('results.csv', outDir),
  [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n'),
);
const ok = rows.filter((r) => !r.error);
const scores = ok.map((r) => Number(r.score)).sort((x, y) => x - y);
const summary = {
  provider: a.provider,
  route: a.route,
  mode: a.mode,
  strictness: a.strictness,
  threshold: models.structure_validation.recall_threshold[a.strictness],
  calibrated: models.structure_validation.calibrated,
  runs: rows.length,
  failureRate: (rows.length - ok.length) / rows.length,
  passRate: ok.filter((r) => r.passed).length / rows.length,
  scoreP10: scores[Math.floor(scores.length * 0.1)] ?? null,
  scoreMedian: scores[Math.floor(scores.length / 2)] ?? null,
  avgLatencyMs: ok.reduce((s, r) => s + Number(r.latencyMs), 0) / Math.max(1, ok.length),
  totalCostUsd: ok.reduce((s, r) => s + Number(r.costUsd), 0),
  byKind: Object.fromEntries(
    ['living', 'bedroom', 'kitchen', 'bath'].map((k) => [
      k,
      rows.filter((r) => r.kind === k && r.passed).length /
        Math.max(1, rows.filter((r) => r.kind === k).length),
    ]),
  ),
};
writeFileSync(new URL('summary.json', outDir), JSON.stringify(summary, null, 2));

// 人工評分頁：結構一致 / 真實感 / 風格符合（1–5），可匯出 CSV
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cards = rows
  .map(
    (r) => `<figure data-key="${esc(r.scene)}|${esc(r.style)}">
  <div class="pair"><img src="../../gbuffers/${esc(r.scene)}/color.png" alt="clay"><img src="images/${esc(r.scene)}-${esc(r.style)}.png" alt="${esc(r.error || 'render')}"></div>
  <figcaption>${esc(r.scene)} · ${esc(r.style)} · score ${esc(r.score)} ${r.passed ? '✓' : '✗'} ${esc(r.error)}</figcaption>
  ${['structure', 'realism', 'style'].map((k) => `<label>${k} <select name="${k}"><option></option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select></label>`).join(' ')}
</figure>`,
  )
  .join('\n');
writeFileSync(
  new URL('report.html', outDir),
  `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 渲染評測</title>
<style>body{font:14px system-ui;margin:16px;background:#fafaf7;color:#1b1d21}figure{display:inline-block;width:460px;margin:8px;padding:8px;background:#fff;border:1px solid #e5e4df;border-radius:8px}.pair{display:flex;gap:4px}.pair img{width:50%}figcaption{margin:6px 0;font-size:12px}pre{background:#fff;padding:8px}</style></head><body>
<h1>AI 渲染評測（${esc(a.provider)} / 路線 ${esc(a.route)} / ${esc(a.mode)}）</h1>
<p>門檻 ${summary.threshold}（${summary.calibrated ? '已校準' : '未校準'}）。人工評分 1–5：結構一致 / 真實感 / 風格符合。</p>
<pre>${esc(JSON.stringify(summary, null, 2))}</pre>
<button id="export">匯出評分 CSV</button>
${cards}
<script>
document.getElementById('export').onclick = () => {
  const lines = ['scene,style,structure,realism,style_fit'];
  document.querySelectorAll('figure').forEach((f) => {
    const [scene, style] = f.dataset.key.split('|');
    const v = (n) => f.querySelector('[name=' + n + ']').value;
    lines.push([scene, style, v('structure'), v('realism'), v('style')].join(','));
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\\n')], { type: 'text/csv' }));
  a.download = 'ratings.csv';
  a.click();
};
</script></body></html>`,
);
console.log(`\n${JSON.stringify(summary)}\n→ ${outDir.pathname}`);
