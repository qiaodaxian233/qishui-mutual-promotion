<template>
  <div class="publish-page">
    <van-nav-bar
      title="发布任务"
      left-arrow
      @click-left="onBack"
    />

    <!-- Step 1: 粘贴分享文案 -->
    <section v-if="step === 1" class="step-card">
      <h3 class="card-title">第一步:粘贴汽水分享文案</h3>
      <p class="card-hint">
        打开汽水音乐 → 选歌 → 分享 → 复制链接,然后粘贴到下方
      </p>
      <van-field
        v-model="shareText"
        type="textarea"
        rows="4"
        maxlength="2000"
        show-word-limit
        placeholder="粘贴汽水音乐分享文案…"
        :disabled="previewing"
      />
      <van-button
        block
        type="primary"
        round
        :loading="previewing"
        loading-text="解析中…"
        class="mt-16"
        @click="onPreview"
      >
        解析歌曲
      </van-button>
    </section>

    <!-- Step 2: 预览 + 设置参数 -->
    <template v-if="step === 2 && previewData">
      <!-- 歌曲预览卡 -->
      <section class="song-preview-card">
        <div class="cover-wrap">
          <img
            v-if="previewData.song.cover"
            :src="previewData.song.cover"
            :alt="previewData.song.name"
            class="cover-img"
          />
          <div v-else class="cover-fallback">🎵</div>
        </div>
        <div class="song-info">
          <h2 class="song-name">{{ previewData.song.name }}</h2>
          <p class="artist">{{ previewData.song.artist }}</p>
          <p v-if="previewData.song.duration" class="duration">
            {{ formatDuration(previewData.song.duration) }}
          </p>
        </div>
      </section>

      <!-- 警告 -->
      <van-notice-bar
        v-if="previewData.warnings && previewData.warnings.length"
        :text="previewData.warnings.join(' | ')"
        left-icon="info-o"
        wrapable
        class="warn-bar"
      />

      <!-- 任务参数表单 -->
      <section class="form-card">
        <h3 class="card-title">任务设置</h3>

        <!-- 任务类型 -->
        <div class="form-row">
          <span class="form-label">任务类型</span>
          <div class="type-chips">
            <span
              v-for="t in typeOptions"
              :key="t.value"
              class="chip"
              :class="{ 'chip--active': taskType === t.value }"
              @click="taskType = t.value"
            >
              {{ t.label }}
            </span>
          </div>
        </div>

        <!-- 单个积分 -->
        <div class="form-row">
          <span class="form-label">单个奖励积分</span>
          <van-stepper
            v-model="reward"
            :min="currentTypeCfg.minReward"
            :max="currentTypeCfg.maxReward"
            integer
            theme="round"
          />
        </div>
        <p class="form-hint">
          范围 {{ currentTypeCfg.minReward }}~{{ currentTypeCfg.maxReward }}
        </p>

        <!-- 名额 -->
        <div class="form-row">
          <span class="form-label">招募名额</span>
          <van-stepper
            v-model="quota"
            :min="1"
            :max="1000"
            integer
            theme="round"
          />
        </div>

        <!-- 播放秒数(listen 类型才显示) -->
        <div v-if="taskType === 'listen'" class="form-row">
          <span class="form-label">最少播放秒数</span>
          <van-stepper
            v-model="minListenSec"
            :min="15"
            :max="maxListenSec"
            :step="5"
            integer
            theme="round"
          />
        </div>

        <!-- 费用预估 -->
        <div class="cost-card">
          <div class="cost-row">
            <span>奖励小计</span>
            <span>{{ reward }} × {{ quota }} = {{ reward * quota }} 积分</span>
          </div>
          <div class="cost-row">
            <span>平台手续费 (10%)</span>
            <span>{{ platformFee }} 积分</span>
          </div>
          <div class="cost-row cost-row--total">
            <span>合计扣除</span>
            <strong>{{ totalCost }} 积分</strong>
          </div>
          <p v-if="userStore.user" class="balance-hint">
            你当前有 <strong>{{ userStore.user.points }}</strong> 积分
            <span v-if="userStore.user.points < totalCost" class="text-danger">
              (不足)
            </span>
          </p>
        </div>

        <van-button
          block
          type="primary"
          round
          :loading="publishing"
          loading-text="发布中…"
          :disabled="userStore.user && userStore.user.points < totalCost"
          class="mt-16"
          @click="onPublish"
        >
          确认发布（扣 {{ totalCost }} 积分）
        </van-button>

        <van-button
          block
          plain
          round
          size="small"
          class="mt-8"
          @click="step = 1"
        >
          返回修改
        </van-button>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { showToast, showFailToast, showSuccessToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const step = ref(1);

// Step 1
const shareText = ref('');
const previewing = ref(false);
const previewData = ref(null);

// Step 2
const taskType = ref('like');
const reward = ref(5);
const quota = ref(10);
const minListenSec = ref(30);
const publishing = ref(false);

const typeOptions = [
  { value: 'like',    label: '❤️ 点赞' },
  { value: 'listen',  label: '🎧 播放' },
  { value: 'comment', label: '💬 评论' },
  { value: 'share',   label: '🔗 分享' }
];

const TYPE_CONFIG = {
  like:    { minReward: 1, maxReward: 20 },
  listen:  { minReward: 1, maxReward: 30 },
  comment: { minReward: 3, maxReward: 50 },
  share:   { minReward: 2, maxReward: 30 }
};

const currentTypeCfg = computed(() => TYPE_CONFIG[taskType.value]);

const maxListenSec = computed(() => {
  if (previewData.value?.song?.duration) {
    return Math.min(600, previewData.value.song.duration);
  }
  return 600;
});

const platformFee = computed(() => Math.ceil(reward.value * quota.value * 0.1));
const totalCost = computed(() => reward.value * quota.value + platformFee.value);

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function onPreview() {
  const text = shareText.value.trim();
  if (!text) {
    showFailToast('请粘贴分享文案');
    return;
  }
  previewing.value = true;
  try {
    const res = await api.post('/tasks/preview', { shareText: text });
    if (!res.ok) {
      showFailToast(res.error || '解析失败');
      return;
    }
    previewData.value = res;
    step.value = 2;
  } catch (err) {
    showFailToast(err?.error || '解析失败,请检查分享文案格式');
  } finally {
    previewing.value = false;
  }
}

async function onPublish() {
  publishing.value = true;
  try {
    const body = {
      shareText: shareText.value.trim(),
      taskType: taskType.value,
      reward: reward.value,
      quota: quota.value
    };
    if (taskType.value === 'listen') {
      body.minListenSec = minListenSec.value;
    }
    const res = await api.post('/tasks', body);
    if (!res.ok) {
      showFailToast(res.error || '发布失败');
      return;
    }
    showSuccessToast('发布成功！');
    await userStore.refreshMe();
    setTimeout(() => {
      router.replace(`/tasks/${res.taskId}`);
    }, 1200);
  } catch (err) {
    showFailToast(err?.error || '发布失败');
  } finally {
    publishing.value = false;
  }
}

function onBack() {
  if (step.value === 2) {
    step.value = 1;
  } else if (window.history.length > 1) {
    router.back();
  } else {
    router.replace('/tasks');
  }
}
</script>

<style scoped>
.publish-page {
  min-height: 100vh;
  background: var(--page-bg);
  padding-bottom: 40px;
}

.step-card,
.form-card,
.song-preview-card {
  margin: 12px;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.card-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.card-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

/* 歌曲预览 */
.song-preview-card {
  display: flex;
  gap: 14px;
}
.cover-wrap {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
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
  font-size: 36px;
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
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist {
  margin: 0 0 2px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.duration {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-disabled);
}

.warn-bar {
  margin: 0 12px;
  border-radius: 8px;
}

/* 表单 */
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
.form-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-disabled);
}

/* 类型 chips */
.type-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 16px;
  border: 1px solid var(--divider);
  color: var(--color-text-regular);
  cursor: pointer;
  transition: all 0.15s;
}
.chip--active {
  background: rgba(26, 254, 73, 0.12);
  border-color: var(--color-primary-dark);
  color: var(--color-primary-dark);
  font-weight: 600;
}

/* 费用 */
.cost-card {
  margin-top: 16px;
  padding: 12px;
  background: var(--page-bg);
  border-radius: 8px;
}
.cost-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--color-text-regular);
  padding: 4px 0;
}
.cost-row--total {
  border-top: 1px solid var(--divider);
  margin-top: 6px;
  padding-top: 8px;
  color: var(--color-text-primary);
  font-size: 14px;
}
.balance-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.text-danger {
  color: var(--color-danger);
}

.mt-8  { margin-top: 8px; }
.mt-16 { margin-top: 16px; }
</style>
