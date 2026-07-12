// 讯飞语音转写（录音文件转写 LFASR v2）
// 文档: https://www.xfyun.cn/doc/asr/ifasr_new/API.html
// 优势：直接上传文件，不需要公网 URL（不用 cpolar）；roleType=1 开启说话人分离
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = 'https://raasr.xfyun.cn/v2/api';
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function signa(appId, secretKey, ts) {
  const md5 = crypto.createHash('md5').update(appId + ts).digest('hex');
  return crypto.createHmac('sha1', secretKey).update(md5).digest('base64');
}

function authParams() {
  const appId = process.env.XFYUN_APPID;
  const secretKey = process.env.XFYUN_SECRET_KEY;
  if (!appId || !secretKey) throw new Error('缺少 XFYUN_APPID / XFYUN_SECRET_KEY');
  const ts = Math.floor(Date.now() / 1000).toString();
  return { appId, ts, signa: signa(appId, secretKey, ts) };
}

async function xfFetch(pathname, query, body) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${HOST}${pathname}?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); } catch {
    throw new Error(`讯飞接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (out.code !== '000000') throw new Error(`讯飞接口错误 ${out.code}: ${out.descInfo || JSON.stringify(out)}`);
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
      .map(c => c.w)
      .join('');
    if (!text.trim()) continue;
    segments.push({
      start: Math.round(Number(st.bg) / 1000),
      end: Math.round(Number(st.ed) / 1000),
      speaker: `说话人${st.rl || '1'}`,
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

    // 1. 上传（直接传文件二进制，无需公网 URL）
    const up = await xfFetch('/upload', {
      ...authParams(),
      fileName: filename,
      fileSize: data.length,
      duration: '0',
      roleType: '1', // 说话人分离
      language: 'cn',
    }, data);
    const orderId = up.orderId;
    if (!orderId) throw new Error('讯飞上传未返回 orderId');

    // 2. 轮询结果（最长 10 分钟）
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const c = await xfFetch('/getResult', { ...authParams(), orderId, resultType: 'transfer' }, null);
      const status = c.orderInfo && c.orderInfo.status;
      if (status === 4) return { language: 'zh', segments: parseResult(c.orderResult) };
      if (status === -1) throw new Error('讯飞转写失败: failType=' + (c.orderInfo.failType || '?'));
    }
    throw new Error('讯飞转写超时');
  },
};
