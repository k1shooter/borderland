const crypto = require('crypto');

function now() {
  return Date.now();
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function hashToInt(input) {
  const hex = sha256(input).slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRng(...parts) {
  return mulberry32(hashToInt(parts.join('|')));
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(rng, arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sum(list) {
  return list.reduce((acc, value) => acc + value, 0);
}

function mean(list) {
  if (!list.length) return 0;
  return sum(list) / list.length;
}

function median(list) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function unique(arr) {
  return [...new Set(arr)];
}

function range(start, endInclusive) {
  const out = [];
  for (let i = start; i <= endInclusive; i += 1) out.push(i);
  return out;
}

function toPublicUser(player) {
  return {
    id: player.id,
    username: player.username,
    ready: !!player.ready,
    alive: player.alive !== false,
    isBot: !!player.isBot,
    connected: !!player.connected,
    score: player.score || 0,
    status: player.status || 'WAITING',
  };
}

function normalizeText(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function similarAnswer(answer, accepted) {
  const a = normalizeText(answer);
  const expected = Array.isArray(accepted) ? accepted.map(normalizeText) : [normalizeText(accepted)];
  return expected.includes(a);
}

function teamSplit(rng, players) {
  const shuffled = shuffle(rng, players);
  const left = [];
  const right = [];
  shuffled.forEach((player, index) => {
    if (index % 2 === 0) left.push(player.id);
    else right.push(player.id);
  });
  return { A: left, B: right };
}

function safeJSONClone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  now,
  sha256,
  createId,
  hashToInt,
  seededRng,
  randInt,
  choice,
  shuffle,
  clamp,
  sum,
  mean,
  median,
  unique,
  range,
  toPublicUser,
  normalizeText,
  similarAnswer,
  teamSplit,
  safeJSONClone,
};
