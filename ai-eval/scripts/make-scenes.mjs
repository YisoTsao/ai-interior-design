// 產生 30 個評測場景（10 客廳 / 10 臥室 / 10 廚衛），全部經 app-state Command 建立 → 保證通過 Scene 驗證。
// 確定性：固定種子。輸出 ai-eval/scenes/<id>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  activeLevel,
  addObject,
  addOpening,
  addRectRoom,
  createEditorStore,
  renameRoom,
  setMaterial,
} from '@interiorai/app-state';
import { validateScene } from '@interiorai/scene-schema';

let seed = 20260930;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b, step = 100) => Math.round((a + rnd() * (b - a)) / step) * step;

const KINDS = {
  living: {
    label: '客廳',
    floors: ['mat_wood_oak', 'mat_wood_walnut', 'mat_tile_grey60', 'mat_stone_terrazzo'],
    items: (w, d) => [
      ['sofa_3seat_a', w / 2, d - 700, Math.PI],
      ['table_coffee_a', w / 2, d - 1700],
      ['rug_2000', w / 2, d - 1700],
      ['tvstand_1800', w / 2, 350],
      ['plant_a', w - 400, d - 400],
      ['armchair_a', w - 700, d - 1900, -Math.PI / 2],
      ['lamp_floor_a', 400, d - 400],
    ],
  },
  bedroom: {
    label: '臥室',
    floors: ['mat_wood_oak', 'mat_wood_walnut'],
    items: (w, d) => [
      ['bed_double_150', w / 2, 1200],
      ['nightstand_a', w / 2 - 1050, 350],
      ['nightstand_a', w / 2 + 1050, 350],
      ['desk_dresser_a', w - 600, d - 350, Math.PI],
      ['plant_a', 400, d - 400],
      ['rug_2000', w / 2, 2300],
    ],
  },
  kitchen: {
    label: '廚房',
    floors: ['mat_tile_grey60', 'mat_stone_terrazzo'],
    items: (w, d) => [
      ['counter_base_900', 600, 350],
      ['counter_base_600', 1350, 350],
      ['fridge_a', w - 500, 400],
      ['island_1500', w / 2, d / 2 + 200],
      ['chair_dining_a', w / 2 - 400, d / 2 + 900, Math.PI],
      ['chair_dining_a', w / 2 + 400, d / 2 + 900, Math.PI],
    ],
  },
  bath: {
    label: '衛浴',
    floors: ['mat_tile_grey60'],
    items: (w, d) => [
      ['toilet_a', 500, 450],
      ['basin_a', w - 500, 350],
      ['bathtub_1600', w / 2, d - 450, Math.PI],
    ],
  },
};

mkdirSync(new URL('../scenes/', import.meta.url), { recursive: true });
const plan = [
  ...Array(10).fill('living'),
  ...Array(10).fill('bedroom'),
  ...Array(5).fill('kitchen'),
  ...Array(5).fill('bath'),
];
plan.forEach((kind, i) => {
  const k = KINDS[kind];
  const s = createEditorStore();
  const L = s.getState().levelId;
  const [w, d] =
    kind === 'bath'
      ? [between(2000, 2800), between(2200, 3000)]
      : kind === 'kitchen'
        ? [between(3200, 4200), between(3200, 4200)]
        : [between(3600, 5600), between(3600, 5200)];
  s.getState().exec(addRectRoom(L, [0, 0], [w, d]));
  const lvl = activeLevel(s.getState());
  const room = lvl.rooms[0];
  s.getState().exec(renameRoom(L, room.id, k.label));
  s.getState().exec(setMaterial(L, { kind: 'floor', roomId: room.id }, pick(k.floors)));
  const south = lvl.walls.find((x) => x.a[1] === 0 && x.b[1] === 0) ?? lvl.walls[0];
  const north = lvl.walls.find((x) => x.a[1] === d && x.b[1] === d) ?? lvl.walls[2];
  s.getState().exec(
    addOpening(L, { wallId: south.id, type: 'door', offset: 200, width: 900, height: 2100, sill: 0 }),
  );
  if (kind !== 'bath')
    s.getState().exec(
      addOpening(L, {
        wallId: north.id,
        type: 'window',
        offset: Math.round(w / 2 - 700),
        width: 1400,
        height: 1300,
        sill: 900,
      }),
    );
  for (const [catalogId, x, z, rot = 0] of k.items(w, d))
    if (rnd() > 0.1 || catalogId.startsWith('sofa') || catalogId.startsWith('bed'))
      s.getState().exec(
        addObject(L, { catalogId, position: [Math.round(x), 0, Math.round(z)], rotationY: rot }),
      );
  const scene = s.getState().scene;
  const v = validateScene(scene);
  if (!v.ok) throw new Error(`${kind}-${i}: ${JSON.stringify(v.issues)}`);
  const id = `${String(i + 1).padStart(2, '0')}-${kind}`;
  writeFileSync(
    new URL(`../scenes/${id}.json`, import.meta.url),
    JSON.stringify({ id, kind, scene }, null, 1),
  );
});
console.log(`已產生 ${plan.length} 個場景`);
