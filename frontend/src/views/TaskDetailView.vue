<template>
  <div class="detail-page">
    <van-nav-bar
      :title="task ? '任务详情' : '加载中…'"
      left-arrow
      @click-left="onBack"
    />

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-block">
      <van-loading type="spinner" size="24" color="#0EBA37">
        加载中…
      </van-loading>
    </div>

    <!-- 错误状态 -->
    <van-empty
      v-else-if="loadError"
      :description="loadError"
      image-size="120"
    >
      <van-button round size="small" plain @click="loadTask">重试</van-button>
    </van-empty>

    <!-- 详情内容 -->
    <template v-else-if="task">
      <!-- 顶部:歌曲信息卡 -->
      <section class="song-card">
        <div class="cover-wrap">
          <img
            v-if="task.cover_url && !coverError"
            :src="task.cover_url"
            :alt="task.song_name"
            class="cover-img"
            @error="coverError = true"
          />
          <div v-else class="cover-fallback">🎵</div>
        </div>
        <div class="song-info">
          <h1 class="song-name">{{ task.song_name }}</h1>
          <p class="artist">{{ task.artist_name }}</p>
          <p class="duration" v-if="task.duration_sec">
            {{ formatDuration(task.duration_sec) }}
          </p>
        </div>
      </section>

      <!-- 任务信息卡 -->
      <section class="task-card">
        <h3 class="card-title">任务信息</h3>

        <div class="info-row">
          <span class="info-label">类型</span>
          <van-tag :type="typeMeta.tagType" round plain>{{ typeMeta.label }}</van-tag>
        </div>
        <div class="info-row">
          <span class="info-label">奖励</span>
          <span class="info-value reward-val">
            +{{ task.reward_points }} 积分/次
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">剩余名额</span>
          <span class="info-value">
            <strong>{{ task.quota_remaining }}</strong>
            / {{ task.quota_total }}
          </span>
        </div>
        <div v-if="task.min_listen_sec" class="info-row">
          <span class="info-label">最少听</span>
          <span class="info-value">{{ task.min_listen_sec }} 秒</span>
        </div>
        <div class="info-row">
          <span class="info-label">截止时间</span>
          <span class="info-value">{{ formatDateTime(task.expires_at) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">发布者</span>
          <span class="info-value">@{{ task.publisher_nickname }}</span>
        </div>
      </section>

      <!-- 分享链接 -->
      <section class="link-card">
        <h3 class="card-title">汽水分享链接</h3>
        <div class="link-row">
          <span class="link-text">{{ task.share_link }}</span>
          <van-button
            size="small"
            type="primary"
            plain
            @click="copyLink"
          >
            {{ copied ? '✓ 已复制' : '复制' }}
          </van-button>
        </div>
        <p class="link-hint">
          复制后到汽水音乐 App 打开,完成{{ typeMeta.label }}操作
        </p>
      </section>

      <!-- 接单操作步骤说明 -->
      <section class="steps-card">
        <h3 class="card-title">怎么接单</h3>
        <ol class="steps">
          <li>点击下方「接单」按钮锁定名额</li>
          <li>点「复制」拿到分享链接,到汽水音乐 App 完成{{ typeMeta.label }}</li>
          <li>回到本页点「我做完了」,服务端会自动验证</li>
          <li>验证通过 24 小时后(防撤销)发放 {{ task.reward_points }} 积分</li>
        </ol>
      </section>

      <!-- 底部固定操作栏 -->
      <div class="action-bar">
        <van-button
          v-if="isOwnTask"
          block
          plain
          @click="onCancelTask"
        >
          撤销我发布的任务
        </van-button>
        <van-button
          v-else-if="task.quota_remaining === 0"
          block
          disabled
        >
          已招满
        </van-button>
        <van-button
          v-else
          block
          type="primary"
          @click="onClaim"
        >
          接单(锁定名额 + 30 分钟内完成)
        </van-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showFailToast, showConfirmDialog } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const task = ref(null);
const loading = ref(true);
const loadError = ref('');
const coverError = ref(false);
const copied = ref(false);

const typeMeta = computed(() => {
  if (!task.value) return { label: '', tagType: 'default' };
  const map = {
    like:    { label: '点赞', tagType: 'primary' },
    listen:  { label: '播放', tagType: 'success' },
    comment: { label: '评论', tagType: 'warning' },
    share:   { label: '分享', tagType: 'danger' }
  };
  return map[task.value.task_type] || { label: task.value.task_type, tagType: 'default' };
});

const isOwnTask = computed(() => {
  if (!task.value || !userStore.user) return false;
  return task.value.publisher_id === userStore.user.id;
});

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadTask() {
  loading.value = true;
  loadError.value = '';
  try {
    const id = route.params.id;
    const res = await api.get(`/tasks/${id}`);
    if (!res.ok) {
      loadError.value = res.error || '加载失败';
      return;
    }
    task.value = res.task;
  } catch (err) {
    loadError.value = err?.error || '加载失败,请稍后再试';
  } finally {
    loading.value = false;
  }
}

async function copyLink() {
  if (!task.value?.share_link) return;
  try {
    // 现代 API(需要 HTTPS 或 localhost)
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(task.value.share_link);
    } else {
      // 降级:execCommand(HTTP 环境可用)
      const textArea = document.createElement('textarea');
      textArea.value = task.value.share_link;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    copied.value = true;
    showToast({ message: '已复制,去汽水 App 粘贴打开', type: 'success' });
    setTimeout(() => { copied.value = false; }, 3000);
  } catch (err) {
    showFailToast('复制失败,请手动选中链接复制');
  }
}

function onClaim() {
  if (!userStore.isLoggedIn) {
    showToast('请先登录');
    router.push({ name: 'login', query: { redirect: `/tasks/${route.params.id}` } });
    return;
  }
  // 接单功能在阶段 5.5 实现(后端 /api/tasks/:id/claim 已就绪)
  showToast('接单功能(阶段 5.5)即将上线');
}

async function onCancelTask() {
  try {
    await showConfirmDialog({
      title: '确认撤销',
      message: '撤销后会按剩余比例退还积分,已被接单且完成的部分不退',
      confirmButtonText: '撤销',
      cancelButtonText: '再想想'
    });
  } catch {
    // 用户取消
    return;
  }
  try {
    const res = await api.post(`/tasks/${route.params.id}/cancel`);
    if (!res.ok) {
      showFailToast(res.error || '撤销失败');
      return;
    }
    showToast({
      message: `✓ 已撤销,退还 ${res.refund} 积分`,
      type: 'success'
    });
    // 刷新用户积分 + 回任务广场
    await userStore.refreshMe();
    setTimeout(() => router.replace('/tasks'), 1500);
  } catch (err) {
    showFailToast(err?.error || '撤销失败');
  }
}

function onBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.replace('/tasks');
  }
}

onMounted(() => {
  loadTask();
});
</script>

<style scoped>
.detail-page {
  min-height: 100vh;
  background: var(--page-bg);
  padding-bottom: 80px;  /* 给底部 action-bar 留空 */
}

.loading-block {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

/* 歌曲信息卡 */
.song-card {
  display: flex;
  gap: 16px;
  margin: 12px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.cover-wrap {
  flex-shrink: 0;
  width: 96px;
  height: 96px;
  border-radius: 10px;
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
  font-size: 40px;
  background: linear-gradient(135deg, #f5f5f5, #e8e8e8);
}

.song-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.song-name {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
  /* 长歌名截断 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.artist {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--color-text-regular);
}
.duration {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* 通用卡片 */
.task-card, .link-card, .steps-card {
  margin: 12px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
}
.info-row:last-child {
  border-bottom: none;
}
.info-label {
  font-size: 13px;
  color: var(--color-text-secondary);
}
.info-value {
  font-size: 14px;
  color: var(--color-text-primary);
}
.reward-val {
  color: var(--color-primary-dark);
  font-weight: 600;
}

/* 链接卡 */
.link-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px;
  background: var(--page-bg);
  border-radius: 8px;
  margin-bottom: 8px;
}
.link-text {
  flex: 1;
  font-size: 12px;
  color: var(--color-text-regular);
  word-break: break-all;
  font-family: 'SF Mono', Consolas, Menlo, monospace;
}
.link-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* 步骤卡 */
.steps {
  margin: 0;
  padding-left: 24px;
  color: var(--color-text-regular);
  font-size: 13px;
  line-height: 1.7;
}
.steps li {
  margin-bottom: 4px;
}

/* 底部固定操作栏 */
.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 16px env(safe-area-inset-bottom, 12px);
  background: var(--card-bg);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
  z-index: 100;
}
/* 桌面端居中跟 app-root 一致 */
@media (min-width: 768px) {
  .action-bar {
    max-width: 480px;
    margin: 0 auto;
    left: 50%;
    transform: translateX(-50%);
  }
}
</style>
