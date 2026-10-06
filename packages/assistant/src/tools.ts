/**
 * 助理工具（05 §7、ADR-023）：LLM 只能以這些工具的 JSON Schema 輸出；不合法即丟棄（B6.4-1）。
 * - 查詢型（query）：由程式執行，結果回餵 LLM（數字一律由程式計算，B6.4-2）。
 * - 提案型（proposal）：只產生「提案」，使用者在預覽/差異確認後才以 Command 套用（B6.4-3）。
 */
export type JsonSchema = Record<string, unknown>;

export const QUERY_TOOLS = ['list_objects', 'check_clearance', 'estimate_budget'] as const;
export const PROPOSAL_TOOLS = [
  'move_object',
  'resize_wall',
  'add_object',
  'set_material',
  'suggest_layout',
] as const;
export type QueryTool = (typeof QUERY_TOOLS)[number];
export type ProposalTool = (typeof PROPOSAL_TOOLS)[number];
export type ToolName = QueryTool | ProposalTool;
export const TOOL_NAMES: readonly ToolName[] = [...PROPOSAL_TOOLS, ...QUERY_TOOLS];
export const isQueryTool = (n: string): n is QueryTool => (QUERY_TOOLS as readonly string[]).includes(n);

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

const ID: JsonSchema = { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 1, maxLength: 64 };
const COORD: JsonSchema = { type: 'number', minimum: -1_000_000, maximum: 1_000_000 };
const VEC2: JsonSchema = { type: 'array', items: COORD, minItems: 2, maxItems: 2 };
const obj = (properties: Record<string, JsonSchema>, required: string[] = [], extra: JsonSchema = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
  ...extra,
});

export interface ToolDef {
  name: ToolName;
  kind: 'query' | 'proposal';
  description: string;
  parameters: JsonSchema;
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'move_object',
    kind: 'proposal',
    description:
      '提案移動/旋轉家具。to 三選一：position＝絕對座標 [x,z] mm；offset_mm＝相對目前位置的位移 [dx,dz] mm' +
      '（平面圖上方為北 −z、右方為東 +x）；forward_mm＝沿物件正面方向前進（負值＝後退）；relative＝貼齊某物件/牆/窗（side 為參考物的 front/back/left/right）。' +
      'rotate_deg＝相對目前方向的旋轉角度（逆時針為正）。',
    parameters: obj(
      {
        id: ID,
        to: {
          anyOf: [
            obj({ position: VEC2 }, ['position']),
            obj({ offset_mm: VEC2 }, ['offset_mm']),
            obj({ forward_mm: { type: 'number', minimum: -20_000, maximum: 20_000 } }, ['forward_mm']),
            obj(
              {
                relative: obj(
                  {
                    anchor: { enum: ['wall', 'window', 'object'] },
                    ref_id: ID,
                    side: { enum: ['left', 'right', 'front', 'back'] },
                    gap_mm: { type: 'number', minimum: 0, maximum: 5000 },
                  },
                  ['anchor', 'ref_id', 'side'],
                ),
              },
              ['relative'],
            ),
          ],
        },
        rotate_deg: { type: 'number', minimum: -360, maximum: 360 },
      },
      ['id'],
      { anyOf: [{ required: ['to'] }, { required: ['rotate_deg'] }] },
    ),
  },
  {
    name: 'resize_wall',
    kind: 'proposal',
    description: '提案修改牆長（mm）。keep＝固定哪一端（start＝起點 a、end＝終點 b、center＝中點）。',
    parameters: obj(
      {
        wall_id: ID,
        new_length_mm: { type: 'number', minimum: 100, maximum: 30_000 },
        keep: { enum: ['start', 'end', 'center'] },
      },
      ['wall_id', 'new_length_mm'],
    ),
  },
  {
    name: 'add_object',
    kind: 'proposal',
    description:
      '提案在房間新增一件目錄中的家具。anchor（選填）＝靠近的物件/牆/窗 id，side＝在 anchor 的哪一側；' +
      '未給 anchor 時由程式在房間內找空位。',
    parameters: obj(
      {
        catalog_id: ID,
        room_id: ID,
        anchor: ID,
        side: { enum: ['left', 'right', 'front', 'back'] },
      },
      ['catalog_id', 'room_id'],
    ),
  },
  {
    name: 'set_material',
    kind: 'proposal',
    description:
      '提案更換材質。target_id 可為房間（surface：floor 預設／ceiling／walls＝面向該房間的所有牆面）、' +
      '牆（surface：both 預設／wall_a／wall_b）或家具（主要材質）。',
    parameters: obj(
      {
        target_id: ID,
        material_id: ID,
        surface: { enum: ['floor', 'ceiling', 'walls', 'both', 'wall_a', 'wall_b'] },
      },
      ['target_id', 'material_id'],
    ),
  },
  {
    name: 'suggest_layout',
    kind: 'proposal',
    description: '由程式產生房間配置建議（靠牆擺放大型家具、保留走道），結果是一組移動提案，需使用者確認。',
    parameters: obj(
      {
        room_id: ID,
        constraints: obj({
          min_walkway_mm: { type: 'number', minimum: 400, maximum: 2000 },
          keep_ids: { type: 'array', items: ID, maxItems: 100 },
        }),
      },
      ['room_id'],
    ),
  },
  {
    name: 'list_objects',
    kind: 'query',
    description: '列出家具（可限定房間）：id、名稱、位置、尺寸。',
    parameters: obj({ room_id: ID }),
  },
  {
    name: 'check_clearance',
    kind: 'query',
    description: '由程式檢查房間走道寬度、門口淨空、家具重疊與穿牆。',
    parameters: obj({ room_id: ID, min_walkway_mm: { type: 'number', minimum: 400, maximum: 2000 } }, [
      'room_id',
    ]),
  },
  {
    name: 'estimate_budget',
    kind: 'query',
    description: '由程式計算 BOM 與估價（參考價）。scope＝room 時需 room_id。',
    parameters: obj({ scope: { enum: ['room', 'project'] }, room_id: ID }, ['scope'], {
      if: { properties: { scope: { const: 'room' } } },
      then: { required: ['room_id'] },
    }),
  },
];

export const toolDef = (name: string) => TOOLS.find((t) => t.name === name);
