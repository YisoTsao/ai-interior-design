import {
  bigserial,
  boolean,
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  bigint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle 表定義：鏡像 db/schema.sql（權威 DDL，SQL-first）。只用於型別安全的查詢，不產生遷移。
 * 欄位一致性由整合測試比對 information_schema 驗證。
 */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const inet = customType<{ data: string }>({ dataType: () => 'inet' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const orgRole = pgEnum('org_role', ['owner', 'admin', 'editor', 'viewer']);
export const jobState = pgEnum('job_state', [
  'queued',
  'running',
  'validating',
  'succeeded',
  'failed',
  'canceled',
]);
export const jobType = pgEnum('job_type', [
  'render',
  'inpaint',
  'plan_import',
  'export',
  'thumbnail',
  'moderation',
]);
export const ledgerReason = pgEnum('ledger_reason', [
  'purchase',
  'reserve',
  'settle',
  'refund',
  'grant',
  'adjust',
]);
export const assetStatus = pgEnum('asset_status', ['draft', 'review', 'published', 'retired']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('zh-TW'),
  passwordHash: text('password_hash'),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('free'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: orgRole('role').notNull().default('editor'),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  thumbnailKey: text('thumbnail_key'),
  currentVersionId: uuid('current_version_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const projectVersions = pgTable('project_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  parentVersionId: uuid('parent_version_id'),
  schemaVersion: text('schema_version').notNull(),
  contentHash: text('content_hash').notNull(),
  sceneKey: text('scene_key').notNull(),
  createdBy: uuid('created_by'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  status: text('status').notNull().default('pending'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const catalogAssets = pgTable('catalog_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en'),
  category: text('category').notNull(),
  subcategory: text('subcategory'),
  tags: text('tags').array().notNull().default([]),
  styleTags: text('style_tags').array().notNull().default([]),
  brand: text('brand'),
  dimsMm: jsonb('dims_mm').notNull().$type<{ w: number; d: number; h: number }>(),
  anchor: text('anchor').notNull().default('floor'),
  modelKey: text('model_key'),
  lod1Key: text('lod1_key'),
  thumbKey: text('thumb_key'),
  materialSlots: jsonb('material_slots').notNull().default([]).$type<unknown[]>(),
  parametric: jsonb('parametric').$type<Record<string, unknown> | null>(),
  license: jsonb('license').notNull().$type<Record<string, unknown>>(),
  status: assetStatus('status').notNull().default('draft'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameZh: text('name_zh').notNull(),
  category: text('category').notNull(),
  maps: jsonb('maps').notNull().$type<Record<string, unknown>>(),
  realSizeMm: jsonb('real_size_mm').notNull().$type<{ w: number; h: number }>(),
  license: jsonb('license').notNull().$type<Record<string, unknown>>(),
  status: assetStatus('status').notNull().default('draft'),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id'),
  userId: uuid('user_id').notNull(),
  type: jobType('type').notNull(),
  state: jobState('state').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  input: jsonb('input').notNull().$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown> | null>(),
  costEstimateCredits: integer('cost_estimate_credits').notNull().default(0),
  costActualCredits: integer('cost_actual_credits'),
  retryCount: integer('retry_count').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  provenance: jsonb('provenance').$type<Record<string, unknown> | null>(),
  createdAt: ts('created_at').notNull().defaultNow(),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
});

export const renders = pgTable('renders', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull(),
  projectId: uuid('project_id').notNull(),
  versionId: uuid('version_id'),
  camera: jsonb('camera').notNull().$type<Record<string, unknown>>(),
  settings: jsonb('settings').notNull().$type<Record<string, unknown>>(),
  outputKey: text('output_key'),
  width: integer('width'),
  height: integer('height'),
  validationScore: real('validation_score'),
  validationPassed: boolean('validation_passed'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const planImports = pgTable('plan_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull(),
  uploadId: uuid('upload_id').notNull(),
  source: text('source'),
  scale: jsonb('scale').$type<Record<string, unknown> | null>(),
  draftScene: jsonb('draft_scene').$type<Record<string, unknown> | null>(),
  warnings: jsonb('warnings').notNull().default([]).$type<unknown[]>(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const creditLedger = pgTable('credit_ledger', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id').notNull(),
  delta: integer('delta').notNull(),
  reason: ledgerReason('reason').notNull(),
  jobId: uuid('job_id'),
  idempotencyKey: text('idempotency_key'),
  balanceAfter: integer('balance_after').notNull(),
  meta: jsonb('meta').$type<Record<string, unknown> | null>(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const creditBalances = pgTable('credit_balances', {
  orgId: uuid('org_id').primaryKey(),
  balance: integer('balance').notNull().default(0),
  frozen: boolean('frozen').notNull().default(false),
  frozenReason: text('frozen_reason'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    orgId: uuid('org_id').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    status: integer('status'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  familyId: uuid('family_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  replacedBy: uuid('replaced_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orgId: uuid('org_id'),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  meta: jsonb('meta').$type<Record<string, unknown> | null>(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const TABLES = {
  users,
  orgs,
  memberships,
  projects,
  project_versions: projectVersions,
  uploads,
  catalog_assets: catalogAssets,
  materials,
  jobs,
  renders,
  plan_imports: planImports,
  credit_ledger: creditLedger,
  credit_balances: creditBalances,
  idempotency_keys: idempotencyKeys,
  refresh_tokens: refreshTokens,
  audit_log: auditLog,
} as const;
