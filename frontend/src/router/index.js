import { createRouter, createWebHistory } from 'vue-router';
import { useUserStore } from '@/stores/user';

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '首页' }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', guestOnly: true }
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { title: '注册', guestOnly: true }
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/TasksView.vue'),
    meta: { title: '任务广场' }
  },
  // SPA 兜底:未匹配的全部回首页(用户刷新深层路由时不 404)
  {
    path: '/:catchAll(.*)',
    redirect: '/'
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 切换路由时滚到顶
  scrollBehavior() {
    return { top: 0 };
  }
});

// 路由守卫:要求登录的页面 + 已登录用户不应该访问 login/register
router.beforeEach((to, from, next) => {
  const userStore = useUserStore();

  // 设置页面标题
  if (to.meta.title) {
    document.title = `${to.meta.title} · 汽水音乐互推`;
  }

  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    return next({ name: 'login', query: { redirect: to.fullPath } });
  }
  if (to.meta.guestOnly && userStore.isLoggedIn) {
    return next({ name: 'home' });
  }
  next();
});

export default router;
