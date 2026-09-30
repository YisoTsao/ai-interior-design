export type JobState = 'queued' | 'running' | 'validating' | 'succeeded' | 'failed' | 'canceled';
export type JobType = 'render' | 'inpaint' | 'plan_import' | 'export' | 'thumbnail' | 'moderation';

/**
 * 任務狀態機（04 §5）。結構驗證層重試＝validating → running（retry_count+1，上限 2，ADR-012），
 * 不經過 failed：failed 為終態（退款後不再復活，避免同一 Job 的帳本出現第二次 reserve）。
 * running → running 允許：worker 當機後 BullMQ 重新投遞同一個 Job。
 */
const NEXT: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'canceled', 'failed'],
  running: ['running', 'validating', 'succeeded', 'failed', 'canceled'],
  validating: ['running', 'succeeded', 'failed', 'canceled'],
  succeeded: [],
  failed: [],
  canceled: [],
};

export const TERMINAL: readonly JobState[] = ['succeeded', 'failed', 'canceled'];
export const isTerminal = (s: JobState) => TERMINAL.includes(s);
export const canTransition = (from: JobState, to: JobState) => NEXT[from].includes(to);
/** 可轉入 to 的來源狀態（用於條件式 UPDATE ... WHERE state = ANY(...)） */
export const sourcesOf = (to: JobState): JobState[] =>
  (Object.keys(NEXT) as JobState[]).filter((s) => NEXT[s].includes(to));
