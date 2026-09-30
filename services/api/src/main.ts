import { loadConfig } from './config.js';
import { createApp } from './app.module.js';
import { createStorage } from './infra/storage.js';
import { log } from './common/log.js';

const config = loadConfig();
await createStorage(config).ensureBucket();
const app = await createApp(config);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
log.info('api.listening', { port });
