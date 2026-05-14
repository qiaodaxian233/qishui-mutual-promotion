/**
 * 汽水音乐分享链接解析(v2,基于真实 HTML 结构)
 *
 * 输入:用户粘贴的分享文案
 *   《Summer Haze》@汽水音乐 https://qishui.douyin.com/s/iQeg2PpD/
 *
 * 数据流:
 *   短链 https://qishui.douyin.com/s/iQeg2PpD/
 *     ↓ HTTP 302 重定向
 *   长链 https://music.douyin.com/qishui/share/track?track_id=7637175882045982771&...
 *     ↑ 这里的 track_id 就是平台级唯一的歌曲 ID
 *     ↓ GET 响应 HTML
 *   SSR 渲染的页面,可直接正则提取:
 *     - <h1 class="title">Summer Haze</h1>
 *     - <span class="artist-name-max">渡微</span>
 *     - <img src="...cover.jpg" alt="a-image">  (在 cover-player 内)
 *     - <span class="number">48</span>     (收藏/评论/分享 三个数,带 alt)
 *     - <div class="ssr-lyric">每行歌词</div>  (用于歌词时间轴反作弊)
 *
 * 老 fallback(og/JSON-LD/__INITIAL_STATE__)保留作为 UI 改版时的降级方案
 */
const https = require('https');
const { URL } = require('url');

// ============================================================
// 正则:文案解析
// ============================================================
const SHARE_TEXT_PATTERN = /《(.+?)》@汽水音乐\s*(https:\/\/qishui\.douyin\.com\/s\/([A-Za-z0-9]+)\/?)/;
const URL_ONLY_PATTERN = /(https:\/\/qishui\.douyin\.com\/s\/([A-Za-z0-9]+)\/?)/;

/**
 * 解析分享文案(纯文本,不发网络)
 * 支持两种格式:
 *   1. 《歌名》@汽水音乐https://qishui.douyin.com/s/xxx
 *   2. https://qishui.douyin.com/s/xxx (仅链接,歌名从页面抓取)
 */
function parseShareText(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const trimmed = text.trim();

  // 先尝试完整格式
  const fullMatch = trimmed.match(SHARE_TEXT_PATTERN);
  if (fullMatch) {
    return {
      songName: fullMatch[1].trim(),
      shareLink: fullMatch[2],
      shareCode: fullMatch[3]
    };
  }

  // 再尝试仅链接格式
  const urlMatch = trimmed.match(URL_ONLY_PATTERN);
  if (urlMatch) {
    return {
      songName: null, // 从 HTML 抓取
      shareLink: urlMatch[1],
      shareCode: urlMatch[2]
    };
  }

  return null;

  if (shareCode.length < 6 || shareCode.length > 12) return null;
  if (songName.length === 0 || songName.length > 200) return null;

  return { songName, shareLink, shareCode };
}

// ============================================================
// HTTP 抓取:跟踪重定向,返回最终 URL + HTML
// ============================================================

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/**
 * 抓取分享页,自动跟随重定向,返回最终落地的 URL 和 HTML
 *
 * @returns {Promise<{ ok, finalUrl?, html?, status?, error? }>}
 */
function fetchShareHtml(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > MAX_REDIRECTS) {
      return resolve({ ok: false, error: 'too many redirects' });
    }

    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeout: FETCH_TIMEOUT_MS
    }, res => {
      // 跟随重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchShareHtml(nextUrl, depth + 1).then(resolve);
      }

      if (res.statusCode !== 200) {
        return resolve({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
      }

      let body = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) {  // 1MB 上限
          req.destroy();
          resolve({ ok: true, status: 200, html: body, finalUrl: url });
        }
      });
      res.on('end', () => resolve({ ok: true, status: 200, html: body, finalUrl: url }));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', err => resolve({ ok: false, error: err.message }));
  });
}

// ============================================================
// 提取:从最终 URL 取 track_id
// ============================================================

/**
 * 从重定向后的最终 URL 取 track_id
 * 实测格式:https://music.douyin.com/qishui/share/track?track_id=7637175882045982771&...
 *
 * @returns {string|null} track_id 字符串
 */
function extractTrackIdFromUrl(finalUrl) {
  if (!finalUrl) return null;
  try {
    const u = new URL(finalUrl);
    const tid = u.searchParams.get('track_id');
    if (tid && /^\d{6,}$/.test(tid)) return tid;
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 提取:从 SSR HTML 拿歌曲元数据(基于真实结构)
// ============================================================

/**
 * 主提取函数(基于实测的 HTML 结构)
 *
 * HTML 模式(用户提供):
 *   <h1 class="title">Summer Haze</h1>
 *   <span class="artist-name-max">渡微</span>
 *   <div class="cover-player">... <img src="..." alt="a-image"> ...</div>
 *   <div class="action-container">
 *     <div class="action-icon"><img alt="收藏"><span class="number">48</span></div>
 *     <div class="action-icon"><img alt="评论"><span class="number">26</span></div>
 *     <div class="action-icon"><img alt="分享"><span class="number">2</span></div>
 *   </div>
 *   <div class="ssr-lyric">每行歌词</div>
 */
function extractSongMeta(html) {
  if (!html) return emptyMeta();

  const result = emptyMeta();

  // === 1. 歌名:<h1 class="title">xxx</h1> ===
  const titleMatch = html.match(/<h1[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    result.songName = stripHtml(titleMatch[1]).trim();
  }

  // === 2. 歌手:<span class="artist-name-max">xxx</span> ===
  const artistMatch = html.match(/<span[^>]*class=["'][^"']*\bartist-name-max\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (artistMatch) {
    result.artistName = stripHtml(artistMatch[1]).trim();
  }

  // === 3. 封面:alt="a-image" 是个稳定标记 ===
  const coverMatch = html.match(/<img[^>]+alt=["']a-image["'][^>]*src=["']([^"']+)["']/i) ||
                     html.match(/<img[^>]+src=["']([^"']+)["'][^>]+alt=["']a-image["']/i);
  if (coverMatch) {
    result.coverUrl = coverMatch[1];
  }

  // === 4. 歌词:所有 <div class="ssr-lyric">xxx</div> ===
  const lyricMatches = [...html.matchAll(/<div[^>]*class=["'][^"']*\bssr-lyric\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
  if (lyricMatches.length > 0) {
    result.lyrics = lyricMatches.map(m => stripHtml(m[1]).trim()).filter(Boolean);
  }

  // === 5. fallback:如果上述拿不到,尝试老路子 ===
  if (!result.songName)   result.songName   = pickOg(html, 'og:title') || pickMetaName(html, 'description');
  if (!result.coverUrl)   result.coverUrl   = pickOg(html, 'og:image');
  if (!result.artistName) result.artistName = pickOg(html, 'og:music:musician');

  // JSON-LD / __INITIAL_STATE__ 作为最后兜底
  const ld = parseJsonLd(html);
  if (ld) {
    if (!result.songName)   result.songName   = ld.name;
    if (!result.artistName) result.artistName = ld.byArtist?.name;
    if (!result.coverUrl)   result.coverUrl   = ld.image;
    if (!result.durationSec) result.durationSec = parseDurationIso(ld.duration);
  }

  const initial = parseInitialState(html);
  if (initial) {
    const sources = [
      initial.song, initial.track, initial.detail, initial.data,
      initial.pageData?.song, initial.trackInfo
    ].filter(Boolean);
    for (const c of sources) {
      if (!result.qishuiSongId) result.qishuiSongId = c.id || c.track_id || c.trackId;
      if (!result.durationSec)  result.durationSec = c.duration || c.durationSec;
    }
  }

  return result;
}

/**
 * 提取互动数(收藏/点赞/评论/分享/播放)
 *
 * HTML 模式:
 *   <div class="action-container">
 *     <div class="action-icon">
 *       <img alt="收藏"><span class="number">48</span>
 *     </div>
 *     ...
 *   </div>
 *
 * 注意:汽水分享页上"收藏"按钮对应的就是用户点的"喜欢/点赞"
 *      (UI 用收藏图标,业务含义等同于点赞数)
 */
function extractInteractions(html) {
  const result = { likes: null, comments: null, shares: null, plays: null };
  if (!html) return result;

  // 每个 action-icon:img alt="xxx" + span class="number">数字<
  const iconPattern = /<img[^>]+alt=["']([^"']+)["'][^>]*>[\s\S]{0,200}?<span[^>]*class=["'][^"']*\bnumber\b[^"']*["'][^>]*>([^<]+)<\/span>/gi;
  for (const m of html.matchAll(iconPattern)) {
    const alt = m[1].trim();
    const num = parseCountString(m[2].trim());
    if (num == null) continue;

    // 汽水分享页上的"收藏"按钮即点赞,业务上当 likes 用
    if (alt.includes('收藏') || alt.includes('点赞') || alt.toLowerCase().includes('like')) {
      if (result.likes == null) result.likes = num;
    } else if (alt.includes('评论') || alt.toLowerCase().includes('comment')) {
      if (result.comments == null) result.comments = num;
    } else if (alt.includes('分享') || alt.toLowerCase().includes('share')) {
      if (result.shares == null) result.shares = num;
    } else if (alt.includes('播放') || alt.toLowerCase().includes('play')) {
      if (result.plays == null) result.plays = num;
    }
  }

  // fallback:从 __INITIAL_STATE__ 提取
  if (result.likes == null && result.comments == null) {
    const initial = parseInitialState(html);
    if (initial) {
      const sources = [
        initial.song, initial.track, initial.detail, initial.data,
        initial.pageData?.song, initial.stat, initial.stats
      ].filter(Boolean);
      for (const c of sources) {
        result.likes    = result.likes    ?? pickNumber(c, ['likeCount', 'like_count', 'likes', 'diggCount', 'digg_count', 'collectCount', 'collect_count']);
        result.comments = result.comments ?? pickNumber(c, ['commentCount', 'comment_count', 'comments']);
        result.shares   = result.shares   ?? pickNumber(c, ['shareCount', 'share_count', 'shares']);
        result.plays    = result.plays    ?? pickNumber(c, ['playCount', 'play_count', 'plays']);
      }
    }
  }

  return result;
}

// ============================================================
// 辅助函数
// ============================================================

function emptyMeta() {
  return {
    qishuiSongId: null,
    songName: null,
    artistName: null,
    coverUrl: null,
    durationSec: null,
    lyrics: null
  };
}

/**
 * 解析数字字符串
 * 支持:"48"、"1.2万"、"3.5w"、"123,456"
 */
function parseCountString(s) {
  if (!s) return null;
  s = String(s).trim().replace(/,/g, '');

  // 1.2万 / 1.2w
  const wMatch = s.match(/^(\d+(?:\.\d+)?)\s*[万w]/i);
  if (wMatch) return Math.round(parseFloat(wMatch[1]) * 10000);

  // 1.2亿
  const yMatch = s.match(/^(\d+(?:\.\d+)?)\s*亿/);
  if (yMatch) return Math.round(parseFloat(yMatch[1]) * 100000000);

  // 1.2k
  const kMatch = s.match(/^(\d+(?:\.\d+)?)\s*k/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);

  // 纯数字
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return null;
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function pickOg(html, property) {
  const re = new RegExp(`<meta[^>]+property=["']${escapeRe(property)}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return decodeHtmlEntities(m[1]);

  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRe(property)}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? decodeHtmlEntities(m2[1]) : null;
}

function pickMetaName(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${escapeRe(name)}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function parseJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;
  const m = html.match(re);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

function parseInitialState(html) {
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/,
    /window\.__SSR_DATA__\s*=\s*({[\s\S]*?});/,
    /window\.__NUXT__\s*=\s*({[\s\S]*?});/,
    /<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try {
        let raw = m[1].trim();
        if (raw.includes('%7B') || raw.includes('%22')) raw = decodeURIComponent(raw);
        return JSON.parse(raw);
      } catch {}
    }
  }
  return null;
}

function pickNumber(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null) {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseDurationIso(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2] || '0', 10);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)));
}

// ============================================================
// 对外主函数
// ============================================================

/**
 * 完整解析:文案 → 跟随重定向 → 提取
 */
async function parseShareLink(text) {
  // Step 1: 文案解析
  const parsed = parseShareText(text);
  if (!parsed) {
    return {
      ok: false,
      stage: 'parse_text',
      error: '请粘贴汽水音乐分享链接,例如 https://qishui.douyin.com/s/xxx'
    };
  }

  // Step 2: 抓页(自动跟重定向)
  const fetched = await fetchShareHtml(parsed.shareLink);
  if (!fetched.ok) {
    return {
      ok: false,
      stage: 'fetch',
      error: `分享链接访问失败:${fetched.error}`,
      parsed
    };
  }

  // Step 3: 从最终 URL 取 track_id(优先级最高)
  let qishuiSongId = extractTrackIdFromUrl(fetched.finalUrl);
  let songIdSource = qishuiSongId ? 'url' : null;

  // Step 4: 提取 HTML 元数据
  const meta = extractSongMeta(fetched.html);
  const interactions = extractInteractions(fetched.html);

  // 如果 URL 拿不到 track_id,从 HTML 兜底
  if (!qishuiSongId && meta.qishuiSongId) {
    qishuiSongId = meta.qishuiSongId;
    songIdSource = 'html';
  }

  let songIdFallback = false;
  if (!qishuiSongId) {
    qishuiSongId = `fallback_${parsed.shareCode}`;
    songIdSource = 'fallback';
    songIdFallback = true;
  }

  // URL-only 格式:歌名从 HTML 自动获取
  const songName = meta.songName || parsed.songName || '未知歌曲';

  // Step 5: 校验歌名一致性(仅完整格式才校验)
  let nameWarning = null;
  if (parsed.songName && meta.songName && meta.songName !== parsed.songName) {
    if (!meta.songName.includes(parsed.songName) && !parsed.songName.includes(meta.songName)) {
      nameWarning = `分享文案歌名"${parsed.songName}"与页面歌名"${meta.songName}"不一致`;
    }
  }

  return {
    ok: true,
    parsed,
    finalUrl: fetched.finalUrl,
    meta: {
      ...meta,
      qishuiSongId,
      songName: songName,
      songIdSource,
      songIdFallback
    },
    interactions,
    nameWarning
  };
}

module.exports = {
  parseShareText,
  fetchShareHtml,
  extractSongMeta,
  extractInteractions,
  extractTrackIdFromUrl,
  parseShareLink,
  _internal: {
    pickOg, pickMetaName, parseJsonLd, parseInitialState,
    pickNumber, parseDurationIso, decodeHtmlEntities,
    parseCountString, stripHtml
  }
};
