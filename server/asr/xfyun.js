// 讯飞语音转写（录音文件转写标准版 LFASR v2）
// 文档: https://www.xfyun.cn/doc/asr/ifasr_new/API.html
// 优势：直接上传文件（无需公网 URL）；roleType=1 说话人分离；hotWord 参数直传热词
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = 'https://raasr.xfyun.cn/v2/api';
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function authParams() {
  const appId = (process.env.XFYUN_APPID || '').trim();
  const secretKey = (process.env.XFYUN_SECRET_KEY || '').trim();
  if (!appId || !secretKey) throw new Error('缺少 XFYUN_APPID / XFYUN_SECRET_KEY');
  const ts = Math.floor(Date.now() / 1000).toString();
  const md5 = crypto.createHash('md5').update(appId + ts).digest('hex');
  const signa = crypto.createHmac('sha1', secretKey).update(md5).digest('base64');
  return { appId, ts, signa };
}

// 我们库里的热词 -> 讯飞 hotWord 参数（"词1|词2"，单词 2~16 字，最多 200 个）
function hotWordParam() {
  try {
    const words = (require('../store').getMeta('hotwords') || [])
      .filter(w => w.length >= 2 && w.length <= 16)
      .slice(0, 200);
    return words.length ? { hotWord: words.join('|') } : {};
  } catch {
    return {};
  }
}

async function xfFetch(pathname, query, body) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${HOST}${pathname}?${qs}`, {
    method: 'POST',
    ...(body ? { headers: { 'Content-Type': 'application/octet-stream' }, body } : {}),
  });
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); } catch {
    throw new Error(`讯飞接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (out.code !== '000000') {
    let hint = '';
    if (out.code === '26601') hint = '（检查 XFYUN_APPID 是否正确、该应用是否已开通"语音转写"服务、SecretKey 是否是语音转写页面的那个）';
    if (out.code === '26625' || out.code === '26633') hint = '（免费时长不足，去控制台语音转写页领取或购买）';
    throw new Error(`讯飞接口错误 ${out.code}: ${out.descInfo || JSON.stringify(out)}${hint}`);
  }
  return out.content;
}

// 解析讯飞 lattice 结果为统一 segments 格式
function parseResult(orderResultStr) {
  const or = JSON.parse(orderResultStr);
  const segments = [];
  for (const item of or.lattice || []) {
    const st = JSON.parse(item.json_1best).st;
    const text = (st.rt || [])
      .flatMap(r => r.ws || [])
      .flatMap(w => w.cw || [])
      .filter(c => c.wp !== 'g') // 分段标记不是文字
      .map(c => c.w)
      .join('');
    if (!text.trim()) continue;
    segments.push({
      start: Math.round(Number(st.bg) / 1000),
      end: Math.round(Number(st.ed) / 1000),
      speaker: `说话人${st.rl && st.rl !== '0' ? st.rl : '1'}`,
      text: text.trim(),
    });
  }
  return segments;
}

module.exports = {
  name: 'xfyun',
  async transcribe({ filename }) {
    const filePath = path.join(UPLOAD_DIR, filename);
    const data = fs.readFileSync(filePath);

    // 1. 上传（直接传文件二进制，无需公网 URL；热词随单携带）
    const up = await xfFetch('/upload', {
      ...authParams(),
      fileName: filename,
      fileSize: data.length,
      duration: '60',
      roleType: '1',
      language: 'cn',
      ...hotWordParam(),
    }, data);
    const orderId = up.orderId;
    if (!orderId) throw new Error('讯飞上传未返回 orderId');

    // 2. 轮询结果（最长 10 分钟；官方限制查询不超过 100 次）
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 6000));
      const c = await xfFetch('/getResult', { ...authParams(), orderId, resultType: 'transfer' }, null);
      const status = c.orderInfo && c.orderInfo.status;
      if (status === 4) return { language: 'zh', segments: parseResult(c.orderResult) };
      if (status === -1) throw new Error(`讯飞转写失败 failType=${c.orderInfo.failType}（1上传失败/2转码失败/3识别失败/5时长校验失败/6静音文件）`);
    }
    throw new Error('讯飞转写超时');
  },
};
