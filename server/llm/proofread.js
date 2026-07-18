// Guard LLM proofreading so it can fix a few recognition errors without
// rewriting a sentence or copying an adjacent segment.

function editDistance(a, b) {
  const left = [...String(a)];
  const right = [...String(b)];
  let prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const cur = [i];
    for (let j = 1; j <= right.length; j++) {
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[right.length];
}

function compact(text) {
  return String(text || '').replace(/\s+/g, '');
}

function isSafeCorrection(before, after) {
  const oldText = compact(before);
  const newText = compact(after);
  if (!oldText || !newText || oldText === newText) return false;

  // Proofreading may adjust a few characters, but must not replace the sentence.
  const lengthDelta = Math.abs(oldText.length - newText.length);
  const maxLengthDelta = Math.max(2, Math.ceil(oldText.length * 0.15));
  if (lengthDelta > maxLengthDelta) return false;

  const distance = editDistance(oldText, newText);
  const maxDistance = Math.max(3, Math.ceil(oldText.length * 0.25));
  return distance <= maxDistance;
}

function applyCorrections(segments, corrections) {
  let fixed = 0;
  let rejected = 0;
  for (const correction of corrections) {
    const i = Number(correction && correction.i);
    const segment = Number.isInteger(i) ? segments[i] : null;
    const text = String((correction && correction.text) || '').trim();
    if (!segment || !isSafeCorrection(segment.text, text)) {
      rejected++;
      continue;
    }

    // An ASR can genuinely repeat itself, but proofreading must not manufacture
    // a duplicate by turning a different sentence into its neighbour.
    const previous = segments[i - 1] && compact(segments[i - 1].text);
    const next = segments[i + 1] && compact(segments[i + 1].text);
    const candidate = compact(text);
    if (candidate === previous || candidate === next) {
      rejected++;
      continue;
    }

    segment.orig = segment.text;
    segment.text = text;
    fixed++;
  }
  return { fixed, rejected };
}

module.exports = { editDistance, isSafeCorrection, applyCorrections };
