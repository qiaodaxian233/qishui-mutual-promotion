/**
 * PM2 配置(参考用户 truth-dare-wheel 项目偏好)
 * 部署:pm2 start ecosystem.config.js
 * 重启:pm2 restart qishui-mutual-promotion
 * 查日志:pm2 logs qishui-mutual-promotion
 */
module.exports = {
  apps: [
    {
      name: 'qishui-mutual-promotion',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      time: true
    }
  ]
};
