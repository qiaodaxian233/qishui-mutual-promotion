/**
 * 邮件服务(QQ 邮箱 SMTP)
 *
 * QQ 邮箱配置说明:
 * - 主机:smtp.qq.com
 * - 端口:465(SSL) 或 587(STARTTLS)
 * - 用户:你的完整 QQ 邮箱(xxx@qq.com)
 * - 密码:不是 QQ 密码,是「IMAP/SMTP 授权码」
 *   开启路径:mail.qq.com → 设置 → 账户 → POP3/SMTP 服务
 */
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure, // 465 走 SSL,587 走 STARTTLS(secure=false)
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    });
  }
  return transporter;
}

/**
 * 启动时验证 SMTP 配置可用(非阻塞,失败只打日志)
 */
async function verifyConnection() {
  try {
    await getTransporter().verify();
    console.log(`[mailer] SMTP 连接成功(${config.smtp.host}:${config.smtp.port})`);
    return true;
  } catch (err) {
    console.error(`[mailer] ⚠️ SMTP 连接失败:${err.message}`);
    console.error(`  发邮件会失败,请检查 SMTP_USER / SMTP_PASS(QQ 授权码,非密码)`);
    return false;
  }
}

/**
 * 发送验证码邮件
 */
async function sendVerificationCode(toEmail, code, purpose = 'register') {
  const purposeText = {
    register: '注册',
    reset_password: '重置密码',
    change_email: '更换邮箱'
  }[purpose] || '验证';

  const subject = `【${config.smtp.fromName}】${purposeText}验证码`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #fafafa; border-radius: 12px;">
      <h2 style="color: #333; margin-top: 0;">${purposeText}验证码</h2>
      <p style="color: #666; line-height: 1.6;">你好,</p>
      <p style="color: #666; line-height: 1.6;">你正在进行<strong>${purposeText}</strong>操作,验证码如下:</p>
      <div style="background: #fff; border: 2px dashed #ff6b35; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ff6b35;">${code}</span>
      </div>
      <p style="color: #999; font-size: 13px; line-height: 1.6;">
        验证码有效期 <strong>${config.business.emailCodeTtlMinutes} 分钟</strong>,请尽快使用。<br>
        如果不是本人操作,请忽略此邮件。
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
      <p style="color: #aaa; font-size: 12px; text-align: center;">
        ${config.smtp.fromName} · 让独立音乐人互相听见
      </p>
    </div>
  `;

  const text = `${purposeText}验证码:${code}\n\n有效期 ${config.business.emailCodeTtlMinutes} 分钟,请尽快使用。\n如果不是本人操作,请忽略此邮件。`;

  try {
    const info = await getTransporter().sendMail({
      from: `"${config.smtp.fromName}" <${config.smtp.user}>`,
      to: toEmail,
      subject,
      text,
      html
    });
    console.log(`[mailer] 验证码已发送给 ${toEmail},messageId: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[mailer] 发送失败:${toEmail},${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  verifyConnection,
  sendVerificationCode
};
