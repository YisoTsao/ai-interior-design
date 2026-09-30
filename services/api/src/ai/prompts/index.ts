import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT } from '../../config.js';

export const PROMPTS_DIR = path.join(REPO_ROOT, 'prompts');

export interface PromptTemplate {
  id: string;
  version: string;
  body: string;
}

/** 讀取 prompts/<id>.md（front matter 含 id/version；B6.3 模板版本化） */
export async function loadTemplate(id: string, dir = PROMPTS_DIR): Promise<PromptTemplate> {
  const raw = await readFile(path.join(dir, `${id}.md`), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`模板 ${id} 缺少 front matter`);
  const fm = parse(m[1]!) as { id: string; version: string };
  return { id: fm.id, version: fm.version, body: m[2]!.trim() };
}

export const USER_EXTRA_MAX = 300;

/**
 * 使用者額外要求的清理（B6.3、05 §4 防 prompt injection）：移除控制字元與可能跳出引用區塊的三引號，
 * 壓縮空白，限長 300 字。清理後只會被放進模板中獨立的「使用者要求」段落。
 */
export function sanitizeUserExtra(s: string | undefined): string {
  if (!s) return '(none)';
  const clean = s
    .normalize('NFKC')
    // 刻意比對控制字元：從使用者文字中移除
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/"{3,}|`{3,}/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, USER_EXTRA_MAX);
  return clean || '(none)';
}

/** 內容審核（05 §10）：自建規則的最低限度檢查；供應商審核端點未串接（未驗證） */
const BLOCKED = [/\bnud(e|ity)\b/i, /裸體|色情|血腥|暴力|自殘/, /\bgore\b/i, /\bchild\b.*\bsex/i];
export const isBlockedText = (s: string | undefined) => !!s && BLOCKED.some((re) => re.test(s));

/** 以 {{var}} 填入；未提供的變數丟錯（避免模板靜默缺段） */
export function fill(t: PromptTemplate, vars: Record<string, string>) {
  const text = t.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`模板 ${t.id} 缺少變數 ${k}`);
    return vars[k]!;
  });
  return {
    text,
    templateId: t.id,
    templateVersion: t.version,
    hash: createHash('sha256').update(text).digest('hex'),
  };
}

/** 5 種風格模板（ai-eval 的 5 風格）；styleTemplateId → 英文設計語彙 */
export const STYLES: Record<string, string> = {
  modern: 'modern minimalist, clean lines, neutral palette with warm wood accents',
  scandinavian: 'Scandinavian, light oak, white walls, soft textiles, hygge atmosphere',
  japandi: 'Japandi, natural materials, muted earth tones, low furniture, calm and serene',
  industrial: 'industrial loft, exposed concrete, black metal, leather and reclaimed wood',
  luxury: 'contemporary luxury, marble, brushed brass, velvet upholstery, layered lighting',
};

/** 驗證重試第 1 次：提高結構嚴格度的提示（ADR-012 §2） */
export const RETRY_NOTE =
  'IMPORTANT: a previous attempt altered the room structure. Re-trace every edge of image 2 exactly; geometry must match pixel-for-pixel.';
