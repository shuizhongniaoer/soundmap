// 讯飞·录音文件转写大模型（支持中英+202种方言免切换识别）
// 文档: https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html
// 鉴权：signature 放请求头，HMAC-SHA1(按参数名排序的 key=urlencode(value) 串, APISecret)
// 凭证：控制台"录音文件转写大模型"页的 APPID / APIKey(accessKeyId) / APISecret
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const blobs = require('../blobs');

const HOST = 'https://office-api-ist-dx.iflyaisol.com';

function creds() {
  const appId = (process.env.XFYUN_APPID || '').trim();
  const apiKey = (process.env.XFYUN_API_KEY || '').trim();
  const apiSecret = (process.env.XFYUN_API_SECRET || '').trim();
  if (!appId || !apiKey || !apiSecret) throw new Error('缺少 XFYUN_APPID / XFYUN_API_KEY / XFYUN_API_SECRET');
  return { appId, apiKey, apiSecret };
}

function dateTimeStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
}

function random16() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.randomBytes(16)).map(b => chars[b % chars.length]).join('');
}

// 按参数名自然排序，value 做 URL 编码，key=value 用 & 连接，HMAC-SHA1 后 base64
function sign(params, secret) {
  const base = Object.keys(params)
    .filter(k => k !== 'signature' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
  return crypto.createHmac('sha1', secret).update(base, 'utf8').digest('base64');
}

function qs(params) {
  return Object.keys(params)
    .filter(k => params[k] !== '' && params[k] != null)
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

async function xfFetch(pathname, params, { body, contentType }) {
  const { apiSecret } = creds();
  const signature = sign(params, apiSecret);
  const res = await fetch(`${HOST}${pathname}?${qs(params)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, signature },
    body,
  });
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); } catch {
    throw new Error(`讯飞接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (String(out.code) !== '000000') {
    let hint = '';
    if (String(out.code) === '100009') hint = '（签名校验不通过，检查 APIKey/APISecret 是否是"录音文件转写大模型"页面的）';
    if (String(out.code) === '000002') hint = '（accessKeyId 不存在，检查 XFYUN_API_KEY）';
    throw new Error(`讯飞接口错误 ${out.code}: ${out.descInfo || JSON.stringify(out)}${hint}`);
  }
  return out.content;
}

// 解析 lattice 结果为统一 segments 格式
function parseResult(orderResultStr) {
  const or = JSON.parse(orderResultStr);
  const segments = [];
  for (const item of or.lattice || []) {
    const st = JSON.parse(item.json_1best).st;
    const text = (st.rt || [])
      .flatMap(r => r.ws || [])
      .flatMap(w => w.cw || [])
      .filter(c => c.wp !== 'g')
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
    const { appId, apiKey } = creds();
    // 通过 blob 存储抽象层获取本地文件路径（S3 模式会下载到临时目录）
    const local = await blobs.getAsLocalPath(filename);
    if (!local) throw new Error(`音频文件不存在: ${filename}`);
    const data = fs.readFileSync(local.path);
    (local.cleanup || (() => {}))();
    const signatureRandom = random16(); // upload 与 getResult 需使用同一随机串

    // 1. 上传（支持 mp3/wav/pcm/opus/flac/ogg，不支持 m4a——管线已统一转 mp3）
    const up = await xfFetch('/v2/upload', {
      appId,
      accessKeyId: apiKey,
      dateTime: dateTimeStr(),
      signatureRandom,
      fileName: filename,
      fileSize: String(data.length),
      durationCheckDisable: 'true',
      language: 'autodialect', // 中英 + 202 种方言免切换
      roleType: '1',           // 说话人分离
    }, { body: data, contentType: 'application/octet-stream' });
    const orderId = up.orderId;
    if (!orderId) throw new Error('讯飞上传未返回 orderId');

    // 2. 轮询结果
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 6000));
      const c = await xfFetch('/v2/getResult', {
        accessKeyId: apiKey,
        dateTime: dateTimeStr(),
        signatureRandom,
        orderId,
        resultType: 'transfer',
      }, { body: '{}', contentType: 'application/json' });
      const status = c.orderInfo && c.orderInfo.status;
      if (status === 4) return { language: 'zh', segments: parseResult(c.orderResult) };
      if (status === -1) throw new Error(`讯飞转写失败 failType=${c.orderInfo.failType}（1上传失败/2转码失败/3识别失败/5时长校验失败/6静音文件）`);
    }
    throw new Error('讯飞转写超时');
  },
};
