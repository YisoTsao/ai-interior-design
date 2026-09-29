import { ulid } from 'ulid';

export type IdPrefix = 'lvl' | 'w' | 'o' | 'r' | 'obj' | 'cam' | 'ann';
/** 程式產生的 ID：「前綴_ULID」（ADR-013）。可讀 ID 僅限 fixtures。 */
export const newId = (prefix: IdPrefix): string => `${prefix}_${ulid()}`;
