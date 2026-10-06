import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { REPO_ROOT } from '../../src/config.js';

export const CV_DIR = path.join(REPO_ROOT, 'services/cv-service');

const freePort = () =>
  new Promise<number>((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });

/** 以 cv-service 的 venv 啟動 uvicorn（整合/E2E 用）；venv 不存在時明確失敗 */
export async function startCvService(): Promise<{ url: string; stop: () => Promise<void> }> {
  const uvicorn = path.join(CV_DIR, '.venv/bin/uvicorn');
  if (!existsSync(uvicorn))
    throw new Error(
      `找不到 ${uvicorn}；請先執行：cd services/cv-service && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`,
    );
  const port = await freePort();
  const proc: ChildProcess = spawn(uvicorn, ['app.main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: CV_DIR,
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) break;
    } catch {
      /* 還沒起來 */
    }
    if (Date.now() - t0 > 30_000) throw new Error('cv-service 啟動逾時');
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    url,
    stop: async () => {
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 100));
    },
  };
}
