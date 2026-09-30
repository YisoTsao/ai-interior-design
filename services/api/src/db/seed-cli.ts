import { loadConfig } from '../config.js';
import { Db } from './db.js';
import { seedCatalog } from './seed.js';

const db = new Db(loadConfig().databaseUrl, 2);
console.log(`catalog_assets：${await seedCatalog(db)} 筆`);
await db.close();
