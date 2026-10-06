import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { TOOLS, type ToolCall, type ToolName } from './tools.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validators = new Map<string, ValidateFunction>(TOOLS.map((t) => [t.name, ajv.compile(t.parameters)]));

export type CallCheck = { ok: true; call: ToolCall } | { ok: false; name: string; error: string };

/**
 * 驗證一個 LLM 工具呼叫（B6.4-1）：工具必須存在、arguments 必須是物件（或可解析的 JSON 字串）且通過 JSON Schema。
 * 不合法者丟棄並回報原因（由呼叫端重試或詢問使用者），絕不「修正後照用」。
 */
export function checkToolCall(raw: { id?: unknown; name?: unknown; arguments?: unknown }, i = 0): CallCheck {
  const name = typeof raw.name === 'string' ? raw.name : '';
  const v = validators.get(name);
  if (!v) return { ok: false, name, error: `未提供的工具：${name || '（空）'}` };
  let args: unknown = raw.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return { ok: false, name, error: 'arguments 不是有效的 JSON' };
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args))
    return { ok: false, name, error: 'arguments 必須是物件' };
  if (!v(args))
    return {
      ok: false,
      name,
      error: (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()).join('；'),
    };
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : `call_${i}`;
  return { ok: true, call: { id, name: name as ToolName, arguments: args as Record<string, unknown> } };
}

/** 驗證一批呼叫：合法者保留、不合法者列出 */
export function checkToolCalls(raws: readonly { id?: unknown; name?: unknown; arguments?: unknown }[]) {
  const valid: ToolCall[] = [];
  const invalid: { name: string; error: string }[] = [];
  raws.forEach((r, i) => {
    const c = checkToolCall(r, i);
    if (c.ok) valid.push(c.call);
    else invalid.push({ name: c.name, error: c.error });
  });
  return { valid, invalid };
}
