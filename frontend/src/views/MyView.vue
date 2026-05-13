<template>
  <div class="my-page">
    <van-nav-bar title="我的" />

    <!-- 未登录 -->
    <van-empty
      v-if="!userStore.isLoggedIn"
      description="登录后查看你的任务和接单"
      image-size="120"
    >
      <van-button round type="primary" size="small" @click="$router.push('/login')">
        去登录
      </van-button>
    </van-empty>

    <!-- 已登录 -->
    <template v-else>
      <!-- 用户信息卡 -->
      <section class="user-brief">
        <div class="brief-left">
          <div class="avatar">{{ userStore.user?.nickname?.charAt(0) || '🎵' }}</div>
          <div class="brief-info">
            <span class="nickname">{{ userStore.user?.nickname || '音乐爱好者' }}</span>
            <van-tag type="primary" round size="medium">
              信用 {{ userStore.user?.creditScore || 0 }}
            </van-tag>
          </div>
        </div>
        <div class="points-badge">
          <span class="pts-num">{{ userStore.user?.points ?? 0 }}</span>
          <span class="pts-label">积分</span>
        </div>
      </section>

      <!-- Tab 切换 -->
      <van-tabs
        v-model:active="activeTab"
        sticky
        offset-top="46"
        title-active-color="#0EBA37"
        title-inactive-color="#666"
        line-width="24"
        line-height="3"
        :line-style="{ background: '#1AFE49' }"
        @change="onTabChange"
      >
        <van-tab name="published" title="我发布的" />
        <van-tab name="accepted" title="我接的单" />
      </van-tabs>

      <!-- 我发布的任务 -->
      <div v-show="activeTab === 'published'" class="tab-content">
        <van-pull-refresh v-model="pub.refreshing" @refresh="refreshPublished">
          <van-list
            v-model:loading="pub.loading"
            :finished="pub.finished"
            finished-text="——  到底了  ——"
            @load="loadPublished"
          >
            <div
              v-for="t in pub.list"
              :key="t.id"
              class="task-card"
              @click="$router.push(`/tasks/${t.id}`)"
            >
              <div class="cover-mini">
                <img v-if="t.cover_url" :src="t.cover_url" class="cover-img" />
                <div v-else class="cover-fb">🎵</div>
              </div>
              <div class="card-body">
                <div class="card-top">
                  <span class="song">{{ t.song_name }}</span>
                  <van-tag :type="statusMeta(t.status).type" round plain size="medium">
                    {{ statusMeta(t.status).label }}
                  </van-tag>
                </div>
                <div class="card-meta">
                  <span>{{ typeLabel(t.task_type) }} · +{{ t.reward_points }}积分/次</span>
                  <span>剩 {{ t.quota_remaining }}/{{ t.quota_total }}</span>
                </div>
                <div class="card-time">{{ relativeTime(t.created_at) }}</div>
              </div>
            </div>

            <van-empty
              v-if="!pub.loading && pub.list.length === 0 && pub.finished"
              description="还没发布过任务"
              image-size="100"
            >
              <van-button round type="primary" size="small" @click="$router.push('/tasks/publish')">
                去发布
              </van-button>
            </van-empty>
          </van-list>
        </van-pull-refresh>
      </div>

      <!-- 我接的单 -->
      <div v-show="activeTab === 'accepted'" class="tab-content">
        <van-pull-refresh v-model="acc.refreshing" @refresh="refreshAccepted">
          <van-list
            v-model:loading="acc.loading"
            :finished="acc.finished"
            finished-text="——  到底了  ——"
            @load="loadAccepted"
          >
            <div
              v-for="c in acc.list"
              :key="c.id"
              class="task-card"
              @click="$router.push(`/tasks/${c.task_id}`)"
            >
              <div class="cover-mini">
                <img v-if="c.cover_url" :src="c.cover_url" class="cover-img" />
                <div v-else class="cover-fb">🎵</div>
              </div>
              <div class="card-body">
                <div class="card-top">
                  <span class="song">{{ c.song_name }}</span>
                  <van-tag :type="completionStatusMeta(c.status).type" round plain size="medium">
                    {{ completionStatusMeta(c.status).label }}
                  </van-tag>
                </div>
                <div class="card-meta">
                  <span>{{ typeLabel(c.task_type) }} · +{{ c.reward_points }}积分</span>
                  <span v-if="c.points_awarded">已得 {{ c.points_awarded }}</span>
                </div>
                <div class="card-time">{{ relativeTime(c.claimed_at) }}</div>
              </div>
            </div>

            <van-empty
              v-if="!acc.loading && acc.list.length === 0 && acc.finished"
              description="还没接过单"
              image-size="100"
            >
              <van-button round type="primary" size="small" @click="$router.push('/tasks')">
                去接单
              </van-button>
            </van-empty>
          </van-list>
        </van-pull-refresh>
      </div>

      <!-- 退出登录 -->
      <div class="logout-wrap">
        <van-button block plain size="small" @click="onLogout">退出登录</van-button>
      </div>
    </template>
  </div>
</template>

<script setup>
defineOptions({ name: 'MyView' });
import { ref, reactive, onActivated } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const activeTab = ref('published');
const PAGE_SIZE = 20;

// 发布的任务列表
const pub = reactive({
  list: [],
  loading: false,
  finished: false,
  refreshing: false,
  offset: 0
});

// 接的单列表
const acc = reactive({
  list: [],
  loading: false,
  finished: false,
  refreshing: false,
  offset: 0
});

function statusMeta(status) {
  const map = {
    active:    { label: '进行中', type: 'primary' },
    completed: { label: '已完成', type: 'success' },
    cancelled: { label: '已撤销', type: 'default' },
    expired:   { label: '已过期', type: 'default' }
  };
  return map[status] || { label: status, type: 'default' };
}

function completionStatusMeta(status) {
  const map = {
    claimed:        { label: '待完成', type: 'warning' },
    auto_passed:    { label: '验证通过', type: 'primary' },
    auto_rejected:  { label: '验证失败', type: 'danger' },
    manual_passed:  { label: '已发放', type: 'success' },
    recheck_failed: { label: '回查失败', type: 'danger' }
  };
  return map[status] || { label: status, type: 'default' };
}

function typeLabel(type) {
  const map = { like: '点赞', listen: '播放', comment: '评论', share: '分享' };
  return map[type] || type;
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  return `${d}天前`;
}

// === 我发布的 ===
async function loadPublished() {
  if (pub.refreshing) return;
  try {
    const res = await api.get('/tasks/mine', { params: { limit: PAGE_SIZE, offset: pub.offset } });
    if (res.ok) {
      pub.list.push(...res.tasks);
      pub.offset += res.tasks.length;
      if (res.tasks.length < PAGE_SIZE) pub.finished = true;
    }
  } catch {} finally {
    pub.loading = false;
  }
}

function refreshPublished() {
  pub.list = [];
  pub.offset = 0;
  pub.finished = false;
  loadPublished().then(() => { pub.refreshing = false; });
}

// === 我接的 ===
async function loadAccepted() {
  if (acc.refreshing) return;
  try {
    const res = await api.get('/completions', { params: { limit: PAGE_SIZE, offset: acc.offset } });
    if (res.ok) {
      acc.list.push(...res.items);
      acc.offset += res.items.length;
      if (res.items.length < PAGE_SIZE) acc.finished = true;
    }
  } catch {} finally {
    acc.loading = false;
  }
}

function refreshAccepted() {
  acc.list = [];
  acc.offset = 0;
  acc.finished = false;
  loadAccepted().then(() => { acc.refreshing = false; });
}

function onTabChange() {
  // 切 tab 时如果对应列表为空,触发一次加载
  if (activeTab.value === 'published' && pub.list.length === 0 && !pub.finished) {
    pub.loading = true;
    loadPublished();
  }
  if (activeTab.value === 'accepted' && acc.list.length === 0 && !acc.finished) {
    acc.loading = true;
    loadAccepted();
  }
}

async function onLogout() {
  try { await api.post('/auth/logout'); } catch {}
  userStore.clearAuth();
  showToast('已退出登录');
  router.replace('/');
}

onActivated(() => {
  if (userStore.isLoggedIn) {
    userStore.refreshMe();
  }
});
</script>

<style scoped>
.my-page {
  min-height: 100vh;
  background: var(--page-bg);
  padding-bottom: 80px;
}

/* 用户卡 */
.user-brief {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.brief-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(26,254,73,.3);
}
.brief-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nickname {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.points-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pts-num {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-primary-dark);
}
.pts-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

/* Tab 内容区 */
.tab-content {
  min-height: calc(100vh - 200px);
}

/* 列表卡片 */
.task-card {
  display: flex;
  gap: 12px;
  margin: 10px 12px;
  padding: 12px;
  background: var(--card-bg);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,.03);
  cursor: pointer;
  transition: transform 0.12s;
}
.task-card:active { transform: scale(0.98); }

.cover-mini {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  background: #f0f0f0;
}
.cover-img { width: 100%; height: 100%; object-fit: cover; }
.cover-fb {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px;
  background: linear-gradient(135deg, #f5f5f5, #e8e8e8);
}

.card-body { flex: 1; min-width: 0; }
.card-top {
  display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
}
.song {
  font-size: 14px; font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
}
.card-meta {
  display: flex; justify-content: space-between;
  font-size: 12px; color: var(--color-text-regular); margin-bottom: 2px;
}
.card-time { font-size: 11px; color: var(--color-text-disabled); }

.logout-wrap {
  padding: 24px 16px 16px;
}
</style>
