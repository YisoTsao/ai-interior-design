import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Scene } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const readJson = <T = unknown>(rel: string): T => JSON.parse(readFileSync(root + rel, 'utf8')) as T;
export const sampleScene = (): Scene => readJson<Scene>('fixtures/scenes/sample-scene.json');
export const jsonSchema = () => readJson<Record<string, unknown>>('packages/scene-schema/scene.schema.json');
