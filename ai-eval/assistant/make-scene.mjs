// 助理評測用固定場景（兩房一廳，與 apps/web 範例相同配置），id 改成可讀的固定值，方便撰寫期望的工具呼叫。
// 平面方位約定（ADR-023）：2D 平面圖上方（−z）為「北」、右方（+x）為「東」。
import { writeFileSync } from 'node:fs';
import {
  activeLevel,
  addObject,
  addOpening,
  addWalls,
  createEditorStore,
  renameRoom,
  setMaterial,
  updateWall,
} from '@interiorai/app-state';
import { validateScene } from '@interiorai/scene-schema';

const s = createEditorStore();
const st = s.getState();
const L = st.levelId;
const lv = () => activeLevel(s.getState());
st.exec(addWalls(L, [[0, 0], [9000, 0], [9000, 8400], [0, 8400]], { closed: true, thickness: 200, type: 'exterior' }));
st.exec(addWalls(L, [[5200, 0], [5200, 8400]]));
st.exec(addWalls(L, [[5200, 4200], [9000, 4200]]));
const wallBy = (pred) => lv().walls.find(pred);
const north = wallBy((w) => w.a[1] === 0 && w.b[1] === 0 && Math.min(w.a[0], w.b[0]) === 0);
const south = wallBy((w) => w.a[1] === 8400 && w.b[1] === 8400 && Math.min(w.a[0], w.b[0]) === 0);
const mid = wallBy((w) => w.a[0] === 5200 && w.b[0] === 5200);
const east = wallBy((w) => w.a[0] === 9000 && w.b[0] === 9000);
const west = wallBy((w) => w.a[0] === 0 && w.b[0] === 0);
const cross = wallBy((w) => w.a[1] === 4200 && w.b[1] === 4200);
for (const w of lv().walls.filter((x) => x.type === 'exterior')) st.exec(updateWall(L, w.id, { materialIdB: 'mat_paint_grey' }));
st.exec(addOpening(L, { wallId: north.id, type: 'door', offset: 600, width: 1000, height: 2100, sill: 0, swing: 'left' }));
st.exec(addOpening(L, { wallId: south.id, type: 'window', offset: 1400, width: 2400, height: 1500, sill: 800 }));
const midLen = Math.abs(mid.b[1] - mid.a[1]);
const fromA = (z, width) => (mid.a[1] < mid.b[1] ? z : midLen - z - width);
st.exec(addOpening(L, { wallId: mid.id, type: 'door', offset: fromA(2800, 900), width: 900, height: 2100, sill: 0, swing: 'right' }));
st.exec(addOpening(L, { wallId: mid.id, type: 'door', offset: fromA(5400, 900), width: 900, height: 2100, sill: 0, swing: 'left' }));
const eastLen = Math.abs(east.b[1] - east.a[1]);
st.exec(addOpening(L, { wallId: east.id, type: 'window', offset: east.a[1] < east.b[1] ? 1200 : eastLen - 1200 - 1500, width: 1500, height: 1200, sill: 900 }));

const rooms = lv().rooms;
const living = rooms.find((r) => r.wallIds.includes(north.id) && r.wallIds.includes(south.id));
const bed1 = rooms.find((r) => r !== living && r.wallIds.includes(north.id));
const bed2 = rooms.find((r) => r !== living && r !== bed1);
st.exec(renameRoom(L, living.id, '客廳'));
st.exec(renameRoom(L, bed1.id, '主臥'));
st.exec(renameRoom(L, bed2.id, '次臥'));
for (const r of [living, bed1, bed2]) st.exec(setMaterial(L, { kind: 'floor', roomId: r.id }, 'mat_wood_walnut'));

const objIds = [];
const place = (key, catalogId, x, z, rot = 0, y = 0, params) => {
  st.exec(addObject(L, { catalogId, position: [x, y, z], rotationY: rot, ...(params ? { params } : {}) }));
  objIds.push([lv().objects.at(-1).id, key]);
};
place('obj_sofa', 'sofa_3seat_a', 2600, 6900, Math.PI);
place('obj_coffee', 'table_coffee_a', 2600, 5800);
place('obj_tv', 'tvstand_1800', 2600, 3900);
place('obj_rug', 'rug_2000', 2600, 5800);
place('obj_dining', 'table_dining_4', 2600, 1800);
place('obj_chair1', 'chair_dining_a', 2100, 1100);
place('obj_chair2', 'chair_dining_a', 3100, 1100);
place('obj_chair3', 'chair_dining_a', 2100, 2500, Math.PI);
place('obj_chair4', 'chair_dining_a', 3100, 2500, Math.PI);
place('obj_plant', 'plant_a', 4700, 7900);
place('obj_bed', 'bed_double_150', 7400, 1500);
place('obj_nightstand', 'nightstand_a', 6300, 400);
place('obj_wardrobe', 'cabinet_wardrobe_1800', 7800, 3800, Math.PI);
place('obj_bed2', 'bed_single_90', 7900, 6900);
place('obj_desk', 'desk_office_1400', 6300, 7900, Math.PI);
place('obj_floorlamp', 'lamp_floor_a', 1200, 7800);

// 可讀 id
const scene = JSON.parse(JSON.stringify(s.getState().scene));
const map = new Map([
  [lv().id, 'lvl_1'],
  [north.id, 'w_north'], [south.id, 'w_south'], [east.id, 'w_east'], [west.id, 'w_west'], [mid.id, 'w_mid'], [cross.id, 'w_cross'],
  [living.id, 'r_living'], [bed1.id, 'r_master'], [bed2.id, 'r_second'],
  ...objIds,
]);
const ops = lv().openings;
const opName = ['o_entry', 'o_window_s', 'o_door_master', 'o_door_second', 'o_window_e'];
ops.forEach((o, i) => map.set(o.id, opName[i]));
let json = JSON.stringify(scene);
for (const [from, to] of map) json = json.split(from).join(to);
const out = JSON.parse(json);
out.meta = { source: 'manual' };
const v = validateScene(out);
if (!v.ok) throw new Error(JSON.stringify(v));
const left = JSON.stringify(out).match(/"(w|o|r|obj|lvl)_[0-9A-Z]{26}"/);
if (left) throw new Error(`未替換的 id：${left[0]}`);
writeFileSync(new URL('./scene.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('walls', out.levels[0].walls.map((w) => `${w.id} ${w.a}→${w.b}`).join(' | '));
console.log('openings', out.levels[0].openings.map((o) => `${o.id} ${o.type} ${o.wallId} ${o.offset}`).join(' | '));
