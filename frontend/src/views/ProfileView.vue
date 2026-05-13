<template>
  <div class="profile-page">
    <van-nav-bar title="个人资料" left-arrow @click-left="$router.back()" />

    <section class="form-card">
      <h3 class="card-title">基本信息</h3>
      <van-field v-model="nickname" label="昵称" placeholder="1-20字" maxlength="20" />
      <van-field :model-value="userStore.user?.email" label="邮箱" readonly disabled />
      <van-field :model-value="'信用 ' + (userStore.user?.creditScore || 0)" label="信用分" readonly disabled />
      <van-button block type="primary" round class="mt-16" :loading="saving" @click="onSaveProfile">
        保存昵称
      </van-button>
    </section>

    <section class="form-card">
      <h3 class="card-title">修改密码</h3>
      <van-field v-model="oldPwd" label="旧密码" type="password" placeholder="输入当前密码" />
      <van-field v-model="newPwd" label="新密码" type="password" placeholder="8位以上,含字母+数字" />
      <van-field v-model="confirmPwd" label="确认密码" type="password" placeholder="再输一次新密码" />
      <van-button block type="primary" round plain class="mt-16" :loading="changingPwd" @click="onChangePwd">
        修改密码
      </van-button>
    </section>

    <!-- 信用分明细 -->
    <section class="form-card">
      <h3 class="card-title">信用分记录</h3>
      <div v-for="item in creditLog" :key="item.id" class="credit-item">
        <div class="credit-left">
          <span class="credit-reason">{{ item.reason }}</span>
          <span class="credit-time">{{ formatTime(item.created_at) }}</span>
        </div>
        <span class="credit-delta" :class="item.delta > 0 ? 'delta-up' : 'delta-down'">
          {{ item.delta > 0 ? '+' : '' }}{{ item.delta }}
        </span>
      </div>
      <van-empty v-if="creditLog.length === 0" description="暂无信用分变动" image-size="80" />
    </section>
  </div>
</template>

<script setup>
defineOptions({ name: 'ProfileView' });
import { ref, onMounted } from 'vue';
import { showToast, showFailToast, showSuccessToast } from 'vant';
import api from '@/api';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const nickname = ref(userStore.user?.nickname || '');
const saving = ref(false);
const oldPwd = ref('');
const newPwd = ref('');
const confirmPwd = ref('');
const changingPwd = ref(false);
const creditLog = ref([]);

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function onSaveProfile() {
  if (!nickname.value.trim()) { showFailToast('昵称不能为空'); return; }
  saving.value = true;
  try {
    const res = await api.put('/auth/profile', { nickname: nickname.value.trim() });
    if (res.ok) {
      userStore.user.nickname = nickname.value.trim();
      localStorage.setItem('qishui_user', JSON.stringify(userStore.user));
      showSuccessToast('保存成功');
    }
  } catch (err) { showFailToast(err?.error || '保存失败'); }
  finally { saving.value = false; }
}

async function onChangePwd() {
  if (!oldPwd.value) { showFailToast('请输入旧密码'); return; }
  if (newPwd.value.length < 8) { showFailToast('新密码至少 8 位'); return; }
  if (newPwd.value !== confirmPwd.value) { showFailToast('两次密码不一致'); return; }
  changingPwd.value = true;
  try {
    const res = await api.put('/auth/password', { oldPassword: oldPwd.value, newPassword: newPwd.value });
    if (res.ok) {
      showSuccessToast('密码修改成功');
      oldPwd.value = ''; newPwd.value = ''; confirmPwd.value = '';
    }
  } catch (err) { showFailToast(err?.error || '修改失败'); }
  finally { changingPwd.value = false; }
}

async function loadCreditLog() {
  try {
    const res = await api.get('/points/credit-log');
    if (res.ok) creditLog.value = res.items;
  } catch {}
}

onMounted(() => { loadCreditLog(); });
</script>

<style scoped>
.profile-page { min-height: 100vh; background: var(--page-bg); padding-bottom: 40px; }
.form-card { margin: 12px; padding: 16px; background: var(--card-bg); border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.card-title { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.mt-16 { margin-top: 16px; }
.credit-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--divider); }
.credit-left { display: flex; flex-direction: column; }
.credit-reason { font-size: 13px; color: var(--color-text-primary); }
.credit-time { font-size: 11px; color: var(--color-text-disabled); margin-top: 2px; }
.credit-delta { font-size: 15px; font-weight: 700; }
.delta-up { color: var(--color-primary-dark); }
.delta-down { color: var(--color-danger); }
</style>
