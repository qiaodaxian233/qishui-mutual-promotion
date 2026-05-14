/**
 * 截图 AI 分析服务
 *
 * 用 Claude API 视觉能力分析汽水音乐截图:
 * 1. 进度条是否过半(播放类任务)
 * 2. 是否真的点了赞(红心是否亮着)
 * 3. 是否是汽水音乐 App 的真实截图
 */
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.CLAUDE_API_KEY || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * 分析截图
 * @param {string} imagePath - 图片文件路径
 * @param {string} taskType - 任务类型 like/listen/comment/share
 * @returns {Object} { ok, passed, reason, details }
 */
async function analyzeScreenshot(imagePath, taskType) {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[screenshot-ai] 未配置 CLAUDE_API_KEY,跳过 AI 分析');
    return { ok: true, passed: null, reason: '未配置 AI 分析,跳过', skipped: true };
  }

  // 读取图片转 base64
  const fullPath = imagePath.startsWith('/') ? imagePath : path.join(__dirname, '../..', imagePath);
  if (!fs.existsSync(fullPath)) {
    return { ok: false, passed: false, reason: '截图文件不存在' };
  }
  const imageBuffer = fs.readFileSync(fullPath);
  const base64 = imageBuffer.toString('base64');

  // 根据文件扩展名判断 mime type
  const ext = path.extname(fullPath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const mediaType = mimeMap[ext] || 'image/jpeg';

  // 构建 prompt
  const prompt = buildPrompt(taskType);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[screenshot-ai] API 错误:', response.status, err);
      return { ok: true, passed: null, reason: 'AI 分析暂时不可用', skipped: true };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // 解析 AI 回复
    return parseAIResponse(text, taskType);
  } catch (err) {
    console.error('[screenshot-ai] 请求失败:', err.message);
    return { ok: true, passed: null, reason: 'AI 分析请求失败', skipped: true };
  }
}

function buildPrompt(taskType) {
  const base = `分析这张手机截图,判断是否是汽水音乐App的真实截图。回答必须是 JSON 格式,不要有其他文字。

JSON格式: {"is_qishui": true/false, "passed": true/false, "reason": "简短原因"}

`;

  const typePrompts = {
    like: base + `判断条件:
1. 是否是汽水音乐App界面
2. 红心/点赞按钮是否已经点亮(红色表示已点赞)
如果红心是红色的(已点赞状态),passed=true`,

    listen: base + `判断条件:
1. 是否是汽水音乐App界面
2. 底部播放进度条的播放位置是否已经过了一半(50%以上)
仔细观察进度条上的小圆点或已播放部分的长度,如果播放进度超过一半,passed=true`,

    comment: base + `判断条件:
1. 是否是汽水音乐App界面
2. 是否显示了评论区或已发送评论
如果能看到用户发表的评论,passed=true`,

    share: base + `判断条件:
1. 是否是汽水音乐App界面
2. 是否显示了分享界面或分享成功提示
如果能看到分享相关内容,passed=true`
  };

  return typePrompts[taskType] || typePrompts.like;
}

function parseAIResponse(text, taskType) {
  try {
    // 提取 JSON
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return { ok: true, passed: null, reason: 'AI 回复解析失败', skipped: true, raw: text };
    }
    const result = JSON.parse(jsonMatch[0]);

    return {
      ok: true,
      passed: !!result.passed,
      isQishui: !!result.is_qishui,
      reason: result.reason || '',
      raw: text
    };
  } catch (err) {
    return { ok: true, passed: null, reason: 'AI 回复格式异常', skipped: true, raw: text };
  }
}

module.exports = { analyzeScreenshot };
