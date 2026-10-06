/** 結構化 JSON 日誌（08：requestId/traceId）；不記錄使用者圖片內容或密碼 */
const emit = (level: string, msg: string, fields?: Record<string, unknown>) => {
  if (process.env.LOG_LEVEL === 'silent') return;
  if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return;
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }) + '\n');
};
export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};
