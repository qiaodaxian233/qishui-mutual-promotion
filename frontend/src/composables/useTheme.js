/**
 * 主题管理
 *
 * 优先级: 手动设置 > 系统偏好 > 时间检测(18:00-6:00 暗色)
 */
import { ref, watch } from 'vue';

const STORAGE_KEY = 'qishui_theme';

// 'light' | 'dark' | 'auto'
const themeMode = ref(localStorage.getItem(STORAGE_KEY) || 'auto');
const isDark = ref(false);

function detectDark() {
  if (themeMode.value === 'dark') return true;
  if (themeMode.value === 'light') return false;

  // auto: 先看系统偏好
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return true;
  }

  // 再看时间:18:00-6:00 暗色
  const hour = new Date().getHours();
  return hour >= 18 || hour < 6;
}

function applyTheme() {
  isDark.value = detectDark();
  const html = document.documentElement;

  if (themeMode.value === 'auto') {
    // auto 模式:移除手动标记,让 CSS media query 和 JS 协作
    if (isDark.value) {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
  } else {
    html.setAttribute('data-theme', themeMode.value);
  }
}

function setTheme(mode) {
  themeMode.value = mode;
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme();
}

function toggleTheme() {
  if (isDark.value) {
    setTheme('light');
  } else {
    setTheme('dark');
  }
}

// 监听系统偏好变化
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeMode.value === 'auto') applyTheme();
  });
}

// 每分钟检查时间(for auto mode)
setInterval(() => {
  if (themeMode.value === 'auto') applyTheme();
}, 60 * 1000);

// 初始化
applyTheme();

export function useTheme() {
  return { themeMode, isDark, setTheme, toggleTheme, applyTheme };
}
