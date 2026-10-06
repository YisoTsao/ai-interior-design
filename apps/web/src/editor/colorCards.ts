/**
 * 色卡（FE-FIN-05）：常用室內塗料色（NCS 近似色號＋俗名），可搜尋色號／名稱；最近用色存在本機。
 * 色號為 NCS 系統的近似對照，實際施工以廠商色卡為準。
 */
export interface ColorCard {
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
export function searchColors(q: string): ColorCard[] {
  const k = q.trim().toLowerCase();
  if (!k) return COLOR_CARDS;
  return COLOR_CARDS.filter(
    (x) =>
      x.code.toLowerCase().includes(k) ||
      x.zh.includes(q.trim()) ||
      x.en.toLowerCase().includes(k) ||
      x.hex.includes(k),
  );
}
