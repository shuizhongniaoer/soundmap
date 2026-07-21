// 音频/媒体容器签名校验，防止仅修改扩展名的非媒体文件进入处理管线。
const fs = require('fs');

const MIME_SIGNATURES = [
  { name: 'wav', test: bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE' },
  { name: 'flac', test: bytes => bytes.toString('ascii', 0, 4) === 'fLaC' },
  { name: 'ogg', test: bytes => bytes.toString('ascii', 0, 4) === 'OggS' },
  { name: 'webm', test: bytes => bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 },
  { name: 'amr', test: bytes => bytes.toString('ascii', 0, 6) === '#!AMR\n' || bytes.toString('ascii', 0, 9) === '#!AMR-WB\n' },
  {
    name: 'mp4',
    test: bytes => bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp',
  },
  {
    name: 'mp3',
    test: bytes => bytes.toString('ascii', 0, 3) === 'ID3'
      || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
  },
  {
    name: 'aac',
    test: bytes => bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0,
  },
];

function hasSupportedSignature(bytes) {
  return MIME_SIGNATURES.some(signature => signature.test(bytes));
}

async function isSupportedAudioFile(filePath) {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return hasSupportedSignature(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

module.exports = { hasSupportedSignature, isSupportedAudioFile };
