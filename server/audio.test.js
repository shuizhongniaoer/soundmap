const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hasSupportedSignature, isSupportedAudioFile } = require('./audio');

test('识别常见音频容器签名并拒绝伪造文件', async () => {
  const samples = [
    Buffer.from('RIFFxxxxWAVEfmt ', 'ascii'),
    Buffer.from('fLaC', 'ascii'),
    Buffer.from('OggS\0\0\0\0', 'ascii'),
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from('#!AMR\n', 'ascii'),
    Buffer.from('....ftypM4A ', 'ascii'),
    Buffer.from('ID3\0\0\0', 'ascii'),
    Buffer.from([0xff, 0xf1, 0x50, 0x80]),
  ];
  for (const sample of samples) assert.equal(hasSupportedSignature(sample), true);
  assert.equal(hasSupportedSignature(Buffer.from('this is not an audio file')), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundmap-audio-'));
  const valid = path.join(dir, 'voice.m4a');
  const invalid = path.join(dir, 'fake.m4a');
  fs.writeFileSync(valid, Buffer.from('....ftypM4A ', 'ascii'));
  fs.writeFileSync(invalid, Buffer.from('<html>not audio</html>', 'ascii'));
  assert.equal(await isSupportedAudioFile(valid), true);
  assert.equal(await isSupportedAudioFile(invalid), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
