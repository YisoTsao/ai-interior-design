import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh-TW.json';

const saved = (() => {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
})();

void i18n.use(initReactI18next).init({
  resources: { 'zh-TW': { translation: zh }, en: { translation: en } },
  lng: saved ?? 'zh-TW',
  fallbackLng: 'zh-TW',
  interpolation: { escapeValue: false },
});
document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (l) => {
  document.documentElement.lang = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* 私密模式等情況可忽略 */
  }
});
export default i18n;
