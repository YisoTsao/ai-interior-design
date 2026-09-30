import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';

// ajv-formats 是 CJS default export
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

const BASE = 'https://interiorai.local/openapi.json';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface Operation {
  method: string;
  /** OpenAPI 路徑（不含 /v1），例如 /projects/{id} */
  path: string;
  phase: string;
  public: boolean;
  idempotent: boolean;
  bodyRequired: boolean;
  validateBody?: ValidateFunction;
  validateQuery?: ValidateFunction;
  /** status → 驗證器；null 表示沒有 JSON 本文（例如 204、SSE） */
  responses: Map<number, ValidateFunction | null>;
}

type Json = Record<string, unknown>;

/** 把 `#/components/...` 參照改成絕對 URI，讓每個 operation 的內嵌 schema 能共用同一份 components */
function absolutize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(absolutize);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) out[k] = BASE + v;
    else if (k.startsWith('x-')) continue;
    else out[k] = absolutize(v);
  }
  return out;
}

export const phaseNum = (p: string) => Number(p.replace(/^P/i, ''));

/**
 * OpenAPI 契約（docs/specs/openapi.yaml 為權威）。請求本文/查詢參數直接以契約中的 JSON Schema 驗證，
 * 開發/測試時也驗證回應 → 實作與契約不可能悄悄分歧。
 */
export class OpenApiContract {
  private constructor(
    readonly doc: Json,
    readonly operations: Operation[],
  ) {}

  static async load(file: string): Promise<OpenApiContract> {
    const doc = parse(await readFile(file, 'utf8')) as Json;
    const scene = JSON.parse(
      await readFile(path.join(path.dirname(file), 'scene.schema.json'), 'utf8'),
    ) as Json;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const qajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: true, useDefaults: true });
    addFormats(qajv);
    // 相對參照 'scene.schema.json' 以 openapi.json 為基底 → https://interiorai.local/scene.schema.json
    for (const a of [ajv, qajv]) {
      a.addSchema({ ...scene, $id: new URL('scene.schema.json', BASE).href });
      a.addSchema({ $id: BASE, components: absolutize((doc as { components: Json }).components) });
    }
    const components = (doc.components ?? {}) as { parameters?: Record<string, Json> };
    const resolveParam = (p: Json): Json => {
      const ref = p.$ref as string | undefined;
      return ref ? (components.parameters?.[ref.split('/').pop()!] ?? {}) : p;
    };

    const ops: Operation[] = [];
    let n = 0;
    for (const [p, item] of Object.entries((doc.paths ?? {}) as Record<string, Json>)) {
      const shared = ((item.parameters as Json[]) ?? []).map(resolveParam);
      for (const m of METHODS) {
        const op = item[m] as Json | undefined;
        if (!op) continue;
        const params = [...shared, ...((op.parameters as Json[]) ?? []).map(resolveParam)];
        const rb = op.requestBody as Json | undefined;
        const bodySchema = (rb?.content as Json | undefined)?.['application/json'] as Json | undefined;
        const query = params.filter((x) => x.in === 'query');
        const responses = new Map<number, ValidateFunction | null>();
        for (const [code, r0] of Object.entries((op.responses ?? {}) as Record<string, Json>)) {
          const ref = r0.$ref as string | undefined;
          const r = ref
            ? ((doc.components as Json).responses as Record<string, Json>)[ref.split('/').pop()!]!
            : r0;
          const js = ((r.content as Json | undefined)?.['application/json'] as Json | undefined)?.schema;
          responses.set(
            Number(code),
            js ? ajv.compile({ $id: `${BASE}/op${n++}`, ...(absolutize(js) as Json) }) : null,
          );
        }
        ops.push({
          method: m.toUpperCase(),
          path: p,
          phase: (op['x-phase'] as string | undefined) ?? 'P0',
          public: Array.isArray(op.security) && (op.security as unknown[]).length === 0,
          idempotent: params.some((x) => x.in === 'header' && x.name === 'Idempotency-Key' && x.required),
          bodyRequired: rb?.required === true,
          validateBody: bodySchema?.schema
            ? ajv.compile({ $id: `${BASE}/op${n++}`, ...(absolutize(bodySchema.schema) as Json) })
            : undefined,
          validateQuery: query.length
            ? qajv.compile({
                $id: `${BASE}/op${n++}`,
                type: 'object',
                properties: Object.fromEntries(query.map((q) => [q.name, absolutize(q.schema ?? {})])),
                required: query.filter((q) => q.required).map((q) => q.name),
              })
            : undefined,
          responses,
        });
      }
    }
    return new OpenApiContract(doc, ops);
  }

  /** Express 路由（/v1/projects/:id）→ operation */
  find(method: string, expressPath: string): Operation | undefined {
    const p = expressPath.replace(/^\/v1/, '').replace(/:(\w+)/g, '{$1}') || '/';
    return this.operations.find((o) => o.method === method.toUpperCase() && o.path === p);
  }

  /** 截至某 Phase 應實作的 operation */
  dueBy(phase: string): Operation[] {
    return this.operations.filter((o) => phaseNum(o.phase) <= phaseNum(phase));
  }
}

export const formatErrors = (errs: ErrorObject[] | null | undefined) =>
  (errs ?? [])
    .slice(0, 20)
    .map((e) => ({ path: e.instancePath || '/', message: e.message, params: e.params }));
