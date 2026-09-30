import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiClientError, login } from './client';

/** 登入/註冊（雲端功能共用：AI 渲染、平面圖匯入） */
export function AuthForm({ hint }: { hint?: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await login(email, password, mode === 'register');
        } catch (x) {
          setErr(
            x instanceof ApiClientError
              ? t(`render.err.${x.code}`, { defaultValue: x.message })
              : t('render.err.NETWORK'),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">{hint ?? t('render.loginHint')}</p>
      <label className="block text-xs">
        {t('auth.email')}
        <input
          className="field mt-1 w-full"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="auth-email"
        />
      </label>
      <label className="block text-xs">
        {t('auth.password')}
        <input
          className="field mt-1 w-full"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="auth-password"
        />
      </label>
      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" type="submit" disabled={busy} data-testid="auth-submit">
          {t(mode === 'login' ? 'auth.login' : 'auth.register')}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          data-testid="auth-toggle"
        >
          {t(mode === 'login' ? 'auth.toRegister' : 'auth.toLogin')}
        </button>
      </div>
    </form>
  );
}
