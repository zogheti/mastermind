/* ==========================================================================
   INIZIALIZZAZIONE FIREBASE REALTIME DATABASE
   ========================================================================== */
const firebaseConfig = {
    apiKey: "AIzaSyBW1BEOIMWNu0fxI73F1dEdHwXqAxBJ6XA",
    authDomain: "mind-breaker-b805c.firebaseapp.com",
    databaseURL: "https://mind-breaker-b805c-default-rtdb.firebaseio.com",
    projectId: "mind-breaker-b805c",
    storageBucket: "mind-breaker-b805c.firebasestorage.app",
    messagingSenderId: "73277424156",
    appId: "1:73277424156:web:bc76d4347d574c590c15d9"
};

let fbApp = null;
let fbDb = null;
if (typeof firebase !== 'undefined') {
    fbApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    fbDb = firebase.database();
}

/* ==========================================================================
   CONFIGURAZIONE E STATO DEL GIOCO
   ========================================================================== */
const COLOR_DEFINITIONS = [
    { id: 'red', name: 'Rosso', class: 'peg-red' },
    { id: 'blue', name: 'Blu', class: 'peg-blue' },
    { id: 'green', name: 'Verde', class: 'peg-green' },
    { id: 'yellow', name: 'Giallo', class: 'peg-yellow' },
    { id: 'purple', name: 'Viola', class: 'peg-purple' },
    { id: 'orange', name: 'Arancione', class: 'peg-orange' },
    { id: 'pink', name: 'Rosa', class: 'peg-pink' },
    { id: 'cyan', name: 'Ciano', class: 'peg-cyan' }
];

let lbCurrentMode = 'Singolo';
let lbCurrentDiff = 'easy';

const DIFFICULTY_SETTINGS = {
    easy: { slots: 4, colors: 5, maxAttemptsPerRound: 10, eliminationLimit: 20 },
    normal: { slots: 4, colors: 6, maxAttemptsPerRound: 10, eliminationLimit: 23 },
    hard: { slots: 5, colors: 8, maxAttemptsPerRound: 10, eliminationLimit: 26 }
};

let gameState = {
    mode: 'single', // 'single', 'multi', 'online'
    difficulty: 'easy',
    audioEnabled: true,

    players: [],
    currentPlayerIndex: 0,
    currentRound: 1,

    secretCode: [],
    currentAttemptInRound: 0,
    maxAttemptsPerRound: 10,
    currentRowPegs: [],
    playedRows: [],
    selectedColorId: null,

    timerInterval: null,
    turnStartTime: 0,
    currentTurnSeconds: 0
};

/* Stato specifico Multiplayer Online */
let onlineState = {
    subMode: 'sfida', // 'sfida' | 'classica'
    roomCode: null,
    playerId: null,
    playerName: '',
    isHost: false,
    roomRef: null,
    roomListener: null,
    lastProcessedRound: 0,
    wheelSpunForRound: 0,
    classicRole: null, // 'codemaker' | 'codebreaker'
    codemakerSecretDraft: [],
    codemakerFeedbackDraft: [],
    pendingRowIndex: null,
    lastRenderedAttemptCount: 0,
    hasFinishedCurrentRound: false,
    matchEndedProcessed: false
};

const PLAYER_NAME_STORAGE_KEY = 'mindbreaker_player_name_v1';

function getSavedPlayerName() {
    try {
        return (localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '').trim();
    } catch (_) {
        return '';
    }
}

function savePlayerName(name) {
    const clean = (name || '').trim().slice(0, 15);
    try {
        localStorage.setItem(PLAYER_NAME_STORAGE_KEY, clean);
    } catch (_) { }

    // Sincronizza i campi nome visibili senza sovrascrivere se già identici
    ['single-player-name', 'online-player-name'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value.trim() !== clean) {
            el.value = clean;
        }
    });
}

function initPersistentPlayerNames() {
    const saved = getSavedPlayerName();
    const singleInput = document.getElementById('single-player-name');
    const onlineInput = document.getElementById('online-player-name');

    if (singleInput) {
        singleInput.value = saved;
        singleInput.required = true;
        singleInput.placeholder = 'Obbligatorio: inserisci il tuo nome...';
        singleInput.addEventListener('input', () => savePlayerName(singleInput.value));
    }

    if (onlineInput) {
        onlineInput.value = saved;
        onlineInput.required = true;
        onlineInput.placeholder = 'Obbligatorio: inserisci il tuo nome...';
        onlineInput.addEventListener('input', () => savePlayerName(onlineInput.value));
    }
}

function requireValidPlayerName(preferredInputId) {
    let raw = '';
    if (preferredInputId) {
        const el = document.getElementById(preferredInputId);
        if (el) raw = el.value.trim();
    }
    if (!raw) raw = getSavedPlayerName();

    if (!raw) {
        alert('Inserisci il tuo nome prima di continuare: il nome è obbligatorio.');
        const target = document.getElementById(preferredInputId || 'single-player-name') || document.getElementById('online-player-name');
        if (target) target.focus();
        return null;
    }

    const clean = raw.slice(0, 15);
    savePlayerName(clean);
    return clean;
}

/* ==========================================================================
   SISTEMA AUDIO SINTETIZZATO (WEB AUDIO API)
   ========================================================================== */
const AudioEngine = {
    ctx: null,
    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
        }
    },
    playTone(freq, type, duration, vol = 0.1) {
        if (!gameState.audioEnabled) return;
        this.init();
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) { }
    },
    playPegPlace() { this.playTone(400, 'sine', 0.1, 0.15); },
    playPegMove() { this.playTone(300, 'triangle', 0.08, 0.1); },
    playPegSelect() { this.playTone(480, 'sine', 0.06, 0.12); },
    playSubmit() { this.playTone(600, 'sine', 0.15, 0.2); },
    playSuccess() {
        if (!gameState.audioEnabled) return;
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 'sine', 0.3, 0.2), idx * 100);
        });
    },
    playEliminated() {
        if (!gameState.audioEnabled) return;
        [300, 250, 200, 150].forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 'sawtooth', 0.2, 0.15), idx * 120);
        });
    }
};

function toggleAudio() {
    gameState.audioEnabled = !gameState.audioEnabled;
    document.getElementById('btn-audio').innerText = gameState.audioEnabled ? '🔊' : '🔇';
}

function toggleFullscreen() {
    const elem = document.documentElement;
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    if (!isFullscreen) {
        if (elem.requestFullscreen) elem.requestFullscreen().catch(() => { });
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
}

function updateFullscreenIcon() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    btn.innerText = isFullscreen ? '🗗' : '⛶';
}

document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

/* ==========================================================================
   INIZIALIZZAZIONE E NAVIGAZIONE SCHERMATE
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
    initPersistentPlayerNames();
    renderMultiPlayerInputs();
});

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
    });
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
    }

    if (screenId === 'screen-leaderboard') {
        subscribeFirebaseLeaderboard();
    } else {
        detachFirebaseLeaderboard();
    }
}

let activeRoomsPollInterval = null;
let activeRoomsRef = null;
let activeRoomsValueCallback = null;

function setMode(mode) {
    gameState.mode = mode;
    document.getElementById('btn-mode-single').classList.toggle('active', mode === 'single');
    document.getElementById('btn-mode-multi').classList.toggle('active', mode === 'multi');
    document.getElementById('btn-mode-online').classList.toggle('active', mode === 'online');

    document.getElementById('single-player-setup').classList.toggle('hidden', mode !== 'single');
    document.getElementById('multi-player-setup').classList.toggle('hidden', mode !== 'multi');
    document.getElementById('online-player-setup').classList.toggle('hidden', mode !== 'online');
    document.getElementById('btn-start-local').classList.toggle('hidden', mode === 'online');

    updateDifficultyLabels();

    if (mode === 'online') {
        startActiveRoomsPolling();
    } else {
        stopActiveRoomsPolling();
    }
}

function setOnlineSubMode(subMode) {
    onlineState.subMode = subMode;
    document.getElementById('btn-online-sfida').classList.toggle('active', subMode === 'sfida');
    document.getElementById('btn-online-classica').classList.toggle('active', subMode === 'classica');
    updateDifficultyLabels();
}

function startActiveRoomsPolling() {
    stopActiveRoomsPolling();
    fetchAndRenderActiveRooms();

    // Aggiornamento in tempo reale su Firebase + controllo ogni 1 secondo
    if (fbDb) {
        activeRoomsRef = fbDb.ref('rooms');
        activeRoomsValueCallback = () => {
            fetchAndRenderActiveRooms();
        };
        activeRoomsRef.on('value', activeRoomsValueCallback);
    }

    activeRoomsPollInterval = setInterval(() => {
        fetchAndRenderActiveRooms();
    }, 1000);
}

function stopActiveRoomsPolling() {
    if (activeRoomsPollInterval) {
        clearInterval(activeRoomsPollInterval);
        activeRoomsPollInterval = null;
    }
    if (activeRoomsRef && activeRoomsValueCallback) {
        activeRoomsRef.off('value', activeRoomsValueCallback);
    }
    activeRoomsRef = null;
    activeRoomsValueCallback = null;
}

async function fetchAndRenderActiveRooms() {
    const listEl = document.getElementById('online-active-rooms-list');
    if (!listEl || !fbDb) return;

    const menuScreen = document.getElementById('screen-menu');
    const onlineSetup = document.getElementById('online-player-setup');
    if (!menuScreen || !menuScreen.classList.contains('active') || !onlineSetup || onlineSetup.classList.contains('hidden')) {
        return;
    }

    try {
        const snap = await fbDb.ref('rooms').once('value');
        const roomsVal = snap.val() || {};
        const diffLabels = { easy: 'Facile', normal: 'Normale', hard: 'Difficile' };

        const openRooms = Object.values(roomsVal).filter(room => {
            if (!room || room.status !== 'lobby') return false;
            const count = room.players ? Object.keys(room.players).length : 0;
            const maxPlayers = room.maxPlayers || (room.subMode === 'classica' ? 2 : 10);
            return count < maxPlayers;
        });

        if (openRooms.length === 0) {
            listEl.innerHTML = `<div class="online-rooms-empty">Nessuna stanza aperta al momento. Creane una tu!</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        openRooms.forEach(room => {
            const playersArr = room.players ? Object.values(room.players).sort((a, b) => a.order - b.order) : [];
            const hostObj = playersArr.find(p => p.id === room.hostId) || playersArr[0];
            const creatorName = hostObj ? hostObj.name : 'Giocatore';
            const modeLabel = room.subMode === 'classica' ? '🎭 Versione Classica' : '⚔️ Sfida';
            const diffLabel = diffLabels[room.difficulty] || room.difficulty;
            const maxPlayers = room.maxPlayers || (room.subMode === 'classica' ? 2 : 10);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'online-room-card';
            btn.innerHTML = `
                <div class="online-room-main">
                    <span class="online-room-host">👑 ${creatorName}</span>
                    <span class="online-room-meta">Modalità: <strong>${modeLabel}</strong> • Difficoltà: <strong>${diffLabel}</strong></span>
                </div>
                <span class="online-room-count">${playersArr.length}/${maxPlayers} • Entra</span>
            `;
            btn.addEventListener('click', () => joinOnlineRoomByCode(room.code));
            fragment.appendChild(btn);
        });

        listEl.innerHTML = '';
        listEl.appendChild(fragment);
    } catch (err) {
        console.warn("Errore aggiornamento stanze attive:", err);
    }
}

async function createOnlineRoom() {
    const playerName = requireValidPlayerName();
    if (!playerName) return;
    if (!fbDb) {
        showOnlineError("Errore di connessione a Firebase.");
        return;
    }

    stopActiveRoomsPolling();

    const roomCode = generateRoomCode();
    const playerId = 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const maxPlayers = onlineState.subMode === 'classica' ? 2 : 10;

    resetOnlineLocalTracking();
    onlineState.roomCode = roomCode;
    onlineState.playerId = playerId;
    onlineState.playerName = playerName;
    onlineState.isHost = true;

    const roomData = {
        code: roomCode,
        hostId: playerId,
        subMode: onlineState.subMode,
        difficulty: gameState.difficulty,
        maxPlayers: maxPlayers,
        status: 'lobby',
        currentRound: 1,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        players: {
            [playerId]: {
                id: playerId,
                name: playerName,
                order: 1,
                totalAttempts: 0,
                totalTime: 0,
                roundsCompleted: 0,
                eliminated: false,
                currentRoundAttempt: 0,
                currentRoundSolved: false,
                roundFinished: false
            }
        }
    };

    const roomRef = fbDb.ref(`rooms/${roomCode}`);
    await roomRef.set(roomData);
    roomRef.onDisconnect().remove();

    attachRoomListener(roomRef);
    showScreen('screen-online-lobby');
}

async function joinOnlineRoomByCode(targetCode) {
    const playerName = requireValidPlayerName();
    if (!playerName) return;
    if (!fbDb) {
        showOnlineError("Errore di connessione a Firebase.");
        return;
    }

    const codeInput = (targetCode || '').trim().toUpperCase();
    if (!codeInput) return;

    const roomRef = fbDb.ref(`rooms/${codeInput}`);
    const snapshot = await roomRef.once('value');
    if (!snapshot.exists()) {
        showOnlineError("❌ La stanza non è più disponibile.");
        fetchAndRenderActiveRooms();
        return;
    }

    const room = snapshot.val();
    if (room.status !== 'lobby') {
        showOnlineError("⚠️ La partita in questa stanza è già iniziata.");
        fetchAndRenderActiveRooms();
        return;
    }

    const maxPlayers = room.maxPlayers || (room.subMode === 'classica' ? 2 : 10);
    const currentPlayers = room.players ? Object.values(room.players) : [];
    if (currentPlayers.length >= maxPlayers) {
        showOnlineError("⚠️ La stanza ha già raggiunto il numero massimo di giocatori.");
        fetchAndRenderActiveRooms();
        return;
    }

    stopActiveRoomsPolling();

    const playerId = 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    resetOnlineLocalTracking();
    onlineState.roomCode = codeInput;
    onlineState.playerId = playerId;
    onlineState.playerName = playerName;
    onlineState.isHost = false;
    onlineState.subMode = room.subMode;
    gameState.difficulty = room.difficulty;

    const playerRef = fbDb.ref(`rooms/${codeInput}/players/${playerId}`);
    await playerRef.set({
        id: playerId,
        name: playerName,
        order: currentPlayers.length + 1,
        totalAttempts: 0,
        totalTime: 0,
        roundsCompleted: 0,
        eliminated: false,
        currentRoundAttempt: 0,
        currentRoundSolved: false,
        roundFinished: false
    });

    playerRef.onDisconnect().remove();

    attachRoomListener(roomRef);
    showScreen('screen-online-lobby');
}
function updateDifficultyLabels() {
    const isMulti = gameState.mode === 'multi' || (gameState.mode === 'online' && onlineState.subMode === 'sfida');

    document.getElementById('sub-easy').innerText = isMulti
        ? '4 Caselle • 5 Colori • 10 Tentativi • Eliminazione a 20'
        : '4 Caselle • 5 Colori • 10 Tentativi';

    document.getElementById('sub-normal').innerText = isMulti
        ? '4 Caselle • 6 Colori • 10 Tentativi • Eliminazione a 23'
        : '4 Caselle • 6 Colori • 10 Tentativi';

    document.getElementById('sub-hard').innerText = isMulti
        ? '5 Caselle • 8 Colori • 10 Tentativi • Eliminazione a 26'
        : '5 Caselle • 8 Colori • 10 Tentativi';
}

function setDifficulty(diff) {
    gameState.difficulty = diff;
    document.querySelectorAll('.btn-diff').forEach(b => b.classList.remove('active'));
    document.getElementById(`diff-${diff}`).classList.add('active');
}

function renderMultiPlayerInputs() {
    const container = document.getElementById('multi-player-inputs');
    const count = parseInt(document.getElementById('num-players').value, 10);
    const savedFirstName = getSavedPlayerName();
    container.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const div = document.createElement('div');
        div.className = 'form-group';
        const defaultVal = (i === 1 && savedFirstName) ? savedFirstName.replace(/"/g, '&quot;') : '';
        div.innerHTML = `
            <label>Giocatore ${i}:</label>
            <input type="text" id="multi-player-name-${i}" value="${defaultVal}" placeholder="Obbligatorio: Giocatore ${i}..." maxlength="15" required>
        `;
        container.appendChild(div);
    }
}
/* ==========================================================================
   MULTIPLAYER ONLINE (FIREBASE REALTIME DATABASE)
   ========================================================================== */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function showOnlineError(msg) {
    const el = document.getElementById('online-error-msg');
    el.innerText = msg;
    el.classList.remove('hidden');
}

function clearOnlineError() {
    const el = document.getElementById('online-error-msg');
    el.innerText = '';
    el.classList.add('hidden');
}


function resetOnlineLocalTracking() {
    onlineState.lastProcessedRound = 0;
    onlineState.wheelSpunForRound = 0;
    onlineState.classicRole = null;
    onlineState.codemakerSecretDraft = [];
    onlineState.codemakerFeedbackDraft = [];
    onlineState.pendingRowIndex = null;
    onlineState.lastRenderedAttemptCount = 0;
    onlineState.hasFinishedCurrentRound = false;
    onlineState.matchEndedProcessed = false;
}

function attachRoomListener(roomRef) {
    detachRoomListener();
    onlineState.roomRef = roomRef;
    onlineState.roomListener = roomRef.on('value', (snap) => {
        if (!snap.exists()) {
            // La stanza è stata svuotata/chiusa
            stopTimer();
            detachRoomListener();
            document.getElementById('modal-online-wait').classList.add('hidden');
            document.getElementById('modal-wheel').classList.add('hidden');
            if (document.getElementById('modal-gameover').classList.contains('hidden')) {
                showScreen('screen-menu');
            }
            return;
        }
        handleOnlineRoomUpdate(snap.val());
    });
}

function detachRoomListener() {
    if (onlineState.roomRef && onlineState.roomListener) {
        onlineState.roomRef.off('value', onlineState.roomListener);
    }
    onlineState.roomRef = null;
    onlineState.roomListener = null;
}

async function leaveOnlineRoom() {
    stopTimer();
    if (onlineState.roomRef && onlineState.roomCode) {
        const roomRef = onlineState.roomRef;
        const isHost = onlineState.isHost;
        const playerId = onlineState.playerId;
        detachRoomListener();

        if (isHost) {
            await roomRef.remove(); // Svuota l'intera stanza
        } else if (playerId) {
            await fbDb.ref(`rooms/${onlineState.roomCode}/players/${playerId}`).remove();
        }
    }
    document.getElementById('modal-online-wait').classList.add('hidden');
    document.getElementById('modal-wheel').classList.add('hidden');
    document.getElementById('modal-gameover').classList.add('hidden');
    showScreen('screen-menu');
}

function handleOnlineRoomUpdate(room) {
    if (!room) return;
    const playersList = room.players ? Object.values(room.players).sort((a, b) => a.order - b.order) : [];
    gameState.players = playersList;

    if (room.status === 'lobby') {
        showScreen('screen-online-lobby');
        renderOnlineLobby(room, playersList);
        return;
    }

    if (room.subMode === 'classica' && room.classic && room.classic.phase === 'round1_over') {
        handleOnlineMatchFinished(room, playersList);
        return;
    }

    if (room.status === 'finished') {
        handleOnlineMatchFinished(room, playersList);
        return;
    }

    if (room.status === 'playing') {
        if (room.subMode === 'sfida') {
            handleOnlineSfidaState(room, playersList);
        } else {
            handleOnlineClassicaState(room, playersList);
        }
    }
}
function renderOnlineLobby(room, playersList) {
    document.getElementById('lobby-room-code').innerText = room.code;
    const modeLabel = room.subMode === 'sfida' ? '⚔️ Sfida' : '🎭 Versione Classica (1 vs 1)';
    const diffLabel = { easy: 'Facile', normal: 'Normale', hard: 'Difficile' }[room.difficulty];
    document.getElementById('lobby-mode-info').innerText = `${modeLabel} • Difficoltà: ${diffLabel} (${playersList.length}/${room.maxPlayers} giocatori)`;

    const tbody = document.getElementById('lobby-players-list');
    tbody.innerHTML = '';
    playersList.forEach((p, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${p.name}</strong> ${p.id === onlineState.playerId ? '(Tu)' : ''}</td>
            <td>${p.id === room.hostId ? '👑 Host' : 'Ospite'}</td>
            <td>✅ Pronto</td>
        `;
        tbody.appendChild(tr);
    });

    const startBtn = document.getElementById('btn-start-online-match');
    const waitText = document.getElementById('lobby-wait-text');

    if (onlineState.isHost) {
        const canStart = playersList.length >= 2;
        startBtn.classList.remove('hidden');
        startBtn.disabled = !canStart;
        waitText.innerText = canStart
            ? 'Tutti pronti! Premi AVVIA PARTITA per iniziare.'
            : `In attesa di almeno 2 giocatori (${playersList.length}/${room.maxPlayers})...`;
    } else {
        startBtn.classList.add('hidden');
        waitText.innerText = 'In attesa che l\'Host avvii la partita...';
    }
}

async function hostStartOnlineMatch() {
    if (!onlineState.isHost || !onlineState.roomRef) return;
    const snap = await onlineState.roomRef.once('value');
    const room = snap.val();
    const settings = DIFFICULTY_SETTINGS[room.difficulty];
    const players = Object.values(room.players || {}).sort((a, b) => a.order - b.order);

    if (room.subMode === 'sfida') {
        const sharedCode = generateSecretCode(settings.slots, settings.colors);
        await onlineState.roomRef.update({
            status: 'playing',
            currentRound: 1,
            sharedSecretCode: sharedCode
        });
    } else {
        // Round 1: sorteggio con Ruota della Fortuna (chi ottiene il rosso fa il Codemaker nel Round 1)
        const hostGetsRed = Math.random() < 0.5;
        const round1CodemakerId = hostGetsRed ? players[0].id : players[1].id;
        const round1CodebreakerId = hostGetsRed ? players[1].id : players[0].id;

        const extraSpins = Math.floor(Math.random() * 6) + 4;
        const spinDurationSec = parseFloat((Math.random() * 2.0 + 3.2).toFixed(2));
        const randomSectorOffset = Math.floor(Math.random() * 23) + 4;

        await onlineState.roomRef.update({
            status: 'playing',
            currentRound: 1,
            classic: {
                round1CodemakerId: round1CodemakerId,
                round1CodebreakerId: round1CodebreakerId,
                wheelTargetHostRed: hostGetsRed,
                wheelSpins: extraSpins,
                wheelDurationSec: spinDurationSec,
                wheelSectorOffset: randomSectorOffset,
                codemakerId: round1CodemakerId,
                codebreakerId: round1CodebreakerId,
                phase: 'wheel',
                secretCode: [],
                attempts: [],
                round1Result: null,
                round2Result: null
            }
        });
    }
}
function spinFortuneWheel(classicOrHostRed, amICodemaker) {
    const modal = document.getElementById('modal-wheel');
    const wheel = document.getElementById('fortune-wheel');
    const resultText = document.getElementById('wheel-result-text');

    const classic = typeof classicOrHostRed === 'object' && classicOrHostRed !== null ? classicOrHostRed : null;
    const hostGetsRed = classic ? Boolean(classic.wheelTargetHostRed) : Boolean(classicOrHostRed);
    const spins = classic && classic.wheelSpins ? classic.wheelSpins : (Math.floor(Math.random() * 5) + 5);
    const durationSec = classic && classic.wheelDurationSec ? classic.wheelDurationSec : (Math.random() * 1.8 + 3.4);
    const offset = classic && classic.wheelSectorOffset ? classic.wheelSectorOffset : (Math.floor(Math.random() * 23) + 4);

    // Con spicchi da 30°: Host ha rosso [0..30], Guest ha rosso [30..60]
    const baseAngle = hostGetsRed ? (360 - offset) : (360 - 30 - offset);
    const targetRotation = spins * 360 + baseAngle;

    wheel.className = `fortune-wheel ${onlineState.isHost ? 'wheel-host' : 'wheel-guest'}`;
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    resultText.innerText = 'La ruota sta girando...';
    modal.classList.remove('hidden');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            wheel.style.transition = `transform ${durationSec}s cubic-bezier(0.15, 0.72, 0.14, 1)`;
            wheel.style.transform = `rotate(${targetRotation}deg)`;
        });
    });

    setTimeout(() => {
        resultText.innerHTML = amICodemaker
            ? '🔴 È uscito <strong>ROSSO</strong>! Tocca a te scegliere il codice segreto!'
            : '⚪ È uscito <strong>BIANCO</strong>! L\'avversario sceglierà il codice e tu dovrai indovinarlo!';

        if (onlineState.isHost) {
            setTimeout(() => {
                fbDb.ref(`rooms/${onlineState.roomCode}/classic/phase`).set('picking_secret');
            }, 2000);
        }
    }, Math.round(durationSec * 1000) + 150);
}

/* ==========================================================================
   LOGICA ONLINE MODALITÀ 1: "SFIDA" (CODICE CONDIVISO, ATTESA FINE MANCHE)
   ========================================================================== */
function handleOnlineSfidaState(room, playersList) {
    const settings = DIFFICULTY_SETTINGS[room.difficulty];
    gameState.maxAttemptsPerRound = settings.maxAttemptsPerRound;
    gameState.currentRound = room.currentRound;

    // Avvio nuova manche per tutti
    if (onlineState.lastProcessedRound !== room.currentRound) {
        onlineState.lastProcessedRound = room.currentRound;
        onlineState.hasFinishedCurrentRound = false;
        document.getElementById('modal-online-wait').classList.add('hidden');
        document.getElementById('btn-start-next-online-round').classList.add('hidden');

        gameState.secretCode = room.sharedSecretCode;
        gameState.currentAttemptInRound = 0;
        gameState.playedRows = [];
        gameState.selectedColorId = null;

        document.getElementById('classic-secret-banner').classList.add('hidden');
        document.getElementById('codebreaker-controls').classList.remove('hidden');
        document.getElementById('codemaker-controls').classList.add('hidden');

        const me = playersList.find(p => p.id === onlineState.playerId);
        document.getElementById('current-player-name').innerText = onlineState.playerName;
        document.getElementById('multi-turn-badge').style.display = 'inline-block';
        document.getElementById('current-turn-info').innerText =
            `Giro ${room.currentRound} • Tentativi Tot: ${me ? me.totalAttempts : 0}/${settings.eliminationLimit}`;

        document.getElementById('live-ranking-container').classList.remove('hidden');
        renderPalette();
        renderBoard();
        showScreen('screen-game');

        if (me && me.eliminated) {
            onlineState.hasFinishedCurrentRound = true;
            document.getElementById('modal-online-wait').classList.remove('hidden');
            document.getElementById('online-wait-message').innerText =
                '❌ Sei stato eliminato nei giri precedenti. Segui il progresso degli altri giocatori!';
        } else {
            startTimer();
        }
    }

    updateOnlineSfidaRankings(playersList, settings);

    // Controlla se tutti i giocatori attivi hanno finito il round corrente
    const stillAlive = playersList.filter(p => !p.eliminated);
    const allAliveFinishedRound = stillAlive.length > 0 && stillAlive.every(p => p.roundFinished);

    const nextRoundBtn = document.getElementById('btn-start-next-online-round');
    const waitMsgEl = document.getElementById('online-wait-message');

    if (stillAlive.length === 0) {
        if (onlineState.isHost) {
            onlineState.roomRef.update({ status: 'finished' });
        }
        return;
    }

    if (allAliveFinishedRound) {
        if (!document.getElementById('modal-online-wait').classList.contains('hidden') || onlineState.hasFinishedCurrentRound) {
            document.getElementById('modal-online-wait').classList.remove('hidden');
        }
        if (onlineState.isHost) {
            waitMsgEl.innerHTML = `✅ Tutti i giocatori hanno completato il <strong>Giro ${room.currentRound}</strong>! Premi il pulsante per iniziare il prossimo round.`;
            nextRoundBtn.classList.remove('hidden');
            nextRoundBtn.disabled = false;
        } else {
            waitMsgEl.innerHTML = `✅ Tutti hanno completato il <strong>Giro ${room.currentRound}</strong>! In attesa che l'Host avvii il prossimo round...`;
            nextRoundBtn.classList.add('hidden');
        }
    } else {
        nextRoundBtn.classList.add('hidden');
    }
}

async function hostStartNextOnlineRound() {
    if (!onlineState.isHost || !onlineState.roomRef) return;
    const btn = document.getElementById('btn-start-next-online-round');
    if (btn) btn.disabled = true;

    const snap = await onlineState.roomRef.once('value');
    const room = snap.val();
    if (!room) return;

    const settings = DIFFICULTY_SETTINGS[room.difficulty];
    const playersList = room.players ? Object.values(room.players) : [];
    const nextRound = room.currentRound + 1;
    const nextCode = generateSecretCode(settings.slots, settings.colors);

    const updates = {
        currentRound: nextRound,
        sharedSecretCode: nextCode
    };

    playersList.forEach(p => {
        updates[`players/${p.id}/roundFinished`] = false;
        updates[`players/${p.id}/currentRoundAttempt`] = 0;
        updates[`players/${p.id}/currentRoundSolved`] = false;
    });

    await onlineState.roomRef.update(updates);
}

function updateOnlineSfidaRankings(playersList, settings) {
    const sorted = [...playersList].sort((a, b) => {
        if (a.roundsCompleted !== b.roundsCompleted) return b.roundsCompleted - a.roundsCompleted;
        if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
        return a.totalTime - b.totalTime;
    });

    // Sidebar in-game
    const sideContainer = document.getElementById('live-ranking-list');
    sideContainer.innerHTML = '';
    sorted.forEach(p => {
        const item = document.createElement('div');
        item.className = `live-ranking-item ${p.id === onlineState.playerId ? 'active-player' : ''} ${p.eliminated ? 'eliminated-player' : ''}`;
        const rowProgress = `${p.currentRoundAttempt || 0}/${settings.maxAttemptsPerRound} righe`;
        let status = p.eliminated ? '❌ Elim.' : (p.roundFinished ? '✅ Finito' : `⏳ ${rowProgress}`);
        item.innerHTML = `<span><strong>${p.name}</strong></span><span class="player-stat-badge">${status}</span>`;
        sideContainer.appendChild(item);
    });

    // Tabella live nella modale di attesa
    const waitBody = document.getElementById('online-wait-ranking-body');
    waitBody.innerHTML = '';
    sorted.forEach((p, idx) => {
        const tr = document.createElement('tr');
        const rowsDone = p.currentRoundAttempt || 0;
        const rowText = p.currentRoundSolved
            ? `🎯 Risolto (${rowsDone}/${settings.maxAttemptsPerRound})`
            : `${rowsDone}/${settings.maxAttemptsPerRound} righe`;
        const stateLabel = p.eliminated
            ? '❌ Eliminato'
            : (p.roundFinished ? (p.currentRoundSolved ? '✅ Indovinato' : '⏹️ Terminato') : '⏳ In gioco...');

        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${p.name}</strong> ${p.id === onlineState.playerId ? '(Tu)' : ''}</td>
            <td><strong>${rowText}</strong></td>
            <td>${stateLabel}</td>
            <td>${p.roundsCompleted}</td>
            <td>${p.totalAttempts}</td>
        `;
        waitBody.appendChild(tr);
    });
}

async function finishOnlineSfidaRound(isCorrect) {
    if (onlineState.hasFinishedCurrentRound) return;
    onlineState.hasFinishedCurrentRound = true;
    stopTimer();

    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    const me = gameState.players.find(p => p.id === onlineState.playerId);
    if (!me || !onlineState.roomCode) return;

    const newTotalAttempts = me.totalAttempts + gameState.currentAttemptInRound;
    const newTotalTime = me.totalTime + gameState.currentTurnSeconds;
    const newRoundsCompleted = me.roundsCompleted + (isCorrect ? 1 : 0);
    const isEliminated = newTotalAttempts >= settings.eliminationLimit;

    document.getElementById('online-wait-message').innerHTML = isCorrect
        ? `🎉 Hai indovinato in <strong>${gameState.currentAttemptInRound}</strong> tentativi! Ecco a che punto sono gli altri:`
        : `💥 Tentativi esauriti! Ecco a che punto sono gli altri:`;
    document.getElementById('modal-online-wait').classList.remove('hidden');

    await fbDb.ref(`rooms/${onlineState.roomCode}/players/${onlineState.playerId}`).update({
        totalAttempts: newTotalAttempts,
        totalTime: newTotalTime,
        roundsCompleted: newRoundsCompleted,
        eliminated: isEliminated,
        currentRoundAttempt: gameState.currentAttemptInRound,
        currentRoundSolved: isCorrect,
        roundFinished: true
    });
}

/* ==========================================================================
   LOGICA ONLINE MODALITÀ 2: "VERSIONE CLASSICA" (RUOTA + CODEMAKER/BREAKER)
   ========================================================================== */
function handleOnlineClassicaState(room, playersList) {
    const classic = room.classic;
    if (!classic) return;
    const settings = DIFFICULTY_SETTINGS[room.difficulty];
    gameState.maxAttemptsPerRound = settings.maxAttemptsPerRound;
    gameState.currentRound = room.currentRound;

    const amICodemaker = classic.codemakerId === onlineState.playerId;
    onlineState.classicRole = amICodemaker ? 'codemaker' : 'codebreaker';

    document.getElementById('live-ranking-container').classList.add('hidden');
    document.getElementById('multi-turn-badge').style.display = 'inline-block';
    document.getElementById('current-player-name').innerText = onlineState.playerName;
    document.getElementById('current-turn-info').innerText = amICodemaker
        ? `Round ${room.currentRound}/2 • 🎭 Codemaker`
        : `Round ${room.currentRound}/2 • 🔍 Codebreaker`;

    // 1. Fase Ruota della Fortuna
    if (classic.phase === 'wheel') {
        if (onlineState.wheelSpunForRound !== room.currentRound) {
            onlineState.wheelSpunForRound = room.currentRound;
            spinFortuneWheel(classic, amICodemaker);
        }
        return;
    }

    document.getElementById('modal-wheel').classList.add('hidden');
    showScreen('screen-game');

    // Inizializza plancia se nuovo round (timer fermo finché il codice non viene inviato)
    const roundKey = `${room.currentRound}_${classic.phase === 'picking_secret' ? 'pick' : 'play'}`;
    if (onlineState.lastClassicRoundKey !== roundKey) {
        onlineState.lastClassicRoundKey = roundKey;
        onlineState.codemakerSecretDraft = new Array(settings.slots).fill(null);
        onlineState.codemakerFeedbackDraft = [];
        onlineState.pendingRowIndex = null;
        onlineState.codebreakerNotifiedReady = false;
        onlineState.codebreakerTimerStarted = false;
        gameState.playedRows = [];
        gameState.currentAttemptInRound = 0;
        gameState.currentTurnSeconds = 0;
        stopTimer();
        updateTimerDisplay();
        renderPalette();
        renderBoard();
        syncClassicSecretFeedbackSlots(settings.slots);
    }

    // Nascondi eventuale modale di fine round precedente quando riparte il gioco
    if (classic.phase === 'picking_secret' || classic.phase === 'guessing') {
        document.getElementById('modal-gameover').classList.add('hidden');
        document.getElementById('btn-start-classic-round2').classList.add('hidden');
    }

    // Il banner del codice segreto è visibile SOLO a chi crea il codice
    const secretBanner = document.getElementById('classic-secret-banner');
    const confirmSecretBtn = document.getElementById('btn-confirm-secret-code');
    if (secretBanner) {
        secretBanner.classList.toggle('hidden', !amICodemaker);
    }

    // Controlli sempre visibili in base al ruolo
    const cbControls = document.getElementById('codebreaker-controls');
    const cmControls = document.getElementById('codemaker-controls');
    if (amICodemaker) {
        cmControls.classList.remove('hidden');
        cbControls.classList.add('hidden');
        if (onlineState.codemakerMistakeNotice) {
            setClassicStatusBanner('waiting', '⚠️', onlineState.codemakerMistakeNotice);
        } else {
            hideClassicStatusBanner();
        }
    } else {
        cbControls.classList.remove('hidden');
        cmControls.classList.add('hidden');
    }

    // 2. Fase Scelta del Codice Segreto (timer fermo)
    if (classic.phase === 'picking_secret') {
        setCodemakerFeedbackButtonsEnabled(false);

        if (amICodemaker) {
            confirmSecretBtn.classList.remove('hidden');
            renderCodemakerSecretPicker(settings.slots);
        } else {
            confirmSecretBtn.classList.add('hidden');
            setClassicStatusBanner(
                'waiting',
                '⏳',
                "L'avversario sta scegliendo il codice segreto... Il timer partirà quando invierà il codice!"
            );
        }
        return;
    }

    // 3. Fase di Indovinamento e Valutazione Indizi
    confirmSecretBtn.classList.add('hidden');
    gameState.secretCode = classic.secretCode || [];

    if (amICodemaker) {
        renderRevealedSecretBanner(gameState.secretCode);
    } else {
        if (classic.phase === 'guessing') {
            if (!onlineState.codebreakerTimerStarted) {
                onlineState.codebreakerTimerStarted = true;
                startTimer();
            } else {
                // Riprende il timer dopo che il Codemaker ha aggiunto i pioli rosso/bianco
                resumeTimer();
            }
        } else if (classic.phase === 'awaiting_feedback') {
            stopTimer();
        }

        const hasAttempts = classic.attempts && classic.attempts.length > 0;
        if (!hasAttempts && classic.phase === 'guessing') {
            if (!onlineState.codebreakerNotifiedReady) {
                onlineState.codebreakerNotifiedReady = true;
                AudioEngine.playPegSelect();
            }
            setClassicStatusBanner(
                'ready',
                '🟢',
                'Codice impostato! Il timer è partito: componi la riga e premi VERIFICA COMBINAZIONE!'
            );
        } else {
            hideClassicStatusBanner();
        }
    }

    const attempts = classic.attempts || [];
    syncClassicBoardFromFirebase(attempts, classic.phase, amICodemaker, settings);
}

function setClassicStatusBanner(stateType, icon, text) {
    const banner = document.getElementById('classic-status-banner');
    const iconEl = document.getElementById('classic-status-icon');
    const textEl = document.getElementById('classic-status-text');
    if (!banner || !iconEl || !textEl) return;

    banner.classList.remove('hidden', 'status-waiting', 'status-ready');
    banner.classList.add(stateType === 'ready' ? 'status-ready' : 'status-waiting');
    iconEl.innerText = icon;
    textEl.innerText = text;
}

function hideClassicStatusBanner() {
    const banner = document.getElementById('classic-status-banner');
    if (banner) banner.classList.add('hidden');
}
function setCodemakerFeedbackButtonsEnabled(enabled) {
    const cmControls = document.getElementById('codemaker-controls');
    if (!cmControls) return;
    cmControls.querySelectorAll('button').forEach(btn => {
        if (btn.id === 'btn-send-feedback') {
            btn.disabled = !enabled || onlineState.pendingRowIndex === null;
        } else {
            btn.disabled = !enabled;
        }
    });
}
function renderCoveredSecretSlots(slotsCount) {
    const container = document.getElementById('classic-secret-slots');
    container.innerHTML = '';
    for (let i = 0; i < slotsCount; i++) {
        const peg = document.createElement('div');
        peg.className = 'peg peg-hidden';
        peg.innerText = '?';
        container.appendChild(peg);
    }
}

function renderRevealedSecretBanner(code) {
    const container = document.getElementById('classic-secret-slots');
    container.innerHTML = '';
    code.forEach(colorId => {
        const colorObj = COLOR_DEFINITIONS.find(c => c.id === colorId);
        const peg = document.createElement('div');
        peg.className = `peg ${colorObj.class}`;
        container.appendChild(peg);
    });
}

function renderCodemakerSecretPicker(slotsCount) {
    const container = document.getElementById('classic-secret-slots');
    container.innerHTML = '';
    for (let i = 0; i < slotsCount; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const colorId = onlineState.codemakerSecretDraft[i];
        if (colorId) {
            const colorObj = COLOR_DEFINITIONS.find(c => c.id === colorId);
            const peg = document.createElement('div');
            peg.className = `peg ${colorObj.class} peg-place-anim`;
            slot.appendChild(peg);
        }
        slot.addEventListener('click', () => {
            if (gameState.selectedColorId) {
                onlineState.codemakerSecretDraft[i] = gameState.selectedColorId;
                AudioEngine.playPegPlace();
            } else if (onlineState.codemakerSecretDraft[i]) {
                onlineState.codemakerSecretDraft[i] = null;
                AudioEngine.playPegMove();
            }
            renderCodemakerSecretPicker(slotsCount);
            const ready = onlineState.codemakerSecretDraft.every(c => c !== null);
            document.getElementById('btn-confirm-secret-code').disabled = !ready;
        });
        container.appendChild(slot);
    }
}

async function confirmCodemakerSecret() {
    if (!onlineState.codemakerSecretDraft.every(c => c !== null)) return;
    AudioEngine.playSubmit();
    await fbDb.ref(`rooms/${onlineState.roomCode}/classic`).update({
        secretCode: onlineState.codemakerSecretDraft,
        phase: 'guessing'
    });
}

function syncClassicBoardFromFirebase(attempts, phase, amICodemaker, settings) {
    const rows = document.querySelectorAll('.board-row');

    attempts.forEach((att, idx) => {
        const row = rows[idx];
        if (!row) return;
        const slots = row.querySelectorAll('.slot');
        att.pegs.forEach((colorId, sIdx) => {
            if (!slots[sIdx].hasChildNodes()) {
                const colorObj = COLOR_DEFINITIONS.find(c => c.id === colorId);
                const peg = document.createElement('div');
                peg.className = `peg ${colorObj.class}`;
                slots[sIdx].appendChild(peg);
            }
        });

        // Quando il feedback è stato inviato, compare sulla riga corrispondente del tentativo
        if (att.feedback) {
            const fbPegs = row.querySelectorAll('.feedback-peg');
            fbPegs.forEach(p => p.classList.remove('black', 'white'));
            let fbIdx = 0;
            for (let b = 0; b < att.feedback.black; b++) {
                if (fbPegs[fbIdx]) fbPegs[fbIdx++].classList.add('black');
            }
            for (let w = 0; w < att.feedback.white; w++) {
                if (fbPegs[fbIdx]) fbPegs[fbIdx++].classList.add('white');
            }
            row.classList.remove('active-row');
            row.classList.add('completed-row');

            if (!amICodemaker) {
                gameState.playedRows[idx] = [...att.pegs];
                const copyBtn = row.querySelector('.row-copy-btn');
                if (copyBtn) copyBtn.disabled = false;
            }
        }
    });

    const completedCount = attempts.filter(a => a.feedback).length;
    gameState.currentAttemptInRound = completedCount;

    if (phase === 'guessing') {
        // Svuota i pioli di ispezione dalla riga 0 una volta tornati alla fase di gioco
        syncClassicSecretFeedbackSlots(settings.slots);

        if (amICodemaker) {
            onlineState.pendingRowIndex = null;
            setCodemakerFeedbackButtonsEnabled(false);
        } else {
            rows.forEach((r, rIdx) => {
                r.classList.toggle('active-row', rIdx === completedCount);
                if (rIdx === completedCount && !r.dataset.listenersBound) {
                    r.dataset.listenersBound = 'true';
                    gameState.currentRowPegs = new Array(settings.slots).fill(null);
                    r.querySelectorAll('.slot').forEach((slot, sIdx) => {
                        slot.addEventListener('dragover', handleDragOver);
                        slot.addEventListener('drop', handleDrop);
                        slot.addEventListener('click', () => handleSlotClick(sIdx));
                    });
                }
            });
            updateSubmitButtonState();
        }
    } else if (phase === 'awaiting_feedback') {
        const targetIdx = attempts.length - 1;
        rows.forEach((r, rIdx) => r.classList.toggle('active-row', rIdx === targetIdx));

        if (!amICodemaker) {
            document.getElementById('btn-submit').disabled = true;
        } else {
            if (onlineState.pendingRowIndex !== targetIdx) {
                onlineState.pendingRowIndex = targetIdx;
                onlineState.codemakerFeedbackDraft = [];
                syncClassicSecretFeedbackSlots(settings.slots);
            }
            setCodemakerFeedbackButtonsEnabled(true);
            renderCodemakerFeedbackPreview();
        }
    }
}

function syncClassicSecretFeedbackSlots(slotsCount) {
    const fbContainer = document.getElementById('classic-secret-feedback');
    if (!fbContainer) return;
    fbContainer.innerHTML = '';
    for (let f = 0; f < slotsCount; f++) {
        const peg = document.createElement('div');
        peg.className = 'feedback-peg';
        fbContainer.appendChild(peg);
    }
}

function addCodemakerFeedbackPeg(type) {
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    if (onlineState.codemakerFeedbackDraft.length >= settings.slots) return;
    onlineState.codemakerFeedbackDraft.push(type);
    AudioEngine.playPegPlace();
    renderCodemakerFeedbackPreview(onlineState.pendingRowIndex);
}

function clearCodemakerFeedbackPegs() {
    onlineState.codemakerFeedbackDraft = [];
    AudioEngine.playPegMove();
    renderCodemakerFeedbackPreview(onlineState.pendingRowIndex);
}

function renderCodemakerFeedbackPreview() {
    // Mostra i pioli rosso/bianco in anteprima sulla riga 0 mentre il Codemaker ispeziona il tentativo
    const fbContainer = document.getElementById('classic-secret-feedback');
    if (!fbContainer) return;
    const fbPegs = fbContainer.querySelectorAll('.feedback-peg');
    fbPegs.forEach(p => p.classList.remove('black', 'white'));

    onlineState.codemakerFeedbackDraft.forEach((type, idx) => {
        if (fbPegs[idx]) fbPegs[idx].classList.add(type);
    });

    document.getElementById('btn-send-feedback').disabled = false;
}

async function submitCodemakerFeedback() {
    const idx = onlineState.pendingRowIndex;
    if (idx === null || idx === undefined) return;
    if (!onlineState.roomRef) return;

    const submittedBlack = onlineState.codemakerFeedbackDraft.filter(x => x === 'black').length;
    const submittedWhite = onlineState.codemakerFeedbackDraft.filter(x => x === 'white').length;
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];

    try {
        const snap = await onlineState.roomRef.once('value');
        const room = snap.val();
        if (!room || !room.classic) return;

        const classic = room.classic;
        const attemptsArr = Array.isArray(classic.attempts) ? classic.attempts : Object.values(classic.attempts || {});
        const attemptObj = attemptsArr[idx] || null;
        const guessPegs = attemptObj && Array.isArray(attemptObj.pegs) ? attemptObj.pegs : [];
        const expected = evaluateMastermindFeedback(classic.secretCode || [], guessPegs);

        const madeMistake = (submittedBlack !== expected.black) || (submittedWhite !== expected.white);
        const makerId = classic.codemakerId;
        const breakerId = classic.codebreakerId;

        AudioEngine.playSubmit();
        onlineState.pendingRowIndex = null;
        onlineState.codemakerFeedbackDraft = [];
        setCodemakerFeedbackButtonsEnabled(false);
        syncClassicSecretFeedbackSlots(settings.slots);

        const updates = {
            [`classic/attempts/${idx}/feedback`]: {
                black: expected.black,
                white: expected.white
            }
        };

        if (madeMistake) {
            onlineState.codemakerMistakeNotice =
                `Indizi corretti inviati al Codebreaker! Hai sbagliato i pioli (attesi ${expected.black} rossi, ${expected.white} bianchi): +10s di penalità al tuo tempo.`;
            if (makerId && room.players && room.players[makerId]) {
                const currentMakerTime = room.players[makerId].totalTime || 0;
                const currentMakerPenalty = room.players[makerId].penaltySeconds || 0;
                updates[`players/${makerId}/totalTime`] = currentMakerTime + 10;
                updates[`players/${makerId}/penaltySeconds`] = currentMakerPenalty + 10;
            }
        } else {
            onlineState.codemakerMistakeNotice = null;
        }

        const isSolved = expected.black === settings.slots;
        const isOutOfAttempts = (idx + 1) >= settings.maxAttemptsPerRound;

        if (isSolved || isOutOfAttempts) {
            stopTimer();
            const rowsUsed = idx + 1;
            const roundTime = typeof classic.breakerElapsedSeconds === 'number'
                ? classic.breakerElapsedSeconds
                : (gameState.currentTurnSeconds || 0);

            if (breakerId && room.players && room.players[breakerId]) {
                updates[`players/${breakerId}/totalAttempts`] = (room.players[breakerId].totalAttempts || 0) + rowsUsed;
                updates[`players/${breakerId}/totalTime`] = (room.players[breakerId].totalTime || 0) + roundTime;
                updates[`players/${breakerId}/roundsCompleted`] = (room.players[breakerId].roundsCompleted || 0) + (isSolved ? 1 : 0);

                // Salva il record nella classifica Classica condivisa su Firebase se il codice è stato indovinato
                if (isSolved && room.players[breakerId].name) {
                    await pushRecordToFirebaseLeaderboard('classica', room.difficulty, {
                        name: room.players[breakerId].name,
                        attempts: rowsUsed,
                        time: roundTime
                    });
                }
            }

            if ((room.currentRound || 1) === 1) {
                updates['classic/round1Result'] = {
                    codebreakerId: breakerId || '',
                    codemakerId: makerId || '',
                    rowsUsed: rowsUsed,
                    solved: isSolved,
                    time: roundTime
                };
                updates['classic/phase'] = 'round1_over';
            } else {
                updates['classic/round2Result'] = {
                    codebreakerId: breakerId || '',
                    codemakerId: makerId || '',
                    rowsUsed: rowsUsed,
                    solved: isSolved,
                    time: roundTime
                };
                updates['status'] = 'finished';
            }

            await onlineState.roomRef.update(updates);
        } else {
            updates['classic/phase'] = 'guessing';
            await onlineState.roomRef.update(updates);
        }
    } catch (err) {
        console.error("Errore invio indizi Codemaker:", err);
    }
}

function handleOnlineMatchFinished(room, playersList) {
    stopTimer();
    document.getElementById('modal-online-wait').classList.add('hidden');
    document.getElementById('modal-wheel').classList.add('hidden');

    const modal = document.getElementById('modal-gameover');
    const btnRound2 = document.getElementById('btn-start-classic-round2');
    const btnRestart = document.getElementById('btn-go-restart');

    if (room.subMode === 'classica' && room.classic && room.classic.phase === 'round1_over') {
        const r1 = room.classic.round1Result;
        const breaker = playersList.find(p => p.id === r1.codebreakerId);
        const maker = playersList.find(p => p.id === r1.codemakerId);
        const makerPenalty = maker ? (maker.penaltySeconds || 0) : 0;

        document.getElementById('go-title').innerText = 'ROUND 1 COMPLETATO!';
        document.getElementById('go-message').innerHTML = onlineState.isHost
            ? `<strong>${breaker ? breaker.name : 'Codebreaker'}</strong> ha concluso il Round 1. Premi per avviare il Round 2 a parti invertite!`
            : `<strong>${breaker ? breaker.name : 'Codebreaker'}</strong> ha concluso il Round 1. In attesa che l'Host avvii il Round 2...`;

        renderSecretReveal(room.classic.secretCode || []);
        document.getElementById('go-stats').innerHTML = `
            <div><strong>${breaker ? breaker.name : 'Codebreaker'}</strong> ${r1.rowsUsed}/${gameState.maxAttemptsPerRound}</div>
            <div><strong>${breaker ? breaker.name : 'Codebreaker'}</strong> ${formatTime(r1.time || 0)}</div>
            <div><strong>${maker ? maker.name : 'Codemaker'} (Penalità):</strong> +${makerPenalty}s</div>
        `;
        document.getElementById('go-multi-leaderboard').classList.add('hidden');

        btnRestart.classList.add('hidden');
        if (onlineState.isHost) {
            btnRound2.classList.remove('hidden');
            btnRound2.disabled = false;
        } else {
            btnRound2.classList.add('hidden');
        }
        modal.classList.remove('hidden');
        return;
    }

    btnRound2.classList.add('hidden');

    const ranked = [...playersList].sort((a, b) => {
        if (a.roundsCompleted !== b.roundsCompleted) return b.roundsCompleted - a.roundsCompleted;
        if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
        return a.totalTime - b.totalTime;
    });

    if (room.subMode === 'classica') {
        const classic = room.classic;
        const r1 = classic.round1Result || { codebreakerId: '', codemakerId: '', rowsUsed: 99, solved: false, time: 999999 };
        const r2 = classic.round2Result || { codebreakerId: '', codemakerId: '', rowsUsed: 99, solved: false, time: 999999 };

        const p1 = playersList.find(p => p.id === r1.codebreakerId);
        const p2 = playersList.find(p => p.id === r2.codebreakerId);

        const p1Time = (p1 && typeof p1.totalTime === 'number') ? p1.totalTime : (r1.time || 0);
        const p2Time = (p2 && typeof p2.totalTime === 'number') ? p2.totalTime : (r2.time || 0);
        const p1Penalty = p1 ? (p1.penaltySeconds || 0) : 0;
        const p2Penalty = p2 ? (p2.penaltySeconds || 0) : 0;

        const score1Rows = r1.solved ? r1.rowsUsed : 999;
        const score2Rows = r2.solved ? r2.rowsUsed : 999;

        let winner = null;
        let isTie = false;
        if (score1Rows < score2Rows) {
            winner = p1;
        } else if (score2Rows < score1Rows) {
            winner = p2;
        } else if (p1Time < p2Time) {
            winner = p1;
        } else if (p2Time < p1Time) {
            winner = p2;
        } else {
            isTie = true;
        }

        document.getElementById('go-title').innerText = isTie
            ? '🤝 PAREGGIO!'
            : `🏆 VINCE ${winner ? winner.name.toUpperCase() : ''}!`;

        document.getElementById('go-message').innerHTML = isTie
            ? `Entrambi i giocatori hanno completato il match con le stesse righe e lo stesso tempo!`
            : `<strong>${winner.name}</strong> vince il match dopo i 2 round a parti invertite!`;

        renderSecretReveal(classic.secretCode || []);
        document.getElementById('go-stats').innerHTML = `
            <div>
                <strong>${p1 ? p1.name : 'Giocatore 1'}:</strong><br>
                Righe: ${r1.solved ? r1.rowsUsed : 'Non indovinato'} • ${formatTime(p1Time)} ${p1Penalty ? `(+${p1Penalty}s)` : ''}
            </div>
            <div>
                <strong>${p2 ? p2.name : 'Giocatore 2'}:</strong><br>
                Righe: ${r2.solved ? r2.rowsUsed : 'Non indovinato'} • ${formatTime(p2Time)} ${p2Penalty ? `(+${p2Penalty}s)` : ''}
            </div>
        `;

        const body = document.getElementById('go-multi-body');
        body.innerHTML = '';
        const summaryRows = [
            {
                player: p1,
                solved: r1.solved,
                rows: r1.solved ? r1.rowsUsed : '—',
                sortRows: score1Rows,
                time: p1Time,
                penalty: p1Penalty
            },
            {
                player: p2,
                solved: r2.solved,
                rows: r2.solved ? r2.rowsUsed : '—',
                sortRows: score2Rows,
                time: p2Time,
                penalty: p2Penalty
            }
        ].sort((a, b) => {
            if (a.sortRows !== b.sortRows) return a.sortRows - b.sortRows;
            return a.time - b.time;
        });

        summaryRows.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><strong>${item.player ? item.player.name : 'Giocatore'}</strong></td>
                <td>${item.solved ? '✅ Indovinato' : '❌ Non indovinato'}</td>
                <td>${item.rows}</td>
                <td>${formatTime(item.time)}${item.penalty ? ` (+${item.penalty}s)` : ''}</td>
            `;
            body.appendChild(tr);
        });
        document.getElementById('go-multi-leaderboard').classList.remove('hidden');
    } else {
        document.getElementById('go-title').innerText = '🏆 SFIDA ONLINE CONCLUSA!';
        document.getElementById('go-message').innerText = `Vincitore: ${ranked[0] ? ranked[0].name : '---'}!`;
        document.getElementById('go-secret-box').classList.add('hidden');
        document.getElementById('go-stats').innerHTML = '';

        const body = document.getElementById('go-multi-body');
        body.innerHTML = '';
        ranked.forEach((p, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><strong>${p.name}</strong></td>
                <td>${p.eliminated ? '❌ Eliminato' : '✅ In Gioco'}</td>
                <td>${p.totalAttempts}</td>
                <td>${formatTime(p.totalTime)}</td>
            `;
            body.appendChild(tr);
        });
        document.getElementById('go-multi-leaderboard').classList.remove('hidden');

        const me = playersList.find(p => p.id === onlineState.playerId);
        if (me && fbDb) {
            pushRecordToFirebaseLeaderboard('sfida', room.difficulty, {
                name: me.name,
                rounds: me.roundsCompleted || 0,
                attempts: me.totalAttempts || 0,
                time: me.totalTime || 0
            });
        }
    }

    btnRestart.classList.add('hidden');
    modal.classList.remove('hidden');

    if (onlineState.isHost && onlineState.roomRef) {
        setTimeout(() => {
            if (onlineState.roomRef) {
                onlineState.roomRef.remove();
            }
        }, 4000);
    }
}

async function hostStartClassicRound2() {
    if (!onlineState.isHost || !onlineState.roomRef) return;
    const btn = document.getElementById('btn-start-classic-round2');
    if (btn) btn.disabled = true;

    const snap = await onlineState.roomRef.once('value');
    const room = snap.val();
    if (!room || !room.classic) return;

    const nextMakerId = room.classic.codebreakerId;
    const nextBreakerId = room.classic.codemakerId;

    await onlineState.roomRef.update({
        currentRound: 2,
        'classic/codemakerId': nextMakerId,
        'classic/codebreakerId': nextBreakerId,
        'classic/phase': 'picking_secret',
        'classic/secretCode': [],
        'classic/attempts': []
    });
}

/* ==========================================================================
   AVVIO ED ESECUZIONE DELLA PARTITA LOCALE
   ========================================================================== */
function startGame() {
    document.getElementById('modal-gameover').classList.add('hidden');
    document.getElementById('modal-turn-change').classList.add('hidden');
    document.getElementById('btn-go-restart').classList.remove('hidden');
    document.getElementById('classic-secret-banner').classList.add('hidden');
    document.getElementById('codebreaker-controls').classList.remove('hidden');
    document.getElementById('codemaker-controls').classList.add('hidden');

    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    gameState.maxAttemptsPerRound = settings.maxAttemptsPerRound;

    gameState.players = [];
    if (gameState.mode === 'single') {
        const name = requireValidPlayerName('single-player-name');
        if (!name) return;
        gameState.players.push({
            name: name,
            totalAttempts: 0,
            totalTime: 0,
            roundsCompleted: 0,
            eliminated: false
        });
        document.getElementById('multi-turn-badge').style.display = 'none';
        document.getElementById('live-ranking-container').classList.add('hidden');
    } else {
        const count = parseInt(document.getElementById('num-players').value, 10);
        const collectedNames = [];

        for (let i = 1; i <= count; i++) {
            const inputEl = document.getElementById(`multi-player-name-${i}`);
            const rawName = inputEl ? inputEl.value.trim() : '';

            if (!rawName) {
                alert(`Inserisci il nome del Giocatore ${i}: il nome è obbligatorio per tutti.`);
                if (inputEl) inputEl.focus();
                return;
            }

            const cleanName = rawName.slice(0, 15);
            collectedNames.push(cleanName);
            gameState.players.push({
                name: cleanName,
                totalAttempts: 0,
                totalTime: 0,
                roundsCompleted: 0,
                eliminated: false
            });
        }

        // Salva il nome del primo giocatore così resta in memoria al riavvio
        if (collectedNames.length > 0) {
            savePlayerName(collectedNames[0]);
        }

        gameState.currentRound = 1;
        document.getElementById('multi-turn-badge').style.display = 'inline-block';
        document.getElementById('live-ranking-container').classList.remove('hidden');
    }

    gameState.currentPlayerIndex = 0;
    setupNewTurn();
    showScreen('screen-game');
}

function handleRestartAfterGameOver() {
    if (gameState.mode === 'online') {
        goToMainMenu();
    } else {
        startGame();
    }
}

function goToMainMenu() {
    document.getElementById('modal-gameover').classList.add('hidden');
    document.getElementById('modal-turn-change').classList.add('hidden');
    document.getElementById('modal-online-wait').classList.add('hidden');
    document.getElementById('modal-wheel').classList.add('hidden');
    stopTimer();
    if (gameState.mode === 'online') {
        leaveOnlineRoom();
        return;
    }
    showScreen('screen-menu');
}

function generateSecretCode(slots, colorCount) {
    const code = [];
    for (let i = 0; i < slots; i++) {
        const randomColorIndex = Math.floor(Math.random() * colorCount);
        code.push(COLOR_DEFINITIONS[randomColorIndex].id);
    }
    return code;
}

function setupNewTurn() {
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    const player = gameState.players[gameState.currentPlayerIndex];

    gameState.secretCode = generateSecretCode(settings.slots, settings.colors);
    gameState.currentAttemptInRound = 0;
    gameState.playedRows = [];
    gameState.selectedColorId = null;

    document.getElementById('current-player-name').innerText = player.name;
    if (gameState.mode === 'multi') {
        document.getElementById('current-turn-info').innerText =
            `Giro ${gameState.currentRound} • ${player.name} (Tentativi Tot: ${player.totalAttempts}/${settings.eliminationLimit})`;
        updateLiveRankingSidebar();
    }

    renderPalette();
    renderBoard();
    startTimer();
}

function updateLiveRankingSidebar() {
    if (gameState.mode !== 'multi') return;
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    const container = document.getElementById('live-ranking-list');
    container.innerHTML = '';

    const sorted = [...gameState.players].sort((a, b) => {
        if (a.roundsCompleted !== b.roundsCompleted) return b.roundsCompleted - a.roundsCompleted;
        if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
        return a.totalTime - b.totalTime;
    });

    sorted.forEach((p) => {
        const originalIndex = gameState.players.indexOf(p);
        const isActive = originalIndex === gameState.currentPlayerIndex && !p.eliminated;

        const item = document.createElement('div');
        item.className = `live-ranking-item ${isActive ? 'active-player' : ''} ${p.eliminated ? 'eliminated-player' : ''}`;

        let statusText = `${p.totalAttempts}/${settings.eliminationLimit} tent.`;
        if (p.eliminated) statusText = '❌ Eliminato';

        item.innerHTML = `
            <span><strong>${p.name}</strong></span>
            <span class="player-stat-badge">${statusText}</span>
        `;
        container.appendChild(item);
    });
}

/* ==========================================================================
   GESTIONE TIMERS
   ========================================================================== */
function startTimer() {
    stopTimer();
    gameState.currentTurnSeconds = 0;
    updateTimerDisplay();

    gameState.timerInterval = setInterval(() => {
        gameState.currentTurnSeconds++;
        updateTimerDisplay();
    }, 1000);
}

function stopTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
}

function resumeTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }
    updateTimerDisplay();

    gameState.timerInterval = setInterval(() => {
        gameState.currentTurnSeconds++;
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const totalSeconds = gameState.currentTurnSeconds;
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    document.getElementById('game-timer').innerText = `${mins}:${secs}`;
}

/* ==========================================================================
   RENDERING GRAFICO E DRAG & DROP
   ========================================================================== */
function renderPalette() {
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    const container = document.getElementById('color-palette');
    container.innerHTML = '';

    for (let i = 0; i < settings.colors; i++) {
        const color = COLOR_DEFINITIONS[i];
        const peg = document.createElement('div');
        peg.className = `peg ${color.class}`;
        peg.draggable = true;
        peg.dataset.colorId = color.id;

        peg.addEventListener('dragstart', handleDragStart);
        peg.addEventListener('click', () => selectPaletteColor(color.id, peg));

        container.appendChild(peg);
    }
}

function selectPaletteColor(colorId, element) {
    document.querySelectorAll('.palette-pegs .peg').forEach(p => p.classList.remove('selected'));
    if (gameState.selectedColorId === colorId) {
        gameState.selectedColorId = null;
    } else {
        gameState.selectedColorId = colorId;
        element.classList.add('selected');
        AudioEngine.playPegSelect();
    }
}

function renderBoard() {
    const container = document.getElementById('board-rows');
    container.innerHTML = '';

    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    gameState.currentRowPegs = new Array(settings.slots).fill(null);
    const isOnlineClassic = gameState.mode === 'online' && onlineState.subMode === 'classica';

    for (let r = 0; r < gameState.maxAttemptsPerRound; r++) {

        const rowDiv = document.createElement('div');
        rowDiv.className = `board-row ${r === 0 ? 'active-row' : ''}`;
        rowDiv.dataset.rowIndex = r;

        const numBtn = document.createElement('button');
        numBtn.type = 'button';
        numBtn.className = 'row-number row-copy-btn';
        numBtn.innerText = r + 1;
        numBtn.title = `Copia la combinazione della riga ${r + 1} nella riga attiva`;
        numBtn.disabled = true;
        numBtn.addEventListener('click', () => copyRowToActive(r));

        const slotsDiv = document.createElement('div');
        slotsDiv.className = 'row-slots';

        for (let s = 0; s < settings.slots; s++) {
            const slot = document.createElement('div');
            slot.className = 'slot';
            slot.dataset.slotIndex = s;

            if (r === 0 && !isOnlineClassic) {
                slot.addEventListener('dragover', handleDragOver);
                slot.addEventListener('drop', handleDrop);
                slot.addEventListener('click', () => handleSlotClick(s));
            }

            slotsDiv.appendChild(slot);
        }

        const feedbackDiv = document.createElement('div');
        feedbackDiv.className = 'feedback-grid';
        for (let f = 0; f < settings.slots; f++) {
            const fbPeg = document.createElement('div');
            fbPeg.className = 'feedback-peg';
            feedbackDiv.appendChild(fbPeg);
        }

        rowDiv.appendChild(numBtn);
        rowDiv.appendChild(slotsDiv);
        rowDiv.appendChild(feedbackDiv);
        container.appendChild(rowDiv);
    }

    updateSubmitButtonState();
}

function handleSlotClick(slotIndex) {
    if (gameState.selectedColorId) {
        setPegInSlot(slotIndex, gameState.selectedColorId);
        AudioEngine.playPegPlace();
    } else if (gameState.currentRowPegs[slotIndex]) {
        setPegInSlot(slotIndex, null);
        AudioEngine.playPegMove();
    }
}

function setPegInSlot(slotIndex, colorId) {
    gameState.currentRowPegs[slotIndex] = colorId;
    const activeRow = document.querySelector('.board-row.active-row');
    if (!activeRow) return;

    const slot = activeRow.querySelector(`[data-slot-index="${slotIndex}"]`);
    slot.innerHTML = '';

    if (colorId) {
        const colorObj = COLOR_DEFINITIONS.find(c => c.id === colorId);
        const peg = document.createElement('div');
        peg.className = `peg ${colorObj.class} peg-place-anim`;
        peg.draggable = true;
        peg.dataset.colorId = colorId;
        peg.dataset.fromSlot = slotIndex;

        peg.addEventListener('dragstart', handleDragStart);
        slot.appendChild(peg);
    }

    updateSubmitButtonState();
}

function copyRowToActive(rowIndex) {
    const savedPegs = gameState.playedRows[rowIndex];
    if (!savedPegs) return;

    savedPegs.forEach((colorId, slotIndex) => {
        setPegInSlot(slotIndex, colorId);
    });

    AudioEngine.playPegPlace();
}

function updateSubmitButtonState() {
    const isComplete = gameState.currentRowPegs.every(p => p !== null);
    document.getElementById('btn-submit').disabled = !isComplete;
}

let draggedColorId = null;
let draggedFromSlot = null;

function handleDragStart(e) {
    draggedColorId = e.target.dataset.colorId;
    draggedFromSlot = e.target.dataset.fromSlot !== undefined ? parseInt(e.target.dataset.fromSlot, 10) : null;
    e.dataTransfer.setData('text/plain', draggedColorId);
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    const targetSlot = e.currentTarget;
    const slotIndex = parseInt(targetSlot.dataset.slotIndex, 10);

    if (draggedColorId !== null) {
        if (draggedFromSlot !== null && draggedFromSlot !== slotIndex) {
            setPegInSlot(draggedFromSlot, null);
        }
        setPegInSlot(slotIndex, draggedColorId);
        AudioEngine.playPegPlace();
    }

    draggedColorId = null;
    draggedFromSlot = null;
}

/* ==========================================================================
   LOGICA DI VERIFICA E CALCOLO INDIZI
   ========================================================================== */
async function submitCurrentRow() {
    if (!gameState.currentRowPegs.every(p => p !== null)) return;
    AudioEngine.playSubmit();

    // Caso speciale: Versione Classica Online -> invia il tentativo al Codemaker che metterà i pioli
    if (gameState.mode === 'online' && onlineState.subMode === 'classica') {
        stopTimer();
        const attemptIndex = gameState.currentAttemptInRound;
        document.getElementById('btn-submit').disabled = true;
        await fbDb.ref(`rooms/${onlineState.roomCode}/classic`).update({
            [`attempts/${attemptIndex}`]: {
                pegs: [...gameState.currentRowPegs]
            },
            breakerElapsedSeconds: gameState.currentTurnSeconds || 0,
            phase: 'awaiting_feedback'
        });
        return;
    }

    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    const feedback = calculateFeedback(gameState.currentRowPegs, gameState.secretCode);

    const activeRow = document.querySelector('.board-row.active-row');
    const fbPegs = activeRow.querySelectorAll('.feedback-peg');

    let fbIndex = 0;
    for (let i = 0; i < feedback.black; i++) {
        fbPegs[fbIndex++].classList.add('black');
    }
    for (let i = 0; i < feedback.white; i++) {
        fbPegs[fbIndex++].classList.add('white');
    }

    gameState.playedRows[gameState.currentAttemptInRound] = [...gameState.currentRowPegs];
    const copyBtn = activeRow.querySelector('.row-copy-btn');
    if (copyBtn) {
        copyBtn.disabled = false;
    }

    gameState.currentAttemptInRound++;
    const isCorrect = feedback.black === settings.slots;

    if (isCorrect || gameState.currentAttemptInRound >= gameState.maxAttemptsPerRound) {
        if (isCorrect) AudioEngine.playSuccess();
        else AudioEngine.playEliminated();

        if (gameState.mode === 'online' && onlineState.subMode === 'sfida') {
            await finishOnlineSfidaRound(isCorrect);
            return;
        }

        stopTimer();
        const player = gameState.players[gameState.currentPlayerIndex];

        player.totalAttempts += gameState.currentAttemptInRound;
        player.totalTime += gameState.currentTurnSeconds;
        if (isCorrect) {
            player.roundsCompleted++;
        }

        if (player.totalAttempts >= settings.eliminationLimit) {
            player.eliminated = true;
        }

        handleTurnTransition();
    } else {
        activeRow.classList.remove('active-row');
        activeRow.classList.add('completed-row');

        const nextRow = document.querySelector(`[data-row-index="${gameState.currentAttemptInRound}"]`);
        if (nextRow) {
            nextRow.classList.add('active-row');
            nextRow.querySelectorAll('.slot').forEach((slot, sIdx) => {
                slot.addEventListener('dragover', handleDragOver);
                slot.addEventListener('drop', handleDrop);
                slot.addEventListener('click', () => handleSlotClick(sIdx));
            });
        }

        gameState.currentRowPegs = new Array(settings.slots).fill(null);
        updateSubmitButtonState();
    }
}

function evaluateMastermindFeedback(secretCode, guessPegs) {
    if (!Array.isArray(secretCode) || !Array.isArray(guessPegs) || secretCode.length === 0) {
        return { black: 0, white: 0 };
    }

    let black = 0;
    const secretRemaining = [];
    const guessRemaining = [];

    for (let i = 0; i < secretCode.length; i++) {
        if (guessPegs[i] === secretCode[i]) {
            black++;
        } else {
            secretRemaining.push(secretCode[i]);
            guessRemaining.push(guessPegs[i]);
        }
    }

    let white = 0;
    const availableCounts = {};
    secretRemaining.forEach(color => {
        availableCounts[color] = (availableCounts[color] || 0) + 1;
    });

    guessRemaining.forEach(color => {
        if (availableCounts[color] > 0) {
            white++;
            availableCounts[color]--;
        }
    });

    return { black, white };
}

function calculateFeedback(attempt, secret) {
    let black = 0;
    let white = 0;

    const secretCopy = [...secret];
    const attemptCopy = [...attempt];

    for (let i = 0; i < attemptCopy.length; i++) {
        if (attemptCopy[i] === secretCopy[i]) {
            black++;
            secretCopy[i] = null;
            attemptCopy[i] = null;
        }
    }

    for (let i = 0; i < attemptCopy.length; i++) {
        if (attemptCopy[i] !== null) {
            const matchIndex = secretCopy.indexOf(attemptCopy[i]);
            if (matchIndex !== -1) {
                white++;
                secretCopy[matchIndex] = null;
            }
        }
    }

    return { black, white };
}

/* ==========================================================================
   GESTIONE TURNI E GIRI MULTIPLAYER LOCALE
   ========================================================================== */
function handleTurnTransition() {
    if (gameState.mode === 'single') {
        const player = gameState.players[0];
        const won = player.roundsCompleted > 0;

        if (won) {
            pushRecordToFirebaseLeaderboard('classica', gameState.difficulty, {
                name: player.name,
                attempts: player.totalAttempts,
                time: player.totalTime
            });
        }

        const modal = document.getElementById('modal-gameover');
        document.getElementById('go-title').innerText = won ? '🎉 VITTORIA!' : '💥 SCONFITTA!';
        document.getElementById('go-message').innerText = won
            ? `Complimenti ${player.name}! Hai indovinato la combinazione segreta!`
            : `Hai esaurito i tentativi disponibili!`;

        renderSecretReveal(gameState.secretCode);

        document.getElementById('go-stats').innerHTML = `
            <div><strong>Tentativi:</strong> ${player.totalAttempts}/${gameState.maxAttemptsPerRound}</div>
            <div><strong>Tempo:</strong> ${formatTime(player.totalTime)}</div>
        `;

        document.getElementById('go-multi-leaderboard').classList.add('hidden');
        modal.classList.remove('hidden');
    } else {
        let activePlayers = gameState.players.filter(p => !p.eliminated);

        if (activePlayers.length === 0) {
            endGameMulti();
        } else {
            const currentPlayer = gameState.players[gameState.currentPlayerIndex];
            const msgEl = document.getElementById('turn-change-message');
            msgEl.innerHTML = `Turno completato per <strong>${currentPlayer.name}</strong> (${gameState.currentAttemptInRound} tentativi in questo turno).<br>${currentPlayer.eliminated ? '⚠️ <strong>Il giocatore ha superato il limite ed è stato eliminato!</strong>' : ''}`;

            const body = document.getElementById('turn-ranking-body');
            body.innerHTML = '';

            const ranked = [...gameState.players].sort((a, b) => {
                if (a.roundsCompleted !== b.roundsCompleted) return b.roundsCompleted - a.roundsCompleted;
                if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
                return a.totalTime - b.totalTime;
            });

            ranked.forEach((p, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td><strong>${p.name}</strong></td>
                    <td>${p.eliminated ? '❌ Eliminato' : '✅ In Gioco'}</td>
                    <td>${p.roundsCompleted}</td>
                    <td>${p.totalAttempts}</td>
                `;
                body.appendChild(tr);
            });

            document.getElementById('modal-turn-change').classList.remove('hidden');
        }
    }
}
function proceedToNextTurn() {
    document.getElementById('modal-turn-change').classList.add('hidden');

    do {
        gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
        if (gameState.currentPlayerIndex === 0) {
            gameState.currentRound++;
        }
    } while (gameState.players[gameState.currentPlayerIndex].eliminated);

    const activePlayers = gameState.players.filter(p => !p.eliminated);
    if (activePlayers.length === 0) {
        endGameMulti();
    } else {
        setupNewTurn();
    }
}

function endGameMulti() {
    const rankedPlayers = [...gameState.players].sort((a, b) => {
        if (a.roundsCompleted !== b.roundsCompleted) return b.roundsCompleted - a.roundsCompleted;
        if (a.totalAttempts !== b.totalAttempts) return a.totalAttempts - b.totalAttempts;
        return a.totalTime - b.totalTime;
    });

    rankedPlayers.forEach((p) => {
        if (p.roundsCompleted > 0 || p.totalAttempts > 0) {
            pushRecordToFirebaseLeaderboard('sfida', gameState.difficulty, {
                name: p.name,
                rounds: p.roundsCompleted || 0,
                attempts: p.totalAttempts || 0,
                time: p.totalTime || 0
            });
        }
    });

    const modal = document.getElementById('modal-gameover');
    document.getElementById('go-title').innerText = '🏆 SFIDA MULTIPLAYER CONCLUSA!';
    document.getElementById('go-message').innerText = `Vincitore: ${rankedPlayers[0].name}!`;

    document.getElementById('go-secret-box').classList.add('hidden');
    document.getElementById('go-stats').innerHTML = '';

    const body = document.getElementById('go-multi-body');
    body.innerHTML = '';

    rankedPlayers.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td><strong>${p.name}</strong></td>
            <td>${p.eliminated ? '❌ Eliminato' : '✅ In Gioco'}</td>
            <td>${p.roundsCompleted}</td>
            <td>${p.totalAttempts}</td>
            <td>${formatTime(p.totalTime)}</td>
        `;
        body.appendChild(tr);
    });

    document.getElementById('go-multi-leaderboard').classList.remove('hidden');
    modal.classList.remove('hidden');
} function renderSecretReveal(secretCode) {
    const container = document.getElementById('go-secret-pegs');
    container.innerHTML = '';
    document.getElementById('go-secret-box').classList.remove('hidden');

    secretCode.forEach(colorId => {
        const colorObj = COLOR_DEFINITIONS.find(c => c.id === colorId);
        const peg = document.createElement('div');
        peg.className = `peg ${colorObj.class}`;
        container.appendChild(peg);
    });
}

/* ==========================================================================
   GESTIONE MODALE DI USCITA / MENU
   ========================================================================== */
function confirmQuit() {
    document.getElementById('modal-quit-confirm').classList.remove('hidden');
}

function closeQuitModal() {
    document.getElementById('modal-quit-confirm').classList.add('hidden');
}

function executeQuitToMenu() {
    document.getElementById('modal-quit-confirm').classList.add('hidden');
    stopTimer();
    if (gameState.mode === 'online') {
        leaveOnlineRoom();
        return;
    }
    showScreen('screen-menu');
}

/* ==========================================================================
   CLASSIFICA PERMANENTE (LOCAL STORAGE + PREDISPOSIZIONE FIREBASE)
   ========================================================================== */

async function pushRecordToFirebaseLeaderboard(category, difficulty, entry) {
    if (!fbDb || !category || !difficulty || !entry || !entry.name) return;
    const path = `leaderboard_v2/${category}/${difficulty}`;
    try {
        await fbDb.ref(path).push({
            name: String(entry.name).trim().slice(0, 15),
            rounds: Number(entry.rounds || 0),
            attempts: Number(entry.attempts || 0),
            time: Number(entry.time || 0),
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    } catch (err) {
        console.warn('Errore salvataggio classifica Firebase:', err);
    }
}

const leaderboardState = {
    category: 'classica', // 'classica' | 'sfida'
    difficulty: 'easy',  // 'easy' | 'normal' | 'hard'
    ref: null,
    callback: null
};

function setLeaderboardCategory(cat) {
    leaderboardState.category = cat;
    document.getElementById('lb-cat-classica')?.classList.toggle('active', cat === 'classica');
    document.getElementById('lb-cat-sfida')?.classList.toggle('active', cat === 'sfida');
    subscribeFirebaseLeaderboard();
}

function setLeaderboardDiff(diff) {
    leaderboardState.difficulty = diff;
    ['easy', 'normal', 'hard'].forEach(d => {
        document.getElementById(`lb-diff-${d}`)?.classList.toggle('active', d === diff);
    });
    subscribeFirebaseLeaderboard();
}

function detachFirebaseLeaderboard() {
    if (leaderboardState.ref && leaderboardState.callback) {
        leaderboardState.ref.off('value', leaderboardState.callback);
    }
    leaderboardState.ref = null;
    leaderboardState.callback = null;
}

function subscribeFirebaseLeaderboard() {
    detachFirebaseLeaderboard();
    const container = document.getElementById('leaderboard-groups-container');
    if (!container) return;

    if (!fbDb) {
        container.innerHTML = `<div class="online-rooms-empty">Firebase non disponibile al momento.</div>`;
        return;
    }

    container.innerHTML = `<div class="online-rooms-empty">Caricamento classifica...</div>`;
    const path = `leaderboard_v2/${leaderboardState.category}/${leaderboardState.difficulty}`;
    leaderboardState.ref = fbDb.ref(path);
    leaderboardState.callback = snap => {
        const rawObj = snap.val() || {};
        const records = Object.values(rawObj).filter(r => r && r.name);
        renderGroupedLeaderboard(records, leaderboardState.category);
    };
    leaderboardState.ref.on('value', leaderboardState.callback);
}

function renderGroupedLeaderboard(records, category = leaderboardState.category) {
    const container = document.getElementById('leaderboard-groups-container');
    if (!container) return;

    if (!Array.isArray(records) || !records.length) {
        container.innerHTML = `<div class="online-rooms-empty">Nessun record registrato in questa categoria.</div>`;
        return;
    }

    container.innerHTML = '';

    if (category === 'classica') {
        const groupsMap = new Map();
        records.forEach(r => {
            const att = Number(r.attempts);
            if (!att || att < 1 || att > 10) return;
            if (!groupsMap.has(att)) groupsMap.set(att, []);
            groupsMap.get(att).push({
                name: r.name,
                attempts: att,
                time: Number(r.time || 0)
            });
        });

        const sortedAttempts = Array.from(groupsMap.keys()).sort((a, b) => a - b).slice(0, 10);
        if (!sortedAttempts.length) {
            container.innerHTML = `<div class="online-rooms-empty">Nessun record valido per la modalità Classica.</div>`;
            return;
        }

        sortedAttempts.forEach(att => {
            const items = groupsMap.get(att)
                .sort((a, b) => a.time - b.time)
                .slice(0, 20);
            const best = items[0];

            const card = document.createElement('div');
            card.className = 'lb-group-card';

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'lb-group-header';
            header.innerHTML = `
                <span>${att} ${att === 1 ? 'Tentativo' : 'Tentativi'} • <strong>${best.name}</strong> (${formatTime(best.time)})</span>
                <span class="lb-group-meta">
                    <span>${items.length} record</span>
                    <span class="lb-chevron">▼</span>
                </span>
            `;

            const dropdown = document.createElement('div');
            dropdown.className = 'lb-group-dropdown';
            dropdown.innerHTML = `
                <table class="lb-subtable">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Giocatore</th>
                            <th>Tentativi</th>
                            <th>Tempo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td><strong>${item.name}</strong></td>
                                <td>${item.attempts}</td>
                                <td>${formatTime(item.time)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            header.addEventListener('click', () => card.classList.toggle('open'));
            card.appendChild(header);
            card.appendChild(dropdown);
            container.appendChild(card);
        });
    } else {
        const roundsMap = new Map();
        records.forEach(r => {
            const rounds = Number(r.rounds || 0);
            if (!roundsMap.has(rounds)) roundsMap.set(rounds, []);
            roundsMap.get(rounds).push({
                name: r.name,
                rounds: rounds,
                attempts: Number(r.attempts || 0),
                time: Number(r.time || 0)
            });
        });

        const sortedRounds = Array.from(roundsMap.keys()).sort((a, b) => b - a);
        sortedRounds.forEach(roundsCount => {
            const items = roundsMap.get(roundsCount)
                .sort((a, b) => {
                    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
                    return a.time - b.time;
                })
                .slice(0, 20);
            const best = items[0];

            const card = document.createElement('div');
            card.className = 'lb-group-card';

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'lb-group-header';
            header.innerHTML = `
                <span>${roundsCount} ${roundsCount === 1 ? 'Round Completato' : 'Round Completati'} • <strong>${best.name}</strong> (${best.attempts} tent., ${formatTime(best.time)})</span>
                <span class="lb-group-meta">
                    <span>${items.length} record</span>
                    <span class="lb-chevron">▼</span>
                </span>
            `;

            const dropdown = document.createElement('div');
            dropdown.className = 'lb-group-dropdown';
            dropdown.innerHTML = `
                <table class="lb-subtable">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Giocatore</th>
                            <th>Tentativi Tot.</th>
                            <th>Tempo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td><strong>${item.name}</strong></td>
                                <td>${item.attempts}</td>
                                <td>${formatTime(item.time)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            header.addEventListener('click', () => card.classList.toggle('open'));
            card.appendChild(header);
            card.appendChild(dropdown);
            container.appendChild(card);
        });
    }
}
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}