// ============================================================================
// 🪙 RAYUELA MEXICANA — CLIENT APP & 2.5D CANVAS ENGINE
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
    let clayParticles = [];
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
    let elPowerFill, elAngleValue, elPowerValue;
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
            sendWsAction({ action: 'next_round' });
        });

        elBtnPlayAgain.addEventListener('click', () => {
            elModalVictory.classList.remove('active');
            targetCameraMode = 'perspective';
            sendWsAction({ action: 'play_again' });
        });

        elBtnDownloadTrophy.addEventListener('click', downloadVictoryTrophy);

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
    }

    function savePreferences() {
        localStorage.setItem('rayuela_player_name', elPlayerName.value.trim());
        localStorage.setItem('rayuela_avatar', selectedAvatar);
        localStorage.setItem('rayuela_color', selectedColor);
        localStorage.setItem('rayuela_skin', selectedCoinSkin);
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
                updateRoomStateUI(ev.room);
                showFotoFinishModal(ev.room);
                break;

            case 'match_finished':
                currentRoom = ev.room;
                updateRoomStateUI(ev.room);
                showVictoryModal(ev.room);
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
            resizeCanvas();
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

        elWaitingPlayersList.innerHTML = '';
        room.players.forEach(p => {
            const card = document.createElement('div');
            card.className = `player-card-waiting ${p.id === myPlayerId ? 'is-self' : ''}`;
            card.innerHTML = `
                <div class="player-meta">
                    <div class="player-avatar-circle" style="border-color:${p.color}">
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

        elScoreboardTable.innerHTML = '';

        const activePlayerId = (room.turn_order && room.turn_index < room.turn_order.len) ? room.turn_order[room.turn_index] : null;

        // Sort by score descending
        const sorted = [...room.players].sort((a, b) => b.score - a.score);

        sorted.forEach(p => {
            const isTurn = room.phase === 'throwing' && p.id === (room.turn_order[room.turn_index] || '');
            const row = document.createElement('div');
            row.className = `score-row ${isTurn ? 'active-turn' : ''}`;
            row.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:20px;">${p.avatar}</span>
                    <div>
                        <div style="color:${p.color};font-weight:700;">${escapeHtml(p.name)}</div>
                        <div style="font-size:11px;color:#94a3b8;font-family:sans-serif;">Rayadas: ${p.rayadas} | Mejor: ${formatDistDisplay(p.best_distance_mm)}</div>
                    </div>
                </div>
                <div class="score-points">${p.score}</div>
            `;
            elScoreboardTable.appendChild(row);
        });
    }

    function updateTurnHeader(room) {
        if (room.phase !== 'throwing') {
            elActiveThrowerName.textContent = room.phase === 'round_review' ? 'Dictamen del Cantinero...' : 'Fin de Partida';
            elTurnTimer.style.display = 'none';
            clearInterval(timerInterval);
            return;
        }

        const activePlayer = room.players.find(p => p.id === room.turn_order[room.turn_index]);
        if (!activePlayer) return;

        const isMe = activePlayer.id === myPlayerId;
        elActiveThrowerName.textContent = isMe ? '¡ES TU TURNO DE TIRAR!' : `Tira ${activePlayer.name}`;
        elActiveThrowerName.style.color = isMe ? 'var(--gold-glow)' : activePlayer.color;

        // Turn timer
        if (room.turn_deadline_unix_ms) {
            elTurnTimer.style.display = 'flex';
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((room.turn_deadline_unix_ms - Date.now()) / 1000));
                elTurnTimer.textContent = `⏱️ ${remaining}s`;
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

    // --- Throw Handling & Animation ---
    function handleThrowAnimation(ev) {
        const { sim, dicho_es } = ev;

        audio.playCoinFlight();

        activeFlightAnimation = {
            trajectory: sim.trajectory,
            currentPointIdx: 0,
            coin: sim.coin,
            flightDurationMs: sim.flight_duration_s * 1000,
            startTime: performance.now(),
            onComplete: () => {
                // Play landing sound
                if (sim.sound_cue === 'rayada') {
                    audio.playRayada();
                } else if (sim.sound_cue === 'clavada') {
                    audio.playClavada();
                } else if (sim.sound_cue === 'knockout') {
                    audio.playCoinKnockout();
                } else if (sim.sound_cue === 'miss') {
                    audio.playMiss();
                } else {
                    audio.playClayThud();
                }

                // Clay splatter particles
                spawnClayParticles(sim.coin.x, sim.coin.y, sim.coin.color);

                // Speak and show cantina banter
                audio.speakDicho(dicho_es);
                showBanterBubble(ev.player_name, ev.avatar, dicho_es, sim.coin.is_on_line ? '🎯' : '🪙');

                activeFlightAnimation = null;
            }
        };
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
            <h3 style="color:var(--gold-glow);font-size:24px;font-family:var(--font-display);">${escapeHtml(winner.name)}</h3>
            <p style="color:#fcd34d;font-size:14px;">¡Campeón de la Cantina con ${winner.score} puntos!</p>
        `;

        elVictoryStats.innerHTML = `
            <div style="background:#100703;padding:12px;border-radius:8px;margin-top:12px;text-align:left;font-size:13px;line-height:1.6;">
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
        setupPointerEvents();
    }

    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
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
        const activeId = currentRoom.turn_order[currentRoom.turn_index];
        return activeId === myPlayerId;
    }

    function onPointerDown(e) {
        if (!isMyTurn() || activeFlightAnimation) return;
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
        aimingPower = (0.2 + (dist / 220.0)).clamp(0.15, 0.95);

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

        if (totalDist > 25) {
            // Execute pitch!
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
        // Perspective camera parameters
        // wy: 0.0 (throw line) to 4.8 (back of cajon)
        // wx: -1.2 to 1.2
        const horizonY = height * 0.22;
        const throwY = height * 0.88;
        const depthRange = 5.0;

        // Depth perspective scale: 1.0 at throw line, ~0.35 at back of box
        const depthFrac = (wy / depthRange).clamp(0.0, 1.0);
        const scale = 1.0 - (depthFrac * 0.65);

        const screenX = (width / 2) + (wx * (width * 0.42) * scale);
        const screenY = throwY - (depthFrac * (throwY - horizonY)) - (wz * 180 * scale);

        return { x: screenX, y: screenY, scale };
    }

    function worldToScreenOverhead(wx, wy, width, height) {
        // Orthographic camera centered over Cajón de Barro
        // Box bounds: X: -0.5 to 0.5 (1.0m), Y: 3.0 to 4.5 (1.5m)
        const boxCenterY = 3.75;
        const boxCenterX = 0.0;

        const zoom = Math.min(width / 1.4, height / 2.0);

        const screenX = (width / 2) + ((wx - boxCenterX) * zoom);
        const screenY = (height / 2) + ((wy - boxCenterY) * zoom);

        return { x: screenX, y: screenY, scale: zoom / 250 };
    }

    function startRenderLoop() {
        function render(now) {
            animationFrameId = requestAnimationFrame(render);
            if (!canvas || !ctx) return;

            const w = canvas.width / (window.devicePixelRatio || 1);
            const h = canvas.height / (window.devicePixelRatio || 1);

            ctx.clearRect(0, 0, w, h);

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
        }
        animationFrameId = requestAnimationFrame(render);
    }

    function renderPerspectiveCantina(w, h, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;

        // 1. Cantina Wood Floor planks
        const floorGrad = ctx.createLinearGradient(0, h * 0.22, 0, h);
        floorGrad.addColorStop(0, '#120904');
        floorGrad.addColorStop(0.5, '#221107');
        floorGrad.addColorStop(1, '#170b04');
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, 0, w, h);

        // Perspective plank lines
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

        // Throw line (Línea de tiro) at Y = 0
        const tl1 = worldToScreen25D(-0.8, 0.2, 0.0, w, h);
        const tl2 = worldToScreen25D(0.8, 0.2, 0.0, w, h);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tl1.x, tl1.y);
        ctx.lineTo(tl2.x, tl2.y);
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LÍNEA DE TIRO (RAYA INICIAL)', w / 2, tl1.y + 18);

        // 2. El Cajón de Barro (Damp Clay Box)
        // Outer box corners: X in [-0.52, 0.52], Y in [2.98, 4.52]
        const c1 = worldToScreen25D(-0.52, 2.98, 0.08, w, h);
        const c2 = worldToScreen25D(0.52, 2.98, 0.08, w, h);
        const c3 = worldToScreen25D(0.52, 4.52, 0.08, w, h);
        const c4 = worldToScreen25D(-0.52, 4.52, 0.08, w, h);

        // Wood rim outer shadow
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

        // Wood rail frame stroke
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

        // Subtle glow on the line
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 8;
        ctx.stroke();

        // 3. Render Settled Coins in the Clay
        if (currentRoom && currentRoom.current_round_coins) {
            currentRoom.current_round_coins.forEach(coin => {
                const p = worldToScreen25D(coin.x, coin.y, coin.z, w, h);
                drawPerspectiveCoin(ctx, p.x, p.y, p.scale, coin);
            });
        }

        // 4. Render Active In-Flight Coin
        if (activeFlightAnimation) {
            const anim = activeFlightAnimation;
            const elapsed = performance.now() - anim.startTime;
            const frac = Math.min(1.0, elapsed / anim.flightDurationMs);

            const traj = anim.trajectory;
            const pointIdx = Math.min(traj.length - 1, Math.floor(frac * (traj.length - 1)));
            const pt = traj[pointIdx];

            // Projected shadow on ground
            const shadowPt = worldToScreen25D(pt.x, pt.y, 0.0, w, h);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.beginPath();
            ctx.ellipse(shadowPt.x, shadowPt.y, 14 * shadowPt.scale, 7 * shadowPt.scale, 0, 0, Math.PI * 2);
            ctx.fill();

            // Coin in air
            const airPt = worldToScreen25D(pt.x, pt.y, pt.z, w, h);
            drawPerspectiveCoin(ctx, airPt.x, airPt.y, airPt.scale * 1.25, anim.coin, true);

            if (frac >= 1.0) {
                anim.onComplete();
            }
        }

        // 5. Aiming Sling / Trajectory Preview
        if (isDragging) {
            drawAimingTrajectory(ctx, w, h);
        }

        ctx.restore();
    }

    function drawPerspectiveCoin(ctx, x, y, scale, coin, inAir = false) {
        ctx.save();
        const r = 18 * scale;

        // Shadow under coin
        if (!inAir) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.beginPath();
            ctx.ellipse(x, y + 2, r, r * 0.48, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Gold / Bronze / Silver Gradient
        const coinGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        if (coin.coin_skin === 'diez_pesos') {
            coinGrad.addColorStop(0, '#fef08a');
            coinGrad.addColorStop(0.6, '#ca8a04');
            coinGrad.addColorStop(1, '#94a3b8');
        } else if (coin.coin_skin === 'plata_zapata') {
            coinGrad.addColorStop(0, '#f8fafc');
            coinGrad.addColorStop(0.7, '#94a3b8');
            coinGrad.addColorStop(1, '#475569');
        } else if (coin.coin_skin === 'bronce_cantina') {
            coinGrad.addColorStop(0, '#fdba74');
            coinGrad.addColorStop(0.7, '#c2410c');
            coinGrad.addColorStop(1, '#7c2d12');
        } else {
            // Centenario de Oro default
            coinGrad.addColorStop(0, '#fef08a');
            coinGrad.addColorStop(0.6, '#f59e0b');
            coinGrad.addColorStop(1, '#b45309');
        }

        ctx.fillStyle = coinGrad;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.52, 0, 0, Math.PI * 2);
        ctx.fill();

        // Player colored rim
        ctx.strokeStyle = coin.color;
        ctx.lineWidth = 2.5 * scale;
        ctx.stroke();

        // Inner rim engraving
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.75, r * 0.75 * 0.52, 0, 0, Math.PI * 2);
        ctx.stroke();

        // If touching line, golden star beacon
        if (coin.is_on_line) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = `${Math.max(10, Math.round(12 * scale))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('🎯', x, y - r * 0.6);
        }

        ctx.restore();
    }

    function drawAimingTrajectory(ctx, w, h) {
        ctx.save();
        const pStart = worldToScreen25D(0.0, 0.2, 0.0, w, h);

        // Approximate preview arc
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);

        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);

        const targetY = 3.0 + (aimingPower * 1.5);
        const targetX = (aimingAngleDeg / 25.0) * 0.45;

        for (let t = 0.1; t <= 1.0; t += 0.1) {
            const wy = 0.2 + (t * (targetY - 0.2));
            const wx = t * targetX;
            const wz = Math.sin(t * Math.PI) * 0.75;
            const pt = worldToScreen25D(wx, wy, wz, w, h);
            ctx.lineTo(pt.x, pt.y);
        }
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

        // Clay bed
        ctx.fillStyle = '#5c3008';
        ctx.fillRect(topLeft.x, topLeft.y, boxW, boxH);

        // Wooden frame
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 8;
        ctx.strokeRect(topLeft.x, topLeft.y, boxW, boxH);

        // Center line (La Raya)
        const lineLeft = worldToScreenOverhead(-0.5, 3.75, w, h);
        const lineRight = worldToScreenOverhead(0.5, 3.75, w, h);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
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
                const r = 16;

                // Caliper laser line to center line
                const lineTargetP = worldToScreenOverhead(coin.x, 3.75, w, h);

                ctx.strokeStyle = coin.is_on_line ? '#10b981' : '#f59e0b';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cp.x, cp.y);
                ctx.lineTo(lineTargetP.x, lineTargetP.y);
                ctx.stroke();

                // Coin top view
                ctx.fillStyle = coin.color;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Measurement label
                ctx.fillStyle = '#fef08a';
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(coin.display_distance, cp.x, cp.y + (coin.y > 3.75 ? 24 : -18));
            });
        }

        ctx.restore();
    }

    // --- Particle Effects ---
    function spawnClayParticles(wx, wy, color) {
        for (let i = 0; i < 16; i++) {
            clayParticles.push({
                wx,
                wy,
                wz: 0.02,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                vz: Math.random() * 0.35 + 0.1,
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
            p.vz -= 0.03; // gravity
            p.life -= p.decay;

            if (p.life <= 0 || p.wz < 0) {
                clayParticles.splice(i, 1);
                continue;
            }

            const pt = worldToScreen25D(p.wx, p.wy, p.wz, w, h);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3 * pt.scale, 0, Math.PI * 2);
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
        tCtx.strokeStyle = '#f59e0b';
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

        tCtx.fillStyle = '#ffffff';
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

    Number.prototype.clamp = function (min, max) {
        return Math.min(Math.max(this, min), max);
    };

})();
