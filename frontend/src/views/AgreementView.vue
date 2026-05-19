<template>
  <div class="agreement-page">
    <van-nav-bar title="用户协议" left-arrow @click-left="$router.back()" />

    <div class="agreement-content">
      <h1>音乐加油站用户协议</h1>
      <p class="update-date">最后更新：2026 年 5 月</p>

      <section>
        <h2>一、服务说明</h2>
        <p>音乐加油站（以下简称"本平台"）是一个为独立音乐人和音乐爱好者提供互助推广服务的在线平台。用户可以通过发布和完成任务（如点赞、播放、评论、分享）来互相支持优质音乐内容。</p>
      </section>

      <section>
        <h2>二、账号注册</h2>
        <p>1. 用户需使用真实有效的邮箱注册账号，每个邮箱仅可注册一个账号。</p>
        <p>2. 注册成功后系统赠送 100 积分作为新手福利。</p>
        <p>3. 用户应妥善保管账号密码，因账号泄露造成的损失由用户自行承担。</p>
        <p>4. 严禁注册多个账号进行刷量、套利等违规操作。</p>
      </section>

      <section>
        <h2>三、积分规则</h2>
        <p>1. 积分是平台内部虚拟计量单位，不具有现金价值，不可提现、不可转让。</p>
        <p>2. 获取积分途径：每日签到、完成任务、管理员发放。</p>
        <p>3. 消耗积分途径：发布任务、置顶任务。</p>
        <p>4. 平台保留对积分规则进行调整的权利。</p>
      </section>

      <section>
        <h2>四、任务规范</h2>
        <p>1. <strong>真实互动</strong>：所有任务完成必须由用户亲自在汽水音乐 App 中操作，严禁使用脚本、模拟器、自动化工具。</p>
        <p>2. <strong>诚信原则</strong>：完成任务后不得撤销互动操作（如取消点赞），系统将在 24 小时后进行回查。</p>
        <p>3. <strong>截图凭证</strong>：提交任务完成时需上传真实截图，严禁使用 PS 或虚假截图。</p>
        <p>4. <strong>内容合规</strong>：发布的歌曲必须为汽水音乐平台合法上架的内容。</p>
      </section>

      <section>
        <h2>五、信用体系</h2>
        <p>1. 每位用户初始信用分为 600 分。</p>
        <p>2. 按时完成任务并通过回查可获得信用加分。</p>
        <p>3. 以下行为将导致信用扣分：接单超时未完成（-10）、回查发现互动撤回（-20）。</p>
        <p>4. 信用分低于 400 将被限制接单功能。</p>
        <p>5. 信用分低于 200 账号将被自动冻结。</p>
      </section>

      <section>
        <h2>六、隐私保护</h2>
        <p>1. 用户邮箱仅用于登录验证和系统通知，不会向第三方泄露。</p>
        <p>2. 用户 IP 地址经 SHA256 哈希后存储，用于反作弊，不存储原始 IP。</p>
        <p>3. 设备指纹信息仅用于防止同一设备重复接单。</p>
        <p>4. 用户上传的截图将在 7 天后自动删除，仅保留哈希值用于查重。</p>
      </section>

      <section>
        <h2>七、违规处理</h2>
        <p>1. 轻微违规（首次）：警告 + 扣除信用分。</p>
        <p>2. 中度违规（累犯）：冻结账号 + 扣除全部积分。</p>
        <p>3. 严重违规（刷量/脚本/多账号套利）：永久封禁。</p>
        <p>4. 平台管理员拥有最终解释权和处理权。</p>
      </section>

      <section>
        <h2>八、免责声明</h2>
        <p>1. 本平台与汽水音乐官方无直接关联，为独立第三方社区。</p>
        <p>2. 因汽水音乐平台规则变动导致的功能异常，本平台不承担责任。</p>
        <p>3. 用户因违反汽水音乐平台规则导致的账号处罚，本平台不承担责任。</p>
      </section>

      <section>
        <h2>九、协议变更</h2>
        <p>本平台保留修改本协议的权利，修改后的协议将在平台内公示。用户继续使用本平台服务即表示同意修改后的协议。</p>
      </section>

      <div class="bottom-space"></div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'AgreementView' });
</script>

<style scoped>
.agreement-page {
  min-height: 100vh;
  background: var(--page-bg);
}
.agreement-content {
  padding: 20px 20px 60px;
  max-width: 600px;
  margin: 0 auto;
}
h1 {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  text-align: center;
}
.update-date {
  text-align: center;
  font-size: 12px;
  color: var(--color-text-disabled);
  margin: 0 0 24px;
}
section {
  margin-bottom: 24px;
}
h2 {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 10px;
}
p {
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-text-regular);
  margin: 0 0 6px;
}
p strong {
  color: var(--color-text-primary);
}
.bottom-space { height: 40px; }
</style>
