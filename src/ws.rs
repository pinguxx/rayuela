use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use crate::game::{
    random_cantina_dicho, GamePhase, GameRoom, GameSettings, Player, BOT_PROFILES, PLAYER_AVATARS,
    PLAYER_COLORS,
};
use crate::physics::{ThrowSimulationResult, TARGET_LINE_Y};

#[derive(Clone)]
pub struct AppState {
    pub rooms: Arc<RwLock<HashMap<String, GameRoom>>>,
    pub sockets: Arc<RwLock<HashMap<String, Vec<mpsc::UnboundedSender<Message>>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(RwLock::new(HashMap::new())),
            sockets: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ClientAction {
    CreateRoom {
        name: String,
        avatar: Option<String>,
        color: Option<String>,
        coin_skin: Option<String>,
        settings: Option<GameSettings>,
    },
    JoinRoom {
        room_code: String,
        name: String,
        avatar: Option<String>,
        color: Option<String>,
        coin_skin: Option<String>,
        reconnect_token: Option<String>,
    },
    AddBot {
        bot_profile_name: Option<String>,
    },
    RemoveBot {
        bot_id: String,
    },
    UpdateSettings {
        settings: GameSettings,
    },
    StartGame,
    ThrowCoin {
        angle_deg: f32,
        power: f32,
        elevation_deg: f32,
        spin: f32,
    },
    NextRound,
    PlayAgain,
    SendReaction {
        text: String,
        emoji: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum ServerEvent {
    RoomJoined {
        room_code: String,
        player_id: String,
        reconnect_token: String,
        is_host: bool,
    },
    RoomState {
        room: GameRoom,
    },
    ThrowExecuted {
        player_id: String,
        player_name: String,
        avatar: String,
        color: String,
        coin_skin: String,
        sim: ThrowSimulationResult,
        dicho_es: String,
        dicho_en: String,
        room: GameRoom,
    },
    RoundFinished {
        room: GameRoom,
    },
    MatchFinished {
        room: GameRoom,
    },
    Banter {
        sender_name: String,
        avatar: String,
        text: String,
        emoji: String,
    },
    Error {
        message: String,
    },
}

pub async fn handle_ws_connection(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Spawn task to forward outgoing channel messages to the WebSocket client
    let forward_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut current_room_code: Option<String> = None;
    let mut current_player_id: Option<String> = None;

    while let Some(Ok(msg)) = ws_receiver.next().await {
        if let Message::Text(text) = msg {
            let action: Result<ClientAction, _> = serde_json::from_str(&text);
            match action {
                Ok(ClientAction::CreateRoom {
                    name,
                    avatar,
                    color,
                    coin_skin,
                    settings,
                }) => {
                    let (code, player_id, rec_token) = {
                        let mut rng = rand::rng();
                        let c: String = (0..5)
                            .map(|_| {
                                let chars = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                                chars[rng.random_range(0..chars.len())] as char
                            })
                            .collect();
                        let pid = format!("usr_{}", rng.random_range(100000..999999));
                        let tok = format!("tok_{}", rng.random_range(1000000..9999999));
                        (c, pid, tok)
                    };
                    let av = avatar.unwrap_or_else(|| PLAYER_AVATARS[0].to_string());
                    let cl = color.unwrap_or_else(|| PLAYER_COLORS[0].to_string());
                    let skin = coin_skin.unwrap_or_else(|| "centenario".to_string());

                    let host = Player {
                        id: player_id.clone(),
                        name: if name.trim().is_empty() {
                            "Jugador 1".to_string()
                        } else {
                            name
                        },
                        avatar: av,
                        color: cl,
                        coin_skin: skin,
                        is_bot: false,
                        bot_profile_id: None,
                        is_host: true,
                        is_connected: true,
                        reconnect_token: rec_token.clone(),
                        score: 0,
                        total_throws: 0,
                        rayadas: 0,
                        clavadas: 0,
                        knockouts: 0,
                        best_distance_mm: 999999.0,
                    };

                    let mut room = GameRoom::new(code.clone(), host);
                    if let Some(s) = settings {
                        room.settings = s;
                    }

                    current_room_code = Some(code.clone());
                    current_player_id = Some(player_id.clone());

                    // Register socket
                    {
                        let mut sockets = state.sockets.write().await;
                        sockets.entry(code.clone()).or_default().push(tx.clone());
                    }

                    // Save room
                    {
                        let mut rooms = state.rooms.write().await;
                        rooms.insert(code.clone(), room.clone());
                    }

                    // Send response
                    let _ = tx.send(Message::Text(
                        serde_json::to_string(&ServerEvent::RoomJoined {
                            room_code: code.clone(),
                            player_id: player_id.clone(),
                            reconnect_token: rec_token,
                            is_host: true,
                        })
                        .unwrap()
                        .into(),
                    ));

                    broadcast_room_state(&state, &code).await;
                }

                Ok(ClientAction::JoinRoom {
                    room_code,
                    name,
                    avatar,
                    color,
                    coin_skin,
                    reconnect_token,
                }) => {
                    let code = room_code.trim().to_uppercase();
                    let mut rooms = state.rooms.write().await;
                    if let Some(room) = rooms.get_mut(&code) {
                        let mut resolved_player_id = None;
                        let mut _is_reconnect = false;

                        // Check reconnect token
                        if let Some(ref tok) = reconnect_token {
                            if let Some(existing) =
                                room.players.iter_mut().find(|p| &p.reconnect_token == tok)
                            {
                                existing.is_connected = true;
                                resolved_player_id = Some(existing.id.clone());
                                _is_reconnect = true;
                            }
                        }

                        let player_id = if let Some(pid) = resolved_player_id {
                            pid
                        } else {
                            // Max 8 players
                            if room.players.len() >= 8 {
                                let _ = tx.send(Message::Text(
                                    serde_json::to_string(&ServerEvent::Error {
                                        message: "La sala está llena (máximo 8 jugadores)"
                                            .to_string(),
                                    })
                                    .unwrap()
                                    .into(),
                                ));
                                continue;
                            }

                            let (pid, rec_tok) = {
                                let mut rng = rand::rng();
                                (
                                    format!("usr_{}", rng.random_range(100000..999999)),
                                    format!("tok_{}", rng.random_range(1000000..9999999)),
                                )
                            };

                            let p_idx = room.players.len();
                            let av = avatar.unwrap_or_else(|| {
                                PLAYER_AVATARS[p_idx % PLAYER_AVATARS.len()].to_string()
                            });
                            let cl = color.unwrap_or_else(|| {
                                PLAYER_COLORS[p_idx % PLAYER_COLORS.len()].to_string()
                            });
                            let skin = coin_skin.unwrap_or_else(|| "centenario".to_string());

                            let new_player = Player {
                                id: pid.clone(),
                                name: if name.trim().is_empty() {
                                    format!("Jugador {}", p_idx + 1)
                                } else {
                                    name
                                },
                                avatar: av,
                                color: cl,
                                coin_skin: skin,
                                is_bot: false,
                                bot_profile_id: None,
                                is_host: false,
                                is_connected: true,
                                reconnect_token: rec_tok,
                                score: 0,
                                total_throws: 0,
                                rayadas: 0,
                                clavadas: 0,
                                knockouts: 0,
                                best_distance_mm: 999999.0,
                            };

                            room.players.push(new_player);
                            pid
                        };

                        let player_rec_tok = room
                            .players
                            .iter()
                            .find(|p| p.id == player_id)
                            .map(|p| p.reconnect_token.clone())
                            .unwrap_or_default();
                        let is_host = room.host_id == player_id;

                        current_room_code = Some(code.clone());
                        current_player_id = Some(player_id.clone());

                        // Register socket
                        {
                            let mut sockets = state.sockets.write().await;
                            sockets.entry(code.clone()).or_default().push(tx.clone());
                        }

                        let _ = tx.send(Message::Text(
                            serde_json::to_string(&ServerEvent::RoomJoined {
                                room_code: code.clone(),
                                player_id,
                                reconnect_token: player_rec_tok,
                                is_host,
                            })
                            .unwrap()
                            .into(),
                        ));

                        drop(rooms);
                        broadcast_room_state(&state, &code).await;
                    } else {
                        let _ = tx.send(Message::Text(
                            serde_json::to_string(&ServerEvent::Error {
                                message: format!("No se encontró la sala '{}'", code),
                            })
                            .unwrap()
                            .into(),
                        ));
                    }
                }

                Ok(ClientAction::AddBot { bot_profile_name }) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            if room.host_id == *pid
                                && room.phase == GamePhase::Lobby
                                && room.players.len() < 8
                            {
                                let existing_names: Vec<&str> =
                                    room.players.iter().map(|p| p.name.as_str()).collect();
                                let available_profiles: Vec<&(&str, &str, f32, &str)> =
                                    BOT_PROFILES
                                        .iter()
                                        .filter(|(name, _, _, _)| {
                                            !existing_names.iter().any(|en| en.contains(name))
                                        })
                                        .collect();

                                let chosen_profile = if let Some(ref bp) = bot_profile_name {
                                    BOT_PROFILES
                                        .iter()
                                        .find(|(name, _, _, _)| name == bp)
                                        .copied()
                                } else if !available_profiles.is_empty() {
                                    let mut rng = rand::rng();
                                    let idx = rng.random_range(0..available_profiles.len());
                                    Some(*available_profiles[idx])
                                } else {
                                    let mut rng = rand::rng();
                                    let idx = rng.random_range(0..BOT_PROFILES.len());
                                    Some(BOT_PROFILES[idx])
                                };

                                let (b_name, b_avatar, _b_var, b_color) =
                                    chosen_profile.unwrap_or(BOT_PROFILES[0]);

                                let used_colors: Vec<String> =
                                    room.players.iter().map(|p| p.color.clone()).collect();
                                let bot_color = if !used_colors
                                    .iter()
                                    .any(|c| c.eq_ignore_ascii_case(b_color))
                                {
                                    b_color.to_string()
                                } else {
                                    PLAYER_COLORS
                                        .iter()
                                        .find(|c| {
                                            !used_colors.iter().any(|u| u.eq_ignore_ascii_case(c))
                                        })
                                        .copied()
                                        .unwrap_or(b_color)
                                        .to_string()
                                };

                                let bot_skin = match room.players.len() % 4 {
                                    0 => "centenario",
                                    1 => "diez_pesos",
                                    2 => "plata_zapata",
                                    _ => "bronce_cantina",
                                };

                                let bot_id = {
                                    let mut rng = rand::rng();
                                    format!("bot_{}", rng.random_range(1000..9999))
                                };
                                let bot = Player {
                                    id: bot_id.clone(),
                                    name: format!("{} 🤖", b_name),
                                    avatar: b_avatar.to_string(),
                                    color: bot_color,
                                    coin_skin: bot_skin.to_string(),
                                    is_bot: true,
                                    bot_profile_id: Some(b_name.to_string()),
                                    is_host: false,
                                    is_connected: true,
                                    reconnect_token: "".to_string(),
                                    score: 0,
                                    total_throws: 0,
                                    rayadas: 0,
                                    clavadas: 0,
                                    knockouts: 0,
                                    best_distance_mm: 999999.0,
                                };

                                room.players.push(bot);
                                drop(rooms);
                                broadcast_room_state(&state, code).await;
                            }
                        }
                    }
                }

                Ok(ClientAction::RemoveBot { bot_id }) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            if room.host_id == *pid && room.phase == GamePhase::Lobby {
                                room.players.retain(|p| p.id != bot_id);
                                drop(rooms);
                                broadcast_room_state(&state, code).await;
                            }
                        }
                    }
                }

                Ok(ClientAction::UpdateSettings { settings }) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            if room.host_id == *pid && room.phase == GamePhase::Lobby {
                                room.settings = settings;
                                drop(rooms);
                                broadcast_room_state(&state, code).await;
                            }
                        }
                    }
                }

                Ok(ClientAction::StartGame) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            if room.host_id == *pid && room.phase == GamePhase::Lobby {
                                if let Err(err) = room.start_game() {
                                    let _ = tx.send(Message::Text(
                                        serde_json::to_string(&ServerEvent::Error {
                                            message: err.to_string(),
                                        })
                                        .unwrap()
                                        .into(),
                                    ));
                                } else {
                                    drop(rooms);
                                    broadcast_room_state(&state, code).await;
                                }
                            }
                        }
                    }
                }

                Ok(ClientAction::ThrowCoin {
                    angle_deg,
                    power,
                    elevation_deg,
                    spin,
                }) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            let player = room.players.iter().find(|p| &p.id == pid).cloned();
                            match room.execute_player_throw(
                                pid,
                                angle_deg,
                                power,
                                elevation_deg,
                                spin,
                            ) {
                                Ok(sim) => {
                                    let (d_es, d_en) = random_cantina_dicho(
                                        sim.coin.is_on_line,
                                        sim.was_clavada,
                                        sim.coin.status == crate::physics::CoinStatus::OffBox,
                                    );

                                    let ev = ServerEvent::ThrowExecuted {
                                        player_id: pid.clone(),
                                        player_name: player
                                            .as_ref()
                                            .map(|p| p.name.clone())
                                            .unwrap_or_default(),
                                        avatar: player
                                            .as_ref()
                                            .map(|p| p.avatar.clone())
                                            .unwrap_or_default(),
                                        color: player
                                            .as_ref()
                                            .map(|p| p.color.clone())
                                            .unwrap_or_default(),
                                        coin_skin: player
                                            .as_ref()
                                            .map(|p| p.coin_skin.clone())
                                            .unwrap_or_default(),
                                        sim,
                                        dicho_es: d_es.to_string(),
                                        dicho_en: d_en.to_string(),
                                        room: room.clone(),
                                    };

                                    let room_clone = room.clone();
                                    drop(rooms);

                                    broadcast_event(&state, code, &ev).await;

                                    // Pacing delay: let all players see the 3D trajectory, bounces, and carambolas settle
                                    tokio::time::sleep(Duration::from_millis(2200)).await;

                                    if room_clone.phase == GamePhase::RoundReview {
                                        broadcast_event(
                                            &state,
                                            code,
                                            &ServerEvent::RoundFinished { room: room_clone },
                                        )
                                        .await;
                                    } else if room_clone.phase == GamePhase::MatchFinished {
                                        broadcast_event(
                                            &state,
                                            code,
                                            &ServerEvent::MatchFinished { room: room_clone },
                                        )
                                        .await;
                                    } else {
                                        broadcast_room_state(&state, code).await;
                                    }
                                }
                                Err(err) => {
                                    let _ = tx.send(Message::Text(
                                        serde_json::to_string(&ServerEvent::Error {
                                            message: err.to_string(),
                                        })
                                        .unwrap()
                                        .into(),
                                    ));
                                }
                            }
                        }
                    }
                }

                Ok(ClientAction::NextRound) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            if (room.host_id == *pid
                                || room.players.iter().all(|p| p.is_bot || p.id == *pid))
                                && room.phase == GamePhase::RoundReview
                            {
                                room.round_number += 1;
                                room.start_new_round();
                                if room
                                    .current_active_player()
                                    .map(|p| p.is_bot)
                                    .unwrap_or(false)
                                {
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64;
                                    room.min_next_throw_unix_ms = now + 900;
                                }
                                drop(rooms);
                                broadcast_room_state(&state, code).await;
                            }
                        }
                    }
                }

                Ok(ClientAction::PlayAgain) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(code) {
                            if room.host_id == *pid && room.phase == GamePhase::MatchFinished {
                                let _ = room.start_game();
                                drop(rooms);
                                broadcast_room_state(&state, code).await;
                            }
                        }
                    }
                }

                Ok(ClientAction::SendReaction { text, emoji }) => {
                    if let (Some(ref code), Some(ref pid)) =
                        (&current_room_code, &current_player_id)
                    {
                        let rooms = state.rooms.read().await;
                        if let Some(room) = rooms.get(code) {
                            if let Some(p) = room.players.iter().find(|p| &p.id == pid) {
                                let ev = ServerEvent::Banter {
                                    sender_name: p.name.clone(),
                                    avatar: p.avatar.clone(),
                                    text,
                                    emoji,
                                };
                                drop(rooms);
                                broadcast_event(&state, code, &ev).await;
                            }
                        }
                    }
                }

                Err(err) => {
                    let _ = tx.send(Message::Text(
                        serde_json::to_string(&ServerEvent::Error {
                            message: format!("Acción inválida: {}", err),
                        })
                        .unwrap()
                        .into(),
                    ));
                }
            }
        }
    }

    // Cleanup disconnected socket
    if let Some(code) = current_room_code {
        let mut sockets = state.sockets.write().await;
        if let Some(room_socks) = sockets.get_mut(&code) {
            room_socks.retain(|s| !s.is_closed());
        }
    }

    forward_task.abort();
}

pub async fn broadcast_event(state: &AppState, room_code: &str, event: &ServerEvent) {
    let msg_str = match serde_json::to_string(event) {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut sockets = state.sockets.write().await;
    if let Some(room_socks) = sockets.get_mut(room_code) {
        room_socks.retain(|s| s.send(Message::Text(msg_str.clone().into())).is_ok());
    }
}

pub async fn broadcast_room_state(state: &AppState, room_code: &str) {
    let rooms = state.rooms.read().await;
    if let Some(room) = rooms.get(room_code) {
        let ev = ServerEvent::RoomState { room: room.clone() };
        drop(rooms);
        broadcast_event(state, room_code, &ev).await;
    }
}

/// Periodic background loop that executes bot turns and handles AFK turn timeouts.
pub fn start_background_maintenance(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            let mut room_codes: Vec<String> = Vec::new();
            {
                let rooms = state.rooms.read().await;
                for (code, room) in rooms.iter() {
                    if room.phase == GamePhase::Throwing {
                        room_codes.push(code.clone());
                    }
                }
            }

            for code in room_codes {
                let mut bot_throw_to_broadcast = None;
                let mut round_ended = false;
                let mut match_ended = false;
                let mut room_after = None;

                {
                    let mut rooms = state.rooms.write().await;
                    if let Some(room) = rooms.get_mut(&code) {
                        if room.phase != GamePhase::Throwing {
                            continue;
                        }

                        let is_bot = room
                            .current_active_player()
                            .map(|p| p.is_bot)
                            .unwrap_or(false);
                        let is_timed_out = room
                            .turn_deadline_unix_ms
                            .map(|deadline| now > deadline)
                            .unwrap_or(false);

                        // Only pitch if the previous throw has completely landed and settled!
                        if (is_bot || is_timed_out) && now >= room.min_next_throw_unix_ms {
                            // If human timed out, bot_decide_and_throw handles it by taking over a fallback pitch
                            let active_player = room.current_active_player().cloned();
                            if let Some(player) = active_player {
                                let (angle, power, elevation, spin) = if player.is_bot {
                                    let variance = player
                                        .bot_profile_id
                                        .as_ref()
                                        .and_then(|id| {
                                            BOT_PROFILES
                                                .iter()
                                                .find(|(name, _, _, _)| name == id)
                                                .map(|(_, _, v, _)| *v)
                                        })
                                        .unwrap_or(0.03);
                                    let c_theme = if !room.settings.court_theme.is_empty() {
                                        &room.settings.court_theme
                                    } else {
                                        &room.settings.cantina_theme
                                    };
                                    crate::physics::calculate_bot_throw(
                                        0.0,
                                        TARGET_LINE_Y,
                                        variance,
                                        c_theme,
                                    )
                                } else {
                                    // AFK Auto-toss: safe throw towards the center line
                                    (0.0, 0.53, 32.0, 0.0)
                                };

                                if let Ok(sim) = room
                                    .execute_player_throw(&player.id, angle, power, elevation, spin)
                                {
                                    let (d_es, d_en) = random_cantina_dicho(
                                        sim.coin.is_on_line,
                                        sim.was_clavada,
                                        sim.coin.status == crate::physics::CoinStatus::OffBox,
                                    );

                                    bot_throw_to_broadcast = Some(ServerEvent::ThrowExecuted {
                                        player_id: player.id.clone(),
                                        player_name: player.name.clone(),
                                        avatar: player.avatar.clone(),
                                        color: player.color.clone(),
                                        coin_skin: player.coin_skin.clone(),
                                        sim,
                                        dicho_es: d_es.to_string(),
                                        dicho_en: d_en.to_string(),
                                        room: room.clone(),
                                    });

                                    if room.phase == GamePhase::RoundReview {
                                        round_ended = true;
                                    } else if room.phase == GamePhase::MatchFinished {
                                        match_ended = true;
                                    }
                                    room_after = Some(room.clone());
                                }
                            }
                        }
                    }
                }

                if let Some(ev) = bot_throw_to_broadcast {
                    broadcast_event(&state, &code, &ev).await;
                    tokio::time::sleep(Duration::from_millis(2400)).await;
                    if let Some(r) = room_after {
                        if round_ended {
                            broadcast_event(&state, &code, &ServerEvent::RoundFinished { room: r })
                                .await;
                        } else if match_ended {
                            broadcast_event(&state, &code, &ServerEvent::MatchFinished { room: r })
                                .await;
                        } else {
                            broadcast_room_state(&state, &code).await;
                        }
                    }
                }
            }
        }
    });
}
