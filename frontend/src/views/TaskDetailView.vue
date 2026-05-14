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
        <div class="card-header-row">
          <h3 class="card-title">任务信息</h3>
          <van-button
            v-if="isOwnTask && task.status === 'active'"
            size="mini"
            plain
            type="primary"
            @click="openEditDialog"
          >✏️ 编辑</van-button>
        </div>

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
          <a
            :href="task.share_link"
            target="_blank"
            rel="noopener"
            class="link-text link-clickable"
          >{{ task.share_link }}</a>
          <van-button
            size="small"
            type="primary"
            plain
            @click.stop="copyLink"
          >
            {{ copied ? '✓ 已复制' : '复制' }}
          </van-button>
        </div>
        <a
          :href="task.share_link"
          target="_blank"
          rel="noopener"
          class="open-btn"
        >
          🎵 打开汽水音乐
        </a>
        <p class="link-hint">
          点击上方按钮直接跳转，或复制链接到汽水音乐 App 打开
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

      <!-- 接单后的操作提示 -->
      <section v-if="claimResult && !submitResult" class="claim-card">
        <h3 class="card-title">✅ 已接单,请完成任务</h3>
        <p class="claim-tip">{{ claimResult.tip }}</p>
        <a
          :href="claimResult.shareLink"
          target="_blank"
          rel="noopener"
          class="open-btn"
        >
          🎵 打开汽水音乐完成任务
        </a>
        <div class="link-row">
          <a
            :href="claimResult.shareLink"
            target="_blank"
            rel="noopener"
            class="link-text link-clickable"
          >{{ claimResult.shareLink }}</a>
          <van-button size="small" type="primary" plain @click.stop="copyLink">
            {{ copied ? '✓ 已复制' : '复制' }}
          </van-button>
        </div>

        <!-- 截图上传区 -->
        <div class="upload-section">
          <h4 class="upload-title">📸 上传完成截图</h4>
          <p class="upload-hint">
            请在汽水音乐完成操作后,截图上传作为凭证
          </p>

          <!-- 预览 / 上传按钮 -->
          <div class="upload-area" @click="triggerUpload">
            <template v-if="screenshotPreview">
              <img :src="screenshotPreview" class="preview-img" alt="截图预览" />
              <span class="change-btn">更换截图</span>
            </template>
            <template v-else>
              <van-icon name="photograph" size="36" color="#ccc" />
              <span class="upload-text">点击上传截图</span>
              <span class="upload-formats">支持 JPG/PNG/WebP/HEIC · 10MB 以内</span>
            </template>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            style="display:none"
            @change="onFileSelect"
          />
        </div>
      </section>

      <!-- 提交结果 -->
      <section v-if="submitResult" class="submit-result-card">
        <div v-if="submitResult.ok" class="result-ok">
          <span class="result-emoji">🎉</span>
          <h3>验证通过</h3>
          <p>{{ submitResult.message }}</p>
        </div>
        <div v-else class="result-fail">
          <span class="result-emoji">😥</span>
          <h3>验证未通过</h3>
          <p>{{ submitResult.error }}</p>
          <van-button
            v-if="!submitResult.noRetry"
            round
            type="primary"
            size="small"
            class="retry-btn"
            @click="onRetry"
          >
            重新提交
          </van-button>
        </div>
      </section>

      <!-- 编辑任务弹窗 -->
      <van-dialog
        v-model:show="editDialog.show"
        title="编辑任务"
        show-cancel-button
        @confirm="onSaveEdit"
      >
        <div style="padding: 16px">
          <van-field v-model="editDialog.reward" type="number" label="奖励积分" placeholder="每次奖励" />
          <van-field v-model="editDialog.quota" type="number" label="总名额" placeholder="招募名额" />
          <van-field v-model="editDialog.expireDays" type="number" label="延期天数" placeholder="从现在起延期几天" />
        </div>
      </van-dialog>

      <!-- 底部固定操作栏 -->
      <div class="action-bar">
        <!-- 已提交结果:回任务广场 -->
        <van-button
          v-if="submitResult"
          block
          type="primary"
          @click="$router.replace('/tasks')"
        >
          回到任务广场
        </van-button>
        <!-- 自己发布的 -->
        <template v-else-if="isOwnTask">
          <div class="owner-actions">
            <template v-if="task.status === 'active' && (!task.pin_type || task.pin_type === 'none')">
              <van-button block round type="warning" :loading="pinning" @click="onPin('normal')">
                ✨ 金色置顶（50 积分）
              </van-button>
              <van-button block round color="#ff00ff" :loading="pinning" @click="onPin('rainbow')">
                🌈 七彩置顶（100 积分）
              </van-button>
              <van-button block round color="linear-gradient(90deg, #ff0000, #ff7700, #00ff00, #0099ff, #6633ff)" :loading="pinning" @click="onPin('super')">
                👑 超级置顶（500 积分）· 最顶部
              </van-button>
            </template>
            <template v-else-if="task.status === 'active' && task.pin_type === 'normal'">
              <van-button block round color="#ff00ff" :loading="pinning" @click="onPin('rainbow')">
                🌈 升级七彩（100 积分）
              </van-button>
              <van-button block round color="linear-gradient(90deg, #ff0000, #ff7700, #00ff00, #0099ff, #6633ff)" :loading="pinning" @click="onPin('super')">
                👑 升级超级（500 积分）
              </van-button>
            </template>
            <template v-else-if="task.status === 'active' && task.pin_type === 'rainbow'">
              <van-button block round color="linear-gradient(90deg, #ff0000, #ff7700, #00ff00, #0099ff, #6633ff)" :loading="pinning" @click="onPin('super')">
                👑 升级超级（500 积分）
              </van-button>
            </template>
            <van-button
              v-if="task.pin_type === 'super'"
              block disabled round
            >👑 已超级置顶</van-button>
            <van-button block plain round @click="onCancelTask">
              撤销我发布的任务
            </van-button>
          </div>
        </template>
        <!-- 已接单:提交截图验证 -->
        <van-button
          v-else-if="claimResult"
          block
          type="primary"
          :loading="submitting"
          loading-text="上传验证中…"
          :disabled="!screenshotFile"
          @click="onSubmit"
        >
          {{ screenshotFile ? '上传截图并提交验证' : '请先上传截图' }}
        </van-button>
        <!-- 已招满 -->
        <van-button
          v-else-if="task.quota_remaining === 0"
          block
          disabled
        >
          已招满
        </van-button>
        <!-- 正常接单 -->
        <van-button
          v-else
          block
          type="primary"
          :loading="claiming"
          loading-text="锁定名额中…"
          @click="onClaim"
        >
          接单（锁定名额 + 30 分钟内完成）
        </van-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast, showFailToast, showConfirmDialog } from 'vant';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
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

// Claim flow
const claiming = ref(false);
const claimResult = ref(null);

// Submit flow
const submitting = ref(false);
const submitResult = ref(null);

// Screenshot upload
const fileInputRef = ref(null);
const screenshotFile = ref(null);
const screenshotPreview = ref(null);

// Pin
const pinning = ref(false);

// Edit dialog
const editDialog = ref({ show: false, reward: '', quota: '', expireDays: '' });

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

    // 恢复已有的接单状态
    if (res.myClaim && !claimResult.value) {
      if (res.myClaim.status === 'claimed') {
        // 进行中:恢复接单状态,可继续上传截图
        claimResult.value = {
          ok: true,
          completionId: res.myClaim.completionId,
          shareLink: res.myClaim.shareLink,
          tip: getLocalTip(res.task.task_type),
          restored: true
        };
      } else if (res.myClaim.status === 'auto_passed') {
        submitResult.value = { ok: true, message: '验证已通过,积分将在回查后发放' };
      } else if (res.myClaim.status === 'auto_rejected') {
        submitResult.value = { ok: false, error: '验证未通过,本次任务已结束', noRetry: true };
      } else if (res.myClaim.status === 'manual_passed') {
        submitResult.value = { ok: true, message: '已完成,积分已发放' };
      } else if (res.myClaim.status === 'timeout') {
        submitResult.value = { ok: false, error: '接单已超时', noRetry: true };
      } else {
        submitResult.value = { ok: false, error: `状态: ${res.myClaim.status}`, noRetry: true };
      }
    }
  } catch (err) {
    loadError.value = err?.error || '加载失败,请稍后再试';
  } finally {
    loading.value = false;
  }
}

function getLocalTip(taskType) {
  const tips = {
    like: '去汽水音乐给这首歌点个 ❤️',
    listen: '去汽水音乐播放这首歌',
    comment: '去汽水音乐给这首歌写条评论',
    share: '去汽水音乐分享这首歌'
  };
  return tips[taskType] || '去汽水音乐完成任务';
}

async function copyLink() {
  const link = claimResult.value?.shareLink || task.value?.share_link;
  if (!link) return;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(link);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = link;
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

async function getDeviceFp() {
  try {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return result.visitorId;
  } catch {
    return 'fallback_' + Math.random().toString(36).slice(2) + '_' + Date.now();
  }
}

async function onClaim() {
  if (!userStore.isLoggedIn) {
    showToast('请先登录');
    router.push({ name: 'login', query: { redirect: `/tasks/${route.params.id}` } });
    return;
  }
  claiming.value = true;
  try {
    const deviceFp = await getDeviceFp();
    const res = await api.post(`/tasks/${route.params.id}/claim`, { deviceFp });
    if (!res.ok) {
      showFailToast(res.error || '接单失败');
      return;
    }
    claimResult.value = res;
    showToast({ message: '接单成功！请完成任务后提交', type: 'success' });
    await loadTask();
  } catch (err) {
    showFailToast(err?.error || '接单失败');
  } finally {
    claiming.value = false;
  }
}

function onRetry() {
  submitResult.value = null;
  screenshotFile.value = null;
  screenshotPreview.value = null;
}

function triggerUpload() {
  fileInputRef.value?.click();
}

function onFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showFailToast('图片不能超过 10MB');
    e.target.value = '';
    return;
  }
  screenshotFile.value = file;
  // 生成预览
  const reader = new FileReader();
  reader.onload = (ev) => { screenshotPreview.value = ev.target.result; };
  reader.readAsDataURL(file);
}

async function onSubmit() {
  if (!claimResult.value?.completionId) {
    showFailToast('接单信息丢失,请刷新重试');
    return;
  }
  if (!screenshotFile.value) {
    showFailToast('请先上传完成截图');
    return;
  }
  submitting.value = true;
  try {
    const formData = new FormData();
    formData.append('screenshot', screenshotFile.value);

    const token = localStorage.getItem('qishui_token');
    const resp = await fetch(`/api/completions/${claimResult.value.completionId}/submit`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const res = await resp.json();

    if (res.ok) {
      // 验证通过:显示结果
      submitResult.value = res;
      showToast({ message: '验证通过！', type: 'success' });
      await userStore.refreshMe();
    } else if (res.error?.includes('截图')) {
      // 截图处理失败:允许重试,不锁定结果
      showFailToast(res.error + '，请重新上传');
      screenshotFile.value = null;
      screenshotPreview.value = null;
    } else {
      // 验证未通过(互动数不足):显示结果
      submitResult.value = res;
    }
  } catch (err) {
    showFailToast(err?.message || '提交失败，请重试');
  } finally {
    submitting.value = false;
  }
}

function openEditDialog() {
  editDialog.value = {
    show: true,
    reward: String(task.value.reward_points),
    quota: String(task.value.quota_total),
    expireDays: ''
  };
}

async function onSaveEdit() {
  const body = {};
  const r = parseInt(editDialog.value.reward);
  const q = parseInt(editDialog.value.quota);
  const d = parseInt(editDialog.value.expireDays);
  if (r && r !== task.value.reward_points) body.reward = r;
  if (q && q !== task.value.quota_total) body.quota = q;
  if (d && d > 0) body.expireDays = d;

  if (Object.keys(body).length === 0) {
    showToast('没有修改');
    return;
  }
  try {
    const res = await api.put(`/tasks/${route.params.id}`, body);
    if (res.ok) {
      showToast({ message: '修改成功', type: 'success' });
      await loadTask();
    } else {
      showFailToast(res.error || '修改失败');
    }
  } catch (err) {
    showFailToast(err?.error || '修改失败');
  }
}

async function onPin(pinType) {
  pinning.value = true;
  try {
    const res = await api.post(`/tasks/${route.params.id}/pin`, { pinType });
    if (res.ok) {
      showToast({ message: res.message || '置顶成功！', type: 'success' });
      await userStore.refreshMe();
      await loadTask();
    } else {
      showFailToast(res.error || '置顶失败');
    }
  } catch (err) {
    showFailToast(err?.error || '置顶失败');
  } finally {
    pinning.value = false;
  }
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
.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.card-header-row .card-title {
  margin: 0;
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
.link-clickable {
  color: var(--color-primary-dark) !important;
  text-decoration: underline;
}
.open-btn {
  display: block;
  text-align: center;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: 16px;
  font-weight: 700;
  border-radius: 10px;
  text-decoration: none;
  transition: opacity 0.15s;
}
.open-btn:active { opacity: 0.8; }
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
.owner-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 接单提示卡 */
.claim-card {
  margin: 12px;
  padding: 16px;
  background: rgba(26, 254, 73, 0.06);
  border: 1px solid rgba(26, 254, 73, 0.2);
  border-radius: 12px;
}
.claim-tip {
  margin: 8px 0 12px;
  font-size: 13px;
  color: var(--color-text-regular);
  line-height: 1.6;
}
.claim-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* 提交结果 */
.submit-result-card {
  margin: 12px;
  padding: 24px 16px;
  background: var(--card-bg);
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.result-emoji {
  font-size: 40px;
  display: block;
  margin-bottom: 8px;
}
.result-ok h3 {
  margin: 0 0 8px;
  color: var(--color-primary-dark);
}
.result-ok p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-regular);
}
.result-fail h3 {
  margin: 0 0 8px;
  color: var(--color-danger);
}
.result-fail p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-regular);
}
.retry-btn {
  margin-top: 12px;
}
/* 截图上传 */
.upload-section {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}
.upload-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.upload-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  border: 2px dashed var(--divider);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s;
  overflow: hidden;
  position: relative;
}
.upload-area:active {
  border-color: var(--color-primary);
}
.upload-text {
  margin-top: 8px;
  font-size: 14px;
  color: var(--color-text-regular);
}
.upload-formats {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-disabled);
}
.preview-img {
  width: 100%;
  max-height: 300px;
  object-fit: contain;
}
.change-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 4px 10px;
  background: rgba(0,0,0,.55);
  color: #fff;
  border-radius: 12px;
  font-size: 11px;
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
