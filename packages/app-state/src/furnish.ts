import { objectDims, type Catalog, type CatalogEntry } from '@interiorai/catalog';
import {
  detectRooms,
  objectFootprint,
  openingSegment,
  overlapArea,
  pointInPolygon,
  type Vec2,
} from '@interiorai/core-geometry';
import type { Level, Room, RoomKind, SceneObject } from '@interiorai/scene-schema';

/**
 * 自動佈置（前台需求 FE-AI-02）：依房間用途產生完整家具配置，並提供多種風格的提案。
 * 規則式（可解釋、可重現）：大件靠牆（背靠牆、正面朝室內），附屬件相對主件擺放，
 * 保持門口淨空、不與既有或新放的家具重疊、必須完全在房間淨地板內。純函式，不修改 level。
 */
export type Placement = Omit<SceneObject, 'id'>;
export const FURNISH_STYLES = ['nordic', 'modern', 'japandi', 'industrial', 'luxury'] as const;
export type FurnishStyle = (typeof FURNISH_STYLES)[number];

export interface FurnishOptions {
  style?: FurnishStyle;
  /** 預算上限（TWD，參考價）；超過時依優先序刪除次要品項 */
  budget?: number;
  /** 只佈置這些房間（預設全部） */
  roomIds?: string[];
  /** 已有家具的房間也佈置（預設略過已有 ≥ 2 件地面家具的房間） */
  includeFurnished?: boolean;
}
export interface FurnishProposal {
  style: FurnishStyle;
  placements: Placement[];
  cost: number;
  rooms: { roomId: string; label: string | null; kind: RoomKind; count: number }[];
}

/** 風格 → 布料／木作／金屬材質（擴充材質庫 id） */
const STYLE_MATS: Record<FurnishStyle, { fabric: string; wood: string; metal: string }> = {
  nordic: { fabric: 'fabric_oatmeal_boucle', wood: 'veneer_ash_veneer', metal: 'metal_matte_white_steel' },
  modern: { fabric: 'fabric_grey_wool', wood: 'veneer_walnut_veneer', metal: 'metal_brushed_nickel' },
  japandi: { fabric: 'fabric_natural_linen', wood: 'veneer_oak_veneer', metal: 'metal_antique_bronze' },
  industrial: { fabric: 'fabric_tan_leather', wood: 'veneer_black_oak_veneer', metal: 'metal_gunmetal' },
  luxury: { fabric: 'fabric_emerald_velvet', wood: 'veneer_walnut_veneer', metal: 'metal_brushed_brass' },
};
/** 各類型在不同風格偏好的目錄項（沒有則用第一個同類型） */
const PREFER: Partial<Record<FurnishStyle, Record<string, string>>> = {
  industrial: { sofa: 'sofa_leather_3', lamp_floor: 'lamp_floor_tripod' },
  luxury: { sofa: 'sofa_l_2700', armchair: 'armchair_velvet', lamp_floor: 'lamp_floor_tripod' },
  nordic: { armchair: 'armchair_a', lamp_floor: 'lamp_floor_a' },
  japandi: { sofa: 'sofa_2seat_a', lamp_floor: 'lamp_floor_a' },
  modern: { sofa: 'sofa_l_2700', lamp_floor: 'lamp_floor_tripod' },
};
/** 風格的配置取向：茶几、地毯、單椅數、大床、床尾凳、植物；layout＝主件（沙發／床）靠牆選擇的輪替，讓提案之間的擺法不同 */
const STYLE_SET: Record<
  FurnishStyle,
  {
    coffee: string;
    rug: string;
    rugBig: string;
    armchairs: number;
    bedBig: string;
    bench: boolean;
    plant: string;
    layout: number;
  }
> = {
  nordic: {
    coffee: 'table_coffee_a',
    rug: 'rug_2000',
    rugBig: 'rug_3000',
    armchairs: 1,
    bedBig: 'bed_queen_180',
    bench: false,
    plant: 'plant_tall',
    layout: 0,
  },
  modern: {
    coffee: 'table_coffee_round',
    rug: 'rug_round_2000',
    rugBig: 'rug_3000',
    armchairs: 0,
    bedBig: 'bed_king_200',
    bench: false,
    plant: 'plant_a',
    layout: 1,
  },
  japandi: {
    coffee: 'table_coffee_round',
    rug: 'rug_2000',
    rugBig: 'rug_2000',
    armchairs: 1,
    bedBig: 'bed_queen_180',
    bench: false,
    plant: 'plant_small',
    layout: 2,
  },
  industrial: {
    coffee: 'table_coffee_a',
    rug: 'rug_3000',
    rugBig: 'rug_3000',
    armchairs: 1,
    bedBig: 'bed_queen_180',
    bench: false,
    plant: 'plant_tall',
    layout: 1,
  },
  luxury: {
    coffee: 'table_coffee_round',
    rug: 'rug_3000',
    rugBig: 'rug_3000',
    armchairs: 2,
    bedBig: 'bed_king_200',
    bench: true,
    plant: 'plant_tall',
    layout: 2,
  },
};

const KIND_WORDS: [RoomKind, RegExp][] = [
  ['bath', /浴|廁|衛|洗手|bath|toilet|wc|shower/i],
  ['kitchen', /廚|kitchen|pantry/i],
  ['dining', /餐|dining/i],
  ['study', /書房|工作|study|office/i],
  ['entry', /玄關|entry|foyer/i],
  ['balcony', /陽台|balcony/i],
  ['bedroom', /臥|房間|睡|bed|guest|kid|nursery/i],
  ['living', /客|廳|起居|living|lounge/i],
];

/** 房間用途：明確設定 → 房名關鍵字 → 面積（≤ 4.5 m² 衛浴、最大者客廳、其餘臥室） */
export function inferRoomKind(
  room: Pick<Room, 'kind' | 'label'>,
  areaM2: number,
  isLargest: boolean,
): RoomKind {
  if (room.kind) return room.kind;
  for (const [k, re] of KIND_WORDS) if (room.label && re.test(room.label)) return k;
  if (areaM2 <= 4.5) return 'bath';
  return isLargest ? 'living' : 'bedroom';
}

const typeOf = (e: CatalogEntry | undefined) => (e?.model.kind === 'parametric' ? e.model.type : undefined);

export function planFurnish(level: Level, catalog: Catalog, opts: FurnishOptions = {}): FurnishProposal {
  const style = opts.style ?? 'modern';
  const mats = STYLE_MATS[style];
  const all = catalog.all().filter((e) => e.status === 'published');
  const pick = (type: string, prefer?: string): CatalogEntry | undefined => {
    const p = prefer ?? PREFER[style]?.[type];
    if (p) {
      const e = catalog.get(p);
      if (e) return e;
    }
    const cands = all.filter((e) => typeOf(e) === type);
    return cands.find((e) => e.styleTags.includes(style)) ?? cands[0];
  };
  const byId = (id: string) => catalog.get(id);
  const set = STYLE_SET[style];

  const detected = detectRooms(level).rooms.filter((r) => r.floor.length >= 3);
  const roomOf = (key: string) => level.rooms.find((r) => [...r.wallIds].sort().join('|') === key);
  const largest = detected.reduce((a, b) => (b.netArea > (a?.netArea ?? 0) ? b : a), detected[0]);
  const doors: Vec2[] = level.openings
    .filter((o) => o.type !== 'window')
    .flatMap((o) => {
      const w = level.walls.find((x) => x.id === o.wallId);
      if (!w) return [];
      const [p, q] = openingSegment(w, o.offset, o.width);
      return [[(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Vec2];
    });
  const windows: [Vec2, Vec2][] = level.openings
    .filter((o) => o.type === 'window')
    .flatMap((o) => {
      const w = level.walls.find((x) => x.id === o.wallId);
      return w ? [openingSegment(w, o.offset, o.width) as [Vec2, Vec2]] : [];
    });

  const placed: { poly: Vec2[]; cover: boolean }[] = level.objects.flatMap((o) => {
    const e = catalog.get(o.catalogId);
    if (!e || e.anchor !== 'floor') return [];
    const d = objectDims(e, o.params, o.scale);
    return [{ poly: objectFootprint(o.position, o.rotationY, d.w, d.d), cover: d.h <= 30 }];
  });
  const out: Placement[] = [];
  const priority: number[] = [];
  const roomsOut: FurnishProposal['rooms'] = [];

  const matFor = (e: CatalogEntry): Record<string, string> | undefined => {
    const slot = e.materialSlots[0];
    if (!slot) return undefined;
    const def = slot.defaultMaterialId;
    const m = /fabric|velvet|leather|boucle|linen/.test(def)
      ? mats.fabric
      : /wood|oak|walnut|veneer/.test(def)
        ? mats.wood
        : /metal|brass|steel/.test(def)
          ? mats.metal
          : undefined;
    return m ? { [slot.name]: m } : undefined;
  };

  for (const room of detected) {
    const meta = roomOf(room.key);
    if (opts.roomIds && meta && !opts.roomIds.includes(meta.id)) continue;
    const floor = room.floor;
    const existing = level.objects.filter((o) => {
      const e = catalog.get(o.catalogId);
      return e?.anchor === 'floor' && pointInPolygon([o.position[0], o.position[2]], floor);
    });
    if (!opts.includeFurnished && existing.length >= 2) continue;
    const areaM2 = room.netArea / 1e6;
    const kind = inferRoomKind(meta ?? { label: undefined }, areaM2, room === largest);
    const before = out.length;

    /** 放置一件（檢查房內、重疊、門口淨空）；成功回傳 placement */
    const tryPut = (
      e: CatalogEntry | undefined,
      x: number,
      z: number,
      rot: number,
      prio: number,
      y = 0,
    ): Placement | null => {
      if (!e) return null;
      const d = objectDims(e);
      const poly = objectFootprint([x, 0, z], rot, d.w, d.d);
      if (e.anchor === 'floor') {
        if (!poly.every((p) => pointInPolygon(p, floor))) return null;
        const cover = d.h <= 30;
        if (!cover && y === 0 && placed.some((o) => !o.cover && overlapArea(poly, o.poly) > 100)) return null;
        if (
          !cover &&
          doors.some(
            (p) => poly.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 700) || pointInPolygon(p, poly),
          )
        )
          return null;
        if (y === 0) placed.push({ poly, cover });
      }
      const pl: Placement = {
        catalogId: e.id,
        position: [Math.round(x), Math.round(y), Math.round(z)],
        rotationY: rot,
        scale: [1, 1, 1],
        ...(matFor(e) ? { materialOverrides: matFor(e) } : {}),
      };
      out.push(pl);
      priority.push(prio);
      return pl;
    };
    /** 靠牆：沿房間各邊（依長度排序）嘗試幾個位置；背靠牆、正面朝室內 */
    const edges = floor
      .map((p, i) => {
        const q = floor[(i + 1) % floor.length]!;
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        // 逆時針多邊形：室內在邊的左側
        const n: Vec2 = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
        const hasWindow = windows.some(([a, b]) => {
          const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const t = ((m[0] - p[0]) * (q[0] - p[0]) + (m[1] - p[1]) * (q[1] - p[1])) / (L * L);
          const px = p[0] + (q[0] - p[0]) * t;
          const pz = p[1] + (q[1] - p[1]) * t;
          return t > 0 && t < 1 && Math.hypot(m[0] - px, m[1] - pz) < 400;
        });
        return { p, q, L, n, hasWindow, used: false };
      })
      .filter((e) => e.L > 300);
    const signed = floor.reduce((s, p, i) => {
      const q = floor[(i + 1) % floor.length]!;
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0);
    if (signed < 0) for (const e of edges) e.n = [-e.n[0], -e.n[1]];
    const byLength = [...edges].sort((a, b) => b.L - a.L);
    const againstWall = (
      e: CatalogEntry | undefined,
      prio: number,
      avoidWindow = false,
      notEdge?: (typeof edges)[number],
      rotate = 0,
    ) => {
      if (!e) return null;
      const d = objectDims(e);
      // 主件依風格輪替候選牆（在夠長的牆之間），其餘依長度
      const fit = byLength.filter((ed) => ed.L >= d.w + 100);
      const k = fit.length ? rotate % fit.length : 0;
      for (const ed of [...fit.slice(k), ...fit.slice(0, k)]) {
        if (ed === notEdge || ed.used || ed.L < d.w + 100 || (avoidWindow && ed.hasWindow)) continue;
        for (const t of [0.5, 0.35, 0.65, 0.22, 0.78]) {
          const cx = ed.p[0] + (ed.q[0] - ed.p[0]) * t + ed.n[0] * (d.d / 2 + 30);
          const cz = ed.p[1] + (ed.q[1] - ed.p[1]) * t + ed.n[1] * (d.d / 2 + 30);
          const rot = Math.atan2(ed.n[0], ed.n[1]);
          const r = tryPut(e, cx, cz, rot, prio);
          if (r) {
            ed.used = true;
            return { pl: r, edge: ed };
          }
        }
      }
      return null;
    };
    /** 相對主件擺放：right／fwd 為主件局部座標（mm） */
    const rel = (
      base: Placement,
      e: CatalogEntry | undefined,
      right: number,
      fwd: number,
      rot: number,
      prio: number,
      y = 0,
    ) => {
      if (!e) return null;
      const r = base.rotationY;
      const x = base.position[0] + Math.cos(r) * right + Math.sin(r) * fwd;
      const z = base.position[2] - Math.sin(r) * right + Math.cos(r) * fwd;
      return tryPut(e, x, z, r + rot, prio, y);
    };
    const dims = (e: CatalogEntry | undefined) => (e ? objectDims(e) : { w: 0, d: 0, h: 0 });
    const cx = floor.reduce((s, p) => s + p[0], 0) / floor.length;
    const cz = floor.reduce((s, p) => s + p[1], 0) / floor.length;
    const corner = (e: CatalogEntry | undefined, prio: number) => {
      if (!e) return;
      const d = dims(e);
      const xs = floor.map((p) => p[0]);
      const zs = floor.map((p) => p[1]);
      const r = Math.max(d.w, d.d) / 2 + 150;
      for (const [x, z] of [
        [Math.max(...xs) - r, Math.max(...zs) - r],
        [Math.min(...xs) + r, Math.max(...zs) - r],
        [Math.max(...xs) - r, Math.min(...zs) + r],
        [Math.min(...xs) + r, Math.min(...zs) + r],
      ] as Vec2[])
        if (tryPut(e, x, z, 0, prio)) return;
    };

    switch (kind) {
      case 'living': {
        const sofaPref = PREFER[style]?.sofa;
        // L 型沙發需要較大的客廳，小空間改用三人座
        const sofaE = sofaPref === 'sofa_l_2700' && areaM2 < 16 ? byId('sofa_3seat_a') : pick('sofa');
        const sofa =
          againstWall(sofaE, 0, false, undefined, set.layout) ?? againstWall(pick('sofa', 'sofa_2seat_a'), 0);
        if (sofa) {
          const sd = dims(byId(sofa.pl.catalogId));
          const table = byId(set.coffee) ?? pick('table');
          const td = dims(table);
          rel(sofa.pl, table, 0, sd.d / 2 + 420 + td.d / 2, 0, 1);
          const rug = byId(areaM2 > 25 ? set.rugBig : set.rug) ?? pick('rug');
          rel(sofa.pl, rug, 0, sd.d / 2 + td.d / 2, 0, 3);
          rel(sofa.pl, pick('lamp_floor'), -(sd.w / 2 + 300), -sd.d / 4, 0, 4);
          rel(sofa.pl, pick('table', 'table_side_a'), sd.w / 2 + 300, 0, 0, 5);
          const arm = byId(PREFER[style]?.armchair ?? 'armchair_a');
          for (let a = 0; a < set.armchairs; a++) {
            const side = a === 0 ? 1 : -1;
            rel(sofa.pl, arm, side * (sd.w / 2 + 700), sd.d / 2 + 700, (-side * Math.PI) / 2, 6);
          }
          // 電視櫃：對面牆（避開門口，沿牆找位置）
          const opposite = byLength.find(
            (ed) => !ed.used && ed.n[0] * sofa.edge.n[0] + ed.n[1] * sofa.edge.n[1] < -0.9,
          );
          const tvStand = pick('tvstand');
          if (opposite && tvStand) {
            const d = dims(tvStand);
            // 優先對齊沙發中心在該牆上的投影
            const L2 = opposite.L * opposite.L;
            const t0 =
              ((sofa.pl.position[0] - opposite.p[0]) * (opposite.q[0] - opposite.p[0]) +
                (sofa.pl.position[2] - opposite.p[1]) * (opposite.q[1] - opposite.p[1])) /
              L2;
            for (const t of [t0, t0 - 0.15, t0 + 0.15, 0.5, 0.3, 0.7]) {
              if (t < 0.1 || t > 0.9) continue;
              const tx = opposite.p[0] + (opposite.q[0] - opposite.p[0]) * t + opposite.n[0] * (d.d / 2 + 30);
              const tz = opposite.p[1] + (opposite.q[1] - opposite.p[1]) * t + opposite.n[1] * (d.d / 2 + 30);
              const st = tryPut(tvStand, tx, tz, Math.atan2(opposite.n[0], opposite.n[1]), 2);
              if (st) {
                tryPut(byId('tv_65'), st.position[0], st.position[2], st.rotationY, 7, d.h);
                break;
              }
            }
          }
        }
        corner(byId(set.plant) ?? pick('plant'), 8);
        break;
      }
      case 'bedroom': {
        const bedE =
          areaM2 >= 14
            ? pick('bed', set.bedBig)
            : areaM2 >= 9
              ? pick('bed', 'bed_double_150')
              : pick('bed', 'bed_single_90');
        const bed = againstWall(bedE, 0, true, undefined, set.layout) ?? againstWall(bedE, 0);
        if (bed) {
          const bd = dims(bedE);
          const ns = pick('nightstand');
          const nd = dims(ns);
          for (const side of [-1, 1]) {
            const n = rel(bed.pl, ns, side * (bd.w / 2 + nd.w / 2 + 40), -bd.d / 2 + nd.d / 2 + 20, 0, 2);
            if (n) tryPut(pick('lamp_table'), n.position[0], n.position[2], n.rotationY, 6, nd.h);
          }
          rel(bed.pl, pick('rug', 'rug_2000'), 0, bd.d / 4, Math.PI / 2, 5);
          if (areaM2 >= 12 && set.bench) rel(bed.pl, pick('bench', 'bench_bed_end'), 0, bd.d / 2 + 260, 0, 7);
        }
        againstWall(pick('cabinet', 'cabinet_wardrobe_1800'), 1, false, bed?.edge);
        if (areaM2 >= 13) againstWall(pick('dresser'), 4, false, bed?.edge);
        corner(pick('plant', 'plant_a'), 8);
        break;
      }
      case 'dining': {
        const tableE = areaM2 >= 12 ? pick('table', 'table_dining_6') : pick('table', 'table_dining_4');
        const tbl = tryPut(tableE, cx, cz, 0, 0);
        if (tbl) {
          const td = dims(tableE);
          const ch = pick('chair', 'chair_dining_a');
          const cd = dims(ch);
          const n = td.w >= 1700 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const x = -td.w / 2 + (td.w * (i + 0.5)) / n;
            rel(tbl, ch, x, td.d / 2 + cd.d / 2 - 80, Math.PI, 1);
            rel(tbl, ch, x, -(td.d / 2 + cd.d / 2 - 80), 0, 1);
          }
          tryPut(pick('lamp_pendant'), cx, cz, 0, 5, level.height - dims(pick('lamp_pendant')).h);
        }
        againstWall(pick('cabinet', 'cabinet_sideboard_1600'), 3);
        break;
      }
      case 'kitchen': {
        const ed = byLength.find((e) => !e.used);
        if (ed) {
          ed.used = true;
          // 一字型：冰箱｜下櫃｜水槽｜爐台｜下櫃…；主件（冰箱、水槽、爐台）優先序 0
          const seq: [string, number][] = [
            ['fridge_a', 0],
            ['counter_base_600', 3],
            ['sink_900', 0],
            ['stove_600', 0],
            ['counter_base_900', 3],
            ['counter_base_600', 4],
          ];
          let run = 150;
          let upperFrom = -1;
          const rot = Math.atan2(ed.n[0], ed.n[1]);
          const at = (t: number, depth: number): Vec2 => [
            ed.p[0] + (ed.q[0] - ed.p[0]) * t + ed.n[0] * (depth / 2 + 30),
            ed.p[1] + (ed.q[1] - ed.p[1]) * t + ed.n[1] * (depth / 2 + 30),
          ];
          for (const [id, prio] of seq) {
            const e = byId(id);
            if (!e) continue;
            const d = dims(e);
            if (run + d.w > ed.L - 150) continue;
            const [x, z] = at((run + d.w / 2) / ed.L, d.d);
            if (tryPut(e, x, z, rot, prio) && id !== 'fridge_a' && upperFrom < 0) upperFrom = run;
            run += d.w;
          }
          // 吊櫃：從第一個下櫃起連續排到下櫃尾端（不重疊）
          const up = byId('upper_cabinet_900');
          if (up && upperFrom >= 0) {
            const ud = dims(up);
            for (let u = upperFrom; u + ud.w <= run; u += ud.w) {
              const [x, z] = at((u + ud.w / 2) / ed.L, ud.d);
              tryPut(up, x, z, rot, 6, up.elevationMm ?? 1450);
            }
          }
        }
        if (areaM2 >= 11) {
          const isl = tryPut(pick('counter', 'island_1500'), cx, cz, 0, 5);
          if (isl) {
            const st = pick('stool');
            for (const x of [-400, 400]) rel(isl, st, x, 700, Math.PI, 7);
          }
        }
        break;
      }
      case 'bath': {
        againstWall(pick('toilet'), 0);
        againstWall(pick('basin'), 0);
        if (areaM2 >= 5) corner(pick('shower'), 2);
        break;
      }
      case 'study': {
        const desk = againstWall(pick('desk', 'desk_office_1400'), 0, false);
        if (desk) {
          const dd = dims(byId(desk.pl.catalogId));
          rel(desk.pl, pick('chair', 'chair_office_a'), 0, dd.d / 2 + 250, Math.PI, 1);
          tryPut(pick('monitor'), desk.pl.position[0], desk.pl.position[2], desk.pl.rotationY, 5, dd.h);
        }
        againstWall(pick('cabinet', 'cabinet_book_900'), 2);
        corner(pick('plant', 'plant_a'), 6);
        break;
      }
      case 'entry': {
        againstWall(pick('cabinet', 'cabinet_shoe_1200'), 0);
        againstWall(pick('bench', 'bench_entry'), 2);
        corner(pick('coat_rack'), 4);
        break;
      }
      case 'balcony': {
        corner(pick('plant', 'plant_tall'), 2);
        corner(pick('plant', 'plant_a'), 4);
        break;
      }
      default:
        corner(pick('plant', 'plant_a'), 6);
    }
    roomsOut.push({
      roomId: meta?.id ?? room.key,
      label: meta?.label ?? null,
      kind,
      count: out.length - before,
    });
  }

  // 預算：依優先序（數字越大越次要）刪除直到符合
  const price = (p: Placement) => catalog.get(p.catalogId)?.unitPriceTwd ?? 0;
  let cost = out.reduce((s, p) => s + price(p), 0);
  if (opts.budget !== undefined && cost > opts.budget) {
    const order = out
      .map((p, i) => ({ i, prio: priority[i]!, price: price(p) }))
      .sort((a, b) => b.prio - a.prio || b.price - a.price);
    const drop = new Set<number>();
    for (const x of order) {
      if (cost <= opts.budget) break;
      if (x.prio === 0) continue; // 主件不刪
      drop.add(x.i);
      cost -= x.price;
    }
    const kept = out.filter((_, i) => !drop.has(i));
    out.length = 0;
    out.push(...kept);
  }
  return { style, placements: out, cost, rooms: roomsOut };
}

/** 三種風格的提案（FE-AI-02：預覽後擇一套用） */
export function furnishVariants(
  level: Level,
  catalog: Catalog,
  opts: Omit<FurnishOptions, 'style'> & { styles?: FurnishStyle[] } = {},
): FurnishProposal[] {
  return (opts.styles ?? ['nordic', 'modern', 'luxury']).map((style) =>
    planFurnish(level, catalog, { ...opts, style }),
  );
}
