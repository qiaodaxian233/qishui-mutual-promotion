<template>
  <div class="auth-page">
    <van-nav-bar left-arrow @click-left="onBack" />

    <div class="auth-content">
      <!-- Logo -->
      <div class="logo-wrap">
        <img src="/logo.png" alt="汽水音乐互推" class="logo" />
      </div>
      <h1 class="auth-title">创建账号</h1>
      <p class="auth-sub">加入汽水音乐互推 · 注册送 100 积分</p>

      <!-- 表单 -->
      <div class="form-wrap">
        <div class="input-group">
          <label class="input-label">邮箱</label>
          <input
            v-model.trim="form.email"
            type="email"
            class="apple-input"
            placeholder="your@email.com"
            autocomplete="email"
          />
        </div>

        <div class="input-group">
          <label class="input-label">验证码</label>
          <div class="code-row">
            <input
              v-model.trim="form.code"
              type="text"
              inputmode="numeric"
              maxlength="6"
              class="apple-input code-input"
              placeholder="6 位数字"
            />
            <button
              class="code-btn"
              :class="{ disabled: !canSendCode }"
              :disabled="!canSendCode"
              @click="onSendCode"
            >
              {{ codeSending ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </button>
          </div>
        </div>

        <div class="input-group">
          <label class="input-label">昵称</label>
          <input
            v-model.trim="form.nickname"
            type="text"
            class="apple-input"
            placeholder="给自己起个名字"
            maxlength="20"
          />
        </div>

        <div class="input-group">
          <label class="input-label">密码</label>
          <div class="pwd-row">
            <input
              v-model="form.password"
              :type="showPwd ? 'text' : 'password'"
              class="apple-input"
              placeholder="8 位以上，含字母和数字"
              autocomplete="new-password"
            />
            <span class="pwd-toggle" @click="showPwd = !showPwd">
              {{ showPwd ? '🙈' : '👁️' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 协议 -->
      <div class="tos-row">
        <div
          class="tos-check"
          :class="{ checked: agreeTos }"
          @click="agreeTos = !agreeTos"
        >
          <span v-if="agreeTos" class="check-icon">✓</span>
        </div>
        <span class="tos-text">
          我已阅读并同意
          <a class="tos-link" @click.stop="$router.push('/agreement')">《用户协议》</a>
        </span>
      </div>

      <!-- 提交 -->
      <button
        class="submit-btn"
        :class="{ loading: submitting, disabled: !canSubmit }"
        :disabled="!canSubmit || submitting"
        @click="onSubmit"
      >
        {{ submitting ? '注册中…' : '注册并登录' }}
      </button>

      <p class="switch-text">
        已有账号？<a class="switch-link" @click="goLogin">直接登录</a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showFailToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const form = reactive({ email: '', code: '', nickname: '', password: '' });
const showPwd = ref(false);
const agreeTos = ref(false);
const submitting = ref(false);
const codeSending = ref(false);
const countdown = ref(0);
let timer = null;

const emailOk = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email));
const canSendCode = computed(() => countdown.value === 0 && emailOk.value && !codeSending.value);
const canSubmit = computed(() =>
  emailOk.value && form.code.length === 6 && form.nickname.length >= 2 && form.password.length >= 8 && agreeTos.value
);

function startCountdown() {
  countdown.value = 60;
  timer = setInterval(() => {
    if (--countdown.value <= 0) clearInterval(timer);
  }, 1000);
}
onUnmounted(() => { if (timer) clearInterval(timer); });

async function onSendCode() {
  if (!canSendCode.value) return;
  codeSending.value = true;
  try {
    const res = await api.post('/auth/send-code', { email: form.email, purpose: 'register' });
    if (res.ok) {
      showToast({ message: '验证码已发送', type: 'success' });
      startCountdown();
    } else {
      showFailToast(res.error || '发送失败');
    }
  } catch (err) { showFailToast(err?.error || '发送失败'); }
  finally { codeSending.value = false; }
}

async function onSubmit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    const res = await api.post('/auth/register', {
      email: form.email, code: form.code,
      nickname: form.nickname.trim(), password: form.password
    });
    if (res.ok) {
      userStore.setAuth(res.token, res.user);
      showToast({ message: '🎉 注册成功！送你 100 积分', type: 'success' });
      const redirect = route.query.redirect || '/';
      router.replace(redirect.startsWith('/') ? redirect : '/');
    } else {
      showFailToast(res.error || '注册失败');
    }
  } catch (err) { showFailToast(err?.error || '注册失败'); }
  finally { submitting.value = false; }
}

function onBack() { window.history.length > 1 ? router.back() : router.replace('/'); }
function goLogin() { router.push({ name: 'login', query: route.query.redirect ? { redirect: route.query.redirect } : {} }); }
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  background: var(--page-bg);
}
.auth-content {
  padding: 0 24px 60px;
  max-width: 400px;
  margin: 0 auto;
}

/* Logo */
.logo-wrap { text-align: center; margin-bottom: 20px; }
.logo {
  width: 72px; height: 72px;
  border-radius: 20px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(52, 199, 89, 0.3);
  margin: 0 auto;
}
.auth-title {
  text-align: center;
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 6px;
  letter-spacing: -0.5px;
}
.auth-sub {
  text-align: center;
  font-size: 14px;
  color: var(--color-text-secondary);
  margin: 0 0 28px;
}

/* 表单 */
.form-wrap { display: flex; flex-direction: column; gap: 18px; }
.input-group { display: flex; flex-direction: column; gap: 6px; }
.input-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-regular);
  padding-left: 2px;
}
.apple-input {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  background: var(--card-bg);
  color: var(--color-text-primary);
  font-size: 16px;
  outline: none;
  transition: box-shadow 0.2s;
  box-shadow: 0 0 0 1px var(--divider);
  -webkit-appearance: none;
}
.apple-input::placeholder { color: var(--color-text-disabled); }
.apple-input:focus { box-shadow: 0 0 0 2px var(--color-primary); }

/* 验证码行 */
.code-row { display: flex; gap: 10px; }
.code-input { flex: 1; }
.code-btn {
  flex-shrink: 0;
  height: 48px;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.code-btn:active { opacity: 0.8; }
.code-btn.disabled { opacity: 0.4; cursor: not-allowed; }

/* 密码行 */
.pwd-row { position: relative; }
.pwd-row .apple-input { padding-right: 48px; }
.pwd-toggle {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  font-size: 18px; cursor: pointer; user-select: none;
}

/* 协议 */
.tos-row {
  display: flex; align-items: center; gap: 8px;
  margin-top: 20px; padding: 0 2px;
}
.tos-check {
  width: 20px; height: 20px;
  border-radius: 6px;
  border: 2px solid var(--color-text-disabled);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.15s;
  flex-shrink: 0;
}
.tos-check.checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.check-icon { color: #fff; font-size: 12px; font-weight: 700; }
.tos-text { font-size: 13px; color: var(--color-text-secondary); }
.tos-link { color: var(--color-primary-dark); font-weight: 600; cursor: pointer; }

/* 提交按钮 */
.submit-btn {
  width: 100%;
  height: 52px;
  margin-top: 24px;
  border: none;
  border-radius: 14px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}
.submit-btn:active { transform: scale(0.98); }
.submit-btn.disabled { opacity: 0.4; cursor: not-allowed; }
.submit-btn.loading { opacity: 0.7; }

/* 切换链接 */
.switch-text {
  text-align: center;
  margin-top: 20px;
  font-size: 14px;
  color: var(--color-text-secondary);
}
.switch-link { color: var(--color-primary-dark); font-weight: 600; cursor: pointer; }
</style>
