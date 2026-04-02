// =============================================================================
// ui.js - UI Controller for Noon Arena (점심아레나)
// Manages screen transitions, DOM updates, and network event binding.
// =============================================================================

class UI {
  constructor() {
    // -------------------------------------------------------------------------
    // Cache DOM elements
    // -------------------------------------------------------------------------
    this.screens = {
      lobby: document.getElementById('lobby-screen'),
      waiting: document.getElementById('waiting-screen'),
      game: document.getElementById('game-screen'),
      result: document.getElementById('result-screen'),
    };

    // Lobby
    this.nicknameInput = document.getElementById('nickname');
    this.createRoomBtn = document.getElementById('create-room-btn');
    this.soloBtn = document.getElementById('solo-btn');
    this.roomCodeInput = document.getElementById('room-code-input');
    this.joinRoomBtn = document.getElementById('join-room-btn');

    // Waiting
    this.displayRoomCode = document.getElementById('display-room-code');
    this.playerList = document.getElementById('player-list');
    this.playerCount = document.getElementById('player-count');
    this.startGameBtn = document.getElementById('start-game-btn');

    // Game HUD
    this.timer = document.getElementById('timer');
    this.aliveCount = document.getElementById('alive-count');
    this.shrinkWarning = document.getElementById('shrink-warning');
    this.killLog = document.getElementById('kill-log');
    this.countdownOverlay = document.getElementById('countdown-overlay');

    // Result
    this.winnerDisplay = document.getElementById('winner-display');
    this.rankingsList = document.getElementById('rankings-list');
    this.restartBtn = document.getElementById('restart-btn');

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    this.myPlayerId = null;
    this.isHost = false;
    this.toastContainer = null;

    this.init();
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================
  init() {
    this._createToastContainer();
    this.setupLobbyHandlers();
    this.setupWaitingHandlers();
    this.setupGameHandlers();
    this.setupResultHandlers();
    this.setupNetworkHandlers();

    // Show lobby by default
    this.showScreen('lobby');
  }

  // ===========================================================================
  // Screen management
  // ===========================================================================
  showScreen(screenName) {
    Object.entries(this.screens).forEach(([name, el]) => {
      if (!el) return;
      if (name === screenName) {
        el.classList.remove('hidden');
        el.classList.add('active');
      } else {
        el.classList.remove('active');
        // Small delay so CSS transition can play before hiding
        el.classList.add('hidden');
      }
    });
  }

  // ===========================================================================
  // LOBBY handlers
  // ===========================================================================
  setupLobbyHandlers() {
    // Create Room
    this.createRoomBtn.addEventListener('click', () => {
      const nickname = this._validateNickname();
      if (!nickname) return;
      this.createRoomBtn.disabled = true;
      window.network.createRoom(nickname);
    }, { passive: true });

    // Solo Start (vs AI)
    this.soloBtn.addEventListener('click', () => {
      const nicknameEl = document.getElementById('nickname');
      const nickname = nicknameEl ? nicknameEl.value.trim() : '';
      this.soloBtn.disabled = true;
      window.network.soloStart(nickname || '나');
    }, { passive: true });

    // Join Room
    this.joinRoomBtn.addEventListener('click', () => {
      const nickname = this._validateNickname();
      if (!nickname) return;

      const code = this.roomCodeInput.value.trim();
      if (!/^\d{4}$/.test(code)) {
        this.showToast('방 코드는 4자리 숫자여야 합니다.', 'error');
        this.roomCodeInput.focus();
        return;
      }

      this.joinRoomBtn.disabled = true;
      window.network.joinRoom(code, nickname);
    }, { passive: true });

    // Allow Enter key to submit
    this.nicknameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createRoomBtn.click();
    });

    this.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinRoomBtn.click();
    });

    // Auto-format room code: digits only
    this.roomCodeInput.addEventListener('input', () => {
      this.roomCodeInput.value = this.roomCodeInput.value.replace(/\D/g, '').slice(0, 4);
    });
  }

  _validateNickname() {
    const nickname = this.nicknameInput.value.trim();
    if (!nickname) {
      this.showToast('닉네임을 입력해주세요!', 'error');
      this.nicknameInput.focus();
      return null;
    }
    if (nickname.length > 8) {
      this.showToast('닉네임은 8자 이하로 입력해주세요.', 'error');
      this.nicknameInput.focus();
      return null;
    }
    return nickname;
  }

  // ===========================================================================
  // WAITING ROOM handlers
  // ===========================================================================
  setupWaitingHandlers() {
    // Start Game (host only)
    this.startGameBtn.addEventListener('click', () => {
      if (!this.isHost) {
        this.showToast('방장만 게임을 시작할 수 있습니다.', 'error');
        return;
      }
      this.startGameBtn.disabled = true;
      window.network.startGame();
      // Re-enable after short delay in case of error
      setTimeout(() => { this.startGameBtn.disabled = false; }, 2000);
    }, { passive: true });

    // Copy room code on tap
    if (this.displayRoomCode) {
      this.displayRoomCode.addEventListener('click', () => {
        const code = this.displayRoomCode.textContent;
        if (code) this.copyToClipboard(code);
      }, { passive: true });

      // Make it look tappable
      this.displayRoomCode.style.cursor = 'pointer';
    }
  }

  updatePlayerList(players) {
    if (!this.playerList) return;

    this.playerList.innerHTML = '';

    const MAX_PLAYERS = 10;

    players.forEach((player) => {
      const card = document.createElement('div');
      card.className = 'player-card';
      if (player.id === this.myPlayerId) {
        card.classList.add('self');
      }
      if (player.isHost) {
        card.classList.add('host');
      }

      const emoji = document.createElement('span');
      emoji.className = 'player-emoji';
      emoji.textContent = player.emoji || '🐣';

      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.nickname;

      const badge = document.createElement('span');
      badge.className = 'player-badge';
      if (player.isHost) badge.textContent = '👑';
      if (player.id === this.myPlayerId && !player.isHost) badge.textContent = '⭐';

      card.appendChild(emoji);
      card.appendChild(name);
      card.appendChild(badge);
      this.playerList.appendChild(card);
    });

    // Update count
    if (this.playerCount) {
      this.playerCount.textContent = `${players.length}/${MAX_PLAYERS}`;
    }

    // Show/hide start button based on host status
    if (this.startGameBtn) {
      this.startGameBtn.style.display = this.isHost ? '' : 'none';
    }
  }

  // ===========================================================================
  // GAME handlers
  // ===========================================================================
  setupGameHandlers() {
    // Game-specific setup is handled by network event handlers.
    // This is where additional in-game UI bindings go if needed.
  }

  showKillNotification(playerName, killerName) {
    if (!this.killLog) return;

    const el = document.createElement('div');
    el.className = 'kill-entry';

    if (killerName) {
      // Determine Korean particle based on final character having batchim
      const killerParticle = this._getSubjectParticle(killerName);
      const victimParticle = this._getObjectParticle(playerName);
      el.innerHTML =
        `<strong>${killerName}</strong>${killerParticle} ` +
        `<strong>${playerName}</strong>${victimParticle} 떨어뜨렸다! 💥`;
    } else {
      const particle = this._getSubjectParticle(playerName);
      el.innerHTML = `<strong>${playerName}</strong>${particle} 떨어졌다! 😵`;
    }

    this.killLog.appendChild(el);

    // Auto-remove after 3 seconds (CSS fadeInOut handles the animation)
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 3000);

    // Limit visible notifications to 5
    while (this.killLog.children.length > 5) {
      this.killLog.removeChild(this.killLog.firstChild);
    }
  }

  updateHUD(gameState) {
    // Timer
    if (this.timer && gameState.timeRemaining != null) {
      const seconds = Math.ceil(gameState.timeRemaining);
      this.timer.textContent = `⏱ ${seconds}s`;

      if (seconds <= 10) {
        this.timer.classList.add('urgent');
      } else {
        this.timer.classList.remove('urgent');
      }
    }

    // Alive count
    if (this.aliveCount && gameState.aliveCount != null) {
      const total = gameState.totalPlayers || gameState.aliveCount;
      this.aliveCount.textContent = `생존: ${gameState.aliveCount}/${total}`;
    }

    // Shrink warning
    if (this.shrinkWarning) {
      if (gameState.isShrinking) {
        this.shrinkWarning.classList.remove('hidden');
        this.shrinkWarning.classList.add('flash');
      } else {
        this.shrinkWarning.classList.add('hidden');
        this.shrinkWarning.classList.remove('flash');
      }
    }
  }

  showCountdown(count) {
    // Delegate to game renderer's countdown display
    if (window.gameRenderer && typeof window.gameRenderer.showCountdown === 'function') {
      window.gameRenderer.showCountdown(count);
    }
  }

  // ===========================================================================
  // RESULT handlers
  // ===========================================================================
  setupResultHandlers() {
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', () => {
        this.restartBtn.disabled = true;
        window.network.restartGame();
        setTimeout(() => { this.restartBtn.disabled = false; }, 2000);
      }, { passive: true });
    }
  }

  showResults(winner, rankings) {
    // ---- Winner display ----
    if (this.winnerDisplay) {
      const winnerEmoji = (winner && winner.emoji) ? winner.emoji : '🏆';
      const winnerName = (winner && winner.nickname) ? winner.nickname : '???';
      this.winnerDisplay.innerHTML =
        `<div class="winner-crown">👑</div>` +
        `<div class="winner-emoji">${winnerEmoji}</div>` +
        `<div class="winner-name">${winnerName}</div>` +
        `<div class="winner-label">승리!</div>`;
    }

    // ---- Rankings list ----
    if (this.rankingsList && rankings) {
      this.rankingsList.innerHTML = '';

      const medals = ['🥇', '🥈', '🥉'];

      rankings.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'ranking-row';
        if (entry.id === this.myPlayerId) {
          row.classList.add('self');
        }

        const position = document.createElement('span');
        position.className = 'ranking-position';
        position.textContent = index < 3 ? medals[index] : `${index + 1}`;

        const emoji = document.createElement('span');
        emoji.className = 'ranking-emoji';
        emoji.textContent = entry.emoji || '🐣';

        const name = document.createElement('span');
        name.className = 'ranking-name';
        name.textContent = entry.nickname || '???';

        const time = document.createElement('span');
        time.className = 'ranking-time';
        if (entry.survivalTime != null) {
          time.textContent = `${entry.survivalTime.toFixed(1)}초`;
        }

        row.appendChild(position);
        row.appendChild(emoji);
        row.appendChild(name);
        row.appendChild(time);
        this.rankingsList.appendChild(row);
      });
    }

    // Trigger confetti
    this._launchConfetti();

    this.showScreen('result');
  }

  // ===========================================================================
  // NETWORK event handlers
  // ===========================================================================
  setupNetworkHandlers() {
    const net = window.network;
    if (!net) {
      console.error('[UI] window.network not found. Make sure network.js loads first.');
      return;
    }

    // -- Room created (I am host) --
    net.on('room-created', (data) => {
      this.myPlayerId = data.playerId;
      this.isHost = true;

      if (this.displayRoomCode) {
        this.displayRoomCode.textContent = data.roomCode;
      }

      this.showToast('방이 만들어졌습니다!', 'success');
      this.showScreen('waiting');

      // Re-enable lobby buttons
      this.createRoomBtn.disabled = false;
      if (this.soloBtn) this.soloBtn.disabled = false;

      // Update player list if included
      if (data.players) {
        this.updatePlayerList(data.players);
      }
    });

    // -- Room joined (I am guest) --
    net.on('room-joined', (data) => {
      this.myPlayerId = data.playerId;
      this.isHost = false;

      if (this.displayRoomCode) {
        this.displayRoomCode.textContent = data.roomCode || net.roomCode;
      }

      this.showToast('방에 참가했습니다!', 'success');
      this.showScreen('waiting');

      // Re-enable lobby buttons
      this.joinRoomBtn.disabled = false;

      if (data.players) {
        this.updatePlayerList(data.players);
      }
    });

    // -- Player joined/left --
    net.on('player-joined', (data) => {
      if (data.players) {
        this.updatePlayerList(data.players);
      }
      if (data.player && data.player.nickname) {
        this.showToast(`${data.player.nickname} 님이 입장했습니다.`, 'info');
      }
    });

    net.on('player-left', (data) => {
      if (data.players) {
        this.updatePlayerList(data.players);
      }
      if (data.playerName) {
        this.showToast(`${data.playerName} 님이 퇴장했습니다.`, 'info');
      }
    });

    // -- Phase change --
    net.on('phase-change', (data) => {
      if (data.phase === 'countdown') {
        this.showScreen('game');
        // Set player ID before init
        if (window.game) {
          window.game.myId = this.myPlayerId;
        }
        // Initialize game renderer if available
        if (window.gameRenderer && typeof window.gameRenderer.init === 'function') {
          window.gameRenderer.init();
        }
      }
      if (data.phase === 'playing') {
        this.showCountdown(0); // Show "GO!"
        // Start the game render loop
        if (window.gameRenderer && typeof window.gameRenderer.startGameLoop === 'function') {
          if (window.game) {
            window.game.myId = this.myPlayerId;
          }
          window.gameRenderer.startGameLoop();
        }
      }
      if (data.phase === 'lobby') {
        // Returned to lobby (e.g., after restart)
        this.showScreen('waiting');
        if (window.gameRenderer && typeof window.gameRenderer.stopGameLoop === 'function') {
          window.gameRenderer.stopGameLoop();
        }
      }
    });

    // -- Room update (e.g., after restart) --
    net.on('room-update', (data) => {
      if (data.players) {
        this.updatePlayerList(data.players);
      }
    });

    // -- Countdown --
    net.on('countdown', (data) => {
      this.showCountdown(data.count);
    });

    // -- Game state (every tick) --
    net.on('game-state', (data) => {
      // Forward to game renderer
      if (window.gameRenderer && typeof window.gameRenderer.pushServerState === 'function') {
        window.gameRenderer.pushServerState(data);
      }
    });

    // -- Player eliminated --
    net.on('player-eliminated', (data) => {
      this.showKillNotification(data.playerName, data.killerName || null);

      // Forward elimination animation to game renderer
      if (window.gameRenderer && window.game) {
        const elimPlayer = window.game.interpolatedPlayers[data.playerId];
        if (elimPlayer) {
          window.gameRenderer.addElimAnimation(elimPlayer);
        }
      }

      // If I was eliminated, show a hint
      if (data.playerId === this.myPlayerId) {
        this.showToast('탈락했습니다! 관전 모드로 전환됩니다.', 'error');
      }
    });

    // -- Game over --
    net.on('game-over', (data) => {
      // Stop game loop
      if (window.gameRenderer && typeof window.gameRenderer.stopGameLoop === 'function') {
        window.gameRenderer.stopGameLoop();
      }
      this.showResults(data.winner, data.rankings);
    });

    // -- Error --
    net.on('error', (data) => {
      const message = this._translateError(data.message || data.error || data);
      this.showToast(message, 'error');

      // Re-enable buttons that may have been disabled
      this.createRoomBtn.disabled = false;
      this.joinRoomBtn.disabled = false;
      this.startGameBtn.disabled = false;
      this.restartBtn.disabled = false;
    });
  }

  // ===========================================================================
  // UTILITY: clipboard
  // ===========================================================================
  copyToClipboard(text) {
    // Use modern API first, fallback for older mobile browsers
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('복사됨! 📋', 'success');
      }).catch(() => {
        this._fallbackCopy(text);
      });
    } else {
      this._fallbackCopy(text);
    }
  }

  _fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      this.showToast('복사됨! 📋', 'success');
    } catch (_) {
      this.showToast('복사에 실패했습니다.', 'error');
    }
    document.body.removeChild(textarea);
  }

  // ===========================================================================
  // UTILITY: toast notifications
  // ===========================================================================
  _createToastContainer() {
    this.toastContainer = document.getElementById('toast-container');
    if (!this.toastContainer) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.id = 'toast-container';
      this.toastContainer.style.cssText =
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
        'z-index:9999;display:flex;flex-direction:column;align-items:center;gap:6px;' +
        'pointer-events:none;width:90%;max-width:360px;';
      document.body.appendChild(this.toastContainer);
    }
  }

  showToast(message, type = 'info') {
    if (!this.toastContainer) this._createToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Base styles (inline so it works without any external CSS)
    toast.style.cssText =
      'padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;' +
      'color:#fff;opacity:0;transform:translateY(-10px);' +
      'transition:opacity 0.25s ease,transform 0.25s ease;' +
      'pointer-events:auto;text-align:center;word-break:keep-all;';

    const colors = {
      info: '#4a90d9',
      error: '#d94a4a',
      success: '#4ad97a',
    };
    toast.style.backgroundColor = colors[type] || colors.info;

    this.toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Dismiss after 2 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      // Fallback removal
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
    }, 2000);
  }

  // ===========================================================================
  // UTILITY: Korean particles (조사)
  // ===========================================================================
  _hasBatchim(char) {
    // Returns true if the last Korean character has a final consonant (받침)
    if (!char) return false;
    const code = char.charCodeAt(0);
    // Korean syllable range: 0xAC00 - 0xD7A3
    if (code < 0xAC00 || code > 0xD7A3) return false;
    return (code - 0xAC00) % 28 !== 0;
  }

  _getSubjectParticle(name) {
    // 이/가
    const last = name.charAt(name.length - 1);
    return this._hasBatchim(last) ? '이' : '가';
  }

  _getObjectParticle(name) {
    // 을/를
    const last = name.charAt(name.length - 1);
    return this._hasBatchim(last) ? '을' : '를';
  }

  // ===========================================================================
  // UTILITY: error translation
  // ===========================================================================
  _translateError(msg) {
    if (typeof msg !== 'string') return '알 수 없는 오류가 발생했습니다.';

    const map = {
      'room not found': '존재하지 않는 방입니다.',
      'room is full': '방이 가득 찼습니다.',
      'game already started': '이미 게임이 시작되었습니다.',
      'not the host': '방장만 게임을 시작할 수 있습니다.',
      'nickname required': '닉네임을 입력해주세요.',
      'invalid room code': '유효하지 않은 방 코드입니다.',
      'not enough players': '최소 2명 이상이 필요합니다.',
    };

    const lower = msg.toLowerCase();
    for (const [key, korean] of Object.entries(map)) {
      if (lower.includes(key)) return korean;
    }
    return msg;
  }

  // ===========================================================================
  // UTILITY: confetti celebration
  // ===========================================================================
  _launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:9998;';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const PARTICLE_COUNT = 80;
    const colors = ['#FFD700', '#FF6B6B', '#6BCB77', '#4D96FF', '#FF6BFF', '#FF9F45'];
    const particles = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * -1,
        w: Math.random() * 8 + 4,
        h: Math.random() * 6 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3 + 2,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
        opacity: 1,
      });
    }

    let frame = 0;
    const MAX_FRAMES = 180; // ~3 seconds at 60fps

    const animate = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (frame > MAX_FRAMES * 0.6) {
        // Start fading out
        const fadeProgress = (frame - MAX_FRAMES * 0.6) / (MAX_FRAMES * 0.4);
        particles.forEach((p) => { p.opacity = Math.max(0, 1 - fadeProgress); });
      }

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // gravity
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      if (frame < MAX_FRAMES) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    };

    requestAnimationFrame(animate);
  }
}

// =============================================================================
// Bootstrap
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  window.ui = new UI();
});
