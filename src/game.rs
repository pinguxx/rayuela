use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::physics::{
    calculate_bot_throw, simulate_throw, SettledCoin, ThrowSimulationResult, TARGET_LINE_Y,
};

pub const PLAYER_COLORS: [&str; 10] = [
    "#f59e0b", // Oro Centenario
    "#0284c7", // Azul Talavera
    "#ec4899", // Rosa Mexicano
    "#10b981", // Verde Jade
    "#f97316", // Naranja Cempasúchil
    "#8b5cf6", // Púrpura Imperial
    "#ef4444", // Rojo Sangrita
    "#14b8a6", // Turquesa
    "#eab308", // Amarillo Maíz
    "#18181b", // Obsidiana
];

pub const PLAYER_AVATARS: [&str; 10] = [
    "🤠", // El Charro
    "🧔", // Don Ramón
    "👵", // Doña Chelo
    "🧑", // El Cantinero
    "💀", // La Catrina
    "🎺", // El Mariachi
    "🥊", // El Santo
    "🎨", // Frida
    "🌮", // El Taquero
    "👑", // El Patrón
];

pub const BOT_PROFILES: [(&str, &str, f32, &str); 7] = [
    ("Don Ramón", "🧔", 0.018, "#f59e0b"),
    ("Doña Chelo", "👵", 0.020, "#ec4899"),
    ("El Maestro", "🧑", 0.028, "#0284c7"),
    ("El Charro", "🤠", 0.030, "#f97316"),
    ("La Catrina", "💀", 0.035, "#8b5cf6"),
    ("El Taquero", "🌮", 0.040, "#10b981"),
    ("El Novato", "🧒", 0.075, "#ef4444"),
];

pub const COIN_SKINS: [(&str, &str, &str); 4] = [
    (
        "centenario",
        "Centenario de Oro",
        "50 Pesos Oro / Ángel de la Independencia",
    ),
    (
        "diez_pesos",
        "Diez Pesos Sol",
        "Piedra del Sol / Bimetálica",
    ),
    (
        "plata_zapata",
        "Plata Zapata",
        "Plata Ley 0.720 Revolucionaria",
    ),
    ("bronce_cantina", "Ficha de Feria", "Bronce Tradicional"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSettings {
    #[serde(default = "default_target_points")]
    pub target_points: u32, // 11, 15, 21
    #[serde(default = "default_throws_per_player")]
    pub throws_per_player: u8, // 1 or 2
    #[serde(default = "default_turn_timer")]
    pub turn_timer_seconds: u64, // 0 = unlimited, 15, 20, 30
    #[serde(default = "default_court_theme")]
    pub court_theme: String, // "cajon_barro", "piso_pared", "patio_hacienda"
    #[serde(default = "default_cantina_theme")]
    pub cantina_theme: String,
    #[serde(default = "default_knockouts")]
    pub knockouts_allowed: bool,
}

fn default_target_points() -> u32 {
    15
}
fn default_throws_per_player() -> u8 {
    2
}
fn default_turn_timer() -> u64 {
    20
}
fn default_court_theme() -> String {
    "cajon_barro".to_string()
}
fn default_cantina_theme() -> String {
    "cajon_barro".to_string()
}
fn default_knockouts() -> bool {
    true
}

impl Default for GameSettings {
    fn default() -> Self {
        Self {
            target_points: default_target_points(),
            throws_per_player: default_throws_per_player(),
            turn_timer_seconds: default_turn_timer(),
            court_theme: default_court_theme(),
            cantina_theme: default_cantina_theme(),
            knockouts_allowed: default_knockouts(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamePhase {
    Lobby,
    Throwing,
    RoundReview, // Foto-Finish and point tallying
    MatchFinished,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub color: String,
    pub coin_skin: String,
    pub is_bot: bool,
    pub bot_profile_id: Option<String>,
    pub is_host: bool,
    pub is_connected: bool,
    pub reconnect_token: String,
    pub score: u32,
    pub total_throws: u32,
    pub rayadas: u32,
    pub clavadas: u32,
    pub knockouts: u32,
    pub best_distance_mm: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundPointAward {
    pub player_id: String,
    pub player_name: String,
    pub avatar: String,
    pub points: u32,
    pub reason: String,
    pub coin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundVerdict {
    pub round_number: u32,
    pub awards: Vec<RoundPointAward>,
    pub summary_es: String,
    pub summary_en: String,
    pub closest_coin_id: Option<String>,
    pub closest_player_name: Option<String>,
    pub best_distance_display: String,
    pub match_winner_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameRoom {
    pub room_code: String,
    pub host_id: String,
    pub settings: GameSettings,
    pub phase: GamePhase,
    pub players: Vec<Player>,
    pub round_number: u32,
    pub turn_order: Vec<String>, // Player IDs in order of throw
    pub turn_index: usize,       // Index into turn_order
    pub throw_number_for_player: HashMap<String, u8>,
    pub current_round_coins: Vec<SettledCoin>,
    pub last_throw_result: Option<ThrowSimulationResult>,
    pub last_verdict: Option<RoundVerdict>,
    pub winner_id: Option<String>,
    pub turn_deadline_unix_ms: Option<u64>,
    pub last_throw_timestamp_unix_ms: u64,
    pub min_next_throw_unix_ms: u64,
}

impl GameRoom {
    pub fn new(room_code: String, host_player: Player) -> Self {
        let host_id = host_player.id.clone();
        Self {
            room_code,
            host_id,
            settings: GameSettings::default(),
            phase: GamePhase::Lobby,
            players: vec![host_player],
            round_number: 0,
            turn_order: Vec::new(),
            turn_index: 0,
            throw_number_for_player: HashMap::new(),
            current_round_coins: Vec::new(),
            last_throw_result: None,
            last_verdict: None,
            winner_id: None,
            turn_deadline_unix_ms: None,
            last_throw_timestamp_unix_ms: 0,
            min_next_throw_unix_ms: 0,
        }
    }

    pub fn start_game(&mut self) -> Result<(), &'static str> {
        if self.players.is_empty() {
            return Err("Se necesitan jugadores para iniciar");
        }
        self.phase = GamePhase::Throwing;
        self.round_number = 1;
        self.winner_id = None;
        for p in self.players.iter_mut() {
            p.score = 0;
            p.total_throws = 0;
            p.rayadas = 0;
            p.clavadas = 0;
            p.knockouts = 0;
            p.best_distance_mm = 999999.0;
        }
        self.start_new_round();
        Ok(())
    }

    pub fn start_new_round(&mut self) {
        self.current_round_coins.clear();
        self.last_throw_result = None;
        self.last_verdict = None;
        self.phase = GamePhase::Throwing;

        // Build turn order alternating between players for the configured throws per player
        // e.g. If 2 players [A, B] and 2 throws each: [A, B, A, B]
        self.turn_order.clear();
        self.throw_number_for_player.clear();
        for p in &self.players {
            self.throw_number_for_player.insert(p.id.clone(), 0);
        }

        let throws_per_p = self.settings.throws_per_player.max(1) as usize;
        let num_players = self.players.len();
        let start_offset = if num_players > 0 {
            (self.round_number.saturating_sub(1) as usize) % num_players
        } else {
            0
        };
        for _ in 0..throws_per_p {
            for i in 0..num_players {
                let idx = (start_offset + i) % num_players;
                self.turn_order.push(self.players[idx].id.clone());
            }
        }

        self.turn_index = 0;
        self.reset_turn_timer();
    }

    pub fn current_active_player(&self) -> Option<&Player> {
        if self.phase != GamePhase::Throwing || self.turn_index >= self.turn_order.len() {
            return None;
        }
        let current_id = &self.turn_order[self.turn_index];
        self.players.iter().find(|p| &p.id == current_id)
    }

    pub fn reset_turn_timer(&mut self) {
        if self.settings.turn_timer_seconds > 0 && self.phase == GamePhase::Throwing {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            self.turn_deadline_unix_ms =
                Some(now + 3000 + (self.settings.turn_timer_seconds * 1000));
        } else {
            self.turn_deadline_unix_ms = None;
        }
    }

    pub fn execute_player_throw(
        &mut self,
        player_id: &str,
        angle_deg: f32,
        power: f32,
        elevation_deg: f32,
        spin: f32,
    ) -> Result<ThrowSimulationResult, &'static str> {
        if self.phase != GamePhase::Throwing {
            return Err("No es fase de tiro");
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        if now < self.min_next_throw_unix_ms {
            return Err("Espera a que termine el tiro en curso");
        }

        let active = match self.current_active_player() {
            Some(p) => p,
            None => return Err("No hay turno activo"),
        };
        if active.id != player_id {
            return Err("No es tu turno de tirar");
        }

        let current_player = active.clone();
        let throw_count = self
            .throw_number_for_player
            .entry(player_id.to_string())
            .or_insert(0);
        *throw_count += 1;
        let this_throw_num = *throw_count;

        let coin_id = format!(
            "coin_{}_{}_{}",
            self.round_number, player_id, this_throw_num
        );

        let court_theme = if !self.settings.court_theme.is_empty() {
            &self.settings.court_theme
        } else {
            &self.settings.cantina_theme
        };

        let sim_result = simulate_throw(
            &coin_id,
            &current_player.id,
            &current_player.name,
            &current_player.color,
            &current_player.avatar,
            &current_player.coin_skin,
            court_theme,
            this_throw_num,
            angle_deg,
            power,
            elevation_deg,
            spin,
            &mut self.current_round_coins,
        );

        // Update player stats
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.total_throws += 1;
            if sim_result.coin.is_on_line {
                p.rayadas += 1;
            }
            if sim_result.was_clavada {
                p.clavadas += 1;
            }
            p.knockouts += sim_result.knockouts.len() as u32;
            if sim_result.coin.dist_to_line_mm < p.best_distance_mm {
                p.best_distance_mm = sim_result.coin.dist_to_line_mm;
            }
        }

        self.current_round_coins.push(sim_result.coin.clone());
        self.last_throw_result = Some(sim_result.clone());
        self.last_throw_timestamp_unix_ms = now;
        self.min_next_throw_unix_ms = now + 3200; // 3.2s flight + landing cooldown before next turn

        // Advance turn
        self.turn_index += 1;
        if self.turn_index >= self.turn_order.len() {
            // Round finished! Tally points and formulate verdict
            self.resolve_round();
        } else {
            self.reset_turn_timer();
        }

        Ok(sim_result)
    }

    pub fn resolve_round(&mut self) {
        self.phase = GamePhase::RoundReview;
        self.turn_deadline_unix_ms = None;

        let mut awards = Vec::new();
        let mut had_rayada = false;

        // 1. Award points for any coin in the line (Rayada) or Clavada
        for coin in &self.current_round_coins {
            if coin.was_clavada() {
                awards.push(RoundPointAward {
                    player_id: coin.player_id.clone(),
                    player_name: coin.player_name.clone(),
                    avatar: coin.avatar.clone(),
                    points: 5,
                    reason: "⭐ ¡Clavada de antología! (+5 pts)".to_string(),
                    coin_id: coin.id.clone(),
                });
                had_rayada = true;
            } else if coin.is_on_line {
                awards.push(RoundPointAward {
                    player_id: coin.player_id.clone(),
                    player_name: coin.player_name.clone(),
                    avatar: coin.avatar.clone(),
                    points: 3,
                    reason: "🎯 ¡Rayó la línea limpia! (+3 pts)".to_string(),
                    coin_id: coin.id.clone(),
                });
                had_rayada = true;
            }
        }

        // 2. Award point to the single closest coin (Punto de Distancia)
        // If there were rayadas, the closest among remaining non-rayadas, or if none, the absolute closest.
        let mut candidates: Vec<&SettledCoin> = self
            .current_round_coins
            .iter()
            .filter(|c| c.status == crate::physics::CoinStatus::InBox)
            .collect();

        candidates.sort_by(|a, b| {
            a.dist_to_line_mm
                .partial_cmp(&b.dist_to_line_mm)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut best_dist_display = "Sin monedas en el cajón".to_string();
        let mut closest_coin_id = None;
        let mut closest_player_name = None;

        if let Some(closest) = candidates.first() {
            best_dist_display = closest.display_distance.clone();
            closest_coin_id = Some(closest.id.clone());
            closest_player_name = Some(closest.player_name.clone());

            // If no one rayó, the closest gets 1 point
            if !had_rayada {
                awards.push(RoundPointAward {
                    player_id: closest.player_id.clone(),
                    player_name: closest.player_name.clone(),
                    avatar: closest.avatar.clone(),
                    points: 1,
                    reason: format!("📏 Mejor tiro a {} (+1 pt)", closest.display_distance),
                    coin_id: closest.id.clone(),
                });
            }
        }

        // Apply scores to players
        for award in &awards {
            if let Some(p) = self.players.iter_mut().find(|p| p.id == award.player_id) {
                p.score += award.points;
            }
        }

        // Check if any player has met or exceeded target score
        let target = self.settings.target_points;
        let mut potential_winners: Vec<&Player> =
            self.players.iter().filter(|p| p.score >= target).collect();

        potential_winners.sort_by_key(|a| std::cmp::Reverse(a.score));

        let match_winner_id = if let Some(first) = potential_winners.first() {
            if potential_winners.len() == 1 || first.score > potential_winners[1].score {
                self.phase = GamePhase::MatchFinished;
                self.winner_id = Some(first.id.clone());
                Some(first.id.clone())
            } else {
                // Tie at or above target! Continues into sudden death round
                None
            }
        } else {
            None
        };

        // Formulate family-friendly round verdict
        let summary_es = if let Some(ref wid) = match_winner_id {
            let winner = self.players.iter().find(|p| &p.id == wid).unwrap();
            format!(
                "🏆 ¡{} se lleva la victoria con {} puntos! ¡Gran campeonato!",
                winner.name, winner.score
            )
        } else if had_rayada {
            "🎯 ¡Moneda en la línea! ¡Qué gran puntería!".to_string()
        } else if let Some(ref cname) = closest_player_name {
            format!(
                "📏 El punto de distancia es para {} ({})",
                cname, best_dist_display
            )
        } else {
            "💨 Ninguna moneda quedó dentro en esta ronda. ¡Sigue intentando!".to_string()
        };

        let summary_en = if let Some(ref wid) = match_winner_id {
            let winner = self.players.iter().find(|p| &p.id == wid).unwrap();
            format!(
                "🏆 {} wins the match with {} points! Congratulations!",
                winner.name, winner.score
            )
        } else if had_rayada {
            "🎯 Coins landed directly on the line! Precision wins!".to_string()
        } else if let Some(ref cname) = closest_player_name {
            format!(
                "📏 Distance point awarded to {} ({})",
                cname, best_dist_display
            )
        } else {
            "💨 All coins missed the box. Keep trying next round!".to_string()
        };

        self.last_verdict = Some(RoundVerdict {
            round_number: self.round_number,
            awards,
            summary_es,
            summary_en,
            closest_coin_id,
            closest_player_name,
            best_distance_display: best_dist_display,
            match_winner_id,
        });
    }

    pub fn bot_decide_and_throw(&mut self) -> Option<ThrowSimulationResult> {
        let active = match self.current_active_player() {
            Some(p) if p.is_bot => p.clone(),
            _ => return None,
        };

        // Find bot profile accuracy
        let variance = if let Some(ref bpid) = active.bot_profile_id {
            BOT_PROFILES
                .iter()
                .find(|(name, _, _, _)| name == bpid)
                .map(|(_, _, var, _)| *var)
                .unwrap_or(0.03)
        } else {
            0.03
        };

        // Aggressive bots (like El Charro) check if an opponent coin is near the line to target
        let target_x = if active.name.contains("Charro") {
            let opponent_coin = self
                .current_round_coins
                .iter()
                .find(|c| c.player_id != active.id && c.is_on_line);
            opponent_coin.map(|c| c.x).unwrap_or(0.0)
        } else {
            0.0
        };

        let target_y = TARGET_LINE_Y;
        let court_theme = if !self.settings.court_theme.is_empty() {
            &self.settings.court_theme
        } else {
            &self.settings.cantina_theme
        };
        let (angle, power, elevation, spin) =
            calculate_bot_throw(target_x, target_y, variance, court_theme);

        self.execute_player_throw(&active.id, angle, power, elevation, spin)
            .ok()
    }
}

impl SettledCoin {
    pub fn was_clavada(&self) -> bool {
        self.status == crate::physics::CoinStatus::Clavada
    }
}

pub fn random_cantina_dicho(
    is_rayada: bool,
    is_clavada: bool,
    is_miss: bool,
) -> (&'static str, &'static str) {
    let mut rng = rand::rng();
    if is_clavada {
        let options = [
            (
                "¡Tiro perfecto! ¡Quedó clavada en el barro!",
                "Perfect shot! Stuck right in the clay!",
            ),
            (
                "¡Qué puntería! ¡Clavada maestra de 5 puntos!",
                "Amazing aim! Master 5-point stick!",
            ),
        ];
        options[rng.random_range(0..options.len())]
    } else if is_rayada {
        let options = [
            (
                "¡Directo en la línea! ¡Tiro de campeón!",
                "Right on the line! Champion shot!",
            ),
            (
                "¡Puntería perfecta! ¡Tocó la raya!",
                "Perfect accuracy! Touching the line!",
            ),
            (
                "¡Excelente lanzamiento! ¡Justo en el centro!",
                "Excellent throw! Right in the center!",
            ),
        ];
        options[rng.random_range(0..options.len())]
    } else if is_miss {
        let options = [
            (
                "¡Uy, se pasó un poquito! ¡La próxima sale mejor!",
                "Oh, a bit too far! Next one will be better!",
            ),
            (
                "¡Casi entra! ¡Ajusta tu fuerza en el siguiente turno!",
                "Almost in! Adjust your power next turn!",
            ),
            (
                "¡Salió fuera de la cancha! ¡No te rindas!",
                "Out of bounds! Keep trying!",
            ),
        ];
        options[rng.random_range(0..options.len())]
    } else {
        let options = [
            (
                "¡Buen tiro! ¡Quedó muy cerca de la línea!",
                "Good shot! Very close to the line!",
            ),
            (
                "¡Gran lanzamiento! ¡Vamos a medir la distancia!",
                "Great throw! Let's measure the distance!",
            ),
            (
                "¡Bien jugado! ¡Esa moneda está en buena posición!",
                "Well played! That coin is in a great spot!",
            ),
        ];
        options[rng.random_range(0..options.len())]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_player(id: &str, name: &str) -> Player {
        Player {
            id: id.to_string(),
            name: name.to_string(),
            avatar: "🤠".to_string(),
            color: "#f59e0b".to_string(),
            coin_skin: "centenario".to_string(),
            is_bot: false,
            bot_profile_id: None,
            is_host: id == "p1",
            is_connected: true,
            reconnect_token: format!("tok_{}", id),
            score: 0,
            total_throws: 0,
            rayadas: 0,
            clavadas: 0,
            knockouts: 0,
            best_distance_mm: 999999.0,
        }
    }

    #[test]
    fn test_turn_order_rotates_each_round() {
        let mut room = GameRoom::new("TEST".to_string(), dummy_player("p1", "P1"));
        room.players.push(dummy_player("p2", "P2"));
        room.players.push(dummy_player("p3", "P3"));
        room.settings.throws_per_player = 2;

        room.start_game().unwrap();
        assert_eq!(room.round_number, 1);
        assert_eq!(room.turn_order, vec!["p1", "p2", "p3", "p1", "p2", "p3"]);

        room.round_number = 2;
        room.start_new_round();
        assert_eq!(room.turn_order, vec!["p2", "p3", "p1", "p2", "p3", "p1"]);

        room.round_number = 3;
        room.start_new_round();
        assert_eq!(room.turn_order, vec!["p3", "p1", "p2", "p3", "p1", "p2"]);

        room.round_number = 4;
        room.start_new_round();
        assert_eq!(room.turn_order, vec!["p1", "p2", "p3", "p1", "p2", "p3"]);
    }
}
