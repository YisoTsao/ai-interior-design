/**
 * 色卡（FE-FIN-05）：常用室內塗料色（NCS 近似色號＋俗名），可搜尋色號／名稱；最近用色存在本機。
 * 色號為 NCS 系統的近似對照，實際施工以廠商色卡為準。
 */
export interface ColorCard {
  /** 色卡系統：NCS（內建近似）、RAL（內建近似）或使用者匯入的品牌名稱 */
  library?: string;
  code: string;
  zh: string;
  en: string;
  hex: string;
  family: 'white' | 'neutral' | 'grey' | 'green' | 'blue' | 'earth' | 'dark' | 'accent';
}
const c = (code: string, zh: string, en: string, hex: string, family: ColorCard['family']): ColorCard => ({
  code,
  zh,
  en,
  hex,
  family,
});
export const COLOR_CARDS: ColorCard[] = [
  c('S 0300-N', '純白', 'Pure white', '#f7f7f5', 'white'),
  c('S 0500-N', '雪白', 'Snow white', '#f0f0ec', 'white'),
  c('S 0502-Y', '奶油白', 'Cream white', '#f2efe4', 'white'),
  c('S 0804-Y30R', '象牙白', 'Ivory', '#ece4d4', 'white'),
  c('S 0502-G', '薄荷白', 'Mint white', '#eef1ec', 'white'),
  c('S 0502-B', '冰川白', 'Glacier white', '#edf0f2', 'white'),
  c('S 0505-Y20R', '燕麥', 'Oatmeal', '#ebe2d0', 'neutral'),
  c('S 1005-Y20R', '亞麻', 'Linen', '#ddd2bd', 'neutral'),
  c('S 1505-Y40R', '奶茶', 'Milk tea', '#d1bfa8', 'neutral'),
  c('S 2005-Y30R', '沙丘', 'Dune', '#c4b49c', 'neutral'),
  c('S 1502-Y50R', '暖灰米', 'Greige', '#cdc4b8', 'neutral'),
  c('S 2502-Y', '石膏灰', 'Plaster grey', '#bcb9ae', 'neutral'),
  c('S 3005-Y50R', '拿鐵', 'Latte', '#a8977f', 'neutral'),
  c('S 1000-N', '淺灰', 'Light grey', '#dcdcda', 'grey'),
  c('S 1502-B', '霧灰藍', 'Mist grey', '#cfd3d5', 'grey'),
  c('S 2000-N', '中性灰', 'Neutral grey', '#bfbfbd', 'grey'),
  c('S 3000-N', '水泥灰', 'Concrete', '#a3a3a1', 'grey'),
  c('S 4000-N', '石墨灰', 'Graphite', '#888886', 'grey'),
  c('S 3502-B', '鋼灰', 'Steel grey', '#999ea2', 'grey'),
  c('S 5502-Y', '橄欖灰', 'Olive grey', '#77766c', 'grey'),
  c('S 1510-G40Y', '鼠尾草綠', 'Sage', '#c8cfb6', 'green'),
  c('S 2010-G50Y', '抹茶', 'Matcha', '#b1b890', 'green'),
  c('S 3010-G30Y', '尤加利', 'Eucalyptus', '#9ba88c', 'green'),
  c('S 4010-G10Y', '苔蘚', 'Moss', '#7d8c73', 'green'),
  c('S 5020-G10Y', '森林綠', 'Forest', '#5a6e52', 'green'),
  c('S 7010-G30Y', '墨綠', 'Hunter green', '#394536', 'green'),
  c('S 2010-B90G', '薄荷綠', 'Mint', '#b4cfc5', 'green'),
  c('S 1010-R90B', '天空藍', 'Sky blue', '#cad8e4', 'blue'),
  c('S 2010-R90B', '霧藍', 'Dusty blue', '#aebfcf', 'blue'),
  c('S 3020-R80B', '牛仔藍', 'Denim', '#8198b7', 'blue'),
  c('S 4020-B', '湖水藍', 'Lake blue', '#6d8e9e', 'blue'),
  c('S 6020-R80B', '海軍藍', 'Navy', '#3f4f6e', 'blue'),
  c('S 7020-R80B', '午夜藍', 'Midnight', '#2c3750', 'blue'),
  c('S 3010-B30G', '孔雀藍綠', 'Teal', '#7fa3a3', 'blue'),
  c('S 2020-Y60R', '赤陶', 'Terracotta', '#c9936f', 'earth'),
  c('S 3030-Y60R', '磚紅', 'Brick', '#b0704c', 'earth'),
  c('S 2030-Y30R', '芥末黃', 'Mustard', '#d2a860', 'earth'),
  c('S 3020-Y50R', '焦糖', 'Caramel', '#b58a60', 'earth'),
  c('S 4020-Y70R', '肉桂', 'Cinnamon', '#99694e', 'earth'),
  c('S 5020-Y80R', '可可', 'Cocoa', '#7a5442', 'earth'),
  c('S 1510-Y80R', '裸粉', 'Nude pink', '#dcbcae', 'earth'),
  c('S 2010-R', '乾燥玫瑰', 'Dried rose', '#c9a4a4', 'earth'),
  c('S 8000-N', '炭黑', 'Charcoal', '#3b3b3a', 'dark'),
  c('S 8502-B', '石板黑', 'Slate', '#2f3235', 'dark'),
  c('S 7502-Y', '深橄欖', 'Deep olive', '#4a4841', 'dark'),
  c('S 8010-Y70R', '胡桃棕', 'Walnut', '#4b3a30', 'dark'),
  c('S 7020-R10B', '酒紅', 'Burgundy', '#5c2f3a', 'dark'),
  c('S 9000-N', '墨黑', 'Ink black', '#262626', 'dark'),
  c('S 1070-Y10R', '向日葵', 'Sunflower', '#f0c030', 'accent'),
  c('S 1080-Y70R', '橘', 'Orange', '#e36b2b', 'accent'),
  c('S 1085-Y90R', '番茄紅', 'Tomato', '#d9412f', 'accent'),
  c('S 2060-R90B', '皇家藍', 'Royal blue', '#2f5fb0', 'accent'),
  c('S 2060-G', '翠綠', 'Emerald', '#1f9a6a', 'accent'),
  c('S 2050-R40B', '紫羅蘭', 'Violet', '#8a5aa8', 'accent'),
];
/**
 * RAL Classic 常用色（sRGB 為公開對照表的近似值；RAL 本身以實體色卡為準）。
 * 這裡的 code 是標準色號（非商標色名），用於溝通與施工圖標示。
 */
const ral = (code: string, zh: string, en: string, hex: string, family: ColorCard['family']): ColorCard => ({
  library: 'RAL',
  code: `RAL ${code}`,
  zh,
  en,
  hex,
  family,
});
export const RAL_CARDS: ColorCard[] = [
  ral('9010', '純白', 'Pure white', '#f1ece1', 'white'),
  ral('9016', '交通白', 'Traffic white', '#f1f0ea', 'white'),
  ral('9003', '信號白', 'Signal white', '#ecece7', 'white'),
  ral('9001', '奶油色', 'Cream', '#e9e0d2', 'white'),
  ral('9002', '灰白', 'Grey white', '#d7d5cb', 'neutral'),
  ral('1013', '牡蠣白', 'Oyster white', '#e3d9c6', 'neutral'),
  ral('1015', '淺象牙', 'Light ivory', '#e6d2b5', 'neutral'),
  ral('1001', '米色', 'Beige', '#d0b084', 'neutral'),
  ral('1000', '綠米色', 'Green beige', '#cdba88', 'neutral'),
  ral('1019', '灰米色', 'Grey beige', '#a48f7a', 'earth'),
  ral('7044', '絲灰', 'Silk grey', '#b7b3a8', 'grey'),
  ral('7035', '淺灰', 'Light grey', '#cbd0cc', 'grey'),
  ral('7047', '電信灰 4', 'Telegrey 4', '#d0d0d0', 'grey'),
  ral('7001', '銀灰', 'Silver grey', '#8f999f', 'grey'),
  ral('7024', '石墨灰', 'Graphite grey', '#45494e', 'dark'),
  ral('7016', '炭灰', 'Anthracite grey', '#383e42', 'dark'),
  ral('9005', '墨黑', 'Jet black', '#0a0a0d', 'dark'),
  ral('6019', '粉綠', 'Pastel green', '#b9ceac', 'green'),
  ral('6021', '淡綠', 'Pale green', '#8a9977', 'green'),
  ral('6011', '木犀草綠', 'Reseda green', '#587f40', 'green'),
  ral('6005', '苔綠', 'Moss green', '#0f4336', 'green'),
  ral('5024', '粉藍', 'Pastel blue', '#6093ac', 'blue'),
  ral('5014', '鴿藍', 'Pigeon blue', '#637d96', 'blue'),
  ral('5010', '龍膽藍', 'Gentian blue', '#13447c', 'blue'),
  ral('5002', '群青藍', 'Ultramarine blue', '#20214f', 'blue'),
  ral('8025', '淡褐', 'Pale brown', '#75584b', 'earth'),
  ral('8011', '堅果褐', 'Nut brown', '#5a3826', 'earth'),
  ral('8017', '巧克力褐', 'Chocolate brown', '#45302b', 'earth'),
  ral('3009', '氧化紅', 'Oxide red', '#6d342d', 'earth'),
  ral('3000', '火焰紅', 'Flame red', '#a72920', 'accent'),
];

// ── 品牌色號庫（使用者匯入；FE-FIN-05）──────────────────────────────
const LIB_KEY = 'colorLibraries';
/** 匯入的品牌色卡：品牌 → 色卡清單（本機保存） */
export function brandLibraries(): Record<string, ColorCard[]> {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) ?? '{}') as Record<string, ColorCard[]>;
  } catch {
    return {};
  }
}
function saveLibraries(x: Record<string, ColorCard[]>) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(x));
  } catch {
    /* 私密模式 */
  }
}
/** 由色碼粗分色系（匯入的色卡沒有色系欄位時） */
export function familyOf(hex: string): ColorCard['family'] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  if (l > 0.86) return 'white';
  if (l < 0.25) return 'dark';
  if (max - min < 18) return 'grey';
  if (max - min > 120) return 'accent';
  if (g >= r && g >= b) return 'green';
  if (b >= r && b >= g) return 'blue';
  return l > 0.65 ? 'neutral' : 'earth';
}
/**
 * 解析色卡 CSV：每列「品牌,色號,名稱,#RRGGBB」（第一列若是標題會略過；名稱可含中文）。
 * 回傳成功的筆數與錯誤列號；hex 也接受不含 # 的 6 碼。
 */
export function parseColorCsv(text: string): { cards: ColorCard[]; errors: number[] } {
  const cards: ColorCard[] = [];
  const errors: number[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, i) => {
      if (!line) return;
      const cols = line.split(/,|\t/).map((x) => x.trim().replace(/^"|"$/g, ''));
      const hex = (cols[3] ?? '').replace(/^#?/, '#').toLowerCase();
      if (cols.length < 4 || !/^#[0-9a-f]{6}$/.test(hex)) {
        if (i > 0) errors.push(i + 1);
        return;
      }
      const [brand, code, name] = cols as [string, string, string];
      cards.push({ library: brand, code, zh: name, en: name, hex, family: familyOf(hex) });
    });
  return { cards, errors };
}
/** 合併匯入（同品牌同色號覆蓋） */
export function importColorCards(cards: readonly ColorCard[]) {
  const libs = brandLibraries();
  for (const c of cards) {
    const lib = c.library ?? 'custom';
    const list = (libs[lib] ?? []).filter((x) => x.code !== c.code);
    libs[lib] = [...list, c];
  }
  saveLibraries(libs);
}
export function removeColorLibrary(brand: string) {
  const libs = brandLibraries();
  delete libs[brand];
  saveLibraries(libs);
}
/** 全部色卡（NCS＋RAL＋匯入品牌） */
export function allColorCards(): ColorCard[] {
  return [
    ...COLOR_CARDS.map((c) => ({ ...c, library: 'NCS' })),
    ...RAL_CARDS,
    ...Object.values(brandLibraries()).flat(),
  ];
}

export const COLOR_FAMILIES = [
  'white',
  'neutral',
  'grey',
  'green',
  'blue',
  'earth',
  'dark',
  'accent',
] as const;

const KEY = 'recentColors';
export function recentColors(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]).slice(0, 12);
  } catch {
    return [];
  }
}
export function pushRecentColor(hex: string) {
  try {
    const next = [hex, ...recentColors().filter((x) => x !== hex)].slice(0, 12);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 私密模式 */
  }
}
export function searchColors(q: string, library?: string | null): ColorCard[] {
  const k = q.trim().toLowerCase();
  const pool = allColorCards().filter((c) => !library || c.library === library);
  if (!k) return pool;
  return pool.filter(
    (x) =>
      x.code.toLowerCase().includes(k) ||
      x.zh.includes(q.trim()) ||
      x.en.toLowerCase().includes(k) ||
      x.hex.includes(k),
  );
}
