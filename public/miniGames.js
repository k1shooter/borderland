(function () {
  function createCanvas(container, width, height) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'mini-game-wrapper';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.className = 'mini-game-canvas';
    const hud = document.createElement('div');
    hud.className = 'mini-game-hud';
    wrapper.appendChild(hud);
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);
    return { wrapper, canvas, ctx: canvas.getContext('2d'), hud };
  }

  function createButton(container, label) {
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = label;
    container.appendChild(button);
    return button;
  }

  function formatMs(ms) {
    return (ms / 1000).toFixed(1);
  }

  function drawText(ctx, text, x, y, color, size) {
    ctx.fillStyle = color || '#ffffff';
    ctx.font = `${size || 18}px Arial`;
    ctx.fillText(text, x, y);
  }

  function startLoop(tick, done) {
    let raf = null;
    let active = true;
    let last = performance.now();

    function loop(ts) {
      if (!active) return;
      const dt = ts - last;
      last = ts;
      const shouldContinue = tick(ts, dt);
      if (shouldContinue === false) {
        active = false;
        if (typeof done === 'function') done();
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return function stop() {
      active = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }

  function attachPointer(canvas, onMove) {
    function handler(event) {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches && event.touches[0] ? event.touches[0] : event;
      const x = (source.clientX - rect.left) * (canvas.width / rect.width);
      const y = (source.clientY - rect.top) * (canvas.height / rect.height);
      onMove(x, y);
    }
    canvas.addEventListener('mousemove', handler);
    canvas.addEventListener('touchmove', handler, { passive: true });
    canvas.addEventListener('touchstart', handler, { passive: true });
    return function cleanup() {
      canvas.removeEventListener('mousemove', handler);
      canvas.removeEventListener('touchmove', handler);
      canvas.removeEventListener('touchstart', handler);
    };
  }

  function attachKeys(map) {
    function onDown(event) {
      if (map[event.key]) map[event.key](event);
    }
    window.addEventListener('keydown', onDown);
    return function cleanup() {
      window.removeEventListener('keydown', onDown);
    };
  }

  function mountTargetHold(container, challenge, onComplete) {
    const seconds = challenge.seconds || 75;
    const { canvas, ctx, hud } = createCanvas(container, 760, 380);
    const start = performance.now();
    const pointer = { x: canvas.width / 2, y: canvas.height / 2 };
    let holdMs = 0;
    let outMs = 0;
    let maxOutMs = 0;
    let cleanupPointer = attachPointer(canvas, function (x, y) {
      pointer.x = x;
      pointer.y = y;
    });

    const stop = startLoop(function (ts, dt) {
      const elapsed = ts - start;
      const t = elapsed / 1000;
      const radius = 42 + Math.sin(t * 1.3) * 18 + Math.cos(t * 0.7) * 10;
      const cx = canvas.width / 2 + Math.sin(t * 0.8) * 220;
      const cy = canvas.height / 2 + Math.cos(t * 1.1) * 110;
      const distance = Math.hypot(pointer.x - cx, pointer.y - cy);
      const inside = distance <= radius;
      if (inside) {
        holdMs += dt;
        outMs = 0;
      } else {
        outMs += dt;
        maxOutMs = Math.max(maxOutMs, outMs);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0b0f15';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,0,70,0.2)';
      for (let i = 0; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i + (t * 60) % 40, 0);
        ctx.lineTo(i + (t * 60) % 40, canvas.height);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.fillStyle = 'rgba(80,220,180,0.18)';
      ctx.arc(cx, cy, Math.max(20, radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#55ffd6';
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = inside ? '#ffffff' : '#ff4d6d';
      ctx.arc(pointer.x, pointer.y, 8, 0, Math.PI * 2);
      ctx.fill();

      const ratio = holdMs / Math.max(1, elapsed);
      hud.innerHTML = `<div>체류율 <b>${(ratio * 100).toFixed(1)}%</b></div>
        <div>연속 이탈 최대 <b>${formatMs(maxOutMs)}초</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - t).toFixed(1)}초</b></div>`;

      if (elapsed >= seconds * 1000) {
        onComplete({ holdRatio: ratio, maxOutMs: Math.round(maxOutMs) });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupPointer();
      stop();
    };
  }

  function mountRhythm(container, challenge, onComplete) {
    const seconds = challenge.seconds || 90;
    const { canvas, ctx, hud } = createCanvas(container, 760, 300);
    const start = performance.now();
    const beats = [];
    let time = 1200;
    while (time < seconds * 1000) {
      const variation = 500 + Math.random() * 350;
      beats.push(time);
      time += variation;
    }
    let currentIndex = 0;
    let hits = 0;
    let combo = 0;
    let maxCombo = 0;
    let lateHits = 0;

    function press() {
      const elapsed = performance.now() - start;
      let bestIndex = -1;
      let bestDiff = Infinity;
      for (let i = currentIndex; i < beats.length; i += 1) {
        const diff = Math.abs(beats[i] - elapsed);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIndex = i;
        }
        if (beats[i] - elapsed > 260) break;
      }
      if (bestIndex >= 0 && bestDiff <= 220) {
        if (bestIndex === currentIndex) currentIndex += 1;
        hits += 1;
        combo += 1;
        maxCombo = Math.max(maxCombo, combo);
      } else {
        combo = 0;
      }
    }

    const cleanupKeys = attachKeys({
      ' ': function (event) { event.preventDefault(); press(); },
      Enter: function (event) { event.preventDefault(); press(); },
    });
    canvas.addEventListener('click', press);

    const stop = startLoop(function (ts) {
      const elapsed = ts - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111723';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#4ae3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();

      beats.forEach(function (beat, index) {
        const dx = canvas.width / 2 + (beat - elapsed) * 0.35;
        if (dx < -30 || dx > canvas.width + 30) return;
        ctx.beginPath();
        ctx.fillStyle = index < currentIndex ? '#4cff88' : '#ffb347';
        ctx.arc(dx, canvas.height / 2, 12, 0, Math.PI * 2);
        ctx.fill();
      });

      while (currentIndex < beats.length && elapsed - beats[currentIndex] > 250) {
        combo = 0;
        lateHits += 1;
        currentIndex += 1;
      }

      const accuracy = beats.length ? hits / beats.length : 0;
      hud.innerHTML = `<div>정확도 <b>${(accuracy * 100).toFixed(1)}%</b></div>
        <div>현재 콤보 <b>${combo}</b> / 최대 <b>${maxCombo}</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - elapsed / 1000).toFixed(1)}초</b></div>`;

      if (elapsed >= seconds * 1000) {
        onComplete({ accuracy, combo: maxCombo, hits, misses: lateHits });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupKeys();
      canvas.removeEventListener('click', press);
      stop();
    };
  }

  function makeRunnerGame(container, opts, onComplete) {
    const seconds = opts.seconds || 90;
    const gravityFlip = !!opts.gravityFlip;
    const memoryMode = !!opts.memoryMode;
    const { canvas, ctx, hud } = createCanvas(container, 780, 300);
    const player = { x: 90, y: 220, w: 28, h: 36, vy: 0, gravity: 0.85, jump: -12, grounded: false, duck: false };
    let inverted = false;
    let obstacles = [];
    let distance = 0;
    let crashes = 0;
    let gems = 0;
    let flashOn = true;
    const start = performance.now();

    function spawnObstacle() {
      const tall = Math.random() > 0.4;
      obstacles.push({
        x: canvas.width + 20,
        y: tall ? 220 : 245,
        w: tall ? 26 : 42,
        h: tall ? 40 : 15,
        type: tall ? 'pillar' : 'low',
      });
      if (Math.random() > 0.7) {
        obstacles.push({
          x: canvas.width + 110,
          y: inverted ? 60 : 180,
          w: 16,
          h: 16,
          gem: true,
        });
      }
    }

    const cleanupKeys = attachKeys({
      ' ': function (event) {
        event.preventDefault();
        if (!gravityFlip) {
          if (player.grounded) player.vy = inverted ? 12 : player.jump;
        } else {
          if (player.grounded) player.vy = inverted ? 12 : player.jump;
        }
      },
      ArrowDown: function () {
        player.duck = true;
      },
      Shift: function () {
        if (gravityFlip) inverted = !inverted;
      },
      g: function () {
        if (gravityFlip) inverted = !inverted;
      },
    });
    window.addEventListener('keyup', function onUp(event) {
      if (event.key === 'ArrowDown') player.duck = false;
    });

    let spawnTimer = 0;
    const stop = startLoop(function (ts, dt) {
      const elapsed = ts - start;
      const t = elapsed / 1000;
      spawnTimer += dt;
      if (spawnTimer > 900 - Math.min(500, elapsed / 6)) {
        spawnObstacle();
        spawnTimer = 0;
      }

      const groundY = inverted ? 40 : 220;
      player.gravity = inverted ? -0.85 : 0.85;
      player.vy += player.gravity;
      player.y += player.vy;
      const floor = groundY;
      const ceiling = inverted ? 220 : 40;
      if (!inverted) {
        if (player.y >= floor) { player.y = floor; player.vy = 0; player.grounded = true; } else { player.grounded = false; }
      } else {
        if (player.y <= floor) { player.y = floor; player.vy = 0; player.grounded = true; } else { player.grounded = false; }
      }

      obstacles.forEach(function (obs) {
        obs.x -= 4.5 + Math.min(6, elapsed / 15000);
      });
      obstacles = obstacles.filter(function (obs) { return obs.x + obs.w > -20; });

      obstacles.forEach(function (obs) {
        const playerH = player.duck ? 20 : player.h;
        const playerY = player.duck ? player.y + 16 : player.y;
        const hit = player.x < obs.x + obs.w && player.x + player.w > obs.x && playerY < obs.y + obs.h && playerY + playerH > obs.y;
        if (hit && !obs.hit) {
          obs.hit = true;
          if (obs.gem) {
            gems += 1;
          } else {
            crashes += 1;
          }
        }
      });

      flashOn = !memoryMode || Math.floor(elapsed / 900) % 2 === 0 || elapsed < 5000;
      distance += dt * 0.5;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0e131d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#182436';
      ctx.fillRect(0, inverted ? 0 : 260, canvas.width, 40);
      ctx.fillRect(0, inverted ? 260 : 0, canvas.width, 40);

      if (flashOn) {
        obstacles.forEach(function (obs) {
          ctx.fillStyle = obs.gem ? '#ffd85c' : '#ff6f61';
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
        });
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.fillStyle = inverted ? '#8ee3ff' : '#ffffff';
      const playerH = player.duck ? 20 : player.h;
      const playerY = player.duck ? player.y + 16 : player.y;
      ctx.fillRect(player.x, playerY, player.w, playerH);

      hud.innerHTML = `<div>거리 <b>${Math.floor(distance)}</b></div>
        <div>충돌 <b>${crashes}</b></div>
        <div>수집 <b>${gems}</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - t).toFixed(1)}초</b></div>`;

      if (elapsed >= seconds * 1000) {
        onComplete({
          distance: Math.floor(distance),
          crashes: crashes,
          score: Math.floor(distance + gems * 120 - crashes * 150),
          segmentsCleared: Math.floor(distance / 400),
        });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupKeys();
      stop();
    };
  }

  function mountVoiceBand(container, challenge, onComplete) {
    const seconds = challenge.seconds || 60;
    const { canvas, ctx, hud } = createCanvas(container, 760, 320);
    const start = performance.now();
    let currentVolume = 0.5;
    let bandTime = 0;
    let stream = null;
    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let keyboardMode = true;
    let peak = 0;

    function fallbackControls() {
      return attachKeys({
        ArrowUp: function () { currentVolume = Math.min(1, currentVolume + 0.05); },
        ArrowDown: function () { currentVolume = Math.max(0, currentVolume - 0.05); },
      });
    }

    let cleanupKeys = fallbackControls();

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (micStream) {
        stream = micStream;
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        dataArray = new Uint8Array(analyser.fftSize);
        source.connect(analyser);
        keyboardMode = false;
      }).catch(function () {
        keyboardMode = true;
      });
    }

    const stop = startLoop(function (ts, dt) {
      const elapsed = ts - start;
      const t = elapsed / 1000;
      const target = 0.5 + Math.sin(t * 1.4) * 0.2 + Math.cos(t * 0.6) * 0.1;

      if (analyser && dataArray) {
        analyser.getByteTimeDomainData(dataArray);
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i += 1) {
          const v = (dataArray[i] - 128) / 128;
          sumSq += v * v;
        }
        currentVolume = Math.min(1, Math.sqrt(sumSq / dataArray.length) * 4);
      } else if (keyboardMode) {
        currentVolume *= 0.98;
      }

      peak = Math.max(peak, currentVolume);
      const inBand = Math.abs(currentVolume - target) <= 0.09;
      if (inBand) bandTime += dt;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#121822';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#2a3040';
      ctx.fillRect(120, 40, 80, 220);
      ctx.fillStyle = '#4ae3ff';
      ctx.fillRect(120, 260 - currentVolume * 220, 80, currentVolume * 220);

      ctx.fillStyle = 'rgba(255,95,95,0.2)';
      ctx.fillRect(440, 260 - (target + 0.09) * 220, 80, 0.18 * 220);
      ctx.fillStyle = '#7bffb6';
      ctx.fillRect(440, 260 - target * 220, 80, 6);

      drawText(ctx, keyboardMode ? '마이크 미지원: ↑/↓ 대체 입력' : '마이크 활성', 60, 25, '#ffffff', 16);

      const bandRatio = bandTime / Math.max(1, elapsed);
      hud.innerHTML = `<div>유지율 <b>${(bandRatio * 100).toFixed(1)}%</b></div>
        <div>현재 볼륨 <b>${currentVolume.toFixed(2)}</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - t).toFixed(1)}초</b></div>`;

      if (elapsed >= seconds * 1000) {
        onComplete({ bandRatio, peak });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupKeys();
      stop();
      if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      if (audioContext && audioContext.close) audioContext.close();
    };
  }

  function mountMouseDodge(container, challenge, onComplete) {
    const seconds = challenge.seconds || 80;
    const { canvas, ctx, hud } = createCanvas(container, 760, 420);
    const pointer = { x: 80, y: 210 };
    const enemies = [];
    const cores = [
      { x: 650, y: 90, collected: false },
      { x: 670, y: 220, collected: false },
      { x: 620, y: 340, collected: false },
    ];
    let health = 100;
    const start = performance.now();
    const cleanupPointer = attachPointer(canvas, function (x, y) { pointer.x = x; pointer.y = y; });

    for (let i = 0; i < 6; i += 1) {
      enemies.push({
        x: Math.random() * 600 + 120,
        y: Math.random() * 360 + 30,
        vx: (Math.random() * 2 + 1) * (Math.random() > 0.5 ? 1 : -1),
        vy: (Math.random() * 2 + 1) * (Math.random() > 0.5 ? 1 : -1),
        r: 16 + Math.random() * 14,
      });
    }

    const stop = startLoop(function (ts, dt) {
      const elapsed = ts - start;
      const t = elapsed / 1000;
      enemies.forEach(function (enemy) {
        enemy.x += enemy.vx;
        enemy.y += enemy.vy;
        if (enemy.x < enemy.r || enemy.x > canvas.width - enemy.r) enemy.vx *= -1;
        if (enemy.y < enemy.r || enemy.y > canvas.height - enemy.r) enemy.vy *= -1;
        const hit = Math.hypot(pointer.x - enemy.x, pointer.y - enemy.y) < enemy.r + 8;
        if (hit) health -= dt * 0.05;
      });

      cores.forEach(function (core) {
        if (!core.collected && Math.hypot(pointer.x - core.x, pointer.y - core.y) < 18) core.collected = true;
      });

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#10151d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      enemies.forEach(function (enemy) {
        ctx.beginPath();
        ctx.fillStyle = '#ff5e7d';
        ctx.arc(enemy.x, enemy.y, enemy.r, 0, Math.PI * 2);
        ctx.fill();
      });

      cores.forEach(function (core) {
        ctx.beginPath();
        ctx.fillStyle = core.collected ? '#334' : '#7bffb6';
        ctx.arc(core.x, core.y, 12, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.arc(pointer.x, pointer.y, 8, 0, Math.PI * 2);
      ctx.fill();

      hud.innerHTML = `<div>체력 <b>${Math.max(0, health).toFixed(0)}</b></div>
        <div>코어 <b>${cores.filter(function (c) { return c.collected; }).length}/3</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - t).toFixed(1)}초</b></div>`;

      if (elapsed >= seconds * 1000 || health <= 0) {
        onComplete({ cores: cores.filter(function (c) { return c.collected; }).length, health: Math.max(0, Math.round(health)) });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupPointer();
      stop();
    };
  }

  function mountBalanceWire(container, challenge, onComplete) {
    const seconds = challenge.seconds || 60;
    const { canvas, ctx, hud } = createCanvas(container, 780, 320);
    const pointer = { x: 20, y: canvas.height / 2 };
    let stability = 100;
    const start = performance.now();
    const cleanupPointer = attachPointer(canvas, function (x, y) { pointer.x = x; pointer.y = y; });

    function wireY(x, t) {
      return canvas.height / 2 + Math.sin(x * 0.02 + t * 2) * 40 + Math.cos(x * 0.014 + t * 1.2) * 24;
    }

    const stop = startLoop(function (ts, dt) {
      const elapsed = ts - start;
      const t = elapsed / 1000;
      const progress = Math.min(1, elapsed / (seconds * 1000));
      const targetX = 20 + progress * (canvas.width - 40);
      const targetY = wireY(targetX, t);
      const dist = Math.hypot(pointer.x - targetX, pointer.y - targetY);
      stability -= Math.max(0, dist - 18) * 0.004 * dt;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111723';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.beginPath();
      for (let x = 0; x < canvas.width; x += 6) {
        const y = wireY(x, t);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#75f5ff';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = '#ffe082';
      ctx.arc(targetX, targetY, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.arc(pointer.x, pointer.y, 8, 0, Math.PI * 2);
      ctx.fill();

      hud.innerHTML = `<div>안정도 <b>${Math.max(0, stability).toFixed(0)}</b></div>
        <div>진행도 <b>${(progress * 100).toFixed(0)}%</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - t).toFixed(1)}초</b></div>`;

      if (elapsed >= seconds * 1000 || stability <= 0) {
        onComplete({ stability: Math.max(0, Math.round(stability)), complete: elapsed >= seconds * 1000 });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupPointer();
      stop();
    };
  }

  function mountAlternateMash(container, challenge, onComplete) {
    const seconds = challenge.seconds || 70;
    container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'mash-panel';
    const hud = document.createElement('div');
    hud.className = 'mini-game-hud';
    const left = createButton(panel, 'A');
    const right = createButton(panel, 'L');
    left.classList.add('ghost');
    right.classList.add('ghost');
    container.appendChild(hud);
    container.appendChild(panel);

    let charge = 0;
    let overheat = 0;
    let lastKey = '';
    let lastAt = 0;
    const start = performance.now();

    function tap(key) {
      const current = performance.now();
      if (lastKey && lastKey === key) {
        overheat += 1;
        charge = Math.max(0, charge - 4);
      } else {
        const delta = current - lastAt;
        charge += delta < 500 ? 3 : 2;
      }
      lastKey = key;
      lastAt = current;
    }

    left.addEventListener('click', function () { tap('A'); });
    right.addEventListener('click', function () { tap('L'); });
    const cleanupKeys = attachKeys({
      a: function () { tap('A'); },
      A: function () { tap('A'); },
      l: function () { tap('L'); },
      L: function () { tap('L'); },
    });

    const stop = startLoop(function (ts) {
      const elapsed = ts - start;
      const t = elapsed / 1000;
      hud.innerHTML = `<div>충전량 <b>${Math.round(charge)}</b></div>
        <div>과열 <b>${overheat}</b></div>
        <div>남은 시간 <b>${Math.max(0, seconds - t).toFixed(1)}초</b></div>`;
      if (elapsed >= seconds * 1000) {
        onComplete({ charge: Math.round(charge), overheat: overheat });
        return false;
      }
      return true;
    });

    return function cleanup() {
      cleanupKeys();
      stop();
    };
  }

  function mountGauntlet(container, challenge, onComplete) {
    const stages = [
      { title: '리듬', runner: function (node, done) { return mountRhythm(node, { seconds: 20 }, done); } },
      { title: '커서', runner: function (node, done) { return mountTargetHold(node, { seconds: 20 }, done); } },
      { title: '볼륨', runner: function (node, done) { return mountVoiceBand(node, { seconds: 20 }, done); } },
      { title: '중력 러너', runner: function (node, done) { return makeRunnerGame(node, { seconds: 25, gravityFlip: true }, done); } },
    ];
    let index = 0;
    const scoreBag = [];
    let activeCleanup = null;

    function scoreStage(metrics, stageTitle) {
      let score = 0;
      if (stageTitle === '리듬') score = Math.round((metrics.accuracy || 0) * 100 + (metrics.combo || 0));
      if (stageTitle === '커서') score = Math.round((metrics.holdRatio || 0) * 120 - (metrics.maxOutMs || 0) / 100);
      if (stageTitle === '볼륨') score = Math.round((metrics.bandRatio || 0) * 120);
      if (stageTitle === '중력 러너') score = Math.max(0, Math.round((metrics.score || 0) / 20));
      scoreBag.push(score);
    }

    function nextStage() {
      if (index >= stages.length) {
        const totalScore = scoreBag.reduce(function (acc, value) { return acc + value; }, 0);
        onComplete({ totalScore: totalScore, stageScores: scoreBag });
        return;
      }
      container.innerHTML = `<div class="gauntlet-title">${index + 1}/${stages.length} - ${stages[index].title}</div>`;
      const stageMount = document.createElement('div');
      container.appendChild(stageMount);
      activeCleanup = stages[index].runner(stageMount, function (metrics) {
        scoreStage(metrics, stages[index].title);
        index += 1;
        setTimeout(nextStage, 700);
      });
    }

    nextStage();
    return function cleanup() {
      if (activeCleanup) activeCleanup();
    };
  }

  function mountPhysicalChallenge(container, challenge, onComplete) {
    if (!challenge) return function noop() {};
    if (challenge.challengeType === 'target-hold') return mountTargetHold(container, challenge, onComplete);
    if (challenge.challengeType === 'rhythm') return mountRhythm(container, challenge, onComplete);
    if (challenge.challengeType === 'runner') return makeRunnerGame(container, { seconds: challenge.seconds }, onComplete);
    if (challenge.challengeType === 'voice-band') return mountVoiceBand(container, challenge, onComplete);
    if (challenge.challengeType === 'mouse-dodge') return mountMouseDodge(container, challenge, onComplete);
    if (challenge.challengeType === 'balance-wire') return mountBalanceWire(container, challenge, onComplete);
    if (challenge.challengeType === 'alternate-mash') return mountAlternateMash(container, challenge, onComplete);
    if (challenge.challengeType === 'memory-runner') return makeRunnerGame(container, { seconds: challenge.seconds, memoryMode: true }, onComplete);
    if (challenge.challengeType === 'gravity-runner') return makeRunnerGame(container, { seconds: challenge.seconds, gravityFlip: true }, onComplete);
    if (challenge.challengeType === 'gauntlet') return mountGauntlet(container, challenge, onComplete);
    container.innerHTML = '<div class="card">지원되지 않는 피지컬 챌린지</div>';
    return function noop() {};
  }

  window.BorderlandMiniGames = {
    mountPhysicalChallenge: mountPhysicalChallenge,
  };
})();
