import { mockChat } from './mock.js';
import type { ChatTransport } from './session.js';

/** 行程內的 mock 傳輸（測試/評測用；正式環境走 POST /assistant/chat） */
export const mockTransport: ChatTransport = (req) => {
  const r = mockChat(req.messages, req.summary);
  return Promise.resolve({ reply: r.text, toolCalls: r.toolCalls, provider: 'mock' });
};
