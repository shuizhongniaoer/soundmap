const test = require('node:test');
const assert = require('node:assert/strict');

test('signed media path verifies and rejects tampering', () => {
  process.env.MEDIA_SIGNING_SECRET = 'test-signing-secret';
  delete require.cache[require.resolve('./media')];
  const media = require('./media');
  const url = new URL(media.signedPath('sample.asr.mp3', 60), 'https://soundmap.test');
  assert.equal(media.verify('sample.asr.mp3', url.searchParams.get('expires'), url.searchParams.get('signature')), true);
  assert.equal(media.verify('another.mp3', url.searchParams.get('expires'), url.searchParams.get('signature')), false);
});
