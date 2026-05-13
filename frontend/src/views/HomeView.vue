<template>
  <div class="home">
    <!-- 顶部品牌区 -->
    <header class="brand">
      <div class="brand-emoji">🎵</div>
      <h1 class="brand-title">汽水音乐互推</h1>
      <p class="brand-slogan">让独立音乐人互相听见</p>
    </header>

    <!-- 登录态:已登录显示积分 + 用户信息 -->
    <section v-if="userStore.isLoggedIn" class="user-card">
      <div class="user-row">
        <span class="user-nickname">{{ userStore.user?.nickname || '音乐爱好者' }}</span>
        <van-tag type="primary" round>信用 {{ userStore.user?.creditScore || 0 }}</van-tag>
      </div>
      <div class="points-row">
        <span class="points-label">我的积分</span>
        <span class="points-value">{{ userStore.user?.points ?? 0 }}</span>
      </div>
      <van-button block type="default" size="small" @click="onLogout">
        退出登录
      </van-button>
    </section>

    <!-- 未登录:CTA 按钮 -->
    <section v-else class="guest-cta">
      <van-button block type="primary" round size="large" @click="$router.push('/login')">
        登录
      </van-button>
      <van-button block type="default" round size="large" class="mt-16" @click="$router.push('/register')">
        注册新账号
      </van-button>
    </section>

    <!-- 后续页面占位 -->
    <section class="placeholder mt-32">
      <van-empty
        description="任务广场即将上线 🚧"
        image-size="120"
      />
    </section>

    <!-- 健康检查指示器(开发期用,知道前后端通了) -->
    <div class="health-indicator" :class="healthClass">
      {{ healthText }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import api from '@/api';
import { showToast } from 'vant';

const router = useRouter();
const userStore = useUserStore();

const healthStatus = ref('checking');  // 'checking' | 'ok' | 'fail'

const healthText = computed(() => ({
  checking: '检测中…',
  ok: '● 服务正常',
  fail: '● 服务异常'
})[healthStatus.value]);

const healthClass = computed(() => `health-${healthStatus.value}`);

async function checkHealth() {
  try {
    const res = await api.get('/health');
    healthStatus.value = res.ok && res.db ? 'ok' : 'fail';
  } catch {
    healthStatus.value = 'fail';
  }
}

async function onLogout() {
  try {
    await api.post('/auth/logout');
  } catch {}
  userStore.clearAuth();
  showToast('已退出登录');
}

onMounted(async () => {
  checkHealth();
  if (userStore.isLoggedIn) {
    await userStore.refreshMe();
  }
});
</script>

<style scoped>
.home {
  min-height: 100vh;
  padding: 24px 16px 80px;
  position: relative;
}

.brand {
  text-align: center;
  padding: 32px 0 24px;
}

.brand-emoji {
  font-size: 56px;
  margin-bottom: 8px;
}

.brand-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.brand-slogan {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--color-text-secondary);
}

.user-card {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 20px 16px;
  margin-top: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.user-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.user-nickname {
  font-size: 16px;
  font-weight: 600;
}

.points-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--divider);
}

.points-label {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.points-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-primary);
}

.guest-cta {
  margin-top: 32px;
}

.placeholder {
  padding: 32px 0;
}

.health-indicator {
  position: fixed;
  bottom: 16px;
  right: 16px;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--color-text-secondary);
}

.health-ok {
  color: var(--color-success);
}

.health-fail {
  color: var(--color-danger);
}
</style>
