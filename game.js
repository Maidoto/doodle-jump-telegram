(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const mapVideo = document.getElementById("mapVideo");

  const startOverlay = document.getElementById("startOverlay");
  const gameOverOverlay = document.getElementById("gameOverOverlay");
  const startButton = document.getElementById("startButton");
  const restartButton = document.getElementById("restartButton");
  const scoreValue = document.getElementById("scoreValue");
  const bestValue = document.getElementById("bestValue");
  const finalScore = document.getElementById("finalScore");
  const playerName = document.getElementById("playerName");
  const statsButton = document.getElementById("statsButton");
  const statsAfterGameButton = document.getElementById("statsAfterGameButton");
  const statsOverlay = document.getElementById("statsOverlay");
  const closeStatsButton = document.getElementById("closeStatsButton");
  const statsStatus = document.getElementById("statsStatus");
  const statBest = document.getElementById("statBest");
  const statGames = document.getElementById("statGames");
  const statHits = document.getElementById("statHits");
  const statRank = document.getElementById("statRank");
  const leaderboardList = document.getElementById("leaderboardList");

  const leftButton = document.getElementById("leftButton");
  const rightButton = document.getElementById("rightButton");
  const shootButton = document.getElementById("shootButton");

  const assetPaths = {
    player: "./assets/player.png",
    playerShoot: "./assets/player-shoot.png",
    enemy: "./assets/enemy.png",
    projectile: "./assets/projectile.png",
    background: "./assets/background.png",
  };

  const soundPaths = {
    music: "./assets/sounds/music.mp3",
    shoot: "./assets/sounds/shoot.mp3",
    hit: "./assets/sounds/hit.mp3",
    jump: "./assets/sounds/jump.mp3",
    gameOver: "./assets/sounds/game-over.mp3",
  };

  const images = Object.fromEntries(
    Object.entries(assetPaths).map(([key, src]) => [key, loadImage(src)])
  );

  const sounds = Object.fromEntries(
    Object.entries(soundPaths).map(([key, src]) => [key, loadSound(src)])
  );

  const audioState = {
    enabled: false,
  };

  const view = {
    cssW: 420,
    cssH: 740,
    dpr: 1,
    worldW: 420,
    offsetX: 0,
  };

  const input = {
    left: false,
    right: false,
    shoot: false,
  };

  const keys = new Set();
  const telegram = initTelegram();
  const statsClient = createStatsClient(telegram);

  let statsSnapshot = null;

  const state = {
    mode: "ready",
    lastTime: 0,
    cameraY: 0,
    startY: 0,
    highestY: 0,
    score: 0,
    best: readBestScore(),
    topGeneratedY: 0,
    lastPlatform: null,
    lastEnemyY: 0,
    session: createSessionStats(),
    statsSubmitPending: false,
    player: createPlayer(),
    platforms: [],
    enemies: [],
    bullets: [],
    particles: [],
  };

  let mapVideoReady = false;

  bestValue.textContent = String(state.best);
  playerName.textContent = getDisplayName(telegram.user);
  applyTelegramTheme();

  mapVideo.addEventListener("loadeddata", () => {
    mapVideoReady = true;
    mapVideo.play().catch(() => {});
  });

  mapVideo.addEventListener("error", () => {
    mapVideoReady = false;
  });

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", startGame);
  statsButton.addEventListener("click", openStats);
  statsAfterGameButton.addEventListener("click", openStats);
  closeStatsButton.addEventListener("click", closeStats);
  statsOverlay.addEventListener("pointerdown", (event) => {
    if (event.target === statsOverlay) closeStats();
  });
  canvas.addEventListener("pointerdown", handleCanvasPointer);

  bindHoldButton(leftButton, "left");
  bindHoldButton(rightButton, "right");
  bindShootButton(shootButton);

  resize();
  resetGame();
  loadStats();
  requestAnimationFrame(loop);

  function loadImage(src) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    return img;
  }

  function loadSound(src) {
    const elements = Array.from({ length: 4 }, () => {
      const audio = new Audio(src);
      audio.preload = "auto";
      return audio;
    });

    return {
      elements,
      index: 0,
    };
  }

  function unlockAudio() {
    audioState.enabled = true;

    for (const [name, sound] of Object.entries(sounds)) {
      if (name === "music") continue;

      for (const audio of sound.elements) {
        try {
          audio.load();
          audio.volume = 0;
          const warmup = audio.play();
          if (warmup) {
            warmup
              .then(() => {
                audio.pause();
                audio.currentTime = 0;
                audio.volume = 1;
              })
              .catch(() => {
                audio.volume = 1;
              });
          }
        } catch {
          audio.volume = 1;
        }
      }
    }
  }

  function startMusic() {
    if (!audioState.enabled) return;

    const music = sounds.music.elements[0];
    music.loop = true;
    music.volume = 0.22;
    music.play().catch(() => {});
  }

  function stopMusic() {
    const music = sounds.music.elements[0];
    music.pause();
    music.currentTime = 0;
  }

  function playSound(name, volume = 1) {
    if (!audioState.enabled) return;

    const sound = sounds[name];
    if (!sound) return;

    const effect = sound.elements[sound.index];
    sound.index = (sound.index + 1) % sound.elements.length;

    effect.pause();
    effect.currentTime = 0;
    effect.volume = clamp(volume, 0, 1);
    effect.play().catch(() => {});
  }

  function initTelegram() {
    const app = window.Telegram?.WebApp || null;

    if (app) {
      app.ready();
      app.expand();
      app.disableVerticalSwipes?.();
    }

    return {
      app,
      initData: app?.initData || "",
      user: app?.initDataUnsafe?.user || getLocalUser(),
    };
  }

  function applyTelegramTheme() {
    const app = telegram.app;
    if (!app) return;

    app.setHeaderColor?.("#121411");
    app.setBackgroundColor?.("#121411");
  }

  function getLocalUser() {
    const key = "doodle-jump-dev-user";
    let id = localStorage.getItem(key);

    if (!id) {
      id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(key, id);
    }

    return {
      id,
      first_name: "Guest",
      username: "guest",
    };
  }

  function getDisplayName(user) {
    if (!user) return "Guest";
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return fullName || user.username || "Guest";
  }

  function createStatsClient(telegramContext) {
    const serverAvailable = window.location.protocol !== "file:";
    const storageKey = `doodle-jump-stats:${telegramContext.user?.id || "guest"}`;

    async function request(path, options = {}) {
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };

      if (telegramContext.initData) {
        headers["X-Telegram-Init-Data"] = telegramContext.initData;
      } else {
        headers["X-Dev-User"] = JSON.stringify(telegramContext.user || getLocalUser());
      }

      const response = await fetch(path, {
        ...options,
        headers,
      });

      if (!response.ok) {
        throw new Error(`Stats request failed: ${response.status}`);
      }

      return response.json();
    }

    function localSnapshot() {
      const saved = readJson(storageKey, null);
      const player = saved?.player || {
        user_id: String(telegramContext.user?.id || "guest"),
        name: getDisplayName(telegramContext.user),
        best_score: readBestScore(),
        games_played: 0,
        total_score: 0,
        total_shots: 0,
        total_hits: 0,
        total_jumps: 0,
        rank: 1,
      };

      player.name = getDisplayName(telegramContext.user);
      player.best_score = Math.max(player.best_score || 0, readBestScore());

      return {
        mode: "local",
        player,
        leaderboard: [{ ...player, rank: 1 }],
      };
    }

    function saveLocal(payload) {
      const snapshot = localSnapshot();
      const player = snapshot.player;

      player.games_played += 1;
      player.best_score = Math.max(player.best_score, payload.score);
      player.total_score += payload.score;
      player.total_shots += payload.shots;
      player.total_hits += payload.hits;
      player.total_jumps += payload.jumps;
      player.rank = 1;

      const next = {
        mode: "local",
        player,
        leaderboard: [{ ...player, rank: 1 }],
      };

      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    }

    return {
      async load() {
        if (!serverAvailable) return localSnapshot();

        try {
          return await request("/api/stats");
        } catch {
          return localSnapshot();
        }
      },
      async submit(payload) {
        if (!serverAvailable) return saveLocal(payload);

        try {
          return await request("/api/score", {
            method: "POST",
            body: JSON.stringify(payload),
          });
        } catch {
          return saveLocal(payload);
        }
      },
    };
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch {
      return fallback;
    }
  }

  function createSessionStats() {
    return {
      startedAt: performance.now(),
      shots: 0,
      hits: 0,
      jumps: 0,
      maxHeight: 0,
    };
  }

  async function loadStats() {
    statsStatus.textContent = "Загрузка...";

    try {
      statsSnapshot = await statsClient.load();
      updateStatsUi();
    } catch {
      statsStatus.textContent = "Статистика временно недоступна";
    }
  }

  async function submitScore() {
    if (state.statsSubmitPending) return;
    state.statsSubmitPending = true;

    const payload = {
      score: state.score,
      max_height: state.session.maxHeight,
      shots: state.session.shots,
      hits: state.session.hits,
      jumps: state.session.jumps,
      duration_ms: Math.max(0, Math.floor(performance.now() - state.session.startedAt)),
    };

    try {
      statsSnapshot = await statsClient.submit(payload);
      updateStatsUi();
    } finally {
      state.statsSubmitPending = false;
    }
  }

  function openStats() {
    statsOverlay.classList.remove("hidden");
    loadStats();
  }

  function closeStats() {
    statsOverlay.classList.add("hidden");
  }

  function updateStatsUi() {
    const player = statsSnapshot?.player;
    const leaderboard = statsSnapshot?.leaderboard || [];

    if (!player) {
      statsStatus.textContent = "Сыграйте первый раунд";
      renderLeaderboard([]);
      return;
    }

    state.best = Math.max(state.best, player.best_score || 0);
    writeBestScore(state.best);
    playerName.textContent = player.name || getDisplayName(telegram.user);
    statBest.textContent = String(player.best_score || 0);
    statGames.textContent = String(player.games_played || 0);
    statHits.textContent = String(player.total_hits || 0);
    statRank.textContent = player.rank ? `#${player.rank}` : "-";
    statsStatus.textContent = statsSnapshot.mode === "local" ? "Локальная статистика" : "Telegram статистика";
    renderLeaderboard(leaderboard, player.user_id);
    updateHud();
  }

  function renderLeaderboard(rows, currentUserId) {
    if (!rows.length) {
      leaderboardList.innerHTML = '<div class="leaderboard-row"><span>-</span><span class="leaderboard-name">Нет результатов</span><span class="leaderboard-score">0</span></div>';
      return;
    }

    leaderboardList.innerHTML = rows.map((row, index) => {
      const rank = row.rank || index + 1;
      const name = escapeHtml(row.name || "Guest");
      const score = Number(row.best_score || 0);
      const isPlayer = String(row.user_id) === String(currentUserId) ? " is-player" : "";
      return `<div class="leaderboard-row${isPlayer}"><span>#${rank}</span><span class="leaderboard-name">${name}</span><span class="leaderboard-score">${score}</span></div>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function readBestScore() {
    try {
      return Number(localStorage.getItem("doodle-jump-best") || 0);
    } catch {
      return 0;
    }
  }

  function writeBestScore(value) {
    try {
      localStorage.setItem("doodle-jump-best", String(value));
    } catch {
      // Storage may be unavailable in private browser modes.
    }
  }

  function createPlayer() {
    return {
      x: 180,
      y: 520,
      w: 58,
      h: 78,
      vx: 0,
      vy: 0,
      face: 1,
      shootCooldown: 0,
      shootPose: 0,
      alive: true,
    };
  }

  function resetGame() {
    state.mode = state.mode === "ready" ? "ready" : "active";
    state.cameraY = 0;
    state.score = 0;
    state.session = createSessionStats();
    state.statsSubmitPending = false;
    state.platforms = [];
    state.enemies = [];
    state.bullets = [];
    state.particles = [];

    const player = state.player;
    player.w = clamp(view.worldW * 0.138, 50, 68);
    player.h = player.w * 1.34;
    const baseY = view.cssH - (usesTouchLayout() ? 154 : 86);
    state.lastEnemyY = baseY;
    state.startY = baseY - player.h * 0.88;
    state.highestY = state.startY;
    player.x = view.worldW * 0.5 - player.w * 0.5;
    player.y = state.startY;
    player.vx = 0;
    player.vy = -860;
    player.face = 1;
    player.shootCooldown = 0;
    player.shootPose = 0;
    player.alive = true;

    const basePlatform = {
      x: view.worldW * 0.5 - 58,
      y: baseY,
      w: 116,
      h: 18,
      type: "solid",
      vx: 0,
      broken: false,
    };

    state.platforms.push(basePlatform);
    state.lastPlatform = basePlatform;
    state.topGeneratedY = basePlatform.y;

    while (state.topGeneratedY > -view.cssH * 1.35) {
      generateNextPlatform();
    }

    updateHud();
  }

  function startGame() {
    unlockAudio();
    state.mode = "active";
    startOverlay.classList.add("hidden");
    gameOverOverlay.classList.add("hidden");
    resetGame();
    startMusic();
    mapVideo.play().catch(() => {});
  }

  function gameOver() {
    if (state.mode !== "active") return;
    state.mode = "over";
    stopMusic();
    playSound("gameOver", 0.72);
    state.best = Math.max(state.best, state.score);
    writeBestScore(state.best);
    updateHud();
    finalScore.textContent = String(state.score);
    gameOverOverlay.classList.remove("hidden");
    submitScore();
  }

  function resize() {
    const width = Math.max(320, Math.floor(window.innerWidth));
    const height = Math.max(480, Math.floor(window.innerHeight));
    const mobile = width <= 680 || usesTouchLayout();
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 2);

    view.cssW = width;
    view.cssH = height;
    view.dpr = dpr;
    view.worldW = clamp(width, 360, 520);
    view.offsetX = Math.round((width - view.worldW) * 0.5);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    clampWorldObjects();
  }

  function clampWorldObjects() {
    const player = state.player;
    player.x = clamp(player.x, -player.w, view.worldW);

    for (const platform of state.platforms) {
      platform.x = clamp(platform.x, 8, Math.max(8, view.worldW - platform.w - 8));
    }

    for (const enemy of state.enemies) {
      enemy.x = clamp(enemy.x, 4, Math.max(4, view.worldW - enemy.w - 4));
      enemy.minX = clamp(enemy.minX || 4, 4, view.worldW - enemy.w - 4);
      enemy.maxX = clamp(enemy.maxX || view.worldW - enemy.w - 4, 4, view.worldW - enemy.w - 4);
    }
  }

  function loop(time) {
    const dt = Math.min((time - state.lastTime) / 1000 || 0, 0.033);
    state.lastTime = time;

    if (state.mode === "active") {
      update(dt);
    }

    draw();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    const player = state.player;
    const prevY = player.y;
    const mobile = usesTouchLayout();

    player.shootCooldown = Math.max(0, player.shootCooldown - dt);
    player.shootPose = Math.max(0, player.shootPose - dt);

    if (isShooting()) {
      shoot();
    }

    const axis = Number(isMovingRight()) - Number(isMovingLeft());
    const maxSpeed = mobile ? 385 : 330;
    const accel = axis ? (mobile ? 22 : 15) : (mobile ? 14 : 10);
    const targetVx = axis * maxSpeed;

    player.vx += (targetVx - player.vx) * Math.min(1, accel * dt);
    if (Math.abs(player.vx) < 2 && axis === 0) {
      player.vx = 0;
    }

    if (axis !== 0) {
      player.face = axis;
    }

    player.vy += (mobile ? 1880 : 1960) * dt;
    player.vy = Math.min(player.vy, mobile ? 1060 : 1120);
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    wrapPlayer(player);
    updatePlatforms(dt);
    updateBullets(dt);
    updateEnemies(dt, prevY);
    updateParticles(dt);
    resolvePlatformCollisions(prevY);

    const targetCameraY = player.y - view.cssH * 0.42;
    state.cameraY = Math.min(state.cameraY, targetCameraY);
    state.highestY = Math.min(state.highestY, player.y);
    state.score = Math.max(state.score, Math.floor((state.startY - state.highestY) * 0.12));
    state.session.maxHeight = Math.max(state.session.maxHeight, Math.max(0, Math.floor(state.startY - state.highestY)));

    while (state.topGeneratedY > state.cameraY - view.cssH * 1.55) {
      generateNextPlatform();
    }

    pruneWorld();
    updateHud();

    if (player.y - state.cameraY > view.cssH + 120) {
      gameOver();
    }
  }

  function updatePlatforms(dt) {
    for (const platform of state.platforms) {
      if (platform.type !== "moving") continue;
      platform.x += platform.vx * dt;
      if (platform.x < 10) {
        platform.x = 10;
        platform.vx *= -1;
      } else if (platform.x + platform.w > view.worldW - 10) {
        platform.x = view.worldW - platform.w - 10;
        platform.vx *= -1;
      }
    }
  }

  function resolvePlatformCollisions(prevY) {
    const player = state.player;
    if (player.vy <= 0) return;

    const hitbox = getPlayerHitbox();
    const prevBottom = prevY + player.h * 0.88;
    const bottom = player.y + player.h * 0.88;

    for (const platform of state.platforms) {
      if (platform.broken) continue;
      if (prevBottom > platform.y) continue;
      if (bottom < platform.y || bottom > platform.y + platform.h + 26) continue;
      if (hitbox.x + hitbox.w < platform.x || hitbox.x > platform.x + platform.w) continue;

      player.y = platform.y - player.h * 0.88;
      player.vy = platform.type === "boost" ? (usesTouchLayout() ? -1220 : -1170) : (usesTouchLayout() ? -960 : -900);
      state.session.jumps += 1;
      playSound("jump", platform.type === "boost" ? 0.72 : 0.48);
      spawnParticles(platform.x + platform.w * 0.5, platform.y, platform.type);

      if (platform.type === "fragile") {
        platform.broken = true;
        platform.vx = 0;
      }

      break;
    }
  }

  function updateBullets(dt) {
    for (const bullet of state.bullets) {
      bullet.y += bullet.vy * dt;
      bullet.spin += 10 * dt;
    }

    for (const bullet of state.bullets) {
      if (bullet.hit) continue;

      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        if (!rectsOverlap(bullet, enemy)) continue;

        bullet.hit = true;
        enemy.dead = true;
        state.session.hits += 1;
        playSound("hit", 0.58);
        state.score += 35;
        spawnParticles(enemy.x + enemy.w * 0.5, enemy.y + enemy.h * 0.5, "enemy");
        state.player.vy = Math.min(state.player.vy, -560);
        break;
      }
    }

    state.bullets = state.bullets.filter((bullet) => {
      return !bullet.hit && bullet.y > state.cameraY - 120 && bullet.y < state.cameraY + view.cssH + 120;
    });
  }

  function updateEnemies(dt, prevPlayerY) {
    const playerHitbox = getPlayerHitbox();
    const prevBottom = prevPlayerY + state.player.h * 0.84;

    for (const enemy of state.enemies) {
      if (enemy.dead) continue;

      enemy.x += enemy.vx * dt;
      enemy.phase += dt;

      if (enemy.x < enemy.minX) {
        enemy.x = enemy.minX;
        enemy.vx *= -1;
      } else if (enemy.x > enemy.maxX) {
        enemy.x = enemy.maxX;
        enemy.vx *= -1;
      }

      enemy.y += Math.sin(enemy.phase * 3.2) * 9 * dt;

      if (!rectsOverlap(playerHitbox, enemy)) continue;

      const playerBottom = state.player.y + state.player.h * 0.84;
      const stomped = state.player.vy > 0 && prevBottom <= enemy.y + enemy.h * 0.35 && playerBottom < enemy.y + enemy.h * 0.72;

      if (stomped) {
        enemy.dead = true;
        state.player.vy = -930;
        state.session.hits += 1;
        playSound("hit", 0.5);
        state.score += 25;
        spawnParticles(enemy.x + enemy.w * 0.5, enemy.y + enemy.h * 0.5, "enemy");
      } else {
        gameOver();
      }
    }

    state.enemies = state.enemies.filter((enemy) => !enemy.dead);
  }

  function updateParticles(dt) {
    for (const particle of state.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 800 * dt;
      particle.life -= dt;
    }

    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function generateNextPlatform() {
    const heightScore = Math.max(0, Math.floor((state.startY - state.topGeneratedY) * 0.12));
    const mobile = usesTouchLayout();
    const mobileDifficulty = mobile ? clamp((heightScore - 240) / 1600, 0, 1) : 0;
    const gapBase = mobile
      ? clamp(68 + heightScore * 0.008, 68, 106)
      : clamp(78 + heightScore * 0.012, 78, 132);
    const gap = random(gapBase, gapBase + (mobile ? 14 + mobileDifficulty * 8 : 32));
    const minWidth = mobile ? 122 - mobileDifficulty * 22 : clamp(112 - heightScore * 0.01, 82, 112);
    const maxWidth = mobile ? 150 - mobileDifficulty * 24 : 122;
    const width = random(minWidth, maxWidth);
    const y = state.topGeneratedY - gap;
    const previous = state.lastPlatform || state.platforms[state.platforms.length - 1];
    const previousCenter = previous ? previous.x + previous.w * 0.5 : view.worldW * 0.5;
    const maxStep = mobile ? view.worldW * (0.23 + mobileDifficulty * 0.08) : view.worldW * 0.46;
    const earlyGame = heightScore < 360;
    const targetCenter = mobile && earlyGame
      ? random(previousCenter - maxStep * 0.72, previousCenter + maxStep * 0.72)
      : Math.random() < (mobile ? 0.08 + mobileDifficulty * 0.04 : 0.14)
      ? random(42, view.worldW - 42)
      : random(previousCenter - maxStep, previousCenter + maxStep);
    const x = clamp(targetCenter - width * 0.5, 14, view.worldW - width - 14);
    const type = choosePlatformType(heightScore);
    const platform = {
      x,
      y,
      w: width,
      h: 18,
      type,
      vx: type === "moving" ? randomSign() * random(mobile ? 28 : 42, mobile ? 62 : 88) : 0,
      broken: false,
    };

    state.platforms.push(platform);
    state.lastPlatform = platform;
    state.topGeneratedY = y;

    maybeSpawnEnemy(platform, heightScore);
  }

  function choosePlatformType(heightScore) {
    const roll = Math.random();
    if (usesTouchLayout()) {
      if (heightScore > 430 && roll < 0.065) return "boost";
      if (heightScore > 620 && roll < 0.15) return "fragile";
      if (heightScore > 360 && roll < 0.28) return "moving";
      return "solid";
    }

    if (heightScore > 420 && roll < 0.08) return "boost";
    if (heightScore > 260 && roll < 0.15) return "fragile";
    if (heightScore > 150 && roll < 0.27) return "moving";
    return "solid";
  }

  function maybeSpawnEnemy(platform, heightScore) {
    const mobile = usesTouchLayout();
    if (heightScore < (mobile ? 220 : 80) || platform.type === "fragile") return;

    const chance = mobile
      ? clamp(0.095 + heightScore / 3600, 0.095, 0.24)
      : clamp(0.055 + heightScore / 3600, 0.055, 0.24);
    if (Math.random() > chance) return;
    if (mobile && Math.abs(platform.y - state.lastEnemyY) < 260) return;

    const size = clamp(view.worldW * 0.12, 42, 58);
    const minX = clamp(platform.x - 22, 8, view.worldW - size - 8);
    const maxX = clamp(platform.x + platform.w - size + 22, 8, view.worldW - size - 8);

    state.enemies.push({
      x: platform.x + platform.w * 0.5 - size * 0.5,
      y: platform.y - size - 8,
      w: size,
      h: size,
      vx: randomSign() * random(28, 68),
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      phase: random(0, Math.PI * 2),
      dead: false,
    });

    state.lastEnemyY = platform.y;
  }

  function pruneWorld() {
    const bottomLimit = state.cameraY + view.cssH + 170;
    const topLimit = state.cameraY - view.cssH * 1.7;

    state.platforms = state.platforms.filter((platform) => platform.y < bottomLimit && platform.y > topLimit);
    state.enemies = state.enemies.filter((enemy) => enemy.y < bottomLimit && enemy.y > topLimit && !enemy.dead);
    state.particles = state.particles.filter((particle) => particle.y < bottomLimit);
  }

  function shoot() {
    const player = state.player;
    if (player.shootCooldown > 0) return;

    const size = clamp(player.w * 0.48, 24, 34);
    state.bullets.push({
      x: player.x + player.w * 0.5 - size * 0.5,
      y: player.y - size * 0.72,
      w: size,
      h: size,
      vy: -1120,
      spin: 0,
      hit: false,
    });

    player.shootPose = 0.2;
    player.shootCooldown = 0.22;
    state.session.shots += 1;
    playSound("shoot", 0.42);
  }

  function wrapPlayer(player) {
    if (player.x + player.w < 0) {
      player.x = view.worldW;
    } else if (player.x > view.worldW) {
      player.x = -player.w;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, view.cssW, view.cssH);
    drawBackground();
    drawPlayfield();
    drawParticles();
    drawBullets();
    drawPlatforms();
    drawEnemies();
    drawPlayer();
  }

  function drawBackground() {
    if (isDrawable(images.background)) {
      drawTiledMedia(images.background, view.cssW, view.cssH, 0.1);
    } else {
      const grd = ctx.createLinearGradient(0, 0, 0, view.cssH);
      grd.addColorStop(0, "#243c31");
      grd.addColorStop(0.45, "#6b4b2a");
      grd.addColorStop(1, "#1b1d18");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, view.cssW, view.cssH);
    }

    const usingVideo = !usesTouchLayout() && mapVideoReady && mapVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

    if (usingVideo) {
      ctx.globalAlpha = 0.72;
      drawTiledMedia(mapVideo, view.cssW, view.cssH, 0.16);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = "rgba(7, 8, 7, 0.18)";
    ctx.fillRect(0, 0, view.cssW, view.cssH);
  }

  function drawTiledMedia(media, width, height, parallax) {
    const tileH = height;
    const offset = positiveMod(-state.cameraY * parallax, tileH);

    for (let y = offset - tileH; y < height + tileH; y += tileH) {
      drawCover(media, 0, y, width, tileH);
    }
  }

  function drawCover(media, x, y, w, h) {
    const mw = media.videoWidth || media.naturalWidth || w;
    const mh = media.videoHeight || media.naturalHeight || h;
    const scale = Math.max(w / mw, h / mh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (mw - sw) * 0.5;
    const sy = (mh - sh) * 0.5;
    ctx.drawImage(media, sx, sy, sw, sh, x, y, w, h);
  }

  function drawPlayfield() {
    if (view.offsetX <= 0) return;

    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(0, 0, view.offsetX, view.cssH);
    ctx.fillRect(view.offsetX + view.worldW, 0, view.offsetX + 2, view.cssH);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(view.offsetX + 0.5, 0);
    ctx.lineTo(view.offsetX + 0.5, view.cssH);
    ctx.moveTo(view.offsetX + view.worldW - 0.5, 0);
    ctx.lineTo(view.offsetX + view.worldW - 0.5, view.cssH);
    ctx.stroke();
  }

  function drawPlatforms() {
    for (const platform of state.platforms) {
      const y = worldY(platform.y);
      if (y < -40 || y > view.cssH + 40) continue;

      const x = worldX(platform.x);
      const alpha = platform.broken ? 0.46 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;

      const color = platform.type === "moving"
        ? "#31c7be"
        : platform.type === "boost"
          ? "#ffcf43"
          : platform.type === "fragile"
            ? "#ef4d45"
            : "#35d07f";

      roundRect(ctx, x, y, platform.w, platform.h, 7);
      ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
      ctx.fill();

      roundRect(ctx, x, y - 4, platform.w, platform.h, 7);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      roundRect(ctx, x + 8, y - 2, Math.max(14, platform.w * 0.42), 4, 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const enemy of state.enemies) {
      const x = worldX(enemy.x);
      const y = worldY(enemy.y);
      if (y < -80 || y > view.cssH + 80) continue;

      drawImageOrFallback(images.enemy, x, y, enemy.w, enemy.h, "enemy", enemy.vx < 0 ? -1 : 1);
    }
  }

  function drawBullets() {
    for (const bullet of state.bullets) {
      const x = worldX(bullet.x);
      const y = worldY(bullet.y);

      ctx.save();
      ctx.translate(x + bullet.w * 0.5, y + bullet.h * 0.5);
      ctx.rotate(bullet.spin);

      if (isDrawable(images.projectile)) {
        ctx.drawImage(images.projectile, -bullet.w * 0.5, -bullet.h * 0.5, bullet.w, bullet.h);
      } else {
        ctx.fillStyle = "#ffcf43";
        roundRect(ctx, -bullet.w * 0.35, -bullet.h * 0.5, bullet.w * 0.7, bullet.h, 6);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawPlayer() {
    const player = state.player;
    const x = worldX(player.x);
    const y = worldY(player.y);
    const playerImage = player.shootPose > 0 ? images.playerShoot : images.player;
    drawImageOrFallback(playerImage, x, y, player.w, player.h, "player", player.face);
  }

  function drawParticles() {
    for (const particle of state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(worldX(particle.x), worldY(particle.y), particle.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawImageOrFallback(img, x, y, w, h, kind, face) {
    ctx.save();

    if (face < 0) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      x = 0;
      y = 0;
    }

    if (isDrawable(img)) {
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      return;
    }

    if (kind === "enemy") {
      ctx.fillStyle = "#ef4d45";
      roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + w * 0.24, y + h * 0.3, w * 0.16, h * 0.16);
      ctx.fillRect(x + w * 0.6, y + h * 0.3, w * 0.16, h * 0.16);
    } else {
      ctx.fillStyle = "#ffcf43";
      roundRect(ctx, x + w * 0.12, y, w * 0.76, h, 8);
      ctx.fill();
      ctx.fillStyle = "#35d07f";
      roundRect(ctx, x, y + h * 0.68, w, h * 0.22, 6);
      ctx.fill();
    }

    ctx.restore();
  }

  function spawnParticles(x, y, type) {
    const color = type === "enemy" ? "#ef4d45" : type === "boost" ? "#ffcf43" : "#ffffff";
    const count = usesTouchLayout() ? (type === "enemy" ? 8 : 4) : (type === "enemy" ? 16 : 8);

    for (let i = 0; i < count; i += 1) {
      const life = random(0.22, 0.55);
      state.particles.push({
        x,
        y,
        vx: random(-120, 120),
        vy: random(-220, -40),
        r: random(2, 5),
        color,
        life,
        maxLife: life,
      });
    }
  }

  function updateHud() {
    scoreValue.textContent = String(state.score);
    bestValue.textContent = String(Math.max(state.best, state.score));
  }

  function handleCanvasPointer(event) {
    event.preventDefault();

    if (state.mode === "ready" || state.mode === "over") {
      startGame();
      return;
    }

    shoot();
  }

  function handleKeyDown(event) {
    const code = event.code;

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyW", "Space", "Enter", "KeyR", "KeyP"].includes(code)) {
      event.preventDefault();
    }

    if ((code === "Enter" || code === "Space") && (state.mode === "ready" || state.mode === "over")) {
      startGame();
      return;
    }

    if (code === "KeyR" && state.mode === "over") {
      startGame();
      return;
    }

    if (code === "KeyP" && state.mode === "active") {
      state.mode = "paused";
      return;
    }

    if (code === "KeyP" && state.mode === "paused") {
      state.mode = "active";
      return;
    }

    keys.add(code);
  }

  function handleKeyUp(event) {
    keys.delete(event.code);
  }

  function bindHoldButton(button, inputKey) {
    const set = (value) => {
      input[inputKey] = value;
      button.classList.toggle("is-held", value);
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      set(true);
    });

    button.addEventListener("pointerup", () => set(false));
    button.addEventListener("pointercancel", () => set(false));
    button.addEventListener("pointerleave", () => set(false));
  }

  function bindShootButton(button) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      input.shoot = true;
      button.classList.add("is-held");

      if (state.mode === "ready" || state.mode === "over") {
        startGame();
      } else {
        shoot();
      }
    });

    const release = () => {
      input.shoot = false;
      button.classList.remove("is-held");
    };

    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  }

  function isMovingLeft() {
    return input.left || keys.has("ArrowLeft") || keys.has("KeyA");
  }

  function isMovingRight() {
    return input.right || keys.has("ArrowRight") || keys.has("KeyD");
  }

  function isShooting() {
    return input.shoot || keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW");
  }

  function getPlayerHitbox() {
    const player = state.player;
    return {
      x: player.x + player.w * 0.18,
      y: player.y + player.h * 0.08,
      w: player.w * 0.64,
      h: player.h * 0.82,
    };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function isDrawable(media) {
    if (!media) return false;
    if (media instanceof HTMLVideoElement) return media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    return media.complete && media.naturalWidth > 0;
  }

  function usesTouchLayout() {
    return view.cssW <= 820 || window.matchMedia?.("(pointer: coarse)")?.matches;
  }

  function worldX(x) {
    return view.offsetX + x;
  }

  function worldY(y) {
    return y - state.cameraY;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  function positiveMod(value, mod) {
    return ((value % mod) + mod) % mod;
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.quadraticCurveTo(x + w, y, x + w, y + radius);
    context.lineTo(x + w, y + h - radius);
    context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    context.lineTo(x + radius, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }
})();
