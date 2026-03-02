(function () {
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
  };

  var root = document.getElementById('app');
  var toastRoot = document.getElementById('toast');
  var countdownTimer = null;

  function ensureDeviceId() {
    if (!state.deviceId) {
      state.deviceId = 'dev_' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem('borderland_device_id', state.deviceId);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function notify(message, kind) {
    var item = document.createElement('div');
    item.className = 'toast ' + (kind || 'info');
    item.textContent = message;
    toastRoot.appendChild(item);
    setTimeout(function () {
      item.classList.add('visible');
    }, 10);
    setTimeout(function () {
      item.classList.remove('visible');
      setTimeout(function () { item.remove(); }, 300);
    }, 3200);
  }

  function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          throw new Error(data.error || '요청 실패');
        }
        return data;
      });
    });
  }

  function currentRoute() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) return { name: 'lobby' };
    if (hash.startsWith('room/')) return { name: 'room', roomId: hash.split('/')[1] };
    return { name: hash };
  }

  function gameByCode(code) {
    return state.games.find(function (game) { return game.code === code; });
  }

  function playerName(players, id) {
    var player = (players || []).find(function (p) { return p.id === id; });
    return player ? player.username : id;
  }

  function roleCard(game) {
    if (!game) return '';
    var icon = { spade: '♠', club: '♣', diamond: '♦', heart: '♥' }[game.suit] || '?';
    return '<div class="suit-badge suit-' + game.suit + '">' + icon + ' ' + game.code + '</div>';
  }

  function connectSocket() {
    if (!state.token || !window.io) return;
    if (state.socket) state.socket.disconnect();
    state.socket = window.io({
      auth: {
        token: state.token,
        deviceId: state.deviceId,
      },
    });

    state.socket.on('connect_error', function (error) {
      notify(error.message || '실시간 연결 실패', 'error');
    });

    state.socket.on('rooms:update', function (rooms) {
      state.rooms = rooms;
      if (currentRoute().name === 'lobby' || currentRoute().name === 'room') render();
    });

    state.socket.on('room:update', function (room) {
      state.currentRoom = room;
      if (location.hash === '#room/' + room.id || currentRoute().name === 'room') {
        if (currentRoute().name !== 'room') location.hash = '#room/' + room.id;
        render();
      }
      refreshLeaderboard();
    });

    state.socket.on('auth:dead', function (payload) {
      notify(payload.reason || '사망 처리되었습니다.', 'error');
    });
  }

  function refreshLeaderboard() {
    api('/api/leaderboard').then(function (board) {
      state.leaderboard = board;
      if (currentRoute().name === 'leaderboard') render();
    }).catch(function () {});
  }

  function bootstrap() {
    ensureDeviceId();
    if (!state.token) {
      render();
      return Promise.resolve();
    }
    return api('/api/bootstrap').then(function (data) {
      state.user = data.user;
      state.games = data.games;
      state.rooms = data.rooms;
      state.leaderboard = data.leaderboard;
      state.rulebookMarkdown = data.rulebookMarkdown;
      state.lastBootstrapAt = Date.now();
      connectSocket();
      render();
    }).catch(function (error) {
      console.error(error);
      state.token = '';
      state.user = null;
      localStorage.removeItem('borderland_token');
      render();
    });
  }

  function login(username, password) {
    return api('/api/login', {
      method: 'POST',
      body: {
        username: username,
        password: password,
        deviceId: state.deviceId,
      },
    }).then(function (data) {
      state.token = data.token;
      localStorage.setItem('borderland_token', data.token);
      notify('로그인 성공');
      return bootstrap();
    }).catch(function (error) {
      notify(error.message, 'error');
    });
  }

  function register(username, password, walletAddress) {
    return api('/api/register', {
      method: 'POST',
      body: {
        username: username,
        password: password,
        walletAddress: walletAddress || '',
        deviceId: state.deviceId,
      },
    }).then(function (data) {
      state.token = data.token;
      localStorage.setItem('borderland_token', data.token);
      notify('회원가입 성공');
      return bootstrap();
    }).catch(function (error) {
      notify(error.message, 'error');
    });
  }

  function logout() {
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    state.token = '';
    state.user = null;
    state.currentRoom = null;
    localStorage.removeItem('borderland_token');
    location.hash = '#lobby';
    render();
  }

  function callSocket(event, payload) {
    return new Promise(function (resolve) {
      if (!state.socket) {
        resolve({ ok: false, error: '소켓 연결이 없습니다.' });
        return;
      }
      state.socket.emit(event, payload || {}, function (response) {
        resolve(response || { ok: false, error: '응답 없음' });
      });
    });
  }

  function renderNav(route) {
    if (!state.user) return '';
    var items = [
      { key: 'lobby', label: '로비' },
      { key: 'cards', label: '카드 룰북' },
      { key: 'leaderboard', label: '리더보드' },
    ];
    if (state.user.role === 'admin') items.push({ key: 'admin', label: '어드민' });
    return '<header class="topbar">' +
      '<div class="brand">BORDERLAND WEBAPP</div>' +
      '<nav class="nav">' + items.map(function (item) {
        return '<a class="nav-link ' + (route.name === item.key ? 'active' : '') + '" href="#' + item.key + '">' + item.label + '</a>';
      }).join('') + '</nav>' +
      '<div class="userbox"><span class="pill">' + escapeHtml(state.user.username) + '</span>' +
      '<span class="pill ' + (state.user.status === 'ALIVE' ? 'ok' : 'bad') + '">' + escapeHtml(state.user.status) + '</span>' +
      '<button id="logout-btn" class="ghost">로그아웃</button></div>' +
      '</header>';
  }

  function renderAuth() {
    root.innerHTML = '<div class="auth-shell">' +
      '<div class="auth-card">' +
      '<h1>BORDERLAND WEBAPP</h1>' +
      '<p>사망하면 같은 기기/IP/계정으로 재입장할 수 없는 데스게임 실시간 웹앱 프로토타입</p>' +
      '<div class="auth-grid">' +
      '<form id="login-form" class="card">' +
      '<h2>로그인</h2>' +
      '<label>아이디<input name="username" required /></label>' +
      '<label>비밀번호<input name="password" type="password" required /></label>' +
      '<button class="primary" type="submit">로그인</button>' +
      '</form>' +
      '<form id="register-form" class="card">' +
      '<h2>회원가입</h2>' +
      '<label>아이디<input name="username" required /></label>' +
      '<label>비밀번호<input name="password" type="password" required /></label>' +
      '<label>지갑 주소 (선택)<input name="walletAddress" /></label>' +
      '<button class="primary" type="submit">회원가입</button>' +
      '<div class="hint">어드민: admin / borderland-admin-2026!</div>' +
      '</form>' +
      '</div></div></div>';

    document.getElementById('login-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var fd = new FormData(event.target);
      login(fd.get('username'), fd.get('password'));
    });

    document.getElementById('register-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var fd = new FormData(event.target);
      register(fd.get('username'), fd.get('password'), fd.get('walletAddress'));
    });
  }

  function renderLobby() {
    var gameOptions = state.games.map(function (game) {
      return '<option value="' + game.code + '">' + game.code + ' - ' + escapeHtml(game.name) + '</option>';
    }).join('');
    var roomsHtml = state.rooms.length ? state.rooms.map(function (room) {
      return '<div class="room-card">' +
        '<div class="room-head">' +
        '<div><b>' + escapeHtml(room.name) + '</b><div class="muted">' + escapeHtml(room.cardCode + ' ' + room.cardName) + '</div></div>' +
        '<div class="pill">' + room.players.length + '명</div>' +
        '</div>' +
        '<div class="muted">상태: ' + escapeHtml(room.status) + ' / 최소 ' + room.minPlayers + ' / 최대 ' + room.maxPlayers + '</div>' +
        '<div class="room-players">' + room.players.map(function (player) {
          return '<span class="pill ' + (player.ready ? 'ok' : '') + '">' + escapeHtml(player.username) + (player.isBot ? ' BOT' : '') + '</span>';
        }).join(' ') + '</div>' +
        '<button class="primary join-room-btn" data-room-id="' + room.id + '">입장</button>' +
        '</div>';
    }).join('') : '<div class="card">생성된 방이 없습니다.</div>';

    root.innerHTML = renderNav(currentRoute()) +
      '<main class="page-grid">' +
      '<section class="card span-4">' +
      '<h2>방 만들기</h2>' +
      '<form id="create-room-form" class="stack">' +
      '<label>방 이름<input name="name" placeholder="예: 공개 테스트룸" /></label>' +
      '<label>카드 선택<select name="cardCode">' + gameOptions + '</select></label>' +
      (state.user.role === 'admin' ? '<label>테스트용 봇 수<input name="addBots" type="number" min="0" max="12" value="0" /></label>' : '') +
      '<button class="primary" type="submit">방 생성</button>' +
      '</form>' +
      '</section>' +
      '<section class="span-8">' +
      '<h2>대기 중인 방</h2>' + roomsHtml +
      '</section>' +
      '</main>';

    bindCommonNav();
    document.getElementById('create-room-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var fd = new FormData(event.target);
      callSocket('room:create', {
        name: fd.get('name'),
        cardCode: fd.get('cardCode'),
        addBots: fd.get('addBots') || 0,
      }).then(function (result) {
        if (!result.ok) {
          notify(result.error, 'error');
          return;
        }
        location.hash = '#room/' + result.roomId;
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.join-room-btn'), function (button) {
      button.addEventListener('click', function () {
        var roomId = button.getAttribute('data-room-id');
        callSocket('room:join', { roomId: roomId }).then(function (result) {
          if (!result.ok) return notify(result.error, 'error');
          location.hash = '#room/' + roomId;
        });
      });
    });
  }

  function renderCards() {
    var grouped = { spade: [], club: [], diamond: [], heart: [] };
    state.games.forEach(function (game) { grouped[game.suit].push(game); });
    root.innerHTML = renderNav(currentRoute()) +
      '<main class="page">' +
      '<section class="card"><h2>전체 카드 룰북</h2><p class="muted">게임 상세 규칙은 아래 카드와 하단 원문 룰북에서 확인할 수 있습니다.</p></section>' +
      Object.keys(grouped).map(function (suit) {
        return '<section class="card"><h3 class="section-title">' + { spade: '스페이드', club: '클로버', diamond: '다이아', heart: '하트' }[suit] + '</h3>' +
          '<div class="game-grid">' + grouped[suit].map(function (game) {
            return '<article class="game-card">' +
              roleCard(game) +
              '<h4>' + escapeHtml(game.name) + '</h4>' +
              '<div class="muted">난이도 ' + game.difficulty + ' / ' + game.players.min + '~' + game.players.max + '명 / ' + game.durationMin + '분</div>' +
              '<p>' + escapeHtml(game.summary) + '</p>' +
              '<details><summary>상세 규칙</summary>' +
              '<div class="muted"><b>목표:</b> ' + escapeHtml(game.objective) + '</div>' +
              '<div class="muted"><b>채팅:</b> ' + escapeHtml(game.chatPolicy) + '</div>' +
              '<ul>' + game.phases.map(function (phase) { return '<li>' + escapeHtml(phase) + '</li>'; }).join('') + '</ul>' +
              '<div class="rule-note"><b>구현 포인트</b><ul>' + game.implementationNotes.map(function (note) { return '<li>' + escapeHtml(note) + '</li>'; }).join('') + '</ul></div>' +
              '</details>' +
              '</article>';
          }).join('') + '</div></section>';
      }).join('') +
      '<section class="card"><details><summary>원문 룰북 보기</summary><pre class="rulebook-pre">' + escapeHtml(state.rulebookMarkdown) + '</pre></details></section>' +
      '</main>';
    bindCommonNav();
  }

  function renderLeaderboard() {
    root.innerHTML = renderNav(currentRoute()) +
      '<main class="page"><section class="card"><h2>리더보드</h2>' +
      '<table class="board"><thead><tr><th>#</th><th>유저</th><th>상태</th><th>카드 수</th><th>승리</th><th>사망</th><th>획득 카드</th></tr></thead><tbody>' +
      state.leaderboard.map(function (row, index) {
        return '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(row.username) + '</td><td>' + escapeHtml(row.status) + '</td><td>' + row.cards + '</td><td>' + row.wins + '</td><td>' + row.deaths + '</td><td class="small">' + escapeHtml((row.ownedCards || []).join(', ')) + '</td></tr>';
      }).join('') +
      '</tbody></table></section></main>';
    bindCommonNav();
  }

  function renderAdmin() {
    if (state.user.role !== 'admin') {
      location.hash = '#lobby';
      return;
    }
    root.innerHTML = renderNav(currentRoute()) +
      '<main class="page-grid">' +
      '<section class="card span-4">' +
      '<h2>사망 상태 해제</h2>' +
      '<form id="admin-reset-form" class="stack">' +
      '<label>유저명<input name="username" required /></label>' +
      '<button class="primary" type="submit">상태 해제</button>' +
      '</form>' +
      '<div class="hint">어드민은 모든 방에서 봇을 채워 최소 인원 없이도 테스트를 쉽게 할 수 있습니다.</div>' +
      '</section>' +
      '<section class="card span-8">' +
      '<h2>빠른 테스트 카드</h2>' +
      '<div class="game-grid">' + state.games.map(function (game) {
        return '<button class="ghost quick-room-btn" data-card="' + game.code + '">' + game.code + ' ' + escapeHtml(game.name) + '</button>';
      }).join('') + '</div>' +
      '</section>' +
      '</main>';

    bindCommonNav();
    document.getElementById('admin-reset-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var fd = new FormData(event.target);
      api('/api/admin/reset-user', {
        method: 'POST',
        body: { username: fd.get('username') },
      }).then(function () {
        notify('상태 해제 완료');
        refreshLeaderboard();
      }).catch(function (error) { notify(error.message, 'error'); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.quick-room-btn'), function (button) {
      button.addEventListener('click', function () {
        callSocket('room:create', {
          name: 'ADMIN TEST ' + button.getAttribute('data-card'),
          cardCode: button.getAttribute('data-card'),
          addBots: 10,
        }).then(function (result) {
          if (!result.ok) return notify(result.error, 'error');
          location.hash = '#room/' + result.roomId;
        });
      });
    });
  }

  function renderFormField(field, view) {
    var labelForOption = function (value) {
      if (typeof value === 'string' && value.length > 16 && view.players) return playerName(view.players, value);
      return value;
    };

    if (field.type === 'text') return '<label>' + escapeHtml(field.label || field.field) + '<input name="' + field.field + '" placeholder="' + escapeHtml(field.placeholder || '') + '" /></label>';
    if (field.type === 'textarea') return '<label>' + escapeHtml(field.label || field.field) + '<textarea name="' + field.field + '" rows="5"></textarea></label>';
    if (field.type === 'number') return '<label>' + escapeHtml(field.label || field.field) + '<input name="' + field.field + '" type="number" min="' + field.min + '" max="' + field.max + '" value="' + (field.min || 0) + '" /></label>';
    if (field.type === 'select') return '<label>' + escapeHtml(field.label || field.field) + '<select name="' + field.field + '">' + field.options.map(function (opt) {
      return '<option value="' + escapeHtml(opt) + '">' + escapeHtml(labelForOption(opt)) + '</option>';
    }).join('') + '</select></label>';
    if (field.type === 'radio') return '<div class="field-group"><span>' + escapeHtml(field.label || field.field) + '</span><div class="inline-wrap">' + field.options.map(function (opt) {
      return '<label class="radio-pill"><input type="radio" name="' + field.field + '" value="' + escapeHtml(opt) + '" ' + (opt === field.options[0] ? 'checked' : '') + ' />' + escapeHtml(labelForOption(opt)) + '</label>';
    }).join('') + '</div></div>';
    if (field.type === 'multi-select') return '<div class="field-group"><span>' + escapeHtml(field.label || field.field) + '</span>' + field.options.map(function (opt) {
      return '<label class="check-pill"><input type="checkbox" name="' + field.field + '" value="' + escapeHtml(opt) + '" />' + escapeHtml(opt) + '</label>';
    }).join('') + '</div>';
    if (field.type === 'sequence') {
      return '<div class="field-group"><span>' + escapeHtml(field.label || '순서') + '</span>' +
        field.items.map(function (_, idx) {
          return '<select name="' + field.field + '_' + idx + '">' + field.items.map(function (opt) {
            return '<option value="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '</option>';
          }).join('') + '</select>';
        }).join('') + '</div>';
    }
    if (field.type === 'digit-sequence') {
      return '<div class="field-group"><span>' + escapeHtml(field.label || '코드') + '</span>' +
        Array.from({ length: field.length }).map(function (_, idx) {
          return '<input class="digit-input" name="' + field.field + '_' + idx + '" type="number" min="' + field.min + '" max="' + field.max + '" value="' + field.min + '" />';
        }).join('') + '</div>';
    }
    if (field.type === 'compound') return field.fields.map(function (inner) { return renderFormField(inner, view); }).join('');
    if (field.type === 'hand-select') {
      return '<div class="field-group"><span>전달할 카드</span><div class="inline-wrap">' + field.cards.map(function (card, idx) {
        return '<label class="radio-pill"><input type="radio" name="' + field.field + '" value="' + idx + '" ' + (idx === 0 ? 'checked' : '') + ' />' + card + '</label>';
      }).join('') + '</div></div>';
    }
    if (field.type === 'grid') {
      return '<div class="field-group"><span>출구 선택</span><div class="grid-3x3">' + field.options.map(function (opt) {
        return '<label class="grid-cell"><input type="radio" name="' + field.field + '" value="' + opt + '" ' + (opt === field.options[0] ? 'checked' : '') + ' />' + (parseInt(opt, 10) + 1) + '</label>';
      }).join('') + '</div></div>';
    }
    if (field.type === 'distribution') {
      return '<div class="field-group"><span>총 ' + field.total + ' 토큰 분배</span><div class="stack compact">' + field.targets.map(function (target) {
        return '<label>' + escapeHtml(labelForOption(target)) + '<input type="number" min="0" max="' + field.total + '" name="' + field.field + '_' + target + '" value="0" /></label>';
      }).join('') + '</div></div>';
    }
    if (field.type === 'multi-number') {
      return '<div class="field-group"><span>' + escapeHtml(field.label || '숫자 선택') + '</span>' +
        Array.from({ length: field.count }).map(function (_, idx) {
          return '<input class="digit-input" name="' + field.field + '_' + idx + '" type="number" min="' + field.min + '" max="' + field.max + '" value="' + field.min + '" />';
        }).join('') + '</div>';
    }
    if (field.type === 'vote-entries') {
      return '<div class="field-group"><span>투표</span>' + field.entries.map(function (entry, idx) {
        return '<label class="entry-card"><input type="radio" name="' + field.field + '" value="' + escapeHtml(entry.id) + '" ' + (idx === 0 ? 'checked' : '') + ' /><span>' + escapeHtml(entry.text) + '</span></label>';
      }).join('') + '</div>';
    }
    if (field.type === 'radio-index') {
      return '<div class="field-group"><span>' + escapeHtml(field.label || field.field) + '</span>' + field.options.map(function (opt, idx) {
        return '<label class="entry-card"><input type="radio" name="' + field.field + '" value="' + idx + '" ' + (idx === 0 ? 'checked' : '') + ' /><span>' + escapeHtml(opt) + '</span></label>';
      }).join('') + '</div>';
    }
    if (field.type === 'distribution-animal') {
      return '<div class="field-group"><span>총 5마리 배치</span><div class="stack compact">' + field.targets.map(function (animal) {
        return '<label>' + escapeHtml(animal) + '<input type="number" min="0" max="5" name="' + field.field + '_' + animal + '" value="0" /></label>';
      }).join('') + '</div></div>';
    }
    if (field.type === 'animal-claim') {
      if (field.first) {
        return '<div class="field-group"><label>동물<select name="animal">' + field.animals.map(function (animal) { return '<option value="' + escapeHtml(animal) + '">' + escapeHtml(animal) + '</option>'; }).join('') + '</select></label>' +
          '<label>마리 수<input type="number" name="count" min="1" max="12" value="1" /></label></div>';
      }
      return '<div class="field-group"><label>상향 수치<input type="number" name="count" min="' + field.min + '" max="12" value="' + field.min + '" /></label>' +
        '<div class="inline-wrap"><label class="radio-pill"><input type="radio" name="mode" value="raise" checked />상향 선언</label><label class="radio-pill"><input type="radio" name="mode" value="judge" />심판</label></div></div>';
    }
    if (field.type === 'switches') {
      return '<div class="field-group"><span>스위치</span>' + field.switches.map(function (sw) {
        return '<label class="check-pill"><input type="checkbox" name="' + field.field + '_' + sw + '" value="1" />' + escapeHtml(sw) + '</label>';
      }).join('') + '</div>';
    }
    if (field.type === 'sync-press') {
      return '<button type="button" id="sync-press-btn" class="primary huge">지금 누르기</button>';
    }
    if (field.type === 'physical') {
      return '<div id="physical-host" class="physical-host"></div>';
    }
    return '<div class="muted">지원되지 않는 입력 형식</div>';
  }

  function collectFormPayload(formDef, formNode) {
    if (!formDef) return {};
    if (formDef.type === 'text' || formDef.type === 'textarea' || formDef.type === 'number' || formDef.type === 'select') {
      return Object.fromEntries([[formDef.field, formNode.querySelector('[name="' + formDef.field + '"]').value]]);
    }
    if (formDef.type === 'radio') {
      var radio = formNode.querySelector('[name="' + formDef.field + '"]:checked');
      return Object.fromEntries([[formDef.field, radio ? radio.value : formDef.options[0]]]);
    }
    if (formDef.type === 'multi-select') {
      var values = Array.prototype.map.call(formNode.querySelectorAll('[name="' + formDef.field + '"]:checked'), function (input) { return input.value; });
      return Object.fromEntries([[formDef.field, values]]);
    }
    if (formDef.type === 'sequence') {
      var arr = formDef.items.map(function (_, idx) { return formNode.querySelector('[name="' + formDef.field + '_' + idx + '"]').value; });
      return Object.fromEntries([[formDef.field, arr]]);
    }
    if (formDef.type === 'digit-sequence') {
      var digits = Array.from({ length: formDef.length }).map(function (_, idx) {
        return parseInt(formNode.querySelector('[name="' + formDef.field + '_' + idx + '"]').value, 10) || formDef.min;
      });
      return Object.fromEntries([[formDef.field, digits]]);
    }
    if (formDef.type === 'compound') {
      var output = {};
      formDef.fields.forEach(function (field) {
        Object.assign(output, collectFormPayload(field, formNode));
      });
      return output;
    }
    if (formDef.type === 'hand-select') {
      var cardRadio = formNode.querySelector('[name="' + formDef.field + '"]:checked');
      return { cardIndex: parseInt(cardRadio.value, 10) || 0 };
    }
    if (formDef.type === 'grid') {
      return { cell: parseInt((formNode.querySelector('[name="' + formDef.field + '"]:checked') || {}).value, 10) || 0 };
    }
    if (formDef.type === 'distribution') {
      var dist = {};
      formDef.targets.forEach(function (target) {
        dist[target] = parseInt(formNode.querySelector('[name="' + formDef.field + '_' + CSS.escape(target) + '"]').value, 10) || 0;
      });
      return Object.fromEntries([[formDef.field, dist]]);
    }
    if (formDef.type === 'multi-number') {
      var nums = Array.from({ length: formDef.count }).map(function (_, idx) {
        return parseInt(formNode.querySelector('[name="' + formDef.field + '_' + idx + '"]').value, 10) || formDef.min;
      });
      return Object.fromEntries([[formDef.field, nums]]);
    }
    if (formDef.type === 'vote-entries') {
      return { target: (formNode.querySelector('[name="' + formDef.field + '"]:checked') || {}).value };
    }
    if (formDef.type === 'radio-index') {
      return { claimIndex: parseInt((formNode.querySelector('[name="' + formDef.field + '"]:checked') || {}).value, 10) || 0 };
    }
    if (formDef.type === 'distribution-animal') {
      var bag = {};
      formDef.targets.forEach(function (animal) {
        bag[animal] = parseInt(formNode.querySelector('[name="' + formDef.field + '_' + CSS.escape(animal) + '"]').value, 10) || 0;
      });
      return { bag: bag };
    }
    if (formDef.type === 'animal-claim') {
      if (formDef.first) return { animal: formNode.querySelector('[name="animal"]').value, count: parseInt(formNode.querySelector('[name="count"]').value, 10) || 1 };
      return {
        mode: (formNode.querySelector('[name="mode"]:checked') || {}).value || 'raise',
        count: parseInt(formNode.querySelector('[name="count"]').value, 10) || formDef.min,
      };
    }
    if (formDef.type === 'switches') {
      var switches = {};
      formDef.switches.forEach(function (sw) {
        switches[sw] = formNode.querySelector('[name="' + formDef.field + '_' + sw + '"]').checked ? 1 : 0;
      });
      return Object.fromEntries([[formDef.field, switches]]);
    }
    return {};
  }

  function renderSession(session) {
    if (!session) {
      return '<div class="card"><h3>대기 중</h3><p>아직 게임이 시작되지 않았습니다.</p></div>';
    }
    if (session.result) {
      return '<div class="card result-card">' +
        '<h3>게임 종료</h3>' +
        '<p>' + escapeHtml(session.result.summary || '') + '</p>' +
        '<div class="inline-wrap">' + (session.result.winners || []).map(function (id) {
          return '<span class="pill ok">' + escapeHtml(playerName(session.players, id)) + '</span>';
        }).join(' ') + '</div>' +
        '<div class="log-box">' + (session.log || []).map(function (line) { return '<div>' + escapeHtml(line) + '</div>'; }).join('') + '</div>' +
        '</div>';
    }

    var formHtml = '';
    if (session.form) {
      if (session.form.type === 'sync-press') {
        formHtml = renderFormField(session.form, session);
      } else if (session.form.type === 'physical') {
        formHtml = renderFormField(session.form, session) + '<div class="muted">피지컬 결과는 완료 시 자동 제출됩니다.</div>';
      } else {
        formHtml = '<form id="session-form" class="stack">' +
          renderFormField(session.form, session) +
          '<button class="primary" type="submit">제출</button></form>';
      }
    } else {
      formHtml = '<div class="muted">현재 입력할 차례가 아니거나, 자동 처리 중입니다.</div>';
    }

    var privateHtml = '';
    if (session.privateData) {
      privateHtml = '<div class="private-box">' + Object.keys(session.privateData).map(function (key) {
        var value = session.privateData[key];
        var content = Array.isArray(value) ? value.join(', ') : (typeof value === 'object' ? JSON.stringify(value) : String(value));
        return '<div><b>' + escapeHtml(key) + ':</b> ' + escapeHtml(content) + '</div>';
      }).join('') + '</div>';
    }

    return '<div class="card session-card">' +
      '<div class="session-head">' +
      '<div><h3>' + escapeHtml(session.cardCode + ' ' + session.gameName) + '</h3><div class="muted">' + escapeHtml(session.phase) + '</div></div>' +
      '<div class="pill deadline" data-deadline="' + (session.deadline || '') + '"></div>' +
      '</div>' +
      privateHtml +
      '<div class="public-box">' + renderPublicData(session) + '</div>' +
      formHtml +
      '<div class="log-box">' + (session.log || []).map(function (line) { return '<div>' + escapeHtml(line) + '</div>'; }).join('') + '</div>' +
      '</div>';
  }

  function renderPublicData(session) {
    var data = session.publicData || {};
    var html = '';
    if (data.question) html += '<div><b>질문:</b> ' + escapeHtml(data.question) + '</div>';
    if (data.sample) html += '<div><b>공개 표본:</b> ' + escapeHtml(data.sample.join(', ')) + '</div>';
    if (data.entities) html += '<div><b>정렬 대상:</b> ' + escapeHtml(data.entities.join(', ')) + '</div>';
    if (data.clues) html += '<div><b>단서:</b><ul>' + data.clues.map(function (clue) { return '<li>' + escapeHtml(clue) + '</li>'; }).join('') + '</ul></div>';
    if (data.statements) html += '<div><b>진술:</b><ul>' + data.statements.map(function (st) { return '<li>' + escapeHtml(st) + '</li>'; }).join('') + '</ul></div>';
    if (data.puzzle && data.puzzle.clue) html += '<div><b>퍼즐 단서:</b> ' + escapeHtml(data.puzzle.clue) + '</div>';
    if (data.puzzle && data.puzzle.text) html += '<div><b>회로 규칙:</b><ul>' + data.puzzle.text.map(function (line) { return '<li>' + escapeHtml(line) + '</li>'; }).join('') + '</ul></div>';
    if (data.teamWins) html += '<div><b>팀 승수:</b> A ' + data.teamWins.A + ' / B ' + data.teamWins.B + '</div>';
    if (data.currentClaim) html += '<div><b>현재 선언:</b> ' + escapeHtml(data.currentClaim.animal + ' ' + data.currentClaim.count + '마리 이상') + '</div>';
    if (data.entries) html += '<div><b>익명 자기소개서:</b></div>';
    if (data.claims) {
      html += '<div><b>공개 진술:</b><ul>' + Object.keys(data.claims).map(function (id) {
        return '<li>' + escapeHtml(playerName(session.players, id) + ': ' + data.claims[id]) + '</li>';
      }).join('') + '</ul></div>';
    }
    if (!html) html = '<div class="muted">공개 데이터가 없습니다.</div>';
    return html;
  }

  function renderRoom(roomId) {
    var room = state.currentRoom;
    if (!room || room.id !== roomId) {
      var localRoom = state.rooms.find(function (item) { return item.id === roomId; });
      if (localRoom) {
        callSocket('room:join', { roomId: roomId }).then(function (result) {
          if (!result.ok) notify(result.error, 'error');
        });
      }
      root.innerHTML = renderNav(currentRoute()) + '<main class="page"><section class="card">방 정보를 불러오는 중입니다.</section></main>';
      bindCommonNav();
      return;
    }

    var isHost = room.hostId === state.user.id;
    var game = room.card || gameByCode(room.cardCode);
    var canChat = !room.session || room.session.chatEnabled;
    root.innerHTML = renderNav(currentRoute()) +
      '<main class="page-grid">' +
      '<section class="card span-3">' +
      '<div class="room-title">' + roleCard(game) + '<h2>' + escapeHtml(room.name) + '</h2></div>' +
      '<div class="muted">' + escapeHtml(game.code + ' - ' + game.name) + '</div>' +
      '<div class="stack compact"><div>상태: <b>' + escapeHtml(room.status) + '</b></div>' +
      '<div>방장: <b>' + escapeHtml(playerName(room.players, room.hostId)) + '</b></div>' +
      '<div>인원: <b>' + room.players.length + '</b> / 최소 ' + game.players.min + ' / 최대 ' + game.players.max + '</div></div>' +
      '<div class="player-list">' + room.players.map(function (player) {
        return '<div class="player-row ' + (player.alive ? '' : 'dead') + '">' +
          '<span>' + escapeHtml(player.username) + (player.isBot ? ' [BOT]' : '') + '</span>' +
          '<span class="pill ' + (player.ready ? 'ok' : '') + '">' + (player.ready ? 'READY' : (player.alive ? 'WAIT' : 'OUT')) + '</span>' +
          '</div>';
      }).join('') + '</div>' +
      '<div class="inline-wrap">' +
      '<button id="leave-room-btn" class="ghost">방 나가기</button>' +
      (room.status === 'waiting' ? '<button id="ready-room-btn" class="primary">준비 토글</button>' : '') +
      (room.status === 'waiting' && isHost ? '<button id="start-room-btn" class="primary">게임 시작</button>' : '') +
      '</div>' +
      (room.status === 'waiting' && isHost ? '<form id="room-card-select-form" class="stack compact"><label>카드 변경<select name="cardCode">' + state.games.map(function (item) {
        return '<option value="' + item.code + '" ' + (item.code === room.cardCode ? 'selected' : '') + '>' + item.code + ' ' + escapeHtml(item.name) + '</option>';
      }).join('') + '</select></label>' +
      (state.user.role === 'admin' ? '<label>봇 추가<input name="count" type="number" min="0" max="12" value="0" /></label><button class="ghost" type="button" id="fill-bot-btn">봇 추가</button>' : '') +
      '</form>' : '') +
      '</section>' +
      '<section class="span-5">' + renderSession(room.session) + '</section>' +
      '<section class="card span-4">' +
      '<h3>실시간 채팅</h3>' +
      '<div id="chat-log" class="chat-log">' + room.chat.map(function (message) {
        return '<div class="chat-line ' + (message.system ? 'system' : '') + '"><b>' + escapeHtml(message.user) + '</b> ' + escapeHtml(message.text) + '</div>';
      }).join('') + '</div>' +
      '<form id="chat-form" class="inline-form">' +
      '<input name="text" ' + (canChat ? '' : 'disabled') + ' placeholder="' + (canChat ? '메시지 입력' : '현재 채팅 불가') + '" />' +
      '<button class="primary" type="submit" ' + (canChat ? '' : 'disabled') + '>전송</button>' +
      '</form>' +
      '</section>' +
      '</main>';

    bindCommonNav();
    bindRoomActions(room);
    activateSessionUI(room);
  }

  function bindRoomActions(room) {
    document.getElementById('leave-room-btn').addEventListener('click', function () {
      callSocket('room:leave').then(function () {
        state.currentRoom = null;
        location.hash = '#lobby';
      });
    });
    var readyButton = document.getElementById('ready-room-btn');
    if (readyButton) {
      readyButton.addEventListener('click', function () {
        var me = room.players.find(function (p) { return p.id === state.user.id; });
        callSocket('room:ready', { ready: !(me && me.ready) }).then(function (result) {
          if (!result.ok) notify(result.error, 'error');
        });
      });
    }
    var startButton = document.getElementById('start-room-btn');
    if (startButton) {
      startButton.addEventListener('click', function () {
        callSocket('room:start').then(function (result) {
          if (!result.ok) notify(result.error, 'error');
        });
      });
    }
    var cardForm = document.getElementById('room-card-select-form');
    if (cardForm) {
      cardForm.addEventListener('change', function () {
        var fd = new FormData(cardForm);
        callSocket('room:select-card', { cardCode: fd.get('cardCode') }).then(function (result) {
          if (!result.ok) notify(result.error, 'error');
        });
      });
      var fillBtn = document.getElementById('fill-bot-btn');
      if (fillBtn) {
        fillBtn.addEventListener('click', function () {
          var fd = new FormData(cardForm);
          callSocket('room:fill-bots', { count: fd.get('count') }).then(function (result) {
            if (!result.ok) notify(result.error, 'error');
          });
        });
      }
    }
    var chatForm = document.getElementById('chat-form');
    if (chatForm) {
      chatForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var fd = new FormData(chatForm);
        var text = fd.get('text');
        if (!text) return;
        callSocket('room:chat', { text: text }).then(function (result) {
          if (!result.ok) notify(result.error, 'error');
          else chatForm.reset();
        });
      });
    }
  }

  function activateSessionUI(room) {
    var session = room.session;
    if (!session || session.result) {
      if (state.activeMiniGame && state.activeMiniGame.cleanup) {
        state.activeMiniGame.cleanup();
        state.activeMiniGame = null;
      }
      return;
    }
    var countdown = document.querySelector('[data-deadline]');
    if (countdown) updateDeadlineBadge(countdown);

    if (session.form && session.form.type === 'sync-press') {
      var pressBtn = document.getElementById('sync-press-btn');
      if (pressBtn) {
        pressBtn.addEventListener('click', function () {
          callSocket('game:submit', { pressed: true }).then(function (result) {
            if (!result.ok) notify(result.error, 'error');
            pressBtn.disabled = true;
            pressBtn.textContent = '입력 완료';
          });
        });
      }
      return;
    }

    if (session.form && session.form.type === 'physical') {
      var host = document.getElementById('physical-host');
      if (!host) return;
      var key = session.sessionId + ':' + session.form.challenge.challengeType;
      if (state.activeMiniGame && state.activeMiniGame.key === key) return;
      if (state.activeMiniGame && state.activeMiniGame.cleanup) state.activeMiniGame.cleanup();
      state.activeMiniGame = {
        key: key,
        cleanup: window.BorderlandMiniGames.mountPhysicalChallenge(host, session.form.challenge, function (metrics) {
          callSocket('game:submit', { metrics: metrics }).then(function (result) {
            if (!result.ok) notify(result.error, 'error');
            else {
              host.innerHTML = '<div class="card">결과 제출 완료. 다른 플레이어를 기다리는 중...</div>';
            }
          });
        }),
      };
      return;
    }

    var form = document.getElementById('session-form');
    if (form && session.form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var payload = collectFormPayload(session.form, form);
        callSocket('game:submit', payload).then(function (result) {
          if (!result.ok) notify(result.error, 'error');
        });
      });
    }
  }

  function updateDeadlineBadge(node) {
    if (!node) return;
    var deadline = parseInt(node.getAttribute('data-deadline'), 10);
    if (!deadline) {
      node.textContent = '';
      return;
    }
    var left = Math.max(0, deadline - Date.now());
    node.textContent = (left / 1000).toFixed(1) + 's';
  }

  function bindCommonNav() {
    var logoutButton = document.getElementById('logout-btn');
    if (logoutButton) logoutButton.addEventListener('click', logout);
  }

  function render() {
    if (!state.user) {
      renderAuth();
      return;
    }
    var route = currentRoute();
    if (route.name === 'room') return renderRoom(route.roomId);
    if (route.name === 'cards') return renderCards();
    if (route.name === 'leaderboard') return renderLeaderboard();
    if (route.name === 'admin') return renderAdmin();
    return renderLobby();
  }

  function startCountdownLoop() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-deadline]'), function (node) {
        updateDeadlineBadge(node);
      });
    }, 100);
  }

  window.addEventListener('hashchange', render);
  startCountdownLoop();
  ensureDeviceId();
  bootstrap();
})();
