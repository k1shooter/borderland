(function () {
  'use strict';

  /* ─────────── STATE ─────────── */
  var state = {
    token: localStorage.getItem('borderland_token') || '',
    deviceId: localStorage.getItem('borderland_device_id') || '',
    user: null,
    games: [],
    rooms: [],
    leaderboard: [],
    rulebookMarkdown: '',
    currentRoom: null,
    socket: null,
    activeMiniGame: null,
    lastBootstrapAt: 0,
    briefingShown: false,
    gameWorldActive: false,
    mySubmitted: false,
    socketSeq: 0,
    serverClockOffset: 0,
    lastRoomVersion: 0,
    presentationProfiles: {},
  };

  var root = document.getElementById('app');
  var toastRoot = document.getElementById('toast');
  var countdownTimer = null;
  var lastTimerCue = '';
  var SUIT_ICON = {
    spade: '\u2660',
    club: '\u2663',
    diamond: '\u2666',
    heart: '\u2665',
  };
  var SUIT_LABEL = {
    spade: '\uC2A4\uD398\uC774\uB4DC',
    club: '\uD074\uB85C\uBC84',
    diamond: '\uB2E4\uC774\uC544',
    heart: '\uD558\uD2B8',
  };
  var SUIT_CLASS = {
    spade: 's-spade',
    club: 's-club',
    diamond: 's-diamond',
    heart: 's-heart',
  };
  var SUIT_DESC = {
    spade: '\uD53C\uC9C0\uCEEC',
    club: '\uD611\uB3D9',
    diamond: '\uB450\uB1CC',
    heart: '\uBC30\uC2E0',
  };

  /* ─────────── UTILS ─────────── */
  function ensureDeviceId() {
    if (!state.deviceId) {
      state.deviceId = 'dev_' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem('borderland_device_id', state.deviceId);
    }
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function notify(msg, kind) {
    var d = document.createElement('div');
    d.className = 'toast ' + (kind || 'info');
    d.textContent = msg;
    toastRoot.appendChild(d);
    setTimeout(function () {
      d.classList.add('visible');
    }, 10);
    setTimeout(function () {
      d.classList.remove('visible');
      setTimeout(function () {
        d.remove();
      }, 300);
    }, 3200);
  }

  function serverNowMs() {
    return Date.now() + (state.serverClockOffset || 0);
  }

  function nextSocketSeq() {
    state.socketSeq = (state.socketSeq || 0) + 1;
    return state.socketSeq;
  }

  function buildGameEnvelope(payload) {
    var room = state.currentRoom || {};
    var session = room.session || {};
    var me = session.me || {};
    return {
      phaseId: session.phaseId || 0,
      phaseToken: me.phaseToken || '',
      seq: nextSocketSeq(),
      payload: payload || {},
    };
  }

  function api(path, opts) {
    opts = opts || {};
    var h = opts.headers || {};
    h['Content-Type'] = h['Content-Type'] || 'application/json';
    if (state.token) h.Authorization = 'Bearer ' + state.token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (d) {
          if (!r.ok) throw new Error(d.error || '\uC694\uCCAD \uC2E4\uD328');
          return d;
        });
    });
  }

  function currentRoute() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return { name: 'lobby' };
    if (h.startsWith('room/')) return { name: 'room', roomId: h.split('/')[1] };
    return { name: h };
  }

  function gameByCode(c) {
    return state.games.find(function (g) {
      return g.code === c;
    });
  }
  function pName(players, id) {
    var p = (players || []).find(function (x) {
      return x.id === id;
    });
    return p ? p.username : (id || '?').slice(0, 8);
  }

  function callSocket(ev, payload) {
    return new Promise(function (res) {
      if (!state.socket)
        return res({
          ok: false,
          error: '\uC18C\uCF13 \uC5F0\uACB0 \uC5C6\uC74C',
        });
      state.socket.emit(ev, payload || {}, function (r) {
        res(r || { ok: false, error: '\uC751\uB2F5 \uC5C6\uC74C' });
      });
    });
  }

  /* ─────────── SOCKET ─────────── */
  var lastPhaseKey = '';

  function applyClockSync(payload) {
    if (!payload || typeof payload.serverNow !== 'number') return;
    state.serverClockOffset = payload.serverNow - Date.now();
  }

  function resyncRoomState(roomId, sinceVersion) {
    if (!roomId || !state.token) return Promise.resolve();
    var query = sinceVersion ? '?sinceVersion=' + encodeURIComponent(sinceVersion) : '';
    return api('/api/rooms/' + roomId + '/state' + query)
      .then(function (d) {
        if (d.snapshot) {
          state.currentRoom = d.snapshot;
          state.lastRoomVersion = d.version || 0;
          render();
          return;
        }
        if (d.delta && d.delta.length) {
          return api('/api/rooms/' + roomId + '/state').then(function (full) {
            if (full.snapshot) {
              state.currentRoom = full.snapshot;
              state.lastRoomVersion = full.version || 0;
              render();
            }
          });
        }
      })
      .catch(function () {});
  }

  function connectSocket() {
    if (!state.token || !window.io) return;
    if (state.socket) state.socket.disconnect();
    state.socket = window.io({
      auth: { token: state.token, deviceId: state.deviceId },
    });
    state.socket.on('connect', function () {
      var route = currentRoute();
      if (route.name === 'room' && route.roomId) {
        resyncRoomState(route.roomId, state.lastRoomVersion || 0);
      }
    });
    state.socket.on('connect_error', function (e) {
      notify(
        e.message || 'Realtime connection failed',
        'error'
      );
      var route = currentRoute();
      if (route.name === 'room' && route.roomId) {
        setTimeout(function () {
          resyncRoomState(route.roomId, state.lastRoomVersion || 0);
        }, 500);
      }
    });
    state.socket.on('rooms:update', function (r) {
      state.rooms = r;
      render();
    });
    state.socket.on('sync:clock', function (payload) {
      applyClockSync(payload);
    });
    state.socket.on('room:update', function (r) {
      var prevVersion = state.lastRoomVersion || 0;
      state.lastRoomVersion = r.version || prevVersion;
      if (prevVersion && r.version && r.version > prevVersion + 1) {
        resyncRoomState(r.id, prevVersion);
      }
      state.currentRoom = r;
      var pd = r.session && r.session.publicData ? r.session.publicData : {};
      var newKey = r.session
        ? r.session.phase +
          ':' +
          (pd.round ||
            pd.wave ||
            pd.turn ||
            pd.turnIndex ||
            pd.checkpoint ||
            pd.passRound ||
            pd.puzzleIndex ||
            pd.night ||
            pd.set ||
            0)
        : '';
      if (newKey !== lastPhaseKey) {
        state.mySubmitted = false;
        if (
          lastPhaseKey &&
          r.session &&
          !r.session.result &&
          state.gameWorldActive
        ) {
          showPhaseTransition(r.session);
        }
        lastPhaseKey = newKey;
      }
      if (currentRoute().name === 'room' || location.hash === '#room/' + r.id) {
        if (currentRoute().name !== 'room') location.hash = '#room/' + r.id;
        render();
      }
      refreshLeaderboard();
    });
    state.socket.on('room:delta', function (d) {
      if (!d) return;
      if (
        state.currentRoom &&
        state.currentRoom.id &&
        d.toVersion &&
        d.toVersion > (state.lastRoomVersion || 0) + 1
      ) {
        resyncRoomState(state.currentRoom.id, state.lastRoomVersion || 0);
      }
    });
    state.socket.on('auth:dead', function (p) {
      notify(
        p.reason || 'You have been eliminated.',
        'error'
      );
    });
  }

  function refreshLeaderboard() {
    api('/api/leaderboard')
      .then(function (b) {
        state.leaderboard = b;
        if (currentRoute().name === 'leaderboard') render();
      })
      .catch(function () {});
  }

  function bootstrap() {
    ensureDeviceId();
    if (!state.token) {
      render();
      return Promise.resolve();
    }
    return api('/api/bootstrap')
      .then(function (d) {
        state.user = d.user;
        state.games = d.games;
        state.rooms = d.rooms;
        state.leaderboard = d.leaderboard;
        state.rulebookMarkdown = d.rulebookMarkdown;
        state.lastBootstrapAt = Date.now();
        return fetch('/presentationProfiles.json')
          .then(function (r) {
            if (!r.ok) throw new Error('profile fetch failed');
            return r.json();
          })
          .then(function (profiles) {
            state.presentationProfiles = profiles || {};
          })
          .catch(function () {
            state.presentationProfiles = {};
          })
          .then(function () {
            connectSocket();
            render();
          });
      })
      .catch(function (e) {
        console.error(e);
        state.token = '';
        state.user = null;
        localStorage.removeItem('borderland_token');
        render();
      });
  }

  function login(u, p) {
    return api('/api/auth/login', {
      method: 'POST',
      body: { username: u, password: p },
    })
      .then(function (d) {
        state.token = d.token;
        localStorage.setItem('borderland_token', d.token);
        notify('\uB85C\uADF8\uC778 \uC131\uACF5');
        return bootstrap();
      })
      .catch(function (e) {
        notify(e.message, 'error');
      });
  }
  function register(u, p) {
    return api('/api/auth/register', {
      method: 'POST',
      body: {
        username: u,
        password: p,
      },
    })
      .then(function (d) {
        state.token = d.token;
        localStorage.setItem('borderland_token', d.token);
        notify('\uD68C\uC6D0\uAC00\uC785 \uC131\uACF5');
        return bootstrap();
      })
      .catch(function (e) {
        notify(e.message, 'error');
      });
  }

  function signInWithEthereum() {
    if (!window.ethereum) {
      notify('SIWE 지원 지갑이 필요합니다.', 'error');
      return Promise.resolve();
    }
    return window.ethereum
      .request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        if (!accounts || !accounts.length) throw new Error('wallet account not found');
        var walletAddress = accounts[0];
        return window.ethereum
          .request({ method: 'eth_chainId' })
          .then(function (chainHex) {
            var chainId = parseInt(chainHex, 16);
            return api('/api/auth/siwe/nonce', {
              method: 'POST',
              body: { walletAddress: walletAddress, chainId: chainId },
            }).then(function (nonceData) {
              return window.ethereum
                .request({
                  method: 'personal_sign',
                  params: [nonceData.message, walletAddress],
                })
                .then(function (signature) {
                  return api('/api/auth/siwe/verify', {
                    method: 'POST',
                    body: {
                      message: nonceData.message,
                      signature: signature,
                      walletAddress: walletAddress,
                    },
                  });
                });
            });
          });
      })
      .then(function (d) {
        state.token = d.token;
        localStorage.setItem('borderland_token', d.token);
        notify('SIWE 로그인 성공');
        return bootstrap();
      })
      .catch(function (e) {
        notify(e.message || 'SIWE 로그인 실패', 'error');
      });
  }

  function linkWalletWithSiwe() {
    if (!state.token) return Promise.resolve();
    if (!window.ethereum) {
      notify('지갑이 필요합니다.', 'error');
      return Promise.resolve();
    }
    return window.ethereum
      .request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        if (!accounts || !accounts.length) throw new Error('wallet account not found');
        var walletAddress = accounts[0];
        return window.ethereum
          .request({ method: 'eth_chainId' })
          .then(function (chainHex) {
            var chainId = parseInt(chainHex, 16);
            return api('/api/auth/wallet/link/nonce', {
              method: 'POST',
              body: { walletAddress: walletAddress, chainId: chainId },
            }).then(function (nonceData) {
              return window.ethereum
                .request({
                  method: 'personal_sign',
                  params: [nonceData.message, walletAddress],
                })
                .then(function (signature) {
                  return api('/api/auth/wallet/link/verify', {
                    method: 'POST',
                    body: { message: nonceData.message, signature: signature },
                  });
                });
            });
          });
      })
      .then(function () {
        notify('지갑이 연결되었습니다.');
      })
      .catch(function (e) {
        notify(e.message || '지갑 연결 실패', 'error');
      });
  }

  function logout() {
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    state.token = '';
    state.user = null;
    state.currentRoom = null;
    state.lastRoomVersion = 0;
    state.gameWorldActive = false;
    state.briefingShown = false;
    localStorage.removeItem('borderland_token');
    location.hash = '#lobby';
    render();
  }

  /* ─────────── HELPERS ─────────── */
  function statusIcon(alive) {
    return alive ? '\uD83D\uDFE2' : '\uD83D\uDC80';
  }
  function aliveList(session) {
    return (session.players || []).filter(function (p) {
      return p.alive;
    });
  }
  function deadList(session) {
    return (session.players || []).filter(function (p) {
      return !p.alive;
    });
  }
  function logHtml(log) {
    if (!log || !log.length) return '';
    return (
      '<div class="gw-log-box"><div class="gw-log-title">📋 게임 로그</div>' +
      log
        .slice(-10)
        .map(function (l) {
          return '<div class="gw-log-line">' + esc(l) + '</div>';
        })
        .join('') +
      '</div>'
    );
  }

  /* ─── PHASE LABEL MAP ─── */
  var PHASE_LABELS = {
    briefing: '📜 브리핑',
    ask: '❓ 질문',
    answer: '✋ 응답',
    write: '✍️ 작성',
    vote: '🗳️ 투표',
    contribute: '💰 기여',
    allocate: '⚖️ 배분',
    distribute: '🔗 분배',
    'route-select': '🧭 경로 선택',
    circuit: '⚡ 회로 풀기',
    'bingo-setup': '🔢 빙고 셋업',
    'bingo-turn': '🎯 빙고 턴',
    gift: '🎁 선물 전달',
    'anon-vote': '🗳️ 익명 투표',
    'pair-trust': '🤝 짝 신뢰',
    'pot-split': '💰 냄비 분배',
    'mask-bid': '🎭 입찰',
    'mask-vote': '🎭 투표',
    'confession-publish': '📜 고백 공개',
    'confession-bet': '🎰 베팅',
    'knife-pass': '🔪 칼 릴레이',
    'blood-contract': '🩸 계약/배신',
    'animal-select': '🐾 동물 배치',
    'animal-claim': '🤥 선언/심판',
    complete: '🏁 완료',
  };

  function phaseName(phase) {
    return PHASE_LABELS[phase] || phase;
  }

  function statusBar(session) {
    var alive = aliveList(session);
    var dead = deadList(session);
    var pd = session.publicData || {};
    var submittedCount = Object.keys(session.submissions || {}).length;
    var totalAlive = alive.length;

    /* Round / sub-round info */
    var roundInfo = '';
    if (pd.round) roundInfo = '라운드 ' + pd.round;
    else if (pd.wave) roundInfo = '웨이브 ' + pd.wave;
    else if (pd.checkpoint) roundInfo = '체크포인트 ' + pd.checkpoint;
    else if (pd.night) roundInfo = '밤 ' + pd.night;
    else if (pd.set) roundInfo = '세트 ' + pd.set;
    else if (pd.puzzleIndex !== undefined)
      roundInfo = '퍼즐 ' + (pd.puzzleIndex + 1);
    else if (pd.passRound) roundInfo = '패스 ' + pd.passRound;
    else if (pd.turn) roundInfo = '턴 ' + pd.turn;
    else roundInfo = '라운드 ' + (session.round || 1);

    return (
      '<div class="gw-status-bar">' +
      '<div class="gw-sb-item"><span class="gw-sb-label">📍 진행</span><span class="gw-sb-val">' +
      esc(roundInfo) +
      '</span></div>' +
      '<div class="gw-sb-item"><span class="gw-sb-label">🎬 페이즈</span><span class="gw-sb-val">' +
      esc(phaseName(session.phase)) +
      '</span></div>' +
      '<div class="gw-sb-item"><span class="gw-sb-label">✅ 제출</span><span class="gw-sb-val">' +
      submittedCount +
      '/' +
      totalAlive +
      '</span></div>' +
      '<div class="gw-sb-item"><span class="gw-sb-label">💀 생존</span><span class="gw-sb-val"><span class="gw-alive">' +
      alive.length +
      '</span> / <span class="gw-dead">' +
      dead.length +
      '</span></span></div>' +
      '</div>'
    );
  }
  function playerChips(session) {
    var subs = session.submissions || {};
    return (
      '<div class="gw-player-chips">' +
      (session.players || [])
        .map(function (p) {
          var submitted = !!subs[p.id];
          var deadClass = p.alive ? '' : ' dead';
          var subClass = submitted && p.alive ? ' submitted' : '';
          return (
            '<span class="gw-chip' +
            deadClass +
            subClass +
            '">' +
            statusIcon(p.alive) +
            ' ' +
            esc(p.username) +
            (p.isBot ? ' <span class="bot-tag">BOT</span>' : '') +
            (submitted && p.alive ? ' ✓' : '') +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function submittedBadge() {
    return '<div class="gw-submitted-badge"><div class="submitted-pulse">✅</div><div>제출 완료</div><div class="submitted-sub">다른 플레이어의 선택을 기다리는 중...</div></div>';
  }

  /* ─── PHASE TRANSITION OVERLAY ─── */
  function presentationProfile(cardCode) {
    var profiles = state.presentationProfiles || {};
    return profiles[cardCode] || profiles.default || {};
  }

  function showPhaseTransition(session) {
    var pd = session.publicData || {};
    var phaseLabel = phaseName(session.phase);
    var profile = presentationProfile(session.cardCode);
    var roundInfo = '';
    if (pd.round) roundInfo = '라운드 ' + pd.round;
    else if (pd.wave) roundInfo = '웨이브 ' + pd.wave;
    else if (pd.checkpoint) roundInfo = '체크포인트 ' + pd.checkpoint;
    else if (pd.night) roundInfo = '밤 ' + pd.night;
    else if (pd.set) roundInfo = '세트 ' + pd.set;
    else if (pd.turn) roundInfo = '턴 ' + pd.turn;

    var overlay = document.createElement('div');
    overlay.className =
      'phase-transition-overlay' +
      (profile.transitionClass ? ' pt-' + profile.transitionClass : '');
    if (profile.accent) overlay.style.setProperty('--pt-accent', profile.accent);
    overlay.innerHTML =
      '<div class="phase-transition-content">' +
      (roundInfo ? '<div class="pt-round">' + esc(roundInfo) + '</div>' : '') +
      '<div class="pt-phase">' +
      esc(phaseLabel) +
      '</div>' +
      (profile.transitionHint
        ? '<div class=\"pt-hint\">' + esc(profile.transitionHint) + '</div>'
        : '') +
      '</div>';
    document.body.appendChild(overlay);
    setTimeout(function () {
      overlay.classList.add('pt-show');
    }, 10);
    setTimeout(function () {
      overlay.classList.remove('pt-show');
    }, 1200);
    setTimeout(function () {
      overlay.remove();
    }, 1600);
  }

  /* ─────────── NAV ─────────── */
  function renderNav(route) {
    if (!state.user) return '';
    var items = [
      { key: 'lobby', label: '\uB85C\uBE44' },
      { key: 'cards', label: '\uCE74\uB4DC \uB8F0\uBD81' },
      { key: 'leaderboard', label: '\uB9AC\uB354\uBCF4\uB4DC' },
    ];
    if (state.user.role === 'admin')
      items.push({ key: 'admin', label: '\uC5B4\uB4DC\uBBFC' });
    return (
      '<header class="topbar"><div class="brand">BORDERLAND</div>' +
      '<nav class="nav">' +
      items
        .map(function (i) {
          return (
            '<a class="nav-link ' +
            (route.name === i.key ? 'active' : '') +
            '" href="#' +
            i.key +
            '">' +
            i.label +
            '</a>'
          );
        })
        .join('') +
      '</nav>' +
      '<div class="userbox"><span class="pill">' +
      esc(state.user.username) +
      '</span>' +
      '<span class="pill ' +
      (state.user.status === 'ALIVE' ? 'ok' : 'bad') +
      '">' +
      esc(state.user.status) +
      '</span>' +
      '<button id="wallet-link-btn" class="ghost">\uC9C0\uAC11\uC5F0\uACB0</button>' +
      '<button id="logout-btn" class="ghost">\uB85C\uADF8\uC544\uC6C3</button></div></header>'
    );
  }

  /* ─────────── AUTH ─────────── */
  function renderAuth() {
    root.innerHTML =
      '<div class="auth-shell"><div class="auth-card">' +
      '<h1>BORDERLAND</h1><p>\uC0AC\uB9DD \uACC4\uC815\uC740 \uC7AC\uC0AC\uC6A9 \uBD88\uAC00. \uC0DD\uC874\uD558\uC5EC \uB2E4\uC74C \uCE74\uB4DC\uB85C \uC9C4\uD589\uD558\uC2ED\uC2DC\uC624.</p>' +
      '<div class="auth-grid">' +
      '<form id="login-form" class="card"><h2>\uB85C\uADF8\uC778</h2><label>\uC544\uC774\uB514<input name="username" required /></label><label>\uBE44\uBC00\uBC88\uD638<input name="password" type="password" required /></label><button class="primary" type="submit">\uB85C\uADF8\uC778</button></form>' +
      '<form id="register-form" class="card"><h2>\uD68C\uC6D0\uAC00\uC785</h2><label>\uC544\uC774\uB514<input name="username" required /></label><label>\uBE44\uBC00\uBC88\uD638<input name="password" type="password" required /></label><button class="primary" type="submit">\uD68C\uC6D0\uAC00\uC785</button><button id="siwe-login-btn" class="ghost" type="button">SIWE \uC9C0\uAC11 \uB85C\uADF8\uC778</button><div class="hint">\uC5B4\uB4DC\uBBFC: admin / borderland-admin-2026!</div></form>' +
      '</div></div></div>';
    bind('login-form', 'submit', function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      login(f.get('username'), f.get('password'));
    });
    bind('register-form', 'submit', function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      register(f.get('username'), f.get('password'));
    });
    bind('siwe-login-btn', 'click', function () {
      signInWithEthereum();
    });
  }

  function bind(id, ev, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  }

  /* ─────────── TRUMP CARD LOBBY ─────────── */
  function renderTrumpCard(game) {
    var icon = SUIT_ICON[game.suit] || '?';
    var cls = SUIT_CLASS[game.suit] || '';
    var owned = (state.user.ownedCards || []).includes(game.code);
    return (
      '<div class="trump-card ' +
      cls +
      (owned ? ' owned' : '') +
      '" data-code="' +
      game.code +
      '" title="' +
      esc(game.code + ' ' + game.name) +
      '">' +
      '<span class="tc-corner">' +
      icon +
      '</span>' +
      '<span class="tc-suit">' +
      icon +
      '</span>' +
      '<span class="tc-number">' +
      game.difficulty +
      '</span>' +
      '<span class="tc-name">' +
      esc(game.name) +
      '</span>' +
      '<span class="tc-corner-br">' +
      icon +
      '</span>' +
      '</div>'
    );
  }

  function renderLobby() {
    var suits = ['spade', 'club', 'diamond', 'heart'];
    var sections = suits
      .map(function (suit) {
        var games = state.games
          .filter(function (g) {
            return g.suit === suit;
          })
          .sort(function (a, b) {
            return a.difficulty - b.difficulty;
          });
        return (
          '<div class="trump-section"><h3>' +
          SUIT_LABEL[suit] +
          ' (' +
          SUIT_DESC[suit] +
          ')</h3>' +
          '<div class="trump-grid">' +
          games.map(renderTrumpCard).join('') +
          '</div></div>'
        );
      })
      .join('');
    var roomsHtml = state.rooms.length
      ? state.rooms
          .map(function (r) {
            return (
              '<div class="room-card"><div class="room-head"><div><b>' +
              esc(r.name) +
              '</b><div class="muted">' +
              esc(r.cardCode + ' ' + r.cardName) +
              '</div></div><div class="pill">' +
              r.players.length +
              '\uBA85</div></div>' +
              '<div class="muted">\uC0C1\uD0DC: ' +
              esc(r.status) +
              ' / \uCD5C\uC18C ' +
              r.minPlayers +
              ' / \uCD5C\uB300 ' +
              r.maxPlayers +
              '</div>' +
              '<button class="primary join-room-btn" data-room-id="' +
              r.id +
              '">\uC785\uC7A5</button></div>'
            );
          })
          .join('')
      : '<div class="card muted">\uB300\uAE30 \uC911\uC778 \uBC29\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uCE74\uB4DC\uB97C \uD074\uB9AD\uD558\uC5EC \uBC29\uC744 \uB9CC\uB4DC\uC138\uC694.</div>';

    root.innerHTML =
      renderNav(currentRoute()) +
      '<main class="page">' +
      '<section class="card"><h2>\uD83C\uDCCF \uCE74\uB4DC\uB97C \uC120\uD0DD\uD558\uC5EC \uAC8C\uC784\uC5D0 \uC785\uC7A5</h2><p class="muted">40\uC7A5\uC758 \uD2B8\uB7FC\uD504 \uCE74\uB4DC \uC911 \uD558\uB098\uB97C \uD074\uB9AD\uD558\uBA74 \uD574\uB2F9 \uAC8C\uC784 \uBC29\uC744 \uB9CC\uB4E4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p>' +
      sections +
      '</section>' +
      '<section class="card" style="margin-top:18px"><h2>\uB300\uAE30 \uC911\uC778 \uBC29</h2>' +
      roomsHtml +
      '</section></main>';

    bindCommonNav();
    Array.prototype.forEach.call(
      document.querySelectorAll('.trump-card'),
      function (card) {
        card.addEventListener('click', function () {
          var code = card.getAttribute('data-code');
          var game = gameByCode(code);
          var bots = state.user.role === 'admin' ? game.players.min - 1 : 0;
          callSocket('room:create', {
            name: game.code + ' - ' + game.name,
            cardCode: code,
            addBots: bots,
          }).then(function (r) {
            if (!r.ok) return notify(r.error, 'error');
            location.hash = '#room/' + r.roomId;
          });
        });
      }
    );
    Array.prototype.forEach.call(
      document.querySelectorAll('.join-room-btn'),
      function (btn) {
        btn.addEventListener('click', function () {
          callSocket('room:join', {
            roomId: btn.getAttribute('data-room-id'),
          }).then(function (r) {
            if (!r.ok) return notify(r.error, 'error');
            location.hash = '#room/' + btn.getAttribute('data-room-id');
          });
        });
      }
    );
  }

  /* ─────────── CARDS RULEBOOK ─────────── */
  function renderCards() {
    var grouped = { spade: [], club: [], diamond: [], heart: [] };
    state.games.forEach(function (g) {
      grouped[g.suit].push(g);
    });
    root.innerHTML =
      renderNav(currentRoute()) +
      '<main class="page"><section class="card"><h2>\uC804\uCCB4 \uCE74\uB4DC \uB8F0\uBD81</h2></section>' +
      Object.keys(grouped)
        .map(function (suit) {
          return (
            '<section class="card"><h3 class="section-title">' +
            SUIT_LABEL[suit] +
            '</h3>' +
            '<div class="game-grid">' +
            grouped[suit]
              .map(function (g) {
                var icon = SUIT_ICON[g.suit];
                return (
                  '<article class="game-card"><div class="suit-badge suit-' +
                  g.suit +
                  '">' +
                  icon +
                  ' ' +
                  g.code +
                  '</div>' +
                  '<h4>' +
                  esc(g.name) +
                  '</h4><div class="muted">\uB09C\uC774\uB3C4 ' +
                  g.difficulty +
                  ' / ' +
                  g.players.min +
                  '~' +
                  g.players.max +
                  '\uBA85 / ' +
                  g.durationMin +
                  '\uBD84</div>' +
                  '<p>' +
                  esc(g.summary) +
                  '</p>' +
                  '<details><summary>\uC0C1\uC138 \uADDC\uCE59</summary>' +
                  '<div class="muted"><b>\uBAA9\uD45C:</b> ' +
                  esc(g.objective) +
                  '</div>' +
                  '<div class="muted"><b>\uCC44\uD305:</b> ' +
                  esc(g.chatPolicy) +
                  '</div>' +
                  '<ul>' +
                  g.phases
                    .map(function (p) {
                      return '<li>' + esc(p) + '</li>';
                    })
                    .join('') +
                  '</ul>' +
                  '</details></article>'
                );
              })
              .join('') +
            '</div></section>'
          );
        })
        .join('') +
      '</main>';
    bindCommonNav();
  }

  /* ─────────── LEADERBOARD ─────────── */
  function renderLeaderboard() {
    root.innerHTML =
      renderNav(currentRoute()) +
      '<main class="page"><section class="card"><h2>\uB9AC\uB354\uBCF4\uB4DC</h2>' +
      '<table class="board"><thead><tr><th>#</th><th>\uC720\uC800</th><th>\uC0C1\uD0DC</th><th>\uCE74\uB4DC</th><th>\uC2B9</th><th>\uC0AC\uB9DD</th><th>\uD68D\uB4DD \uCE74\uB4DC</th></tr></thead><tbody>' +
      state.leaderboard
        .map(function (r, i) {
          return (
            '<tr><td>' +
            (i + 1) +
            '</td><td>' +
            esc(r.username) +
            '</td><td>' +
            esc(r.status) +
            '</td><td>' +
            r.cards +
            '</td><td>' +
            r.wins +
            '</td><td>' +
            r.deaths +
            '</td><td class="small">' +
            esc((r.ownedCards || []).join(', ')) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></section></main>';
    bindCommonNav();
  }

  /* ─────────── ADMIN ─────────── */
  function renderAdmin() {
    if (state.user.role !== 'admin') {
      location.hash = '#lobby';
      return;
    }
    root.innerHTML =
      renderNav(currentRoute()) +
      '<main class="page-grid">' +
      '<section class="card span-4"><h2>\uC0AC\uB9DD \uC0C1\uD0DC \uD574\uC81C</h2><form id="admin-reset-form" class="stack"><label>\uC720\uC800\uBA85<input name="username" required /></label><button class="primary" type="submit">\uC0C1\uD0DC \uD574\uC81C</button></form><div class="hint">\uC5B4\uB4DC\uBBFC\uC740 \uD2B8\uB7FC\uD504 \uCE74\uB4DC \uD074\uB9AD \uC2DC \uBD07\uC774 \uC790\uB3D9 \uCD94\uAC00\uB429\uB2C8\uB2E4.</div></section>' +
      '<section class="card span-8"><h2>\uBE60\uB978 \uD14C\uC2A4\uD2B8</h2><div class="game-grid">' +
      state.games
        .map(function (g) {
          return (
            '<button class="ghost quick-room-btn" data-card="' +
            g.code +
            '">' +
            g.code +
            ' ' +
            esc(g.name) +
            '</button>'
          );
        })
        .join('') +
      '</div></section></main>';
    bindCommonNav();
    bind('admin-reset-form', 'submit', function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      api('/api/admin/reset-user', {
        method: 'POST',
        body: { username: f.get('username') },
      })
        .then(function () {
          notify('\uC0C1\uD0DC \uD574\uC81C \uC644\uB8CC');
          refreshLeaderboard();
        })
        .catch(function (e) {
          notify(e.message, 'error');
        });
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('.quick-room-btn'),
      function (btn) {
        btn.addEventListener('click', function () {
          callSocket('room:create', {
            name: 'ADMIN TEST ' + btn.getAttribute('data-card'),
            cardCode: btn.getAttribute('data-card'),
            addBots: 10,
          }).then(function (r) {
            if (!r.ok) return notify(r.error, 'error');
            location.hash = '#room/' + r.roomId;
          });
        });
      }
    );
  }

  /* ─────────── ROOM WAITING ─────────── */
  function renderRoomWaiting(room) {
    var game = room.card || gameByCode(room.cardCode);
    var isHost = room.hostId === state.user.id;
    root.innerHTML =
      renderNav(currentRoute()) +
      '<main class="page-grid">' +
      '<section class="card span-4">' +
      '<div class="suit-badge suit-' +
      game.suit +
      '">' +
      SUIT_ICON[game.suit] +
      ' ' +
      game.code +
      '</div>' +
      '<h2 style="margin-top:8px">' +
      esc(room.name) +
      '</h2>' +
      '<div class="muted">' +
      esc(game.name) +
      ' / \uB09C\uC774\uB3C4 ' +
      game.difficulty +
      '</div>' +
      '<div class="stack compact" style="margin-top:14px"><div>\uC0C1\uD0DC: <b>' +
      esc(room.status) +
      '</b></div>' +
      '<div>\uBC29\uC7A5: <b>' +
      esc(pName(room.players, room.hostId)) +
      '</b></div>' +
      '<div>\uC778\uC6D0: <b>' +
      room.players.length +
      '</b> / \uCD5C\uC18C ' +
      game.players.min +
      ' / \uCD5C\uB300 ' +
      game.players.max +
      '</div></div>' +
      '<div class="player-list">' +
      room.players
        .map(function (p) {
          return (
            '<div class="player-row"><span>' +
            esc(p.username) +
            (p.isBot ? ' [BOT]' : '') +
            '</span><span class="pill ' +
            (p.ready ? 'ok' : '') +
            '">' +
            (p.ready ? 'READY' : 'WAIT') +
            '</span></div>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="inline-wrap" style="margin-top:14px">' +
      '<button id="leave-btn" class="ghost">\uB098\uAC00\uAE30</button>' +
      '<button id="ready-btn" class="primary">\uC900\uBE44 \uD1A0\uAE00</button>' +
      (isHost
        ? '<button id="start-btn" class="primary">\uAC8C\uC784 \uC2DC\uC791</button>'
        : '') +
      '</div>' +
      (state.user.role === 'admin'
        ? '<div style="margin-top:14px"><label>\uBD07 \uCD94\uAC00<input id="bot-count" type="number" min="0" max="12" value="0" /></label><button id="fill-bot-btn" class="ghost" style="margin-top:6px">\uBD07 \uCD94\uAC00</button></div>'
        : '') +
      '</section>' +
      '<section class="card span-8"><h3>\uCC44\uD305</h3>' +
      '<div id="chat-log" class="chat-log">' +
      room.chat
        .map(function (m) {
          return (
            '<div class="chat-line ' +
            (m.system ? 'system' : '') +
            '"><b>' +
            esc(m.user) +
            '</b> ' +
            esc(m.text) +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '<form id="chat-form" class="inline-form"><input name="text" placeholder="\uBA54\uC2DC\uC9C0 \uC785\uB825" /><button class="primary" type="submit">\uC804\uC1A1</button></form>' +
      '</section></main>';

    bindCommonNav();
    bind('leave-btn', 'click', function () {
      callSocket('room:leave').then(function () {
        state.currentRoom = null;
        state.lastRoomVersion = 0;
        state.briefingShown = false;
        state.gameWorldActive = false;
        location.hash = '#lobby';
      });
    });
    bind('ready-btn', 'click', function () {
      var me = room.players.find(function (p) {
        return p.id === state.user.id;
      });
      callSocket('room:ready', { ready: !(me && me.ready) });
    });
    bind('start-btn', 'click', function () {
      callSocket('room:start').then(function (r) {
        if (!r.ok) notify(r.error, 'error');
      });
    });
    bind('fill-bot-btn', 'click', function () {
      var c = document.getElementById('bot-count').value;
      callSocket('room:fill-bots', { count: c }).then(function (r) {
        if (!r.ok) notify(r.error, 'error');
      });
    });
    bind('chat-form', 'submit', function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      callSocket('room:chat', { text: f.get('text') }).then(function (r) {
        if (r.ok) e.target.reset();
        else notify(r.error, 'error');
      });
    });
    scrollChat();
  }

  function scrollChat() {
    var log =
      document.getElementById('chat-log') ||
      document.getElementById('gw-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  /* ─────────── BRIEFING POPUP ─────────── */

  /* ── DETAILED RULES per game code ── */
  var DETAILED_RULES = {
    S1: {
      rules: [
        '화면에 적색 원형 안전 구역이 표시되며, 이 구역은 계속 이동합니다.',
        '커서(또는 터치)를 안전 구역 내부에 유지해야 합니다.',
        '안전 구역 밖에 1.2초 이상 연속 체류 시 즉시 탈락합니다.',
        '75초간 총 체류율이 68% 이상이면 통과입니다.',
        '안전 구역은 시간이 지날수록 크기가 줄어듭니다.',
      ],
      example:
        '예시: 75초 중 51초를 안전 구역 안에서 유지하면 체류율 68% → 통과. 하지만 중간에 1.2초 연속 이탈이 발생하면 체류율과 무관하게 즉시 사망.',
    },
    S2: {
      rules: [
        '화면에 심박 비트가 표시되며, 비트에 맞춰 스페이스/탭을 입력합니다.',
        '비트와의 오차 120ms 이내: Perfect, 220ms 이내: Good.',
        '45초짜리 구간이 2회 진행됩니다.',
        '정확도 72% 이상 또는 최대 콤보 25 이상이면 통과.',
        'BPM이 랜덤으로 변화하여 후반에 난도가 올라갑니다.',
      ],
      example:
        '예시: 총 30비트 중 22비트를 Perfect/Good으로 맞추면 73% → 통과. 연속 25비트를 맞추면 정확도와 무관하게 통과.',
    },
    S3: {
      rules: [
        '자동으로 전진하는 캐릭터를 점프/슬라이드로 조작합니다.',
        '장애물에 충돌하면 충돌 횟수가 올라갑니다.',
        '3회 이상 충돌 시 탈락합니다.',
        '90초간 거리 1200점 이상 달성 시 통과.',
        '속도가 점점 빨라지며 장애물 간격이 불규칙해집니다.',
      ],
      example:
        '예시: 90초간 1350점 거리를 달리고 2회 충돌 → 통과. 1500점이어도 충돌 3회면 탈락.',
    },
    S4: {
      rules: [
        '마이크를 사용하여 목소리 볼륨(데시벨)을 목표 구간에 맞춥니다.',
        '목표 밴드는 위아래로 지속적으로 움직입니다.',
        '20초 × 3구간으로 구성됩니다.',
        '목표 밴드 유지율 65% 이상이면 통과.',
        '갑작스러운 큰 소리(피크)는 페널티로 처리됩니다.',
        '마이크 미지원 시 키보드 대체 모드가 제공됩니다.',
      ],
      example:
        '예시: 3구간(60초) 중 39초를 밴드 안에서 유지하면 65% → 통과. 비명을 지르면 피크 페널티.',
    },
    S5: {
      rules: [
        '마우스/터치로 캐릭터를 이동시켜 빨간 레이저를 피합니다.',
        '코어 3개를 수집한 후 20초 추가 생존해야 합니다.',
        '레이저나 벽에 닿으면 체력이 감소합니다.',
        '체력이 0이 되면 탈락합니다.',
        '포탑 패턴은 세트별로 달라집니다.',
      ],
      example:
        '예시: 코어 3개 모두 수집하고 잔여 체력 40% → 20초만 더 버티면 통과. 코어 2개만 수집하면 시간과 무관하게 탈락.',
    },
    S6: {
      rules: [
        '흔들리는 전선(스플라인 경로)을 따라 커서를 이동시킵니다.',
        '경로 미리보기가 8초간 주어집니다.',
        '바람 이벤트 시 전선 궤적이 급변합니다.',
        '선에서 크게 벗어나면 안정도가 감소합니다.',
        '60초 내 안정도 70 이상 유지 또는 완주 시 통과.',
      ],
      example:
        '예시: 안정도 75로 완주하지 못해도 통과. 완주했지만 안정도 60이면 탈락.',
    },
    S7: {
      rules: [
        'A키와 L키를 정확히 번갈아 눌러 열 에너지를 충전합니다.',
        '같은 키를 연속으로 누르면 과열됩니다.',
        '리듬이 끊기면(입력 간격이 길면) 에너지가 급격히 식습니다.',
        '열 에너지 100까지 충전하되, 과열 5회 미만이면 통과.',
        '10초 연습 후 70초 본 게임입니다.',
      ],
      example:
        '예시: A-L-A-L... 정확히 교대하며 에너지 100 충전, 과열 3회 → 통과. 에너지 120이어도 과열 5회면 탈락.',
    },
    S8: {
      rules: [
        '코스가 시작 전 8초간만 보입니다.',
        '플레이 중에는 화면이 어두워지며 간헐적 플래시만 켜집니다.',
        '장애물 위치를 기억하고 어둠 속에서 돌파합니다.',
        '3구간 중 2구간 이상 성공하면 통과.',
        '플래시 간격은 후반으로 갈수록 줄어듭니다.',
      ],
      example:
        '예시: 구간 1 실패, 구간 2,3 성공 → 통과 (2/3). 구간 1,2 실패 → 기회 없이 탈락.',
    },
    S9: {
      rules: [
        '점프 외에 "중력 반전" 키로 천장과 바닥을 전환할 수 있습니다.',
        '일부 장애물은 반전 없이 피할 수 없습니다.',
        '100초간 진행되며 점수 = 거리 + 수집물 - 충돌 패널티.',
        '1600점 이상 또는 전체 참가자 상위 50%면 통과.',
        '반전에는 쿨다운이 있습니다.',
      ],
      example:
        '예시: 점수 1800으로 상위 40% → 통과. 점수 1400이지만 전체 6명 중 3등 이내 → 역시 통과.',
    },
    S10: {
      rules: [
        '4개 스테이지가 연속 진행됩니다: 리듬 → 마우스 회피 → 마이크 → 중력 러너.',
        '각 스테이지에서 부분 점수를 얻습니다.',
        '한 스테이지 실패 시 페널티 점수를 받고 다음 스테이지로 넘어갑니다.',
        '총합 240점 이상 또는 상위 40% 생존.',
        '스테이지 간 5초 요약 패널이 표시됩니다.',
      ],
      example:
        '예시: 리듬 80 + 회피 70 + 마이크 50 + 러너 60 = 260 → 통과. 리듬 30 + 나머지 합 180 = 210 → 상위 40% 아니면 탈락.',
    },
    C1: {
      rules: [
        '랜덤 시점에 "신호"가 발생합니다.',
        '신호가 나오면 모든 플레이어가 동시에 버튼을 눌러야 합니다.',
        '신호 전에 누르면(선입력) 실패 처리됩니다.',
        '모든 입력이 신호 후 700ms 이내, 전체 편차 400ms 이내면 통과.',
        '30초 토론 시간에 전략을 논의할 수 있습니다.',
      ],
      example:
        '예시: 신호 발생 → A가 200ms, B가 350ms, C가 500ms에 입력 → 편차 300ms → 통과! A가 800ms에 입력 → 700ms 초과로 팀 전원 탈락.',
    },
    C2: {
      rules: [
        '각 플레이어에게 4장의 카드가 배분됩니다 (4장은 비공개로 제거).',
        '원형 순서대로 두 바퀴 카드 1장씩 오른쪽으로 전달합니다.',
        '전달 완료 후 손패 중 같은 숫자가 2장이면 페어로 처리되어 최고값 보너스.',
        '최종 점수가 제거된 4장의 합 이상이면 통과.',
        '어떤 카드를 넘길지가 핵심 전략입니다.',
      ],
      example:
        '예시: 제거 카드 합 = 12. 내 최종 손패 [3,3,5,7] → 페어 보너스로 3이 4(최고값)로 교체 → 합 = 4+4+5+7 = 20 → 통과.',
    },
    C3: {
      rules: [
        '하나의 정답 개념(예: "블랙홀")에 대해 3명이 각각 다른 설명 조각을 받습니다.',
        '채팅으로 서로 단서를 나눌 수 있습니다.',
        '제한 시간 내에 3명 모두 같은 정답을 동시에 입력해야 합니다.',
        '한 명이라도 다른 답을 쓰면 전원 탈락.',
        '오타 허용 유사도 비교가 적용됩니다.',
      ],
      example:
        '예시: 조각 1 "빛이 빠져나가지 못한다" / 조각 2 "사건의 지평선" / 조각 3 "별의 붕괴" → 정답: 블랙홀. 한 명이 "웜홀"이라 쓰면 전원 사망.',
    },
    C4: {
      rules: [
        '플레이어가 순서대로 돌아가며 예/아니오 질문을 던집니다.',
        '나머지 플레이어가 예 또는 아니오로 응답합니다.',
        '응답이 정확히 반반이면 질문자 생존, 아니면 질문자 탈락.',
        '탈락자의 응답은 이후 질문에서 자동 응답으로 처리됩니다.',
        '홀수 인원만 시작 가능합니다.',
      ],
      example:
        '예시: 5명 중 A가 "진실이 항상 중요한가?" 질문 → 예2/아니오2 (A 제외 4명) → 반반이므로 A 생존. 예3/아니오1이면 A 탈락.',
    },
    C5: {
      rules: [
        '각 플레이어에게 비공개 지도 단서가 배부됩니다.',
        '90초간 채팅으로 단서를 공유하고 토론합니다.',
        '3×3 출구 격자 중 하나를 전원이 동시에 비밀 투표합니다.',
        '전원이 같은 출구를 선택하고, 그 출구가 정답이어야 통과.',
        '만장일치가 아니면 즉시 전원 탈락입니다.',
      ],
      example:
        '예시: 단서 A "2행이다", 단서 B "3열이다" → 정답은 (2,3)=6번 칸. 5명 중 4명이 6번, 1명이 5번 → 만장일치 아님 → 전원 사망.',
    },
    C6: {
      rules: [
        '두 팀으로 나뉘며 각자 30토큰을 가지고 시작합니다.',
        '매 라운드 비공개로 기부할 토큰 수를 선택합니다.',
        '팀 기부 합이 높은 팀이 라운드 승리합니다.',
        '3승 팀이 이기거나, 5라운드 종료 시 누적 기부로 판정.',
        '승리 팀: 최소 기여자 탈락 / 패배 팀: 최고 기여자만 생존.',
      ],
      example:
        '예시: A팀 승리. A팀에서 가장 적게 기부한 사람 탈락. B팀에서 가장 많이 기부한 사람만 생존, 나머지 사망.',
    },
    C7: {
      rules: [
        '5개 심볼의 올바른 순서를 맞추는 게임입니다.',
        '각 플레이어에게 비공개 규칙 카드가 배부됩니다.',
        '90초간 채팅으로 규칙을 공유한 뒤, 채팅이 차단됩니다.',
        '각자 독립적으로 최종 순서를 제출합니다.',
        '전원 동일한 정답을 제출해야 통과, 하나라도 다르면 전원 탈락.',
      ],
      example:
        '예시: 규칙 "□는 첫 번째" + "☆는 △ 바로 앞" → □☆△... 대화 중 "◆은 ○ 바로 앞"이라는 정보를 놓치면 순서가 달라져 전멸.',
    },
    C8: {
      rules: [
        '3개 웨이브를 연속으로 버텨야 합니다.',
        '각 플레이어에게 비공개 체력(4~8)과 약점 웨이브가 있습니다.',
        '약점 웨이브에서는 최대 하중이 2로 제한됩니다.',
        '웨이브 요구 하중 = (생존자 수 × 3 + 웨이브 번호).',
        '총합이 부족하거나 누군가 과부하되면 전원 탈락입니다.',
      ],
      example:
        '예시: 4명, 웨이브2 요구=14. A(체력6,약점2→최대2) B(체력5) C(체력4) D(체력7). A는 최대 2만 부담 가능. B+C+D가 나머지 12 분담 필요.',
    },
    C9: {
      rules: [
        '자기 자신에게는 줄 수 없는 에너지 4토큰을 타인에게 분배합니다.',
        '분배 후 각자의 에너지 = 이전 에너지 + 받은 양 - 4.',
        '에너지가 1 미만으로 떨어지면 전원 탈락합니다.',
        '4라운드 동안 단 한 명도 1 미만이 되면 안 됩니다.',
        '라운드가 진행될수록 소모량이 높아질 수 있습니다.',
      ],
      example:
        '예시: 3명(A:4, B:4, C:4). A가 B에게 2, C에게 2 → A는 4+받은량-4. B,C도 비슷하게 분배해야 모두 1 이상 유지.',
    },
    C10: {
      rules: [
        '3개 체크포인트마다 A/B/C 중 정답 루트를 선택합니다.',
        '체크포인트 사이 짧은 교신 시간에만 채팅 가능합니다.',
        '각 플레이어에게 체크포인트별 비공개 단서가 주어집니다.',
        '전원 만장일치 + 정답이어야 통과합니다.',
        '하나라도 오답이면 전원 즉시 탈락.',
      ],
      example:
        '예시: 체크포인트1 단서 "B와 C는 오답" → 정답 A. 단서를 제대로 공유하지 못해 한 명이 B를 찍으면 전원 사망.',
    },
    D1: {
      rules: [
        '4자리 비밀 코드(1~6)를 추론하는 Mastermind 스타일 게임입니다.',
        '매 시도마다 "정확 위치(●)" + "색만 맞음(○)" 힌트를 받습니다.',
        '최대 5번 시도할 수 있습니다.',
        '5번 안에 정확히 맞추면 통과.',
        '중복 숫자가 가능합니다.',
      ],
      example:
        '예시: 비밀=[2,4,1,3]. 시도 [1,2,3,4] → ●0 ○4 (위치 0, 색 4개 존재). 시도 [2,4,3,1] → ●2 ○2. 이런 식으로 5번 안에 맞춰야 합니다.',
    },
    D2: {
      rules: [
        '4개 항목의 올바른 순서를 단서로부터 도출합니다.',
        '단서 예: "A는 첫 번째가 아니다", "B는 C보다 뒤에 있다".',
        '모든 단서를 조합하면 유일한 정답 순서가 나옵니다.',
        '정답 순서를 완전히 일치시켜 제출하면 통과.',
        '드래그 정렬 방식으로 입력합니다.',
      ],
      example:
        '예시: 항목=[비,안개,천둥,햇빛]. 단서 "천둥은 마지막", "비는 안개보다 앞" → 정답: 비→안개→햇빛→천둥.',
    },
    D3: {
      rules: [
        '숨겨진 덱에서 일부 카드가 표본으로 공개됩니다.',
        '남은 하트(♥) 카드의 수를 추정합니다.',
        '동시에 위험도(1~5)를 베팅합니다.',
        '점수 = |추정-실제| × 위험도. 점수 4 이하면 통과.',
        '위험도가 높을수록 정확할 때 유리하지만, 틀리면 치명적.',
      ],
      example:
        '예시: 실제 하트=5, 내 추정=6, 위험도=3 → 점수=|6-5|×3=3 → 통과. 추정=3, 위험도=4 → 점수=|3-5|×4=8 → 탈락.',
    },
    D4: {
      rules: [
        '격자 미로에서 입구→출구 경로를 정확히 재현합니다.',
        '벽이 있는 칸은 통과할 수 없습니다.',
        '방향을 R(오른쪽)/L(왼쪽)/U(위)/D(아래)로 입력합니다.',
        '정답 경로를 완전히 일치시켜야 통과.',
        '힌트 문장이 하나 제공됩니다.',
      ],
      example:
        '예시: 4×4 미로, 시작(0,0)→끝(3,3). 벽 위치를 피해 RRDDRD 입력 → 정답과 일치하면 통과.',
    },
    D5: {
      rules: [
        'A, B, C, D 4명의 진술이 공개됩니다.',
        '일부는 진실, 일부는 거짓입니다.',
        '모순되는 진술을 분석해 거짓말쟁이를 특정합니다.',
        '거짓말쟁이 조합을 정확히 맞추면 통과.',
        '복수 선택 UI로 입력합니다.',
      ],
      example:
        '예시: A:"B는 거짓말쟁이", B:"C와 D는 같은 편", C:"A는 진실", D:"B는 거짓". 분석하면 B,C가 거짓말쟁이 → [B,C] 선택 시 통과.',
    },
    D6: {
      rules: [
        '비밀 수요 숫자(1~9)에 가까운 시장 평균을 만들어야 합니다.',
        '각자 숫자(1~9)와 가중치(1~3)를 선택합니다.',
        '시장 평균 = Σ(숫자×가중치) / Σ(가중치).',
        '점수 = 10 - |내 숫자-비밀| × 2 - |평균-비밀|. 점수 6 이상이면 통과.',
        '비밀에 대한 단서 2개가 개인별로 제공됩니다.',
      ],
      example:
        '예시: 비밀=7. 단서 "홀수다", "5 이상이다". 내가 7/가중치2 제출, 평균이 6.5 → 점수 = 10 - 0 - 0.5 = 9.5 → 통과.',
    },
    D7: {
      rules: [
        '2×2 빙고판에서 대각선 2칸은 자동 배정, 나머지 2칸을 직접 채웁니다.',
        '5턴 동안 매 턴 숫자를 제출합니다.',
        '전체 제출 숫자의 평균에 가장 가까운 숫자가 채워집니다.',
        '채워진 숫자의 인접 숫자(±1)는 삭제됩니다.',
        '가로 또는 세로 2칸 빙고를 완성하면 통과.',
      ],
      example:
        '예시: 빙고판 [3,_,_,8]. 빈칸에 5,6을 배치 → [3,5,6,8]. 턴 평균이 5면 5가 채워지고 4,6이 삭제.',
    },
    D8: {
      rules: [
        '1~100 사이 비밀 "폭탄 번호"가 있습니다.',
        '순번대로 숫자를 하나씩 부릅니다.',
        '부른 숫자가 폭탄보다 크면 카운트다운 -2, 작으면 -1.',
        '카운트다운이 0이 되면 해당 플레이어 폭발 사망.',
        '정확히 폭탄 번호를 맞추면 나머지 전원 통과.',
      ],
      example:
        '예시: 폭탄=42. A가 60 부름(DOWN, 카운트-2). B가 30 부름(UP, 카운트-1). 범위가 31~59로 좁혀짐. 누군가 42를 맞추면 즉시 종료, 생존자 모두 통과.',
    },
    D9: {
      rules: [
        '2대2 팀전. 각자 동물 5마리를 비공개 배치합니다(원숭이1~오랑우탄5점).',
        '순서대로 "동물 X가 Y마리 이상" 선언하거나 심판(도전)합니다.',
        '심판 시: 실제 총 마리 수 ≥ 선언이면 선언자 승리, 아니면 심판자 승리.',
        '세트 종료 후 점수가 누적됩니다.',
        '팀 중 누구라도 10점 달성 또는 3세트 후 점수합 높은 팀 통과.',
      ],
      example:
        '예시: 4명이 배치한 사자 총합 = 8. "사자 10마리" 선언 → 심판 시 실제 8 < 10이므로 심판자 승리, 사자(4점) 획득.',
    },
    D10: {
      rules: [
        '논리 회로의 스위치 조합을 찾는 게임입니다.',
        '각 문제에 회로 설명과 부분 출력이 주어집니다.',
        '스위치를 ON(1)/OFF(0)로 설정하여 출력=1을 만들어야 합니다.',
        '3문제 중 2문제 이상 정답이면 통과.',
        'AND, OR, XOR, NOT 논리 게이트가 사용됩니다.',
      ],
      example:
        '예시: "출력 = (A XOR B) AND C". A=1,B=0이면 XOR=1. C=1이면 AND=1 → 출력=1 → 정답.',
    },
    H1: {
      rules: [
        '빈칸이 있는 자기소개서 템플릿이 주어집니다.',
        '빈칸을 채워 자기소개서를 완성합니다.',
        '완성된 소개서가 익명으로 공개됩니다.',
        '가장 눈에 띄는(수상한) 소개서에 한 표씩 투표합니다.',
        '최다 득표자 1명만 탈락. 동표면 전원 생존.',
      ],
      example:
        '예시: "저는 {{특성}}하고..." → "저는 비밀스러운..." 너무 튀면 표가 몰립니다. 평범하면서도 의심을 사지 않는 것이 핵심.',
    },
    H2: {
      rules: [
        '4명 중 1명이 비밀 사보타지로 지정됩니다.',
        '3분 토론 후 가위바위보를 동시에 냅니다.',
        '전원 같은 손 or 3종류 모두 나옴 → 사보타지 단독 탈락.',
        '2종류만 나옴 → 이긴 손 + 사보타지가 생존.',
        '사보타지는 비기기를 원하면서 들키면 안 됩니다.',
      ],
      example:
        '예시: 사보타지=C. A:가위, B:가위, C:보, D:가위 → 가위 vs 보 → 가위 승리. C(사보타지)는 보를 냈으므로 사보타지 포함 져서 C만 탈락.',
    },
    H3: {
      rules: [
        '각자 독약 1, 해독제 1, 빈 상자 1개를 받습니다.',
        '3번의 "밤" 동안 다른 플레이어에게 상자 1개를 보냅니다.',
        '라운드 중에는 받은 상자의 종류를 알 수 없습니다.',
        '3밤 종료 후 독 누적 ≤ 해독제면 생존, 아니면 사망.',
        '전원 사망 시 해독제를 가장 많이 받은 사람이 살아남습니다.',
      ],
      example:
        '예시: A가 3밤 동안 독2+빈1 받음, 해독제1 받음 → 독2 > 해독제1 → A 사망. 독1+해독제2 받으면 → 독1 ≤ 해독제2 → 생존.',
    },
    H4: {
      rules: [
        '최대 3라운드 진행되는 익명 투표 숙청 게임입니다.',
        '각 라운드 토론 후 다른 플레이어에게 투표합니다.',
        '과반 득표자만 탈락합니다.',
        '동률이거나 과반이 안 되면 아무도 죽지 않습니다.',
        '3라운드 후 생존자는 모두 통과.',
      ],
      example:
        '예시: 6명 중 A가 4표 → 과반(50%초과) → A 탈락. B가 3표, C가 3표 → 동률, 아무도 안 죽음.',
    },
    H5: {
      rules: [
        '매 라운드 랜덤으로 2인 1조 페어가 만들어집니다.',
        'catch(받기)/guard(방어)/cut(끊기) 중 비밀 선택.',
        '상호 catch → 둘 다 신뢰점수 +1.',
        '한쪽 catch + 한쪽 cut → catch한 사람 즉사.',
        '3라운드 후 신뢰점수 2 이상 또는 상대를 cut해서 살아남기.',
      ],
      example:
        '예시: A-B 페어. A:catch, B:cut → A 즉사. A:catch, B:catch → 둘 다 +1. A:guard, B:cut → 아무 일 없음.',
    },
    H6: {
      rules: [
        '매 라운드 share(공유)/steal(훔치기)/burn(태우기)를 선택합니다.',
        'share만 있으면 12토큰 균등 분배.',
        'steal이 있으면 도둑이 먼저 최대 5씩 가져가고, 나머지를 share끼리 나눔.',
        'burn은 포트에서 4를 빼지만 자기 자신은 1토큰 보호.',
        '3라운드 후 누적 토큰 하위 1/3 탈락.',
      ],
      example:
        '예시: 4명. share 3명, steal 1명. 포트12에서 steal이 5가져감 → 남은 7을 share 3명이 나눔(각2). burn 2명이면 포트 12-8=4.',
    },
    H7: {
      rules: [
        '비밀 코인으로 Wolf/Fox/Sheep 가면을 입찰합니다.',
        'Wolf(1명): 투표에서 지목 안 당하면 생존.',
        'Fox(1명): Wolf를 정확히 지목하면 생존.',
        'Sheep(나머지): 다수결과 같은 대상을 지목하면 생존.',
        '가면은 비공개이며, 토론 후 의심 대상을 투표합니다.',
      ],
      example:
        '예시: 5명. A가 Wolf(코인3), B가 Fox(코인2). 투표에서 C가 최다득표 → Wolf(A)는 안 지목됐으니 생존. Fox(B)가 A를 지목했으면 B도 생존.',
    },
    H8: {
      rules: [
        '시스템이 진실/거짓 진술 카드를 배부합니다.',
        '공개할 진술을 선택합니다(진실 or 거짓).',
        '다른 플레이어가 trust/doubt에 코인을 베팅합니다.',
        '거짓 진술에 trust를 많이 받으면 큰 보상(평판+2).',
        '2라운드 후 평판 하위 1/3 탈락.',
      ],
      example:
        '예시: A가 거짓 진술 공개 → B,C가 trust → A 평판+2. A가 진실 공개 → D가 doubt → A 평판-1.',
    },
    H9: {
      rules: [
        '1명이 보이지 않는 "칼"을 들고 시작합니다.',
        '매 라운드 hold(유지)/left(왼쪽 전달)/right(오른쪽 전달) 선택.',
        '칼 보유자만 행동 결과가 적용됩니다.',
        '체크포인트(2,4라운드)에서 칼 보유자가 사망합니다.',
        '누가 칼을 들고 있는지 확실히 알 수 없습니다.',
      ],
      example:
        '예시: A가 칼 보유 → right 선택 → B에게 이동. 2라운드 체크포인트에서 칼을 든 사람 사망. 방향 선택으로 칼을 떠넘겨야 합니다.',
    },
    H10: {
      rules: [
        '4라운드 동안 다른 플레이어와 contract(계약)/betray(배신)을 선택합니다.',
        '상호 계약 → 둘 다 +2포인트.',
        '일방 배신 → 배신자 +3, 피해자 -2.',
        '상호 배신 → 변동 없음.',
        '4라운드 후 포인트 상위 절반만 생존.',
      ],
      example:
        '예시: A→B 계약, B→A 배신 → B +3, A -2. A→B 계약, B→A 계약 → 둘 다 +2. 하위 절반은 사망 처리.',
    },
  };

  /* ── micro-animation factory: unique per game code ── */
  function createBriefingDemo(engine, canvas, cardCode) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width,
      H = canvas.height;
    var frame = 0,
      running = true;

    function clear() {
      ctx.fillStyle = '#0a0c12';
      ctx.fillRect(0, 0, W, H);
    }
    function txt(s, x, y, sz, col) {
      ctx.fillStyle = col || '#c8ccd4';
      ctx.font = (sz || 13) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s, x, y);
    }
    function line(x1, y1, x2, y2, col, w) {
      ctx.strokeStyle = col || '#333';
      ctx.lineWidth = w || 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    function circ(x, y, r, col) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    function rect(x, y, w, h, col) {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    }
    // scanline effect
    function scanlines() {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (var i = 0; i < H; i += 3) ctx.fillRect(0, i, W, 1);
    }
    // vignette
    function vig() {
      var g = ctx.createRadialGradient(
        W / 2,
        H / 2,
        W * 0.25,
        W / 2,
        H / 2,
        W * 0.7
      );
      g.addColorStop(0, 'transparent');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // blood drip
    function drip(x, speed, col) {
      var y = (frame * speed) % H;
      ctx.fillStyle = col || 'rgba(180,30,30,0.4)';
      ctx.fillRect(x, 0, 2, y);
      circ(x + 1, y, 3, col || 'rgba(180,30,30,0.5)');
    }

    /* ── S1: 적색 커서 - 이동하는 안전 원, 커서 추적 ── */
    function demoS1() {
      clear();
      var cx = W / 2 + Math.sin(frame * 0.03) * 80,
        cy = H * 0.4 + Math.cos(frame * 0.025) * 30;
      var r = 35 - Math.sin(frame * 0.02) * 10;
      // danger zone
      ctx.fillStyle = 'rgba(180,20,20,0.08)';
      ctx.fillRect(0, 0, W, H);
      // pulsing red scan
      var scan = (frame * 3) % W;
      rect(scan - 2, 0, 4, H, 'rgba(255,40,40,0.15)');
      // safe zone
      ctx.strokeStyle =
        'rgba(80,255,120,' + (0.4 + Math.sin(frame * 0.06) * 0.3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(80,255,120,0.06)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // cursor dot
      var dx = cx + Math.sin(frame * 0.07) * 12,
        dy = cy + Math.cos(frame * 0.09) * 8;
      circ(dx, dy, 4, '#75f5ff');
      // gauge
      var ratio = 0.68 + Math.sin(frame * 0.01) * 0.15;
      rect(20, H - 20, ratio * (W - 40), 6, 'rgba(80,255,120,0.6)');
      rect(20, H - 20, W - 40, 6, 'rgba(255,255,255,0.05)');
      scanlines();
      vig();
      txt('안전 구역 안에 커서를 유지하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S2: 펄스 탭 - 리듬 판정선 ── */
    function demoS2() {
      clear();
      // heartbeat line
      ctx.strokeStyle = '#ff3050';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var x = 0; x < W; x++) {
        var beat =
          Math.sin((x + frame * 4) * 0.06) *
          15 *
          ((x + frame) % 80 < 20 ? 3 : 1);
        var y = H * 0.35 + beat;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // judgment line
      line(W * 0.4, H * 0.15, W * 0.4, H * 0.55, 'rgba(255,200,0,0.3)', 1);
      // tap indicators
      var notes = [0.2, 0.35, 0.5, 0.65, 0.8];
      notes.forEach(function (p, i) {
        var nx = (p * W + frame * 2) % W;
        var hit = Math.abs(nx - W * 0.4) < 15;
        circ(
          nx,
          H * 0.35,
          hit ? 10 : 6,
          hit ? '#52d18c' : 'rgba(255,80,100,0.5)'
        );
        if (hit) txt('♪', nx, H * 0.35 + 4, 14, '#fff');
      });
      // combo
      var combo = Math.floor(frame / 15) % 30;
      txt(
        'COMBO ' + combo,
        W * 0.8,
        H * 0.2,
        14,
        combo > 20 ? '#ffd166' : '#555'
      );
      scanlines();
      vig();
      txt('비트에 맞춰 정확히 탭하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S3: 네온 도약 - 러너 ── */
    function demoS3() {
      clear();
      // ground
      rect(0, H * 0.65, W, 2, 'rgba(100,255,200,0.3)');
      // runner
      var rx = 60,
        ry = H * 0.65 - 20;
      var jumping = Math.sin(frame * 0.08) > 0.5;
      if (jumping) ry -= 25;
      rect(rx - 5, ry, 10, 20, '#75f5ff');
      // legs animation
      if (!jumping) {
        rect(rx - 5, ry + 20, 3, 8, '#75f5ff');
        rect(rx + 2, ry + 20, 3, 8, '#75f5ff');
      }
      // obstacles
      for (var i = 0; i < 5; i++) {
        var ox = ((i * 90 + frame * 2) % (W + 100)) - 20;
        var oh = 15 + i * 5;
        rect(ox, H * 0.65 - oh, 12, oh, 'rgba(255,60,80,0.6)');
      }
      // speed gauge
      var spd = 0.5 + frame * 0.001;
      rect(W - 60, 20, 8, H * 0.4, 'rgba(255,255,255,0.05)');
      rect(
        W - 60,
        20 + H * 0.4 * (1 - Math.min(spd, 1)),
        8,
        H * 0.4 * Math.min(spd, 1),
        'rgba(255,180,0,0.5)'
      );
      // score
      txt('' + frame * 2, W * 0.8, H * 0.85, 16, '#ffd166');
      scanlines();
      vig();
      txt('장애물을 피해 달려라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S4: 숨결 측정 - 데시벨 밴드 ── */
    function demoS4() {
      clear();
      // target band
      var bandY = H * 0.3 + Math.sin(frame * 0.03) * 40;
      var bandH = 30;
      rect(40, bandY, W - 80, bandH, 'rgba(80,200,255,0.12)');
      ctx.strokeStyle = 'rgba(80,200,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(40, bandY, W - 80, bandH);
      // dB bar
      var db = bandY + bandH / 2 + Math.sin(frame * 0.07) * 25;
      rect(
        W / 2 - 3,
        Math.min(db, bandY + bandH),
        6,
        H * 0.7 - Math.min(db, bandY + bandH),
        'rgba(255,100,100,0.3)'
      );
      circ(
        W / 2,
        db,
        6,
        db > bandY && db < bandY + bandH ? '#52d18c' : '#ff4060'
      );
      // O2 gauge
      var o2 = 0.7 + Math.sin(frame * 0.015) * 0.2;
      txt('O₂', 20, H * 0.85, 11, '#888');
      rect(
        40,
        H * 0.82,
        o2 * (W - 80),
        8,
        o2 > 0.5 ? 'rgba(80,200,120,0.5)' : 'rgba(255,60,60,0.5)'
      );
      scanlines();
      vig();
      txt('목표 데시벨 밴드를 유지하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S5: 레이저 직조 - 회피 ── */
    function demoS5() {
      clear();
      // laser lines
      for (var i = 0; i < 6; i++) {
        var ly = H * 0.15 + i * (H * 0.12);
        var lx1 = Math.sin(frame * 0.02 + i) * 50;
        var lx2 = W - Math.cos(frame * 0.03 + i) * 50;
        line(
          lx1,
          ly,
          lx2,
          ly + Math.sin(frame * 0.04 + i) * 20,
          'rgba(255,30,30,0.35)',
          2
        );
      }
      // player dot
      var px = W / 2 + Math.sin(frame * 0.04) * 60,
        py = H * 0.5 + Math.cos(frame * 0.05) * 30;
      circ(px, py, 5, '#75f5ff');
      // cores
      for (var c = 0; c < 3; c++) {
        var collected = c < Math.floor(frame / 120) % 4;
        circ(
          50 + c * 40,
          H * 0.85,
          6,
          collected ? 'rgba(255,200,0,0.2)' : '#ffd166'
        );
        if (!collected) txt('◆', 50 + c * 40, H * 0.85 + 4, 10, '#ffd166');
      }
      // HP bar
      var hp = 0.6 + Math.sin(frame * 0.01) * 0.3;
      rect(W - 80, 10, 60 * hp, 6, hp > 0.4 ? '#52d18c' : '#ff4060');
      scanlines();
      vig();
      txt('레이저를 피해 코어를 수집하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S6: 철선 균형 - 스플라인 위 이동 ── */
    function demoS6() {
      clear();
      // wire path
      ctx.strokeStyle = 'rgba(200,200,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var x = 0; x < W; x++) {
        var wy =
          H * 0.45 +
          Math.sin(x * 0.03 + frame * 0.02) * 30 +
          Math.cos(x * 0.05) * 15;
        x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
      }
      ctx.stroke();
      // cursor on wire
      var cx = (frame * 1.5) % W;
      var wireY =
        H * 0.45 +
        Math.sin(cx * 0.03 + frame * 0.02) * 30 +
        Math.cos(cx * 0.05) * 15;
      var cursorY = wireY + Math.sin(frame * 0.08) * 8;
      circ(cx, cursorY, 5, '#75f5ff');
      // stability gauge
      var stab = 70 + Math.sin(frame * 0.02) * 20;
      txt(
        '안정도: ' + Math.floor(stab),
        W / 2,
        H * 0.85,
        12,
        stab > 70 ? '#52d18c' : '#ff6b81'
      );
      // wind
      if (frame % 200 < 30) {
        txt('💨 바람!', W * 0.7, H * 0.2, 14, 'rgba(255,200,100,0.6)');
      }
      scanlines();
      vig();
      txt('전선 위에서 균형을 유지하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S7: 양손 용광로 - 교대 입력 ── */
    function demoS7() {
      clear();
      // forge glow
      var glow = 0.3 + Math.sin(frame * 0.08) * 0.2;
      ctx.fillStyle = 'rgba(255,100,20,' + glow + ')';
      ctx.fillRect(W * 0.3, H * 0.2, W * 0.4, H * 0.4);
      // A / L keys
      var aHit = frame % 20 < 10,
        lHit = frame % 20 >= 10;
      rect(
        W * 0.2 - 20,
        H * 0.7,
        40,
        30,
        aHit ? 'rgba(100,200,255,0.5)' : 'rgba(255,255,255,0.08)'
      );
      txt('A', W * 0.2, H * 0.7 + 20, 16, aHit ? '#fff' : '#555');
      rect(
        W * 0.8 - 20,
        H * 0.7,
        40,
        30,
        lHit ? 'rgba(100,200,255,0.5)' : 'rgba(255,255,255,0.08)'
      );
      txt('L', W * 0.8, H * 0.7 + 20, 16, lHit ? '#fff' : '#555');
      // heat gauge
      var heat = 50 + (frame % 100);
      rect(
        W * 0.35,
        H * 0.65,
        W * 0.3 * (heat / 100),
        8,
        heat > 90 ? '#ff4060' : '#ffd166'
      );
      // overheat warning
      if (heat > 85) txt('⚠ 과열', W / 2, H * 0.15, 14, '#ff4060');
      scanlines();
      vig();
      txt('A-L 교대로 열을 충전하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S8: 블라인드 대시 - 암전 러너 ── */
    function demoS8() {
      clear();
      var phase = Math.floor(frame / 100) % 3; // 0=preview,1=dark,2=flash
      if (phase === 0) {
        // visible course
        rect(0, H * 0.6, W, 2, 'rgba(100,255,200,0.3)');
        for (var i = 0; i < 4; i++)
          rect(
            80 + i * 70,
            H * 0.6 - 20 - i * 5,
            15,
            20 + i * 5,
            'rgba(255,100,80,0.5)'
          );
        txt('📖 암기 중...', W / 2, H * 0.2, 13, '#ffd166');
      } else if (phase === 1) {
        // dark
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, 0, W, H);
        txt('■■■ 암전 ■■■', W / 2, H * 0.4, 16, 'rgba(255,40,40,0.4)');
        circ(60, H * 0.58, 4, '#75f5ff'); // runner barely visible
      } else {
        // flash
        rect(0, H * 0.6, W, 2, 'rgba(100,255,200,0.2)');
        for (var i = 0; i < 4; i++)
          rect(
            80 + i * 70,
            H * 0.6 - 20 - i * 5,
            15,
            20 + i * 5,
            'rgba(255,100,80,0.3)'
          );
        circ(60, H * 0.58, 4, '#75f5ff');
        txt('⚡ 플래시', W / 2, H * 0.2, 13, 'rgba(255,255,200,0.6)');
      }
      scanlines();
      vig();
      txt('코스를 기억하고 어둠 속을 달려라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S9: 중력 반전 - 천장/바닥 ── */
    function demoS9() {
      clear();
      var flipped = Math.sin(frame * 0.04) > 0;
      rect(0, flipped ? 0 : H * 0.7, W, 2, 'rgba(100,255,200,0.3)');
      rect(0, flipped ? H * 0.7 : 0, W, 2, 'rgba(255,100,100,0.2)');
      var ry = flipped ? 12 : H * 0.7 - 22;
      rect(60, ry, 10, 20, '#75f5ff');
      // obstacles on both sides
      for (var i = 0; i < 3; i++) {
        var ox = ((i * 100 + frame * 2) % (W + 50)) - 20;
        rect(ox, H * 0.7 - 15, 12, 15, 'rgba(255,60,80,0.5)');
        rect(ox + 40, 2, 12, 15, 'rgba(255,60,80,0.3)');
      }
      // gravity indicator
      txt(
        flipped ? '▲ 반전' : '▼ 정상',
        W * 0.85,
        H * 0.5,
        12,
        flipped ? '#ff6b81' : '#52d18c'
      );
      scanlines();
      vig();
      txt('중력을 뒤집어 장애물을 피하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── S10: 패닉 오케스트라 - 멀티 스테이지 ── */
    function demoS10() {
      clear();
      var stage = Math.floor(frame / 80) % 4;
      var labels = ['🎵 리듬', '🖱 회피', '🎤 마이크', '🔄 중력'];
      var colors = ['#ff6b81', '#75f5ff', '#ffd166', '#52d18c'];
      // stage indicator
      for (var i = 0; i < 4; i++) {
        rect(
          20 + i * 75,
          H * 0.15,
          65,
          24,
          i === stage ? colors[i] : 'rgba(255,255,255,0.05)'
        );
        txt(
          labels[i],
          52 + i * 75,
          H * 0.15 + 16,
          10,
          i === stage ? '#0a0c12' : '#444'
        );
      }
      // mini preview of current stage
      if (stage === 0) {
        for (var n = 0; n < 5; n++) {
          var nx = (n * 50 + frame * 2) % W;
          circ(nx, H * 0.5, 5, 'rgba(255,107,129,0.5)');
        }
      }
      if (stage === 1) {
        for (var l = 0; l < 4; l++) {
          line(
            Math.sin(frame * 0.02 + l) * 50 + W * 0.3,
            H * 0.3 + l * 25,
            W * 0.7 + Math.cos(frame * 0.03 + l) * 50,
            H * 0.3 + l * 25,
            'rgba(255,30,30,0.3)',
            2
          );
        }
        circ(W / 2, H * 0.5, 5, '#75f5ff');
      }
      if (stage === 2) {
        var bY = H * 0.35 + Math.sin(frame * 0.03) * 35;
        rect(W * 0.4, bY, W * 0.2, 25, 'rgba(80,200,255,0.1)');
        circ(
          W / 2,
          bY + 12 + Math.sin(frame * 0.06) * 15,
          5,
          Math.abs(Math.sin(frame * 0.06) * 15) < 10 ? '#52d18c' : '#ff4060'
        );
      }
      if (stage === 3) {
        var fl = Math.sin(frame * 0.05) > 0;
        rect(0, fl ? 0 : H * 0.65, W, 2, 'rgba(100,255,200,0.3)');
        rect(60, fl ? 12 : H * 0.65 - 22, 10, 20, '#75f5ff');
      }
      // total score
      txt('총합: ' + (120 + (frame % 150)), W / 2, H * 0.82, 14, '#ffd166');
      scanlines();
      vig();
      txt('4단계 종합 피지컬 결전', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C1: 심박 동기화 ── */
    function demoC1() {
      clear();
      var phase = Math.floor(frame / 70) % 3;
      // heartbeat line
      ctx.strokeStyle = phase === 1 ? '#ff3050' : 'rgba(255,48,80,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var x = 0; x < W; x++) {
        var amp = phase === 1 ? 30 : 4;
        var y = H * 0.3 + Math.sin((x + frame * 3) * 0.05) * amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // player dots
      var ps = [W * 0.2, W * 0.35, W * 0.5, W * 0.65, W * 0.8];
      ps.forEach(function (px, i) {
        var pressed = phase === 2;
        var delay = pressed ? Math.sin(i * 1.2) * 4 : 0;
        circ(
          px,
          H * 0.6 + delay,
          14,
          pressed ? 'rgba(82,209,140,0.6)' : 'rgba(255,255,255,0.08)'
        );
        txt(
          pressed ? '✓' : '⏳',
          px,
          H * 0.6 + delay + 4,
          12,
          pressed ? '#fff' : '#555'
        );
      });
      // spread indicator
      if (phase === 2) {
        var spread = Math.floor(Math.random() * 200 + 100);
        txt(
          '편차: ' + spread + 'ms',
          W / 2,
          H * 0.82,
          12,
          spread < 400 ? '#52d18c' : '#ff4060'
        );
      }
      scanlines();
      vig();
      txt(
        phase === 0
          ? '대기 중...'
          : phase === 1
          ? '🔴 신호 발생!'
          : '동시 입력 판정',
        W / 2,
        H * 0.92,
        11,
        '#666'
      );
    }

    /* ── C2: 럭키 페어 - 카드 전달 ── */
    function demoC2() {
      clear();
      var n = 4,
        cx = W / 2,
        cy = H * 0.4,
        R = 55;
      for (var i = 0; i < n; i++) {
        var a = (Math.PI * 2 * i) / n - Math.PI / 2;
        var px = cx + Math.cos(a) * R,
          py = cy + Math.sin(a) * R;
        circ(px, py, 16, 'rgba(97,218,251,0.12)');
        // mini hand
        for (var c = 0; c < 3; c++) {
          rect(
            px - 12 + c * 8,
            py - 20 + c * 2,
            7,
            10,
            'rgba(255,209,102,0.3)'
          );
        }
        txt('P' + (i + 1), px, py + 5, 10, '#aaa');
      }
      // card passing animation
      var t = (frame % 80) / 80;
      var fi = Math.floor(frame / 80) % n,
        ti = (fi + 1) % n;
      var a1 = (Math.PI * 2 * fi) / n - Math.PI / 2,
        a2 = (Math.PI * 2 * ti) / n - Math.PI / 2;
      var mx = cx + Math.cos(a1) * R + (Math.cos(a2) - Math.cos(a1)) * R * t;
      var my = cy + Math.sin(a1) * R + (Math.sin(a2) - Math.sin(a1)) * R * t;
      rect(mx - 6, my - 8, 12, 11, '#ffd166');
      txt('♦', mx, my, 10, '#0a0c12');
      // removed cards
      txt('제거: ████', W / 2, H * 0.82, 11, 'rgba(255,60,60,0.4)');
      scanlines();
      vig();
      txt('카드를 돌려 페어를 만들어라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C3: 릴레이 추론 - 단서 조각 ── */
    function demoC3() {
      clear();
      // 3 players with puzzle pieces
      var ps = [
        { x: W * 0.2, y: H * 0.4 },
        { x: W * 0.5, y: H * 0.4 },
        { x: W * 0.8, y: H * 0.4 },
      ];
      ps.forEach(function (p, i) {
        rect(p.x - 25, p.y - 15, 50, 30, 'rgba(80,200,255,0.08)');
        ctx.strokeStyle = 'rgba(80,200,255,0.3)';
        ctx.strokeRect(p.x - 25, p.y - 15, 50, 30);
        txt('단서 ' + (i + 1), p.x, p.y + 3, 10, '#75f5ff');
        // mystery content
        txt('???', p.x, p.y + 18, 9, 'rgba(255,255,255,0.2)');
      });
      // answer area
      var reveal = Math.floor(frame / 120) % 2;
      rect(W * 0.3, H * 0.7, W * 0.4, 25, 'rgba(255,209,102,0.08)');
      txt(
        reveal ? '블랙홀?' : '_ _ _ _',
        W / 2,
        H * 0.7 + 16,
        14,
        reveal ? '#ffd166' : '#555'
      );
      // connection lines
      ctx.setLineDash([4, 4]);
      ps.forEach(function (p) {
        line(p.x, p.y + 15, W / 2, H * 0.7, 'rgba(200,200,255,0.1)');
      });
      ctx.setLineDash([]);
      scanlines();
      vig();
      txt('단서를 조합해 정답을 추론하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C4: 밸런싱 게임 - 예/아니오 분할 ── */
    function demoC4() {
      clear();
      // question card
      rect(W * 0.15, H * 0.15, W * 0.7, 35, 'rgba(255,209,102,0.08)');
      txt('"진실이 항상 중요한가?"', W / 2, H * 0.15 + 22, 12, '#ffd166');
      // yes/no bars
      var yes = 0.5 + Math.sin(frame * 0.03) * 0.3;
      rect(W * 0.1, H * 0.55, W * 0.35 * yes, 25, 'rgba(82,209,140,0.4)');
      rect(
        W * 0.55,
        H * 0.55,
        W * 0.35 * (1 - yes),
        25,
        'rgba(255,107,129,0.4)'
      );
      txt(
        '예 ' + Math.round(yes * 100) + '%',
        W * 0.25,
        H * 0.55 + 17,
        12,
        '#52d18c'
      );
      txt(
        '아니오 ' + Math.round((1 - yes) * 100) + '%',
        W * 0.75,
        H * 0.55 + 17,
        12,
        '#ff6b81'
      );
      // balance indicator
      var balanced = Math.abs(yes - 0.5) < 0.05;
      circ(W / 2, H * 0.75, 8, balanced ? '#52d18c' : '#ff4060');
      txt(
        balanced ? '균형!' : '불균형',
        W / 2,
        H * 0.82,
        11,
        balanced ? '#52d18c' : '#ff4060'
      );
      scanlines();
      vig();
      txt('정확히 반반으로 갈라야 생존', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C5: 분할 지도 구조 - 3x3 합의 ── */
    function demoC5() {
      clear();
      // 3x3 grid
      var gs = 28,
        sx = W / 2 - gs * 1.5,
        sy = H * 0.2;
      var safe = Math.floor(frame / 90) % 9;
      for (var r = 0; r < 3; r++)
        for (var c = 0; c < 3; c++) {
          var idx = r * 3 + c;
          var hi = idx === safe;
          rect(
            sx + c * gs,
            sy + r * gs,
            gs - 2,
            gs - 2,
            hi ? 'rgba(82,209,140,0.4)' : 'rgba(255,255,255,0.04)'
          );
          txt(
            '' + (idx + 1),
            sx + c * gs + gs / 2 - 1,
            sy + r * gs + gs / 2 + 4,
            10,
            hi ? '#fff' : '#444'
          );
        }
      // clue cards
      txt('단서: "2행에 있다"', W * 0.5, H * 0.6, 11, 'rgba(80,200,255,0.5)');
      txt(
        '단서: "모서리가 아니다"',
        W * 0.5,
        H * 0.7,
        11,
        'rgba(80,200,255,0.4)'
      );
      // vote arrows
      for (var i = 0; i < 3; i++) {
        var vx = W * 0.2 + i * W * 0.3,
          vy = H * 0.82;
        txt('→' + (safe + 1), vx, vy, 11, 'rgba(255,209,102,0.4)');
      }
      scanlines();
      vig();
      txt('전원이 같은 출구를 선택하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C6: 의리 기부 - 팀 토큰 ── */
    function demoC6() {
      clear();
      // two teams
      rect(20, H * 0.15, W * 0.4, 30, 'rgba(80,150,255,0.1)');
      rect(W * 0.55, H * 0.15, W * 0.4, 30, 'rgba(255,100,80,0.1)');
      txt('팀 A', W * 0.25, H * 0.15 + 20, 12, '#61dafb');
      txt('팀 B', W * 0.75, H * 0.15 + 20, 12, '#ff6b81');
      // token sliders
      for (var i = 0; i < 3; i++) {
        var ty = H * 0.35 + i * 25;
        var val = 10 + Math.sin(frame * 0.03 + i * 2) * 8;
        rect(30, ty, val * 4, 12, 'rgba(255,209,102,0.3)');
        txt(Math.floor(val) + 'T', 30 + val * 4 + 15, ty + 10, 10, '#ffd166');
      }
      // score
      var sA = 30 + (Math.floor(frame / 3) % 20),
        sB = 28 + (Math.floor(frame / 4) % 20);
      txt(
        'A: ' + sA + ' vs B: ' + sB,
        W / 2,
        H * 0.82,
        13,
        sA > sB ? '#61dafb' : '#ff6b81'
      );
      scanlines();
      vig();
      txt('기부 많아도 적어도 위험하다', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C7: 침묵 조립 - 심볼 정렬 ── */
    function demoC7() {
      clear();
      var syms = ['△', '□', '○', '☆', '◆'];
      // scattered then sorting
      var sorted = frame % 200 > 100;
      syms.forEach(function (s, i) {
        var tx = 40 + i * 55,
          ty = H * 0.5;
        var x = sorted ? tx : 40 + ((i * 3 + 2) % 5) * 55;
        var y = sorted ? ty : H * 0.3 + Math.sin(i * 2) * 30;
        rect(
          x - 15,
          y - 15,
          30,
          30,
          sorted ? 'rgba(82,209,140,0.15)' : 'rgba(255,255,255,0.05)'
        );
        txt(s, x, y + 5, 18, sorted ? '#52d18c' : '#aaa');
      });
      // rule card
      rect(W * 0.2, H * 0.75, W * 0.6, 22, 'rgba(255,209,102,0.06)');
      txt(
        '규칙: "□는 첫 번째다"',
        W / 2,
        H * 0.75 + 15,
        10,
        'rgba(255,209,102,0.5)'
      );
      // chat blocked indicator
      if (sorted)
        txt('🔇 채팅 차단', W * 0.8, H * 0.2, 10, 'rgba(255,60,60,0.5)');
      scanlines();
      vig();
      txt('침묵 속에서 순서를 맞춰라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C8: 하중 분담 - 슬라이더 분배 ── */
    function demoC8() {
      clear();
      // wave indicator
      var wave = (Math.floor(frame / 150) % 3) + 1;
      txt('WAVE ' + wave + '/3', W / 2, H * 0.12, 14, '#ff6b81');
      // requirement bar
      var req = 12 + wave * 2;
      rect(20, H * 0.22, W - 40, 8, 'rgba(255,255,255,0.05)');
      rect(20, H * 0.22, (W - 40) * (req / 20), 8, 'rgba(255,100,80,0.3)');
      txt('필요: ' + req, W / 2, H * 0.32, 11, '#ff6b81');
      // player loads
      var loads = [3, 4, 2, 5];
      loads.forEach(function (l, i) {
        var bx = 40 + i * 70,
          by = H * 0.45;
        rect(bx, by, 50, l * 12, 'rgba(80,200,255,0.2)');
        txt('P' + (i + 1) + ':' + l, bx + 25, by + l * 12 + 15, 10, '#aaa');
      });
      // weak indicator
      txt('⚠ P3 약점 웨이브!', W / 2, H * 0.82, 11, 'rgba(255,200,0,0.5)');
      scanlines();
      vig();
      txt('하중을 나눠 3웨이브를 버텨라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C9: 신뢰 사슬 - 에너지 분배 ── */
    function demoC9() {
      clear();
      var ps = [
        { x: W * 0.2, y: H * 0.4 },
        { x: W * 0.5, y: H * 0.25 },
        { x: W * 0.8, y: H * 0.4 },
        { x: W * 0.5, y: H * 0.6 },
      ];
      // energy bars
      ps.forEach(function (p, i) {
        var e = 2 + Math.sin(frame * 0.03 + i * 1.5) * 2;
        circ(p.x, p.y, 18, 'rgba(80,255,180,0.1)');
        txt(
          'E:' + e.toFixed(1),
          p.x,
          p.y + 5,
          10,
          e < 1 ? '#ff4060' : '#52d18c'
        );
        // energy bar below
        rect(
          p.x - 15,
          p.y + 22,
          30 * (e / 5),
          4,
          e < 1 ? 'rgba(255,60,60,0.6)' : 'rgba(80,255,180,0.4)'
        );
      });
      // flow arrows
      var t = (frame % 60) / 60;
      for (var i = 0; i < ps.length; i++) {
        var j = (i + 1) % ps.length;
        var ax = ps[i].x + (ps[j].x - ps[i].x) * t;
        var ay = ps[i].y + (ps[j].y - ps[i].y) * t;
        circ(ax, ay, 3, 'rgba(255,209,102,0.5)');
      }
      txt('임계치: 1.0', W / 2, H * 0.82, 11, 'rgba(255,100,100,0.5)');
      scanlines();
      vig();
      txt('에너지를 나눠 전원 생존시켜라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── C10: 무전 없는 대피 - 체크포인트 ── */
    function demoC10() {
      clear();
      var cp = (Math.floor(frame / 100) % 3) + 1;
      // checkpoint path
      for (var i = 1; i <= 3; i++) {
        var cx = W * 0.15 + i * W * 0.2,
          cy = H * 0.35;
        circ(
          cx,
          cy,
          18,
          i <= cp ? 'rgba(82,209,140,0.3)' : 'rgba(255,255,255,0.05)'
        );
        txt('CP' + i, cx, cy + 5, 10, i <= cp ? '#52d18c' : '#555');
        if (i < 3)
          line(cx + 18, cy, cx + W * 0.2 - 18, cy, 'rgba(255,255,255,0.1)');
      }
      // route choices
      ['A', 'B', 'C'].forEach(function (r, i) {
        var rx = W * 0.25 + i * W * 0.2,
          ry = H * 0.6;
        rect(
          rx - 15,
          ry,
          30,
          22,
          r === 'B' ? 'rgba(82,209,140,0.2)' : 'rgba(255,255,255,0.05)'
        );
        txt(r, rx, ry + 15, 12, r === 'B' ? '#52d18c' : '#555');
      });
      // comms indicator
      var comms = frame % 100 < 30;
      txt(
        comms ? '📡 교신 가능' : '🔇 교신 불가',
        W / 2,
        H * 0.82,
        11,
        comms ? '#52d18c' : 'rgba(255,60,60,0.5)'
      );
      scanlines();
      vig();
      txt('제한된 교신으로 정답 루트를 찾아라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D1: 컬러 코드 락 - 마스터마인드 ── */
    function demoD1() {
      clear();
      var colors = [
        '#ff4060',
        '#52d18c',
        '#61dafb',
        '#ffd166',
        '#c084fc',
        '#ff8c42',
      ];
      // secret code (hidden)
      for (var i = 0; i < 4; i++) {
        circ(W * 0.3 + i * 30, H * 0.15, 10, 'rgba(255,255,255,0.1)');
        txt('?', W * 0.3 + i * 30, H * 0.15 + 4, 12, '#555');
      }
      // attempt rows
      var attempt = Math.floor(frame / 80) % 5;
      for (var r = 0; r < Math.min(attempt + 1, 5); r++) {
        for (var c = 0; c < 4; c++) {
          circ(W * 0.25 + c * 30, H * 0.3 + r * 28, 8, colors[(r + c) % 6]);
        }
        // hints
        var exact = r % 3,
          color = r % 2;
        txt(
          '●' + exact + ' ○' + color,
          W * 0.7,
          H * 0.3 + r * 28 + 4,
          10,
          '#aaa'
        );
      }
      // remaining attempts
      txt('남은 시도: ' + (5 - attempt), W / 2, H * 0.85, 12, '#ffd166');
      scanlines();
      vig();
      txt('5번 안에 4자리 코드를 깨라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D2: 순서 법정 - 드래그 정렬 ── */
    function demoD2() {
      clear();
      var items = ['비', '안개', '햇빛', '천둥'];
      var sorted = frame % 160 > 80;
      var order = sorted ? [0, 1, 2, 3] : [2, 0, 3, 1];
      order.forEach(function (idx, i) {
        var x = W * 0.15 + i * W * 0.2,
          y = H * 0.4;
        rect(
          x - 20,
          y - 12,
          50,
          24,
          sorted ? 'rgba(82,209,140,0.15)' : 'rgba(255,209,102,0.08)'
        );
        txt(items[idx], x + 5, y + 5, 12, sorted ? '#52d18c' : '#ffd166');
        if (i < 3) txt('→', x + 35, y + 4, 12, '#444');
      });
      // clues
      txt(
        '단서: "천둥은 마지막이다"',
        W / 2,
        H * 0.65,
        10,
        'rgba(80,200,255,0.4)'
      );
      txt(
        '단서: "비는 안개보다 앞선다"',
        W / 2,
        H * 0.75,
        10,
        'rgba(80,200,255,0.35)'
      );
      scanlines();
      vig();
      txt('단서로 정확한 순서를 도출하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D3: 빈도 경매 - 추정+베팅 ── */
    function demoD3() {
      clear();
      // sample cards
      var suits = ['♠', '♣', '♦', '♥'];
      var sample = [0, 1, 3, 0, 2, 1];
      sample.forEach(function (s, i) {
        var x = 30 + i * 45,
          y = H * 0.2;
        rect(x, y, 35, 45, 'rgba(255,255,255,0.05)');
        txt(suits[s], x + 17, y + 30, 18, s === 3 ? '#ff4060' : '#aaa');
      });
      // estimation
      txt('♥ 추정: ?', W / 2, H * 0.55, 14, '#ff6b81');
      // risk slider
      rect(W * 0.2, H * 0.7, W * 0.6, 6, 'rgba(255,255,255,0.05)');
      var risk = (frame % 150) / 150;
      circ(W * 0.2 + risk * W * 0.6, H * 0.7 + 3, 6, '#ffd166');
      txt(
        '위험도: ' + Math.ceil(risk * 5),
        W * 0.2 + risk * W * 0.6,
        H * 0.7 - 12,
        10,
        '#ffd166'
      );
      scanlines();
      vig();
      txt('추정과 베팅을 동시에 관리하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D4: 미러 미로 - 격자 경로 ── */
    function demoD4() {
      clear();
      var gs = 22,
        sx = W / 2 - gs * 2,
        sy = H * 0.15;
      var walls = [
        [1, 0],
        [1, 1],
        [2, 2],
      ];
      for (var r = 0; r < 4; r++)
        for (var c = 0; c < 4; c++) {
          var isWall = walls.some(function (w) {
            return w[0] === r && w[1] === c;
          });
          rect(
            sx + c * gs,
            sy + r * gs,
            gs - 2,
            gs - 2,
            isWall ? 'rgba(255,60,60,0.3)' : 'rgba(255,255,255,0.04)'
          );
          if (isWall)
            txt(
              '█',
              sx + c * gs + gs / 2 - 1,
              sy + r * gs + gs / 2 + 4,
              10,
              'rgba(255,60,60,0.4)'
            );
        }
      // path animation
      var path = [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 2],
        [2, 2],
        [2, 3],
        [3, 3],
      ];
      var step = Math.floor(frame / 20) % path.length;
      for (var i = 0; i <= step; i++) {
        circ(
          sx + path[i][1] * gs + gs / 2 - 1,
          sy + path[i][0] * gs + gs / 2 - 1,
          4,
          i === step ? '#75f5ff' : 'rgba(117,245,255,0.3)'
        );
      }
      // start/end
      txt('S', sx + 3, sy + gs / 2 + 2, 9, '#52d18c');
      txt('E', sx + 3 * gs + gs / 2, sy + 3 * gs + gs / 2 + 2, 9, '#ff6b81');
      scanlines();
      vig();
      txt('미로의 정확한 경로를 찾아라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D5: 진술 장부 - 논리 ── */
    function demoD5() {
      clear();
      var stmts = [
        'A: "B는 거짓말쟁이"',
        'B: "C와 D는 같은 편"',
        'C: "A는 진실"',
        'D: "B는 거짓"',
      ];
      stmts.forEach(function (s, i) {
        var y = H * 0.15 + i * 28;
        var liar = i === 1 || i === 2; // B,C are liars
        rect(
          30,
          y,
          W - 60,
          22,
          liar && frame % 80 > 40
            ? 'rgba(255,60,60,0.1)'
            : 'rgba(255,255,255,0.03)'
        );
        txt(s, W / 2, y + 15, 11, liar && frame % 80 > 40 ? '#ff6b81' : '#aaa');
      });
      // checkbox area
      var liars = [false, true, true, false];
      ['A', 'B', 'C', 'D'].forEach(function (l, i) {
        var x = W * 0.2 + i * 50,
          y = H * 0.75;
        rect(
          x - 8,
          y - 8,
          16,
          16,
          liars[i] && frame % 80 > 40
            ? 'rgba(255,60,60,0.3)'
            : 'rgba(255,255,255,0.05)'
        );
        txt(l, x, y + 4, 11, liars[i] && frame % 80 > 40 ? '#ff6b81' : '#555');
      });
      scanlines();
      vig();
      txt('모순을 찾아 거짓말쟁이를 특정하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D6: 가중 평균 시장 ── */
    function demoD6() {
      clear();
      // market average visualization
      var target = 6;
      var avg = 5 + Math.sin(frame * 0.03) * 2;
      // target zone
      rect(W * 0.1, H * 0.3, W * 0.8, 30, 'rgba(82,209,140,0.06)');
      txt('비밀 수요 구간', W / 2, H * 0.3 + 20, 10, 'rgba(82,209,140,0.4)');
      // player submissions as dots on number line
      for (var i = 1; i <= 9; i++) {
        var x = W * 0.1 + (i - 1) * ((W * 0.8) / 8);
        line(x, H * 0.5, x, H * 0.5 + 8, 'rgba(255,255,255,0.1)');
        txt('' + i, x, H * 0.5 + 20, 9, '#444');
      }
      // avg marker
      var avgX = W * 0.1 + (avg - 1) * ((W * 0.8) / 8);
      ctx.fillStyle = 'rgba(255,209,102,0.5)';
      ctx.beginPath();
      ctx.moveTo(avgX, H * 0.47);
      ctx.lineTo(avgX - 6, H * 0.42);
      ctx.lineTo(avgX + 6, H * 0.42);
      ctx.fill();
      txt('평균: ' + avg.toFixed(1), avgX, H * 0.38, 11, '#ffd166');
      // weight indicators
      txt(
        '숫자×가중치 = 시장 형성',
        W / 2,
        H * 0.75,
        11,
        'rgba(200,200,255,0.4)'
      );
      scanlines();
      vig();
      txt('숫자와 가중치를 동시에 계산하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D7: 두칸빙고 ── */
    function demoD7() {
      clear();
      var bs = 35,
        sx = W / 2 - bs,
        sy = H * 0.2;
      var nums = [3, 5, 6, 8];
      var filled = [true, false, true, false];
      for (var r = 0; r < 2; r++)
        for (var c = 0; c < 2; c++) {
          var idx = r * 2 + c;
          var fi = filled[idx] && frame % 120 > 60;
          rect(
            sx + c * bs,
            sy + r * bs,
            bs - 2,
            bs - 2,
            fi ? 'rgba(82,209,140,0.3)' : 'rgba(255,255,255,0.04)'
          );
          txt(
            '' + nums[idx],
            sx + c * bs + bs / 2 - 1,
            sy + r * bs + bs / 2 + 4,
            14,
            fi ? '#52d18c' : '#aaa'
          );
        }
      // turn info
      var turn = (Math.floor(frame / 80) % 5) + 1;
      txt('턴 ' + turn + '/5', W / 2, H * 0.6, 12, '#ffd166');
      // average indicator
      txt('평균 → 채움/삭제', W / 2, H * 0.72, 11, 'rgba(200,200,255,0.4)');
      scanlines();
      vig();
      txt('채우고 지우며 빙고를 완성하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D8: 업다운 폭탄 ── */
    function demoD8() {
      clear();
      var cx = W / 2,
        cy = H * 0.35;
      // bomb
      var pulse = Math.sin(frame * 0.12) * 0.3 + 0.7;
      ctx.fillStyle = 'rgba(255,50,50,' + pulse + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, 28 + Math.sin(frame * 0.08) * 4, 0, Math.PI * 2);
      ctx.fill();
      txt('💣', cx, cy + 7, 24);
      // countdown (hidden)
      var cd = 10 - (Math.floor(frame / 30) % 10);
      for (var i = 0; i < 10; i++) {
        circ(
          W * 0.15 + i * 25,
          H * 0.08,
          4,
          i < cd ? 'rgba(255,200,0,0.5)' : 'rgba(255,60,60,0.2)'
        );
      }
      // range narrowing
      var lo = 1 + Math.floor(frame / 50) * 5,
        hi = 100 - Math.floor(frame / 40) * 8;
      txt(
        lo + ' ◀━━━ ? ━━━▶ ' + Math.max(hi, lo + 1),
        W / 2,
        H * 0.65,
        12,
        '#aaa'
      );
      // turn order
      var turn = Math.floor(frame / 25) % 4;
      for (var p = 0; p < 4; p++) {
        circ(
          W * 0.2 + p * W * 0.2,
          H * 0.8,
          10,
          p === turn ? 'rgba(255,209,102,0.5)' : 'rgba(255,255,255,0.05)'
        );
        txt(
          'P' + (p + 1),
          W * 0.2 + p * W * 0.2,
          H * 0.8 + 4,
          9,
          p === turn ? '#fff' : '#555'
        );
      }
      scanlines();
      vig();
      txt('UP/DOWN으로 폭탄 번호를 찾아라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D9: 동물 농장 - 선언/심판 ── */
    function demoD9() {
      clear();
      var animals = ['🐵', '🐀', '🐈', '🦁', '🦧'];
      // animal placement area
      animals.forEach(function (a, i) {
        var x = 30 + i * 55,
          y = H * 0.2;
        rect(x, y, 45, 35, 'rgba(255,255,255,0.04)');
        txt(a, x + 22, y + 24, 18);
        txt('' + (i + 1) + 'pt', x + 22, y + 34, 8, 'rgba(255,200,100,0.4)');
      });
      // claim bubble
      var claim = frame % 120 > 60;
      rect(
        W * 0.2,
        H * 0.55,
        W * 0.6,
        30,
        claim ? 'rgba(255,209,102,0.1)' : 'rgba(255,255,255,0.03)'
      );
      txt(
        claim ? '"사자 6마리 이상!"' : '심판? 또는 상향?',
        W / 2,
        H * 0.55 + 20,
        12,
        claim ? '#ffd166' : '#555'
      );
      // teams
      txt('팀A vs 팀B', W / 2, H * 0.82, 11, 'rgba(200,200,255,0.4)');
      scanlines();
      vig();
      txt('선언과 심판으로 점수를 쟁취하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── D10: 블랙아웃 회로 - 스위치 ── */
    function demoD10() {
      clear();
      // circuit diagram
      var sws = ['A', 'B', 'C', 'D'];
      sws.forEach(function (s, i) {
        var x = 40 + i * 70,
          y = H * 0.25;
        var on = (frame + i * 30) % 80 > 40;
        rect(x, y, 50, 24, on ? 'rgba(82,209,140,0.2)' : 'rgba(255,60,60,0.1)');
        txt(
          s + ':' + (on ? 'ON' : 'OFF'),
          x + 25,
          y + 16,
          10,
          on ? '#52d18c' : '#ff6b81'
        );
      });
      // logic gate
      rect(W * 0.3, H * 0.5, W * 0.4, 25, 'rgba(80,200,255,0.08)');
      txt('(A XOR B) AND C', W / 2, H * 0.5 + 16, 11, '#61dafb');
      // output
      var out = frame % 80 > 40;
      circ(
        W / 2,
        H * 0.72,
        12,
        out ? 'rgba(82,209,140,0.5)' : 'rgba(255,60,60,0.3)'
      );
      txt(
        out ? '1' : '0',
        W / 2,
        H * 0.72 + 4,
        14,
        out ? '#52d18c' : '#ff6b81'
      );
      scanlines();
      vig();
      txt('회로를 분석해 스위치를 맞춰라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H1: 자기소개서 게임 - 투표 ── */
    function demoH1() {
      clear();
      // anonymous intro cards
      for (var i = 0; i < 4; i++) {
        var y = H * 0.12 + i * 30;
        var targeted = i === 2 && frame % 100 > 50;
        rect(
          30,
          y,
          W - 60,
          24,
          targeted ? 'rgba(255,60,60,0.15)' : 'rgba(255,255,255,0.03)'
        );
        txt(
          '익명 ' + (i + 1) + ': "저는 ██████한 사람입니다..."',
          W / 2,
          y + 16,
          10,
          targeted ? '#ff6b81' : '#777'
        );
        if (targeted) {
          for (var a = 0; a < 3; a++) {
            txt('👆', W - 50 + a * 8, y + 10, 10, 'rgba(255,100,100,0.5)');
          }
        }
      }
      // vote result
      txt('최다 득표 = 사망', W / 2, H * 0.82, 12, 'rgba(255,60,60,0.5)');
      scanlines();
      vig();
      txt('눈에 띄면 죽는다', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H2: 사보타지 가위바위보 ── */
    function demoH2() {
      clear();
      var rps = ['✊', '✋', '✌'];
      var phase = Math.floor(frame / 80) % 2;
      // 4 players in circle
      for (var i = 0; i < 4; i++) {
        var a = (Math.PI * 2 * i) / 4 - Math.PI / 2;
        var px = W / 2 + Math.cos(a) * 55,
          py = H * 0.4 + Math.sin(a) * 40;
        circ(
          px,
          py,
          16,
          i === 0 ? 'rgba(255,60,60,0.2)' : 'rgba(255,255,255,0.06)'
        );
        txt('P' + (i + 1), px, py + 4, 10, i === 0 ? '#ff6b81' : '#aaa');
        if (phase === 1)
          txt(rps[(i + Math.floor(frame / 20)) % 3], px, py - 18, 16);
      }
      // sabotage indicator
      if (phase === 0) {
        txt('🎭 사보타지는 누구?', W / 2, H * 0.82, 12, 'rgba(255,200,0,0.5)');
      } else {
        txt('결과 공개!', W / 2, H * 0.82, 12, '#ff6b81');
      }
      scanlines();
      vig();
      txt('사보타지를 찾거나 이용하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H3: 독 선물 - 상자 교환 ── */
    function demoH3() {
      clear();
      var items = ['☠', '💊', '📦'];
      var colors = ['#ff4060', '#52d18c', '#888'];
      // players in ring
      var n = 5;
      for (var i = 0; i < n; i++) {
        var a = (Math.PI * 2 * i) / n - Math.PI / 2;
        var px = W / 2 + Math.cos(a) * 60,
          py = H * 0.4 + Math.sin(a) * 40;
        circ(px, py, 14, 'rgba(255,255,255,0.06)');
        txt('P' + (i + 1), px, py + 4, 9, '#aaa');
      }
      // gift animation
      var t = (frame % 70) / 70;
      var fi = Math.floor(frame / 70) % n,
        ti = (fi + 2) % n;
      var a1 = (Math.PI * 2 * fi) / n - Math.PI / 2,
        a2 = (Math.PI * 2 * ti) / n - Math.PI / 2;
      var gx =
        W / 2 + Math.cos(a1) * 60 + (Math.cos(a2) - Math.cos(a1)) * 60 * t;
      var gy =
        H * 0.4 + Math.sin(a1) * 40 + (Math.sin(a2) - Math.sin(a1)) * 40 * t;
      var item = Math.floor(frame / 70) % 3;
      txt(items[item], gx, gy + 4, 16);
      // night counter
      var night = (Math.floor(frame / 210) % 3) + 1;
      txt('밤 ' + night + '/3', W / 2, H * 0.82, 12, 'rgba(255,60,60,0.5)');
      drip(W * 0.1, 0.8);
      drip(W * 0.9, 0.6, 'rgba(0,150,0,0.3)');
      scanlines();
      vig();
      txt('독인지 해독제인지 모른다', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H4: 최후의 투표 - 과반 숙청 ── */
    function demoH4() {
      clear();
      var n = 6;
      for (var i = 0; i < n; i++) {
        var x = W * 0.1 + i * ((W * 0.8) / (n - 1)),
          y = H * 0.35;
        var votes = i === 3 ? 3 : i === 1 ? 2 : 1;
        var dead = i === 3 && frame % 100 > 50;
        circ(x, y, 16, dead ? 'rgba(255,40,40,0.5)' : 'rgba(255,255,255,0.06)');
        txt('P' + (i + 1), x, y + 4, 9, dead ? '#ff4060' : '#aaa');
        // vote count bar
        rect(
          x - 8,
          y + 22,
          16,
          votes * 8,
          'rgba(255,107,129,' + votes * 0.15 + ')'
        );
        txt('' + votes, x, y + 22 + votes * 8 + 12, 9, '#ff6b81');
      }
      // majority line
      line(0, H * 0.7, W, H * 0.7, 'rgba(255,60,60,0.15)');
      txt(
        '과반=' + Math.ceil(n / 2 + 0.1) + '표',
        W / 2,
        H * 0.7 - 8,
        10,
        'rgba(255,60,60,0.4)'
      );
      scanlines();
      vig();
      txt('과반이 모이면 숙청당한다', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H5: 신뢰 낙하 - 페어 선택 ── */
    function demoH5() {
      clear();
      // pair matchup
      var acts = ['catch', 'guard', 'cut'];
      var labels = ['받기', '방어', '끊기'];
      var emojis = ['🤝', '🛡', '✂'];
      // two players
      circ(W * 0.3, H * 0.35, 22, 'rgba(80,200,255,0.1)');
      txt('A', W * 0.3, H * 0.35 + 5, 14, '#61dafb');
      circ(W * 0.7, H * 0.35, 22, 'rgba(255,150,100,0.1)');
      txt('B', W * 0.7, H * 0.35 + 5, 14, '#ff8c42');
      // choices
      var phase = Math.floor(frame / 100) % 3;
      txt(emojis[phase], W * 0.3, H * 0.55, 20);
      txt(emojis[(phase + 1) % 3], W * 0.7, H * 0.55, 20);
      // result
      var results = ['상호 신뢰 +1', '무효', 'A 사망!'];
      txt(
        results[phase],
        W / 2,
        H * 0.75,
        12,
        phase === 2 ? '#ff4060' : phase === 0 ? '#52d18c' : '#888'
      );
      // trust score
      txt('신뢰 점수 ≥ 2 필요', W / 2, H * 0.82, 10, 'rgba(255,200,0,0.4)');
      scanlines();
      vig();
      txt('믿을 것인가, 끊을 것인가', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H6: 악마의 분배 - share/steal/burn ── */
    function demoH6() {
      clear();
      // central pot
      var potSize = 12 - (Math.floor(frame / 40) % 6);
      circ(W / 2, H * 0.3, 25 + potSize, 'rgba(255,209,102,0.1)');
      txt('🏦 ' + potSize * 2 + 'T', W / 2, H * 0.3 + 6, 14, '#ffd166');
      // action cards
      var acts = [
        { l: '공유', c: '#52d18c' },
        { l: '훔치기', c: '#ff6b81' },
        { l: '태우기', c: '#ff8c42' },
      ];
      acts.forEach(function (a, i) {
        var x = W * 0.2 + i * W * 0.3,
          y = H * 0.6;
        rect(x - 25, y - 12, 50, 24, 'rgba(255,255,255,0.04)');
        txt(a.l, x, y + 4, 11, a.c);
      });
      // player tokens
      for (var i = 0; i < 4; i++) {
        txt(
          'P' + (i + 1) + ': ' + (3 + i * 2) + 'T',
          W * 0.15 + i * W * 0.22,
          H * 0.82,
          10,
          '#aaa'
        );
      }
      scanlines();
      vig();
      txt('하위 1/3이 죽는다', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H7: 가면 딜러 - 입찰+역할 ── */
    function demoH7() {
      clear();
      var masks = [
        { n: '🐺 Wolf', c: '#ff4060' },
        { n: '🦊 Fox', c: '#ff8c42' },
        { n: '🐑 Sheep', c: '#aaa' },
      ];
      masks.forEach(function (m, i) {
        var x = W * 0.2 + i * W * 0.3,
          y = H * 0.2;
        rect(
          x - 30,
          y - 15,
          60,
          40,
          i === 0
            ? 'rgba(255,60,60,0.1)'
            : i === 1
            ? 'rgba(255,140,66,0.08)'
            : 'rgba(255,255,255,0.03)'
        );
        txt(m.n, x, y + 6, 12, m.c);
        // bid coins
        var coins = 5 - i * 2;
        txt('🪙' + coins, x, y + 25, 10, '#ffd166');
      });
      // vote phase
      if (frame % 160 > 80) {
        txt(
          '🗳 의심 투표 진행 중...',
          W / 2,
          H * 0.65,
          12,
          'rgba(255,200,0,0.5)'
        );
        for (var i = 0; i < 5; i++) {
          circ(40 + i * 65, H * 0.78, 10, 'rgba(255,255,255,0.05)');
          txt('?', 40 + i * 65, H * 0.78 + 4, 10, '#555');
        }
      }
      scanlines();
      vig();
      txt('가면 뒤의 정체를 추리하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H8: 고백 거래소 - trust/doubt ── */
    function demoH8() {
      clear();
      // statement cards
      for (var i = 0; i < 3; i++) {
        var y = H * 0.12 + i * 35;
        var truth = i !== 1;
        rect(30, y, W - 60, 28, 'rgba(255,255,255,0.03)');
        txt(
          'P' + (i + 1) + ': "숨겨진 색은 ██이다"',
          W / 2,
          y + 18,
          10,
          '#aaa'
        );
        // truth/false marker (hidden)
        if (frame % 120 > 60) {
          circ(
            W - 35,
            y + 14,
            6,
            truth ? 'rgba(82,209,140,0.5)' : 'rgba(255,60,60,0.5)'
          );
        }
      }
      // bet buttons
      rect(W * 0.25, H * 0.65, 60, 22, 'rgba(82,209,140,0.15)');
      txt('Trust', W * 0.25 + 30, H * 0.65 + 15, 11, '#52d18c');
      rect(W * 0.55, H * 0.65, 60, 22, 'rgba(255,60,60,0.15)');
      txt('Doubt', W * 0.55 + 30, H * 0.65 + 15, 11, '#ff6b81');
      // reputation
      txt('평판 하위 = 사망', W / 2, H * 0.82, 11, 'rgba(255,60,60,0.4)');
      scanlines();
      vig();
      txt('믿음을 가격으로 바꿔라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H9: 유다의 릴레이 - 칼 전달 ── */
    function demoH9() {
      clear();
      var n = 6;
      for (var i = 0; i < n; i++) {
        var a = (Math.PI * 2 * i) / n - Math.PI / 2;
        var px = W / 2 + Math.cos(a) * 60,
          py = H * 0.4 + Math.sin(a) * 40;
        circ(px, py, 14, 'rgba(255,255,255,0.06)');
        txt('P' + (i + 1), px, py + 4, 9, '#aaa');
      }
      // knife position (hidden)
      var holder = Math.floor(frame / 50) % n;
      var ha = (Math.PI * 2 * holder) / n - Math.PI / 2;
      var kx = W / 2 + Math.cos(ha) * 60,
        ky = H * 0.4 + Math.sin(ha) * 40;
      if (frame % 80 > 40) txt('🔪', kx + 18, ky - 10, 14);
      // checkpoint warning
      var cp = Math.floor(frame / 100) % 5;
      if (cp === 2 || cp === 4) {
        txt('⚠ 체크포인트!', W / 2, H * 0.82, 13, '#ff4060');
        rect(0, 0, W, H, 'rgba(255,30,30,0.05)');
      } else {
        txt(
          '← hold → left/right',
          W / 2,
          H * 0.82,
          11,
          'rgba(200,200,255,0.3)'
        );
      }
      drip(W * 0.15, 1.2);
      drip(W * 0.85, 0.9);
      scanlines();
      vig();
      txt('칼이 어디 있는지 추적하라', W / 2, H * 0.92, 11, '#666');
    }

    /* ── H10: 핏빛 계약 - 계약/배신 ── */
    function demoH10() {
      clear();
      // players connected by contract lines
      var ps = [
        { x: W * 0.2, y: H * 0.3 },
        { x: W * 0.5, y: H * 0.2 },
        { x: W * 0.8, y: H * 0.3 },
        { x: W * 0.65, y: H * 0.55 },
        { x: W * 0.35, y: H * 0.55 },
      ];
      ps.forEach(function (p, i) {
        circ(p.x, p.y, 14, 'rgba(255,255,255,0.06)');
        txt('P' + (i + 1), p.x, p.y + 4, 9, '#aaa');
      });
      // contract/betray lines
      var phase = Math.floor(frame / 60) % 3;
      if (phase >= 0) {
        ctx.setLineDash([]);
        line(ps[0].x, ps[0].y, ps[1].x, ps[1].y, 'rgba(82,209,140,0.3)', 2);
        txt(
          '📜',
          ps[0].x + (ps[1].x - ps[0].x) * 0.5,
          ps[0].y + (ps[1].y - ps[0].y) * 0.5 - 8,
          10
        );
      }
      if (phase >= 1) {
        ctx.setLineDash([4, 4]);
        line(ps[2].x, ps[2].y, ps[3].x, ps[3].y, 'rgba(255,60,60,0.4)', 2);
        txt(
          '🗡',
          ps[2].x + (ps[3].x - ps[2].x) * 0.5 - 8,
          ps[2].y + (ps[3].y - ps[2].y) * 0.5,
          10
        );
        ctx.setLineDash([]);
      }
      // points
      txt('상호계약: +2/+2', W * 0.3, H * 0.75, 10, '#52d18c');
      txt('일방배신: +3/-2', W * 0.7, H * 0.75, 10, '#ff6b81');
      // blood drips
      drip(W * 0.05, 1.5);
      drip(W * 0.95, 1);
      drip(W * 0.5, 0.7, 'rgba(120,0,0,0.3)');
      scanlines();
      vig();
      txt('계약은 배신의 미끼일 수 있다', W / 2, H * 0.92, 11, '#666');
    }

    function pickDemo() {
      // Per card code first for unique animations
      var codeMap = {
        S1: demoS1,
        S2: demoS2,
        S3: demoS3,
        S4: demoS4,
        S5: demoS5,
        S6: demoS6,
        S7: demoS7,
        S8: demoS8,
        S9: demoS9,
        S10: demoS10,
        C1: demoC1,
        C2: demoC2,
        C3: demoC3,
        C4: demoC4,
        C5: demoC5,
        C6: demoC6,
        C7: demoC7,
        C8: demoC8,
        C9: demoC9,
        C10: demoC10,
        D1: demoD1,
        D2: demoD2,
        D3: demoD3,
        D4: demoD4,
        D5: demoD5,
        D6: demoD6,
        D7: demoD7,
        D8: demoD8,
        D9: demoD9,
        D10: demoD10,
        H1: demoH1,
        H2: demoH2,
        H3: demoH3,
        H4: demoH4,
        H5: demoH5,
        H6: demoH6,
        H7: demoH7,
        H8: demoH8,
        H9: demoH9,
        H10: demoH10,
      };
      if (cardCode && codeMap[cardCode]) return codeMap[cardCode];
      return demoD1; // fallback
    }

    var drawFn = pickDemo();
    function loop() {
      if (!running) return;
      frame++;
      drawFn();
      requestAnimationFrame(loop);
    }
    loop();
    return function stop() {
      running = false;
    };
  }

  function showBriefing(room, onStart) {
    var game = room.card || gameByCode(room.cardCode);
    var profile = presentationProfile(game.code);
    var overlay = document.createElement('div');
    overlay.className =
      'briefing-overlay' +
      (profile.briefingClass ? ' brief-' + profile.briefingClass : '');
    if (profile.accent) overlay.style.setProperty('--brief-accent', profile.accent);

    var suitColor = 'var(--' + game.suit + ')';
    var dangerLevel =
      game.difficulty <= 3
        ? '주의'
        : game.difficulty <= 6
        ? '경고'
        : game.difficulty <= 8
        ? '위험'
        : '최고위험';
    var dangerClass =
      game.difficulty <= 3 ? 'ok' : game.difficulty <= 6 ? '' : 'bad';

    var detailedInfo = DETAILED_RULES[game.code] || {};
    var rulesHtml = '';
    if (detailedInfo.rules && detailedInfo.rules.length) {
      rulesHtml =
        '<div class="brief-detailed"><div class="brief-detailed-title">\uD83D\uDCD6 \uC0C1\uC138 \uADDC\uCE59</div><ul class="brief-rule-list">' +
        detailedInfo.rules
          .map(function (r) {
            return '<li>' + esc(r) + '</li>';
          })
          .join('') +
        '</ul></div>';
    }
    var exampleHtml = '';
    if (detailedInfo.example) {
      exampleHtml =
        '<div class="brief-example"><div class="brief-example-title">\uD83D\uDCA1 \uC608\uC2DC</div><div class="brief-example-text">' +
        esc(detailedInfo.example) +
        '</div></div>';
    }

    var difficultyDots = '';
    for (var di = 0; di < 10; di++) {
      difficultyDots +=
        '<span class="diff-dot' +
        (di < game.difficulty ? ' active' : '') +
        '" style="' +
        (di < game.difficulty ? 'background:' + suitColor : '') +
        '"></span>';
    }

    overlay.innerHTML =
      '<div class="briefing-box">' +
      '<div class="brief-header">' +
      '<div class="brief-glitch" style="color:' +
      suitColor +
      '">' +
      SUIT_ICON[game.suit] +
      '</div>' +
      '<div class="brief-title" style="color:' +
      suitColor +
      '">' +
      esc(game.code) +
      ' - ' +
      esc(game.name) +
      '</div>' +
      '<div class="brief-subtitle">' +
      SUIT_LABEL[game.suit] +
      ' / ' +
      game.players.min +
      '~' +
      game.players.max +
      '\uBA85' +
      '</div>' +
      '<div class="brief-difficulty-bar">' +
      difficultyDots +
      '</div>' +
      '<div class="brief-danger-bar">' +
      '<span class="pill ' +
      dangerClass +
      '">\u26A0 ' +
      dangerLevel +
      '</span>' +
      '<span class="pill">\u23F1 ' +
      game.durationMin +
      '\uBD84</span>' +
      '<span class="pill">' +
      esc(game.chatPolicy) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="brief-body">' +
      '<div class="brief-demo-wrap"><canvas id="brief-demo-canvas" width="360" height="200"></canvas></div>' +
      '<div class="brief-rules">' +
      '<div class="brief-objective">\uD83C\uDFAF ' +
      esc(game.objective) +
      '</div>' +
      '<div class="brief-text">' +
      esc(game.briefing) +
      '</div>' +
      rulesHtml +
      exampleHtml +
      '<div class="brief-phases"><b>\u25B6 \uC9C4\uD589 \uBC29\uC2DD:</b><ol>' +
      game.phases
        .map(function (p) {
          return '<li>' + esc(p) + '</li>';
        })
        .join('') +
      '</ol></div>' +
      '</div>' +
      '</div>' +
      '<div class="brief-death-notice"><span class="death-skull">\u2620</span> \uD0C8\uB77D \uC2DC \uC0AC\uB9DD \uCC98\uB9AC\uB429\uB2C8\uB2E4. \uB300\uBE44\uD558\uC2ED\uC2DC\uC624.</div>' +
      '<div id="brief-cd" class="brief-countdown" style="display:none"></div>' +
      '<button id="brief-start-btn" class="brief-start-btn">\u2620 \uAC8C\uC784 \uC785\uC7A5</button></div>';

    document.body.appendChild(overlay);

    // Start demo animation on canvas
    var demoCanvas = document.getElementById('brief-demo-canvas');
    var stopDemo = null;
    if (demoCanvas) {
      stopDemo = createBriefingDemo(game.engine, demoCanvas, game.code);
    }

    bind('brief-start-btn', 'click', function () {
      var btn = document.getElementById('brief-start-btn');
      var stage = parseInt(btn.getAttribute('data-stage') || '0', 10);
      if (stage === 0) {
        overlay.classList.add('brief-stage-danger');
        btn.setAttribute('data-stage', '1');
        btn.textContent = '\u26A0 \uADDC\uCE59 \uD575\uC2EC \uD655\uC778';
        return;
      }
      if (stage === 1) {
        overlay.classList.add('brief-stage-rules');
        btn.setAttribute('data-stage', '2');
        btn.textContent = '\u25B6 \uC2DC\uC791 \uCE74\uC6B4\uD2B8';
        return;
      }
      btn.style.display = 'none';
      var cd = document.getElementById('brief-cd');
      cd.style.display = 'block';
      var count = 3;
      cd.textContent = count;
      var iv = setInterval(function () {
        count--;
        if (count <= 0) {
          clearInterval(iv);
          if (stopDemo) stopDemo();
          overlay.remove();
          onStart();
        } else cd.textContent = count;
      }, 1000);
    });
  }

  /* ════════════════════════════════════════════════════════
     GAME WORLD (full-screen)
     ════════════════════════════════════════════════════════ */
  function renderGameWorld(room) {
    var session = room.session;
    var game = room.card || gameByCode(room.cardCode);
    var isDark = true; // All death games use dark theme
    var canChat = !session || session.chatEnabled;
    var timerHtml = '';
    if (session && session.deadline) {
      var left = Math.max(0, (session.deadline - serverNowMs()) / 1000);
      timerHtml = left.toFixed(1) + 's';
    }

    var isAdmin = state.user && state.user.role === 'admin';
    var adminBtnHtml = '';
    if (isAdmin && session && !session.result) {
      adminBtnHtml =
        '<button class="admin-skip-btn" id="admin-skip-btn" title="라운드 스킵">⚡ SKIP</button>';
    }

    var playersHtml = room.players
      .map(function (p) {
        var dead =
          session && session.players
            ? !session.players.find(function (sp) {
                return sp.id === p.id && sp.alive;
              })
            : false;
        if (session && session.result)
          dead = !(session.result.winners || []).includes(p.id);
        var submitted =
          session && session.submissions ? !!session.submissions[p.id] : false;
        return (
          '<div class="gw-player-item' +
          (dead ? ' dead-row' : '') +
          '"><span class="gw-p-dot' +
          (dead ? ' dead' : '') +
          (submitted && !dead ? ' submitted' : '') +
          '"></span>' +
          esc(p.username) +
          (p.isBot ? ' <span class="bot-tag">BOT</span>' : '') +
          (submitted && !dead ? ' <span class="sub-check">✓</span>' : '') +
          '</div>'
        );
      })
      .join('');

    var chatHtml = room.chat
      .slice(-40)
      .map(function (m) {
        return (
          '<div class="gw-chat-line' +
          (m.system ? ' system' : '') +
          '"><b>' +
          esc(m.user) +
          '</b> ' +
          esc(m.text) +
          '</div>'
        );
      })
      .join('');

    root.innerHTML =
      '<div class="game-world' +
      (isDark ? ' dark-theme' : '') +
      '">' +
      '<div class="gw-topbar">' +
      '<span class="gw-title" style="color:var(--' +
      game.suit +
      ')">' +
      SUIT_ICON[game.suit] +
      ' ' +
      esc(game.code) +
      ' ' +
      esc(game.name) +
      '</span>' +
      '<span class="gw-timer" id="gw-timer" data-deadline="' +
      (session && session.deadline ? session.deadline : '') +
      '">' +
      timerHtml +
      '</span>' +
      adminBtnHtml +
      '<button class="gw-exit-small" id="gw-exit-btn">나가기</button>' +
      '</div>' +
      '<div class="gw-body">' +
      '<div class="gw-main" id="gw-main">' +
      renderGameMain(room, session, game) +
      '</div>' +
      '<div class="gw-sidebar">' +
      '<div class="gw-players"><h4>참가자 (' +
      room.players.length +
      ')</h4>' +
      playersHtml +
      '</div>' +
      '<div class="gw-chat-wrap">' +
      '<div class="gw-chat-log" id="gw-chat-log">' +
      chatHtml +
      '</div>' +
      '<form id="gw-chat-form" class="gw-chat-form"><input name="text" ' +
      (canChat ? '' : 'disabled') +
      ' placeholder="' +
      (canChat ? '메시지' : '채팅 불가') +
      '" /><button type="submit" ' +
      (canChat ? '' : 'disabled') +
      '>전송</button></form>' +
      '</div></div></div></div>';

    bind('gw-exit-btn', 'click', function () {
      callSocket('room:leave').then(function () {
        state.currentRoom = null;
        state.lastRoomVersion = 0;
        state.gameWorldActive = false;
        state.briefingShown = false;
        location.hash = '#lobby';
        render();
      });
    });
    bind('gw-chat-form', 'submit', function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      callSocket('room:chat', { text: f.get('text') }).then(function (r) {
        if (r.ok) e.target.reset();
        else notify(r.error, 'error');
      });
    });
    // Admin skip button
    bind('admin-skip-btn', 'click', function () {
      if (confirm('⚡ 이 라운드를 스킵하시겠습니까?')) {
        callSocket('game:admin-skip').then(function (r) {
          if (!r.ok) notify(r.error, 'error');
          else notify('라운드 스킵 완료', 'info');
        });
      }
    });
    bindGameActions(room, session, game);
    scrollChat();
  }

  /* ─────────── GAME MAIN DISPATCH ─────────── */
  function renderGameMain(room, session, game) {
    if (!session)
      return '<div class="gw-waiting"><div class="spinner"></div><div>\uAC8C\uC784 \uB300\uAE30 \uC911...</div></div>';
    if (session.result) return renderGameResult(session, room);
    var engine = session.engine || '';
    if (engine.startsWith('physical-'))
      return renderPhysicalGame(session, game);
    switch (engine) {
      case 'sync-press':
        return renderSyncPress(session);
      case 'card-pass-sum':
        return renderCardPass(session);
      case 'relay-inference':
        return renderRelayInference(session);
      case 'binary-balance':
        return renderBinaryBalance(session);
      case 'map-consensus':
        return renderMapConsensus(session);
      case 'team-contribution':
        return renderTeamContribution(session);
      case 'sequence-assembly':
        return renderSequenceAssembly(session);
      case 'load-sharing':
        return renderLoadSharing(session);
      case 'trust-chain':
        return renderTrustChain(session);
      case 'route-consensus':
        return renderRouteConsensus(session);
      case 'puzzle-codebreak':
        return renderCodebreak(session);
      case 'puzzle-order':
        return renderPuzzleOrder(session);
      case 'estimate-auction':
        return renderEstimateAuction(session);
      case 'grid-path':
        return renderGridPath(session);
      case 'puzzle-truth-ledger':
        return renderTruthLedger(session);
      case 'weighted-average':
        return renderWeightedAvg(session);
      case 'number-bingo':
        return renderNumberBingo(session);
      case 'countdown-guess':
        return renderBombGame(room, session);
      case 'liar-counting':
        return renderLiarCounting(session);
      case 'circuit-solve':
        return renderCircuitSolve(session);
      case 'text-vote':
        return renderTextVote(session);
      case 'hidden-role-rps':
        return renderHiddenRoleRps(session);
      case 'gift-poison':
        return renderGiftPoison(session);
      case 'anonymous-vote':
        return renderAnonymousVote(session);
      case 'pair-trust':
        return renderPairTrust(session);
      case 'pot-split':
        return renderPotSplit(session);
      case 'mask-dealer':
        return renderMaskDealer(session);
      case 'confession-market':
        return renderConfessionMarket(session);
      case 'knife-relay':
        return renderKnifeRelay(room, session);
      case 'blood-contract':
        return renderBloodContract(session);
      default:
        return renderGenericGame(session);
    }
  }

  /* ─────────── RESULT ─────────── */
  function renderGameResult(session, room) {
    var winners = session.result.winners || [];
    var isWinner = winners.includes(state.user.id);
    var losers = (session.players || []).filter(function (p) {
      return !winners.includes(p.id);
    });
    var resultIcon = isWinner ? '❤️' : '💀';
    var resultText = isWinner ? '생존 확정' : '사망 판정';
    var resultClass = isWinner ? 'result-win' : 'result-lose';
    return (
      '<div class="gw-result-box ' +
      resultClass +
      '-bg">' +
      '<div class="result-dramatic">' +
      '<div class="result-icon-big">' +
      resultIcon +
      '</div>' +
      '<h2 class="' +
      resultClass +
      ' result-title-anim">' +
      resultText +
      '</h2>' +
      '</div>' +
      '<div class="gw-result-summary">' +
      esc(session.result.summary) +
      '</div>' +
      '<div class="result-divider"></div>' +
      (winners.length
        ? '<div class="result-section"><div class="result-section-title">🟢 생존자 (' +
          winners.length +
          '명)</div>' +
          '<div class="gw-winners">' +
          winners
            .map(function (id) {
              return (
                '<span class="gw-winner-pill">' +
                esc(pName(session.players, id)) +
                '</span>'
              );
            })
            .join('') +
          '</div></div>'
        : '') +
      (losers.length
        ? '<div class="result-section"><div class="result-section-title">💀 탈락자 (' +
          losers.length +
          '명)</div>' +
          '<div class="gw-losers">' +
          losers
            .map(function (p) {
              return (
                '<span class="gw-loser-pill">' + esc(p.username) + '</span>'
              );
            })
            .join('') +
          '</div></div>'
        : '') +
      logHtml(session.log) +
      '<button class="gw-exit-btn" id="result-exit-btn">로비로 돌아가기</button></div>'
    );
  }

  /* ═══════════════════════════════════════════
     PHYSICAL GAMES (S1-S10)
     ═══════════════════════════════════════════ */
  function renderPhysicalGame(session, game) {
    var config =
      (session.form && session.form.challenge) ||
      (session.publicData && session.publicData.config) ||
      {};
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83C\uDFC3 \uD53C\uC9C0\uCEEC \uCC4C\uB9B0\uC9C0: ' +
      esc(config.challengeType || game.code) +
      '</h3>' +
      '<div class="muted">\uC81C\uD55C \uC2DC\uAC04: ' +
      (config.seconds || 75) +
      '\uCD08 | \uD1B5\uACFC \uC870\uAC74: ' +
      esc(config.passRule || '') +
      '</div>' +
      '</div>' +
      '<div class="gw-physical-host" id="physical-host" style="width:100%;max-width:800px;min-height:300px"></div>' +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     SYNC PRESS (C1)
     ═══════════════════════════════════════════ */
  function renderSyncPress(session) {
    var cueAt = session.form ? session.form.cueAt : 0;
    var cueFired = cueAt && Date.now() >= cueAt;
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\u23F1 \uB3D9\uC2DC \uBC84\uD2BC \uB204\uB974\uAE30</h3>' +
      '<p>\uBAA8\uB4E0 \uD50C\uB808\uC774\uC5B4\uAC00 \uC2E0\uD638 \uD6C4 <b>0.7\uCD08 \uC774\uB0B4</b>\uC5D0, \uC11C\uB85C <b>0.4\uCD08 \uC774\uB0B4 \uCC28\uC774</b>\uB85C \uBC84\uD2BC\uC744 \uB20C\uB7EC\uC57C \uD569\uB2C8\uB2E4.</p>' +
      '<div class="sync-cue-status">' +
      (cueFired
        ? '<span style="color:#e53935;font-weight:700;font-size:20px">\uD83D\uDD34 \uC9C0\uAE08 \uB20C\uB7EC!</span>'
        : '<span style="color:#1976d2;font-size:20px">\u23F3 \uC2E0\uD638 \uB300\uAE30\uC911...</span>') +
      '</div></div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<button class="sync-big-btn" id="sync-btn">' +
          (cueFired ? '\uC9C0\uAE08 \uB20C\uB7EC!' : '\uB300\uAE30\uC911...') +
          '</button>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     CARD PASS SUM (C2)
     ═══════════════════════════════════════════ */
  function renderCardPass(session) {
    var hand = (session.privateData && session.privateData.hand) || [];
    var round = (session.publicData && session.publicData.passRound) || 1;
    var cardHtml =
      '<div class="card-hand">' +
      hand
        .map(function (c, i) {
          return (
            '<div class="playing-card" data-val="' +
            c +
            '"><span class="card-value">' +
            c +
            '</span></div>'
          );
        })
        .join('') +
      '</div>';
    var sumVal = hand.reduce(function (a, b) {
      return a + b;
    }, 0);
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🃏 카드 패스</h3>' +
      '<p>매 라운드 카드 1장을 옆 사람에게 넘깁니다. 4장 빼고 남은 카드 합이 가장 높은 사람 탈락!</p>' +
      '<div class="gw-highlight">📍 <b>라운드 ' +
      round +
      '</b> | 현재 합계: <b style="font-size:18px">' +
      sumVal +
      '</b></div>' +
      cardHtml +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     RELAY INFERENCE (C3)
     ═══════════════════════════════════════════ */
  function renderRelayInference(session) {
    var clue = session.privateData ? session.privateData.clue : '';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83D\uDD17 \uB9B4\uB808\uC774 \uCD94\uB860</h3>' +
      '<p>\uAC01\uC790 \uB2E4\uB978 \uB2E8\uC11C\uB97C \uAC00\uC9C0\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uCC44\uD305\uC73C\uB85C \uC18C\uD1B5\uD558\uC5EC \uC815\uB2F5\uC744 \uB9DE\uCD94\uC138\uC694!</p>' +
      '<div class="gw-private-box"><b>\uD83D\uDD12 \uB0B4 \uB2E8\uC11C:</b> ' +
      esc(clue) +
      '</div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     BINARY BALANCE (C4)
     ═══════════════════════════════════════════ */
  function renderBinaryBalance(session) {
    var pd = session.publicData || {};
    var askerId = pd.askerId;
    var isAsker = askerId === state.user.id;
    var forced = session.privateData ? session.privateData.forcedAnswer : null;
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\u2696\uFE0F \uC774\uC9C4 \uBC38\uB7F0\uC2A4</h3>' +
      '<p>\uC9C8\uBB38\uC790\uAC00 \uC608/\uC544\uB2C8\uC624 \uC9C8\uBB38\uC744 \uD558\uACE0, \uC751\uB2F5\uC790\uB4E4\uC774 \uB2F5\uD569\uB2C8\uB2E4. \uADE0\uD615\uC774 \uB9DE\uC544\uC57C \uC0DD\uC874!</p>' +
      '<div><b>\uC9C8\uBB38\uC790:</b> ' +
      esc(pName(session.players, askerId)) +
      (isAsker ? ' (\uB098)' : '') +
      '</div>' +
      (pd.question
        ? '<div class="gw-highlight"><b>\uC9C8\uBB38:</b> ' +
          esc(pd.question) +
          '</div>'
        : '') +
      (forced
        ? '<div class="gw-warn-box">\u26A0\uFE0F \uB2F9\uC2E0\uC740 "<b>' +
          esc(forced) +
          '</b>"\uB77C\uACE0 \uB2F5\uD574\uC57C \uD569\uB2C8\uB2E4 (\uAC15\uC81C \uD3B8\uD5A5)</div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     MAP CONSENSUS (C5)
     ═══════════════════════════════════════════ */
  function renderMapConsensus(session) {
    var clues = session.privateData ? session.privateData.clues : [];
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83D\uDDFA\uFE0F \uC9C0\uB3C4 \uD569\uC758</h3>' +
      '<p>3x3 \uADF8\uB9AC\uB4DC\uC5D0\uC11C \uCD9C\uAD6C\uB97C \uCC3E\uC544\uC57C \uD569\uB2C8\uB2E4. \uAC01\uC790 \uB2E4\uB978 \uB2E8\uC11C\uB97C \uAC00\uC9C0\uACE0 \uC788\uC2B5\uB2C8\uB2E4.</p>' +
      '<div class="gw-private-box"><b>\uD83D\uDD12 \uB0B4 \uB2E8\uC11C:</b><ul>' +
      clues
        .map(function (c) {
          return '<li>' + esc(c) + '</li>';
        })
        .join('') +
      '</ul></div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     TEAM CONTRIBUTION (C6)
     ═══════════════════════════════════════════ */
  function renderTeamContribution(session) {
    var pd = session.publicData || {};
    var pv = session.privateData || {};
    var myTeam = pv.team || '?';
    var teamColor = myTeam === 'A' ? '#61dafb' : '#ffd166';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🤝 팀 기부</h3>' +
      '<p>두 팀으로 나뉘어 토큰을 기부합니다. 기부 합이 적은 팀은 전원 탈락!</p>' +
      '<div class="gw-private-box" style="border-color:' +
      teamColor +
      '">' +
      '<b>🏷️ 내 팀:</b> <span style="font-size:20px;font-weight:800;color:' +
      teamColor +
      '">' +
      esc(myTeam) +
      '</span>' +
      '<div style="margin-top:8px;display:flex;gap:16px;flex-wrap:wrap">' +
      '<span>💰 남은 토큰: <b>' +
      (pv.remainingTokens || 0) +
      '</b></span>' +
      '<span>📊 총 기부: <b>' +
      (pv.totalContributed || 0) +
      '</b></span>' +
      '</div></div>' +
      (pd.teamWins
        ? '<div class="gw-highlight">🏆 <b>팀 승수:</b> A팀 ' +
          pd.teamWins.A +
          '승 / B팀 ' +
          pd.teamWins.B +
          '승</div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     SEQUENCE ASSEMBLY (C7)
     ═══════════════════════════════════════════ */
  function renderSequenceAssembly(session) {
    var rules = session.privateData ? session.privateData.rules : [];
    var symbols = (session.publicData || {}).symbols || [];
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83E\uDDE9 \uC2DC\uD000\uC2A4 \uC870\uB9BD</h3>' +
      '<p>\uAE30\uD638\uB97C \uC62C\uBC14\uB978 \uC21C\uC11C\uB85C \uBC30\uC5F4\uD558\uC138\uC694. \uAC01\uC790 \uB2E4\uB978 \uADDC\uCE59\uC744 \uC54C\uACE0 \uC788\uC2B5\uB2C8\uB2E4.</p>' +
      '<div><b>\uAE30\uD638:</b> [' +
      symbols.join(', ') +
      ']</div>' +
      '<div class="gw-private-box"><b>\uD83D\uDD12 \uB0B4 \uADDC\uCE59:</b><ul>' +
      rules
        .map(function (r) {
          return '<li>' + esc(r) + '</li>';
        })
        .join('') +
      '</ul></div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     LOAD SHARING (C8)
     ═══════════════════════════════════════════ */
  function renderLoadSharing(session) {
    var pv = session.privateData || {};
    var capacityVal = pv.capacity || '?';
    var weakWave = pv.weakWave || '?';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>⚓ 하중 분담</h3>' +
      '<p>각자 하중을 선택하여 견뎌야 합니다. 과부하 시 팀 전체 위험!</p>' +
      '<div class="gw-private-box">' +
      '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
      '<div>🏋️ <b>내 최대 용량:</b> <span style="font-size:20px;font-weight:700;color:var(--accent)">' +
      esc(capacityVal) +
      '</span></div>' +
      '<div>🌊 <b>약한 웨이브:</b> <span style="font-size:20px;font-weight:700;color:var(--warn)">' +
      esc(weakWave) +
      '</span></div>' +
      '</div></div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     TRUST CHAIN (C9)
     ═══════════════════════════════════════════ */
  function renderTrustChain(session) {
    var pv = session.privateData || {};
    var energy = pv.energy || 0;
    var energyColor =
      energy > 5 ? '#43a047' : energy > 2 ? '#ffb454' : '#e53935';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🔗 신뢰 체인</h3>' +
      '<p>에너지를 다른 플레이어에게 분배하세요. 신뢰를 받지 못하면 탈락!</p>' +
      '<div class="gw-private-box">' +
      '<div style="text-align:center">' +
      '<div style="font-size:14px;color:var(--muted)">⚡ 내 에너지</div>' +
      '<div style="font-size:36px;font-weight:800;color:' +
      energyColor +
      '">' +
      energy +
      '</div>' +
      '</div></div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     ROUTE CONSENSUS (C10)
     ═══════════════════════════════════════════ */
  function renderRouteConsensus(session) {
    var pd = session.publicData || {};
    var clues = session.privateData ? session.privateData.clues : [];
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83D\uDEE4\uFE0F \uB8E8\uD2B8 \uD569\uC758</h3>' +
      '<p>\uCCB4\uD06C\uD3EC\uC778\uD2B8\uB9C8\uB2E4 A/B/C \uB8E8\uD2B8 \uC911 \uD558\uB098\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4. \uACFC\uBC18\uC218 \uC77C\uCE58\uD574\uC57C \uC0DD\uC874!</p>' +
      '<div><b>\uCCB4\uD06C\uD3EC\uC778\uD2B8:</b> ' +
      esc(pd.checkpoint) +
      '</div>' +
      '<div class="gw-private-box"><b>\uD83D\uDD12 \uB0B4 \uB2E8\uC11C:</b><ul>' +
      clues
        .map(function (c) {
          return '<li>' + esc(c) + '</li>';
        })
        .join('') +
      '</ul></div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     PUZZLE CODEBREAK (D1)
     ═══════════════════════════════════════════ */
  function renderCodebreak(session) {
    var pv = session.privateData || {};
    var hints = pv.hints || [];
    var attemptsLeft = pv.attempts || 0;
    var solved =
      session.me &&
      session.me.alive &&
      hints.length > 0 &&
      hints[hints.length - 1] &&
      hints[hints.length - 1].hint &&
      hints[hints.length - 1].hint.exact === 4;
    var hintsHtml = '';
    if (hints.length) {
      hintsHtml =
        '<div class="gw-hints"><div class="gw-log-title">📋 시도 기록</div>';
      hints.forEach(function (h, idx) {
        if (h && h.guess && h.hint) {
          var dots = '';
          for (var i = 0; i < h.hint.exact; i++)
            dots += '<span class="code-dot exact">●</span>';
          for (var j = 0; j < h.hint.colorOnly; j++)
            dots += '<span class="code-dot color">●</span>';
          var rem = 4 - h.hint.exact - h.hint.colorOnly;
          for (var k = 0; k < rem; k++)
            dots += '<span class="code-dot miss">○</span>';
          hintsHtml +=
            '<div class="gw-hint-row">' +
            '<span class="muted">#' +
            (idx + 1) +
            '</span> ' +
            '<b>[' +
            h.guess.join(', ') +
            ']</b> → ' +
            dots +
            '</div>';
        }
      });
      hintsHtml += '</div>';
    }
    var canSubmit = attemptsLeft > 0 && !solved;
    var attColor =
      attemptsLeft > 3
        ? 'var(--good)'
        : attemptsLeft > 1
        ? 'var(--warn)'
        : 'var(--bad)';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🔐 컬러 코드 락</h3>' +
      '<p>4자리 코드(1~6)를 맞추세요. 시도할 때마다 힌트를 얻습니다.</p>' +
      '<div class="gw-highlight">🔑 <b>남은 시도:</b> <span style="font-size:20px;font-weight:800;color:' +
      attColor +
      '">' +
      attemptsLeft +
      '</span>' +
      ' <span class="muted" style="margin-left:8px">(<span class="code-dot exact">●</span>=정확 <span class="code-dot color">●</span>=색만 <span class="code-dot miss">○</span>=없음)</span></div>' +
      (solved
        ? '<div class="gw-highlight" style="font-size:18px;font-weight:700;background:rgba(82,209,140,0.15);border-color:var(--good)">✅ 코드 해독 성공!</div>'
        : '') +
      hintsHtml +
      '</div>' +
      (canSubmit
        ? renderFormArea(session)
        : solved
        ? submittedBadge()
        : '<div class="gw-warn-box">시도 횟수 소진</div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     PUZZLE ORDER (D2)
     ═══════════════════════════════════════════ */
  function renderPuzzleOrder(session) {
    var pd = session.publicData || {};
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83D\uDCCB \uC21C\uC11C \uB9DE\uCD94\uAE30 \uD37C\uC990</h3>' +
      '<p>\uC8FC\uC5B4\uC9C4 \uB2E8\uC11C\uB97C \uBC14\uD0D5\uC73C\uB85C \uC62C\uBC14\uB978 \uC21C\uC11C\uB97C \uCC3E\uC73C\uC138\uC694.</p>' +
      '<div><b>\uC815\uB82C \uB300\uC0C1:</b> [' +
      esc((pd.entities || []).join(', ')) +
      ']</div>' +
      (pd.clues
        ? '<div><b>\uB2E8\uC11C:</b><ul>' +
          pd.clues
            .map(function (c) {
              return '<li>' + esc(c) + '</li>';
            })
            .join('') +
          '</ul></div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     ESTIMATE AUCTION (D3)
     ═══════════════════════════════════════════ */
  function renderEstimateAuction(session) {
    var pd = session.publicData || {};
    var sampleArr = pd.sample || [];
    var heartCount = sampleArr.filter(function (x) {
      return x === 'heart' || x === '♥';
    }).length;
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>💰 추정 경매</h3>' +
      '<p>숨겨진 heart 수를 추정하고 위험도를 베팅합니다. 가장 먼 추정이 탈락!</p>' +
      (sampleArr.length
        ? '<div class="gw-highlight">📊 <b>공개 표본 (' +
          sampleArr.length +
          '개):</b></div>' +
          '<div class="sample-display">' +
          sampleArr
            .map(function (s) {
              var isHeart = s === 'heart' || s === '♥';
              return (
                '<span class="sample-item ' +
                (isHeart ? 'heart' : 'other') +
                '">' +
                (isHeart ? '♥' : '♠') +
                '</span>'
              );
            })
            .join('') +
          '</div>' +
          '<div class="muted" style="text-align:center;margin-top:4px">표본 중 ♥: <b>' +
          heartCount +
          '</b>개</div>'
        : '<div class="muted">표본 없음</div>') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     GRID PATH (D4)
     ═══════════════════════════════════════════ */
  function renderGridPath(session) {
    var pd = session.publicData || {};
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83D\uDD32 \uACA9\uC790 \uD0C8\uCD9C</h3>' +
      '<p>R(\uC624\uB978\uCABD), L(\uC67C\uCABD), U(\uC704), D(\uC544\uB798)\uB85C \uACBD\uB85C\uB97C \uC785\uB825\uD558\uC138\uC694.</p>' +
      (pd.puzzle && pd.puzzle.clue
        ? '<div class="gw-highlight"><b>\uB2E8\uC11C:</b> ' +
          esc(pd.puzzle.clue) +
          '</div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     TRUTH LEDGER (D5)
     ═══════════════════════════════════════════ */
  function renderTruthLedger(session) {
    var pd = session.publicData || {};
    var stmts = pd.statements || [];
    var labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>📖 진실 원장</h3>' +
      '<p>A~D의 진술 중 거짓말쟁이를 찾아내세요. 누가 거짓을 말하고 있을까?</p>' +
      (stmts.length
        ? '<div class="gw-statements">' +
          stmts
            .map(function (s, i) {
              return (
                '<div class="gw-statement-row"><span class="stmt-label">' +
                (labels[i] || i + 1) +
                '</span> ' +
                esc(s) +
                '</div>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     WEIGHTED AVERAGE (D6)
     ═══════════════════════════════════════════ */
  function renderWeightedAvg(session) {
    var pv = session.privateData || {};
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>\uD83D\uDCCA \uAC00\uC911 \uD3C9\uADE0</h3>' +
      '<p>\uC22B\uC790\uC640 \uAC00\uC911\uCE58\uB97C \uC81C\uCD9C\uD569\uB2C8\uB2E4. \uC804\uCCB4 \uAC00\uC911 \uD3C9\uADE0\uC5D0 \uAC00\uC7A5 \uBA3C \uC0AC\uB78C \uD0C8\uB77D!</p>' +
      (pv.clues && Array.isArray(pv.clues)
        ? '<div class="gw-private-box"><b>\uD83D\uDD12 \uB0B4 \uB2E8\uC11C:</b><ul>' +
          pv.clues
            .map(function (c) {
              return '<li>' + esc(c) + '</li>';
            })
            .join('') +
          '</ul></div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     NUMBER BINGO (D7)
     ═══════════════════════════════════════════ */
  function renderNumberBingo(session) {
    var pv = session.privateData || {};
    var boardObj = pv.board || {};
    var numbers = boardObj.numbers || [null, null, null, null];
    var filled = boardObj.filled || [false, false, false, false];
    var locked = boardObj.locked || [false, false, false, false];
    var turn = (session.publicData && session.publicData.turn) || 0;
    var isSetup = session.phase === 'bingo-setup';

    var cellHtml = function (idx) {
      var num = numbers[idx];
      var isFilled = filled[idx];
      var isLocked = locked[idx];
      var cls = 'bingo-cell';
      if (isFilled) cls += ' bingo-filled';
      if (isLocked) cls += ' bingo-locked';
      if (num === null) cls += ' bingo-empty';
      var label = num !== null ? num : '?';
      var icon = isFilled ? '✅' : '';
      return (
        '<div class="' +
        cls +
        '"><span class="bingo-num">' +
        label +
        '</span>' +
        (icon ? '<span class="bingo-check">' + icon + '</span>' : '') +
        '</div>'
      );
    };

    var gridHtml =
      '<div class="bingo-grid">' +
      '<div class="bingo-row">' +
      cellHtml(0) +
      cellHtml(1) +
      '</div>' +
      '<div class="bingo-row">' +
      cellHtml(2) +
      cellHtml(3) +
      '</div>' +
      '</div>';

    var hasBingo =
      (filled[0] && filled[1]) ||
      (filled[2] && filled[3]) ||
      (filled[0] && filled[2]) ||
      (filled[1] && filled[3]);

    var statusHtml = isSetup
      ? '<div class="gw-highlight">🔧 <b>셋업 단계</b> — 빈 칸 두 개에 넣을 숫자(1~9)를 선택하세요</div>'
      : '<div class="gw-highlight">🎯 <b>턴 ' +
        turn +
        '/5</b> — 숫자를 제시하세요. 모든 제시의 평균이 타깃!</div>';

    var bingoAlert = hasBingo
      ? '<div class="gw-warn-box" style="background:#1b5e20;border-color:#43a047">🎉 <b>빙고 달성!</b> 이 상태를 유지하세요!</div>'
      : '';

    var legendHtml =
      '<div class="bingo-legend">' +
      '<span><span class="bingo-dot bingo-dot-locked"></span> 잠금(대각선)</span>' +
      '<span><span class="bingo-dot bingo-dot-empty"></span> 내가 선택</span>' +
      '<span><span class="bingo-dot bingo-dot-filled"></span> 적중</span>' +
      '</div>';

    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🔢 넘버 빙고</h3>' +
      '<p>2×2 보드에서 가로 또는 세로 한 줄을 완성하세요!</p>' +
      statusHtml +
      gridHtml +
      legendHtml +
      bingoAlert +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     COUNTDOWN GUESS (D8) - bomb passing
     ═══════════════════════════════════════════ */
  function renderBombGame(room, session) {
    var players = session.players || [];
    var holderId = session.publicData.holderId;
    var containerSize = 340;
    var radius = 130;
    var circleHtml = '<div class="bomb-circle-container">';
    circleHtml += '<div class="bomb-icon">\uD83D\uDCA3</div>';
    players.forEach(function (p, i) {
      var angle = (2 * Math.PI * i) / players.length - Math.PI / 2;
      var x = containerSize / 2 + radius * Math.cos(angle) - 28;
      var y = containerSize / 2 + radius * Math.sin(angle) - 28;
      var hasBomb = p.id === holderId;
      var dead = !p.alive;
      circleHtml +=
        '<div class="bomb-circle-player' +
        (hasBomb ? ' has-bomb' : '') +
        (dead ? ' dead-p' : '') +
        '" style="left:' +
        x +
        'px;top:' +
        y +
        'px">' +
        esc(p.username) +
        '</div>';
    });
    circleHtml += '</div>';
    var rangeHtml =
      '<div class="gw-game-card" style="text-align:center"><b>\uBC94\uC704:</b> ' +
      session.publicData.low +
      ' ~ ' +
      session.publicData.high +
      '</div>';
    var formHtml = '';
    if (holderId === state.user.id && !state.mySubmitted) {
      formHtml =
        '<div class="gw-form-area"><label>\uC22B\uC790 \uCD94\uCE21<input id="bomb-guess" type="number" min="' +
        session.publicData.low +
        '" max="' +
        session.publicData.high +
        '" value="' +
        Math.floor((session.publicData.low + session.publicData.high) / 2) +
        '" /></label>' +
        '<button class="gw-submit-btn" id="bomb-submit-btn">\uC81C\uCD9C</button></div>';
    } else if (holderId === state.user.id) {
      formHtml = submittedBadge();
    } else {
      formHtml =
        '<div class="gw-waiting"><div class="spinner"></div><div>' +
        esc(pName(session.players, holderId)) +
        '\uC758 \uCC28\uB840\uC785\uB2C8\uB2E4...</div></div>';
    }
    return (
      statusBar(session) +
      playerChips(session) +
      circleHtml +
      rangeHtml +
      formHtml +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     LIAR COUNTING (D9)
     ═══════════════════════════════════════════ */
  function renderLiarCounting(session) {
    var pd = session.publicData || {};
    var animalEmoji = {
      cat: '🐱',
      dog: '🐶',
      rabbit: '🐰',
      bird: '🐦',
      fish: '🐟',
    };
    var isSetup = session.phase === 'animal-select';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🤥 거짓 카운팅</h3>' +
      (isSetup
        ? '<p>5마리 동물을 가방에 배치하세요. 전략적으로 선택!</p>' +
          '<div class="gw-highlight">🐾 <b>배치 단계</b> — 5마리를 선택하세요</div>'
        : '<p>동물 수를 선언하거나 이전 선언을 심판하세요. 거짓이면 탈락!</p>' +
          (pd.currentClaim
            ? '<div class="gw-warn-box" style="text-align:center;font-size:16px">' +
              '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">현재 선언</div>' +
              '<div style="font-size:28px">' +
              (animalEmoji[pd.currentClaim.animal] || '🐾') +
              '</div>' +
              '<div><b>' +
              esc(pd.currentClaim.animal) +
              '</b> × <span style="font-size:22px;font-weight:700;color:var(--accent)">' +
              pd.currentClaim.count +
              '</span>마리 이상</div>' +
              '</div>'
            : '<div class="muted" style="text-align:center">아직 선언 없음</div>')) +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     CIRCUIT SOLVE (D10)
     ═══════════════════════════════════════════ */
  function renderCircuitSolve(session) {
    var pd = session.publicData || {};
    var puzzle = pd.puzzle || {};
    var lines = puzzle.text || [];
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>⚡ 회로 풀기</h3>' +
      '<p>스위치를 올바르게 조작하여 회로를 완성하세요. 모든 조건을 만족해야 합니다!</p>' +
      (lines.length
        ? '<div class="gw-statements">' +
          '<div class="gw-log-title">🔌 회로 조건</div>' +
          lines
            .map(function (l, i) {
              return (
                '<div class="gw-statement-row"><span class="stmt-label">' +
                (i + 1) +
                '</span> ' +
                esc(l) +
                '</div>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     TEXT VOTE (H1)
     ═══════════════════════════════════════════ */
  function renderTextVote(session) {
    var pd = session.publicData || {};
    var isWrite = session.phase === 'write';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>📝 자기소개 투표</h3>' +
      (isWrite
        ? '<p>익명 자기소개서를 작성하세요. <b style="color:var(--bad)">투표에서 뽑히면 탈락!</b></p>' +
          '<div class="gw-highlight">✍️ <b>작성 단계</b> — 살아남을 수 있는 소개서를 쓰세요</div>'
        : '<p>자기소개서를 읽고 탈락시킬 사람에게 투표하세요.</p>' +
          '<div class="gw-warn-box">🗳️ <b>투표 단계</b> — 과반 득표자 탈락!</div>' +
          (pd.entries
            ? '<div class="gw-entries">' +
              Object.entries(pd.entries)
                .map(function (e, idx) {
                  return (
                    '<div class="gw-entry-card"><div class="entry-header"><span class="stmt-label">' +
                    (idx + 1) +
                    '</span>' +
                    '<span class="muted">ID: ' +
                    esc(e[0]).slice(0, 6) +
                    '...</span></div>' +
                    '<p style="margin:8px 0 0;font-style:italic">"' +
                    esc(e[1]) +
                    '"</p></div>'
                  );
                })
                .join('') +
              '</div>'
            : '')) +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     HIDDEN ROLE RPS (H2)
     ═══════════════════════════════════════════ */
  function renderHiddenRoleRps(session) {
    var pv = session.privateData || {};
    var isSaboteur = pv.role === '사보타지';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>✊✌✋ 숨겨진 역할 가위바위보</h3>' +
      '<p>팀으로 가위바위보! <b style="color:var(--bad)">사보타지는 팀의 패배를 원합니다!</b></p>' +
      '<div class="gw-private-box" style="text-align:center">' +
      '<div style="font-size:13px;color:var(--muted)">🔒 내 역할</div>' +
      '<div style="font-size:28px;font-weight:800;color:' +
      (isSaboteur ? '#e53935' : '#43a047') +
      '">' +
      (isSaboteur ? '🕵️ ' : '👤 ') +
      esc(pv.role || '?') +
      '</div>' +
      (isSaboteur
        ? '<div class="muted" style="margin-top:4px">팀이 지도록 유도하세요!</div>'
        : '<div class="muted" style="margin-top:4px">팀의 승리를 위해 싸우세요!</div>') +
      '</div>' +
      '</div>' +
      (state.mySubmitted ? submittedBadge() : renderFormArea(session)) +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     GIFT POISON (H3)
     ═══════════════════════════════════════════ */
  function renderGiftPoison(session) {
    var items = (session.privateData && session.privateData.items) || [];
    var receivedCount =
      (session.privateData && session.privateData.receivedCount) || 0;
    var alive = session.players.filter(function (p) {
      return p.alive && p.id !== state.user.id;
    });
    var itemNames = {
      poison: '🧪 독약',
      antidote: '💊 해독제',
      empty: '📦 빈 상자',
    };
    var itemColors = {
      poison: '#e53935',
      antidote: '#43a047',
      empty: '#78909c',
    };
    var itemsHtml =
      '<div class="gift-items">' +
      items
        .map(function (item, idx) {
          return (
            '<div class="gift-item ' +
            item +
            '" data-item="' +
            item +
            '" data-idx="' +
            idx +
            '" style="border-color:' +
            (itemColors[item] || 'var(--line)') +
            '">' +
            (itemNames[item] || item) +
            '</div>'
          );
        })
        .join('') +
      '</div>';
    var targetHtml =
      '<label>대상 선택<select id="gift-target">' +
      alive
        .map(function (p) {
          return (
            '<option value="' + p.id + '">' + esc(p.username) + '</option>'
          );
        })
        .join('') +
      '</select></label>';
    var dangerLevel =
      receivedCount >= 1
        ? receivedCount >= 2
          ? 'critical'
          : 'warning'
        : 'safe';
    var dangerColors = {
      safe: 'var(--good)',
      warning: 'var(--warn)',
      critical: 'var(--bad)',
    };
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🎁 선물과 독약</h3>' +
      '<p>매 밤 하나의 상자를 다른 플레이어에게 보냅니다. <b style="color:var(--bad)">독약 > 해독제이면 탈락!</b></p>' +
      '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<div class="gw-highlight" style="flex:1;min-width:120px"><b>🌙 밤 ' +
      (session.publicData.night || 1) +
      '/3</b></div>' +
      '<div class="gw-highlight" style="flex:1;min-width:120px">📦 받은 상자: <b style="font-size:20px">' +
      receivedCount +
      '</b>개</div>' +
      '</div></div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div style="max-width:500px;width:100%">' +
          '<h4>보낼 상자를 클릭하세요:</h4>' +
          itemsHtml +
          '<div class="gw-form-area">' +
          targetHtml +
          '<button class="gw-submit-btn" id="gift-submit-btn">전송</button></div></div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     ANONYMOUS VOTE (H4)
     ═══════════════════════════════════════════ */
  function renderAnonymousVote(session) {
    var alive = session.players.filter(function (p) {
      return p.alive && p.id !== state.user.id;
    });
    var round = (session.publicData && session.publicData.round) || 1;
    var totalAlive = session.players.filter(function (p) {
      return p.alive;
    }).length;
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🗳️ 익명 투표</h3>' +
      '<p><b style="color:var(--bad)">과반 득표자가 탈락</b>합니다. 투표는 익명으로 진행됩니다.</p>' +
      '<div class="gw-highlight">📍 <b>라운드 ' +
      round +
      '</b> | 생존자: <b>' +
      totalAlive +
      '명</b>' +
      ' | 과반 기준: <b>' +
      Math.ceil(totalAlive / 2) +
      '표</b></div>' +
      '</div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div class="gw-form-area"><h4>숙청 대상을 선택하세요:</h4><select id="vote-target">' +
          alive
            .map(function (p) {
              return (
                '<option value="' + p.id + '">' + esc(p.username) + '</option>'
              );
            })
            .join('') +
          '</select>' +
          '<button class="gw-submit-btn" id="vote-submit-btn">🗳️ 투표</button></div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     PAIR TRUST (H5)
     ═══════════════════════════════════════════ */
  function renderPairTrust(session) {
    var pv = session.privateData || {};
    var pairWith = pv.pairWith;
    var round = (session.publicData && session.publicData.round) || 1;
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🤝 짝 신뢰</h3>' +
      '<p>상대방과 행동을 선택합니다.</p>' +
      '<div class="gw-highlight">📍 <b>라운드 ' +
      round +
      '</b></div>' +
      '<div class="gw-private-box" style="text-align:center">' +
      '<div style="font-size:13px;color:var(--muted)">상대방</div>' +
      '<div style="font-size:22px;font-weight:700;color:var(--accent)">' +
      esc(pName(session.players, pairWith)) +
      '</div></div>' +
      '<div class="gw-statements" style="font-size:13px">' +
      '<div class="gw-statement-row">🤝+🤝 = 모두 생존</div>' +
      '<div class="gw-statement-row">✂️+🤝 = 배신자 생존, 희생자 위험</div>' +
      '<div class="gw-statement-row">✂️+✂️ = 모두 위험</div>' +
      '<div class="gw-statement-row">🛡️ = 배신 방어 (보상 없음)</div>' +
      '</div>' +
      '</div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div style="display:flex;gap:10px;justify-content:center;margin-top:16px;max-width:500px">' +
          '<button class="gw-action-btn action-good" data-action="catch">🤝 받기<br><small>Catch</small></button>' +
          '<button class="gw-action-btn action-warn" data-action="guard">🛡 방어<br><small>Guard</small></button>' +
          '<button class="gw-action-btn action-bad" data-action="cut">✂ 배신<br><small>Cut</small></button>' +
          '</div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     POT SPLIT (H6)
     ═══════════════════════════════════════════ */
  function renderPotSplit(session) {
    var round = (session.publicData && session.publicData.round) || 1;
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>💰 냄비 분배</h3>' +
      '<p>Share, Steal, Burn 중 선택. 조합에 따라 생존 결정!</p>' +
      '<div class="gw-highlight">📍 <b>라운드 ' +
      round +
      '</b></div>' +
      '<div class="gw-statements" style="font-size:13px">' +
      '<div class="gw-statement-row">🤝+🤝 = 모두 생존</div>' +
      '<div class="gw-statement-row">💰+🤝 = 도둑만 생존</div>' +
      '<div class="gw-statement-row">💰+💰 = 모두 위험</div>' +
      '<div class="gw-statement-row">🔥 = 모든 것을 태움</div>' +
      '</div>' +
      '</div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div style="display:flex;gap:10px;justify-content:center;margin-top:16px;max-width:500px">' +
          '<button class="gw-action-btn action-good" data-action="share">🤝 나누기<br><small>Share</small></button>' +
          '<button class="gw-action-btn action-bad" data-action="steal">💰 훔치기<br><small>Steal</small></button>' +
          '<button class="gw-action-btn action-warn" data-action="burn">🔥 태우기<br><small>Burn</small></button>' +
          '</div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     MASK DEALER (H7)
     ═══════════════════════════════════════════ */
  function renderMaskDealer(session) {
    var pv = session.privateData || {};
    if (session.phase === 'mask-bid') {
      var coins = pv.coins || 5;
      return (
        statusBar(session) +
        playerChips(session) +
        '<div class="gw-game-card"><h3>🎭 가면 딜러 — 입찰 단계</h3>' +
        '<p>가면을 입찰하세요! Wolf > Fox > Sheep 관계.</p>' +
        '<div class="gw-statements" style="font-size:13px">' +
        '<div class="gw-statement-row">🐺 <b>Wolf</b> — Fox를 잡아먹음</div>' +
        '<div class="gw-statement-row">🦊 <b>Fox</b> — Sheep을 사냥</div>' +
        '<div class="gw-statement-row">🐑 <b>Sheep</b> — Wolf에 승리</div>' +
        '</div>' +
        '<div class="gw-private-box" style="text-align:center"><div style="font-size:13px;color:var(--muted)">보유 코인</div>' +
        '<div style="font-size:28px;font-weight:800;color:var(--diamond)">🪙 ' +
        coins +
        '</div></div></div>' +
        (state.mySubmitted
          ? submittedBadge()
          : '<div class="gw-form-area">' +
            '<label>가면 선택<select id="mask-select"><option value="Wolf">🐺 Wolf</option><option value="Fox">🦊 Fox</option><option value="Sheep">🐑 Sheep</option></select></label>' +
            '<label>입찰 코인<input id="mask-bid" type="number" min="0" max="' +
            coins +
            '" value="0" /></label>' +
            '<button class="gw-submit-btn" id="mask-submit-btn">입찰</button></div>') +
        logHtml(session.log)
      );
    }
    var role = pv.role || '?';
    var roleEmoji = {
      Wolf: '🐺',
      Fox: '🦊',
      Sheep: '🐑',
    };
    var roleColor = { Wolf: '#e53935', Fox: '#ff9800', Sheep: '#43a047' };
    var alive = session.players.filter(function (p) {
      return p.alive && p.id !== state.user.id;
    });
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card"><h3>🎭 가면 딜러 — 투표 단계</h3>' +
      '<p>의심되는 대상을 투표하세요. 최다 득표자 탈락!</p>' +
      '<div class="gw-private-box" style="text-align:center">' +
      '<div style="font-size:13px;color:var(--muted)">🔒 내 역할</div>' +
      '<div style="font-size:36px">' +
      (roleEmoji[role] || '🎭') +
      '</div>' +
      '<div style="font-size:20px;font-weight:700;color:' +
      (roleColor[role] || 'var(--text)') +
      '">' +
      esc(role) +
      '</div></div></div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div class="gw-form-area"><h4>의심 대상:</h4><select id="mask-vote-target">' +
          alive
            .map(function (p) {
              return (
                '<option value="' + p.id + '">' + esc(p.username) + '</option>'
              );
            })
            .join('') +
          '</select>' +
          '<button class="gw-submit-btn" id="mask-vote-submit-btn">투표</button></div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     CONFESSION MARKET (H8)
     ═══════════════════════════════════════════ */
  function renderConfessionMarket(session) {
    var pv = session.privateData || {};
    var pd = session.publicData || {};
    if (session.phase === 'confession-publish') {
      var options = pv.options || [];
      return (
        statusBar(session) +
        playerChips(session) +
        '<div class="gw-game-card"><h3>📜 고백 시장 — 진술 공개</h3>' +
        '<p>아래 진술 중 하나를 공개합니다. <b>진짜처럼 보이는 것</b>을 고르세요!</p>' +
        '<div class="gw-highlight">🎭 전략적 선택: 상대를 속이기 위한 진술을 고르세요</div></div>' +
        (state.mySubmitted
          ? submittedBadge()
          : '<div class="gw-form-area">' +
            options
              .map(function (o, i) {
                return (
                  '<label class="entry-card" style="cursor:pointer"><input type="radio" name="claimIndex" value="' +
                  i +
                  '" ' +
                  (i === 0 ? 'checked' : '') +
                  ' /><span>"' +
                  esc(o) +
                  '"</span></label>'
                );
              })
              .join('') +
            '<button class="gw-submit-btn" id="confession-publish-btn">공개</button></div>') +
        logHtml(session.log)
      );
    }
    var claims = pd.claims || {};
    var alive = session.players.filter(function (p) {
      return p.alive && p.id !== state.user.id;
    });
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card"><h3>📜 고백 시장 — 베팅 단계</h3>' +
      '<p>각 진술을 읽고 trust/doubt를 베팅하세요. 정확한 판단이 생존을 결정!</p>' +
      '<div class="gw-statements">' +
      '<div class="gw-log-title">💬 공개된 진술</div>' +
      Object.keys(claims)
        .map(function (id) {
          return (
            '<div class="gw-statement-row"><b style="color:var(--accent)">' +
            esc(pName(session.players, id)) +
            ':</b> <span style="font-style:italic">"' +
            esc(claims[id]) +
            '"</span></div>'
          );
        })
        .join('') +
      '</div></div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div class="gw-form-area">' +
          '<label>베팅 대상<select id="conf-target">' +
          alive
            .map(function (p) {
              return (
                '<option value="' + p.id + '">' + esc(p.username) + '</option>'
              );
            })
            .join('') +
          '</select></label>' +
          '<div class="inline-wrap" style="margin-top:8px"><label class="radio-pill"><input type="radio" name="conf-stance" value="trust" checked />✅ 신뢰</label><label class="radio-pill"><input type="radio" name="conf-stance" value="doubt" />❌ 의심</label></div>' +
          '<button class="gw-submit-btn" id="confession-bet-btn">베팅</button></div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     KNIFE RELAY (H9)
     ═══════════════════════════════════════════ */
  function renderKnifeRelay(room, session) {
    var players = session.players || [];
    var hasKnife = session.privateData && session.privateData.hasKnife;
    var round = (session.publicData && session.publicData.round) || 1;
    var containerSize = 320;
    var radius = 120;
    var circleHtml = '<div class="knife-circle-container">';
    players.forEach(function (p, i) {
      var angle = (2 * Math.PI * i) / players.length - Math.PI / 2;
      var x = containerSize / 2 + radius * Math.cos(angle) - 26;
      var y = containerSize / 2 + radius * Math.sin(angle) - 26;
      var dead = !p.alive;
      var isMe = p.id === state.user.id;
      circleHtml +=
        '<div class="knife-player-node' +
        (dead ? ' dead-p' : '') +
        (isMe ? ' is-me' : '') +
        '" style="left:' +
        x +
        'px;top:' +
        y +
        'px">' +
        esc(p.username) +
        (isMe ? '<span style="font-size:8px;display:block">나</span>' : '') +
        '</div>';
    });
    circleHtml += '</div>';
    var infoHtml =
      '<div class="gw-game-card" style="text-align:center">' +
      '<h3>🔪 칼 릴레이</h3>' +
      '<p>라운드 종료 시 <b style="color:var(--bad)">칼을 가진 사람이 탈락!</b></p>' +
      '<div class="gw-highlight">📍 <b>라운드 ' +
      round +
      '</b></div>' +
      (hasKnife
        ? '<div class="gw-warn-box" style="animation:dangerPulse 1s infinite">🔪 <b>경고!</b> 당신이 칼을 가지고 있습니다! 빨리 넘기세요!</div>'
        : '<div class="muted">칼의 위치는 알 수 없습니다. 방향을 선택하세요.</div>') +
      '</div>';
    return (
      statusBar(session) +
      playerChips(session) +
      circleHtml +
      infoHtml +
      (state.mySubmitted
        ? submittedBadge()
        : '<div class="gw-form-area" style="text-align:center"><div style="display:flex;gap:10px;justify-content:center;margin-top:10px">' +
          '<button class="gw-action-btn action-warn" data-action="left" style="flex:1">← 왼쪽</button>' +
          '<button class="gw-action-btn" data-action="hold" style="flex:1">⏸ 유지</button>' +
          '<button class="gw-action-btn action-warn" data-action="right" style="flex:1">오른쪽 →</button></div></div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     BLOOD CONTRACT (H10)
     ═══════════════════════════════════════════ */
  function renderBloodContract(session) {
    var alive = session.players.filter(function (p) {
      return p.alive && p.id !== state.user.id;
    });
    var points = session.privateData ? session.privateData.points : 0;
    var round = (session.publicData && session.publicData.round) || 1;
    var pointColor =
      points > 3 ? '#43a047' : points > 0 ? '#ffb454' : '#e53935';
    var dangerMsg =
      points <= 0
        ? '<div class="gw-warn-box" style="animation:dangerPulse 1s infinite">⚠️ <b>위험!</b> 포인트가 0 이하입니다. 즉시 탈락 위험!</div>'
        : points <= 2
        ? '<div class="gw-warn-box">⚠️ 포인트가 낮습니다. 신중하게 선택하세요!</div>'
        : '';
    return (
      statusBar(session) +
      playerChips(session) +
      '<div class="gw-game-card">' +
      '<h3>🩸 피의 계약</h3>' +
      '<p>상대와 계약 또는 배신을 선택합니다. <b style="color:var(--bad)">포인트가 0 이하면 탈락!</b></p>' +
      '<div class="gw-highlight">📍 <b>라운드 ' +
      round +
      '</b></div>' +
      '<div class="gw-private-box" style="text-align:center">' +
      '<div style="font-size:13px;color:var(--muted)">내 포인트</div>' +
      '<div style="font-size:36px;font-weight:800;color:' +
      pointColor +
      '">' +
      points +
      '</div>' +
      '</div>' +
      dangerMsg +
      '<div class="gw-statements" style="font-size:13px">' +
      '<div class="gw-statement-row">📜+📜 = 서로 +1</div>' +
      '<div class="gw-statement-row">🗡️+📜 = 배신자 +3, 피해자 -2</div>' +
      '<div class="gw-statement-row">🗡️+🗡️ = 서로 -1</div>' +
      '</div>' +
      '</div>' +
      (state.mySubmitted
        ? submittedBadge()
        : '<div class="gw-form-area">' +
          '<label>대상<select id="bc-target">' +
          alive
            .map(function (p) {
              return (
                '<option value="' + p.id + '">' + esc(p.username) + '</option>'
              );
            })
            .join('') +
          '</select></label>' +
          '<div style="display:flex;gap:10px;margin-top:12px">' +
          '<button class="gw-action-btn action-good" data-mode="contract" style="flex:1">📜 계약</button>' +
          '<button class="gw-action-btn action-bad" data-mode="betray" style="flex:1">🗡 배신</button>' +
          '</div></div>') +
      logHtml(session.log)
    );
  }

  /* ═══════════════════════════════════════════
     GENERIC (fallback)
     ═══════════════════════════════════════════ */
  function renderGenericGame(session) {
    var html = statusBar(session) + playerChips(session);
    var pd = session.publicData || {};
    var pdHtml = '';
    Object.keys(pd).forEach(function (k) {
      var v = pd[k];
      if (v == null) return;
      if (Array.isArray(v))
        pdHtml += '<div><b>' + esc(k) + ':</b> ' + esc(v.join(', ')) + '</div>';
      else if (typeof v === 'object')
        pdHtml +=
          '<div><b>' + esc(k) + ':</b> ' + esc(JSON.stringify(v)) + '</div>';
      else pdHtml += '<div><b>' + esc(k) + ':</b> ' + esc(v) + '</div>';
    });
    if (pdHtml) html += '<div class="gw-game-card">' + pdHtml + '</div>';
    if (session.privateData) {
      var pvHtml = '';
      Object.keys(session.privateData).forEach(function (k) {
        var v = session.privateData[k];
        var c = Array.isArray(v)
          ? v.join(', ')
          : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
        pvHtml += '<div><b>' + esc(k) + ':</b> ' + esc(c) + '</div>';
      });
      if (pvHtml) html += '<div class="gw-private-box">' + pvHtml + '</div>';
    }
    html += state.mySubmitted ? submittedBadge() : renderFormArea(session);
    html += logHtml(session.log);
    return html;
  }

  /* ─────────── FORM AREA (unified) ─────────── */
  function renderFormArea(session) {
    if (!session.form)
      return '<div class="gw-waiting"><div class="spinner"></div><div>\uB2E4\uB978 \uD50C\uB808\uC774\uC5B4\uB97C \uAE30\uB2E4\uB9AC\uB294 \uC911...</div></div>';
    return (
      '<div class="gw-form-area"><form id="gw-session-form" class="stack">' +
      renderFormField(session.form, session) +
      '<button class="gw-submit-btn" type="submit">\uC81C\uCD9C</button></form></div>'
    );
  }

  /* ─────────── FORM FIELD RENDERER ─────────── */
  function renderFormField(field, view) {
    var labelFor = function (v) {
      if (typeof v === 'string' && v.length > 16 && view.players)
        return pName(view.players, v);
      return v;
    };
    if (field.type === 'text')
      return (
        '<label>' +
        esc(field.label || field.field) +
        '<input name="' +
        field.field +
        '" placeholder="' +
        esc(field.placeholder || '') +
        '" /></label>'
      );
    if (field.type === 'textarea')
      return (
        '<label>' +
        esc(field.label || field.field) +
        '<textarea name="' +
        field.field +
        '" rows="4"></textarea></label>'
      );
    if (field.type === 'number')
      return (
        '<label>' +
        esc(field.label || field.field) +
        '<input name="' +
        field.field +
        '" type="number" min="' +
        field.min +
        '" max="' +
        field.max +
        '" value="' +
        (field.min || 0) +
        '" /></label>'
      );
    if (field.type === 'select')
      return (
        '<label>' +
        esc(field.label || field.field) +
        '<select name="' +
        field.field +
        '">' +
        field.options
          .map(function (o) {
            return (
              '<option value="' + esc(o) + '">' + esc(labelFor(o)) + '</option>'
            );
          })
          .join('') +
        '</select></label>'
      );
    if (field.type === 'radio')
      return (
        '<div class="field-group"><span>' +
        esc(field.label || field.field) +
        '</span><div class="inline-wrap">' +
        field.options
          .map(function (o, i) {
            return (
              '<label class="radio-pill"><input type="radio" name="' +
              field.field +
              '" value="' +
              esc(o) +
              '" ' +
              (i === 0 ? 'checked' : '') +
              ' />' +
              esc(labelFor(o)) +
              '</label>'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'multi-select')
      return (
        '<div class="field-group"><span>' +
        esc(field.label || field.field) +
        '</span>' +
        field.options
          .map(function (o) {
            return (
              '<label class="check-pill"><input type="checkbox" name="' +
              field.field +
              '" value="' +
              esc(o) +
              '" />' +
              esc(o) +
              '</label>'
            );
          })
          .join('') +
        '</div>'
      );
    if (field.type === 'sequence')
      return (
        '<div class="field-group"><span>' +
        esc(field.label || '\uC21C\uC11C') +
        '</span>' +
        field.items
          .map(function (_, i) {
            return (
              '<select name="' +
              field.field +
              '_' +
              i +
              '">' +
              field.items
                .map(function (o) {
                  return (
                    '<option value="' + esc(o) + '">' + esc(o) + '</option>'
                  );
                })
                .join('') +
              '</select>'
            );
          })
          .join('') +
        '</div>'
      );
    if (field.type === 'digit-sequence')
      return (
        '<div class="field-group"><span>' +
        esc(field.label || '\uCF54\uB4DC') +
        '</span><div class="inline-wrap">' +
        Array.from({ length: field.length })
          .map(function (_, i) {
            return (
              '<input class="digit-input" name="' +
              field.field +
              '_' +
              i +
              '" type="number" min="' +
              field.min +
              '" max="' +
              field.max +
              '" value="' +
              field.min +
              '" />'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'compound')
      return field.fields
        .map(function (f) {
          return renderFormField(f, view);
        })
        .join('');
    if (field.type === 'hand-select')
      return (
        '<div class="field-group"><span>\uC804\uB2EC\uD560 \uCE74\uB4DC</span><div class="inline-wrap">' +
        field.cards
          .map(function (c, i) {
            return (
              '<label class="radio-pill"><input type="radio" name="' +
              field.field +
              '" value="' +
              i +
              '" ' +
              (i === 0 ? 'checked' : '') +
              ' />' +
              c +
              '</label>'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'grid')
      return (
        '<div class="field-group"><span>\uCD9C\uAD6C \uC120\uD0DD</span><div class="grid-3x3">' +
        field.options
          .map(function (o, i) {
            return (
              '<label class="grid-cell"><input type="radio" name="' +
              field.field +
              '" value="' +
              o +
              '" ' +
              (i === 0 ? 'checked' : '') +
              ' />' +
              (parseInt(o, 10) + 1) +
              '</label>'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'distribution')
      return (
        '<div class="field-group"><span>\uCD1D ' +
        field.total +
        ' \uD1A0\uD070 \uBD84\uBC30</span><div class="stack compact">' +
        field.targets
          .map(function (t) {
            return (
              '<label>' +
              esc(labelFor(t)) +
              '<input type="number" min="0" max="' +
              field.total +
              '" name="' +
              field.field +
              '_' +
              t +
              '" value="0" /></label>'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'multi-number')
      return (
        '<div class="field-group"><span>' +
        esc(field.label || '\uC22B\uC790') +
        '</span><div class="inline-wrap">' +
        Array.from({ length: field.count })
          .map(function (_, i) {
            return (
              '<input class="digit-input" name="' +
              field.field +
              '_' +
              i +
              '" type="number" min="' +
              field.min +
              '" max="' +
              field.max +
              '" value="' +
              field.min +
              '" />'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'vote-entries')
      return (
        '<div class="field-group"><span>\uD22C\uD45C</span>' +
        field.entries
          .map(function (e, i) {
            return (
              '<label class="entry-card"><input type="radio" name="' +
              field.field +
              '" value="' +
              esc(e.id) +
              '" ' +
              (i === 0 ? 'checked' : '') +
              ' /><span>' +
              esc(e.text) +
              '</span></label>'
            );
          })
          .join('') +
        '</div>'
      );
    if (field.type === 'radio-index')
      return (
        '<div class="field-group"><span>' +
        esc(field.label || field.field) +
        '</span>' +
        field.options
          .map(function (o, i) {
            return (
              '<label class="entry-card"><input type="radio" name="' +
              field.field +
              '" value="' +
              i +
              '" ' +
              (i === 0 ? 'checked' : '') +
              ' /><span>' +
              esc(o) +
              '</span></label>'
            );
          })
          .join('') +
        '</div>'
      );
    if (field.type === 'distribution-animal')
      return (
        '<div class="field-group"><span>\uCD1D 5\uB9C8\uB9AC \uBC30\uCE58</span><div class="stack compact">' +
        field.targets
          .map(function (a) {
            return (
              '<label>' +
              esc(a) +
              '<input type="number" min="0" max="5" name="' +
              field.field +
              '_' +
              a +
              '" value="0" /></label>'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'animal-claim') {
      if (field.first)
        return (
          '<div class="field-group"><label>\uB3D9\uBB3C<select name="animal">' +
          field.animals
            .map(function (a) {
              return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
            })
            .join('') +
          '</select></label><label>\uB9C8\uB9AC \uC218<input type="number" name="count" min="1" max="12" value="1" /></label></div>'
        );
      return (
        '<div class="field-group"><label>\uC0C1\uD5A5 \uC218\uCE58<input type="number" name="count" min="' +
        field.min +
        '" max="12" value="' +
        field.min +
        '" /></label><div class="inline-wrap"><label class="radio-pill"><input type="radio" name="mode" value="raise" checked />\uC0C1\uD5A5</label><label class="radio-pill"><input type="radio" name="mode" value="judge" />\uC2EC\uD310</label></div></div>'
      );
    }
    if (field.type === 'switches')
      return (
        '<div class="field-group"><span>\uC2A4\uC704\uCE58</span><div class="inline-wrap">' +
        field.switches
          .map(function (s) {
            return (
              '<label class="check-pill"><input type="checkbox" name="' +
              field.field +
              '_' +
              s +
              '" value="1" />' +
              esc(s) +
              '</label>'
            );
          })
          .join('') +
        '</div></div>'
      );
    if (field.type === 'sync-press')
      return '<button type="button" id="sync-press-btn" class="primary huge">\uC9C0\uAE08 \uB204\uB974\uAE30</button>';
    if (field.type === 'physical')
      return '<div id="physical-host" class="physical-host"></div>';
    return (
      '<div class="muted">\uC9C0\uC6D0\uB418\uC9C0 \uC54A\uB294 \uC785\uB825 \uD0C0\uC785: ' +
      esc(field.type) +
      '</div>'
    );
  }

  /* ─────────── FORM PAYLOAD COLLECTOR ─────────── */
  function collectFormPayload(formDef, formNode) {
    if (!formDef) return {};
    if (formDef.type === 'text' || formDef.type === 'textarea' || formDef.type === 'select') {
      var el = formNode.querySelector('[name="' + formDef.field + '"]');
      var o = {};
      o[formDef.field] = el ? el.value : '';
      return o;
    }
    if (formDef.type === 'number') {
      var numEl = formNode.querySelector('[name="' + formDef.field + '"]');
      var numeric = parseInt(numEl ? numEl.value : '', 10);
      var oNum = {};
      oNum[formDef.field] = Number.isFinite(numeric)
        ? numeric
        : parseInt(formDef.min, 10) || 0;
      return oNum;
    }
    if (formDef.type === 'radio') {
      var r = formNode.querySelector('[name="' + formDef.field + '"]:checked');
      var o2 = {};
      o2[formDef.field] = r ? r.value : formDef.options[0];
      return o2;
    }
    if (formDef.type === 'multi-select') {
      var vals = Array.prototype.map.call(
        formNode.querySelectorAll('[name="' + formDef.field + '"]:checked'),
        function (i) {
          return i.value;
        }
      );
      var o3 = {};
      o3[formDef.field] = vals;
      return o3;
    }
    if (formDef.type === 'sequence') {
      var arr = formDef.items.map(function (_, i) {
        return formNode.querySelector(
          '[name="' + formDef.field + '_' + i + '"]'
        ).value;
      });
      var o4 = {};
      o4[formDef.field] = arr;
      return o4;
    }
    if (formDef.type === 'digit-sequence') {
      var d = Array.from({ length: formDef.length }).map(function (_, i) {
        return (
          parseInt(
            formNode.querySelector('[name="' + formDef.field + '_' + i + '"]')
              .value,
            10
          ) || formDef.min
        );
      });
      var o5 = {};
      o5[formDef.field] = d;
      return o5;
    }
    if (formDef.type === 'compound') {
      var out = {};
      formDef.fields.forEach(function (f) {
        Object.assign(out, collectFormPayload(f, formNode));
      });
      return out;
    }
    if (formDef.type === 'hand-select') {
      return {
        cardIndex:
          parseInt(
            (
              formNode.querySelector(
                '[name="' + formDef.field + '"]:checked'
              ) || {}
            ).value,
            10
          ) || 0,
      };
    }
    if (formDef.type === 'grid') {
      return {
        cell:
          parseInt(
            (
              formNode.querySelector(
                '[name="' + formDef.field + '"]:checked'
              ) || {}
            ).value,
            10
          ) || 0,
      };
    }
    if (formDef.type === 'distribution') {
      var dist = {};
      formDef.targets.forEach(function (t) {
        var inp = formNode.querySelector(
          '[name="' + formDef.field + '_' + t + '"]'
        );
        dist[t] = parseInt(inp ? inp.value : '0', 10) || 0;
      });
      var o6 = {};
      o6[formDef.field] = dist;
      return o6;
    }
    if (formDef.type === 'multi-number') {
      var nums = Array.from({ length: formDef.count }).map(function (_, i) {
        return (
          parseInt(
            formNode.querySelector('[name="' + formDef.field + '_' + i + '"]')
              .value,
            10
          ) || formDef.min
        );
      });
      var o7 = {};
      o7[formDef.field] = nums;
      return o7;
    }
    if (formDef.type === 'vote-entries') {
      return {
        target: (
          formNode.querySelector('[name="' + formDef.field + '"]:checked') || {}
        ).value,
      };
    }
    if (formDef.type === 'radio-index') {
      return {
        claimIndex:
          parseInt(
            (
              formNode.querySelector(
                '[name="' + formDef.field + '"]:checked'
              ) || {}
            ).value,
            10
          ) || 0,
      };
    }
    if (formDef.type === 'distribution-animal') {
      var bag = {};
      formDef.targets.forEach(function (a) {
        var inp = formNode.querySelector(
          '[name="' + formDef.field + '_' + a + '"]'
        );
        bag[a] = parseInt(inp ? inp.value : '0', 10) || 0;
      });
      return { bag: bag };
    }
    if (formDef.type === 'animal-claim') {
      if (formDef.first)
        return {
          animal: formNode.querySelector('[name="animal"]').value,
          count:
            parseInt(formNode.querySelector('[name="count"]').value, 10) || 1,
        };
      return {
        mode:
          (formNode.querySelector('[name="mode"]:checked') || {}).value ||
          'raise',
        count:
          parseInt(formNode.querySelector('[name="count"]').value, 10) ||
          formDef.min,
      };
    }
    if (formDef.type === 'switches') {
      var sw = {};
      formDef.switches.forEach(function (s) {
        var inp = formNode.querySelector(
          '[name="' + formDef.field + '_' + s + '"]'
        );
        sw[s] = inp && inp.checked ? 1 : 0;
      });
      var o8 = {};
      o8[formDef.field] = sw;
      return o8;
    }
    return {};
  }

  /* ═══════════════════════════════════════════════
     BIND GAME ACTIONS
     ═══════════════════════════════════════════════ */
  /* engines that allow repeated submissions within the same phase */
  var MULTI_SUBMIT_ENGINES = ['puzzle-codebreak'];
  function doInput(frames) {
    if (!frames || !frames.length) return Promise.resolve({ ok: true });
    return callSocket(
      'game:input',
      buildGameEnvelope({
        frames: frames,
      })
    );
  }
  function doSubmit(payload) {
    state.mySubmitted = true;
    return callSocket('game:submit', buildGameEnvelope(payload)).then(function (r) {
      if (!r.ok) {
        state.mySubmitted = false;
        notify(r.error, 'error');
      } else {
        /* allow re-submit for multi-attempt games */
        var eng =
          state.currentRoom && state.currentRoom.session
            ? state.currentRoom.session.engine
            : '';
        if (MULTI_SUBMIT_ENGINES.indexOf(eng) >= 0) state.mySubmitted = false;
      }
    });
  }

  function bindGameActions(room, session, game) {
    if (!session) return;

    bind('result-exit-btn', 'click', function () {
      callSocket('room:leave').then(function () {
        state.currentRoom = null;
        state.lastRoomVersion = 0;
        state.gameWorldActive = false;
        state.briefingShown = false;
        location.hash = '#lobby';
        render();
      });
    });

    var engine = session.engine || '';

    // PHYSICAL GAMES
    if (engine.startsWith('physical-') && !session.result) {
      var host = document.getElementById('physical-host');
      if (host && window.BorderlandMiniGames) {
        if (state.activeMiniGame && state.activeMiniGame.cleanup) {
          state.activeMiniGame.cleanup();
          state.activeMiniGame = null;
        }
        var challenge = session.form
          ? session.form.challenge
          : { challengeType: 'target-hold', seconds: 75 };
        var key = session.sessionId + ':' + challenge.challengeType;
        var inputStartAt = Date.now();
        var inputTicker = setInterval(function () {
          doInput([{ t: Date.now() - inputStartAt, type: 'tick' }]);
        }, 250);
        var miniCleanup = window.BorderlandMiniGames.mountPhysicalChallenge(
          host,
          challenge,
          function (metrics) {
            clearInterval(inputTicker);
            doSubmit({ done: true, metrics: metrics }).then(function () {
              if (host)
                host.innerHTML =
                  '<div style="text-align:center;padding:30px;font-size:18px">\u2705 \uACB0\uACFC \uC81C\uCD9C \uC644\uB8CC. \uB2E4\uB978 \uD50C\uB808\uC774\uC5B4 \uB300\uAE30 \uC911...</div>';
            });
          }
        );
        state.activeMiniGame = {
          key: key,
          cleanup: function () {
            clearInterval(inputTicker);
            if (miniCleanup) miniCleanup();
          },
        };
      }
      return;
    }

    // SYNC PRESS
    if (engine === 'sync-press') {
      bind('sync-btn', 'click', function () {
        doSubmit({ pressed: true });
      });
      return;
    }

    // BOMB GAME
    if (engine === 'countdown-guess') {
      bind('bomb-submit-btn', 'click', function () {
        doSubmit({
          guess: parseInt(document.getElementById('bomb-guess').value, 10),
        });
      });
      return;
    }

    // KNIFE RELAY / PAIR TRUST / POT SPLIT
    if (
      engine === 'knife-relay' ||
      engine === 'pair-trust' ||
      engine === 'pot-split'
    ) {
      Array.prototype.forEach.call(
        document.querySelectorAll('[data-action]'),
        function (btn) {
          btn.addEventListener('click', function () {
            doSubmit({ action: btn.getAttribute('data-action') });
          });
        }
      );
      return;
    }

    // GIFT POISON
    if (engine === 'gift-poison') {
      var selectedItem = null;
      Array.prototype.forEach.call(
        document.querySelectorAll('.gift-item'),
        function (item) {
          item.addEventListener('click', function () {
            document.querySelectorAll('.gift-item').forEach(function (x) {
              x.classList.remove('selected');
            });
            item.classList.add('selected');
            selectedItem = item.getAttribute('data-item');
          });
        }
      );
      bind('gift-submit-btn', 'click', function () {
        if (!selectedItem)
          return notify(
            '\uC0C1\uC790\uB97C \uC120\uD0DD\uD558\uC138\uC694',
            'error'
          );
        doSubmit({
          target: document.getElementById('gift-target').value,
          item: selectedItem,
        });
      });
      return;
    }

    // ANONYMOUS VOTE
    if (engine === 'anonymous-vote') {
      bind('vote-submit-btn', 'click', function () {
        doSubmit({ target: document.getElementById('vote-target').value });
      });
      return;
    }

    // BLOOD CONTRACT
    if (engine === 'blood-contract') {
      Array.prototype.forEach.call(
        document.querySelectorAll('[data-mode]'),
        function (btn) {
          btn.addEventListener('click', function () {
            doSubmit({
              target: document.getElementById('bc-target').value,
              mode: btn.getAttribute('data-mode'),
            });
          });
        }
      );
      return;
    }

    // MASK DEALER
    if (engine === 'mask-dealer') {
      bind('mask-submit-btn', 'click', function () {
        doSubmit({
          mask: document.getElementById('mask-select').value,
          bid: parseInt(document.getElementById('mask-bid').value, 10) || 0,
        });
      });
      bind('mask-vote-submit-btn', 'click', function () {
        doSubmit({ target: document.getElementById('mask-vote-target').value });
      });
      return;
    }

    // CONFESSION MARKET
    if (engine === 'confession-market') {
      bind('confession-publish-btn', 'click', function () {
        var r = document.querySelector('[name="claimIndex"]:checked');
        doSubmit({ claimIndex: parseInt(r ? r.value : '0', 10) });
      });
      bind('confession-bet-btn', 'click', function () {
        var stance =
          (document.querySelector('[name="conf-stance"]:checked') || {})
            .value || 'trust';
        doSubmit({
          target: document.getElementById('conf-target').value,
          stance: stance,
        });
      });
      return;
    }

    // GENERIC FORM
    var genericForm = document.getElementById('gw-session-form');
    if (genericForm && session.form) {
      genericForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var payload = collectFormPayload(session.form, genericForm);
        doSubmit(payload);
      });
    }
  }

  /* ─────────── ROOM ROUTER ─────────── */
  function renderRoom(roomId) {
    var room = state.currentRoom;
    if (!room || room.id !== roomId) {
      var localRoom = state.rooms.find(function (r) {
        return r.id === roomId;
      });
      if (localRoom)
        callSocket('room:join', { roomId: roomId }).then(function (r) {
          if (!r.ok) notify(r.error, 'error');
        });
      root.innerHTML =
        renderNav(currentRoute()) +
        '<main class="page"><section class="card">\uBC29 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911...</section></main>';
      bindCommonNav();
      return;
    }
    if (room.status === 'waiting') {
      state.briefingShown = false;
      state.gameWorldActive = false;
      renderRoomWaiting(room);
      return;
    }
    if (room.status === 'running' || room.status === 'finished') {
      if (
        !state.briefingShown &&
        room.status === 'running' &&
        room.session &&
        !room.session.result
      ) {
        state.briefingShown = true;
        state.gameWorldActive = false;
        renderRoomWaiting(room);
        showBriefing(room, function () {
          state.gameWorldActive = true;
          renderGameWorld(room);
        });
        return;
      }
      state.gameWorldActive = true;
      renderGameWorld(room);
      return;
    }
    renderRoomWaiting(room);
  }

  function bindCommonNav() {
    bind('logout-btn', 'click', logout);
    bind('wallet-link-btn', 'click', function () {
      linkWalletWithSiwe();
    });
  }

  /* ─────────── RENDER ─────────── */
  function render() {
    var existingBriefing = document.querySelector('.briefing-overlay');
    if (existingBriefing && currentRoute().name !== 'room')
      existingBriefing.remove();
    if (!state.user) {
      renderAuth();
      return;
    }
    var route = currentRoute();
    if (route.name === 'room') return renderRoom(route.roomId);
    state.gameWorldActive = false;
    state.briefingShown = false;
    if (state.activeMiniGame && state.activeMiniGame.cleanup) {
      state.activeMiniGame.cleanup();
      state.activeMiniGame = null;
    }
    if (route.name === 'cards') return renderCards();
    if (route.name === 'leaderboard') return renderLeaderboard();
    if (route.name === 'admin') return renderAdmin();
    return renderLobby();
  }

  /* ─────────── TIMER LOOP ─────────── */
  function startCountdownLoop() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(function () {
      var timer = document.getElementById('gw-timer');
      if (timer) {
        var dl = parseInt(timer.getAttribute('data-deadline'), 10);
        if (dl) {
          var left = Math.max(0, (dl - serverNowMs()) / 1000);
          timer.textContent = left.toFixed(1) + 's';
          timer.classList.remove(
            'timer-critical',
            'timer-warn',
            'timer-danger'
          );
          if (left <= 5) {
            timer.classList.add('timer-danger');
            // Screen shake for last 5 seconds
            var gw = document.querySelector('.game-world');
            if (gw) gw.classList.add('screen-shake');
          } else if (left <= 10) {
            timer.classList.add('timer-critical');
          } else if (left <= 20) {
            timer.classList.add('timer-warn');
          }
          if (left > 5) {
            var gw2 = document.querySelector('.game-world');
            if (gw2) gw2.classList.remove('screen-shake');
          }

          var cue = '';
          var profile = presentationProfile(
            state.currentRoom && state.currentRoom.cardCode
          );
          var cueMap = (profile && profile.cues) || {};
          var cueLabel = '';
          if (left <= 3) cue = 'cue-3';
          else if (left <= 5) cue = 'cue-5';
          else if (left <= 10) cue = 'cue-10';
          if (left <= 3) cueLabel = cueMap['3'] || 'critical';
          else if (left <= 5) cueLabel = cueMap['5'] || 'danger';
          else if (left <= 10) cueLabel = cueMap['10'] || 'warn';
          timer.setAttribute('data-cue', cueLabel);
          if (cue !== lastTimerCue) {
            lastTimerCue = cue;
            var stage = document.querySelector('.game-world');
            if (stage) {
              stage.classList.remove('cue-10', 'cue-5', 'cue-3');
              if (cue) stage.classList.add(cue);
              stage.setAttribute('data-cue', cueLabel || '');
            }
          }
        }
      }
    }, 100);
  }

  window.addEventListener('hashchange', render);
  startCountdownLoop();
  ensureDeviceId();
  bootstrap();
})();
