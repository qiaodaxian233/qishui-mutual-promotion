<template>
  <div class="points-page">
    <van-nav-bar title="积分明细" left-arrow @click-left="$router.back()" />

    <!-- 余额卡 -->
    <section class="balance-card">
      <div class="bal-main">
        <span class="bal-num">{{ userStore.user?.points ?? '—' }}</span>
        <span class="bal-label">当前积分</span>
      </div>
      <div class="bal-actions">
        <van-button round size="small" type="primary" @click="$router.push('/tasks/publish')">
          去发布
        </van-button>
        <van-button round size="small" plain @click="$router.push('/tasks')">
          去接单
        </van-button>
      </div>
    </section>

    <!-- 流水列表 -->
    <section class="history-section">
      <h3 class="section-title">交易记录</h3>
      <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="——  到底了  ——"
          @load="loadMore"
        >
          <div v-for="item in items" :key="item.id" class="log-item">
            <div class="log-left">
              <span class="log-icon" :class="item.delta > 0 ? 'log-icon--in' : 'log-icon--out'">
                {{ item.delta > 0 ? '↓' : '↑' }}
              </span>
              <div class="log-info">
                <span class="log-note">{{ formatNote(item) }}</span>
                <span class="log-time">{{ formatTime(item.created_at) }}</span>
              </div>
            </div>
            <div class="log-right">
              <span class="log-delta" :class="item.delta > 0 ? 'delta-in' : 'delta-out'">
                {{ item.delta > 0 ? '+' : '' }}{{ item.delta }}
              </span>
              <span class="log-balance">余 {{ item.balance_after }}</span>
            </div>
          </div>

          <van-empty
            v-if="!loading && items.length === 0 && finished"
            description="暂无积分记录"
            image-size="100"
          />
        </van-list>
      </van-pull-refresh>
    </section>
  </div>
</template>

<script setup>
defineOptions({ name: 'PointsView' });

import { ref, onMounted } from 'vue';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();

const items = ref([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const offset = ref(0);
const PAGE_SIZE = 20;

const TYPE_LABELS = {
  register_bonus: '注册赠送',
  task_publish: '发布任务',
  task_refund: '撤销退款',
  task_complete: '完成任务奖励',
  admin_adjust: '管理员调整'
};

function formatNote(item) {
  return item.note || TYPE_LABELS[item.type] || item.type;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadMore() {
  try {
    const res = await api.get('/points/history', { params: { limit: PAGE_SIZE, offset: offset.value } });
    if (res.ok) {
      items.value.push(...res.items);
      offset.value += res.items.length;
      if (res.items.length < PAGE_SIZE) finished.value = true;
    }
  } catch {} finally {
    loading.value = false;
  }
}

function onRefresh() {
  items.value = [];
  offset.value = 0;
  finished.value = false;
  loadMore().then(() => { refreshing.value = false; });
}

onMounted(() => {
  userStore.refreshMe();
});
</script>

<style scoped>
.points-page {
  min-height: 100vh;
  background: var(--page-bg);
}

/* 余额卡 */
.balance-card {
  margin: 12px;
  padding: 24px 16px;
  background: linear-gradient(135deg, #0EBA37 0%, #1AFE49 100%);
  border-radius: 14px;
  color: #fff;
  text-align: center;
  box-shadow: 0 4px 16px rgba(26, 254, 73, 0.3);
}
.bal-main { margin-bottom: 16px; }
.bal-num {
  display: block;
  font-size: 40px;
  font-weight: 800;
  line-height: 1.1;
  text-shadow: 0 2px 8px rgba(0,0,0,.1);
}
.bal-label {
  font-size: 13px;
  opacity: 0.85;
}
.bal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.bal-actions .van-button--primary {
  background: #fff !important;
  color: #0EBA37 !important;
  border-color: #fff !important;
}
.bal-actions .van-button--plain {
  color: #fff !important;
  border-color: rgba(255,255,255,.6) !important;
  background: transparent !important;
}

/* 流水 */
.section-title {
  margin: 0;
  padding: 16px 16px 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.log-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--divider);
}
.log-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.log-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}
.log-icon--in {
  background: rgba(26, 254, 73, 0.12);
  color: var(--color-primary-dark);
}
.log-icon--out {
  background: rgba(238, 10, 36, 0.08);
  color: var(--color-danger);
}
.log-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.log-note {
  font-size: 14px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-time {
  font-size: 11px;
  color: var(--color-text-disabled);
  margin-top: 2px;
}
.log-right {
  text-align: right;
  flex-shrink: 0;
  margin-left: 8px;
}
.log-delta {
  display: block;
  font-size: 16px;
  font-weight: 700;
}
.delta-in { color: var(--color-primary-dark); }
.delta-out { color: var(--color-danger); }
.log-balance {
  font-size: 11px;
  color: var(--color-text-disabled);
}
</style>
