// =============================================================================
// network.js - Socket.io Client Wrapper for Noon Arena
// =============================================================================

class Network {
  constructor() {
    this.socket = io();
    this.callbacks = {};
    this.playerId = null;
    this.roomCode = null;

    this._bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Internal: bind all socket events to callback dispatch
  // ---------------------------------------------------------------------------
  _bindEvents() {
    const events = [
      'player-joined',
      'player-left',
      'countdown',
      'game-state',
      'player-eliminated',
      'game-over',
      'phase-change',
      'room-update',
      'punch-impact',
      'error',
    ];

    events.forEach((event) => {
      this.socket.on(event, (data) => {
        this._dispatch(event, data);
      });
    });
  }

  _dispatch(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach((cb) => cb(data));
    }
  }

  // ---------------------------------------------------------------------------
  // Event listener registration
  // ---------------------------------------------------------------------------
  on(event, callback) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    if (!this.callbacks[event]) return;
    if (callback) {
      this.callbacks[event] = this.callbacks[event].filter((cb) => cb !== callback);
    } else {
      delete this.callbacks[event];
    }
  }

  // ---------------------------------------------------------------------------
  // Room Management
  // ---------------------------------------------------------------------------
  createRoom(nickname) {
    this.socket.emit('create-room', { nickname }, (response) => {
      if (response && response.success) {
        this.playerId = response.playerId;
        this.roomCode = response.roomCode;
        this._dispatch('room-created', response);
      } else {
        this._dispatch('error', { error: (response && response.error) || 'Failed to create room' });
      }
    });
  }

  joinRoom(roomCode, nickname) {
    this.roomCode = roomCode;
    this.socket.emit('join-room', { roomCode, nickname }, (response) => {
      if (response && response.success) {
        this.playerId = response.playerId;
        this.roomCode = response.roomCode;
        this._dispatch('room-joined', response);
      } else {
        this._dispatch('error', { error: (response && response.error) || 'Failed to join room' });
      }
    });
  }

  soloStart(nickname) {
    this.socket.emit('solo-start', { nickname }, (response) => {
      if (response && response.success) {
        this.playerId = response.playerId;
        this.roomCode = response.roomCode;
        this._dispatch('room-created', response);
      } else {
        this._dispatch('error', { error: (response && response.error) || 'Failed to start solo game' });
      }
    });
  }

  startGame() {
    this.socket.emit('start-game', { roomCode: this.roomCode }, (response) => {
      if (response && !response.success) {
        this._dispatch('error', { error: response.error || 'Failed to start game' });
      }
    });
  }

  restartGame() {
    this.socket.emit('restart-game', { roomCode: this.roomCode }, (response) => {
      if (response && !response.success) {
        this._dispatch('error', { error: response.error || 'Failed to restart game' });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Game Input (called every frame from game loop)
  // ---------------------------------------------------------------------------
  sendInput(dx, dy) {
    this.socket.volatile.emit('player-input', { dx, dy });
  }

  sendDash() {
    this.socket.emit('dash');
  }

  sendPunchStart() {
    this.socket.emit('punch-start');
  }

  sendPunchRelease(charge) {
    this.socket.emit('punch-release', { charge });
  }

  sendDodge() {
    this.socket.emit('dodge');
  }
}

// Export as global singleton
window.network = new Network();
