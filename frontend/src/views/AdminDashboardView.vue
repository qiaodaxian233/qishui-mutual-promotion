<template>
  <div class="admin-page">
    <van-nav-bar title="🔧 管理后台" left-arrow @click-left="$router.back()" />

    <van-empty v-if="forbidden" description="需要管理员权限" image-size="120" />

    <template v-else>
      <!-- 快捷操作 -->
      <div class="quick-actions">
        <div class="action-btn" @click="$router.push('/admin/welfare')">
          <span class="action-icon">🎁</span>
          <span class="action-text">批量发布福利</span>
        </div>
        <div class="action-btn" @click="$router.push('/tasks/publish')">
          <span class="action-icon">📝</span>
          <span class="action-text">发布任务</span>
        </div>
        <div class="action-btn" @click="$router.push('/tasks')">
          <span class="action-icon">📋</span>
          <span class="action-text">任务广场</span>
        </div>
        <div class="action-btn" @click="$router.push('/notifications')">
          <span class="action-icon">🔔</span>
          <span class="action-text">消息通知</span>
        </div>
      </div>

      <van-tabs v-model:active="activeTab" sticky offset-top="46" shrink>
        <van-tab name="stats" title="数据统计" />
        <van-tab name="users" title="用户" />
        <van-tab name="tasks" title="任务" />
        <van-tab name="completions" title="接单" />
      </van-tabs>

      <!-- 数据统计 -->
      <div v-if="activeTab === 'stats'" class="tab-body">
        <div v-if="statsLoading" class="loading-hint">加载中…</div>
        <template v-else-if="stats">
          <!-- 总览卡片 -->
          <div class="stat-grid">
            <div class="stat-card">
              <span class="stat-num">{{ stats.users?.total || 0 }}</span>
              <span class="stat-label">总用户</span>
              <span class="stat-sub">今日 +{{ stats.users?.today_new || 0 }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-num">{{ stats.tasks?.total || 0 }}</span>
              <span class="stat-label">总任务</span>
              <span class="stat-sub">活跃 {{ stats.tasks?.active || 0 }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-num">{{ stats.completions?.total || 0 }}</span>
              <span class="stat-label">总接单</span>
              <span class="stat-sub">今日 +{{ stats.completions?.today_new || 0 }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-num">{{ stats.points?.total_earned || 0 }}</span>
              <span class="stat-label">积分流通</span>
              <span class="stat-sub">今日发放 {{ stats.points?.today_earned || 0 }}</span>
            </div>
          </div>

          <!-- 接单状态分布 -->
          <section class="detail-card">
            <h4>接单状态分布</h4>
            <div class="detail-row"><span>待完成</span><strong>{{ stats.completions?.claimed || 0 }}</strong></div>
            <div class="detail-row"><span>自动通过</span><strong>{{ stats.completions?.auto_passed || 0 }}</strong></div>
            <div class="detail-row"><span>自动拒绝</span><strong>{{ stats.completions?.auto_rejected || 0 }}</strong></div>
            <div class="detail-row"><span>已发放</span><strong>{{ stats.completions?.manual_passed || 0 }}</strong></div>
            <div class="detail-row"><span>回查失败</span><strong>{{ stats.completions?.recheck_failed || 0 }}</strong></div>
            <div class="detail-row"><span>超时</span><strong>{{ stats.completions?.timeout || 0 }}</strong></div>
          </section>

          <!-- 7 天趋势 -->
          <section class="detail-card">
            <h4>最近 7 天</h4>
            <div v-for="d in stats.charts?.dailyCompletions" :key="d.date" class="detail-row">
              <span>{{ d.date }}</span><strong>{{ d.count }} 单</strong>
            </div>
          </section>
        </template>
      </div>

      <!-- 用户管理 -->
      <div v-if="activeTab === 'users'" class="tab-body">
        <van-search v-model="userSearch" placeholder="搜邮箱/昵称" @search="loadUsers" />
        <div v-for="u in userList" :key="u.id" class="mgmt-card">
          <div class="mgmt-top">
            <strong>{{ u.nickname }}</strong>
            <van-tag :type="u.status === 'active' ? 'primary' : 'danger'" round size="medium">{{ u.status }}</van-tag>
            <van-tag v-if="u.role === 'admin'" type="warning" round size="medium">管理员</van-tag>
          </div>
          <div class="mgmt-meta">
            {{ u.email }} · 积分{{ u.points }} · 信用{{ u.credit_score }} · 发{{ u.task_count }}任务 · 接{{ u.completion_count }}单
          </div>
          <div class="mgmt-actions">
            <van-button size="mini" v-if="u.status === 'active'" @click="setUserStatus(u.id, 'frozen')">冻结</van-button>
            <van-button size="mini" v-if="u.status === 'frozen'" type="primary" @click="setUserStatus(u.id, 'active')">解冻</van-button>
            <van-button size="mini" v-if="u.role !== 'admin'" @click="setUserRole(u.id, 'admin')">设管理员</van-button>
            <van-button size="mini" v-if="u.role === 'admin'" @click="setUserRole(u.id, 'user')">取消管理员</van-button>
          </div>
        </div>
        <van-empty v-if="userList.length === 0" description="无结果" image-size="80" />
      </div>

      <!-- 任务管理 -->
      <div v-if="activeTab === 'tasks'" class="tab-body">
        <div class="filter-row">
          <span v-for="s in ['', 'active', 'expired', 'cancelled']" :key="s"
            class="filter-chip" :class="{ active: taskFilter === s }" @click="taskFilter = s; loadTasks()">
            {{ s || '全部' }}
          </span>
        </div>
        <div v-for="t in taskList" :key="t.id" class="mgmt-card">
          <div class="mgmt-top">
            <strong>{{ t.song_name }}</strong>
            <van-tag :type="t.is_welfare ? 'success' : 'default'" round size="medium">{{ t.is_welfare ? '福利' : t.status }}</van-tag>
          </div>
          <div class="mgmt-meta">
            {{ t.task_type }} · +{{ t.reward_points }}积分 · {{ t.quota_remaining }}/{{ t.quota_total }} · @{{ t.publisher_nickname }}
          </div>
        </div>
      </div>

      <!-- 接单管理 -->
      <div v-if="activeTab === 'completions'" class="tab-body">
        <div class="filter-row">
          <span v-for="s in ['', 'claimed', 'auto_passed', 'auto_rejected', 'manual_passed', 'recheck_failed', 'timeout']" :key="s"
            class="filter-chip" :class="{ active: compFilter === s }" @click="compFilter = s; loadCompletions()">
            {{ s || '全部' }}
          </span>
        </div>
        <div v-for="c in compList" :key="c.id" class="mgmt-card">
          <div class="mgmt-top">
            <strong>{{ c.song_name }}</strong>
            <van-tag round size="medium">{{ c.status }}</van-tag>
          </div>
          <div class="mgmt-meta">
            {{ c.task_type }} · @{{ c.claimer_nickname }} · {{ c.claimed_at?.slice(5, 16) }}
            {{ c.points_awarded ? `· 发放 ${c.points_awarded}` : '' }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
defineOptions({ name: 'AdminDashboardView' });
import { ref, onMounted, watch } from 'vue';
import { showFailToast, showSuccessToast } from 'vant';
import api from '@/api';

const forbidden = ref(false);
const activeTab = ref('stats');

// Stats
const stats = ref(null);
const statsLoading = ref(true);

// Users
const userSearch = ref('');
const userList = ref([]);

// Tasks
const taskFilter = ref('');
const taskList = ref([]);

// Completions
const compFilter = ref('');
const compList = ref([]);

async function loadStats() {
  statsLoading.value = true;
  try {
    const res = await api.get('/admin/stats');
    if (res.ok) stats.value = res;
  } catch (err) {
    if (err?.status === 403) forbidden.value = true;
  } finally { statsLoading.value = false; }
}

async function loadUsers() {
  try {
    const res = await api.get('/admin/users', { params: { search: userSearch.value, limit: 50 } });
    if (res.ok) userList.value = res.users;
  } catch (err) { if (err?.status === 403) forbidden.value = true; }
}

async function loadTasks() {
  try {
    const params = { limit: 50 };
    if (taskFilter.value) params.status = taskFilter.value;
    const res = await api.get('/admin/tasks', { params });
    if (res.ok) taskList.value = res.tasks;
  } catch {}
}

async function loadCompletions() {
  try {
    const params = { limit: 50 };
    if (compFilter.value) params.status = compFilter.value;
    const res = await api.get('/admin/completions', { params });
    if (res.ok) compList.value = res.completions;
  } catch {}
}

async function setUserStatus(id, status) {
  try {
    await api.post(`/admin/users/${id}/status`, { status });
    showSuccessToast('操作成功');
    loadUsers();
  } catch (err) { showFailToast(err?.error || '操作失败'); }
}

async function setUserRole(id, role) {
  try {
    await api.post(`/admin/users/${id}/role`, { role });
    showSuccessToast('操作成功');
    loadUsers();
  } catch (err) { showFailToast(err?.error || '操作失败'); }
}

watch(activeTab, (tab) => {
  if (tab === 'stats' && !stats.value) loadStats();
  if (tab === 'users' && userList.value.length === 0) loadUsers();
  if (tab === 'tasks' && taskList.value.length === 0) loadTasks();
  if (tab === 'completions' && compList.value.length === 0) loadCompletions();
});

onMounted(() => { loadStats(); });
</script>

<style scoped>
.admin-page { min-height: 100vh; background: var(--page-bg); padding-bottom: 30px; }
.tab-body { padding: 12px; }
.loading-hint { text-align: center; padding: 40px; color: var(--color-text-secondary); }

/* 快捷操作 */
.quick-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px;
}
.action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 4px;
  background: var(--card-bg);
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
  transition: transform .12s;
}
.action-btn:active { transform: scale(.95); }
.action-icon { font-size: 26px; }
.action-text { font-size: 11px; color: var(--color-text-primary); font-weight: 500; }

/* 统计网格 */
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.stat-card { background: var(--card-bg); border-radius: 10px; padding: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.stat-num { display: block; font-size: 26px; font-weight: 800; color: var(--color-primary-dark); }
.stat-label { font-size: 12px; color: var(--color-text-secondary); }
.stat-sub { font-size: 11px; color: var(--color-text-disabled); display: block; margin-top: 2px; }

.detail-card { background: var(--card-bg); border-radius: 10px; padding: 14px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.detail-card h4 { margin: 0 0 8px; font-size: 14px; color: var(--color-text-primary); }
.detail-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: var(--color-text-regular); }

/* 管理卡片 */
.mgmt-card { background: var(--card-bg); border-radius: 10px; padding: 12px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.mgmt-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.mgmt-meta { font-size: 12px; color: var(--color-text-secondary); margin-bottom: 6px; }
.mgmt-actions { display: flex; gap: 6px; }

/* 筛选 */
.filter-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.filter-chip { padding: 4px 10px; font-size: 12px; border-radius: 14px; border: 1px solid var(--divider); color: var(--color-text-regular); cursor: pointer; }
.filter-chip.active { background: rgba(26,254,73,.12); border-color: var(--color-primary-dark); color: var(--color-primary-dark); font-weight: 600; }
</style>
