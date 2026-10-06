import type { ChatMessage } from './session.js';
import type { SceneSummary } from './summary.js';
import type { ToolName } from './tools.js';

/**
 * 確定性 mock ChatProvider（05 §8、ADR-023）：以規則把繁中指令轉成工具呼叫，讓 CI/E2E 不需金鑰也能跑完整流程。
 * 它不是語言模型：只理解評測集涵蓋的句型；在自家評測集上的正確率「不代表」真實 LLM 的表現（PROGRESS 標 ⚠）。
 * 與真實 LLM 相同的限制：只能輸出工具呼叫與文字；單位換算寫在說明中；不做任何面積/金額計算。
 */
export interface MockReply {
  text: string;
  toolCalls: { id: string; name: ToolName; arguments: Record<string, unknown> }[];
}

type Obj = SceneSummary['objects'][number];

/** 物件別名 → 目錄 id 前綴（長詞優先比對，避免「床」吃掉「床頭櫃」） */
const OBJECT_ALIASES: [string, string[]][] = [
  ['三人沙發', ['sofa_3seat']],
  ['雙人沙發', ['sofa_2seat']],
  ['沙發', ['sofa_']],
  ['茶几', ['table_coffee']],
  ['邊几', ['table_side']],
  ['電視櫃', ['tvstand_']],
  ['地毯', ['rug_']],
  ['餐桌', ['table_dining']],
  ['餐椅', ['chair_dining']],
  ['椅子', ['chair_', 'armchair_']],
  ['單椅', ['armchair_']],
  ['辦公椅', ['chair_office']],
  ['盆栽', ['plant_']],
  ['植物', ['plant_']],
  ['床頭櫃', ['nightstand_']],
  ['雙人床', ['bed_double', 'bed_queen']],
  ['單人床', ['bed_single']],
  ['床', ['bed_']],
  ['衣櫃', ['cabinet_wardrobe']],
  ['書櫃', ['cabinet_book']],
  ['鞋櫃', ['cabinet_shoe']],
  ['書桌', ['desk_office']],
  ['辦公桌', ['desk_office']],
  ['梳妝台', ['desk_dresser']],
  ['立燈', ['lamp_floor']],
  ['落地燈', ['lamp_floor']],
  ['檯燈', ['lamp_table']],
  ['冰箱', ['fridge_']],
];

/** 新增時的目錄對應（別名 → 目錄 id） */
const ADD_ALIASES: [string, string][] = [
  ['雙人沙發', 'sofa_2seat_a'],
  ['三人沙發', 'sofa_3seat_a'],
  ['沙發', 'sofa_3seat_a'],
  ['單椅', 'armchair_a'],
  ['邊几', 'table_side_a'],
  ['茶几', 'table_coffee_a'],
  ['電視櫃', 'tvstand_1800'],
  ['地毯', 'rug_2000'],
  ['餐椅', 'chair_dining_a'],
  ['辦公椅', 'chair_office_a'],
  ['盆栽', 'plant_a'],
  ['植物', 'plant_a'],
  ['床頭櫃', 'nightstand_a'],
  ['梳妝台', 'desk_dresser_a'],
  ['書桌', 'desk_office_1400'],
  ['辦公桌', 'desk_office_1400'],
  ['書櫃', 'cabinet_book_900'],
  ['鞋櫃', 'cabinet_shoe_1200'],
  ['衣櫃', 'cabinet_wardrobe_1800'],
  ['層架', 'shelf_open_800'],
  ['立燈', 'lamp_floor_a'],
  ['落地燈', 'lamp_floor_a'],
  ['檯燈', 'lamp_table_a'],
  ['吊燈', 'lamp_pendant_a'],
  ['崁燈', 'lamp_downlight_a'],
  ['壁燈', 'lamp_wall_a'],
  ['窗簾', 'curtain_pair'],
  ['冰箱', 'fridge_a'],
  ['螢幕', 'monitor_27'],
  ['單人床', 'bed_single_90'],
  ['雙人床', 'bed_double_150'],
];

/** 材質別名（依表面決定：地板/牆/家具） */
const MATERIAL_ALIASES: { word: string; floor?: string; wall?: string; object?: string; ceiling?: string }[] =
  [
    { word: '淺橡木', floor: 'mat_wood_oak', object: 'mat_wood_oak' },
    { word: '橡木', floor: 'mat_wood_oak', object: 'mat_wood_oak' },
    { word: '胡桃木', floor: 'mat_wood_walnut', object: 'mat_wood_walnut' },
    { word: '灰色地磚', floor: 'mat_tile_grey60' },
    { word: '地磚', floor: 'mat_tile_grey60' },
    { word: '磨石', floor: 'mat_stone_terrazzo' },
    { word: '白色壁磚', wall: 'mat_tile_white' },
    { word: '壁磚', wall: 'mat_tile_white' },
    { word: '鼠尾草', wall: 'mat_paint_sage' },
    { word: '綠', wall: 'mat_paint_sage' },
    { word: '暖灰', wall: 'mat_paint_grey', floor: 'mat_tile_grey60' },
    { word: '炭灰', object: 'mat_fabric_charcoal' },
    { word: '深灰', object: 'mat_fabric_charcoal' },
    { word: '米色', object: 'mat_fabric_beige' },
    { word: '黑鐵', object: 'mat_metal_black' },
    { word: '黑色金屬', object: 'mat_metal_black' },
    { word: '灰色', wall: 'mat_paint_grey', floor: 'mat_tile_grey60', object: 'mat_fabric_charcoal' },
    { word: '刷白', ceiling: 'mat_ceiling_white', wall: 'mat_paint_white' },
    { word: '白色', wall: 'mat_paint_white', ceiling: 'mat_ceiling_white' },
    { word: '白', wall: 'mat_paint_white', ceiling: 'mat_ceiling_white' },
  ];

/** 越權/注入：直接拒絕（不產生任何工具呼叫） */
const REFUSE: [RegExp, string][] = [
  [
    /系統提示|系統指令|system\s*prompt|prompt 內容|你的指令是什麼|印出.*(規則|指令)/i,
    '我不能提供系統設定內容。',
  ],
  [/api[_\s-]*key|金鑰|密碼|token|secret/i, '我無法提供任何金鑰或帳號資訊。'],
  [
    /點數|額度|扣款|退款|付款|結帳|免費|價格設|設成.*元|改成\s*0\s*元|總價改/,
    '點數與價格由系統計算，我不能修改。',
  ],
  [/其他(使用者|人|帳號)|別人的|分享給|@[\w.-]+\.\w+/, '我只能協助你目前開啟的專案。'],
  [/rm\s+-rf|drop\s+table|sql|shell|執行(程式|指令|這個)|eval\(/i, '我不會執行程式碼或系統指令。'],
  [/刪除|刪掉|移除|清空/, '我目前不能刪除物件；請選取後按 Delete，可隨時 Undo。'],
  [
    /沒有限制的\s*ai|扮演|假裝你是|你現在是(系統)?管理員|越獄|jailbreak/i,
    '我只能以室內設計助理的身分、透過提供的工具協助你。',
  ],
  [/```|\{\s*"name"\s*:/, '我不會直接執行貼上的指令；請用一般的描述告訴我要做什麼。'],
  [/忽略.*(規則|指令|限制)|ignore (all|previous)/i, '我會繼續遵守原本的規則。'],
];
/** 要求跳過確認：照樣只產生提案，並提醒需要確認 */
const BYPASS = /不用(問|確認)|直接(套用|修改|改)|跳過確認|不要讓我確認|自動套用|並套用/;

const CN_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
/** 簡單中文數字（十、二十五、一百五十、三千） */
function cnNumber(s: string): number | null {
  if (!/^[零一二兩三四五六七八九十百千]+$/.test(s)) return null;
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch]!;
    else {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      total += (cur || 1) * unit;
      cur = 0;
    }
  }
  return total + cur;
}

interface Length {
  mm: number;
  note: string;
}
const UNIT = '(公尺|米|m(?![a-z])|公分|cm|公釐|毫米|mm)';
/** 長度（含單位換算說明）；沒有單位時回 null（請使用者說清楚） */
function parseLength(t: string): Length | null {
  const m = new RegExp(`(-?\\d+(?:\\.\\d+)?|[零一二兩三四五六七八九十百千]+)\\s*${UNIT}(半)?`, 'i').exec(t);
  if (!m) return null;
  const v = /\d/.test(m[1]!) ? Number(m[1]) : cnNumber(m[1]!);
  if (v === null || !Number.isFinite(v)) return null;
  const unit = m[2]!.toLowerCase();
  const k =
    unit === '公尺' || unit === '米' || unit === 'm' ? 1000 : unit === '公分' || unit === 'cm' ? 10 : 1;
  const base = m[3] ? v + 0.5 : v;
  const mm = Math.round(base * k);
  return { mm, note: k === 1 ? '' : `（${m[1]}${m[3] ?? ''} ${m[2]} = ${mm} mm）` };
}

// const find = (t: string, words: readonly string[]) => words.find((w) => t.includes(w));

/** 在文字中找物件提及（長詞優先、不重疊），依出現位置排序 */
function objectMentions(t: string, objs: readonly Obj[]) {
  const taken: [number, number][] = [];
  const out: { index: number; word: string; candidates: Obj[] }[] = [];
  const words = [
    ...objs.map((o) => [o.name, null] as const),
    ...OBJECT_ALIASES.map(([w, p]) => [w, p] as const),
  ].sort((a, b) => b[0].length - a[0].length);
  for (const [w, prefixes] of words) {
    let from = 0;
    for (;;) {
      const i = t.indexOf(w, from);
      if (i < 0) break;
      from = i + w.length;
      if (taken.some(([s, e]) => i < e && s < i + w.length)) continue;
      taken.push([i, i + w.length]);
      const candidates = objs.filter((o) =>
        prefixes ? prefixes.some((p) => o.catalogId.startsWith(p)) : o.name === w,
      );
      out.push({ index: i, word: w, candidates });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function roomMentions(t: string, s: SceneSummary) {
  const hits = s.rooms.filter((r) => r.label && t.includes(r.label));
  if (!hits.length && /臥室|房間/.test(t)) {
    const beds = s.rooms.filter((r) => r.label && /臥|房/.test(r.label));
    if (beds.length === 1) return beds;
  }
  return hits.sort((a, b) => t.indexOf(a.label!) - t.indexOf(b.label!));
}

const COMPASS: Record<string, 'north' | 'south' | 'east' | 'west'> = {
  北: 'north',
  南: 'south',
  東: 'east',
  西: 'west',
};

/** 牆：「北外牆」「客廳的西牆」「A 和 B 之間的牆」或直接給 id */
function wallMention(t: string, s: SceneSummary, roomId: string | null): string | null {
  const byId = s.walls.find((w) => t.includes(w.id));
  if (byId) return byId.id;
  const between = /(\S+?)(?:和|與|跟)(\S+?)之間的?牆/.exec(t);
  if (between) {
    const ids = s.rooms
      .filter((r) => r.label && (between[1]!.includes(r.label) || between[2]!.includes(r.label)))
      .map((r) => r.id);
    const w = s.walls.find((x) => ids.length === 2 && ids.every((id) => x.rooms.some((r) => r.id === id)));
    if (w) return w.id;
  }
  const m =
    /([東西南北])(?:邊|面|側)?(?:那面|的)?(外)?牆/.exec(t) ?? /牆[^，。]*?([東西南北])(?:邊|面|側)/.exec(t);
  if (!m) return null;
  const dir = COMPASS[m[1]!]!;
  if (roomId && !m[2]) {
    const w = s.walls.find((x) => x.rooms.some((r) => r.id === roomId && r.side === dir));
    if (w) return w.id;
  }
  const zh = { north: '北', south: '南', east: '東', west: '西' }[dir];
  return s.walls.find((x) => x.name === `${zh}外牆`)?.id ?? null;
}

function windowIn(s: SceneSummary, roomId: string | null) {
  const wins = s.openings.filter(
    (o) =>
      o.type === 'window' &&
      (!roomId || s.walls.find((w) => w.id === o.wallId)?.rooms.some((r) => r.id === roomId)),
  );
  return wins.length === 1 ? wins[0]!.id : null;
}

function sideWord(t: string): 'left' | 'right' | 'front' | 'back' | null {
  if (/左(邊|側|手)/.test(t)) return 'left';
  if (/右(邊|側|手)/.test(t)) return 'right';
  if (/前(面|方)|正前/.test(t)) return 'front';
  if (/後(面|方)/.test(t)) return 'back';
  if (/旁(邊)?|邊/.test(t)) return 'right';
  return null;
}

let seq = 0;
const call = (name: ToolName, args: Record<string, unknown>) => ({
  id: `call_${(++seq).toString(36)}`,
  name,
  arguments: args,
});
const ask = (text: string): MockReply => ({ text, toolCalls: [] });

export function mockChat(messages: readonly ChatMessage[], s: SceneSummary): MockReply {
  const last = messages[messages.length - 1];
  if (!last) return ask('請告訴我你想怎麼調整。');
  if (last.role === 'tool') return replyFromTools(messages);
  if (last.role !== 'user') return ask('請告訴我你想怎麼調整。');
  if (last.content.startsWith('（系統）')) return ask('抱歉，我剛才的操作格式有誤，請再描述一次需求。');
  const t = last.content.normalize('NFKC').trim();
  for (const [re, msg] of REFUSE) if (re.test(t)) return ask(msg);
  const bypass = BYPASS.test(t);
  const confirmNote = bypass ? '依規定所有變更都要你在預覽中確認後才會套用。' : '請在下方預覽後按「套用」。';
  const rooms = roomMentions(t, s);
  const room = rooms[0] ?? null;
  const roomLabel = room?.label ?? '整個專案';

  // ── 查詢：預算 / 動線 / 清單（可同時出現）
  const queries: MockReply['toolCalls'] = [];
  if (/(列出|有哪些|有什麼|有幾件|清單|盤點|裡有)/.test(t))
    queries.push(call('list_objects', room ? { room_id: room.id } : {}));
  if (/(走道|通道|動線|淨空|太擠|門口|擋到|間距|夠寬)/.test(t) && !/(移|搬|挪|放|加)/.test(t)) {
    if (!room) return ask('要檢查哪個房間？（例如：客廳、主臥）');
    const len = parseLength(t);
    queries.push(call('check_clearance', { room_id: room.id, ...(len ? { min_walkway_mm: len.mm } : {}) }));
  }
  if (/(預算|估價|估算|報價|多少錢|費用|花多少|造價)/.test(t))
    queries.push(call('estimate_budget', room ? { scope: 'room', room_id: room.id } : { scope: 'project' }));
  if (queries.length) return { text: `好的，我先查詢${roomLabel}的資料。`, toolCalls: queries };

  // ── 配置建議
  if (/(建議|規劃).*(配置|擺設|佈置|擺法)|怎麼擺|重新(排列|擺|配置)|排列一下/.test(t)) {
    if (!room) return ask('要規劃哪個房間的配置？');
    const keep = objectMentions(
      t,
      s.objects.filter((o) => o.roomId === room.id),
    )
      .filter((m) => /保留|不要動|固定/.test(t) && m.candidates.length === 1)
      .map((m) => m.candidates[0]!.id);
    return {
      text: `我依靠牆擺放與走道寬度幫「${room.label}」產生配置建議，${confirmNote}`,
      toolCalls: [
        call('suggest_layout', {
          room_id: room.id,
          ...(keep.length ? { constraints: { keep_ids: keep } } : {}),
        }),
      ],
    };
  }

  // ── 材質
  if (/(換成|改成|改用|改鋪|鋪|刷成|刷|漆成|換|布料)/.test(t) && !/(移|搬|挪)/.test(t)) {
    const r = materialIntent(t, s, rooms, confirmNote);
    if (r) return r;
  }

  // ── 牆長
  if (/牆/.test(t) && /(長度|縮短|拉長|改成|改為|縮為|改短|改長)/.test(t) && !/(靠|刷|漆|磚)/.test(t)) {
    const wall = wallMention(t, s, room?.id ?? null);
    const len = parseLength(t);
    if (!wall || !len) return ask('要調整哪一面牆、改成多長？（例如：北外牆改成 8 公尺）');
    const keep = /中間|中心|置中/.test(t) ? 'center' : /終點|尾端|結尾/.test(t) ? 'end' : null;
    return {
      text: `好的，提案把這面牆改成 ${len.mm} mm${len.note}。${confirmNote}`,
      toolCalls: [call('resize_wall', { wall_id: wall, new_length_mm: len.mm, ...(keep ? { keep } : {}) })],
    };
  }

  const mentions = objectMentions(t, s.objects);
  const baIndex = t.indexOf('把');
  const addVerb = /(加|新增|多放|添|放一|擺一|放個|擺個|放一個|放一張)/.test(t);
  const baObject = baIndex >= 0 && mentions.some((m) => m.index > baIndex && m.candidates.length > 0);

  // ── 新增
  if (addVerb && !baObject) {
    const hit = [...ADD_ALIASES].sort((a, b) => b[0].length - a[0].length).find(([w]) => t.includes(w));
    if (!hit) return ask('目錄裡沒有這件家具，要換一件類似的嗎？');
    const [word, catalogId] = hit;
    const ref = mentions.find(
      (m) => m.word !== word && !word.includes(m.word) && m.index !== t.indexOf(word),
    );
    let anchor: string | null = null;
    let side: string | null = null;
    let targetRoom = room;
    if (ref) {
      const cands = targetRoom ? ref.candidates.filter((o) => o.roomId === targetRoom!.id) : ref.candidates;
      if (cands.length !== 1) return ask(`要放在哪一件「${ref.word}」旁邊？`);
      anchor = cands[0]!.id;
      side = sideWord(t.slice(ref.index)) ?? 'right';
      targetRoom = s.rooms.find((r) => r.id === cands[0]!.roomId) ?? targetRoom;
    } else if (/窗/.test(t)) {
      const w = windowIn(s, targetRoom?.id ?? null);
      if (!w) return ask('是哪一扇窗戶？');
      anchor = w;
      side = sideWord(t.slice(t.indexOf('窗'))) ?? 'front';
    }
    if (!targetRoom) return ask(`要把「${word}」放在哪個房間？`);
    if (!s.catalog.some((c) => c.id === catalogId)) return ask('目錄裡沒有這件家具。');
    return {
      text: `好的，提案在「${targetRoom.label}」新增「${word}」，位置由系統找空位。${confirmNote}`,
      toolCalls: [
        call('add_object', {
          catalog_id: catalogId,
          room_id: targetRoom.id,
          ...(anchor ? { anchor, side } : {}),
        }),
      ],
    };
  }

  // ── 移動 / 旋轉
  if (/(移|搬|挪|推|放到|放在|擺到|靠|轉|退)/.test(t) && mentions.length) {
    const first = (baIndex >= 0 ? mentions.find((m) => m.index > baIndex) : undefined) ?? mentions[0]!;
    const inRoom = room ? first.candidates.filter((o) => o.roomId === room.id) : first.candidates;
    if (!inRoom.length) return ask(`找不到「${first.word}」。`);
    if (inRoom.length > 1) return ask(`有 ${inRoom.length} 件「${first.word}」，要移動哪一件？`);
    const obj = inRoom[0]!;
    const rest = t.slice(first.index + first.word.length);
    const args: Record<string, unknown> = { id: obj.id };
    let note = '';
    const rot = /轉半圈/.test(t) ? 180 : /(?:轉|旋轉|轉向)\s*(\d+|[一二三四五六七八九十百]+)\s*度/.exec(t);
    if (rot !== null) {
      const v = typeof rot === 'number' ? rot : /\d/.test(rot[1]!) ? Number(rot[1]) : cnNumber(rot[1]!)!;
      args.rotate_deg = /順時針/.test(t) ? -v : v;
    }
    const coord = /(?:\(|（|座標|x\s*=?)\s*(-?\d+)\s*[,，、]?\s*(?:z\s*=?)?\s*(-?\d+)/i.exec(t);
    const dir = /往([左右上下東西南北前後])|向([左右上下東西南北前後])|([前後])(移|推|退)/.exec(rest);
    const other = mentions.find((m) => m !== first && m.index > first.index);
    if (coord) args.to = { position: [Number(coord[1]), Number(coord[2])] };
    else if (other) {
      const cands = other.candidates.filter((o) => o.id !== obj.id);
      const refs = room ? cands.filter((o) => o.roomId === room.id) : cands;
      const pool = refs.length ? refs : cands;
      if (pool.length !== 1) return ask(`要放在哪一件「${other.word}」旁邊？`);
      const gap = /留|間隔|距離/.test(t) ? parseLength(t) : null;
      args.to = {
        relative: {
          anchor: 'object',
          ref_id: pool[0]!.id,
          side: sideWord(t.slice(other.index + other.word.length)) ?? 'right',
          ...(gap ? { gap_mm: gap.mm } : {}),
        },
      };
      if (gap) note = gap.note;
    } else if (/窗/.test(rest)) {
      const w = windowIn(s, obj.roomId);
      if (!w) return ask(`「${obj.name}」所在的房間沒有窗戶，或有好幾扇，請指定。`);
      args.to = {
        relative: { anchor: 'window', ref_id: w, side: sideWord(rest.slice(rest.indexOf('窗'))) ?? 'front' },
      };
    } else if (/牆/.test(rest)) {
      const wall = wallMention(rest, s, obj.roomId);
      if (!wall) return ask('要靠哪一面牆？（例如：北牆、東牆）');
      args.to = { relative: { anchor: 'wall', ref_id: wall, side: 'front' } };
    } else if (dir) {
      const d = dir[1] ?? dir[2] ?? dir[3]!;
      const len = parseLength(rest);
      if (!len) return ask(`要往${d}移多少？（例如：30 公分）`);
      note = len.note;
      const v = len.mm;
      const off: Record<string, [number, number]> = {
        左: [-v, 0],
        西: [-v, 0],
        右: [v, 0],
        東: [v, 0],
        上: [0, -v],
        北: [0, -v],
        下: [0, v],
        南: [0, v],
      };
      if (d === '前' || d === '後') args.to = { forward_mm: d === '前' ? v : -v };
      else args.to = { offset_mm: off[d]! };
    } else if (args.rotate_deg === undefined) return ask(`要把「${obj.name}」移到哪裡？`);
    return {
      text: `好的，提案調整「${obj.name}」${note}。${confirmNote}`,
      toolCalls: [call('move_object', args)],
    };
  }
  return ask('我可以幫你移動或新增家具、換材質、調整牆長、檢查走道或估算預算。想做哪一項？');
}

function materialIntent(
  t: string,
  s: SceneSummary,
  rooms: SceneSummary['rooms'],
  confirmNote: string,
): MockReply | null {
  const alias = MATERIAL_ALIASES.filter((a) => t.includes(a.word)).sort(
    (a, b) => b.word.length - a.word.length,
  );
  const exact = s.materials
    .filter((m) => t.includes(m.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const pick = (surface: 'floor' | 'wall' | 'object' | 'ceiling') =>
    exact && matches(exact.category, surface) ? exact.id : alias.map((a) => a[surface]).find(Boolean);
  const all = /全部|所有|每個|每間/.test(t);
  const wallWord = /牆/.test(t);
  const ceiling = /天花/.test(t);
  const floorWord = /地板|地坪|鋪/.test(t);
  const mentions = objectMentions(t, s.objects);
  const target = mentions[0];

  if (!wallWord && !ceiling && !floorWord && target) {
    const cands = rooms[0] ? target.candidates.filter((o) => o.roomId === rooms[0]!.id) : target.candidates;
    if (cands.length !== 1) return ask(`要換哪一件「${target.word}」的材質？`);
    const mat = pick('object');
    if (!mat) return ask('目錄中沒有這種材質，可以選：米色布、炭灰布、淺橡木、胡桃木、黑鐵。');
    return {
      text: `好的，提案把「${cands[0]!.name}」換成 ${nameOf(s, mat)}。${confirmNote}`,
      toolCalls: [call('set_material', { target_id: cands[0]!.id, material_id: mat })],
    };
  }
  if (wallWord) {
    const wall = /外牆/.test(t) || !rooms.length ? wallMention(t, s, null) : null;
    const mat = pick('wall');
    if (!mat) return ask('目錄中沒有這種牆面材質，可以選：白色乳膠漆、鼠尾草綠漆、暖灰漆、白色壁磚。');
    if (wall)
      return {
        text: `好的，提案把這面牆換成 ${nameOf(s, mat)}。${confirmNote}`,
        toolCalls: [call('set_material', { target_id: wall, material_id: mat })],
      };
    if (!rooms.length) return ask('要換哪個房間或哪一面牆？');
    return {
      text: `好的，提案把「${rooms[0]!.label}」的牆面換成 ${nameOf(s, mat)}。${confirmNote}`,
      toolCalls: [call('set_material', { target_id: rooms[0]!.id, material_id: mat, surface: 'walls' })],
    };
  }
  if (ceiling) {
    const mat = pick('ceiling');
    if (!mat || !rooms.length) return ask('要換哪個房間的天花？用什麼材質？');
    return {
      text: `好的，提案把「${rooms[0]!.label}」天花換成 ${nameOf(s, mat)}。${confirmNote}`,
      toolCalls: [call('set_material', { target_id: rooms[0]!.id, material_id: mat, surface: 'ceiling' })],
    };
  }
  if (floorWord || rooms.length) {
    const mat = pick('floor');
    if (!mat) return ask('目錄中沒有這種地板材質，可以選：淺橡木地板、胡桃木地板、灰色地磚、磨石子。');
    const targets = all ? s.rooms : rooms;
    if (!targets.length) return ask('要換哪個房間的地板？');
    return {
      text: `好的，提案把${targets.map((r) => `「${r.label}」`).join('、')}地板換成 ${nameOf(s, mat)}。${confirmNote}`,
      toolCalls: targets.map((r) => call('set_material', { target_id: r.id, material_id: mat })),
    };
  }
  return null;
}

const matches = (category: string, surface: string) =>
  surface === 'floor'
    ? ['floor', 'wood', 'stone'].includes(category)
    : surface === 'wall'
      ? ['wall', 'stone'].includes(category)
      : surface === 'ceiling'
        ? ['ceiling'].includes(category)
        : ['fabric', 'wood', 'metal', 'stone'].includes(category);
const nameOf = (s: SceneSummary, id: string) => s.materials.find((m) => m.id === id)?.name ?? id;

/** 工具結果 → 說明（只轉述程式算好的數字，不自行計算） */
function replyFromTools(messages: readonly ChatMessage[]): MockReply {
  const results: { name: string; data: Record<string, unknown> }[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i]!.role === 'tool'; i--) {
    const m = messages[i] as Extract<ChatMessage, { role: 'tool' }>;
    try {
      results.unshift({ name: m.name, data: JSON.parse(m.content) as Record<string, unknown> });
    } catch {
      results.unshift({ name: m.name, data: { ok: false } });
    }
  }
  const parts = results.map(({ name, data }) => {
    if (data.ok === false) return `無法完成：${String(data.message ?? data.error ?? '未知錯誤')}`;
    if (name === 'list_objects') {
      const objs = (data.objects as { name: string }[]) ?? [];
      return `共有 ${String(data.count)} 件：${objs.map((o) => o.name).join('、') || '（無）'}。`;
    }
    if (name === 'check_clearance') {
      const issues = (data.issues as { kind: string; aName: string; bName?: string; gapMm?: number }[]) ?? [];
      if (!issues.length) return `動線檢查通過（走道至少 ${String(data.minWalkwayMm)} mm）。`;
      return `發現 ${issues.length} 個問題：${issues
        .map((i) =>
          i.kind === 'narrow'
            ? `「${i.aName}」與「${i.bName}」間距 ${i.gapMm} mm`
            : i.kind === 'door_blocked'
              ? `「${i.aName}」擋到門口`
              : i.kind === 'in_wall'
                ? `「${i.aName}」穿入牆體`
                : `「${i.aName}」與「${i.bName}」重疊`,
        )
        .join('；')}。`;
    }
    if (name === 'estimate_budget') {
      const unpriced = (data.unpriced as string[]) ?? [];
      return `估計總價 NT$ ${Number(data.totalTwd).toLocaleString('en-US')}（${String(data.priceNote)}）${
        unpriced.length ? `；未計價：${unpriced.join('、')}` : ''
      }。`;
    }
    if (data.status === 'pending_user_confirmation') return '提案已準備好，請確認。';
    return '完成。';
  });
  return { text: parts.join('\n'), toolCalls: [] };
}
