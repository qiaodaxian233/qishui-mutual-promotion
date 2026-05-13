/**
 * 请求工具:IP 提取、UA 处理
 *
 * ⚠️ 重要:Nginx 反向代理必须设置:
 *   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *   proxy_set_header X-Real-IP $remote_addr;
 * 否则所有客户端都被识别为 127.0.0.1
 */

/**
 * 获取客户端真实 IP
 * 优先级:X-Forwarded-For 第一个 > X-Real-IP > socket
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    // X-Forwarded-For 可能是 "client, proxy1, proxy2"
    const first = String(xff).split(',')[0].trim();
    if (first) return cleanIp(first);
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return cleanIp(String(realIp).trim());
  return cleanIp(req.socket?.remoteAddress || 'unknown');
}

/**
 * 规范化 IP:去掉 IPv6 映射前缀 ::ffff:
 */
function cleanIp(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

/**
 * 获取 User-Agent,截断到 500
 */
function getUserAgent(req) {
  const ua = req.headers['user-agent'] || '';
  return String(ua).slice(0, 500);
}

/**
 * 从请求体里提取设备指纹
 * 前端用 FingerprintJS 算出来传过来
 */
function getDeviceFp(req) {
  const fp = req.body?.deviceFp || req.headers['x-device-fp'] || '';
  return String(fp).slice(0, 128);
}

module.exports = {
  getClientIp,
  cleanIp,
  getUserAgent,
  getDeviceFp
};
