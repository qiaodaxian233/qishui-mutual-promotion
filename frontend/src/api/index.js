import axios from 'axios';
import { showToast, showFailToast } from 'vant';

const instance = axios.create({
  // 生产环境 baseURL 留空(同源 /api),开发环境走 vite proxy
  baseURL: '/api',
  timeout: 30000
});

// 请求拦截器:自动带上 token
instance.interceptors.request.use(config => {
  const token = localStorage.getItem('qishui_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器:统一返回 response.data,处理错误
instance.interceptors.response.use(
  response => {
    // 后端约定:返回 { ok: true/false, ... }
    // axios 默认 200 算成功,但业务上 ok:false 应该按"业务错误"处理
    return response.data;
  },
  error => {
    if (!error.response) {
      showFailToast('网络异常,请稍后再试');
      return Promise.reject(error);
    }

    const { status, data } = error.response;

    // 401:登录过期,清掉 token,跳登录页
    if (status === 401) {
      localStorage.removeItem('qishui_token');
      localStorage.removeItem('qishui_user');
      showToast('登录已过期,请重新登录');
      // 不要在拦截器里直接 router.push,可能引起循环
      // 让调用方拿到错误自己处理,或者监听后做
      setTimeout(() => {
        if (location.pathname !== '/login') {
          location.href = '/login?redirect=' + encodeURIComponent(location.pathname);
        }
      }, 500);
      return Promise.reject(data || { ok: false, error: '未登录' });
    }

    // 429:限流
    if (status === 429) {
      showFailToast('操作过于频繁,请稍后再试');
      return Promise.reject(data || { ok: false, error: '请求过于频繁' });
    }

    // 其它 4xx / 5xx:返回后端给的错误信息
    return Promise.reject(data || { ok: false, error: `请求失败 (${status})` });
  }
);

export default instance;
