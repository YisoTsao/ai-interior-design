#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { checkCatalog, SEED_CATALOG, SEED_MATERIALS, type CatalogEntry } from '@interiorai/catalog';
import { ingestGlb } from './ingest.js';

/**
 * pnpm catalog check [extra.json]   掃描目錄與材質，有 error 即非 0 結束（07 §6：CI 阻擋不合格資產）
 * pnpm catalog ingest <file.glb> --id x --name 名稱 --category living --w 2100 --d 900 --h 820
 *        [--anchor floor] [--license-type CC0 --license-source URL --allowed commercial,render]
 */
async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flag = (k: string) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (cmd === 'check') {
    const extraPath = rest.find((a) => !a.startsWith('--'));
    const extra: unknown[] = extraPath ? (JSON.parse(readFileSync(extraPath, 'utf8')) as unknown[]) : [];
    const issues = checkCatalog([...SEED_CATALOG, ...extra], SEED_MATERIALS);
    const errors = issues.filter((i) => i.severity === 'error');
    for (const i of issues) console.log(`${i.severity === 'error' ? '✗' : '!'} ${i.id}: ${i.message}`);
    const published = [...SEED_CATALOG, ...(extra as CatalogEntry[])].filter(
      (e) => e?.status === 'published',
    ).length;
    console.log(
      `${errors.length ? '✗' : '✓'} ${SEED_CATALOG.length + extra.length} 件資產、${published} 件 published、${errors.length} 個錯誤、${issues.length - errors.length} 個警告`,
    );
    return errors.length ? 1 : 0;
  }
  if (cmd === 'ingest') {
    const file = rest.find((a) => a.endsWith('.glb'));
    const id = flag('id');
    const name = flag('name');
    const category = flag('category') as CatalogEntry['category'] | undefined;
    const [w, d, h] = ['w', 'd', 'h'].map((k) => Number(flag(k)));
    if (
      !file ||
      !existsSync(file) ||
      !id ||
      !name ||
      !category ||
      ![w, d, h].every((n) => Number.isFinite(n) && n! > 0)
    ) {
      console.error(
        '用法：pnpm catalog ingest <file.glb> --id x --name 名稱 --category living --w 2100 --d 900 --h 820',
      );
      return 2;
    }
    const lt = flag('license-type');
    const ls = flag('license-source');
    const allowed = (flag('allowed') ?? '').split(',').filter(Boolean) as (
      'commercial' | 'render' | 'redistribute'
    )[];
    const r = await ingestGlb(new Uint8Array(readFileSync(file)), {
      id,
      nameZh: name,
      category,
      dimsMm: { w: w!, d: d!, h: h! },
      anchor: (flag('anchor') as CatalogEntry['anchor']) ?? 'floor',
      modelUrl: `assets/${id}/${basename(file)}`,
      ...(lt && ls && allowed.length ? { license: { type: lt, source: ls, allowedUse: allowed } } : {}),
    });
    for (const i of r.issues) console.log(`${i.severity === 'error' ? '✗' : '!'} ${i.code}: ${i.message}`);
    console.log(
      `量測：${Math.round(r.measured.wMm)}×${Math.round(r.measured.dMm)}×${Math.round(r.measured.hMm)} mm，${r.measured.triangles} 三角形`,
    );
    if (!r.ok || !r.entry) return 1;
    const outDir = resolve('catalog/ingested');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `${id}.json`), JSON.stringify(r.entry, null, 2) + '\n');
    console.log(
      `✓ 已寫入 catalog/ingested/${id}.json（status=${r.entry.status}；需人工審核後才可 published）`,
    );
    return 0;
  }
  console.error('用法：pnpm catalog <check|ingest> …');
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
