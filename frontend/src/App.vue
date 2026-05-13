<template>
  <div class="app-root">
    <router-view v-slot="{ Component }">
      <keep-alive :include="['HomeView', 'TasksView', 'MyView']">
        <component :is="Component" />
      </keep-alive>
    </router-view>

    <!-- 底部 Tab 栏:只在主页面显示 -->
    <van-tabbar
      v-if="showTabbar"
      v-model="activeTab"
      :fixed="true"
      :safe-area-inset-bottom="true"
      active-color="#0EBA37"
      inactive-color="#999"
      @change="onTabChange"
    >
      <van-tabbar-item name="home" icon="wap-home-o">首页</van-tabbar-item>
      <van-tabbar-item name="tasks" icon="apps-o">广场</van-tabbar-item>
      <van-tabbar-item name="my" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

const TAB_ROUTES = {
  home: '/',
  tasks: '/tasks',
  my: '/my'
};
const TAB_PATH_SET = new Set(Object.values(TAB_ROUTES));

const showTabbar = computed(() => TAB_PATH_SET.has(route.path));
const activeTab = ref('home');

watch(
  () => route.path,
  (path) => {
    for (const [name, p] of Object.entries(TAB_ROUTES)) {
      if (path === p) { activeTab.value = name; return; }
    }
  },
  { immediate: true }
);

function onTabChange(name) {
  const target = TAB_ROUTES[name];
  if (target && route.path !== target) {
    router.push(target);
  }
}
</script>

<style scoped>
.app-root {
  min-height: 100vh;
  background: var(--page-bg, #f7f8fa);
}
</style>
