import { describe, expect, it } from 'vitest';
import { createCatalog, SEED_CATALOG, SEED_MATERIALS } from '@interiorai/catalog';
import {
  activeLevel,
  addObject,
  addRectRoom,
  createEditorStore,
  renameRoom,
  updateRoom,
} from '@interiorai/app-state';
import {
  checkToolCall,
  checkToolCalls,
  makeCtx,
  mockTransport,
  runTurn,
  summarizeScene,
  TOOLS,
} from '../src/index.js';

const catalog = createCatalog(SEED_CATALOG);

function setup() {
  const store = createEditorStore({ projectName: 't' });
  const s = store.getState();
  s.exec(addRectRoom(s.levelId, [0, 0], [5000, 4000]));
  const room = activeLevel(store.getState()).rooms[0]!;
  s.exec(renameRoom(s.levelId, room.id, '客廳'));
  s.exec(updateRoom(s.levelId, room.id, { kind: 'living' }));
  s.exec(addObject(s.levelId, { catalogId: 'sofa_3seat_a', position: [2500, 0, 1000], rotationY: 0 }));
  const st = store.getState();
  return makeCtx(st.scene, st.levelId, catalog, SEED_MATERIALS);
}

describe('工具呼叫驗證（B6.4-1）', () => {
  it('每個工具都有物件型 JSON Schema', () => {
    for (const t of TOOLS) expect(t.parameters).toMatchObject({ type: 'object' });
  });
  it('未提供的工具、無效 JSON、非物件都被拒絕', () => {
    expect(checkToolCall({ name: 'rm_rf', arguments: {} }).ok).toBe(false);
    expect(checkToolCall({ name: 'list_objects', arguments: '{bad' }).ok).toBe(false);
    expect(checkToolCall({ name: 'list_objects', arguments: [] }).ok).toBe(false);
  });
  it('合法呼叫：JSON 字串參數會被解析；不合法的 id 換成 call_<i>', () => {
    const r = checkToolCall({ id: 'x y', name: 'list_objects', arguments: '{}' }, 3);
    expect(r).toMatchObject({ ok: true, call: { id: 'call_3', name: 'list_objects', arguments: {} } });
  });
  it('一批呼叫：分成合法與不合法', () => {
    const r = checkToolCalls([
      { name: 'list_objects', arguments: {} },
      { name: 'nope', arguments: {} },
    ]);
    expect(r.valid).toHaveLength(1);
    expect(r.invalid).toHaveLength(1);
  });
});

describe('對話流程（mock）', () => {
  it('場景摘要含房間與物件', () => {
    const sum = summarizeScene(setup());
    expect(JSON.stringify(sum)).toContain('客廳');
    expect(JSON.stringify(sum)).toContain('sofa_3seat_a');
  });
  it('查詢型工具由程式執行並回覆，不產生提案', async () => {
    const r = await runTurn(setup(), [], '客廳有哪些家具？', mockTransport);
    expect(r.queries.map((q) => q.call.name)).toContain('list_objects');
    expect(r.proposals).toHaveLength(0);
    expect(r.reply.length).toBeGreaterThan(0);
  });
  it('修改需求只產生待確認的提案，不修改場景', async () => {
    const ctx = setup();
    const before = JSON.stringify(ctx.scene);
    const r = await runTurn(ctx, [], '把沙發往右移 50 公分', mockTransport);
    expect(r.proposals.length + r.rejected.length).toBeGreaterThan(0);
    expect(JSON.stringify(ctx.scene)).toBe(before);
  });
});
