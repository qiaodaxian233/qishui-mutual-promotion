<template>
  <div class="register-page">
    <van-nav-bar
      title="注册"
      left-arrow
      @click-left="onBack"
    />

    <div class="content">
      <header class="page-header">
        <div class="brand-emoji">🎵</div>
        <h1 class="page-title">加入汽水音乐互推</h1>
        <p class="page-subtitle">让独立音乐人互相听见 · 注册赠送 100 积分</p>
      </header>

      <van-form @submit="onSubmit" class="register-form">
        <van-cell-group inset>
          <van-field
            v-model.trim="form.email"
            name="email"
            label="邮箱"
            placeholder="example@qq.com"
            type="email"
            autocomplete="email"
            clearable
            :rules="emailRules"
          />
          <van-field
            v-model.trim="form.code"
            name="code"
            label="验证码"
            placeholder="6 位验证码"
            type="number"
            maxlength="6"
            :rules="codeRules"
          >
            <template #button>
              <van-button
                size="small"
                type="primary"
                :disabled="!canSendCode"
                :loading="codeSending"
                @click="onSendCode"
              >
                {{ countdown > 0 ? `${countdown}s 后重发` : '获取验证码' }}
              </van-button>
            </template>
          </van-field>
          <van-field
            v-model.trim="form.nickname"
            name="nickname"
            label="昵称"
            placeholder="2-20 字符"
            maxlength="20"
            show-word-limit
            :rules="nicknameRules"
          />
          <van-field
            v-model="form.password"
            name="password"
            label="密码"
            placeholder="8-64 位,含字母和数字"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            :rules="passwordRules"
          >
            <template #right-icon>
              <van-icon
                :name="showPassword ? 'eye' : 'closed-eye'"
                @click="showPassword = !showPassword"
              />
            </template>
          </van-field>
        </van-cell-group>

        <div class="tos-block">
          <van-checkbox v-model="agreeTos" shape="square" icon-size="16px">
            <span class="tos-text">
              我已阅读并同意
              <a class="link" @click.stop="showTos">《用户协议》</a>
              真实互动、不刷量
            </span>
          </van-checkbox>
        </div>

        <div class="submit-block">
          <van-button
            block
            type="primary"
            native-type="submit"
            :loading="submitting"
            :disabled="!agreeTos"
            loading-text="提交中…"
          >
            注册并登录
          </van-button>
        </div>

        <div class="form-links">
          <span class="link-muted">已有账号?</span>
          <a class="link" @click="goLogin">直接登录</a>
        </div>
      </van-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showFailToast, showConfirmDialog } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const form = reactive({
  email: '',
  code: '',
  nickname: '',
  password: ''
});

const showPassword = ref(false);
const agreeTos = ref(false);
const submitting = ref(false);
const codeSending = ref(false);
const countdown = ref(0);
let countdownTimer = null;

// 邮箱校验复用
const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const canSendCode = computed(() => {
  return countdown.value === 0 && emailPattern.test(form.email) && !codeSending.value;
});

const emailRules = [
  { required: true, message: '请填写邮箱', trigger: 'onBlur' },
  { pattern: emailPattern, message: '邮箱格式不正确', trigger: 'onBlur' }
];

const codeRules = [
  { required: true, message: '请填写验证码', trigger: 'onBlur' },
  { pattern: /^\d{6}$/, message: '验证码为 6 位数字', trigger: 'onBlur' }
];

const nicknameRules = [
  { required: true, message: '请填写昵称', trigger: 'onBlur' },
  {
    validator: v => typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 20,
    message: '昵称 2-20 字符',
    trigger: 'onBlur'
  }
];

// 密码:8-64 位,含字母和数字(和后端 isValidPassword 对齐)
const passwordRules = [
  { required: true, message: '请填写密码', trigger: 'onBlur' },
  {
    validator: v => typeof v === 'string' && v.length >= 8 && v.length <= 64,
    message: '密码长度 8-64 位',
    trigger: 'onBlur'
  },
  {
    validator: v => /[a-zA-Z]/.test(v) && /\d/.test(v),
    message: '密码需同时包含字母和数字',
    trigger: 'onBlur'
  }
];

function startCountdown(seconds = 60) {
  countdown.value = seconds;
  countdownTimer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 1000);
}

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});

async function onSendCode() {
  if (!canSendCode.value) return;
  if (!emailPattern.test(form.email)) {
    showFailToast('请先填写正确邮箱');
    return;
  }

  codeSending.value = true;
  try {
    const res = await api.post('/auth/send-code', {
      email: form.email,
      purpose: 'register'
    });
    if (!res.ok) {
      showFailToast(res.error || '发送失败');
      return;
    }
    showToast({ message: '验证码已发送,注意查收(含垃圾邮件)', type: 'success' });
    startCountdown(60);
  } catch (err) {
    // 后端常见错误:邮箱已注册 / 临时邮箱 / 频率限制
    showFailToast(err?.error || '发送失败,请稍后再试');
  } finally {
    codeSending.value = false;
  }
}

async function onSubmit() {
  if (submitting.value) return;
  if (!agreeTos.value) {
    showFailToast('请先同意用户协议');
    return;
  }

  submitting.value = true;
  try {
    const res = await api.post('/auth/register', {
      email: form.email,
      code: form.code,
      nickname: form.nickname.trim(),
      password: form.password
    });
    if (!res.ok) {
      showFailToast(res.error || '注册失败');
      return;
    }
    // 注册接口直接返回 token + user(注册即登录)
    userStore.setAuth(res.token, res.user);
    showToast({ message: '注册成功!赠送 100 积分', type: 'success' });

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(redirect.startsWith('/') ? redirect : '/');
  } catch (err) {
    showFailToast(err?.error || '注册失败,请稍后再试');
  } finally {
    submitting.value = false;
  }
}

function showTos() {
  showConfirmDialog({
    title: '用户协议(简化版)',
    message: [
      '1. 真实互动:接单需亲自去汽水音乐听歌/点赞,严禁使用脚本或模拟器',
      '2. 凭良心:作弊行为一经核实,扣除信用分,严重者封号',
      '3. 积分非现金:不可提现、不可转让、不与人民币挂钩',
      '4. 内容合规:发布的歌曲需为合法上架内容',
      '5. 隐私:邮箱仅用于登录与验证,IP 经哈希后存储,不外传'
    ].join('\n\n'),
    confirmButtonText: '我知道了',
    showCancelButton: false,
    messageAlign: 'left'
  });
}

function onBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.replace('/');
  }
}

function goLogin() {
  const query = route.query.redirect ? { redirect: route.query.redirect } : {};
  router.push({ name: 'login', query });
}
</script>

<style scoped>
.register-page {
  min-height: 100vh;
  background: var(--page-bg);
}

.content {
  padding: 16px 0 40px;
}

.page-header {
  text-align: center;
  padding: 24px 16px 28px;
}

.brand-emoji {
  font-size: 48px;
  margin-bottom: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 4px 16px rgba(26, 254, 73, 0.3);
}

.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.page-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.register-form {
  margin-top: 8px;
}

.tos-block {
  margin: 16px 24px 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.tos-text {
  font-size: 12px;
  line-height: 1.6;
}

.submit-block {
  margin: 20px 16px 0;
}

.form-links {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
}

.link-muted {
  color: var(--color-text-secondary);
  margin-right: 6px;
}

.link {
  color: var(--color-primary-dark);
  cursor: pointer;
  font-weight: 600;
}

.link:active {
  opacity: 0.7;
}
</style>
