<template>
  <div class="auth-page">
    <van-nav-bar left-arrow @click-left="onBack" />

    <div class="auth-content">
      <div class="logo-wrap">
        <img src="/logo.png" alt="汽水音乐互推" class="logo" />
      </div>
      <h1 class="auth-title">欢迎回来</h1>
      <p class="auth-sub">登录你的汽水互推账号</p>

      <div class="form-wrap">
        <div class="input-group">
          <label class="input-label">邮箱</label>
          <input
            v-model.trim="email"
            type="email"
            class="apple-input"
            placeholder="your@email.com"
            autocomplete="email"
          />
        </div>

        <div class="input-group">
          <label class="input-label">密码</label>
          <div class="pwd-row">
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              class="apple-input"
              placeholder="输入密码"
              autocomplete="current-password"
              @keyup.enter="onLogin"
            />
            <span class="pwd-toggle" @click="showPwd = !showPwd">
              {{ showPwd ? '🙈' : '👁️' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 记住账号 -->
      <div class="remember-row">
        <div
          class="tos-check"
          :class="{ checked: rememberEmail }"
          @click="rememberEmail = !rememberEmail"
        >
          <span v-if="rememberEmail" class="check-icon">✓</span>
        </div>
        <span class="remember-text">记住账号</span>
      </div>

      <button
        class="submit-btn"
        :class="{ loading, disabled: !canLogin }"
        :disabled="!canLogin || loading"
        @click="onLogin"
      >
        {{ loading ? '登录中…' : '登录' }}
      </button>

      <p class="switch-text">
        还没有账号？<a class="switch-link" @click="goRegister">立即注册</a>
      </p>
      <p class="switch-text">
        <a class="switch-link" @click="goForgot">忘记密码？</a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showFailToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const email = ref(localStorage.getItem('qishui_saved_email') || '');
const password = ref('');
const showPwd = ref(false);
const rememberEmail = ref(!!localStorage.getItem('qishui_saved_email'));
const loading = ref(false);

const canLogin = computed(() => email.value.includes('@') && password.value.length >= 8);

async function onLogin() {
  if (!canLogin.value || loading.value) return;
  // 保存/清除邮箱
  if (rememberEmail.value) {
    localStorage.setItem('qishui_saved_email', email.value);
  } else {
    localStorage.removeItem('qishui_saved_email');
  }
  loading.value = true;
  try {
    const res = await api.post('/auth/login', { email: email.value, password: password.value });
    if (res.ok) {
      userStore.setAuth(res.token, res.user);
      showToast({ message: '登录成功', type: 'success' });
      const redirect = route.query.redirect || '/';
      router.replace(redirect.startsWith('/') ? redirect : '/');
    } else {
      showFailToast(res.error || '登录失败');
    }
  } catch (err) { showFailToast(err?.error || '登录失败'); }
  finally { loading.value = false; }
}

function onBack() { window.history.length > 1 ? router.back() : router.replace('/'); }
function goRegister() { router.push({ name: 'register', query: route.query.redirect ? { redirect: route.query.redirect } : {} }); }
function goForgot() { router.push({ name: 'forgot-password' }); }
</script>

<style scoped>
.auth-page { min-height: 100vh; background: var(--page-bg); }
.auth-content { padding: 0 24px 60px; max-width: 400px; margin: 0 auto; }
.logo-wrap { text-align: center; margin-bottom: 20px; }
.logo {
  width: 72px; height: 72px; border-radius: 20px; object-fit: cover;
  box-shadow: 0 8px 24px rgba(52, 199, 89, 0.3);
  margin: 0 auto;
}
.auth-title { text-align: center; font-size: 26px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 6px; letter-spacing: -0.5px; }
.auth-sub { text-align: center; font-size: 14px; color: var(--color-text-secondary); margin: 0 0 32px; }
.form-wrap { display: flex; flex-direction: column; gap: 18px; }
.input-group { display: flex; flex-direction: column; gap: 6px; }
.input-label { font-size: 13px; font-weight: 600; color: var(--color-text-regular); padding-left: 2px; }
.apple-input {
  width: 100%; height: 48px; padding: 0 16px; border: none; border-radius: 12px;
  background: var(--card-bg); color: var(--color-text-primary); font-size: 16px;
  outline: none; transition: box-shadow 0.2s; box-shadow: 0 0 0 1px var(--divider); -webkit-appearance: none;
}
.apple-input::placeholder { color: var(--color-text-disabled); }
.apple-input:focus { box-shadow: 0 0 0 2px var(--color-primary); }
.pwd-row { position: relative; }
.pwd-row .apple-input { padding-right: 48px; }
.pwd-toggle { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 18px; cursor: pointer; user-select: none; }
.remember-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.tos-check {
  width: 20px; height: 20px; border-radius: 6px; border: 2px solid var(--color-text-disabled);
  display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.tos-check.checked { background: var(--color-primary); border-color: var(--color-primary); }
.check-icon { color: #fff; font-size: 12px; font-weight: 700; }
.remember-text { font-size: 13px; color: var(--color-text-secondary); }
.submit-btn {
  width: 100%; height: 52px; margin-top: 24px; border: none; border-radius: 14px;
  background: var(--color-primary); color: var(--color-on-primary);
  font-size: 17px; font-weight: 700; cursor: pointer; transition: all 0.2s; letter-spacing: 0.5px;
}
.submit-btn:active { transform: scale(0.98); }
.submit-btn.disabled { opacity: 0.4; cursor: not-allowed; }
.submit-btn.loading { opacity: 0.7; }
.switch-text { text-align: center; margin-top: 20px; font-size: 14px; color: var(--color-text-secondary); }
.switch-link { color: var(--color-primary-dark); font-weight: 600; cursor: pointer; }
</style>
