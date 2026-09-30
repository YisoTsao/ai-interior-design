import type { AssistantCtx } from './context.js';
import { runQuery, type QueryResult } from './query.js';
import { resolveProposal, type Proposal } from './resolve.js';
import type { SceneSummary } from './summary.js';
import { summarizeScene } from './summary.js';
import { isQueryTool, type ToolCall } from './tools.js';
import { checkToolCalls } from './validate.js';

/** 對話訊息（與 POST /assistant/chat 的契約相同） */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
  summary: SceneSummary;
}
export interface ChatResponse {
  reply: string;
  toolCalls: { id?: unknown; name?: unknown; arguments?: unknown }[];
  provider?: string;
  promptVersion?: string;
}
export type ChatTransport = (req: ChatRequest) => Promise<ChatResponse>;

export interface TurnResult {
  /** 更新後的對話（含工具結果；下一輪送回伺服器） */
  messages: ChatMessage[];
  reply: string;
  queries: { call: ToolCall; result: QueryResult }[];
  /** 待使用者確認的提案（尚未修改場景） */
  proposals: Proposal[];
  /** 被丟棄的呼叫（schema 不合法、或無法套用） */
  rejected: { name: string; error: string }[];
}

/** 一輪對話最多來回次數（查詢結果回餵 → 最終回覆） */
export const MAX_ROUNDS = 3;

/**
 * 一輪使用者訊息的完整流程（ADR-023）：
 * 1. 送出摘要＋對話 → 取得回覆與工具呼叫；
 * 2. 呼叫逐一以 JSON Schema 驗證，不合法者丟棄並回報給 LLM 重試（B6.4-1）；
 * 3. 查詢型工具由程式執行，結果回餵 LLM（B6.4-2）；
 * 4. 提案型工具解析成結構化變更後「停止」，交給 UI 預覽/確認（B6.4-3）。
 * 本函式只讀 ctx.scene，不持有、也不呼叫任何 store/exec —— 未經確認不可能修改場景。
 */
export async function runTurn(
  ctx: AssistantCtx,
  history: readonly ChatMessage[],
  text: string,
  transport: ChatTransport,
): Promise<TurnResult> {
  const messages: ChatMessage[] = [...history, { role: 'user', content: text }];
  const summary = summarizeScene(ctx);
  const queries: TurnResult['queries'] = [];
  const proposals: Proposal[] = [];
  const rejected: TurnResult['rejected'] = [];
  let reply = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await transport({ messages, summary });
    reply = res.reply;
    const { valid, invalid } = checkToolCalls(res.toolCalls ?? []);
    rejected.push(...invalid);
    messages.push({ role: 'assistant', content: res.reply, ...(valid.length ? { toolCalls: valid } : {}) });
    if (!valid.length) {
      if (invalid.length && round < MAX_ROUNDS - 1) {
        // 全部不合法：告知錯誤並重試一次
        messages.push({
          role: 'user',
          content: `（系統）上一個工具呼叫不合法已被丟棄：${invalid.map((i) => `${i.name}: ${i.error}`).join('；')}`,
        });
        continue;
      }
      break;
    }
    let pendingQueries = false;
    let failed = false;
    for (const call of valid) {
      if (isQueryTool(call.name)) {
        const result = runQuery(ctx, call.name, call.arguments);
        queries.push({ call, result });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result),
        });
        pendingQueries = true;
      } else {
        const r = resolveProposal(ctx, call);
        if (r.ok) proposals.push(r.proposal);
        else {
          failed = true;
          rejected.push({ name: call.name, error: `${r.code}: ${r.message}` });
        }
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(
            r.ok
              ? { ok: true, status: 'pending_user_confirmation', changes: r.proposal.changes.length }
              : { ok: false, error: r.code, message: r.message },
          ),
        });
      }
    }
    // 有提案 → 停在確認步驟；查詢結果或提案失敗原因 → 回餵 LLM 取得說明
    if (proposals.length || (!pendingQueries && !failed)) break;
  }
  return { messages, reply, queries, proposals, rejected };
}
