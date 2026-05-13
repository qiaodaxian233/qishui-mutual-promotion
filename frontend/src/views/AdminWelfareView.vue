<template>
  <div class="admin-page">
    <van-nav-bar title="🎁 新手福利发布" left-arrow @click-left="$router.back()" />

    <!-- 权限不足提示 -->
    <van-empty v-if="forbidden" description="需要管理员权限" image-size="120" />

    <template v-else>
      <!-- 全局设置 -->
      <section class="config-card">
        <h3 class="card-title">任务参数（统一设置）</h3>

        <div class="form-row">
          <span class="form-label">任务类型</span>
          <div class="type-chips">
            <span
              v-for="t in typeOptions"
              :key="t.value"
              class="chip"
              :class="{ 'chip--active': taskType === t.value }"
              @click="taskType = t.value"
            >{{ t.label }}</span>
          </div>
        </div>

        <div class="form-row">
          <span class="form-label">单次奖励积分</span>
          <van-stepper v-model="reward" :min="1" :max="50" integer theme="round" />
        </div>

        <div class="form-row">
          <span class="form-label">每首歌名额</span>
          <van-stepper v-model="quota" :min="5" :max="999" integer theme="round" />
        </div>

        <div v-if="taskType === 'listen'" class="form-row">
          <span class="form-label">最少播放秒数</span>
          <van-stepper v-model="minListenSec" :min="15" :max="300" :step="5" integer theme="round" />
        </div>
      </section>

      <!-- 分享文案输入 -->
      <section class="input-card">
        <h3 class="card-title">粘贴分享文案（每行一首歌）</h3>
        <p class="card-hint">
          从汽水音乐复制分享文案，每首歌一行。最多 20 首。
        </p>
        <van-field
          v-model="shareTexts"
          type="textarea"
          rows="8"
          maxlength="10000"
          show-word-limit
          placeholder="分享文案1（包含汽水链接）&#10;分享文案2&#10;分享文案3&#10;..."
          :disabled="publishing"
        />
        <p class="parse-info">
          已识别 <strong>{{ parsedCount }}</strong> 首歌
        </p>
      </section>

      <!-- 发布按钮 -->
      <div class="action-area">
        <van-button
          block
          type="primary"
          round
          size="large"
          :loading="publishing"
          loading-text="正在批量发布…"
          :disabled="parsedCount === 0"
          @click="onBatchPublish"
        >
          🎁 一键发布 {{ parsedCount }} 个福利任务
        </van-button>
      </div>

      <!-- 发布结果 -->
      <section v-if="results.length > 0" class="result-card">
        <h3 class="card-title">发布结果</h3>
        <div class="result-summary">
          <span class="ok-count">✅ 成功 {{ successCount }}</span>
          <span v-if="failCount > 0" class="fail-count">❌ 失败 {{ failCount }}</span>
        </div>
        <div v-for="r in results" :key="r.index" class="result-item">
          <span class="result-status">{{ r.ok ? '✅' : '❌' }}</span>
          <div class="result-body">
            <span v-if="r.ok" class="result-song">
              {{ r.song?.name }} — {{ r.song?.artist }}
            </span>
            <span v-else class="result-error">{{ r.error }}</span>
            <span class="result-text">{{ r.shareText }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
defineOptions({ name: 'AdminWelfareView' });

import { ref, computed } from 'vue';
import { showToast, showFailToast, showSuccessToast } from 'vant';
import api from '@/api';

const forbidden = ref(false);

const taskType = ref('like');
const reward = ref(5);
const quota = ref(50);
const minListenSec = ref(30);
const shareTexts = ref('');
const publishing = ref(false);
const results = ref([]);

const typeOptions = [
  { value: 'like',    label: '❤️ 点赞' },
  { value: 'listen',  label: '🎧 播放' },
  { value: 'comment', label: '💬 评论' },
  { value: 'share',   label: '🔗 分享' }
];

// 按行切分,过滤空行
const parsedLines = computed(() => {
  return shareTexts.value
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 10); // 至少 10 字符才算有效行
});

const parsedCount = computed(() => Math.min(parsedLines.value.length, 20));

const successCount = computed(() => results.value.filter(r => r.ok).length);
const failCount = computed(() => results.value.filter(r => !r.ok).length);

async function onBatchPublish() {
  if (parsedCount.value === 0) {
    showFailToast('请先粘贴分享文案');
    return;
  }

  publishing.value = true;
  results.value = [];

  try {
    const tasks = parsedLines.value.slice(0, 20).map(shareText => ({
      shareText,
      taskType: taskType.value,
      reward: reward.value,
      quota: quota.value,
      minListenSec: taskType.value === 'listen' ? minListenSec.value : undefined
    }));

    const res = await api.post('/admin/welfare/batch', { tasks });

    if (res.ok) {
      results.value = res.results;
      showSuccessToast(res.message);
    } else {
      showFailToast(res.error || '发布失败');
    }
  } catch (err) {
    if (err?.status === 403 || err?.error?.includes('管理员')) {
      forbidden.value = true;
    }
    showFailToast(err?.error || '发布失败');
  } finally {
    publishing.value = false;
  }
}
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  background: var(--page-bg);
  padding-bottom: 40px;
}

.config-card, .input-card, .result-card {
  margin: 12px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}

.card-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.card-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--divider);
}
.form-label {
  font-size: 14px;
  color: var(--color-text-primary);
}

.type-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 16px;
  border: 1px solid var(--divider);
  color: var(--color-text-regular);
  cursor: pointer;
  transition: all .15s;
}
.chip--active {
  background: rgba(26,254,73,.12);
  border-color: var(--color-primary-dark);
  color: var(--color-primary-dark);
  font-weight: 600;
}

.parse-info {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.action-area {
  padding: 16px 12px;
}

/* 结果 */
.result-summary {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 600;
}
.ok-count { color: var(--color-primary-dark); }
.fail-count { color: var(--color-danger); }

.result-item {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
}
.result-status { font-size: 16px; flex-shrink: 0; }
.result-body { flex: 1; min-width: 0; }
.result-song {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.result-error {
  display: block;
  font-size: 13px;
  color: var(--color-danger);
}
.result-text {
  display: block;
  font-size: 11px;
  color: var(--color-text-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
</style>
