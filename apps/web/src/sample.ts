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
import type { Scene } from '@interiorai/scene-schema';

/** 範例：兩房一廳（約 23 坪）。全部透過 Command 建立，保證通過驗證。 */
export function buildSampleScene(names: { living: string; bed1: string; bed2: string }): Scene {
  const s = createEditorStore();
  const st = s.getState();
  const L = st.levelId;
  st.exec(
    addWalls(
      L,
      [
        [0, 0],
        [9000, 0],
        [9000, 8400],
        [0, 8400],
      ],
      { closed: true, thickness: 200, type: 'exterior' },
    ),
  );
  st.exec(
    addWalls(L, [
      [5200, 0],
      [5200, 8400],
    ]),
  );
  st.exec(
    addWalls(L, [
      [5200, 4200],
      [9000, 4200],
    ]),
  );
  const lv = () => activeLevel(s.getState());
  const wallBy = (pred: (w: ReturnType<typeof lv>['walls'][number]) => boolean) => lv().walls.find(pred)!;
  const south = wallBy((w) => w.a[1] === 0 && w.b[1] === 0 && Math.min(w.a[0], w.b[0]) === 0);
  const north = wallBy((w) => w.a[1] === 8400 && w.b[1] === 8400 && Math.min(w.a[0], w.b[0]) === 0);
  // T 型接點不會切斷牆：中間隔間是一整面牆
  const mid = wallBy((w) => w.a[0] === 5200 && w.b[0] === 5200);
  const east = wallBy((w) => w.a[0] === 9000 && w.b[0] === 9000);
  for (const w of lv().walls.filter((x) => x.type === 'exterior'))
    st.exec(updateWall(L, w.id, { materialIdB: 'mat_paint_grey' }));
  st.exec(
    addOpening(L, {
      wallId: south.id,
      type: 'door',
      offset: 600,
      width: 1000,
      height: 2100,
      sill: 0,
      swing: 'left',
    }),
  );
  st.exec(
    addOpening(L, { wallId: north.id, type: 'window', offset: 1400, width: 2400, height: 1500, sill: 800 }),
  );
  const midLen = Math.abs(mid.b[1] - mid.a[1]);
  const fromA = (z: number, width: number) => (mid.a[1] < mid.b[1] ? z : midLen - z - width);
  st.exec(
    addOpening(L, {
      wallId: mid.id,
      type: 'door',
      offset: fromA(2800, 900),
      width: 900,
      height: 2100,
      sill: 0,
      swing: 'right',
    }),
  );
  st.exec(
    addOpening(L, {
      wallId: mid.id,
      type: 'door',
      offset: fromA(5400, 900),
      width: 900,
      height: 2100,
      sill: 0,
      swing: 'left',
    }),
  );
  const eastLen = Math.abs(east.b[1] - east.a[1]);
  st.exec(
    addOpening(L, {
      wallId: east.id,
      type: 'window',
      offset: east.a[1] < east.b[1] ? 1200 : eastLen - 1200 - 1500,
      width: 1500,
      height: 1200,
      sill: 900,
    }),
  );
  const rooms = lv().rooms;
  const living = rooms.find((r) => r.wallIds.includes(south.id) && r.wallIds.includes(north.id))!;
  for (const r of rooms) {
    if (r.id === living.id) st.exec(renameRoom(L, r.id, names.living));
    else if (r.wallIds.includes(south.id)) {
      st.exec(renameRoom(L, r.id, names.bed1));
      st.exec(setMaterial(L, { kind: 'floor', roomId: r.id }, 'mat_wood_walnut'));
    } else {
      st.exec(renameRoom(L, r.id, names.bed2));
      st.exec(setMaterial(L, { kind: 'floor', roomId: r.id }, 'mat_wood_walnut'));
    }
  }
  // 深色胡桃木地板（夜間氛圍中反射燈光，images1）
  st.exec(setMaterial(L, { kind: 'floor', roomId: living.id }, 'mat_wood_walnut'));
  const place = (catalogId: string, x: number, z: number, rot = 0, y = 0) =>
    st.exec(addObject(L, { catalogId, position: [x, y, z], rotationY: rot }));
  place('sofa_3seat_a', 2600, 6900, Math.PI);
  place('table_coffee_a', 2600, 5800);
  place('tvstand_1800', 2600, 3900);
  place('rug_2000', 2600, 5800);
  place('table_dining_4', 2600, 1800);
  place('chair_dining_a', 2100, 1100);
  place('chair_dining_a', 3100, 1100);
  place('chair_dining_a', 2100, 2500, Math.PI);
  place('chair_dining_a', 3100, 2500, Math.PI);
  place('plant_a', 4700, 7900);
  place('bed_double_150', 7400, 1500);
  place('nightstand_a', 6300, 400);
  place('cabinet_wardrobe_1800', 7800, 3800, Math.PI);
  place('bed_single_90', 7900, 6900);
  place('desk_office_1400', 6300, 7900, Math.PI);
  place('lamp_pendant_a', 2600, 5800, 0, 2400);
  // 燈具（夜間氛圍的主要光源，images1）：客廳崁燈、立燈、電視櫃燈條；主臥檯燈與壁燈；次臥電競角落
  const light = (
    catalogId: string,
    x: number,
    z: number,
    rot: number,
    y: number,
    params?: Record<string, number | string>,
  ) =>
    st.exec(addObject(L, { catalogId, position: [x, y, z], rotationY: rot, ...(params ? { params } : {}) }));
  const down = 2800 - 60;
  for (const [x, z] of [
    [1300, 1000],
    [3900, 1000],
    [1300, 4300],
    [3900, 4300],
    [7100, 2600],
    [7100, 5600],
  ] as const)
    light('lamp_downlight_a', x, z, 0, down);
  light('lamp_floor_a', 1200, 7800, 0, 0);
  light('led_strip_1000', 2600, 3780, 0, 500, { color: 'amber' });
  light('lamp_table_a', 6300, 400, 0, 500);
  light('lamp_wall_a', 8450, 190, 0, 1450);
  light('monitor_27', 6300, 8060, Math.PI, 750, { color: '6500K' });
  light('light_hex_a', 8885, 7250, -Math.PI / 2, 1150, { color: 'magenta' });
  light('led_bar_1200', 5330, 7650, Math.PI / 2, 0, { color: 'pink' });
  light('curtain_pair', 6400, 8230, Math.PI, 0, { w: 3000 });
  light('curtain_pair', 8830, 1950, -Math.PI / 2, 0, { w: 2100 });
  return s.getState().scene;
}
