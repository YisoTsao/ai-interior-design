import { ensureLoginRoles, migrate } from './migrate.js';

const owner = process.env.MIGRATION_DATABASE_URL ?? 'postgres://app:app@localhost:5432/interiorai';
const applied = await migrate(owner);
console.log(applied.length ? `已套用：${applied.join(', ')}` : '沒有新的遷移');
if (process.env.NODE_ENV !== 'production') {
  await ensureLoginRoles(owner, {
    app: { user: 'interiorai_app_login', password: 'app' },
    system: { user: 'interiorai_system_login', password: 'system' },
  });
  console.log('開發用登入角色已就緒（interiorai_app_login / interiorai_system_login）');
}
