<template>
  <div class="auth-page">
    <van-nav-bar left-arrow @click-left="onBack" />

    <div class="auth-content">
      <div class="logo-wrap">
        <img src="/logo.png" alt="汽水音乐互推" class="logo" />
      </div>
      <h1 class="auth-title">找回密码</h1>
      <p class="auth-sub">输入注册邮箱，我们发送验证码给你</p>

      <div class="form-wrap">
        <!-- Step 1: 邮箱 + 验证码 -->
        <template v-if="step === 1">
          <div class="input-group">
            <label class="input-label">注册邮箱</label>
            <input
              v-model.trim="email"
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
                v-model.trim="code"
                type="text"
                class="apple-input"
                placeholder="6 位验证码"
                maxlength="6"
                inputmode="numeric"
              />
              <button
                class="send-btn"
                :disabled="!canSend || countdown > 0 || sending"
                @click="sendCode"
              >
                {{ countdown > 0 ? `${countdown}s` : (sending ? '发送中…' : '发送') }}
              </button>
            </div>
          </div>
        </template>

        <!-- Step 2: 设置新密码 -->
        <template v-else>
          <div class="input-group">
            <label class="input-label">新密码</label>
            <div class="pwd-row">
              <input
                v-model="newPassword"
                :type="showPwd ? 'text' : 'password'"
                class="apple-input"
                placeholder="8-64 位，含字母和数字"
                autocomplete="new-password"
              />
              <span class="pwd-toggle" @click="showPwd = !showPwd">
                {{ showPwd ? '🙈' : '👁️' }}
              </span>
            </div>
          </div>

          <div class="input-group">
            <label class="input-label">确认新密码</label>
            <div class="pwd-row">
              <input
                v-model="confirmPassword"
                :type="showPwd2 ? 'text' : 'password'"
                class="apple-input"
                placeholder="再输一遍"
                autocomplete="new-password"
                @keyup.enter="onReset"
              />
              <span class="pwd-toggle" @click="showPwd2 = !showPwd2">
                {{ showPwd2 ? '🙈' : '👁️' }}
              </span>
            </div>
          </div>

          <p v-if="pwdMismatch" class="error-tip">两次密码不一致</p>
          <p v-if="pwdWeak" class="error-tip">密码需 8-64 位，且包含字母和数字</p>
        </template>
      </div>

      <!-- Step 1 按钮 -->
      <button
        v-if="step === 1"
        class="submit-btn"
        :class="{ loading, disabled: !canNext }"
        :disabled="!canNext || loading"
        @click="onNext"
      >
        {{ loading ? '验证中…' : '下一步' }}
      </button>

      <!-- Step 2 按钮 -->
      <button
        v-else
        class="submit-btn"
        :class="{ loading, disabled: !canReset }"
        :disabled="!canReset || loading"
        @click="onReset"
      >
        {{ loading ? '重置中…' : '重置密码' }}
      </button>

      <p class="switch-text">
        想起来了？<a class="switch-link" @click="goLogin">直接登录</a>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { showToast, showFailToast } from 'vant';
import api from '@/api';

const router = useRouter();

const step = ref(1);
const email = ref('');
const code = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const showPwd = ref(false);
const showPwd2 = ref(false);
const loading = ref(false);
const sending = ref(false);
const countdown = ref(0);

let timer = null;

const canSend = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value));
const canNext = computed(() => canSend.value && code.value.length === 6);

const pwdMismatch = computed(() =>
  confirmPassword.value.length > 0 && newPassword.value !== confirmPassword.value
);
const pwdWeak = computed(() => {
  if (!newPassword.value) return false;
  const v = newPassword.value;
  return !(v.length >= 8 && v.length <= 64 && /[a-zA-Z]/.test(v) && /\d/.test(v));
});
const canReset = computed(() =>
  newPassword.value.length >= 8 &&
  confirmPassword.value.length >= 8 &&
  !pwdMismatch.value &&
  !pwdWeak.value
);

async function sendCode() {
  if (!canSend.value || countdown.value > 0 || sending.value) return;
  sending.value = true;
  try {
    const res = await api.post('/auth/send-code', { email: email.value, purpose: 'reset_password' });
    showToast({ message: res.message || '验证码已发送', type: 'success' });
    countdown.value = 60;
    timer = setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (err) {
    showFailToast(err?.error || '发送失败');
  } finally {
    sending.value = false;
  }
}

async function onNext() {
  if (!canNext.value || loading.value) return;
  loading.value = true;
  try {
    const res = await api.post('/auth/verify-reset-code', { email: email.value, code: code.value });
    if (res.ok) {
      step.value = 2;
    } else {
      showFailToast(res.error || '验证码错误');
    }
  } catch (err) {
    showFailToast(err?.error || '验证码错误');
  } finally {
    loading.value = false;
  }
}

async function onReset() {
  if (!canReset.value || loading.value) return;
  loading.value = true;
  try {
    const res = await api.post('/auth/reset-password', {
      email: email.value,
      code: code.value,
      newPassword: newPassword.value
    });
    if (res.ok) {
      showToast({ message: '密码重置成功，请登录', type: 'success' });
      setTimeout(() => router.replace('/login'), 1200);
    } else {
      showFailToast(res.error || '重置失败');
    }
  } catch (err) {
    showFailToast(err?.error || '重置失败');
  } finally {
    loading.value = false;
  }
}

function onBack() { window.history.length > 1 ? router.back() : router.replace('/login'); }
function goLogin() { router.replace('/login'); }
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
.code-row { display: flex; gap: 10px; }
.code-row .apple-input { flex: 1; }
.send-btn {
  flex-shrink: 0; height: 48px; padding: 0 16px; border: none; border-radius: 12px;
  background: var(--color-primary); color: var(--color-on-primary);
  font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: opacity 0.2s;
}
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pwd-row { position: relative; }
.pwd-row .apple-input { padding-right: 48px; }
.pwd-toggle { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); font-size: 18px; cursor: pointer; user-select: none; }
.error-tip { font-size: 12px; color: #ff3b30; padding-left: 4px; margin: -8px 0 0; }
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
