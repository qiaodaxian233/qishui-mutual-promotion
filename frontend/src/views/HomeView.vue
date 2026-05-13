<template>
  <div class="home">
    <!-- 顶部品牌区 -->
    <header class="brand">
      <img src="/logo.png" alt="汽水音乐互推" class="brand-logo" />
      <h1 class="brand-title">汽水音乐互推</h1>
      <p class="brand-slogan">让独立音乐人互相听见</p>
    </header>

    <!-- 登录态:已登录显示积分 + 用户信息 -->
    <section v-if="userStore.isLoggedIn" class="user-card">
      <div class="user-row">
        <span class="user-nickname">{{ userStore.user?.nickname || '音乐爱好者' }}</span>
        <van-tag type="primary" round>信用 {{ userStore.user?.creditScore || 0 }}</van-tag>
      </div>
      <div class="points-row" @click="$router.push('/points')" style="cursor:pointer">
        <span class="points-label">我的积分</span>
        <div style="display:flex;align-items:baseline;gap:4px">
          <span class="points-value">{{ userStore.user?.points ?? 0 }}</span>
          <van-icon name="arrow" size="14" color="#bbb" />
        </div>
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

    <!-- 每日签到 -->
    <section v-if="userStore.isLoggedIn" class="checkin-card" @click="onCheckin">
      <div class="checkin-left">
        <span class="checkin-emoji">{{ checkinDone ? '✅' : '📅' }}</span>
        <div class="checkin-info">
          <span class="checkin-title">{{ checkinDone ? '今日已签到' : '每日签到' }}</span>
          <span class="checkin-sub">
            {{ checkinDone ? `今日 +${checkinReward} 积分` : '随机获得 50~1000 积分' }}
          </span>
        </div>
      </div>
      <van-button
        v-if="!checkinDone"
        type="primary"
        round
        size="small"
        :loading="checkinLoading"
      >签到</van-button>
      <van-tag v-else type="success" round size="large">+{{ checkinReward }}</van-tag>
    </section>

    <!-- 任务广场入口 -->
    <section class="plaza-entry mt-32">
      <div class="plaza-card" @click="$router.push('/tasks')">
        <div class="plaza-icon">🎪</div>
        <div class="plaza-text">
          <div class="plaza-title">任务广场</div>
          <div class="plaza-sub">浏览正在招募的独立音乐人任务</div>
        </div>
        <van-icon name="arrow" size="18" color="#bbb" />
      </div>
    </section>

    <!-- 健康检查指示器(开发期用,知道前后端通了) -->
    <div class="health-indicator" :class="healthClass">
      {{ healthText }}
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'HomeView' });
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

// 签到
const checkinDone = ref(false);
const checkinReward = ref(0);
const checkinLoading = ref(false);

async function loadCheckinStatus() {
  try {
    const res = await api.get('/checkin/status');
    if (res.ok) {
      checkinDone.value = res.checkedIn;
      checkinReward.value = res.todayReward;
    }
  } catch {}
}

async function onCheckin() {
  if (checkinDone.value || checkinLoading.value) return;
  checkinLoading.value = true;
  try {
    const res = await api.post('/checkin');
    if (res.ok) {
      checkinDone.value = true;
      checkinReward.value = res.reward;
      showToast({ message: res.message, type: 'success' });
      await userStore.refreshMe();
    } else if (res.alreadyDone) {
      checkinDone.value = true;
      checkinReward.value = res.todayReward;
    } else {
      showToast(res.error || '签到失败');
    }
  } catch (err) {
    showToast(err?.error || '签到失败');
  } finally {
    checkinLoading.value = false;
  }
}

onMounted(async () => {
  checkHealth();
  if (userStore.isLoggedIn) {
    await userStore.refreshMe();
    loadCheckinStatus();
  }
});
</script>

<style scoped>
.home {
  min-height: 100vh;
  padding: 24px 16px 100px;
  position: relative;
}

.brand {
  text-align: center;
  padding: 32px 0 24px;
}

.brand-logo {
  width: 80px;
  height: 80px;
  border-radius: 22px;
  margin-bottom: 12px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(52, 199, 89, 0.3);
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
  color: var(--color-primary-dark);
}

.guest-cta {
  margin-top: 32px;
}

/* 签到卡 */
.checkin-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card-bg);
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg, 16px);
  padding: 14px 16px;
  margin-top: 12px;
  cursor: pointer;
  transition: transform .12s;
  box-shadow: var(--shadow-sm);
}
.checkin-card:active { transform: scale(.98); }
.checkin-left { display: flex; align-items: center; gap: 10px; }
.checkin-emoji { font-size: 28px; }
.checkin-info { display: flex; flex-direction: column; }
.checkin-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.checkin-sub { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }

.plaza-entry {
  margin-top: 32px;
}

.plaza-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.plaza-card:active {
  transform: scale(0.98);
}

.plaza-icon {
  font-size: 36px;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(26, 254, 73, 0.12);
  flex-shrink: 0;
}

.plaza-text {
  flex: 1;
  min-width: 0;
}

.plaza-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.plaza-sub {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.health-indicator {
  /* 用 absolute 锚到 .app-root(它有 position:relative + max-width:480),
     避免在桌面端宽屏下 fixed 把指示器贴到视口右下,跑到容器外面 */
  position: absolute;
  bottom: 16px;
  right: 16px;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--color-text-secondary);
  z-index: 10;
  pointer-events: none;
}

.health-ok {
  color: var(--color-success);
}

.health-fail {
  color: var(--color-danger);
}
</style>
