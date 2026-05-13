<template>
  <div class="tasks-page">
    <van-nav-bar
      title="任务广场"
      left-arrow
      @click-left="$router.push('/')"
    >
      <template #right>
        <van-icon
          v-if="userStore.isLoggedIn"
          name="add-o"
          size="20"
          @click="onPublish"
        />
      </template>
    </van-nav-bar>

    <!-- 任务类型筛选 -->
    <van-tabs
      v-model:active="activeType"
      sticky
      offset-top="46"
      shrink
      title-active-color="#0EBA37"
      title-inactive-color="#666"
      line-width="24"
      line-height="3"
      :line-style="{ background: '#1AFE49' }"
      @change="onTypeChange"
    >
      <van-tab v-for="tab in typeTabs" :key="tab.value" :name="tab.value" :title="tab.label" />
    </van-tabs>

    <!-- 列表区 -->
    <van-pull-refresh v-model="refreshing" @refresh="onRefresh" class="list-wrap">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="——  到底了  ——"
        :error="error"
        error-text="加载失败,点击重试"
        @load="loadMore"
        @click-error="onRetry"
      >
        <div
          v-for="task in tasks"
          :key="task.id"
          class="task-card"
          :class="{ 'task-card--pinned': task.is_pinned }"
          @click="goDetail(task.id)"
        >
          <!-- 封面 -->
          <div class="cover-wrap">
            <img
              v-if="task.cover_url"
              :src="task.cover_url"
              :alt="task.song_name"
              class="cover-img"
              loading="lazy"
              @error="onCoverError"
            />
            <div v-else class="cover-fallback">🎵</div>
          </div>

          <!-- 内容 -->
          <div class="card-body">
            <div class="card-title-row">
              <h3 class="song-name" :class="{ 'golden-shimmer': task.is_pinned }">
                <span v-if="task.is_pinned" class="pin-icon">📌</span>
                {{ task.song_name }}
              </h3>
              <van-tag
                v-if="task.is_welfare"
                type="success"
                round
                class="welfare-tag"
              >🎁 福利</van-tag>
              <van-tag
                :type="taskTypeMeta(task.task_type).tagType"
                round
                plain
                class="type-tag"
              >
                {{ taskTypeMeta(task.task_type).label }}
              </van-tag>
            </div>
            <div class="artist">{{ task.artist_name }}</div>

            <div class="meta-row">
              <span class="reward">
                <strong>+{{ task.reward_points }}</strong> 积分/次
              </span>
              <span class="quota">
                剩余 {{ task.quota_remaining }}/{{ task.quota_total }}
              </span>
            </div>

            <!-- 互动数据 -->
            <div class="interact-row">
              <span class="interact-item" v-if="task.likes != null">❤️ {{ formatNum(task.likes) }}</span>
              <span class="interact-item" v-if="task.comments != null">💬 {{ formatNum(task.comments) }}</span>
              <span class="interact-item" v-if="task.shares != null">🔗 {{ formatNum(task.shares) }}</span>
            </div>

            <div class="bottom-row">
              <span class="publisher">@{{ task.publisher_nickname }}</span>
              <span class="time">{{ relativeTime(task.created_at) }}</span>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <van-empty
          v-if="!loading && tasks.length === 0 && finished"
          :description="emptyHint"
          image-size="120"
        >
          <van-button
            v-if="userStore.isLoggedIn"
            round
            type="primary"
            size="small"
            @click="onPublish"
          >
            发布第一个任务
          </van-button>
        </van-empty>
      </van-list>
    </van-pull-refresh>
  </div>
</template>

<script setup>
defineOptions({ name: 'TasksView' });
import { ref, computed, onActivated, onDeactivated } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

let refreshTimer = null;

const typeTabs = [
  { value: 'all',     label: '全部' },
  { value: 'like',    label: '点赞' },
  { value: 'listen',  label: '播放' },
  { value: 'comment', label: '评论' },
  { value: 'share',   label: '分享' }
];

const activeType = ref('all');
const tasks = ref([]);
const refreshing = ref(false);
const loading = ref(false);
const finished = ref(false);
const error = ref(false);
const offset = ref(0);
const PAGE_SIZE = 20;

const emptyHint = computed(() => {
  if (activeType.value === 'all') return '暂无可接的任务,等等看 🎵';
  return `暂时没有「${typeTabs.find(t => t.value === activeType.value).label}」类任务`;
});

function taskTypeMeta(type) {
  const map = {
    like:    { label: '点赞', tagType: 'primary' },
    listen:  { label: '播放', tagType: 'success' },
    comment: { label: '评论', tagType: 'warning' },
    share:   { label: '分享', tagType: 'danger' }
  };
  return map[type] || { label: type, tagType: 'default' };
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

function formatNum(n) {
  if (n == null) return '';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function onCoverError(e) {
  // 封面挂了就显示降级
  e.target.style.display = 'none';
  const fallback = document.createElement('div');
  fallback.className = 'cover-fallback';
  fallback.textContent = '🎵';
  e.target.parentNode.appendChild(fallback);
}

async function loadMore() {
  if (refreshing.value) return;  // refresh 进行中不要并发拉
  try {
    error.value = false;
    const params = { limit: PAGE_SIZE, offset: offset.value };
    if (activeType.value !== 'all') params.type = activeType.value;
    const res = await api.get('/tasks', { params });
    if (!res.ok) {
      error.value = true;
      return;
    }
    tasks.value.push(...res.tasks);
    offset.value += res.tasks.length;
    if (res.tasks.length < PAGE_SIZE) {
      finished.value = true;
    }
  } catch (e) {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

async function onRefresh() {
  // 重置列表,从头拉
  offset.value = 0;
  tasks.value = [];
  finished.value = false;
  error.value = false;
  await loadMore();
  refreshing.value = false;
}

function onRetry() {
  error.value = false;
  loadMore();
}

function onTypeChange() {
  // 切 tab 等价于刷新
  onRefresh();
}

function goDetail(id) {
  router.push(`/tasks/${id}`);
}

function onPublish() {
  if (!userStore.isLoggedIn) {
    showToast('请先登录');
    router.push({ name: 'login', query: { redirect: '/tasks/publish' } });
    return;
  }
  router.push('/tasks/publish');
}

// keep-alive 友好:每次回到这个页面都刷一次
onActivated(() => {
  // 回到页面时立即刷新一次
  if (tasks.value.length > 0) {
    refreshSilently();
  }
  // 每 30 秒自动刷新
  refreshTimer = setInterval(refreshSilently, 30 * 1000);
});

onDeactivated(() => {
  // 离开页面停止刷新
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

async function refreshSilently() {
  try {
    const params = { limit: PAGE_SIZE, offset: 0 };
    if (activeType.value !== 'all') params.type = activeType.value;
    const res = await api.get('/tasks', { params });
    if (res.ok) {
      // 直接替换整个列表,确保新任务、名额变化都能看到
      tasks.value = res.tasks;
      offset.value = res.tasks.length;
      finished.value = res.tasks.length < PAGE_SIZE;
    }
  } catch {}
}
</script>

<style scoped>
.tasks-page {
  min-height: 100vh;
  background: var(--page-bg);
  padding-bottom: 70px;  /* tabbar 50 + spacing */
}

.list-wrap {
  min-height: calc(100vh - 90px);  /* nav 46 + tabs 44 */
}

.task-card {
  display: flex;
  gap: 12px;
  margin: 12px;
  padding: 12px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.04));
  cursor: pointer;
  transition: transform 0.15s ease;
  border: 1.5px solid var(--divider);
}
.task-card:active {
  transform: scale(0.98);
}

/* 置顶卡片绿色呼吸光效 */
.task-card--pinned {
  border: 2px solid var(--color-primary);
  box-shadow: 0 0 12px rgba(52, 199, 89, 0.4), 0 0 24px rgba(52, 199, 89, 0.15);
  animation: green-glow 2s ease-in-out infinite;
}
@keyframes green-glow {
  0%, 100% {
    box-shadow: 0 0 8px rgba(52, 199, 89, 0.3), 0 0 20px rgba(52, 199, 89, 0.1);
  }
  50% {
    box-shadow: 0 0 16px rgba(52, 199, 89, 0.6), 0 0 32px rgba(52, 199, 89, 0.25);
  }
}

.cover-wrap {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  background: #f0f0f0;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  background: linear-gradient(135deg, #f5f5f5, #e8e8e8);
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.song-name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.type-tag {
  flex-shrink: 0;
  font-size: 10px;
}
.welfare-tag {
  flex-shrink: 0;
  font-size: 10px;
}

.interact-row {
  display: flex;
  gap: 10px;
  margin: 2px 0;
}
.interact-item {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.artist {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-regular);
  margin-bottom: 4px;
}
.reward {
  color: var(--color-primary-dark);
}
.reward strong {
  font-size: 14px;
}
.quota {
  color: var(--color-text-secondary);
}

.bottom-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-disabled);
}
.publisher {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

/* 置顶金色流光效果 */
.pin-icon {
  margin-right: 2px;
}
.golden-shimmer {
  background: linear-gradient(
    90deg,
    #bf953f, #fcf6ba, #b38728, #fbf5b7, #aa771c, #fcf6ba, #bf953f
  );
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: golden-flow 3s ease-in-out infinite;
  font-weight: 800;
}
@keyframes golden-flow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
</style>
