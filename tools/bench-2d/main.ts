// ADR-010 原型：同一份 500 圖元場景（牆多邊形 + 家具矩形 + 標註文字），量測拖曳一個圖元時的 FPS 與單幀耗時。
import Konva from 'konva';
import { Application, Container, Graphics, Text } from 'pixi.js';

const N = Number(new URLSearchParams(location.search).get('n') ?? 500);
const W = 1280;
const H = 800;
type Item = { x: number; y: number; w: number; h: number; kind: 'wall' | 'obj' | 'label' };
const rand = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const items: Item[] = Array.from({ length: N }, (_, i) => {
  const kind = i % 5 === 0 ? 'label' : i % 2 ? 'wall' : 'obj';
  return { x: rand() * (W - 80), y: rand() * (H - 80), w: kind === 'wall' ? 120 : 40, h: kind === 'wall' ? 8 : 40, kind };
});

type Engine = { move(x: number, y: number): void; frame(): Promise<void> };

function konva(): Engine {
  const stage = new Konva.Stage({ container: 'stage', width: W, height: H });
  const layer = new Konva.Layer();
  stage.add(layer);
  const shapes = items.map((it) =>
    it.kind === 'label'
      ? new Konva.Text({ x: it.x, y: it.y, text: '3200 mm', fontSize: 12, fill: '#1b1d21' })
      : new Konva.Rect({ x: it.x, y: it.y, width: it.w, height: it.h, fill: it.kind === 'wall' ? '#6b7280' : '#c8a77e', stroke: '#1b1d21', strokeWidth: 1 }),
  );
  shapes.forEach((s) => layer.add(s));
  layer.draw();
  const target = shapes[1]!;
  return {
    move: (x, y) => { target.position({ x, y }); layer.batchDraw(); },
    frame: () => new Promise((r) => requestAnimationFrame(() => r())),
  };
}

// Konva 官方建議的最佳化：被拖曳圖元移到獨立 drag layer，其餘圖層不重畫；關閉 perfectDraw
function konvaOpt(): Engine {
  const stage = new Konva.Stage({ container: 'stage', width: W, height: H });
  const layer = new Konva.Layer();
  const drag = new Konva.Layer();
  stage.add(layer, drag);
  const shapes = items.map((it) =>
    it.kind === 'label'
      ? new Konva.Text({ x: it.x, y: it.y, text: '3200 mm', fontSize: 12, fill: '#1b1d21', perfectDrawEnabled: false })
      : new Konva.Rect({ x: it.x, y: it.y, width: it.w, height: it.h, fill: it.kind === 'wall' ? '#6b7280' : '#c8a77e', stroke: '#1b1d21', strokeWidth: 1, perfectDrawEnabled: false, shadowForStrokeEnabled: false }),
  );
  shapes.forEach((s) => layer.add(s));
  layer.draw();
  const target = shapes[1]!;
  target.moveTo(drag);
  layer.batchDraw();
  return {
    move: (x, y) => { target.position({ x, y }); drag.batchDraw(); },
    frame: () => new Promise((r) => requestAnimationFrame(() => r())),
  };
}

async function pixi(): Promise<Engine> {
  const app = new Application();
  await app.init({ width: W, height: H, background: '#fafaf7', antialias: true, preference: 'webgl' });
  document.getElementById('stage')!.appendChild(app.canvas);
  const root = new Container();
  app.stage.addChild(root);
  const nodes = items.map((it) => {
    if (it.kind === 'label') {
      const t = new Text({ text: '3200 mm', style: { fontSize: 12, fill: '#1b1d21' } });
      t.position.set(it.x, it.y);
      return t;
    }
    const g = new Graphics().rect(0, 0, it.w, it.h).fill(it.kind === 'wall' ? '#6b7280' : '#c8a77e').stroke({ width: 1, color: '#1b1d21' });
    g.position.set(it.x, it.y);
    return g;
  });
  nodes.forEach((n) => root.addChild(n));
  const target = nodes[1]!;
  return {
    move: (x, y) => target.position.set(x, y),
    frame: () => new Promise((r) => requestAnimationFrame(() => r())),
  };
}

async function run() {
  const which = new URLSearchParams(location.search).get('engine') ?? 'konva';
  const eng = which === 'pixi' ? await pixi() : which === 'konva-opt' ? konvaOpt() : konva();
  for (let i = 0; i < 30; i++) await eng.frame(); // 暖機
  const frames: number[] = [];
  let last = performance.now();
  const t0 = last;
  let i = 0;
  while (performance.now() - t0 < 3000) {
    eng.move(200 + Math.sin(i / 10) * 150, 300 + Math.cos(i / 10) * 150); // 模擬拖曳
    await eng.frame();
    const now = performance.now();
    frames.push(now - last);
    last = now;
    i++;
  }
  frames.sort((a, b) => a - b);
  const fps = (frames.length / (performance.now() - t0)) * 1000;
  const p95 = frames[Math.floor(frames.length * 0.95)]!;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
  (window as unknown as { __bench: unknown }).__bench = { engine: which, fps, p95FrameMs: p95, frames: frames.length, heapMB: mem ? mem / 1048576 : null };
}
run();
