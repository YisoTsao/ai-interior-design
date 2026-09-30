import { ApiClientError, createApiClient } from '@interiorai/api-client';

/**
 * API 位址（build 時由 VITE_API_URL 注入；預設本機）。
 * 目前不需要登入：後端在開發模式（AUTH_MODE=none）以本機使用者身分處理請求；
 * 之後改用 Supabase Auth 時，在 getToken 取 session access token 即可。
 */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/v1';

export const api = createApiClient({
  baseUrl: API_URL,
  getToken: () => null,
});

export { ApiClientError };
