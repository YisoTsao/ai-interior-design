import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

export function OfflineBadge() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 rounded-full border border-warn px-2 py-0.5 text-xs text-warn"
      data-testid="offline-badge"
    >
      <WifiOff size={12} aria-hidden /> {t('app.offline')}
    </span>
  );
}

export function LangToggle() {
  const { t, i18n } = useTranslation();
  return (
    <button className="btn" onClick={() => void i18n.changeLanguage(i18n.language === 'en' ? 'zh-TW' : 'en')}>
      {t('lang')}
    </button>
  );
}

/** 圖示按鈕＋tooltip（label 同時作為 aria-label） */
export function IconButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
  testId,
}: {
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <button
          className="icon-btn"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          data-testid={testId}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={4}
          className="z-50 rounded bg-fg px-2 py-1 text-xs text-bg"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
