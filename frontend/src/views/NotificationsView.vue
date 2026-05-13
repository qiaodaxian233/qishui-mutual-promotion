<template>
  <div class="notify-page">
    <van-nav-bar title="消息通知" left-arrow @click-left="$router.back()">
      <template #right>
        <span v-if="items.length > 0" class="read-all" @click="onReadAll">全部已读</span>
      </template>
    </van-nav-bar>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <van-list v-model:loading="loading" :finished="finished" finished-text="—— 到底了 ——" @load="loadMore">
        <div
          v-for="item in items"
          :key="item.id"
          class="notify-item"
          :class="{ unread: !item.is_read }"
          @click="onTap(item)"
        >
          <span class="notify-icon">{{ iconMap[item.type] || '📢' }}</span>
          <div class="notify-body">
            <span class="notify-title">{{ item.title }}</span>
            <span class="notify-content">{{ item.content }}</span>
            <span class="notify-time">{{ relativeTime(item.created_at) }}</span>
          </div>
          <span v-if="!item.is_read" class="dot"></span>
        </div>

        <van-empty v-if="!loading && items.length === 0 && finished" description="暂无消息" image-size="100" />
      </van-list>
    </van-pull-refresh>
  </div>
</template>

<script setup>
defineOptions({ name: 'NotificationsView' });
import { ref } from 'vue';
import api from '@/api';

const items = ref([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const offset = ref(0);

const iconMap = {
  task_claimed: '📥',
  verify_passed: '✅',
  verify_failed: '❌',
  points_awarded: '💰',
  task_expired: '⏰',
  task_cancelled: '🚫',
  claim_timeout: '⏱️',
  system: '📢'
};

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

async function loadMore() {
  try {
    const res = await api.get('/notifications', { params: { limit: 20, offset: offset.value } });
    if (res.ok) {
      items.value.push(...res.items);
      offset.value += res.items.length;
      if (res.items.length < 20) finished.value = true;
    }
  } catch {} finally { loading.value = false; }
}

function onRefresh() {
  items.value = []; offset.value = 0; finished.value = false;
  loadMore().then(() => { refreshing.value = false; });
}

async function onTap(item) {
  if (!item.is_read) {
    try { await api.post('/notifications/read', { id: item.id }); } catch {}
    item.is_read = 1;
  }
  if (item.ref_type === 'task') window.location.href = `/tasks/${item.ref_id}`;
}

async function onReadAll() {
  try { await api.post('/notifications/read'); } catch {}
  items.value.forEach(i => { i.is_read = 1; });
}
</script>

<style scoped>
.notify-page { min-height: 100vh; background: var(--page-bg); }
.read-all { font-size: 13px; color: var(--color-primary-dark); }
.notify-item { display: flex; gap: 10px; padding: 14px 16px; background: var(--card-bg); border-bottom: 1px solid var(--divider); position: relative; }
.notify-item.unread { background: rgba(26,254,73,.04); }
.notify-icon { font-size: 22px; flex-shrink: 0; margin-top: 2px; }
.notify-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.notify-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.notify-content { font-size: 13px; color: var(--color-text-regular); line-height: 1.4; }
.notify-time { font-size: 11px; color: var(--color-text-disabled); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4d4f; flex-shrink: 0; margin-top: 6px; }
</style>
