// ============================================================================
// 🪙 RAYUELA MEXICANA — CLIENT APP & 2.5D CANVAS ENGINE (V2 FLUID & COLOR ENHANCED)
// ============================================================================

(function () {
    'use strict';

    // --- State Variables ---
    let ws = null;
    let audio = null;
    let currentRoom = null;
    let myPlayerId = null;
    let myReconnectToken = null;
    let isHost = false;

    let selectedAvatar = "🤠";
    let selectedColor = "#f59e0b";
    let selectedCoinSkin = "centenario";
    let selectedCourtTheme = "cajon_barro";

    // Throw input state
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let dragCurrentPos = { x: 0, y: 0 };
    let aimingAngleDeg = 0;
    let aimingPower = 0.5;
    let aimingElevation = 28.0;

    // Animation & rendering
    let canvas = null;
    let ctx = null;
    let animationFrameId = null;
    let activeFlightAnimation = null;
    let pendingLaunch = null;
    let activeCarambolaBanner = null;
    let isWaitingForNextTurn = false;
    let clayParticles = [];
    let claySkidMarks = [];
    let cameraShakeOffset = { x: 0, y: 0 };
    let cameraShakeTrauma = 0;
    let cameraMode = 'perspective'; // 'perspective' or 'overhead' (foto-finish)
    let cameraTransitionFrac = 0.0; // 0 = 2.5D, 1 = overhead
    let targetCameraMode = 'perspective';

    // Timer
    let timerInterval = null;

    // --- Catalog Data ---
    const AVATARS = ["🤠", "🧔", "👵", "🧑", "💀", "🎺", "🥊", "🎨", "🌮", "👑"];
    const COLORS = [
        "#f59e0b", "#0284c7", "#ec4899", "#10b981", "#f97316",
        "#8b5cf6", "#ef4444", "#14b8a6", "#eab308", "#18181b"
    ];

    // --- DOM Elements ---
    let elScreenLobby, elScreenWaiting, elScreenGame;
    let elPlayerName, elRoomCodeInput, elBtnCreateRoom, elBtnJoinRoom;
    let elWaitingPlayersList, elBtnStartGame, elRoomBadge, elRoomBadgeCode;
    let elScoreboardTable, elTurnTimer, elActiveThrowerName;
    let elPowerFill, elAngleValue, elPowerValue, elFlickInstruction;
    let elModalFotoFinish, elVerdictBanner, elAwardsList, elBtnNextRound;
    let elModalVictory, elVictoryPodium, elVictoryStats, elBtnPlayAgain, elBtnDownloadTrophy;
    let elModalQr, elQrContainer, elShareUrlText, elBtnCopyUrl;
    let elBanterBubble, elToastContainer;

    // --- Initialization ---
    window.addEventListener('DOMContentLoaded', () => {
        initElements();
        initLobbyControls();
        initCanvas();
        setupAudio();
        checkUrlForRoomCode();

        // Restore player preferences from localStorage
        const savedName = localStorage.getItem('rayuela_player_name');
        if (savedName) elPlayerName.value = savedName;

        const savedAvatar = localStorage.getItem('rayuela_avatar');
        if (savedAvatar && AVATARS.includes(savedAvatar)) selectedAvatar = savedAvatar;

        const savedColor = localStorage.getItem('rayuela_color');
        if (savedColor && COLORS.includes(savedColor)) selectedColor = savedColor;

        const savedSkin = localStorage.getItem('rayuela_skin');
        if (savedSkin) selectedCoinSkin = savedSkin;

        const savedCourt = localStorage.getItem('rayuela_court');
        if (savedCourt && savedCourt !== 'patio_hacienda') {
            selectedCourtTheme = savedCourt;
        } else {
            selectedCourtTheme = 'cajon_barro';
        }

        renderLobbyCustomizers();
        startRenderLoop();
    });

    function initElements() {
        elScreenLobby = document.getElementById('screen-lobby');
        elScreenWaiting = document.getElementById('screen-room-waiting');
        elScreenGame = document.getElementById('screen-game');

        elPlayerName = document.getElementById('input-player-name');
        elRoomCodeInput = document.getElementById('input-room-code');
        elBtnCreateRoom = document.getElementById('btn-create-room');
        elBtnJoinRoom = document.getElementById('btn-join-room');

        elWaitingPlayersList = document.getElementById('waiting-players-list');
        elBtnStartGame = document.getElementById('btn-start-game');
        elRoomBadge = document.getElementById('room-badge');
        elRoomBadgeCode = document.getElementById('room-badge-code');

        elScoreboardTable = document.getElementById('scoreboard-table');
        elTurnTimer = document.getElementById('turn-timer');
        elActiveThrowerName = document.getElementById('active-thrower-name');

        elPowerFill = document.getElementById('power-meter-fill');
        elAngleValue = document.getElementById('val-angle');
        elPowerValue = document.getElementById('val-power');
        elFlickInstruction = document.querySelector('.flick-instruction');

        elModalFotoFinish = document.getElementById('modal-foto-finish');
        elVerdictBanner = document.getElementById('verdict-banner');
        elAwardsList = document.getElementById('awards-list');
        elBtnNextRound = document.getElementById('btn-next-round');

        elModalVictory = document.getElementById('modal-victory');
        elVictoryPodium = document.getElementById('victory-podium');
        elVictoryStats = document.getElementById('victory-stats');
        elBtnPlayAgain = document.getElementById('btn-play-again');
        elBtnDownloadTrophy = document.getElementById('btn-download-trophy');

        elModalQr = document.getElementById('modal-qr');
        elQrContainer = document.getElementById('qr-code-target');
        elShareUrlText = document.getElementById('share-url-text');
        elBtnCopyUrl = document.getElementById('btn-copy-url');

        elBanterBubble = document.getElementById('banter-bubble');
        elToastContainer = document.getElementById('toast-container');
    }

    function setupAudio() {
        audio = new window.CantinaAudio();
        const btnMute = document.getElementById('btn-toggle-sound');
        if (btnMute) {
            btnMute.addEventListener('click', () => {
                audio.init();
                const isMuted = !audio.muted;
                audio.setMuted(isMuted);
                btnMute.textContent = isMuted ? '🔇' : '🔊';
            });
        }
    }

    function initLobbyControls() {
        elBtnCreateRoom.addEventListener('click', () => {
            audio.resume();
            savePreferences();
            connectWebSocket(() => {
                sendWsAction({
                    action: 'create_room',
                    name: elPlayerName.value.trim() || 'Jugador 1',
                    avatar: selectedAvatar,
                    color: selectedColor,
                    coin_skin: selectedCoinSkin,
                    settings: {
                        target_points: parseInt(document.getElementById('select-target-points').value) || 15,
                        throws_per_player: parseInt(document.getElementById('select-throws-per-round').value) || 2,
                        turn_timer_seconds: parseInt(document.getElementById('select-turn-timer').value) || 20,
                        court_theme: selectedCourtTheme || 'cajon_barro',
                        cantina_theme: 'cantina_clasica',
                        knockouts_allowed: true
                    }
                });
            });
        });

        elBtnJoinRoom.addEventListener('click', () => {
            const code = elRoomCodeInput.value.trim().toUpperCase();
            if (!code) {
                showToast("Ingresa un código de sala");
                return;
            }
            audio.resume();
            savePreferences();
            connectWebSocket(() => {
                sendWsAction({
                    action: 'join_room',
                    room_code: code,
                    name: elPlayerName.value.trim() || 'Jugador',
                    avatar: selectedAvatar,
                    color: selectedColor,
                    coin_skin: selectedCoinSkin,
                    reconnect_token: myReconnectToken
                });
            });
        });

        document.getElementById('btn-add-bot').addEventListener('click', () => {
            sendWsAction({ action: 'add_bot', bot_profile_name: null });
        });

        elBtnStartGame.addEventListener('click', () => {
            sendWsAction({ action: 'start_game' });
        });

        elRoomBadge.addEventListener('click', openQrModal);
        document.getElementById('btn-close-qr').addEventListener('click', () => {
            elModalQr.classList.remove('active');
        });

        elBtnCopyUrl.addEventListener('click', () => {
            navigator.clipboard.writeText(elShareUrlText.value);
            showToast("¡Enlace copiado al portapapeles!");
        });

        elBtnNextRound.addEventListener('click', () => {
            elModalFotoFinish.classList.remove('active');
            targetCameraMode = 'perspective';
            claySkidMarks = [];
            sendWsAction({ action: 'next_round' });
        });

        elBtnPlayAgain.addEventListener('click', () => {
            elModalVictory.classList.remove('active');
            targetCameraMode = 'perspective';
            claySkidMarks = [];
            sendWsAction({ action: 'play_again' });
        });

        elBtnDownloadTrophy.addEventListener('click', downloadVictoryTrophy);

        // Leave waiting room button
        const btnLeaveWaiting = document.getElementById('btn-leave-waiting');
        if (btnLeaveWaiting) {
            btnLeaveWaiting.addEventListener('click', () => {
                if (ws) {
                    ws.close();
                    ws = null;
                }
                currentRoom = null;
                switchScreen(elScreenLobby);
                showToast("Regresaste al menú principal");
            });
        }

        // In-game Exit button & Confirmation Modal
        const btnExit = document.getElementById('btn-exit-game');
        const btnMobileExit = document.getElementById('btn-mobile-exit');
        const modalExit = document.getElementById('modal-exit-confirm');
        const btnCancelExit = document.getElementById('btn-cancel-exit');
        const btnConfirmExit = document.getElementById('btn-confirm-exit');
        if (btnExit && modalExit) {
            btnExit.addEventListener('click', () => {
                modalExit.classList.add('active');
            });
        }
        if (btnMobileExit && modalExit) {
            btnMobileExit.addEventListener('click', () => {
                modalExit.classList.add('active');
            });
        }
        if (btnCancelExit && modalExit) {
            btnCancelExit.addEventListener('click', () => {
                modalExit.classList.remove('active');
            });
        }
        if (btnConfirmExit && modalExit) {
            btnConfirmExit.addEventListener('click', () => {
                modalExit.classList.remove('active');
                if (ws) {
                    ws.close();
                    ws = null;
                }
                currentRoom = null;
                activeFlightAnimation = null;
                pendingLaunch = null;
                activeCarambolaBanner = null;
                switchScreen(elScreenLobby);
                showToast("Saliste de la partida");
            });
        }

        // Mobile Scoreboard Drawer toggle
        const btnOpenScoreboard = document.getElementById('btn-open-scoreboard');
        const btnCloseScoreboard = document.getElementById('btn-close-scoreboard');
        const chalkboardDrawer = document.getElementById('chalkboard-container');
        if (btnOpenScoreboard && chalkboardDrawer) {
            btnOpenScoreboard.addEventListener('click', () => {
                chalkboardDrawer.classList.add('open');
            });
        }
        if (btnCloseScoreboard && chalkboardDrawer) {
            btnCloseScoreboard.addEventListener('click', () => {
                chalkboardDrawer.classList.remove('open');
            });
        }

        // In-game Voice narrator toggle button
        const btnVoice = document.getElementById('btn-toggle-voice');
        if (btnVoice) {
            btnVoice.addEventListener('click', () => {
                if (audio) {
                    audio.speechEnabled = !audio.speechEnabled;
                    btnVoice.textContent = audio.speechEnabled ? '🎙️ Voz ON' : '🔇 Voz OFF';
                    btnVoice.style.opacity = audio.speechEnabled ? '1.0' : '0.6';
                    showToast(audio.speechEnabled ? '🎙️ Narrador cantinero activado' : '🔇 Narrador en silencio');
                }
            });
        }

        // Cantina reactions buttons
        document.querySelectorAll('.btn-reaction').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.text;
                const emoji = btn.dataset.emoji || '🪙';
                sendWsAction({ action: 'send_reaction', text, emoji });
            });
        });
    }

    function renderLobbyCustomizers() {
        // Avatars
        const avatarGrid = document.getElementById('avatar-grid');
        avatarGrid.innerHTML = '';
        AVATARS.forEach(av => {
            const div = document.createElement('div');
            div.className = `avatar-item ${av === selectedAvatar ? 'selected' : ''}`;
            div.textContent = av;
            div.addEventListener('click', () => {
                selectedAvatar = av;
                document.querySelectorAll('.avatar-item').forEach(el => el.classList.remove('selected'));
                div.classList.add('selected');
            });
            avatarGrid.appendChild(div);
        });

        // Colors
        const colorRow = document.getElementById('color-picker-row');
        colorRow.innerHTML = '';
        COLORS.forEach(col => {
            const dot = document.createElement('div');
            dot.className = `color-dot ${col === selectedColor ? 'selected' : ''}`;
            dot.style.backgroundColor = col;
            dot.addEventListener('click', () => {
                selectedColor = col;
                document.querySelectorAll('.color-dot').forEach(el => el.classList.remove('selected'));
                dot.classList.add('selected');
            });
            colorRow.appendChild(dot);
        });

        // Skins
        document.querySelectorAll('.skin-card').forEach(card => {
            if (card.dataset.skin === selectedCoinSkin) card.classList.add('selected');
            card.addEventListener('click', () => {
                selectedCoinSkin = card.dataset.skin;
                document.querySelectorAll('.skin-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            });
        });

        // Courts
        document.querySelectorAll('.court-card').forEach(card => {
            if (card.dataset.court === selectedCourtTheme) card.classList.add('selected');
            card.addEventListener('click', () => {
                selectedCourtTheme = card.dataset.court;
                document.querySelectorAll('.court-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            });
        });
    }

    function savePreferences() {
        localStorage.setItem('rayuela_player_name', elPlayerName.value.trim());
        localStorage.setItem('rayuela_avatar', selectedAvatar);
        localStorage.setItem('rayuela_color', selectedColor);
        localStorage.setItem('rayuela_skin', selectedCoinSkin);
        localStorage.setItem('rayuela_court', selectedCourtTheme);
    }

    function checkUrlForRoomCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            elRoomCodeInput.value = roomCode.toUpperCase();
        }
    }

    // --- WebSocket Communication ---
    function connectWebSocket(onOpenCallback) {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            if (onOpenCallback && ws.readyState === WebSocket.OPEN) onOpenCallback();
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log("WebSocket connected");
            if (onOpenCallback) onOpenCallback();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleServerEvent(msg);
            } catch (e) {
                console.error("Error parsing message:", e);
            }
        };

        ws.onclose = () => {
            console.log("WebSocket closed");
        };

        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            showToast("Error de conexión al servidor");
        };
    }

    function sendWsAction(payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        } else {
            connectWebSocket(() => {
                ws.send(JSON.stringify(payload));
            });
        }
    }

    function handleServerEvent(ev) {
        switch (ev.type) {
            case 'room_joined':
                myPlayerId = ev.player_id;
                myReconnectToken = ev.reconnect_token;
                isHost = ev.is_host;
                localStorage.setItem(`rayuela_rec_${ev.room_code}`, ev.reconnect_token);
                elRoomBadge.style.display = 'flex';
                elRoomBadgeCode.textContent = ev.room_code;
                showToast(`Te uniste a la sala ${ev.room_code}`);
                break;

            case 'room_state':
                currentRoom = ev.room;
                updateRoomStateUI(ev.room);
                break;

            case 'throw_executed':
                handleThrowAnimation(ev);
                break;

            case 'round_finished':
                currentRoom = ev.room;
                // Wait for coin flight, bounces, and carambolas to finish before opening Foto-Finish
                setTimeout(() => {
                    updateRoomStateUI(ev.room);
                    showFotoFinishModal(ev.room);
                }, activeFlightAnimation ? 2600 : 400);
                break;

            case 'match_finished':
                currentRoom = ev.room;
                setTimeout(() => {
                    updateRoomStateUI(ev.room);
                    showVictoryModal(ev.room);
                }, activeFlightAnimation ? 2800 : 500);
                break;

            case 'banter':
                showBanterBubble(ev.sender_name, ev.avatar, ev.text, ev.emoji);
                break;

            case 'error':
                showToast(ev.message);
                break;
        }
    }

    // --- UI State Transitions ---
    function switchScreen(screenEl) {
        [elScreenLobby, elScreenWaiting, elScreenGame].forEach(s => s.classList.remove('active'));
        screenEl.classList.add('active');
        if (screenEl === elScreenGame) {
            document.body.classList.add('in-gameplay');
            requestAnimationFrame(() => {
                resizeCanvas();
                requestAnimationFrame(() => {
                    resizeCanvas();
                });
            });
        } else {
            document.body.classList.remove('in-gameplay');
            const drawer = document.getElementById('chalkboard-container');
            if (drawer) drawer.classList.remove('open');
        }
    }

    function updateRoomStateUI(room) {
        if (!room) return;

        // Waiting Lobby Screen
        if (room.phase === 'lobby') {
            switchScreen(elScreenWaiting);
            renderWaitingRoom(room);
        } else {
            // Game screen
            switchScreen(elScreenGame);
            renderScoreboard(room);
            updateTurnHeader(room);
        }
    }

    function renderWaitingRoom(room) {
        document.getElementById('waiting-room-code-display').textContent = room.room_code;
        document.getElementById('waiting-target-display').textContent = `${room.settings.target_points} pts`;
        document.getElementById('waiting-timer-display').textContent = room.settings.turn_timer_seconds > 0 ? `${room.settings.turn_timer_seconds}s` : 'Sin límite';

        const courtNames = {
            'cajon_barro': '🏺 Cajón de Barro tradicional',
            'piso_pared': '🏛️ Piso & Pared (Rebote y Carambola)'
        };
        const elCourtDisplay = document.getElementById('waiting-court-display');
        if (elCourtDisplay) {
            elCourtDisplay.textContent = courtNames[room.settings.court_theme] || '🏺 Cajón de Barro';
        }

        elWaitingPlayersList.innerHTML = '';
        room.players.forEach(p => {
            const card = document.createElement('div');
            card.className = `player-card-waiting ${p.id === myPlayerId ? 'is-self' : ''}`;
            card.innerHTML = `
                <div class="player-meta">
                    <div class="player-avatar-circle" style="border-color:${p.color};background:${p.color}22">
                        ${p.avatar}
                    </div>
                    <div>
                        <div style="font-weight:700;font-size:14px;color:${p.color}">${escapeHtml(p.name)}</div>
                        <div style="font-size:11px;color:#a8a29e;">Moneda: ${getCoinSkinName(p.coin_skin)}</div>
                    </div>
                </div>
                <div>
                    ${p.is_host ? '<span class="badge-host">Anfitrión</span>' : ''}
                    ${p.is_bot ? '<span class="bot-tag">BOT</span>' : ''}
                    ${isHost && p.is_bot ? `<button class="btn-icon" data-bot-id="${p.id}" style="width:28px;height:28px;display:inline-flex;">✖</button>` : ''}
                </div>
            `;
            elWaitingPlayersList.appendChild(card);
        });

        // Add Bot removal click listeners
        elWaitingPlayersList.querySelectorAll('[data-bot-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                sendWsAction({ action: 'remove_bot', bot_id: btn.dataset.botId });
            });
        });

        // Only host can start game
        if (room.host_id === myPlayerId) {
            elBtnStartGame.style.display = 'flex';
            document.getElementById('btn-add-bot').style.display = 'block';
        } else {
            elBtnStartGame.style.display = 'none';
            document.getElementById('btn-add-bot').style.display = 'none';
        }
    }

    function renderScoreboard(room) {
        document.getElementById('scoreboard-round').textContent = `Ronda ${room.round_number}`;
        document.getElementById('scoreboard-target').textContent = `Meta: ${room.settings.target_points} pts`;

        // Update Mobile HUD
        const elMobRound = document.getElementById('mobile-hud-round');
        if (elMobRound) {
            elMobRound.textContent = `R${room.round_number} • ${room.settings.target_points} pts`;
        }
        const myP = room.players.find(p => p.id === myPlayerId);
        const elMobScore = document.getElementById('mobile-hud-score');
        if (elMobScore && myP) {
            elMobScore.textContent = `${myP.score} pts`;
        }

        elScoreboardTable.innerHTML = '';

        // Sort by score descending
        const sorted = [...room.players].sort((a, b) => b.score - a.score);

        sorted.forEach(p => {
            const isTurn = room.phase === 'throwing' && p.id === (room.turn_order[room.turn_index] || '');
            const row = document.createElement('div');
            row.className = `score-row ${isTurn ? 'active-turn' : ''}`;
            row.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:22px;">${p.avatar}</span>
                    <div>
                        <div style="color:${p.color};font-weight:700;">${escapeHtml(p.name)}</div>
                        <div style="font-size:11px;color:#94a3b8;font-family:sans-serif;">Rayadas: ${p.rayadas} | Mejor: ${formatDistDisplay(p.best_distance_mm)}</div>
                    </div>
                </div>
                <div class="score-points" style="color:${p.color}">${p.score}</div>
            `;
            elScoreboardTable.appendChild(row);
        });
    }

    function updateTurnHeader(room) {
        const elMobStatus = document.getElementById('mobile-hud-status');
        const elMobTurnPill = document.getElementById('mobile-hud-turn');

        if (!room || room.phase !== 'throwing') {
            elActiveThrowerName.textContent = room && room.phase === 'round_review' ? 'Dictamen del Cantinero...' : 'Fin de Partida';
            elTurnTimer.style.display = 'none';
            if (elMobStatus) elMobStatus.textContent = room && room.phase === 'round_review' ? 'Dictamen...' : 'Pausa';
            if (elMobTurnPill) elMobTurnPill.classList.remove('my-turn');
            clearInterval(timerInterval);
            if (elFlickInstruction) elFlickInstruction.textContent = "Partida en pausa";
            return;
        }

        const activePlayer = room.players.find(p => p.id === room.turn_order[room.turn_index]);
        if (!activePlayer) return;

        const isMe = activePlayer.id === myPlayerId;

        if (activeFlightAnimation !== null || isWaitingForNextTurn) {
            elActiveThrowerName.textContent = "🪙 Moneda en movimiento...";
            elActiveThrowerName.style.color = "var(--gold-glow)";
            if (elMobStatus) elMobStatus.textContent = "🪙 En vuelo...";
            if (elMobTurnPill) elMobTurnPill.classList.remove('my-turn');
            if (elFlickInstruction) elFlickInstruction.textContent = "Esperando a que la moneda se asiente en el barro...";
        } else if (isMe) {
            elActiveThrowerName.textContent = '¡ES TU TURNO DE TIRAR!';
            elActiveThrowerName.style.color = activePlayer.color;
            if (elMobStatus) elMobStatus.textContent = "¡Tu Turno!";
            if (elMobTurnPill) elMobTurnPill.classList.add('my-turn');
            if (elFlickInstruction) elFlickInstruction.textContent = "👆 ¡Es tu turno! Desliza tu dedo hacia adelante o arrastra hacia atrás";
        } else {
            elActiveThrowerName.textContent = `Tira ${activePlayer.name}`;
            elActiveThrowerName.style.color = activePlayer.color;
            if (elMobStatus) elMobStatus.textContent = `Tira ${activePlayer.name}`;
            if (elMobTurnPill) elMobTurnPill.classList.remove('my-turn');
            if (elFlickInstruction) elFlickInstruction.textContent = `⏳ ${activePlayer.name} está midiendo su tiro a la raya...`;
        }

        // Turn timer
        if (room.turn_deadline_unix_ms && !activeFlightAnimation && !isWaitingForNextTurn) {
            elTurnTimer.style.display = 'flex';
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((room.turn_deadline_unix_ms - Date.now()) / 1000));
                elTurnTimer.textContent = `⏱️ ${remaining}s`;
                const elMobTimer = document.getElementById('mobile-hud-timer');
                if (elMobTimer) elMobTimer.textContent = `⏱️ ${remaining}s`;
                if (remaining <= 5) {
                    elTurnTimer.classList.add('urgent');
                } else {
                    elTurnTimer.classList.remove('urgent');
                }
                if (remaining === 0) {
                    clearInterval(timerInterval);
                }
            }, 500);
        } else {
            elTurnTimer.style.display = 'none';
        }
    }

    // --- Throw Handling & Fluid Animation ---
    function spawnSparks(wx, wy) {
        const sparkColors = ['#fef08a', '#f59e0b', '#ffffff', '#fbbf24', '#cbd5e1'];
        for (let i = 0; i < 18; i++) {
            const angle = Math.random() * Math.PI * 2;
            const spd = Math.random() * 0.85 + 0.35;
            clayParticles.push({
                wx,
                wy,
                wz: 0.04,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                vz: Math.random() * 0.70 + 0.25,
                color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
                life: 1.0,
                decay: Math.random() * 0.05 + 0.035
            });
        }
    }

    function handleThrowAnimation(ev) {
        const { sim, dicho_es } = ev;

        if (ev.room) {
            currentRoom = ev.room;
        }

        audio.playCoinFlight();

        // Build knockouts map for responsive victim coin recoil
        const knockoutsMap = {};
        if (sim.knockouts && sim.knockouts.length > 0) {
            sim.knockouts.forEach(k => {
                knockoutsMap[k.victim_coin_id] = k;
            });
        }

        // Calibrate animation duration so flight, bounce, and all chain collisions play out completely
        const maxCollisionTimeS = (sim.knockouts && sim.knockouts.length > 0)
            ? Math.max(...sim.knockouts.map(k => k.collision_time_s))
            : sim.flight_duration_s;
        const baseFlightMs = sim.flight_duration_s * 1000 * 1.35;
        const animDurationMs = Math.max(1800, Math.max(baseFlightMs, (maxCollisionTimeS * 1000) + 650));

        // Seamless handoff from client-side pending launch if this was the local player's throw
        let startOffset = 0;
        if (pendingLaunch) {
            startOffset = Math.min(performance.now() - pendingLaunch.startTime, 350);
            pendingLaunch = null;
        }

        activeFlightAnimation = {
            sim,
            trajectory: sim.trajectory,
            coin: sim.coin,
            knockoutsMap,
            animDurationMs,
            startTime: performance.now() - startOffset,
            triggeredBounces: new Set(),
            triggeredKnockouts: new Set(),
            onComplete: () => {
                activeFlightAnimation = null;
                isWaitingForNextTurn = true;

                // Play conclusion cue if not already triggered
                if (sim.sound_cue === 'rayada') {
                    audio.playRayada();
                } else if (sim.sound_cue === 'clavada') {
                    audio.playClavada();
                }

                // Selective speech: only speak on highlights (Rayada, Clavada, Carambola, OffBox)
                const isHighlight = sim.coin.is_on_line || sim.was_clavada || (sim.knockouts && sim.knockouts.length > 0) || sim.coin.status === 'OffBox';
                if (isHighlight) {
                    audio.speakDicho(dicho_es);
                }
                showBanterBubble(ev.player_name, ev.avatar, dicho_es, sim.coin.is_on_line ? '🎯' : '🪙');

                // Buffer pause: give player 1.4s to absorb where coin landed before next throw
                setTimeout(() => {
                    isWaitingForNextTurn = false;
                    if (currentRoom) {
                        updateTurnHeader(currentRoom);
                        renderScoreboard(currentRoom);
                    }
                }, 1400);
            }
        };

        if (currentRoom) {
            updateTurnHeader(currentRoom);
        }
    }

    function triggerCameraShake(intensity = 4) {
        cameraShakeTrauma = intensity;
    }

    function addClaySkidMark(x1, y1, x2, y2) {
        claySkidMarks.push({ x1, y1, x2, y2 });
        if (claySkidMarks.length > 20) claySkidMarks.shift();
    }

    function showFotoFinishModal(room) {
        if (!room.last_verdict) return;
        targetCameraMode = 'overhead';

        elVerdictBanner.textContent = room.last_verdict.summary_es;
        elAwardsList.innerHTML = '';

        room.last_verdict.awards.forEach(aw => {
            const div = document.createElement('div');
            div.className = 'award-item';
            div.innerHTML = `
                <div>${aw.avatar} <strong>${escapeHtml(aw.player_name)}</strong></div>
                <div style="color:var(--gold-centenario);font-weight:700;">${aw.reason}</div>
            `;
            elAwardsList.appendChild(div);
        });

        // Only host can trigger next round
        elBtnNextRound.style.display = (room.host_id === myPlayerId || room.players.every(p => p.is_bot || p.id === myPlayerId)) ? 'block' : 'none';

        setTimeout(() => {
            elModalFotoFinish.classList.add('active');
        }, 1200);
    }

    function showVictoryModal(room) {
        targetCameraMode = 'perspective';
        audio.playVictoryFanfare();

        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        const winner = sorted[0];

        elVictoryPodium.innerHTML = `
            <div style="font-size:48px;margin-bottom:8px;">🏆</div>
            <h3 style="color:${winner.color};font-size:26px;font-family:var(--font-display);">${escapeHtml(winner.name)}</h3>
            <p style="color:#fcd34d;font-size:15px;margin-top:4px;">¡Campeón de la Cantina con ${winner.score} puntos!</p>
        `;

        elVictoryStats.innerHTML = `
            <div style="background:#100703;padding:14px;border-radius:8px;margin-top:14px;text-align:left;font-size:13px;line-height:1.7;border:1px solid #78350f;">
                <div>🎯 <strong>Rayadas en la línea:</strong> ${winner.rayadas}</div>
                <div>⭐ <strong>Clavadas de barro:</strong> ${winner.clavadas}</div>
                <div>💥 <strong>Carambolas y Knockouts:</strong> ${winner.knockouts}</div>
                <div>📏 <strong>Tiro más certero:</strong> ${formatDistDisplay(winner.best_distance_mm)}</div>
            </div>
        `;

        elBtnPlayAgain.style.display = (room.host_id === myPlayerId) ? 'block' : 'none';

        setTimeout(() => {
            elModalVictory.classList.add('active');
        }, 1500);
    }

    // --- 2.5D Canvas Rendering Engine ---
    function initCanvas() {
        canvas = document.getElementById('rayuela-canvas');
        ctx = canvas.getContext('2d');
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 150));
        setupPointerEvents();
    }

    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
        if (!rect || rect.width === 0 || rect.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
    }

    function setupPointerEvents() {
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
    }

    function isMyTurn() {
        if (!currentRoom || currentRoom.phase !== 'throwing') return false;
        if (activeFlightAnimation !== null || pendingLaunch !== null || isWaitingForNextTurn) return false;
        const activeId = currentRoom.turn_order[currentRoom.turn_index];
        return activeId === myPlayerId;
    }

    function onPointerDown(e) {
        if (!isMyTurn()) {
            if (activeFlightAnimation !== null || pendingLaunch !== null || isWaitingForNextTurn) {
                showToast("Espera a que la moneda se detenga en el barro");
            }
            return;
        }
        isDragging = true;
        const rect = canvas.getBoundingClientRect();
        dragStartPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        dragCurrentPos = { ...dragStartPos };
        canvas.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const rect = canvas.getBoundingClientRect();
        dragCurrentPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        const dx = dragCurrentPos.x - dragStartPos.x;
        const dy = dragCurrentPos.y - dragStartPos.y;

        // Angle derived from lateral drag offset
        aimingAngleDeg = (dx * 0.18).clamp(-25.0, 25.0);

        // Power derived from pull-down distance (sling style) or flick
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isMobileScreen = canvas && (canvas.width / (window.devicePixelRatio || 1) < 650);
        const maxDragDist = isMobileScreen ? 170.0 : 220.0;
        aimingPower = (0.2 + (dist / maxDragDist)).clamp(0.15, 0.95);

        // Update indicators
        elAngleValue.textContent = `${aimingAngleDeg >= 0 ? '+' : ''}${aimingAngleDeg.toFixed(1)}°`;
        elPowerValue.textContent = `${Math.round(aimingPower * 100)}%`;
        elPowerFill.style.width = `${Math.round(aimingPower * 100)}%`;
    }

    function onPointerUp(e) {
        if (!isDragging) return;
        isDragging = false;

        const dx = dragCurrentPos.x - dragStartPos.x;
        const dy = dragCurrentPos.y - dragStartPos.y;
        const totalDist = Math.sqrt(dx * dx + dy * dy);

        if (totalDist > 25 && isMyTurn()) {
            // Immediate client-side launch: coin begins flight instantly without disappearing
            pendingLaunch = {
                startTime: performance.now(),
                power: aimingPower,
                angleDeg: aimingAngleDeg,
                elevationDeg: aimingElevation,
                coin: {
                    id: 'local_launch_' + Date.now(),
                    player_id: myPlayerId,
                    player_name: elPlayerName.value.trim() || 'Tú',
                    avatar: selectedAvatar,
                    color: selectedColor,
                    coin_skin: selectedCoinSkin,
                }
            };

            audio.playCoinFlight();

            // Execute pitch to server
            sendWsAction({
                action: 'throw_coin',
                angle_deg: aimingAngleDeg,
                power: aimingPower,
                elevation_deg: aimingElevation,
                spin: 0.0
            });
        }

        // Reset indicator visuals
        elAngleValue.textContent = `0.0°`;
        elPowerValue.textContent = `0%`;
        elPowerFill.style.width = `0%`;
    }

    // --- Perspective & Projection Mathematics ---
    function worldToScreen25D(wx, wy, wz, width, height) {
        const isMobile = width < 650 || (width / height < 0.9);

        // Responsive horizon and throw line
        const horizonY = isMobile ? height * 0.13 : height * 0.22;
        const throwY = isMobile ? height * 0.81 : height * 0.88;
        const depthRange = 5.0;

        // Depth perspective scale:
        // On mobile, keep perspective less compressed so the far cajón remains big and legible
        const depthFrac = (wy / depthRange).clamp(0.0, 1.0);
        const taper = isMobile ? 0.36 : 0.65;
        const scale = 1.0 - (depthFrac * taper);

        // Lateral width scale:
        // On mobile portrait, make the court fill 94% of screen width for clear touch targets
        const lateralFactor = isMobile ? 0.94 : 0.42;

        const screenX = (width / 2) + (wx * (width * lateralFactor) * scale);
        const screenY = throwY - (depthFrac * (throwY - horizonY)) - (wz * (isMobile ? 130 : 180) * scale);

        return { x: screenX, y: screenY, scale };
    }

    function worldToScreenOverhead(wx, wy, width, height) {
        const isMobile = width < 650 || (width / height < 0.9);
        const boxCenterY = 3.75;
        const boxCenterX = 0.0;

        // Zoom: on mobile portrait, fill 85% of screen width
        const zoom = isMobile
            ? Math.min(width / 1.15, height / 1.7)
            : Math.min(width / 1.4, height / 2.0);

        const screenX = (width / 2) + ((wx - boxCenterX) * zoom);
        const screenY = (height / 2) + ((wy - boxCenterY) * zoom);

        return { x: screenX, y: screenY, scale: zoom / 250 };
    }

    function startRenderLoop() {
        function render(now) {
            animationFrameId = requestAnimationFrame(render);
            if (!canvas || !ctx) return;

            // Auto-detect container resize (e.g. mobile URL bar hiding/showing, orientation change, screen transition)
            const parent = canvas.parentElement;
            if (parent) {
                const rect = parent.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const targetW = Math.round(rect.width * dpr);
                const targetH = Math.round(rect.height * dpr);
                if (rect.width > 0 && rect.height > 0 && (canvas.width !== targetW || canvas.height !== targetH)) {
                    resizeCanvas();
                }
            }

            const w = canvas.width / (window.devicePixelRatio || 1);
            const h = canvas.height / (window.devicePixelRatio || 1);

            ctx.clearRect(0, 0, w, h);

            // Camera micro-shake damping
            if (cameraShakeTrauma > 0) {
                cameraShakeOffset.x = (Math.random() - 0.5) * cameraShakeTrauma;
                cameraShakeOffset.y = (Math.random() - 0.5) * cameraShakeTrauma;
                cameraShakeTrauma *= 0.88;
                if (cameraShakeTrauma < 0.1) cameraShakeTrauma = 0;
            } else {
                cameraShakeOffset.x = 0;
                cameraShakeOffset.y = 0;
            }

            ctx.save();
            ctx.translate(cameraShakeOffset.x, cameraShakeOffset.y);

            // Smooth camera transition between 2.5D perspective and Foto-Finish overhead
            const targetFrac = targetCameraMode === 'overhead' ? 1.0 : 0.0;
            cameraTransitionFrac += (targetFrac - cameraTransitionFrac) * 0.08;

            if (cameraTransitionFrac < 0.98) {
                renderPerspectiveCantina(w, h, 1.0 - cameraTransitionFrac);
            }
            if (cameraTransitionFrac > 0.02) {
                renderOverheadFotoFinish(w, h, cameraTransitionFrac);
            }

            renderParticles();
            ctx.restore();
        }
        animationFrameId = requestAnimationFrame(render);
    }

    function renderPerspectiveCantina(w, h, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;

        const courtTheme = (currentRoom && currentRoom.settings && currentRoom.settings.court_theme) || selectedCourtTheme || 'cajon_barro';

        // 1. Render Court Background & Surface by Theme
        if (courtTheme === 'piso_pared') {
            // --- COURT 2: PISO & PARED (Cantina Tile & Wood Rebound Wall) ---
            const floorGrad = ctx.createLinearGradient(0, h * 0.22, 0, h);
            floorGrad.addColorStop(0, '#1c0a03');
            floorGrad.addColorStop(0.4, '#2e1206');
            floorGrad.addColorStop(1, '#180702');
            ctx.fillStyle = floorGrad;
            ctx.fillRect(0, 0, w, h);

            // Talavera Tile Grid in perspective
            ctx.strokeStyle = 'rgba(254, 240, 138, 0.16)';
            ctx.lineWidth = 1.2;
            for (let x = -1.2; x <= 1.2; x += 0.3) {
                const p1 = worldToScreen25D(x, 0.0, 0.0, w, h);
                const p2 = worldToScreen25D(x, 4.5, 0.0, w, h);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
            for (let y = 0.5; y <= 4.5; y += 0.5) {
                const p1 = worldToScreen25D(-1.2, y, 0.0, w, h);
                const p2 = worldToScreen25D(1.2, y, 0.0, w, h);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }

            // Solid Mahogany Back-Wall at Y = 4.5m (Carambola Wall!)
            const wBL = worldToScreen25D(-1.25, 4.5, 0.0, w, h);
            const wBR = worldToScreen25D(1.25, 4.5, 0.0, w, h);
            const wTL = worldToScreen25D(-1.25, 4.5, 0.75, w, h);
            const wTR = worldToScreen25D(1.25, 4.5, 0.75, w, h);

            // Wall face
            const wallGrad = ctx.createLinearGradient(0, wTL.y, 0, wBL.y);
            wallGrad.addColorStop(0, '#451a03');
            wallGrad.addColorStop(0.5, '#78350f');
            wallGrad.addColorStop(1, '#291205');
            ctx.fillStyle = wallGrad;
            ctx.beginPath();
            ctx.moveTo(wTL.x, wTL.y);
            ctx.lineTo(wTR.x, wTR.y);
            ctx.lineTo(wBR.x, wBR.y);
            ctx.lineTo(wBL.x, wBL.y);
            ctx.closePath();
            ctx.fill();

            // Brass rail trim along wall bottom and top
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(wTL.x, wTL.y);
            ctx.lineTo(wTR.x, wTR.y);
            ctx.moveTo(wBL.x, wBL.y);
            ctx.lineTo(wBR.x, wBR.y);
            ctx.stroke();

            // Carambola Wall sign
            ctx.fillStyle = '#fef08a';
            ctx.font = 'bold 11px Cinzel, serif';
            ctx.textAlign = 'center';
            ctx.fillText('✦ PARED DE CARAMBOLA — REBOTE PERMITIDO ✦', w / 2, (wTL.y + wBL.y) / 2);

            // Inlaid Brass Target Line at Y = 3.75m
            const r1 = worldToScreen25D(-0.9, 3.75, 0.0, w, h);
            const r2 = worldToScreen25D(0.9, 3.75, 0.0, w, h);
            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(r1.x, r1.y);
            ctx.lineTo(r2.x, r2.y);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
            ctx.lineWidth = 9;
            ctx.stroke();

        } else {
            // --- COURT 1: CAJÓN DE BARRO (Traditional Wet Clay Pit) ---
            const floorGrad = ctx.createLinearGradient(0, h * 0.22, 0, h);
            floorGrad.addColorStop(0, '#120904');
            floorGrad.addColorStop(0.5, '#221107');
            floorGrad.addColorStop(1, '#170b04');
            ctx.fillStyle = floorGrad;
            ctx.fillRect(0, 0, w, h);

            // Wood plank perspective lines
            ctx.strokeStyle = 'rgba(74, 30, 7, 0.4)';
            ctx.lineWidth = 1.5;
            for (let x = -1.2; x <= 1.2; x += 0.4) {
                const p1 = worldToScreen25D(x, 0.0, 0.0, w, h);
                const p2 = worldToScreen25D(x, 4.8, 0.0, w, h);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }

            // Outer box corners: X in [-0.52, 0.52], Y in [2.98, 4.52]
            const c1 = worldToScreen25D(-0.52, 2.98, 0.08, w, h);
            const c2 = worldToScreen25D(0.52, 2.98, 0.08, w, h);
            const c3 = worldToScreen25D(0.52, 4.52, 0.08, w, h);
            const c4 = worldToScreen25D(-0.52, 4.52, 0.08, w, h);

            ctx.fillStyle = '#291205';
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y);
            ctx.lineTo(c2.x, c2.y);
            ctx.lineTo(c3.x, c3.y);
            ctx.lineTo(c4.x, c4.y);
            ctx.closePath();
            ctx.fill();

            // Damp clay inner bed: X in [-0.48, 0.48], Y in [3.02, 4.48]
            const b1 = worldToScreen25D(-0.48, 3.02, 0.0, w, h);
            const b2 = worldToScreen25D(0.48, 3.02, 0.0, w, h);
            const b3 = worldToScreen25D(0.48, 4.48, 0.0, w, h);
            const b4 = worldToScreen25D(-0.48, 4.48, 0.0, w, h);

            const clayGrad = ctx.createLinearGradient(0, b3.y, 0, b1.y);
            clayGrad.addColorStop(0, '#3f1f06');
            clayGrad.addColorStop(0.5, '#5c3008');
            clayGrad.addColorStop(1, '#4a2507');
            ctx.fillStyle = clayGrad;
            ctx.beginPath();
            ctx.moveTo(b1.x, b1.y);
            ctx.lineTo(b2.x, b2.y);
            ctx.lineTo(b3.x, b3.y);
            ctx.lineTo(b4.x, b4.y);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 4;
            ctx.stroke();

            // Center line (La Raya) at Y = 3.75
            const r1 = worldToScreen25D(-0.48, 3.75, 0.0, w, h);
            const r2 = worldToScreen25D(0.48, 3.75, 0.0, w, h);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(r1.x, r1.y);
            ctx.lineTo(r2.x, r2.y);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
            ctx.lineWidth = 8;
            ctx.stroke();

            // Render Clay Skid Marks
            claySkidMarks.forEach(sm => {
                const sp1 = worldToScreen25D(sm.x1, sm.y1, 0.0, w, h);
                const sp2 = worldToScreen25D(sm.x2, sm.y2, 0.0, w, h);
                ctx.strokeStyle = 'rgba(35, 16, 4, 0.7)';
                ctx.lineWidth = 7 * sp1.scale;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(sp1.x, sp1.y);
                ctx.lineTo(sp2.x, sp2.y);
                ctx.stroke();
            });
        }

        // Throw line (Línea de tiro) at Y = 0.2
        const tl1 = worldToScreen25D(-0.8, 0.2, 0.0, w, h);
        const tl2 = worldToScreen25D(0.8, 0.2, 0.0, w, h);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tl1.x, tl1.y);
        ctx.lineTo(tl2.x, tl2.y);
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LÍNEA DE TIRO (RAYA INICIAL)', w / 2, tl1.y + 18);

        // 2. Render Settled Coins on the Court
        if (currentRoom && currentRoom.current_round_coins) {
            currentRoom.current_round_coins.forEach(coin => {
                // If this is the coin currently flying in activeFlightAnimation, skip!
                if (activeFlightAnimation && activeFlightAnimation.coin && coin.id === activeFlightAnimation.coin.id) {
                    return;
                }
                // If this is the coin currently launched locally, skip!
                if (pendingLaunch && pendingLaunch.coin && coin.player_id === myPlayerId) {
                    return;
                }

                // If this coin was struck in a collision during activeFlightAnimation:
                if (activeFlightAnimation && activeFlightAnimation.knockoutsMap && activeFlightAnimation.knockoutsMap[coin.id]) {
                    const k = activeFlightAnimation.knockoutsMap[coin.id];
                    const elapsed = performance.now() - activeFlightAnimation.startTime;
                    const totalSimTime = activeFlightAnimation.sim.flight_duration_s || 1.0;
                    const collTimeMs = (k.collision_time_s / totalSimTime) * activeFlightAnimation.animDurationMs;
                    const timeSinceCollisionMs = elapsed - collTimeMs;

                    if (timeSinceCollisionMs < 0) {
                        // BEFORE COLLISION: Coin stays stationary at its pre-collision position!
                        const p = worldToScreen25D(k.old_x, k.old_y, coin.z, w, h);
                        drawPerspectiveCoin(ctx, p.x, p.y, p.scale, coin, false, 1.0, 0);
                        return;
                    } else {
                        // AFTER COLLISION: Coin slides with smooth cubic ease-out deceleration over 450ms!
                        const slideDurationMs = 450;
                        const slideProg = Math.min(1.0, timeSinceCollisionMs / slideDurationMs);
                        const easeOutSlide = 1.0 - Math.pow(1.0 - slideProg, 3);
                        const curVictimX = k.old_x + (k.new_x - k.old_x) * easeOutSlide;
                        const curVictimY = k.old_y + (k.new_y - k.old_y) * easeOutSlide;
                        const p = worldToScreen25D(curVictimX, curVictimY, coin.z, w, h);
                        drawPerspectiveCoin(ctx, p.x, p.y, p.scale, coin, false, 1.0, 0);
                        return;
                    }
                }

                // Normal settled coin
                const p = worldToScreen25D(coin.x, coin.y, coin.z, w, h);
                drawPerspectiveCoin(ctx, p.x, p.y, p.scale, coin, false, 1.0, 0);
            });
        }

        // 3a. Render Active In-Flight / Bouncing / Knockout Coin
        if (activeFlightAnimation) {
            const anim = activeFlightAnimation;
            const elapsed = performance.now() - anim.startTime;
            const animProg = Math.min(1.0, elapsed / anim.animDurationMs);
            const simTime = animProg * (anim.sim.flight_duration_s || 1.0);
            const traj = anim.trajectory;

            let curX = traj[0].x;
            let curY = traj[0].y;
            let curZ = traj[0].z;

            if (traj.length > 1) {
                let idx = 0;
                while (idx < traj.length - 1 && traj[idx + 1].t < simTime) {
                    idx++;
                }
                const p0 = traj[idx];
                const p1 = traj[Math.min(traj.length - 1, idx + 1)];
                const dt = p1.t - p0.t;
                const segFrac = dt > 0.0001 ? ((simTime - p0.t) / dt).clamp(0.0, 1.0) : 0.0;
                const smoothT = segFrac * segFrac * (3 - 2 * segFrac);

                curX = p0.x + (p1.x - p0.x) * smoothT;
                curY = p0.y + (p1.y - p0.y) * smoothT;
                curZ = p0.z + (p1.z - p0.z) * smoothT;
            }

            // Check and trigger bounce events
            for (let i = 0; i < traj.length; i++) {
                if (traj[i].is_bounce && simTime >= traj[i].t && !anim.triggeredBounces.has(i)) {
                    anim.triggeredBounces.add(i);

                    const isWallBounce = courtTheme === 'piso_pared' && traj[i].y >= 4.42;
                    if (isWallBounce) {
                        audio.playWallBounce();
                        triggerCameraShake(7);
                        spawnSparks(traj[i].x, traj[i].y);
                    } else if (courtTheme === 'piso_pared') {
                        audio.playBounceTile();
                        triggerCameraShake(3);
                        spawnSparks(traj[i].x, traj[i].y);
                    } else {
                        audio.playClayThud();
                        triggerCameraShake(4);
                        spawnClayParticles(traj[i].x, traj[i].y, '#5c3008');
                        if (i > 0) {
                            addClaySkidMark(traj[i - 1].x, traj[i - 1].y, traj[i].x, traj[i].y);
                        }
                    }
                }
            }

            // Check and trigger knockout collisions
            if (anim.sim.knockouts) {
                anim.sim.knockouts.forEach((k, kIdx) => {
                    if (simTime >= k.collision_time_s && !anim.triggeredKnockouts.has(kIdx)) {
                        anim.triggeredKnockouts.add(kIdx);
                        audio.playCoinKnockout();
                        triggerCameraShake(8);
                        spawnSparks(k.collision_x, k.collision_y);
                        addClaySkidMark(k.old_x, k.old_y, k.new_x, k.new_y);
                        activeCarambolaBanner = {
                            text: k.was_on_line
                                ? `💥 ¡CARAMBOLA MAESTRA! ${anim.coin.player_name} desbancó a ${k.victim_player_name}`
                                : `💥 ¡CARAMBOLA! ${anim.coin.player_name} sacó la moneda de ${k.victim_player_name}`,
                            expireTime: performance.now() + 2600
                        };
                        showToast(activeCarambolaBanner.text);
                    }
                });
            }

            // In-air tumbling vs ground orientation
            const inAir = curZ > 0.02;
            const flips = inAir ? 4.5 : 0;
            const tiltY = inAir
                ? (Math.abs(Math.cos(animProg * Math.PI * 2 * flips)) * 0.72 + 0.28)
                : (anim.sim.was_clavada ? 0.35 : 1.0);

            // Ground shadow
            const shadowP = worldToScreen25D(curX, curY, 0.0, w, h);
            const shadowAlpha = (0.55 * (1.0 - (curZ / 1.6).clamp(0, 0.75))).clamp(0.12, 0.58);
            ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
            ctx.beginPath();
            ctx.ellipse(shadowP.x, shadowP.y, 18 * shadowP.scale, 9 * shadowP.scale, 0, 0, Math.PI * 2);
            ctx.fill();

            // Render the coin in flight
            const airP = worldToScreen25D(curX, curY, curZ, w, h);
            drawPerspectiveCoin(ctx, airP.x, airP.y, airP.scale * (inAir ? 1.15 : 1.0), anim.coin, inAir, tiltY, 0);

            if (animProg >= 1.0) {
                anim.onComplete();
            }
        }

        // 3b. Render Immediate Client-Side Flight (Pending server confirmation)
        if (pendingLaunch && !activeFlightAnimation) {
            const now = performance.now();
            const t = (now - pendingLaunch.startTime) / 1000;
            const radAngle = (pendingLaunch.angleDeg * Math.PI) / 180;
            const radElev = (pendingLaunch.elevationDeg * Math.PI) / 180;
            const speed = 4.2 + (pendingLaunch.power * 4.4);
            const vx = speed * Math.cos(radElev) * Math.sin(radAngle);
            const vy = speed * Math.cos(radElev) * Math.cos(radAngle);
            const vz = speed * Math.sin(radElev);

            const curX = vx * t;
            const curY = 0.2 + vy * t;
            const curZ = Math.max(0.0, 0.12 + vz * t - 0.5 * 9.81 * t * t);
            const inAir = curZ > 0.02;
            const flips = inAir ? 4.5 : 0;
            const tiltY = inAir ? (Math.abs(Math.cos(t * Math.PI * 2 * flips)) * 0.72 + 0.28) : 1.0;

            // Ground shadow
            const shadowP = worldToScreen25D(curX, curY, 0.0, w, h);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.50)';
            ctx.beginPath();
            ctx.ellipse(shadowP.x, shadowP.y, 18 * shadowP.scale, 9 * shadowP.scale, 0, 0, Math.PI * 2);
            ctx.fill();

            // Flying coin
            const airP = worldToScreen25D(curX, curY, curZ, w, h);
            drawPerspectiveCoin(ctx, airP.x, airP.y, airP.scale * (inAir ? 1.15 : 1.0), pendingLaunch.coin, inAir, tiltY, 0);
        }

        // 4. Idle Ready Coin on Throw Line OR Dragging Slingshot
        if (isMyTurn() && !activeFlightAnimation && !pendingLaunch) {
            const myPlayerCoin = {
                id: 'my_ready_coin',
                player_id: myPlayerId,
                player_name: (currentRoom && currentRoom.players.find(p => p.id === myPlayerId)?.name) || 'Tú',
                avatar: selectedAvatar,
                color: selectedColor,
                coin_skin: selectedCoinSkin,
            };

            const tlCenter = worldToScreen25D(0.0, 0.2, 0.0, w, h);

            if (isDragging) {
                // Elastic cords from throw line anchors to the dragged coin
                const anchorL = worldToScreen25D(-0.25, 0.2, 0.0, w, h);
                const anchorR = worldToScreen25D(0.25, 0.2, 0.0, w, h);

                ctx.save();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(anchorL.x, anchorL.y);
                ctx.lineTo(dragCurrentPos.x, dragCurrentPos.y);
                ctx.moveTo(anchorR.x, anchorR.y);
                ctx.lineTo(dragCurrentPos.x, dragCurrentPos.y);
                ctx.stroke();

                // Draw aiming trajectory
                drawAimingTrajectory(ctx, w, h);

                // Draw coin following the drag handle
                drawPerspectiveCoin(ctx, dragCurrentPos.x, dragCurrentPos.y, tlCenter.scale * 1.05, myPlayerCoin, false, 0.9, 0);
                ctx.restore();
            } else {
                // Idle resting coin on the throw line with pulsing glow
                const pulse = Math.sin(performance.now() * 0.005) * 0.15 + 0.85;

                ctx.save();
                // Subtle golden aura ring
                ctx.strokeStyle = `rgba(245, 158, 11, ${pulse * 0.6})`;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.ellipse(tlCenter.x, tlCenter.y, 28 * tlCenter.scale * pulse, 15 * tlCenter.scale * pulse, 0, 0, Math.PI * 2);
                ctx.stroke();

                // Ready coin
                drawPerspectiveCoin(ctx, tlCenter.x, tlCenter.y, tlCenter.scale, myPlayerCoin, false, 1.0, 0);

                // Interactive prompt banner above coin
                const promptY = tlCenter.y - 36 * tlCenter.scale;
                ctx.fillStyle = `rgba(20, 10, 5, 0.85)`;
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 1.5;
                ctx.font = 'bold 12px sans-serif';
                const promptText = '👆 Arrastra hacia abajo para lanzar';
                const pMetrics = ctx.measureText(promptText);
                const pw = pMetrics.width + 20;
                const ph = 24;

                ctx.beginPath();
                ctx.roundRect(tlCenter.x - pw / 2, promptY - ph / 2, pw, ph, 12);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#fef08a';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(promptText, tlCenter.x, promptY);
                ctx.restore();
            }
        }

        // 5. Arcade Carambola Banner Overlay
        if (activeCarambolaBanner && performance.now() < activeCarambolaBanner.expireTime) {
            const remaining = activeCarambolaBanner.expireTime - performance.now();
            const bannerAlpha = Math.min(1.0, remaining / 300);

            ctx.save();
            ctx.globalAlpha = bannerAlpha;
            const bx = w / 2;
            const by = h * 0.15;
            ctx.font = 'bold 15px "Cinzel", Georgia, serif';
            const bMetrics = ctx.measureText(activeCarambolaBanner.text);
            const bw = Math.max(280, bMetrics.width + 40);
            const bh = 36;

            ctx.fillStyle = 'rgba(15, 6, 2, 0.92)';
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 8);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fef08a';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(activeCarambolaBanner.text, bx, by);
            ctx.restore();
        }

        ctx.restore();
    }

    // --- Vibrant & Distinct Coin Drawing ---
    function drawPerspectiveCoin(ctx, x, y, scale, coin, inAir = false, tiltY = 1.0, spinAngle = 0) {
        ctx.save();
        const canvasW = canvas ? (canvas.width / (window.devicePixelRatio || 1)) : 800;
        const canvasH = canvas ? (canvas.height / (window.devicePixelRatio || 1)) : 600;
        const isMobileScreen = canvasW < 650 || (canvasW / canvasH < 0.9);
        const lateralFactor = isMobileScreen ? 0.94 : 0.42;

        // 1:1 physical calibration: COIN_RADIUS is 0.055m in physics.rs
        const COIN_PHYSICAL_RADIUS = 0.055;
        const physicalRadiusPx = COIN_PHYSICAL_RADIUS * (canvasW * lateralFactor) * scale;
        const r = Math.max(11, physicalRadiusPx);
        const ry = r * 0.52 * tiltY; // Vertical foreshortening + 3D tumbling tilt

        const playerColor = coin.color || '#f59e0b';

        // 1. Realistic Cast Shadow on ground
        if (!inAir) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.beginPath();
            ctx.ellipse(x, y + 3 * scale, r * 1.08, ry * 1.08, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Heavy Metallic Outer Bevel Rim
        const rimGrad = ctx.createLinearGradient(x - r, y - ry, x + r, y + ry);
        if (coin.coin_skin === 'plata_zapata') {
            rimGrad.addColorStop(0, '#ffffff');
            rimGrad.addColorStop(0.5, '#cbd5e1');
            rimGrad.addColorStop(1, '#64748b');
        } else if (coin.coin_skin === 'bronce_cantina') {
            rimGrad.addColorStop(0, '#fed7aa');
            rimGrad.addColorStop(0.5, '#c2410c');
            rimGrad.addColorStop(1, '#7c2d12');
        } else {
            // Gold Centenario / Diez Pesos base
            rimGrad.addColorStop(0, '#fef08a');
            rimGrad.addColorStop(0.3, '#f59e0b');
            rimGrad.addColorStop(0.8, '#b45309');
            rimGrad.addColorStop(1, '#78350f');
        }

        ctx.fillStyle = rimGrad;
        ctx.beginPath();
        ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6 * scale;
        ctx.stroke();

        // 3. VIBRANT PLAYER COLOR ENAMEL DISC (76% of radius)
        // Highly visible, rich color so every player's chip is completely distinct!
        const innerR = r * 0.76;
        const innerRy = ry * 0.76;

        const colorGrad = ctx.createRadialGradient(
            x - innerR * 0.35, y - innerRy * 0.35, innerR * 0.1,
            x, y, innerR
        );
        colorGrad.addColorStop(0, lightenColor(playerColor, 0.45));
        colorGrad.addColorStop(0.35, playerColor);
        colorGrad.addColorStop(1, darkenColor(playerColor, 0.45));

        ctx.fillStyle = colorGrad;
        ctx.beginPath();
        ctx.ellipse(x, y, innerR, innerRy, 0, 0, Math.PI * 2);
        ctx.fill();

        // Concentric golden accent ring inside player color field
        ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
        ctx.lineWidth = 1.8 * scale;
        ctx.beginPath();
        ctx.ellipse(x, y, innerR * 0.70, innerRy * 0.70, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 4. Center Emblem: Player Avatar stamped directly in center!
        if (scale > 0.35 && tiltY > 0.35) {
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${Math.max(11, Math.round((isMobileScreen ? 16 : 13) * scale))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(coin.avatar || '🪙', x, y);
        }

        // 5. Specular Gloss Glint across coin face
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x, y, innerR, innerRy, 0, 0, Math.PI * 2);
        ctx.clip();
        const glintGrad = ctx.createLinearGradient(x - innerR, y - innerRy, x + innerR, y + innerRy);
        glintGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
        glintGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.1)');
        glintGrad.addColorStop(0.55, 'transparent');
        ctx.fillStyle = glintGrad;
        ctx.fillRect(x - innerR, y - innerRy, innerR * 2, innerRy * 2);
        ctx.restore();

        // 6. Name Label Pill for Settled Coins on the table
        if (!inAir && scale > 0.30) {
            ctx.save();
            const labelY = y - ry - (12 * scale);
            const nameText = coin.player_name || 'Jugador';
            ctx.font = `bold ${Math.max(9, Math.round(11 * scale))}px sans-serif`;
            const textMetrics = ctx.measureText(nameText);
            const pillW = textMetrics.width + (14 * scale);
            const pillH = 14 * scale;

            // Pill background matching player color
            ctx.fillStyle = 'rgba(15, 10, 6, 0.88)';
            ctx.strokeStyle = playerColor;
            ctx.lineWidth = 1.8 * scale;
            roundRect(ctx, x - pillW / 2, labelY - pillH / 2, pillW, pillH, 4 * scale);
            ctx.fill();
            ctx.stroke();

            // Pill text
            ctx.fillStyle = playerColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(nameText, x, labelY);
            ctx.restore();
        }

        // 7. Golden Star / Beacon if touching the line!
        if (coin.is_on_line) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = `${Math.max(12, Math.round(16 * scale))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('🎯', x, y - ry - (22 * scale));
        }

        ctx.restore();
    }

    function drawAimingTrajectory(ctx, w, h) {
        ctx.save();
        const pStart = worldToScreen25D(0.0, 0.2, 0.0, w, h);

        ctx.strokeStyle = selectedColor || 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);

        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);

        const targetY = 3.0 + (aimingPower * 1.5);
        const targetX = (aimingAngleDeg / 25.0) * 0.45;

        for (let t = 0.1; t <= 1.0; t += 0.08) {
            const wy = 0.2 + (t * (targetY - 0.2));
            const wx = t * targetX;
            const wz = Math.sin(t * Math.PI) * 0.45;
            const pt = worldToScreen25D(wx, wy, wz, w, h);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Target reticle on ground
        const pEnd = worldToScreen25D(targetX, targetY, 0.0, w, h);
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(254, 240, 138, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(pEnd.x, pEnd.y, 14 * pEnd.scale, 7 * pEnd.scale, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }

    function renderOverheadFotoFinish(w, h, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;

        // Background
        ctx.fillStyle = '#0a0502';
        ctx.fillRect(0, 0, w, h);

        // Top-down Cajón: X in [-0.5, 0.5], Y in [3.0, 4.5]
        const topLeft = worldToScreenOverhead(-0.5, 3.0, w, h);
        const bottomRight = worldToScreenOverhead(0.5, 4.5, w, h);

        const boxW = bottomRight.x - topLeft.x;
        const boxH = bottomRight.y - topLeft.y;

        const courtTheme = (currentRoom && currentRoom.settings && currentRoom.settings.court_theme) || 'cajon_barro';

        // Court Bed by Theme
        if (courtTheme === 'piso_pared') {
            ctx.fillStyle = '#2e1206';
            ctx.fillRect(topLeft.x, topLeft.y, boxW, boxH);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 6;
            ctx.strokeRect(topLeft.x, topLeft.y, boxW, boxH);
            // Back wall at top
            ctx.fillStyle = '#451a03';
            ctx.fillRect(topLeft.x, topLeft.y, boxW, 14);
        } else {
            // Traditional Cajón de Barro Clay bed
            ctx.fillStyle = '#5c3008';
            ctx.fillRect(topLeft.x, topLeft.y, boxW, boxH);
            // Wooden frame
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 8;
            ctx.strokeRect(topLeft.x, topLeft.y, boxW, boxH);
        }

        // Center line (La Raya)
        const lineLeft = worldToScreenOverhead(-0.5, 3.75, w, h);
        const lineRight = worldToScreenOverhead(0.5, 3.75, w, h);

        ctx.strokeStyle = courtTheme === 'piso_pared' ? '#fef08a' : '#ffffff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(lineLeft.x, lineLeft.y);
        ctx.lineTo(lineRight.x, lineRight.y);
        ctx.stroke();

        // Laser calibration grid lines (every 5 cm)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (let d = -0.3; d <= 0.3; d += 0.1) {
            if (Math.abs(d) < 0.01) continue;
            const pL = worldToScreenOverhead(-0.5, 3.75 + d, w, h);
            const pR = worldToScreenOverhead(0.5, 3.75 + d, w, h);
            ctx.beginPath();
            ctx.moveTo(pL.x, pL.y);
            ctx.lineTo(pR.x, pR.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Overhead coins with laser caliper measurement lines
        if (currentRoom && currentRoom.current_round_coins) {
            currentRoom.current_round_coins.forEach(coin => {
                const cp = worldToScreenOverhead(coin.x, coin.y, w, h);
                const r = Math.max(12, 0.055 * boxW);

                // Caliper laser line to center line
                const lineTargetP = worldToScreenOverhead(coin.x, 3.75, w, h);

                ctx.strokeStyle = coin.is_on_line ? '#10b981' : coin.color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(cp.x, cp.y);
                ctx.lineTo(lineTargetP.x, lineTargetP.y);
                ctx.stroke();

                // Coin top view: Solid, vibrant player color
                ctx.fillStyle = coin.color;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.5;
                ctx.stroke();

                // Player avatar inside
                ctx.fillStyle = '#ffffff';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(coin.avatar || '🪙', cp.x, cp.y);

                // Measurement label
                ctx.font = 'bold 12px monospace';
                const labelY = cp.y + (coin.y > 3.75 ? 26 : -20);

                ctx.fillStyle = 'rgba(15, 10, 6, 0.85)';
                ctx.strokeStyle = coin.color;
                ctx.lineWidth = 1.5;
                const distText = `${coin.player_name}: ${coin.display_distance}`;
                const textW = ctx.measureText(distText).width + 12;
                roundRect(ctx, cp.x - textW / 2, labelY - 8, textW, 16, 4);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = coin.color;
                ctx.fillText(distText, cp.x, labelY);
            });
        }

        ctx.restore();
    }

    // --- Particle Effects ---
    function spawnClayParticles(wx, wy, color) {
        for (let i = 0; i < 22; i++) {
            clayParticles.push({
                wx,
                wy,
                wz: 0.02,
                vx: (Math.random() - 0.5) * 0.45,
                vy: (Math.random() - 0.5) * 0.45,
                vz: Math.random() * 0.45 + 0.15,
                color,
                life: 1.0,
                decay: Math.random() * 0.04 + 0.02
            });
        }
    }

    function renderParticles() {
        if (!canvas || !ctx) return;
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);

        for (let i = clayParticles.length - 1; i >= 0; i--) {
            const p = clayParticles[i];
            p.wx += p.vx * 0.05;
            p.wy += p.vy * 0.05;
            p.wz += p.vz * 0.05;
            p.vz -= 0.035; // gravity
            p.life -= p.decay;

            if (p.life <= 0 || p.wz < 0) {
                clayParticles.splice(i, 1);
                continue;
            }

            const pt = worldToScreen25D(p.wx, p.wy, p.wz, w, h);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3.5 * pt.scale, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }

    // --- Cantina Banter & Speech Bubbles ---
    function showBanterBubble(name, avatar, text, emoji) {
        elBanterBubble.innerHTML = `<span>${avatar} <strong>${escapeHtml(name)}:</strong> ${escapeHtml(text)}</span>`;
        elBanterBubble.classList.add('visible');
        setTimeout(() => {
            elBanterBubble.classList.remove('visible');
        }, 3200);
    }

    // --- QR Modal ---
    function openQrModal() {
        if (!currentRoom) return;
        const joinUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom.room_code}`;
        elShareUrlText.value = joinUrl;

        elQrContainer.innerHTML = '';
        if (window.QRCode) {
            new window.QRCode(elQrContainer, {
                text: joinUrl,
                width: 180,
                height: 180,
                colorDark: "#100703",
                colorLight: "#fef3c7",
                correctLevel: window.QRCode.CorrectLevel.M
            });
        }
        elModalQr.classList.add('active');
    }

    // --- Shareable Victory Trophy Canvas ---
    function downloadVictoryTrophy() {
        if (!currentRoom) return;
        const sorted = [...currentRoom.players].sort((a, b) => b.score - a.score);
        const winner = sorted[0];

        const tCanvas = document.createElement('canvas');
        tCanvas.width = 800;
        tCanvas.height = 1000;
        const tCtx = tCanvas.getContext('2d');

        // Dark Wood & Gold Background
        const grad = tCtx.createLinearGradient(0, 0, 0, 1000);
        grad.addColorStop(0, '#1c0e06');
        grad.addColorStop(0.5, '#2b160b');
        grad.addColorStop(1, '#150903');
        tCtx.fillStyle = grad;
        tCtx.fillRect(0, 0, 800, 1000);

        // Gold border
        tCtx.strokeStyle = winner.color || '#f59e0b';
        tCtx.lineWidth = 12;
        tCtx.strokeRect(20, 20, 760, 960);

        tCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        tCtx.lineWidth = 2;
        tCtx.strokeRect(32, 32, 736, 936);

        // Header Title
        tCtx.fillStyle = '#f59e0b';
        tCtx.font = 'bold 36px Georgia, serif';
        tCtx.textAlign = 'center';
        tCtx.fillText('🪙 RAYUELA MEXICANA 🪙', 400, 100);

        tCtx.fillStyle = '#fef08a';
        tCtx.font = '20px sans-serif';
        tCtx.fillText('CERTIFICADO OFICIAL DE VICTORIA DE CANTINA', 400, 140);

        // Winner Avatar & Crown
        tCtx.font = '80px sans-serif';
        tCtx.fillText('🏆', 400, 250);
        tCtx.fillText(winner.avatar, 400, 350);

        tCtx.fillStyle = winner.color || '#ffffff';
        tCtx.font = 'bold 44px sans-serif';
        tCtx.fillText(winner.name, 400, 420);

        tCtx.fillStyle = '#fbbf24';
        tCtx.font = '28px sans-serif';
        tCtx.fillText(`¡Gran Campeón con ${winner.score} Puntos!`, 400, 470);

        // Telemetry stats
        tCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        tCtx.fillRect(100, 520, 600, 260);
        tCtx.strokeStyle = '#78350f';
        tCtx.lineWidth = 3;
        tCtx.strokeRect(100, 520, 600, 260);

        tCtx.fillStyle = '#e2e8f0';
        tCtx.font = '22px sans-serif';
        tCtx.textAlign = 'left';
        tCtx.fillText(`🎯 Rayadas en la Mera Raya: ${winner.rayadas}`, 140, 580);
        tCtx.fillText(`⭐ Clavadas en el Barro: ${winner.clavadas}`, 140, 630);
        tCtx.fillText(`💥 Knockouts & Carambolas: ${winner.knockouts}`, 140, 680);
        tCtx.fillText(`📏 Mejor Tiro: ${formatDistDisplay(winner.best_distance_mm)}`, 140, 730);

        // Footer
        tCtx.textAlign = 'center';
        tCtx.fillStyle = '#a8a29e';
        tCtx.font = '16px sans-serif';
        tCtx.fillText(`Sala: ${currentRoom.room_code} | Meta: ${currentRoom.settings.target_points} Puntos | ${new Date().toLocaleDateString()}`, 400, 840);
        tCtx.fillText('El que pierde paga la ronda 🍺 ¡Salud!', 400, 880);

        // Download trigger
        const link = document.createElement('a');
        link.download = `Trofeo_Rayuela_${winner.name}.png`;
        link.href = tCanvas.toDataURL('image/png');
        link.click();
    }

    // --- Helpers ---
    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        elToastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function formatDistDisplay(mm) {
        if (!mm || mm > 5000) return 'Fuera';
        if (mm === 0) return '0.0 mm (Raya)';
        return mm < 100 ? `${mm.toFixed(1)} mm` : `${(mm / 10).toFixed(1)} cm`;
    }

    function getCoinSkinName(skin) {
        const map = {
            centenario: 'Centenario de Oro',
            diez_pesos: 'Diez Pesos Sol',
            plata_zapata: 'Plata Zapata',
            bronce_cantina: 'Ficha de Bronce'
        };
        return map[skin] || 'Centenario';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function darkenColor(hex, factor) {
        if (!hex || !hex.startsWith('#')) return hex;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        let r = Math.max(0, Math.floor(((num >> 16) & 255) * (1 - factor)));
        let g = Math.max(0, Math.floor(((num >> 8) & 255) * (1 - factor)));
        let b = Math.max(0, Math.floor((num & 255) * (1 - factor)));
        return `rgb(${r},${g},${b})`;
    }

    function lightenColor(hex, factor) {
        if (!hex || !hex.startsWith('#')) return hex;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        let r = Math.min(255, Math.floor(((num >> 16) & 255) + (255 - ((num >> 16) & 255)) * factor));
        let g = Math.min(255, Math.floor(((num >> 8) & 255) + (255 - ((num >> 8) & 255)) * factor));
        let b = Math.min(255, Math.floor((num & 255) + (255 - (num & 255)) * factor));
        return `rgb(${r},${g},${b})`;
    }

    function roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    Number.prototype.clamp = function (min, max) {
        return Math.min(Math.max(this, min), max);
    };

})();
