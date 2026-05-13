<template>
  <div class="login-page">
    <van-nav-bar
      title="登录"
      left-arrow
      @click-left="onBack"
    />

    <div class="content">
      <header class="page-header">
        <div class="brand-emoji">🎵</div>
        <h1 class="page-title">欢迎回来</h1>
        <p class="page-subtitle">用注册时的邮箱和密码登录</p>
      </header>

      <van-form @submit="onSubmit" class="login-form">
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
            v-model="form.password"
            name="password"
            label="密码"
            placeholder="请输入密码"
            type="password"
            autocomplete="current-password"
            :rules="passwordRules"
          />
        </van-cell-group>

        <div class="submit-block">
          <van-button
            block
            type="primary"
            native-type="submit"
            :loading="submitting"
            loading-text="登录中…"
          >
            登录
          </van-button>
        </div>

        <div class="form-links">
          <span class="link-muted">还没账号?</span>
          <a class="link" @click="goRegister">立即注册</a>
        </div>
      </van-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showFailToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const form = reactive({
  email: '',
  password: ''
});

const submitting = ref(false);

const emailRules = [
  { required: true, message: '请填写邮箱', trigger: 'onBlur' },
  {
    pattern: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    message: '邮箱格式不正确',
    trigger: 'onBlur'
  }
];

const passwordRules = [
  { required: true, message: '请填写密码', trigger: 'onBlur' },
  {
    validator: v => typeof v === 'string' && v.length >= 6,
    message: '密码至少 6 位',
    trigger: 'onBlur'
  }
];

async function onSubmit() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const res = await api.post('/auth/login', {
      email: form.email,
      password: form.password
    });
    if (!res.ok) {
      showFailToast(res.error || '登录失败');
      return;
    }
    userStore.setAuth(res.token, res.user);
    showToast({ message: '登录成功', type: 'success' });

    // 支持登录后跳回原页面(/login?redirect=/xxx)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    // 安全:redirect 必须以 / 开头,避免开放重定向
    router.replace(redirect.startsWith('/') ? redirect : '/');
  } catch (err) {
    showFailToast(err?.error || '登录失败,请稍后再试');
  } finally {
    submitting.value = false;
  }
}

function onBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.replace('/');
  }
}

function goRegister() {
  // 保留 redirect 参数,注册成功也能跳回原页
  const query = route.query.redirect ? { redirect: route.query.redirect } : {};
  router.push({ name: 'register', query });
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: var(--page-bg);
}

.content {
  padding: 16px 0 40px;
}

.page-header {
  text-align: center;
  padding: 24px 16px 32px;
}

.brand-emoji {
  font-size: 48px;
  margin-bottom: 12px;
  /* 汽水绿背景圆形衬底,品牌点缀 */
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

.login-form {
  margin-top: 8px;
}

.submit-block {
  margin: 24px 16px 0;
}

.form-links {
  margin-top: 20px;
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
