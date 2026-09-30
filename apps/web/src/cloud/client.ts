import { create } from 'zustand';
import { ApiClientError, createApiClient, type Schemas } from '@interiorai/api-client';

/** API 位址（build 時由 VITE_API_URL 注入；預設本機 docker compose） */
export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/v1';

type User = Schemas['User'];
interface AuthState {
  token: string | null;
  user: User | null;
  status: 'unknown' | 'anonymous' | 'authenticated';
  set(token: string | null, user: User | null): void;
}
/** access token 只放記憶體；refresh token 在 httpOnly cookie（04 §2），重新整理頁面時以 /auth/refresh 換回 */
export const useAuth = create<AuthState>((set) => ({
  token: null,
  user: null,
  status: 'unknown',
  set: (token, user) => set({ token, user, status: token ? 'authenticated' : 'anonymous' }),
}));

let refreshing: Promise<boolean> | null = null;
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!r.ok) {
        useAuth.getState().set(null, null);
        return false;
      }
      const b = (await r.json()) as Schemas['AuthResult'];
      useAuth.getState().set(b.accessToken, b.user);
      return true;
    } catch {
      useAuth.getState().set(null, null);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const api = createApiClient({
  baseUrl: API_URL,
  getToken: () => useAuth.getState().token,
  onUnauthorized: refresh,
});

export async function login(email: string, password: string, register = false) {
  const b = register
    ? await api.post('/auth/register', { body: { email, password } })
    : await api.post('/auth/login', { body: { email, password } });
  useAuth.getState().set(b.accessToken, b.user);
}
export async function logout() {
  await api.post('/auth/logout', {}).catch(() => undefined);
  useAuth.getState().set(null, null);
}

export { ApiClientError };
