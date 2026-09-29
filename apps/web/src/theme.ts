import { useEffect, useState } from 'react';
import type { Plan2DTheme } from '@interiorai/editor-2d';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function read(): Plan2DTheme & { primary: string } {
  return {
    bg: css('--bg'),
    grid: css('--grid'),
    gridMajor: css('--grid-major'),
    wall: css('--wall'),
    wallStroke: css('--text'),
    floor: css('--floor'),
    text: css('--text'),
    muted: css('--muted'),
    primary: css('--primary'),
    warn: css('--warn'),
    danger: css('--danger'),
    object: css('--object'),
    opening: css('--muted'),
  };
}
/** 讀 CSS 設計 token 給 Konva/three（它們無法直接用 CSS 變數）；深淺色切換時更新 */
export function useCanvasTheme() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(read());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme;
}
