const { createId, now, seededRng, randInt, choice, shuffle, clamp, sum, mean, median, range, similarAnswer, teamSplit, safeJSONClone } = require('./helpers');

const SUITS = {
  S: 'spade',
  C: 'club',
  D: 'diamond',
  H: 'heart',
};

const SUIT_ICONS = {
  spade: '♠',
  club: '♣',
  diamond: '♦',
  heart: '♥',
};

const SELF_INTRO_TEMPLATES = [
  '저는 {{trait}}하고 {{trait2}}한 사람입니다. 최근에는 {{thing}}에 빠져 있습니다.',
  '제 특기는 {{thing}}이고, 남들이 저를 보면 {{trait}}하다고 말합니다.',
  '저는 {{place}}에서 왔고, 제 삶의 목표는 {{goal}}입니다.',
  '저는 스트레스를 받으면 {{thing}}을 하고, 쉬는 날엔 {{place}}에 갑니다.',
  '누군가 저를 한 단어로 표현한다면 {{trait}}일 것입니다.',
];

const WORD_BANK = {
  trait: ['차분', '과몰입', '눈치 빠른', '즉흥적', '논리적인', '비밀스러운', '완고한'],
  thing: ['새벽 산책', '카드 섞기', '퍼즐 풀기', '커피 연구', '러닝', '낙서', '실험'],
  place: ['도시 외곽', '바다 근처', '낡은 아파트', '학교 뒤 골목', '공장 지대'],
  goal: ['끝까지 살아남는 것', '모두를 속이는 것', '진짜 실력을 증명하는 것', '기억을 되찾는 것'],
};

const RELAY_CONCEPTS = [
  {
    answer: ['블랙홀', 'black hole'],
    segments: [
      '엄청난 중력 때문에 빛조차 빠져나가지 못한다.',
      '사건의 지평선이라는 경계 개념이 자주 함께 언급된다.',
      '별의 붕괴와 우주 관측, 그리고 왜곡된 시공간과 관련된다.',
    ],
  },
  {
    answer: ['도플갱어', 'doppelganger'],
    segments: [
      '자신과 매우 닮은 존재를 마주하는 불길한 상상이다.',
      '분신, 복제, 또 다른 나 같은 표현이 자주 따라붙는다.',
      '민담과 심리적 공포에서 모두 등장하는 개념이다.',
    ],
  },
  {
    answer: ['오로라', 'aurora'],
    segments: [
      '하늘에서 빛이 춤추는 자연 현상이다.',
      '주로 극지방과 태양풍, 자기장과 관련된다.',
      '녹색 또는 보랏빛 커튼처럼 보이는 경우가 많다.',
    ],
  },
  {
    answer: ['트로이 목마', 'trojan horse'],
    segments: [
      '겉보기에는 선물이나 무해한 것처럼 보인다.',
      '내부에 숨겨진 무언가가 핵심이다.',
      '고대 전쟁 일화와 컴퓨터 보안 용어 양쪽에 모두 쓰인다.',
    ],
  },
  {
    answer: ['메트로놈', 'metronome'],
    segments: [
      '일정한 박자를 알려주는 도구다.',
      '음악 연습, 템포 유지와 관련된다.',
      '좌우로 흔들리는 추 모양 이미지를 떠올리면 가깝다.',
    ],
  },
];

const ORDER_PUZZLES = [
  {
    entities: ['비', '안개', '천둥', '햇빛'],
    clues: [
      '안개는 첫 번째가 아니다.',
      '햇빛은 비보다 뒤에 있다.',
      '천둥은 마지막이다.',
      '비는 안개보다 앞선다.',
    ],
    answer: ['비', '안개', '햇빛', '천둥'],
  },
  {
    entities: ['파랑', '노랑', '빨강', '초록'],
    clues: [
      '초록은 노랑 바로 뒤다.',
      '파랑은 첫 번째다.',
      '빨강은 마지막이 아니다.',
      '노랑은 파랑보다 뒤에 있다.',
    ],
    answer: ['파랑', '노랑', '초록', '빨강'],
  },
  {
    entities: ['고양이', '여우', '사슴', '까마귀'],
    clues: [
      '까마귀는 첫 번째가 아니다.',
      '사슴은 고양이보다 뒤에 있다.',
      '여우는 마지막이다.',
      '까마귀는 고양이 바로 뒤다.',
    ],
    answer: ['고양이', '까마귀', '사슴', '여우'],
  },
];

const SEQUENCE_PUZZLES = [
  {
    symbols: ['△', '□', '○', '☆', '◆'],
    answer: ['□', '☆', '△', '◆', '○'],
    rules: [
      '□ 는 첫 번째다.',
      '☆ 는 △ 바로 앞이다.',
      '○ 는 마지막이다.',
      '◆ 는 ○ 바로 앞이다.',
    ],
  },
  {
    symbols: ['A', 'B', 'C', 'D', 'E'],
    answer: ['C', 'A', 'E', 'B', 'D'],
    rules: [
      'C 는 첫 번째다.',
      'A 는 E 앞이다.',
      'D 는 마지막이다.',
      'B 는 D 바로 앞이다.',
    ],
  },
  {
    symbols: ['1', '2', '3', '4', '5'],
    answer: ['2', '5', '1', '4', '3'],
    rules: [
      '2 는 가장 앞이다.',
      '5 는 1 바로 앞이다.',
      '4 는 3 바로 앞이다.',
      '3 은 마지막이다.',
    ],
  },
];

const GRID_PATH_PUZZLES = [
  {
    size: 4,
    start: [0, 0],
    end: [3, 3],
    walls: [[1, 0], [1, 1], [2, 2]],
    clue: '오른쪽으로 두 번, 아래로 두 번, 오른쪽 한 번, 아래 한 번이 가능한 유일 경로다.',
    answer: 'RRDDRD',
  },
  {
    size: 4,
    start: [0, 3],
    end: [3, 0],
    walls: [[1, 3], [2, 1], [2, 3]],
    clue: '아래로 한 번 내려간 뒤 중앙을 크게 돌아 나와야 한다.',
    answer: 'LDDLLD',
  },
  {
    size: 5,
    start: [0, 2],
    end: [4, 2],
    walls: [[1, 2], [2, 2], [3, 1], [3, 3]],
    clue: '시작 직후 옆으로 빠져 내려가야 하며, 마지막에는 가운데로 복귀한다.',
    answer: 'RDDRDDL',
  },
];

const TRUTH_LEDGER_PUZZLES = [
  {
    statements: [
      'A: B는 거짓말쟁이다.',
      'B: C와 D는 같은 편이다.',
      'C: A는 진실을 말한다.',
      'D: B는 진실을 말하지 않는다.',
    ],
    liars: ['B', 'C'],
  },
  {
    statements: [
      'A: D는 거짓말쟁이다.',
      'B: A와 C 중 정확히 한 명만 진실이다.',
      'C: B는 거짓말쟁이다.',
      'D: C는 진실을 말한다.',
    ],
    liars: ['A', 'D'],
  },
  {
    statements: [
      'A: B와 C는 서로 다른 진영이다.',
      'B: A는 거짓말한다.',
      'C: D는 거짓말하지 않는다.',
      'D: B는 진실이다.',
    ],
    liars: ['C', 'D'],
  },
];

const CIRCUIT_PUZZLES = [
  {
    switches: ['A', 'B', 'C'],
    text: [
      '출력 = (A XOR B) AND C',
      '출력이 1이 되게 하는 스위치 조합을 고르라.',
    ],
    answer: { A: 1, B: 0, C: 1 },
  },
  {
    switches: ['A', 'B', 'C', 'D'],
    text: [
      '출력 = (A OR B) AND (NOT C) AND D',
      '출력이 1이 되는 최소 ON 조합을 고르라.',
    ],
    answer: { A: 1, B: 0, C: 0, D: 1 },
  },
  {
    switches: ['A', 'B', 'C', 'D'],
    text: [
      '보조등 = A AND B',
      '출력 = (보조등 OR C) AND (NOT D)',
      '최종 출력이 1이 되는 한 가지 조합을 제출하라.',
    ],
    answer: { A: 1, B: 1, C: 0, D: 0 },
  },
];

const YES_NO_QUESTION_BANK = [
  '당신은 다시 태어나도 지금의 직업을 고를 것인가?',
  '친한 친구가 범죄를 저질렀다면 신고할 것인가?',
  '기억을 일부 잃더라도 지금보다 더 행복해질 수 있다면 선택할 것인가?',
  '큰돈을 벌 수 있다면 1년 동안 휴대폰 없이 살 수 있는가?',
  '진실을 아는 것이 항상 행복보다 중요한가?',
];

const ORDER_ACTIONS = ['left', 'right', 'hold'];
const RPS = ['rock', 'paper', 'scissors'];
const ANIMALS = ['원숭이', '두더지', '삼색고양이', '사자', '오랑우탄'];
const ANIMAL_POINTS = { '원숭이': 1, '두더지': 2, '삼색고양이': 3, '사자': 4, '오랑우탄': 5 };

const PHYSICAL_CONFIGS = {
  S1: { challengeType: 'target-hold', seconds: 75, passRule: 'holdRatio >= 0.68 && maxOutMs <= 1200' },
  S2: { challengeType: 'rhythm', seconds: 90, passRule: 'accuracy >= 0.72 || combo >= 25' },
  S3: { challengeType: 'runner', seconds: 90, passRule: 'distance >= 1200 && crashes < 3' },
  S4: { challengeType: 'voice-band', seconds: 60, passRule: 'bandRatio >= 0.65' },
  S5: { challengeType: 'mouse-dodge', seconds: 80, passRule: 'cores >= 3 && health > 0' },
  S6: { challengeType: 'balance-wire', seconds: 60, passRule: 'stability >= 70 || complete === true' },
  S7: { challengeType: 'alternate-mash', seconds: 70, passRule: 'charge >= 100 && overheat < 5' },
  S8: { challengeType: 'memory-runner', seconds: 80, passRule: 'segmentsCleared >= 2' },
  S9: { challengeType: 'gravity-runner', seconds: 100, passRule: 'score >= 1600 or topHalf' },
  S10: { challengeType: 'gauntlet', seconds: 180, passRule: 'totalScore >= 240 or topFortyPercent' },
};

function createBaseSession(game, players) {
  const rng = seededRng(game.code, now(), players.map((p) => p.id).join(','));
  const playerMap = {};
  players.forEach((player) => {
    playerMap[player.id] = {
      id: player.id,
      username: player.username,
      isBot: !!player.isBot,
      alive: true,
      score: 0,
    };
  });
  return {
    id: createId('session'),
    cardCode: game.code,
    gameName: game.name,
    suit: game.suit,
    engine: game.engine,
    difficulty: game.difficulty,
    players: safeJSONClone(players),
    playerMap,
    aliveIds: players.map((p) => p.id),
    deadIds: [],
    status: 'running',
    round: 1,
    phase: 'briefing',
    deadline: now() + 12000,
    chatEnabled: true,
    createdAt: now(),
    log: [`${SUIT_ICONS[game.suit]} ${game.code} ${game.name} 시작`],
    publicData: {},
    privateData: {},
    submissions: {},
    result: null,
    rngSeed: `${game.code}-${now()}`,
    rng,
  };
}

function livingIds(session) {
  return session.aliveIds.filter((id) => !session.deadIds.includes(id));
}

function isAlive(session, playerId) {
  return livingIds(session).includes(playerId);
}

function killPlayers(session, ids, reason) {
  ids.forEach((id) => {
    if (session.deadIds.includes(id)) return;
    session.deadIds.push(id);
    session.aliveIds = session.aliveIds.filter((aliveId) => aliveId !== id);
  });
  if (reason) session.log.push(reason);
}

function finishSession(session, winners, summary, extra = {}) {
  const uniqueWinners = [...new Set(winners.filter(Boolean))];
  session.status = 'complete';
  session.phase = 'complete';
  session.deadline = null;
  session.chatEnabled = false;
  session.result = {
    winners: uniqueWinners,
    losers: session.players.map((p) => p.id).filter((id) => !uniqueWinners.includes(id)),
    summary,
    ...extra,
  };
  session.log.push(summary);
}

function setPhase(session, phase, seconds, chatEnabled = false, clearSubmissions = true) {
  session.phase = phase;
  session.deadline = seconds ? now() + seconds * 1000 : null;
  session.chatEnabled = chatEnabled;
  if (clearSubmissions) session.submissions = {};
}

function activeOrder(session) {
  return session.players.map((p) => p.id).filter((id) => !session.deadIds.includes(id));
}

function publicPlayers(session) {
  return session.players.map((player) => ({
    id: player.id,
    username: player.username,
    alive: !session.deadIds.includes(player.id),
    isBot: !!player.isBot,
  }));
}

function randomName(rng) {
  const prefix = choice(rng, ['네온', '무음', '적색', '심판', '베일', '도약', '무전', '암전']);
  const suffix = choice(rng, ['방', '회로', '단서', '신호', '칩', '계약', '포트', '구역']);
  return `${prefix}${suffix}`;
}

function sampleWord(rng, key) {
  return choice(rng, WORD_BANK[key]);
}

function generateIntroText(rng) {
  const template = choice(rng, SELF_INTRO_TEMPLATES);
  return template
    .replace('{{trait}}', sampleWord(rng, 'trait'))
    .replace('{{trait2}}', sampleWord(rng, 'trait'))
    .replace('{{thing}}', sampleWord(rng, 'thing'))
    .replace('{{place}}', sampleWord(rng, 'place'))
    .replace('{{goal}}', sampleWord(rng, 'goal'));
}

function distributeRules(rng, rules, playerIds) {
  const out = {};
  playerIds.forEach((id) => { out[id] = []; });
  shuffle(rng, rules).forEach((rule, idx) => {
    out[playerIds[idx % playerIds.length]].push(rule);
  });
  return out;
}

function nearestInt(value) {
  return Math.round(value);
}

function majorityChoice(answers) {
  const counts = {};
  answers.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0] ? entries[0][0] : null;
}

function relativeOrder(order, offset, direction) {
  if (!order.length) return null;
  const index = order.indexOf(offset);
  if (index === -1) return null;
  if (direction === 'left') return order[(index - 1 + order.length) % order.length];
  if (direction === 'right') return order[(index + 1) % order.length];
  return offset;
}

function createPhysicalSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.metrics = {};
  session.publicData.config = PHYSICAL_CONFIGS[game.code];
  setPhase(session, 'play', PHYSICAL_CONFIGS[game.code].seconds + 20, false);
  session.log.push('피지컬 챌린지 시작');
  return session;
}

function resolvePhysical(session) {
  const metrics = session.privateData.metrics || {};
  const playerIds = livingIds(session);
  const scores = playerIds.map((playerId) => ({ playerId, m: metrics[playerId] || {} }));
  let winners = [];
  if (session.cardCode === 'S1') winners = scores.filter(({ m }) => (m.holdRatio || 0) >= 0.68 && (m.maxOutMs || 999999) <= 1200).map((x) => x.playerId);
  if (session.cardCode === 'S2') winners = scores.filter(({ m }) => (m.accuracy || 0) >= 0.72 || (m.combo || 0) >= 25).map((x) => x.playerId);
  if (session.cardCode === 'S3') winners = scores.filter(({ m }) => (m.distance || 0) >= 1200 && (m.crashes || 99) < 3).map((x) => x.playerId);
  if (session.cardCode === 'S4') winners = scores.filter(({ m }) => (m.bandRatio || 0) >= 0.65).map((x) => x.playerId);
  if (session.cardCode === 'S5') winners = scores.filter(({ m }) => (m.cores || 0) >= 3 && (m.health || 0) > 0).map((x) => x.playerId);
  if (session.cardCode === 'S6') winners = scores.filter(({ m }) => (m.stability || 0) >= 70 || !!m.complete).map((x) => x.playerId);
  if (session.cardCode === 'S7') winners = scores.filter(({ m }) => (m.charge || 0) >= 100 && (m.overheat || 99) < 5).map((x) => x.playerId);
  if (session.cardCode === 'S8') winners = scores.filter(({ m }) => (m.segmentsCleared || 0) >= 2).map((x) => x.playerId);
  if (session.cardCode === 'S9') {
    const threshold = median(scores.map(({ m }) => m.score || 0));
    winners = scores.filter(({ m }) => (m.score || 0) >= Math.max(1600, threshold)).map((x) => x.playerId);
  }
  if (session.cardCode === 'S10') {
    const sorted = [...scores].sort((a, b) => (b.m.totalScore || 0) - (a.m.totalScore || 0));
    const cut = Math.max(1, Math.ceil(sorted.length * 0.4));
    winners = sorted.filter((item, idx) => (item.m.totalScore || 0) >= 240 || idx < cut).map((x) => x.playerId);
  }
  killPlayers(session, session.players.map((p) => p.id).filter((id) => !winners.includes(id)), '피지컬 게임 결과 반영');
  finishSession(session, winners, `${session.cardCode} 결과 공개 - 생존자 ${winners.length}명`, { metrics });
}

function createSyncPressSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.cueAt = now() + randInt(session.rng, 4000, 9000);
  setPhase(session, 'listen', 12, false);
  return session;
}

function resolveSyncPress(session) {
  const presses = livingIds(session).map((id) => session.submissions[id]).filter(Boolean);
  const cueAt = session.publicData.cueAt;
  const valid = presses.length === livingIds(session).length
    && presses.every((item) => item.serverAt >= cueAt && item.serverAt - cueAt <= 700);
  const spread = presses.length ? Math.max(...presses.map((p) => p.serverAt)) - Math.min(...presses.map((p) => p.serverAt)) : 9999;
  const winners = valid && spread <= 400 ? livingIds(session) : [];
  if (!winners.length) killPlayers(session, livingIds(session), '동기화 실패 - 전원 탈락');
  finishSession(session, winners, winners.length ? '완벽한 동기화 성공' : '신호 동기화 실패', { presses, cueAt, spread });
}

function createCardPassSession(game, players) {
  const session = createBaseSession(game, players);
  const n = players.length;
  const deck = [];
  range(0, n).forEach((value) => {
    deck.push(value, value, value, value);
  });
  const shuffled = shuffle(session.rng, deck);
  session.privateData.removed = shuffled.splice(0, 4);
  session.privateData.hands = {};
  players.forEach((player) => {
    session.privateData.hands[player.id] = shuffled.splice(0, 4);
  });
  session.publicData.order = players.map((p) => p.id);
  session.publicData.passRound = 1;
  setPhase(session, 'pass', 90, true);
  return session;
}

function applyCardPass(session) {
  const order = session.publicData.order;
  const outgoing = {};
  order.forEach((playerId) => {
    const hand = session.privateData.hands[playerId];
    const chosenIndex = clamp(parseInt(session.submissions[playerId]?.cardIndex, 10) || 0, 0, hand.length - 1);
    const [card] = hand.splice(chosenIndex, 1);
    outgoing[playerId] = card;
  });
  order.forEach((playerId, index) => {
    const nextId = order[(index + 1) % order.length];
    session.privateData.hands[nextId].push(outgoing[playerId]);
  });
  if (session.publicData.passRound >= 2) {
    const removedSum = sum(session.privateData.removed);
    const winners = [];
    order.forEach((playerId) => {
      const hand = session.privateData.hands[playerId];
      const counts = {};
      hand.forEach((num) => { counts[num] = (counts[num] || 0) + 1; });
      const pairValue = Object.entries(counts).find(([, count]) => count === 2);
      let scored = [...hand];
      if (pairValue) {
        let replaced = 0;
        scored = scored.map((num) => {
          if (num === parseInt(pairValue[0], 10) && replaced < 2) {
            replaced += 1;
            return order.length;
          }
          return num;
        });
      }
      const total = sum(scored);
      session.playerMap[playerId].score = total;
      if (total >= removedSum) winners.push(playerId);
    });
    killPlayers(session, order.filter((id) => !winners.includes(id)), '럭키 페어 기준 미달 탈락');
    finishSession(session, winners, `제외 카드 합 ${removedSum} 이상인 플레이어 생존`, {
      removed: session.privateData.removed,
      hands: session.privateData.hands,
    });
  } else {
    session.publicData.passRound += 1;
    setPhase(session, 'pass', 90, true);
  }
}

function createRelayInferenceSession(game, players) {
  const session = createBaseSession(game, players);
  const concept = choice(session.rng, RELAY_CONCEPTS);
  const order = shuffle(session.rng, players.map((p) => p.id));
  session.publicData.order = order;
  session.privateData.answer = concept.answer;
  session.privateData.segments = {};
  order.forEach((id, idx) => {
    session.privateData.segments[id] = concept.segments[idx] || concept.segments[concept.segments.length - 1];
  });
  setPhase(session, 'answer', 120, true);
  return session;
}

function resolveRelayInference(session) {
  const answers = livingIds(session).map((id) => session.submissions[id]?.answer || '');
  const allCorrect = livingIds(session).every((id) => similarAnswer(session.submissions[id]?.answer || '', session.privateData.answer));
  const winners = allCorrect ? livingIds(session) : [];
  if (!winners.length) killPlayers(session, livingIds(session), '릴레이 추론 실패');
  finishSession(session, winners, allCorrect ? '세 플레이어 모두 정답' : '한 명 이상 오답');
}

function createBinaryBalanceSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.order = shuffle(session.rng, players.map((p) => p.id));
  session.publicData.turnIndex = 0;
  session.privateData.bias = {};
  setPhase(session, 'ask', 60, true);
  return session;
}

function currentAsker(session) {
  return session.publicData.order[session.publicData.turnIndex];
}

function advanceBinaryBalance(session) {
  const askerId = currentAsker(session);
  const aliveResponders = session.players.map((p) => p.id).filter((id) => id !== askerId);
  const answers = [];
  aliveResponders.forEach((id) => {
    if (session.deadIds.includes(id) && session.privateData.bias[id]) {
      answers.push(session.privateData.bias[id]);
    } else {
      answers.push(session.submissions[id]?.answer || choice(session.rng, ['yes', 'no']));
    }
  });
  const yes = answers.filter((a) => a === 'yes').length;
  const no = answers.filter((a) => a === 'no').length;
  if (yes !== no) {
    const majority = yes > no ? 'yes' : 'no';
    killPlayers(session, [askerId], `${session.playerMap[askerId].username} 질문 실패로 탈락`);
    session.privateData.bias[askerId] = majority;
  } else {
    session.log.push(`${session.playerMap[askerId].username} 질문 성공`);
  }
  session.publicData.turnIndex += 1;
  if (session.publicData.turnIndex >= session.publicData.order.length) {
    finishSession(session, livingIds(session), '밸런싱 게임 종료');
  } else {
    setPhase(session, 'ask', 60, true);
  }
}

function createMapConsensusSession(game, players) {
  const session = createBaseSession(game, players);
  const safeIndex = randInt(session.rng, 0, 8);
  const row = Math.floor(safeIndex / 3) + 1;
  const col = (safeIndex % 3) + 1;
  const kind = safeIndex === 4 ? '중앙' : ([0, 2, 6, 8].includes(safeIndex) ? '모서리' : '변');
  const clues = [
    `출구는 ${row}행에 있다.`,
    `출구는 ${col}열에 있다.`,
    `출구는 ${kind} 칸이다.`,
    `출구 번호는 ${safeIndex + 1}번 칸이다.`,
  ];
  const distributed = distributeRules(session.rng, clues, players.map((p) => p.id));
  session.privateData.safeIndex = safeIndex;
  session.privateData.clues = distributed;
  setPhase(session, 'choose', 120, true);
  return session;
}

function resolveMapConsensus(session) {
  const picks = livingIds(session).map((id) => parseInt(session.submissions[id]?.cell, 10));
  const unanimous = picks.every((pick) => pick === picks[0]);
  const winners = unanimous && picks[0] === session.privateData.safeIndex ? livingIds(session) : [];
  if (!winners.length) killPlayers(session, livingIds(session), '잘못된 출구 선택');
  finishSession(session, winners, winners.length ? '정답 출구 합의 성공' : '합의 실패 혹은 오답');
}

function createTeamContributionSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.teams = teamSplit(session.rng, players);
  session.privateData.tokens = {};
  session.privateData.totalContributed = {};
  players.forEach((player) => {
    session.privateData.tokens[player.id] = 30;
    session.privateData.totalContributed[player.id] = 0;
  });
  session.publicData.teamWins = { A: 0, B: 0 };
  session.publicData.round = 1;
  session.privateData.roundHistory = [];
  setPhase(session, 'contribute', 90, true);
  return session;
}

function finalizeTeamContribution(session) {
  const totals = { A: 0, B: 0 };
  ['A', 'B'].forEach((teamName) => {
    session.publicData.teams[teamName].forEach((playerId) => {
      totals[teamName] += session.privateData.totalContributed[playerId];
    });
  });
  let winningTeam = null;
  if (session.publicData.teamWins.A > session.publicData.teamWins.B) winningTeam = 'A';
  else if (session.publicData.teamWins.B > session.publicData.teamWins.A) winningTeam = 'B';
  else if (totals.A > totals.B) winningTeam = 'A';
  else if (totals.B > totals.A) winningTeam = 'B';
  if (!winningTeam) {
    killPlayers(session, livingIds(session), '최종 동률로 모두 탈락');
    finishSession(session, [], '의리 기부 - 최종 동률');
    return;
  }
  const losingTeam = winningTeam === 'A' ? 'B' : 'A';
  const winners = [];
  const winTeamPlayers = session.publicData.teams[winningTeam];
  const loseTeamPlayers = session.publicData.teams[losingTeam];
  const winContribs = winTeamPlayers.map((id) => session.privateData.totalContributed[id]);
  const loseContribs = loseTeamPlayers.map((id) => session.privateData.totalContributed[id]);
  const minWin = Math.min(...winContribs);
  const maxLose = Math.max(...loseContribs);
  const minWinPlayers = winTeamPlayers.filter((id) => session.privateData.totalContributed[id] === minWin);
  const maxLosePlayers = loseTeamPlayers.filter((id) => session.privateData.totalContributed[id] === maxLose);
  winTeamPlayers.forEach((id) => { if (!minWinPlayers.includes(id)) winners.push(id); });
  if (maxLosePlayers.length === 1) winners.push(maxLosePlayers[0]);
  if (maxLosePlayers.length !== 1) {
    session.log.push('패배 팀 최고 기여 동률 - 패배 팀 전원 탈락');
  }
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '의리 기부 최종 판정');
  finishSession(session, winners, `승리 팀 ${winningTeam} 확정`);
}

function applyContributionRound(session) {
  const roundTotals = { A: 0, B: 0 };
  ['A', 'B'].forEach((teamName) => {
    session.publicData.teams[teamName].forEach((playerId) => {
      const remaining = session.privateData.tokens[playerId];
      const value = clamp(parseInt(session.submissions[playerId]?.amount, 10) || 0, 0, remaining);
      session.privateData.tokens[playerId] -= value;
      session.privateData.totalContributed[playerId] += value;
      roundTotals[teamName] += value;
    });
  });
  if (roundTotals.A > roundTotals.B) session.publicData.teamWins.A += 1;
  else if (roundTotals.B > roundTotals.A) session.publicData.teamWins.B += 1;
  session.privateData.roundHistory.push(roundTotals);
  if (session.publicData.teamWins.A >= 3 || session.publicData.teamWins.B >= 3 || session.publicData.round >= 5) {
    finalizeTeamContribution(session);
  } else {
    session.publicData.round += 1;
    setPhase(session, 'contribute', 90, true);
  }
}

function createSequenceAssemblySession(game, players) {
  const session = createBaseSession(game, players);
  const puzzle = choice(session.rng, SEQUENCE_PUZZLES);
  session.publicData.symbols = puzzle.symbols;
  session.privateData.answer = puzzle.answer;
  session.privateData.rules = distributeRules(session.rng, puzzle.rules, players.map((p) => p.id));
  setPhase(session, 'assemble', 120, true);
  return session;
}

function resolveSequenceAssembly(session) {
  const answers = livingIds(session).map((id) => session.submissions[id]?.order || []);
  const normalized = answers.map((order) => Array.isArray(order) ? order.join(',') : String(order));
  const unanimous = normalized.every((value) => value === normalized[0]);
  const correct = normalized[0] === session.privateData.answer.join(',');
  const winners = unanimous && correct ? livingIds(session) : [];
  if (!winners.length) killPlayers(session, livingIds(session), '침묵 조립 실패');
  finishSession(session, winners, winners.length ? '정답 순서 조립 성공' : '정답 불일치');
}

function createLoadSharingSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.capacity = {};
  session.privateData.weakWave = {};
  players.forEach((player) => {
    session.privateData.capacity[player.id] = randInt(session.rng, 4, 8);
    session.privateData.weakWave[player.id] = randInt(session.rng, 1, 3);
  });
  session.publicData.wave = 1;
  setPhase(session, 'allocate', 90, true);
  return session;
}

function resolveLoadSharingWave(session) {
  const alive = livingIds(session);
  const wave = session.publicData.wave;
  const requirement = alive.length * 3 + wave;
  let total = 0;
  let overloaded = false;
  alive.forEach((id) => {
    const load = clamp(parseInt(session.submissions[id]?.load, 10) || 0, 0, 8);
    total += load;
    const max = session.privateData.weakWave[id] === wave ? Math.min(2, session.privateData.capacity[id]) : session.privateData.capacity[id];
    if (load > max) overloaded = true;
  });
  const success = !overloaded && total >= requirement && total <= requirement + 2;
  if (!success) {
    killPlayers(session, alive, `하중 분담 실패 - 총합 ${total}, 목표 ${requirement}`);
    finishSession(session, [], '하중 분담 실패');
    return;
  }
  if (wave >= 3) {
    finishSession(session, alive, '3웨이브 모두 통과');
  } else {
    session.publicData.wave += 1;
    setPhase(session, 'allocate', 90, true);
  }
}

function createTrustChainSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.energy = {};
  players.forEach((player) => { session.privateData.energy[player.id] = 4; });
  session.publicData.wave = 1;
  setPhase(session, 'distribute', 90, true);
  return session;
}

function resolveTrustChainWave(session) {
  const alive = livingIds(session);
  const incoming = {};
  alive.forEach((id) => { incoming[id] = 0; });
  alive.forEach((id) => {
    const dist = session.submissions[id]?.distribution || {};
    const total = Object.values(dist).reduce((acc, value) => acc + (parseInt(value, 10) || 0), 0);
    const factor = total === 0 ? 0 : 4 / total;
    Object.entries(dist).forEach(([targetId, value]) => {
      if (!alive.includes(targetId) || targetId === id) return;
      incoming[targetId] += Math.round((parseInt(value, 10) || 0) * factor);
    });
  });
  alive.forEach((id) => {
    session.privateData.energy[id] = session.privateData.energy[id] + incoming[id] - 4;
  });
  const failed = alive.some((id) => session.privateData.energy[id] < 1);
  if (failed) {
    killPlayers(session, alive, '신뢰 사슬 붕괴');
    finishSession(session, [], '에너지 임계치 미만 발생');
    return;
  }
  if (session.publicData.wave >= 4) {
    finishSession(session, alive, '신뢰 사슬 유지 성공');
  } else {
    session.publicData.wave += 1;
    setPhase(session, 'distribute', 90, true);
  }
}

function createRouteConsensusSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.checkpoint = 1;
  session.privateData.paths = {};
  session.privateData.clues = {};
  const ids = players.map((p) => p.id);
  range(1, 3).forEach((cp) => {
    const correct = choice(session.rng, ['A', 'B', 'C']);
    session.privateData.paths[cp] = correct;
    const clues = [
      `체크포인트 ${cp}의 정답은 ${correct}다.`,
      `체크포인트 ${cp}에서 ${correct === 'A' ? 'B와 C는 오답이다.' : correct === 'B' ? 'A와 C는 오답이다.' : 'A와 B는 오답이다.'}`,
    ];
    const distributed = distributeRules(session.rng, clues, ids);
    ids.forEach((id) => {
      if (!session.privateData.clues[id]) session.privateData.clues[id] = [];
      session.privateData.clues[id].push(...distributed[id]);
    });
  });
  setPhase(session, 'route-select', 120, true);
  return session;
}

function resolveRouteConsensusCheckpoint(session) {
  const cp = session.publicData.checkpoint;
  const picks = livingIds(session).map((id) => session.submissions[id]?.route);
  const unanimous = picks.every((pick) => pick === picks[0]);
  if (!unanimous || picks[0] !== session.privateData.paths[cp]) {
    killPlayers(session, livingIds(session), `체크포인트 ${cp} 실패`);
    finishSession(session, [], '무전 없는 대피 실패');
    return;
  }
  if (cp >= 3) {
    finishSession(session, livingIds(session), '모든 체크포인트 통과');
  } else {
    session.publicData.checkpoint += 1;
    setPhase(session, 'route-select', 90, true);
  }
}

function createCodebreakSession(game, players) {
  const session = createBaseSession(game, players);
  const code = range(1, 4).map(() => randInt(session.rng, 1, 6));
  session.privateData.code = code;
  session.privateData.attempts = {};
  session.privateData.hints = {};
  players.forEach((player) => {
    session.privateData.attempts[player.id] = 5;
    session.privateData.hints[player.id] = [];
  });
  setPhase(session, 'codebreak', 180, true);
  return session;
}

function codebreakHint(secret, guess) {
  let exact = 0;
  let colorOnly = 0;
  const remainingSecret = [];
  const remainingGuess = [];
  secret.forEach((digit, idx) => {
    if (digit === guess[idx]) exact += 1;
    else {
      remainingSecret.push(digit);
      remainingGuess.push(guess[idx]);
    }
  });
  remainingGuess.forEach((digit) => {
    const matchIndex = remainingSecret.indexOf(digit);
    if (matchIndex >= 0) {
      colorOnly += 1;
      remainingSecret.splice(matchIndex, 1);
    }
  });
  return { exact, colorOnly };
}

function submitCodebreak(session, playerId, payload) {
  if (!isAlive(session, playerId)) return;
  const digits = Array.isArray(payload?.digits) ? payload.digits.map((d) => clamp(parseInt(d, 10) || 1, 1, 6)) : [];
  if (digits.length !== 4) return;
  session.privateData.attempts[playerId] -= 1;
  const hint = codebreakHint(session.privateData.code, digits);
  session.privateData.hints[playerId].push({ guess: digits, hint });
  if (digits.join(',') === session.privateData.code.join(',')) {
    session.playerMap[playerId].score = 1;
  } else if (session.privateData.attempts[playerId] <= 0) {
    killPlayers(session, [playerId], `${session.playerMap[playerId].username} 코드 해독 실패`);
  }
  const alive = livingIds(session);
  const unresolvedAlive = alive.filter((id) => session.playerMap[id].score !== 1);
  if (!unresolvedAlive.length || now() > session.deadline) {
    const winners = alive.filter((id) => session.playerMap[id].score === 1);
    finishSession(session, winners, `컬러 코드 락 종료 - ${winners.length}명 성공`);
  }
}

function createPuzzleOrderSession(game, players) {
  const session = createBaseSession(game, players);
  const puzzle = choice(session.rng, ORDER_PUZZLES);
  session.publicData.entities = puzzle.entities;
  session.publicData.clues = puzzle.clues;
  session.privateData.answer = puzzle.answer;
  setPhase(session, 'order', 150, true);
  return session;
}

function resolvePuzzleOrder(session) {
  const winners = livingIds(session).filter((id) => {
    const answer = session.submissions[id]?.order || [];
    return Array.isArray(answer) && answer.join(',') === session.privateData.answer.join(',');
  });
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '순서 법정 오답');
  finishSession(session, winners, `정답 순서: ${session.privateData.answer.join(' -> ')}`);
}

function createEstimateAuctionSession(game, players) {
  const session = createBaseSession(game, players);
  const counts = {
    spade: randInt(session.rng, 2, 8),
    club: randInt(session.rng, 2, 8),
    diamond: randInt(session.rng, 2, 8),
    heart: randInt(session.rng, 2, 8),
  };
  const actual = counts.heart;
  const deck = [];
  Object.entries(counts).forEach(([suit, count]) => {
    for (let i = 0; i < count; i += 1) deck.push(suit);
  });
  const sample = shuffle(session.rng, deck).slice(0, Math.min(6, deck.length));
  session.privateData.actual = actual;
  session.publicData.sample = sample;
  setPhase(session, 'estimate', 120, true);
  return session;
}

function resolveEstimateAuction(session) {
  const winners = [];
  livingIds(session).forEach((id) => {
    const estimate = clamp(parseInt(session.submissions[id]?.estimate, 10) || 0, 0, 20);
    const risk = clamp(parseInt(session.submissions[id]?.risk, 10) || 1, 1, 5);
    const score = Math.abs(estimate - session.privateData.actual) * risk;
    session.playerMap[id].score = 10 - score;
    if (score <= 4) winners.push(id);
  });
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '빈도 경매 기준 미달');
  finishSession(session, winners, `정답 heart 수: ${session.privateData.actual}`);
}

function createGridPathSession(game, players) {
  const session = createBaseSession(game, players);
  const puzzle = choice(session.rng, GRID_PATH_PUZZLES);
  session.publicData.puzzle = puzzle;
  session.privateData.answer = puzzle.answer;
  setPhase(session, 'grid-path', 150, true);
  return session;
}

function resolveGridPath(session) {
  const winners = livingIds(session).filter((id) => {
    const path = String(session.submissions[id]?.path || '').trim().toUpperCase();
    return path === session.privateData.answer;
  });
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '미러 미로 오답');
  finishSession(session, winners, `정답 경로: ${session.privateData.answer}`);
}

function createTruthLedgerSession(game, players) {
  const session = createBaseSession(game, players);
  const puzzle = choice(session.rng, TRUTH_LEDGER_PUZZLES);
  session.publicData.statements = puzzle.statements;
  session.privateData.liars = puzzle.liars;
  setPhase(session, 'truth-ledger', 150, true);
  return session;
}

function resolveTruthLedger(session) {
  const winners = livingIds(session).filter((id) => {
    const picks = (session.submissions[id]?.liars || []).slice().sort().join(',');
    return picks === session.privateData.liars.slice().sort().join(',');
  });
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '진술 장부 오답');
  finishSession(session, winners, `정답 거짓말쟁이: ${session.privateData.liars.join(', ')}`);
}

function createWeightedAverageSession(game, players) {
  const session = createBaseSession(game, players);
  const target = randInt(session.rng, 1, 9);
  session.privateData.target = target;
  session.privateData.clues = {};
  players.forEach((player) => {
    const clues = [];
    clues.push(target % 2 === 0 ? '비밀 수요 수치는 짝수다.' : '비밀 수요 수치는 홀수다.');
    clues.push(target >= 5 ? '비밀 수요 수치는 5 이상이다.' : '비밀 수요 수치는 4 이하이다.');
    const wrong = clamp(target + choice(session.rng, [-2, -1, 1, 2]), 1, 9);
    clues.push(`비밀 수요 수치는 ${wrong}이 아니다.`);
    session.privateData.clues[player.id] = shuffle(session.rng, clues).slice(0, 2);
  });
  setPhase(session, 'weighted-average', 150, true);
  return session;
}

function resolveWeightedAverage(session) {
  const submissions = livingIds(session).map((id) => ({
    id,
    value: clamp(parseInt(session.submissions[id]?.value, 10) || 1, 1, 9),
    weight: clamp(parseInt(session.submissions[id]?.weight, 10) || 1, 1, 3),
  }));
  const totalWeight = sum(submissions.map((x) => x.weight)) || 1;
  const average = submissions.reduce((acc, current) => acc + current.value * current.weight, 0) / totalWeight;
  const winners = [];
  submissions.forEach(({ id, value }) => {
    const score = 10 - Math.abs(value - session.privateData.target) * 2 - Math.abs(average - session.privateData.target);
    session.playerMap[id].score = score;
    if (score >= 6) winners.push(id);
  });
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '가중 평균 시장 기준 미달');
  finishSession(session, winners, `비밀 수요: ${session.privateData.target}, 시장 평균: ${average.toFixed(2)}`);
}

function createNumberBingoSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.boards = {};
  players.forEach((player) => {
    const diag = shuffle(session.rng, range(1, 9)).slice(0, 2);
    session.privateData.boards[player.id] = {
      numbers: [diag[0], null, null, diag[1]],
      filled: [false, false, false, false],
      locked: [true, false, false, true],
    };
  });
  setPhase(session, 'bingo-setup', 120, true);
  return session;
}

function maybeFillBingoBoards(session) {
  livingIds(session).forEach((id) => {
    const board = session.privateData.boards[id];
    const picks = Array.isArray(session.submissions[id]?.choices) ? session.submissions[id].choices.map((x) => parseInt(x, 10)).filter(Boolean) : [];
    const available = range(1, 9).filter((num) => !board.numbers.includes(num));
    const chosen = picks.filter((num) => available.includes(num)).slice(0, 2);
    while (chosen.length < 2) {
      const next = available.find((num) => !chosen.includes(num));
      if (next === undefined) break;
      chosen.push(next);
    }
    board.numbers[1] = chosen[0];
    board.numbers[2] = chosen[1];
  });
}

function applyBingoTurn(session) {
  const guesses = livingIds(session).map((id) => clamp(parseInt(session.submissions[id]?.number, 10) || 1, 1, 9));
  const target = nearestInt(mean(guesses));
  livingIds(session).forEach((id) => {
    const board = session.privateData.boards[id];
    board.numbers.forEach((num, idx) => {
      if (num === target) board.filled[idx] = true;
      if (Math.abs(num - target) === 1) board.filled[idx] = false;
    });
  });
  if (session.publicData.turn >= 5) {
    const winners = livingIds(session).filter((id) => {
      const filled = session.privateData.boards[id].filled;
      return (filled[0] && filled[1]) || (filled[2] && filled[3]) || (filled[0] && filled[2]) || (filled[1] && filled[3]);
    });
    killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '두칸빙고 실패');
    finishSession(session, winners, `최종 타깃 숫자 ${target}`);
  } else {
    session.publicData.turn += 1;
    setPhase(session, 'bingo-turn', 60, true);
  }
}

function createCountdownGuessSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.bombNumber = randInt(session.rng, 1, 100);
  session.privateData.countdown = 10;
  session.publicData.low = 1;
  session.publicData.high = 100;
  session.publicData.turnOrder = players.map((p) => p.id);
  session.publicData.turnIndex = 0;
  setPhase(session, 'countdown-guess', 25, true);
  return session;
}

function currentBombHolder(session) {
  const order = session.publicData.turnOrder.filter((id) => !session.deadIds.includes(id));
  if (!order.length) return null;
  return order[session.publicData.turnIndex % order.length];
}

function applyCountdownGuess(session) {
  const holder = currentBombHolder(session);
  if (!holder) {
    finishSession(session, [], '생존자 없음');
    return;
  }
  const guess = clamp(parseInt(session.submissions[holder]?.guess, 10) || Math.floor((session.publicData.low + session.publicData.high) / 2), 1, 100);
  const bomb = session.privateData.bombNumber;
  if (guess === bomb) {
    const winners = livingIds(session);
    finishSession(session, winners, `${session.playerMap[holder].username} 이(가) 폭탄 숫자 ${bomb} 적중`);
    return;
  }
  if (guess > bomb) {
    session.privateData.countdown -= 2;
    session.publicData.high = Math.min(session.publicData.high, guess - 1);
    session.log.push(`${session.playerMap[holder].username} 의 추측 ${guess}: DOWN`);
  } else {
    session.privateData.countdown -= 1;
    session.publicData.low = Math.max(session.publicData.low, guess + 1);
    session.log.push(`${session.playerMap[holder].username} 의 추측 ${guess}: UP`);
  }
  if (session.privateData.countdown <= 0) {
    killPlayers(session, [holder], `${session.playerMap[holder].username} 폭탄 폭발`);
    session.privateData.countdown = 10;
    session.publicData.turnIndex = 0;
  } else {
    session.publicData.turnIndex += 1;
  }
  if (livingIds(session).length <= 1) {
    finishSession(session, livingIds(session), '마지막 생존자 판정');
  } else {
    setPhase(session, 'countdown-guess', 25, true);
  }
}

function createLiarCountingSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.teams = teamSplit(session.rng, players);
  session.privateData.teamScore = { A: 0, B: 0 };
  session.privateData.playerScore = {};
  players.forEach((p) => { session.privateData.playerScore[p.id] = 0; });
  session.publicData.set = 1;
  session.privateData.setEliminated = [];
  session.publicData.turnOrder = shuffle(session.rng, players.map((p) => p.id));
  session.privateData.animalBags = {};
  setPhase(session, 'animal-select', 120, true);
  return session;
}

function normalizeAnimalBag(raw) {
  const bag = {};
  ANIMALS.forEach((animal) => { bag[animal] = 0; });
  Object.entries(raw || {}).forEach(([animal, value]) => {
    if (ANIMALS.includes(animal)) bag[animal] = clamp(parseInt(value, 10) || 0, 0, 5);
  });
  let total = sum(Object.values(bag));
  while (total > 5) {
    const animal = ANIMALS.find((name) => bag[name] > 0);
    if (!animal) break;
    bag[animal] -= 1;
    total -= 1;
  }
  while (total < 5) {
    const animal = choice(seededRng(total, now()), ANIMALS);
    bag[animal] += 1;
    total += 1;
  }
  return bag;
}

function startLiarCountingSet(session) {
  session.privateData.currentClaim = null;
  session.privateData.setEliminated = [];
  session.publicData.turnIndex = 0;
  session.publicData.turnOrder = shuffle(session.rng, session.players.map((p) => p.id));
  setPhase(session, 'animal-claim', 90, true);
}

function activeSetPlayers(session) {
  return session.publicData.turnOrder.filter((id) => !session.privateData.setEliminated.includes(id));
}

function applyLiarCountingAction(session) {
  const active = activeSetPlayers(session);
  const currentId = active[session.publicData.turnIndex % active.length];
  const action = session.submissions[currentId] || {};
  if (!session.privateData.currentClaim) {
    const animal = ANIMALS.includes(action.animal) ? action.animal : ANIMALS[0];
    const count = clamp(parseInt(action.count, 10) || 1, 1, 12);
    session.privateData.currentClaim = { animal, count, by: currentId };
    session.publicData.turnIndex += 1;
    setPhase(session, 'animal-claim', 60, true);
    return;
  }
  if (action.mode === 'judge' || session.privateData.currentClaim.count >= 12) {
    const { animal, count, by } = session.privateData.currentClaim;
    const total = session.players.reduce((acc, player) => acc + (session.privateData.animalBags[player.id]?.[animal] || 0), 0);
    const claimantWins = total >= count;
    const loser = claimantWins ? currentId : by;
    const winner = claimantWins ? by : currentId;
    session.privateData.playerScore[winner] += ANIMAL_POINTS[animal];
    session.privateData.playerScore[loser] -= ANIMAL_POINTS[animal];
    session.privateData.setEliminated.push(loser);
    session.log.push(`${animal} 심판 - 실제 ${total}마리, ${session.playerMap[winner].username} 승리`);
    if (activeSetPlayers(session).length <= 1) {
      const teams = session.publicData.teams;
      const teamAHit = teams.A.some((id) => session.privateData.playerScore[id] >= 10);
      const teamBHit = teams.B.some((id) => session.privateData.playerScore[id] >= 10);
      if (teamAHit || teamBHit || session.publicData.set >= 3) {
        const winners = teamAHit ? teams.A : teamBHit ? teams.B : (sum(teams.A.map((id) => session.privateData.playerScore[id])) >= sum(teams.B.map((id) => session.privateData.playerScore[id])) ? teams.A : teams.B);
        const finalWinners = Array.isArray(winners) ? winners : [];
        killPlayers(session, livingIds(session).filter((id) => !finalWinners.includes(id)), '동물 농장 최종 탈락');
        finishSession(session, finalWinners, '동물 농장 종료', { playerScore: session.privateData.playerScore });
      } else {
        session.publicData.set += 1;
        setPhase(session, 'animal-select', 120, true);
      }
      return;
    }
    session.privateData.currentClaim = null;
    session.publicData.turnIndex = 0;
    setPhase(session, 'animal-claim', 60, true);
  } else {
    const nextCount = clamp(parseInt(action.count, 10) || session.privateData.currentClaim.count + 1, session.privateData.currentClaim.count + 1, 12);
    session.privateData.currentClaim = {
      animal: session.privateData.currentClaim.animal,
      count: nextCount,
      by: currentId,
    };
    session.publicData.turnIndex += 1;
    setPhase(session, 'animal-claim', 60, true);
  }
}

function createCircuitSolveSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.puzzles = shuffle(session.rng, CIRCUIT_PUZZLES).slice(0, 3);
  session.privateData.correctCount = {};
  players.forEach((p) => { session.privateData.correctCount[p.id] = 0; });
  session.publicData.puzzleIndex = 0;
  setPhase(session, 'circuit', 150, true);
  return session;
}

function resolveCircuitPuzzle(session) {
  const puzzle = session.privateData.puzzles[session.publicData.puzzleIndex];
  livingIds(session).forEach((id) => {
    const submitted = session.submissions[id]?.switches || {};
    const isCorrect = puzzle.switches.every((sw) => parseInt(submitted[sw], 10) === puzzle.answer[sw]);
    if (isCorrect) session.privateData.correctCount[id] += 1;
  });
  if (session.publicData.puzzleIndex >= 2) {
    const winners = livingIds(session).filter((id) => session.privateData.correctCount[id] >= 2);
    killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '블랙아웃 회로 기준 미달');
    finishSession(session, winners, '블랙아웃 회로 종료');
  } else {
    session.publicData.puzzleIndex += 1;
    setPhase(session, 'circuit', 150, true);
  }
}

function createTextVoteSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.template = generateIntroText(session.rng);
  setPhase(session, 'write', 120, true);
  return session;
}

function resolveTextVoteWrite(session) {
  session.publicData.entries = {};
  livingIds(session).forEach((id) => {
    session.publicData.entries[id] = String(session.submissions[id]?.text || generateIntroText(session.rng)).slice(0, 280);
  });
  setPhase(session, 'vote', 60, true);
}

function resolveTextVoteVote(session) {
  const counts = {};
  livingIds(session).forEach((id) => { counts[id] = 0; });
  livingIds(session).forEach((voterId) => {
    const target = session.submissions[voterId]?.target;
    if (counts[target] !== undefined) counts[target] += 1;
  });
  const maxVote = Math.max(...Object.values(counts));
  const targets = Object.entries(counts).filter(([, count]) => count === maxVote).map(([id]) => id);
  const winners = targets.length === 1 ? livingIds(session).filter((id) => id !== targets[0]) : livingIds(session);
  if (targets.length === 1) killPlayers(session, [targets[0]], `${session.playerMap[targets[0]].username} 최다 득표 탈락`);
  finishSession(session, winners, targets.length === 1 ? '최다 득표자 탈락' : '동률 - 전원 생존', { counts, entries: session.publicData.entries });
}

function createHiddenRoleRpsSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.saboteur = choice(session.rng, players.map((p) => p.id));
  setPhase(session, 'rps', 120, true);
  return session;
}

function resolveHiddenRoleRps(session) {
  const plays = {};
  livingIds(session).forEach((id) => {
    plays[id] = session.submissions[id]?.play || choice(session.rng, RPS);
  });
  const unique = [...new Set(Object.values(plays))];
  const sab = session.privateData.saboteur;
  let winners = [];
  if (unique.length === 1 || unique.length === 3) {
    winners = livingIds(session).filter((id) => id !== sab);
    killPlayers(session, [sab], '사보타지 단독 탈락');
  } else {
    const win = unique.includes('rock') && unique.includes('scissors') ? 'rock'
      : unique.includes('rock') && unique.includes('paper') ? 'paper'
      : 'scissors';
    const sabPlay = plays[sab];
    if (sabPlay !== win) {
      winners = livingIds(session).filter((id) => id !== sab);
      killPlayers(session, [sab], '사보타지 패배');
    } else {
      winners = livingIds(session).filter((id) => plays[id] === win || id === sab);
      killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '사보타지와 승리 손모양 생존');
    }
  }
  finishSession(session, winners, '사보타지 가위바위보 결과 공개', { plays, saboteur: sab });
}

function createGiftPoisonSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.night = 1;
  session.privateData.items = {};
  session.privateData.inbox = {};
  players.forEach((p) => {
    session.privateData.items[p.id] = ['poison', 'antidote', 'empty'];
    session.privateData.inbox[p.id] = [];
  });
  setPhase(session, 'gift', 90, true);
  return session;
}

function applyGiftNight(session) {
  livingIds(session).forEach((id) => {
    const items = session.privateData.items[id];
    const chosenItem = items.includes(session.submissions[id]?.item) ? session.submissions[id].item : items[0];
    session.privateData.items[id] = items.filter((x) => x !== chosenItem);
    const target = session.submissions[id]?.target;
    const pool = livingIds(session).filter((otherId) => otherId !== id);
    const actualTarget = pool.includes(target) ? target : choice(session.rng, pool);
    if (actualTarget) session.privateData.inbox[actualTarget].push(chosenItem);
  });
  if (session.publicData.night >= 3) {
    const winners = livingIds(session).filter((id) => {
      const received = session.privateData.inbox[id];
      const poison = received.filter((x) => x === 'poison').length;
      const antidote = received.filter((x) => x === 'antidote').length;
      return poison <= antidote;
    });
    const finalWinners = winners.length ? winners : livingIds(session).sort((a, b) => {
      const antiA = session.privateData.inbox[a].filter((x) => x === 'antidote').length;
      const antiB = session.privateData.inbox[b].filter((x) => x === 'antidote').length;
      return antiB - antiA;
    }).slice(0, 1);
    killPlayers(session, livingIds(session).filter((id) => !finalWinners.includes(id)), '독 선물 최종 판정');
    finishSession(session, finalWinners, '독 선물 결과 공개', { inbox: session.privateData.inbox });
  } else {
    session.publicData.night += 1;
    setPhase(session, 'gift', 90, true);
  }
}

function createAnonymousVoteSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.round = 1;
  setPhase(session, 'anon-vote', 90, true);
  return session;
}

function resolveAnonymousVote(session) {
  const counts = {};
  livingIds(session).forEach((id) => { counts[id] = 0; });
  livingIds(session).forEach((voterId) => {
    const target = session.submissions[voterId]?.target;
    if (counts[target] !== undefined) counts[target] += 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length && entries[0][1] > livingIds(session).length / 2) {
    killPlayers(session, [entries[0][0]], `${session.playerMap[entries[0][0]].username} 과반 숙청`);
  }
  if (session.publicData.round >= 3 || livingIds(session).length <= 1) {
    finishSession(session, livingIds(session), '최후의 투표 종료', { counts });
  } else {
    session.publicData.round += 1;
    setPhase(session, 'anon-vote', 90, true);
  }
}

function createPairTrustSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.round = 1;
  session.privateData.bond = {};
  session.privateData.repeatBlock = [];
  players.forEach((p) => { session.privateData.bond[p.id] = 0; });
  session.publicData.pairs = buildPairs(session);
  setPhase(session, 'pair-trust', 90, true);
  return session;
}

function buildPairs(session) {
  const ids = shuffle(session.rng, livingIds(session));
  const pairs = [];
  for (let i = 0; i < ids.length; i += 2) {
    if (ids[i + 1]) pairs.push([ids[i], ids[i + 1]]);
  }
  return pairs;
}

function resolvePairTrust(session) {
  const successfulCut = {};
  session.publicData.pairs.forEach(([a, b]) => {
    const actA = session.submissions[a]?.action || 'guard';
    const actB = session.submissions[b]?.action || 'guard';
    if (actA === 'catch' && actB === 'catch') {
      session.privateData.bond[a] += 1;
      session.privateData.bond[b] += 1;
    }
    if (actA === 'catch' && actB === 'cut') {
      killPlayers(session, [a], `${session.playerMap[a].username} 신뢰 낙하`);
      successfulCut[b] = true;
    }
    if (actB === 'catch' && actA === 'cut') {
      killPlayers(session, [b], `${session.playerMap[b].username} 신뢰 낙하`);
      successfulCut[a] = true;
    }
  });
  if (session.publicData.round >= 3 || livingIds(session).length <= 1) {
    const winners = livingIds(session).filter((id) => session.privateData.bond[id] >= 2 || successfulCut[id]);
    killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '신뢰 낙하 최종 판정');
    finishSession(session, winners, '신뢰 낙하 종료', { bond: session.privateData.bond });
  } else {
    session.publicData.round += 1;
    session.publicData.pairs = buildPairs(session);
    setPhase(session, 'pair-trust', 90, true);
  }
}

function createPotSplitSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.round = 1;
  session.privateData.tokens = {};
  players.forEach((p) => { session.privateData.tokens[p.id] = 0; });
  setPhase(session, 'pot-split', 90, true);
  return session;
}

function resolvePotSplit(session) {
  const alive = livingIds(session);
  const choices = {};
  alive.forEach((id) => { choices[id] = session.submissions[id]?.action || 'share'; });
  let pot = 12;
  const burners = alive.filter((id) => choices[id] === 'burn');
  const stealers = alive.filter((id) => choices[id] === 'steal');
  const sharers = alive.filter((id) => choices[id] === 'share');
  pot = Math.max(0, pot - burners.length * 4);
  if (!stealers.length) {
    const each = sharers.length ? Math.floor(pot / sharers.length) : 0;
    sharers.forEach((id) => { session.privateData.tokens[id] += each; });
  } else {
    const stealEach = Math.min(5, Math.floor(pot / stealers.length || 0));
    stealers.forEach((id) => { session.privateData.tokens[id] += stealEach; });
    pot = Math.max(0, pot - stealers.length * stealEach);
    const shareEach = sharers.length ? Math.floor(pot / sharers.length) : 0;
    sharers.forEach((id) => { session.privateData.tokens[id] += shareEach; });
  }
  burners.forEach((id) => { session.privateData.tokens[id] += 1; });
  if (session.publicData.round >= 3) {
    const sorted = alive.slice().sort((a, b) => session.privateData.tokens[a] - session.privateData.tokens[b]);
    const deadCount = Math.max(1, Math.ceil(sorted.length / 3));
    const dead = sorted.slice(0, deadCount);
    const winners = alive.filter((id) => !dead.includes(id));
    killPlayers(session, dead, '악마의 분배 하위권 탈락');
    finishSession(session, winners, '악마의 분배 종료', { tokens: session.privateData.tokens });
  } else {
    session.publicData.round += 1;
    setPhase(session, 'pot-split', 90, true);
  }
}

function createMaskDealerSession(game, players) {
  const session = createBaseSession(game, players);
  session.privateData.coins = {};
  players.forEach((p) => { session.privateData.coins[p.id] = 5; });
  setPhase(session, 'mask-bid', 90, true);
  return session;
}

function resolveMaskBid(session) {
  const bids = livingIds(session).map((id) => ({
    id,
    mask: session.submissions[id]?.mask || 'Sheep',
    bid: clamp(parseInt(session.submissions[id]?.bid, 10) || 0, 0, session.privateData.coins[id]),
  }));
  const roleById = {};
  const remaining = [...bids];
  const wolfCandidates = remaining.filter((b) => b.mask === 'Wolf').sort((a, b) => b.bid - a.bid);
  if (wolfCandidates[0]) {
    roleById[wolfCandidates[0].id] = 'Wolf';
  }
  const remainingAfterWolf = remaining.filter((b) => roleById[b.id] !== 'Wolf');
  const foxCandidates = remainingAfterWolf.filter((b) => b.mask === 'Fox').sort((a, b) => b.bid - a.bid);
  if (foxCandidates[0]) {
    roleById[foxCandidates[0].id] = 'Fox';
  }
  livingIds(session).forEach((id) => { if (!roleById[id]) roleById[id] = 'Sheep'; });
  session.privateData.roleById = roleById;
  setPhase(session, 'mask-vote', 90, true);
}

function resolveMaskVote(session) {
  const counts = {};
  livingIds(session).forEach((id) => { counts[id] = 0; });
  livingIds(session).forEach((id) => {
    const target = session.submissions[id]?.target;
    if (counts[target] !== undefined) counts[target] += 1;
  });
  const plurality = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const wolfId = Object.entries(session.privateData.roleById).find(([, role]) => role === 'Wolf')?.[0] || null;
  const winners = livingIds(session).filter((id) => {
    const role = session.privateData.roleById[id];
    if (role === 'Wolf') return id !== plurality;
    if (role === 'Fox') return session.submissions[id]?.target === wolfId;
    return session.submissions[id]?.target === plurality;
  });
  killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '가면 딜러 최종 판정');
  finishSession(session, winners, '가면 딜러 종료', { roleById: session.privateData.roleById, counts });
}

function createConfessionMarketSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.round = 1;
  session.privateData.reputation = {};
  players.forEach((p) => { session.privateData.reputation[p.id] = 0; });
  session.privateData.state = {};
  setConfessionRound(session);
  return session;
}

function setConfessionRound(session) {
  const hidden = {
    color: choice(session.rng, ['파랑', '초록', '빨강']),
    sector: choice(session.rng, ['A', 'B', 'C']),
    number: randInt(session.rng, 1, 6),
    symbol: choice(session.rng, ['달', '별', '열쇠']),
  };
  session.privateData.state = hidden;
  session.privateData.claimOptions = {};
  livingIds(session).forEach((id) => {
    const trueClaim = `숨겨진 색은 ${hidden.color}이다.`;
    const falseClaim = `숨겨진 번호는 ${hidden.number === 6 ? 4 : hidden.number + 1}이다.`;
    session.privateData.claimOptions[id] = [trueClaim, falseClaim];
  });
  setPhase(session, 'confession-publish', 120, true);
}

function resolveConfessionPublish(session) {
  session.publicData.claims = {};
  livingIds(session).forEach((id) => {
    const choiceIndex = clamp(parseInt(session.submissions[id]?.claimIndex, 10) || 0, 0, 1);
    session.publicData.claims[id] = session.privateData.claimOptions[id][choiceIndex];
  });
  setPhase(session, 'confession-bet', 90, true);
}

function resolveConfessionBet(session) {
  const hidden = session.privateData.state;
  const truthByClaim = (claim) => {
    if (!claim) return false;
    if (claim.includes('색')) return claim.includes(hidden.color);
    if (claim.includes('번호')) return claim.includes(String(hidden.number));
    return false;
  };
  livingIds(session).forEach((id) => {
    const claim = session.publicData.claims[id];
    const truth = truthByClaim(claim);
    const bets = livingIds(session)
      .filter((other) => other !== id && session.submissions[other]?.target === id)
      .map((other) => session.submissions[other]?.stance || 'trust');
    const trustCount = bets.filter((x) => x === 'trust').length;
    const doubtCount = bets.filter((x) => x === 'doubt').length;
    if (truth && trustCount >= doubtCount) session.privateData.reputation[id] += 1;
    else if (truth && doubtCount > trustCount) session.privateData.reputation[id] -= 1;
    else if (!truth && trustCount > doubtCount) session.privateData.reputation[id] += 2;
    else session.privateData.reputation[id] -= 2;
  });
  if (session.publicData.round >= 2) {
    const sorted = livingIds(session).slice().sort((a, b) => session.privateData.reputation[a] - session.privateData.reputation[b]);
    const deadCount = Math.max(1, Math.ceil(sorted.length / 3));
    const dead = sorted.slice(0, deadCount);
    const winners = livingIds(session).filter((id) => !dead.includes(id));
    killPlayers(session, dead, '고백 거래소 평판 하위 탈락');
    finishSession(session, winners, '고백 거래소 종료', { reputation: session.privateData.reputation });
  } else {
    session.publicData.round += 1;
    setConfessionRound(session);
  }
}

function createKnifeRelaySession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.round = 1;
  session.privateData.holder = choice(session.rng, players.map((p) => p.id));
  setPhase(session, 'knife-pass', 60, true);
  return session;
}

function resolveKnifeRelay(session) {
  const holder = session.privateData.holder;
  const order = livingIds(session);
  const action = session.submissions[holder]?.action || 'hold';
  const currentIndex = order.indexOf(holder);
  let nextHolder = holder;
  if (action === 'left') nextHolder = order[(currentIndex - 1 + order.length) % order.length];
  if (action === 'right') nextHolder = order[(currentIndex + 1) % order.length];
  session.privateData.holder = nextHolder;
  if (session.publicData.round === 2 || session.publicData.round === 4) {
    killPlayers(session, [nextHolder], `${session.playerMap[nextHolder].username} 칼 보유 체크포인트 탈락`);
    const survivors = livingIds(session);
    if (survivors.length <= 1 || session.publicData.round >= 4) {
      finishSession(session, survivors, '유다의 릴레이 종료');
      return;
    }
    session.privateData.holder = choice(session.rng, survivors);
  }
  session.publicData.round += 1;
  setPhase(session, 'knife-pass', 60, true);
}

function createBloodContractSession(game, players) {
  const session = createBaseSession(game, players);
  session.publicData.round = 1;
  session.privateData.points = {};
  players.forEach((p) => { session.privateData.points[p.id] = 0; });
  setPhase(session, 'blood-contract', 90, true);
  return session;
}

function resolveBloodContract(session) {
  const actions = {};
  livingIds(session).forEach((id) => {
    actions[id] = {
      target: session.submissions[id]?.target,
      mode: session.submissions[id]?.mode || 'contract',
    };
  });
  livingIds(session).forEach((id) => {
    const { target, mode } = actions[id];
    if (!livingIds(session).includes(target) || target === id) return;
    const reverse = actions[target];
    if (!reverse) return;
    if (mode === 'contract' && reverse.mode === 'contract' && reverse.target === id) {
      session.privateData.points[id] += 2;
    } else if (mode === 'betray' && reverse.mode === 'contract' && reverse.target === id) {
      session.privateData.points[id] += 3;
      session.privateData.points[target] -= 2;
    }
  });
  if (session.publicData.round >= 4) {
    const sorted = livingIds(session).slice().sort((a, b) => session.privateData.points[b] - session.privateData.points[a]);
    const cut = Math.max(1, Math.floor(sorted.length / 2));
    const winners = sorted.slice(0, cut);
    killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '핏빛 계약 최종 하위권 탈락');
    finishSession(session, winners, '핏빛 계약 종료', { points: session.privateData.points });
  } else {
    session.publicData.round += 1;
    setPhase(session, 'blood-contract', 90, true);
  }
}

function createSession(game, players) {
  const key = game.engine;
  if (String(key).startsWith('physical-')) return createPhysicalSession(game, players);
  switch (key) {
    case 'sync-press': return createSyncPressSession(game, players);
    case 'card-pass-sum': return createCardPassSession(game, players);
    case 'relay-inference': return createRelayInferenceSession(game, players);
    case 'binary-balance': return createBinaryBalanceSession(game, players);
    case 'map-consensus': return createMapConsensusSession(game, players);
    case 'team-contribution': return createTeamContributionSession(game, players);
    case 'sequence-assembly': return createSequenceAssemblySession(game, players);
    case 'load-sharing': return createLoadSharingSession(game, players);
    case 'trust-chain': return createTrustChainSession(game, players);
    case 'route-consensus': return createRouteConsensusSession(game, players);
    case 'puzzle-codebreak': return createCodebreakSession(game, players);
    case 'puzzle-order': return createPuzzleOrderSession(game, players);
    case 'estimate-auction': return createEstimateAuctionSession(game, players);
    case 'grid-path': return createGridPathSession(game, players);
    case 'puzzle-truth-ledger': return createTruthLedgerSession(game, players);
    case 'weighted-average': return createWeightedAverageSession(game, players);
    case 'number-bingo': return createNumberBingoSession(game, players);
    case 'countdown-guess': return createCountdownGuessSession(game, players);
    case 'liar-counting': return createLiarCountingSession(game, players);
    case 'circuit-solve': return createCircuitSolveSession(game, players);
    case 'text-vote': return createTextVoteSession(game, players);
    case 'hidden-role-rps': return createHiddenRoleRpsSession(game, players);
    case 'gift-poison': return createGiftPoisonSession(game, players);
    case 'anonymous-vote': return createAnonymousVoteSession(game, players);
    case 'pair-trust': return createPairTrustSession(game, players);
    case 'pot-split': return createPotSplitSession(game, players);
    case 'mask-dealer': return createMaskDealerSession(game, players);
    case 'confession-market': return createConfessionMarketSession(game, players);
    case 'knife-relay': return createKnifeRelaySession(game, players);
    case 'blood-contract': return createBloodContractSession(game, players);
    default: return createBaseSession(game, players);
  }
}

function maybeAutoStartPostBriefing(session) {
  if (session.phase !== 'briefing') return;
}

function getCommonView(session, playerId) {
  return {
    sessionId: session.id,
    cardCode: session.cardCode,
    gameName: session.gameName,
    suit: session.suit,
    engine: session.engine,
    phase: session.phase,
    round: session.round,
    deadline: session.deadline,
    chatEnabled: session.chatEnabled,
    log: session.log.slice(-8),
    players: publicPlayers(session),
    result: session.result,
    publicData: safeJSONClone(session.publicData || {}),
    me: {
      id: playerId,
      alive: !session.deadIds.includes(playerId),
      dead: session.deadIds.includes(playerId),
    },
  };
}

function getView(session, playerId) {
  const view = getCommonView(session, playerId);
  if (session.status === 'complete') return view;

  if (String(session.engine).startsWith('physical-')) {
    view.privateData = { metrics: session.privateData.metrics?.[playerId] || null };
    view.form = {
      type: 'physical',
      challenge: {
        ...(PHYSICAL_CONFIGS[session.cardCode] || {}),
        cardCode: session.cardCode,
      },
    };
    return view;
  }

  switch (session.engine) {
    case 'sync-press':
      view.form = { type: 'sync-press', cueAt: session.publicData.cueAt };
      return view;
    case 'card-pass-sum':
      view.privateData = { hand: session.privateData.hands[playerId], removedCount: 4 };
      view.form = { type: 'hand-select', field: 'cardIndex', cards: session.privateData.hands[playerId] };
      return view;
    case 'relay-inference':
      view.privateData = { clue: session.privateData.segments[playerId] };
      view.form = { type: 'text', field: 'answer', label: '정답 입력' };
      return view;
    case 'binary-balance': {
      const askerId = currentAsker(session);
      view.publicData.askerId = askerId;
      if (session.phase === 'ask') {
        if (playerId === askerId) view.form = { type: 'textarea', field: 'question', label: '예/아니오 질문' };
      } else {
        view.publicData.question = session.publicData.question;
        if (playerId !== askerId && !session.deadIds.includes(playerId)) {
          view.form = { type: 'radio', field: 'answer', options: ['yes', 'no'], label: '응답' };
        } else if (session.deadIds.includes(playerId)) {
          view.privateData = { forcedAnswer: session.privateData.bias[playerId] };
        }
      }
      return view;
    }
    case 'map-consensus':
      view.privateData = { clues: session.privateData.clues[playerId] || [] };
      view.form = { type: 'grid', field: 'cell', size: 3, options: range(0, 8) };
      return view;
    case 'team-contribution':
      view.privateData = {
        team: session.publicData.teams.A.includes(playerId) ? 'A' : 'B',
        remainingTokens: session.privateData.tokens[playerId],
        totalContributed: session.privateData.totalContributed[playerId],
      };
      view.form = { type: 'number', field: 'amount', min: 0, max: session.privateData.tokens[playerId], label: '기부 토큰 수' };
      return view;
    case 'sequence-assembly':
      view.privateData = { rules: session.privateData.rules[playerId] || [] };
      view.form = { type: 'sequence', field: 'order', items: session.publicData.symbols };
      return view;
    case 'load-sharing':
      view.privateData = { capacity: session.privateData.capacity[playerId], weakWave: session.privateData.weakWave[playerId] };
      view.form = { type: 'number', field: 'load', min: 0, max: 8, label: '이번 웨이브 하중' };
      return view;
    case 'trust-chain':
      view.privateData = { energy: session.privateData.energy[playerId] };
      view.form = { type: 'distribution', field: 'distribution', total: 4, targets: livingIds(session).filter((id) => id !== playerId) };
      return view;
    case 'route-consensus':
      view.privateData = { clues: session.privateData.clues[playerId] || [] };
      view.form = { type: 'radio', field: 'route', options: ['A', 'B', 'C'], label: `체크포인트 ${session.publicData.checkpoint} 루트` };
      return view;
    case 'puzzle-codebreak':
      view.privateData = { attempts: session.privateData.attempts[playerId], hints: session.privateData.hints[playerId] || [] };
      view.form = { type: 'digit-sequence', field: 'digits', length: 4, min: 1, max: 6 };
      return view;
    case 'puzzle-order':
      view.form = { type: 'sequence', field: 'order', items: session.publicData.entities };
      return view;
    case 'estimate-auction':
      view.form = {
        type: 'compound',
        fields: [
          { type: 'number', field: 'estimate', min: 0, max: 20, label: '남은 heart 수 추정' },
          { type: 'number', field: 'risk', min: 1, max: 5, label: '위험도' },
        ],
      };
      return view;
    case 'grid-path':
      view.form = { type: 'text', field: 'path', label: '경로 입력 (예: RRDD)', placeholder: 'R/L/U/D' };
      return view;
    case 'puzzle-truth-ledger':
      view.form = { type: 'multi-select', field: 'liars', options: ['A', 'B', 'C', 'D'], label: '거짓말쟁이 선택' };
      return view;
    case 'weighted-average':
      view.privateData = { clues: session.privateData.clues[playerId] };
      view.form = {
        type: 'compound',
        fields: [
          { type: 'number', field: 'value', min: 1, max: 9, label: '숫자' },
          { type: 'number', field: 'weight', min: 1, max: 3, label: '가중치' },
        ],
      };
      return view;
    case 'number-bingo':
      view.privateData = { board: session.privateData.boards[playerId] };
      if (session.phase === 'bingo-setup') view.form = { type: 'multi-number', field: 'choices', count: 2, min: 1, max: 9, label: '비어 있는 두 칸 채우기' };
      else view.form = { type: 'number', field: 'number', min: 1, max: 9, label: '제시 숫자' };
      return view;
    case 'countdown-guess':
      view.publicData.holderId = currentBombHolder(session);
      if (playerId === currentBombHolder(session)) view.form = { type: 'number', field: 'guess', min: session.publicData.low, max: session.publicData.high, label: '폭탄 숫자 추측' };
      return view;
    case 'liar-counting':
      if (session.phase === 'animal-select') {
        view.form = { type: 'distribution-animal', field: 'bag', total: 5, targets: ANIMALS };
      } else {
        view.publicData.currentClaim = session.privateData.currentClaim;
        const active = activeSetPlayers(session);
        const currentId = active[session.publicData.turnIndex % active.length];
        if (playerId === currentId) {
          if (!session.privateData.currentClaim) {
            view.form = { type: 'animal-claim', first: true, animals: ANIMALS };
          } else {
            view.form = { type: 'animal-claim', first: false, animal: session.privateData.currentClaim.animal, min: session.privateData.currentClaim.count + 1 };
          }
        }
      }
      return view;
    case 'circuit-solve':
      view.publicData.puzzle = session.privateData.puzzles[session.publicData.puzzleIndex];
      view.form = { type: 'switches', field: 'switches', switches: view.publicData.puzzle.switches };
      return view;
    case 'text-vote':
      if (session.phase === 'write') view.form = { type: 'textarea', field: 'text', label: '자기소개서 작성' };
      else view.form = {
        type: 'vote-entries',
        field: 'target',
        entries: Object.entries(session.publicData.entries || {}).map(([id, text]) => ({ id, text })),
      };
      return view;
    case 'hidden-role-rps':
      view.privateData = { role: session.privateData.saboteur === playerId ? '사보타지' : '생존자' };
      view.form = { type: 'radio', field: 'play', options: RPS, label: '가위바위보 선택' };
      return view;
    case 'gift-poison':
      view.privateData = { items: session.privateData.items[playerId], receivedCount: (session.privateData.inbox[playerId] || []).length };
      view.form = {
        type: 'compound',
        fields: [
          { type: 'select', field: 'target', label: '대상', options: livingIds(session).filter((id) => id !== playerId) },
          { type: 'select', field: 'item', label: '상자 종류', options: session.privateData.items[playerId] },
        ],
      };
      return view;
    case 'anonymous-vote':
      view.form = { type: 'select', field: 'target', label: '숙청 대상', options: livingIds(session).filter((id) => id !== playerId) };
      return view;
    case 'pair-trust':
      {
        const pair = session.publicData.pairs.find((item) => item.includes(playerId));
        view.privateData = { pairWith: pair ? pair.find((id) => id !== playerId) : null };
        view.form = { type: 'radio', field: 'action', options: ['catch', 'guard', 'cut'], label: '행동' };
        return view;
      }
    case 'pot-split':
      view.form = { type: 'radio', field: 'action', options: ['share', 'steal', 'burn'], label: '행동' };
      return view;
    case 'mask-dealer':
      if (session.phase === 'mask-bid') {
        view.form = {
          type: 'compound',
          fields: [
            { type: 'select', field: 'mask', label: '노리는 가면', options: ['Wolf', 'Fox', 'Sheep'] },
            { type: 'number', field: 'bid', label: '입찰 코인', min: 0, max: session.privateData.coins[playerId] },
          ],
        };
      } else {
        view.privateData = { role: session.privateData.roleById[playerId] };
        view.form = { type: 'select', field: 'target', label: '의심 대상', options: livingIds(session).filter((id) => id !== playerId) };
      }
      return view;
    case 'confession-market':
      if (session.phase === 'confession-publish') {
        view.privateData = { options: session.privateData.claimOptions[playerId] };
        view.form = { type: 'radio-index', field: 'claimIndex', options: session.privateData.claimOptions[playerId], label: '공개할 진술' };
      } else {
        view.publicData.claims = session.publicData.claims;
        view.form = {
          type: 'compound',
          fields: [
            { type: 'select', field: 'target', label: '베팅 대상', options: livingIds(session).filter((id) => id !== playerId) },
            { type: 'radio', field: 'stance', label: '판단', options: ['trust', 'doubt'] },
          ],
        };
      }
      return view;
    case 'knife-relay':
      if (session.privateData.holder === playerId) view.privateData = { hasKnife: true };
      view.form = { type: 'radio', field: 'action', options: ORDER_ACTIONS, label: '칼 이동' };
      return view;
    case 'blood-contract':
      view.privateData = { points: session.privateData.points[playerId] };
      view.form = {
        type: 'compound',
        fields: [
          { type: 'select', field: 'target', label: '대상', options: livingIds(session).filter((id) => id !== playerId) },
          { type: 'radio', field: 'mode', label: '행동', options: ['contract', 'betray'] },
        ],
      };
      return view;
    default:
      return view;
  }
}

function defaultPayloadForView(view, session, playerId) {
  const alive = view.players.filter((p) => p.alive).map((p) => p.id);
  switch (view.form?.type) {
    case 'sync-press':
      return { pressed: true };
    case 'hand-select':
      return { cardIndex: 0 };
    case 'text':
      return { [view.form.field]: randomName(session.rng) };
    case 'textarea':
      return { [view.form.field]: generateIntroText(session.rng) };
    case 'grid':
      return { cell: randInt(session.rng, 0, 8) };
    case 'number':
      return { [view.form.field]: view.form.min || 0 };
    case 'radio':
      return { [view.form.field]: choice(session.rng, view.form.options) };
    case 'select':
      return { [view.form.field]: choice(session.rng, view.form.options) };
    case 'multi-select':
      return { [view.form.field]: [choice(session.rng, view.form.options)] };
    case 'sequence':
      return { [view.form.field]: shuffle(session.rng, view.form.items) };
    case 'digit-sequence':
      return { [view.form.field]: range(1, view.form.length).map(() => randInt(session.rng, view.form.min, view.form.max)) };
    case 'distribution':
      {
        const dist = {};
        let remaining = view.form.total;
        view.form.targets.forEach((target, index) => {
          if (index === view.form.targets.length - 1) dist[target] = remaining;
          else {
            const value = randInt(session.rng, 0, remaining);
            dist[target] = value;
            remaining -= value;
          }
        });
        return { [view.form.field]: dist };
      }
    case 'compound':
      {
        const out = {};
        view.form.fields.forEach((field) => {
          Object.assign(out, defaultPayloadForView({ ...view, form: field }, session, playerId));
        });
        return out;
      }
    case 'multi-number':
      return { [view.form.field]: [randInt(session.rng, view.form.min, view.form.max), randInt(session.rng, view.form.min, view.form.max)] };
    case 'vote-entries':
      return { [view.form.field]: choice(session.rng, view.form.entries.map((x) => x.id).filter((id) => id !== playerId)) };
    case 'radio-index':
      return { [view.form.field]: randInt(session.rng, 0, view.form.options.length - 1) };
    case 'distribution-animal':
      {
        const bag = {};
        let remaining = view.form.total;
        view.form.targets.forEach((animal, index) => {
          if (index === view.form.targets.length - 1) bag[animal] = remaining;
          else {
            const value = randInt(session.rng, 0, remaining);
            bag[animal] = value;
            remaining -= value;
          }
        });
        return { [view.form.field]: bag };
      }
    case 'animal-claim':
      if (view.form.first) return { animal: choice(session.rng, ANIMALS), count: randInt(session.rng, 1, 4) };
      return { mode: choice(session.rng, ['raise', 'judge']), count: view.form.min || 2 };
    case 'switches':
      {
        const obj = {};
        view.form.switches.forEach((sw) => { obj[sw] = randInt(session.rng, 0, 1); });
        return { [view.form.field]: obj };
      }
    case 'physical':
      return {};
    default:
      if (session.engine === 'countdown-guess') {
        return { guess: Math.floor((session.publicData.low + session.publicData.high) / 2) };
      }
      return {};
  }
}

function submit(session, playerId, payload) {
  if (session.status === 'complete') return;
  if (String(session.engine).startsWith('physical-')) {
    if (payload?.metrics) {
      if (!session.privateData.metrics) session.privateData.metrics = {};
      session.privateData.metrics[playerId] = payload.metrics;
      session.submissions[playerId] = { done: true };
      if (livingIds(session).every((id) => session.submissions[id])) resolvePhysical(session);
    }
    return;
  }
  switch (session.engine) {
    case 'sync-press':
      session.submissions[playerId] = { serverAt: now(), pressed: true };
      if (livingIds(session).every((id) => session.submissions[id])) resolveSyncPress(session);
      return;
    case 'card-pass-sum':
      session.submissions[playerId] = { cardIndex: payload.cardIndex };
      if (livingIds(session).every((id) => session.submissions[id])) applyCardPass(session);
      return;
    case 'relay-inference':
      session.submissions[playerId] = { answer: payload.answer };
      if (livingIds(session).every((id) => session.submissions[id])) resolveRelayInference(session);
      return;
    case 'binary-balance':
      if (session.phase === 'ask') {
        const askerId = currentAsker(session);
        if (playerId !== askerId) return;
        session.publicData.question = String(payload.question || choice(session.rng, YES_NO_QUESTION_BANK)).slice(0, 180);
        setPhase(session, 'answer', 25, false);
      } else {
        session.submissions[playerId] = { answer: payload.answer === 'no' ? 'no' : 'yes' };
        const askerId = currentAsker(session);
        const others = session.players.map((p) => p.id).filter((id) => id !== askerId && !session.deadIds.includes(id));
        if (others.every((id) => session.submissions[id])) advanceBinaryBalance(session);
      }
      return;
    case 'map-consensus':
      session.submissions[playerId] = { cell: payload.cell };
      if (livingIds(session).every((id) => session.submissions[id])) resolveMapConsensus(session);
      return;
    case 'team-contribution':
      session.submissions[playerId] = { amount: payload.amount };
      if (livingIds(session).every((id) => session.submissions[id])) applyContributionRound(session);
      return;
    case 'sequence-assembly':
      session.submissions[playerId] = { order: payload.order };
      if (livingIds(session).every((id) => session.submissions[id])) resolveSequenceAssembly(session);
      return;
    case 'load-sharing':
      session.submissions[playerId] = { load: payload.load };
      if (livingIds(session).every((id) => session.submissions[id])) resolveLoadSharingWave(session);
      return;
    case 'trust-chain':
      session.submissions[playerId] = { distribution: payload.distribution || {} };
      if (livingIds(session).every((id) => session.submissions[id])) resolveTrustChainWave(session);
      return;
    case 'route-consensus':
      session.submissions[playerId] = { route: payload.route };
      if (livingIds(session).every((id) => session.submissions[id])) resolveRouteConsensusCheckpoint(session);
      return;
    case 'puzzle-codebreak':
      submitCodebreak(session, playerId, payload);
      return;
    case 'puzzle-order':
      session.submissions[playerId] = { order: payload.order };
      if (livingIds(session).every((id) => session.submissions[id])) resolvePuzzleOrder(session);
      return;
    case 'estimate-auction':
      session.submissions[playerId] = { estimate: payload.estimate, risk: payload.risk };
      if (livingIds(session).every((id) => session.submissions[id])) resolveEstimateAuction(session);
      return;
    case 'grid-path':
      session.submissions[playerId] = { path: payload.path };
      if (livingIds(session).every((id) => session.submissions[id])) resolveGridPath(session);
      return;
    case 'puzzle-truth-ledger':
      session.submissions[playerId] = { liars: payload.liars || [] };
      if (livingIds(session).every((id) => session.submissions[id])) resolveTruthLedger(session);
      return;
    case 'weighted-average':
      session.submissions[playerId] = { value: payload.value, weight: payload.weight };
      if (livingIds(session).every((id) => session.submissions[id])) resolveWeightedAverage(session);
      return;
    case 'number-bingo':
      if (session.phase === 'bingo-setup') {
        session.submissions[playerId] = { choices: payload.choices };
        if (livingIds(session).every((id) => session.submissions[id])) {
          maybeFillBingoBoards(session);
          session.publicData.turn = 1;
          setPhase(session, 'bingo-turn', 60, true);
        }
      } else {
        session.submissions[playerId] = { number: payload.number };
        if (livingIds(session).every((id) => session.submissions[id])) applyBingoTurn(session);
      }
      return;
    case 'countdown-guess':
      if (playerId !== currentBombHolder(session)) return;
      session.submissions[playerId] = { guess: payload.guess };
      applyCountdownGuess(session);
      return;
    case 'liar-counting':
      if (session.phase === 'animal-select') {
        session.submissions[playerId] = { bag: payload.bag || {} };
        if (livingIds(session).every((id) => session.submissions[id])) {
          livingIds(session).forEach((id) => { session.privateData.animalBags[id] = normalizeAnimalBag(session.submissions[id].bag); });
          startLiarCountingSet(session);
        }
      } else {
        const active = activeSetPlayers(session);
        const currentId = active[session.publicData.turnIndex % active.length];
        if (playerId !== currentId) return;
        session.submissions[playerId] = payload;
        applyLiarCountingAction(session);
      }
      return;
    case 'circuit-solve':
      session.submissions[playerId] = { switches: payload.switches || {} };
      if (livingIds(session).every((id) => session.submissions[id])) resolveCircuitPuzzle(session);
      return;
    case 'text-vote':
      if (session.phase === 'write') {
        session.submissions[playerId] = { text: payload.text };
        if (livingIds(session).every((id) => session.submissions[id])) resolveTextVoteWrite(session);
      } else {
        session.submissions[playerId] = { target: payload.target };
        if (livingIds(session).every((id) => session.submissions[id])) resolveTextVoteVote(session);
      }
      return;
    case 'hidden-role-rps':
      session.submissions[playerId] = { play: payload.play };
      if (livingIds(session).every((id) => session.submissions[id])) resolveHiddenRoleRps(session);
      return;
    case 'gift-poison':
      session.submissions[playerId] = { target: payload.target, item: payload.item };
      if (livingIds(session).every((id) => session.submissions[id])) applyGiftNight(session);
      return;
    case 'anonymous-vote':
      session.submissions[playerId] = { target: payload.target };
      if (livingIds(session).every((id) => session.submissions[id])) resolveAnonymousVote(session);
      return;
    case 'pair-trust':
      session.submissions[playerId] = { action: payload.action };
      if (livingIds(session).every((id) => session.submissions[id])) resolvePairTrust(session);
      return;
    case 'pot-split':
      session.submissions[playerId] = { action: payload.action };
      if (livingIds(session).every((id) => session.submissions[id])) resolvePotSplit(session);
      return;
    case 'mask-dealer':
      if (session.phase === 'mask-bid') {
        session.submissions[playerId] = { mask: payload.mask, bid: payload.bid };
        if (livingIds(session).every((id) => session.submissions[id])) resolveMaskBid(session);
      } else {
        session.submissions[playerId] = { target: payload.target };
        if (livingIds(session).every((id) => session.submissions[id])) resolveMaskVote(session);
      }
      return;
    case 'confession-market':
      if (session.phase === 'confession-publish') {
        session.submissions[playerId] = { claimIndex: payload.claimIndex };
        if (livingIds(session).every((id) => session.submissions[id])) resolveConfessionPublish(session);
      } else {
        session.submissions[playerId] = { target: payload.target, stance: payload.stance };
        if (livingIds(session).every((id) => session.submissions[id])) resolveConfessionBet(session);
      }
      return;
    case 'knife-relay':
      session.submissions[playerId] = { action: payload.action };
      if (livingIds(session).every((id) => session.submissions[id])) resolveKnifeRelay(session);
      return;
    case 'blood-contract':
      session.submissions[playerId] = { target: payload.target, mode: payload.mode };
      if (livingIds(session).every((id) => session.submissions[id])) resolveBloodContract(session);
      return;
    default:
      session.submissions[playerId] = payload || {};
  }
}

function onDeadline(session) {
  if (session.status === 'complete') return;
  if (String(session.engine).startsWith('physical-')) {
    resolvePhysical(session);
    return;
  }
  const pendingIds = livingIds(session).filter((id) => !session.submissions[id] || Object.keys(session.submissions[id]).length === 0);
  pendingIds.forEach((id) => {
    const view = getView(session, id);
    const payload = defaultPayloadForView(view, session, id);
    submit(session, id, payload);
  });
  if (session.engine === 'binary-balance' && session.phase === 'ask') {
    const askerId = currentAsker(session);
    submit(session, askerId, { question: choice(session.rng, YES_NO_QUESTION_BANK) });
  }
  if (session.status !== 'complete' && session.deadline && now() > session.deadline) {
    if (session.engine === 'puzzle-codebreak') {
      const winners = livingIds(session).filter((id) => session.playerMap[id].score === 1);
      killPlayers(session, livingIds(session).filter((id) => !winners.includes(id)), '시간 종료');
      finishSession(session, winners, '컬러 코드 락 시간 종료');
    }
  }
}

function tick(session) {
  if (session.status === 'complete') return;
  if (session.deadline && now() >= session.deadline) onDeadline(session);
}

module.exports = {
  createSession,
  getView,
  submit,
  tick,
};
