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

let lbCurrentMode = 'Singolo'; // 'Singolo' o 'Multiplayer'
let lbCurrentDiff = 'easy';   // 'easy', 'normal', 'hard'

const DIFFICULTY_SETTINGS = {
    easy: { slots: 4, colors: 5, maxAttemptsPerRound: 10, eliminationLimit: 20 },
    normal: { slots: 4, colors: 6, maxAttemptsPerRound: 10, eliminationLimit: 23 },
    hard: { slots: 5, colors: 8, maxAttemptsPerRound: 10, eliminationLimit: 26 }
};

let gameState = {
    mode: 'single', // 'single' o 'multi'
    difficulty: 'easy',
    audioEnabled: true,

    // Dati della sessione multiplayer
    // [{ name, totalAttempts: 0, totalTime: 0, roundsCompleted: 0, eliminated: false }]
    players: [],
    currentPlayerIndex: 0,
    currentRound: 1,

    // Dati del turno corrente
    secretCode: [],
    currentAttemptInRound: 0,
    maxAttemptsPerRound: 10,
    currentRowPegs: [],
    selectedColorId: null,

    // Timer
    timerInterval: null,
    turnStartTime: 0,
    currentTurnSeconds: 0
};

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
        } catch (e) {
            console.warn("Audio non supportato o bloccato dal browser");
        }
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

/* ==========================================================================
   INIZIALIZZAZIONE E NAVIGAZIONE SCHERMATE
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
    renderMultiPlayerInputs();
    renderLeaderboard('easy');
});

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    if (screenId === 'screen-leaderboard') {
        renderLeaderboard(lbCurrentDiff);
    }
}

function setMode(mode) {
    gameState.mode = mode;
    document.getElementById('btn-mode-single').classList.toggle('active', mode === 'single');
    document.getElementById('btn-mode-multi').classList.toggle('active', mode === 'multi');

    document.getElementById('single-player-setup').classList.toggle('hidden', mode !== 'single');
    document.getElementById('multi-player-setup').classList.toggle('hidden', mode !== 'multi');

    // Aggiorna dinamicamente i sottotitoli delle difficoltà in base alla modalità
    updateDifficultyLabels();
}

function updateDifficultyLabels() {
    const isMulti = gameState.mode === 'multi';

    // Limiti multiplayer: Facile 20, Normale 23, Difficile 26
    // Singolo: fisso a 10 per tutte
    document.getElementById('sub-easy').innerText = isMulti
        ? '4 Caselle • 5 Colori • 10 Tentativi • Eliminazione a 20'
        : '4 Caselle • 5 Colori • 10 Tentativi';

    document.getElementById('sub-normal').innerText = isMulti
        ? '4 Caselle • 6 Colori • 10 Tentativi • Eliminazione a 23'
        : '4 Caselle • 6 Colori • 10 Tentativi';

    document.getElementById('sub-hard').innerText = isMulti
        ? '5 Caselle • 8 Colori • • 10 Tentativi • Eliminazione a 26'
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
    container.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
      <label>Giocatore ${i}:</label>
      <input type="text" id="multi-player-name-${i}" value="Giocatore ${i}" maxlength="15">
    `;
        container.appendChild(div);
    }
}

/* ==========================================================================
   AVVIO ED ESECUZIONE DELLA PARTITA
   ========================================================================== */
function startGame() {
    document.getElementById('modal-gameover').classList.add('hidden');
    document.getElementById('modal-turn-change').classList.add('hidden');
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    gameState.maxAttemptsPerRound = settings.maxAttemptsPerRound;

    // Inizializzazione Giocatori
    gameState.players = [];
    if (gameState.mode === 'single') {
        const name = document.getElementById('single-player-name').value.trim() || 'Giocatore 1';
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
        for (let i = 1; i <= count; i++) {
            const name = document.getElementById(`multi-player-name-${i}`).value.trim() || `Giocatore ${i}`;
            gameState.players.push({
                name: name,
                totalAttempts: 0,
                totalTime: 0,
                roundsCompleted: 0,
                eliminated: false
            });
        }
        gameState.currentRound = 1;
        document.getElementById('multi-turn-badge').style.display = 'inline-block';
        document.getElementById('live-ranking-container').classList.remove('hidden');
    }

    gameState.currentPlayerIndex = 0;
    setupNewTurn();
    showScreen('screen-game');
}
// Funzione per tornare al menu principale dalla schermata di fine partita
function goToMainMenu() {
    document.getElementById('modal-gameover').classList.add('hidden');
    document.getElementById('modal-turn-change').classList.add('hidden');
    stopTimer();
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
    gameState.selectedColorId = null;

    // Aggiornamento Header UI
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

/* ==========================================================================
   AGGIORNAMENTO CLASSIFICA PARCIALE LATERALE
   ========================================================================== */
function updateLiveRankingSidebar() {
    if (gameState.mode !== 'multi') return;
    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    const container = document.getElementById('live-ranking-list');
    container.innerHTML = '';

    // Ordina i giocatori per la classifica parziale in-game
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
        AudioEngine.playPegSelect(); // <-- ATTIVA IL SUONO QUI
    }
}

function renderBoard() {
    const container = document.getElementById('board-rows');
    container.innerHTML = '';

    const settings = DIFFICULTY_SETTINGS[gameState.difficulty];
    gameState.currentRowPegs = new Array(settings.slots).fill(null);

    for (let r = 0; r < gameState.maxAttemptsPerRound; r++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = `board-row ${r === 0 ? 'active-row' : ''}`;
        rowDiv.dataset.rowIndex = r;

        const numDiv = document.createElement('div');
        numDiv.className = 'row-number';
        numDiv.innerText = r + 1;

        const slotsDiv = document.createElement('div');
        slotsDiv.className = 'row-slots';

        for (let s = 0; s < settings.slots; s++) {
            const slot = document.createElement('div');
            slot.className = 'slot';
            slot.dataset.slotIndex = s;

            if (r === 0) {
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

        rowDiv.appendChild(numDiv);
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
function submitCurrentRow() {
    if (!gameState.currentRowPegs.every(p => p !== null)) return;
    AudioEngine.playSubmit();

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

    gameState.currentAttemptInRound++;
    const isCorrect = feedback.black === settings.slots;

    if (isCorrect || gameState.currentAttemptInRound >= gameState.maxAttemptsPerRound) {
        stopTimer();
        const player = gameState.players[gameState.currentPlayerIndex];

        // Aggiornamento statistiche cumulative del giocatore
        player.totalAttempts += gameState.currentAttemptInRound;
        player.totalTime += gameState.currentTurnSeconds;
        if (isCorrect) {
            player.roundsCompleted++;
        }

        // Controllo eliminazione basato sul limite totale dei tentativi
        if (player.totalAttempts >= settings.eliminationLimit) {
            player.eliminated = true;
        }

        if (isCorrect) {
            AudioEngine.playSuccess();
        } else {
            AudioEngine.playEliminated();
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
   GESTIONE TURNI E GIRI MULTIPLAYER (CON MODALE HTML INVECE DI ALERT)
   ========================================================================== */
function handleTurnTransition() {
    if (gameState.mode === 'single') {
        const player = gameState.players[0];
        const won = player.roundsCompleted > 0;
        saveResultToLeaderboard(player.name, player.totalAttempts, player.totalTime, 'Singolo');

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
        // Multiplayer
        let activePlayers = gameState.players.filter(p => !p.eliminated);

        if (activePlayers.length === 0) {
            endGameMulti();
        } else {
            // Mostra la modale HTML di cambio turno invece dell'alert del browser
            const currentPlayer = gameState.players[gameState.currentPlayerIndex];
            const msgEl = document.getElementById('turn-change-message');
            msgEl.innerHTML = `Turno completato per <strong>${currentPlayer.name}</strong> (${gameState.currentAttemptInRound} tentativi in questo turno).<br>${currentPlayer.eliminated ? '⚠️ <strong>Il giocatore ha superato il limite ed è stato eliminato!</strong>' : ''}`;

            // Popola la tabella di classifica parziale nella modale
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

// Funzione chiamata dal pulsante della modale di cambio turno
function proceedToNextTurn() {
    document.getElementById('modal-turn-change').classList.add('hidden');

    // Avanza all'indice del prossimo giocatore non eliminato
    do {
        gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
        if (gameState.currentPlayerIndex === 0) {
            gameState.currentRound++;
        }
    } while (gameState.players[gameState.currentPlayerIndex].eliminated);

    // Controlla se dopo il passaggio sono rimasti giocatori attivi
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

    // MODIFICA: Salva i risultati di TUTTI i giocatori nella classifica multiplayer
    rankedPlayers.forEach((p) => {
        if (p.roundsCompleted > 0 || p.totalAttempts > 0) {
            saveResultToLeaderboard(
                p.name,
                p.totalAttempts,
                p.totalTime,
                `Multiplayer (${p.roundsCompleted} giri)`
            );
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
}

function renderSecretReveal(secretCode) {
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
    // Mostra la modale HTML invece del confirm() del browser
    document.getElementById('modal-quit-confirm').classList.remove('hidden');
}

function closeQuitModal() {
    // Chiude la modale senza uscire
    document.getElementById('modal-quit-confirm').classList.add('hidden');
}

function executeQuitToMenu() {
    // Conferma l'uscita, chiude la modale, ferma il timer e torna al menu
    document.getElementById('modal-quit-confirm').classList.add('hidden');
    stopTimer();
    showScreen('screen-menu');
}

/* ==========================================================================
   CLASSIFICA PERMANENTE (LOCAL STORAGE)
   ========================================================================== */
function getLeaderboardData() {
    const data = localStorage.getItem('mastermind_3d_leaderboard');
    return data ? JSON.parse(data) : { easy: [], normal: [], hard: [] };
}

function saveResultToLeaderboard(name, attempts, time, mode) {
    const leaderboard = getLeaderboardData();
    const diff = gameState.difficulty;

    const entry = {
        name: name,
        attempts: attempts,
        time: time,
        mode: mode,
        date: new Date().toLocaleDateString('it-IT')
    };

    leaderboard[diff].push(entry);

    leaderboard[diff].sort((a, b) => {
        if (a.attempts !== b.attempts) return a.attempts - b.attempts;
        return a.time - b.time;
    });

    leaderboard[diff] = leaderboard[diff].slice(0, 20);

    localStorage.setItem('mastermind_3d_leaderboard', JSON.stringify(leaderboard));
}

function setLeaderboardMode(mode) {
    lbCurrentMode = mode;
    document.getElementById('lb-mode-single').classList.toggle('active', mode === 'Singolo');
    document.getElementById('lb-mode-multi').classList.toggle('active', mode === 'Multiplayer');
    renderLeaderboard(lbCurrentDiff);
}

function setLeaderboardDiff(diff) {
    lbCurrentDiff = diff;
    document.querySelectorAll('.tab-buttons button[id^="lb-diff-"]').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`lb-diff-${diff}`).classList.add('active');
    renderLeaderboard(diff);
}

function renderLeaderboard(diff) {
    lbCurrentDiff = diff;
    const leaderboard = getLeaderboardData();
    const rawList = leaderboard[diff] || [];

    // Filtra in base alla modalità selezionata (Singolo vs Multiplayer)
    const list = rawList.filter(item => {
        if (lbCurrentMode === 'Singolo') {
            return item.mode === 'Singolo';
        } else {
            return item.mode.startsWith('Multiplayer');
        }
    });

    const headerRow = document.getElementById('leaderboard-header-row');
    const body = document.getElementById('leaderboard-body');
    body.innerHTML = '';

    // Imposta le intestazioni della tabella dinamicamente
    if (lbCurrentMode === 'Singolo') {
        headerRow.innerHTML = `
            <th>#</th>
            <th>Giocatore</th>
            <th>Tentativi</th>
            <th>Tempo</th>
            <th>Data</th>
        `;
    } else {
        headerRow.innerHTML = `
            <th>#</th>
            <th>Giocatore</th>
            <th>Partite</th>
            <th>Tentativi</th>
            <th>Tempo</th>
            <th>Data</th>
        `;
    }

    if (list.length === 0) {
        const colSpan = lbCurrentMode === 'Singolo' ? 5 : 6;
        body.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;">Nessun risultato registrato per questa categoria.</td></tr>`;
        return;
    }

    list.forEach((item, idx) => {
        const tr = document.createElement('tr');

        if (lbCurrentMode === 'Singolo') {
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><strong>${item.name}</strong></td>
                <td>${item.attempts}</td>
                <td>${formatTime(item.time)}</td>
                <td>${item.date}</td>
            `;
        } else {
            // Estrae il numero di giri/partite dalla stringa mode (es. "Multiplayer (2 giri)" -> "2 Partite" o simile)
            let partiteText = "Partita";
            const match = item.mode.match(/\d+/);
            if (match) {
                partiteText = `${match[0]} Partite`;
            }

            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><strong>${item.name}</strong></td>
                <td>${partiteText}</td>
                <td>${item.attempts}</td>
                <td>${formatTime(item.time)}</td>
                <td>${item.date}</td>
            `;
        }
        body.appendChild(tr);
    });
}

function clearLeaderboard() {
    if (confirm("Sei sicuro di voler cancellare definitivamente tutti i punteggi salvati?")) {
        localStorage.removeItem('mastermind_3d_leaderboard');
        renderLeaderboard(gameState.difficulty);
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}