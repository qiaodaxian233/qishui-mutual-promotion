<template>
  <div class="login-page">
    <van-nav-bar
      title="登录"
      left-arrow
      @click-left="$router.back()"
    />
    <div class="content">
      <van-empty description="登录页即将上线" image-size="120" />
      <van-button block plain @click="$router.push('/')">返回首页</van-button>
    </div>
  </div>
</template>

<script setup>
// 阶段 5.2 实现完整逻辑
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: var(--page-bg);
}
.content {
  padding: 32px 16px;
}
</style>
