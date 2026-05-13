import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/api';

const TOKEN_KEY = 'qishui_token';
const USER_KEY = 'qishui_user';

export const useUserStore = defineStore('user', () => {
  // 从 localStorage 恢复登录态(刷新页面也保持)
  const token = ref(localStorage.getItem(TOKEN_KEY) || '');
  const user = ref(parseUserFromStorage());

  const isLoggedIn = computed(() => !!token.value);

  function parseUserFromStorage() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function setAuth(newToken, newUser) {
    token.value = newToken;
    user.value = newUser;
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
  }

  function clearAuth() {
    token.value = '';
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * 拉取最新用户信息(进入 home 时自动刷一次,保证积分等数据是最新的)
   */
  async function refreshMe() {
    if (!token.value) return;
    try {
      const res = await api.get('/auth/me');
      if (res.ok) {
        user.value = res.user;
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      }
    } catch (err) {
      // 401 会被 axios 拦截器自动 clearAuth,这里不用管
    }
  }

  return {
    token, user, isLoggedIn,
    setAuth, clearAuth, refreshMe
  };
});
