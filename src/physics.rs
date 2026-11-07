use rand::RngExt;
use serde::{Deserialize, Serialize};

/// Dimensions and physics constants for the Mexican Rayuela court & Cajón de Barro.
/// Units are in meters and seconds.
pub const BOX_MIN_X: f32 = -0.50; // 100 cm wide (-50cm to +50cm)
pub const BOX_MAX_X: f32 = 0.50;
pub const BOX_MIN_Y: f32 = 3.00; // Cajon starts 3.0 meters from throw line
pub const BOX_MAX_Y: f32 = 4.50; // Cajon ends 4.5 meters from throw line (1.5m long)
pub const TARGET_LINE_Y: f32 = 3.75; // Center line (La Raya) carved into damp clay
pub const COIN_RADIUS: f32 = 0.038; // ~3.8cm radius (~7.6cm diameter for heavy cantina coin)
pub const GRAVITY: f32 = 9.81;
pub const RELEASE_HEIGHT_Z: f32 = 1.15; // Release height at player chest/waist

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoinStatus {
    InFlight,
    InBox,    // Succeeded landing in the clay box
    OffBox,   // Out of bounds / missed cajón
    Clavada,  // Rare landing stuck edge-down vertically in clay!
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrajectoryPoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub t: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettledCoin {
    pub id: String,
    pub player_id: String,
    pub player_name: String,
    pub color: String,
    pub avatar: String,
    pub coin_skin: String,
    pub throw_number: u8,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub status: CoinStatus,
    pub is_on_line: bool,
    pub dist_to_line_m: f32,
    pub dist_to_line_mm: f32,
    pub display_distance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockoutEvent {
    pub victim_coin_id: String,
    pub victim_player_name: String,
    pub old_x: f32,
    pub old_y: f32,
    pub new_x: f32,
    pub new_y: f32,
    pub was_on_line: bool,
    pub is_now_on_line: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThrowSimulationResult {
    pub coin: SettledCoin,
    pub trajectory: Vec<TrajectoryPoint>,
    pub flight_duration_s: f32,
    pub knockouts: Vec<KnockoutEvent>,
    pub was_clavada: bool,
    pub sound_cue: String, // "rayada", "clavada", "thud_clay", "knockout", "miss"
}

/// Simulates a throw with user inputs:
/// - `angle_deg`: lateral horizontal angle in degrees (-25.0 to +25.0, 0 = straight towards target)
/// - `power`: 0.0 to 1.0 (normalized velocity: 5.2 m/s to 8.6 m/s)
/// - `elevation_deg`: vertical launch angle in degrees (22.0 to 48.0)
/// - `spin`: -1.0 to 1.0 (affects lateral skid and drift on landing)
pub fn simulate_throw(
    coin_id: &str,
    player_id: &str,
    player_name: &str,
    color: &str,
    avatar: &str,
    coin_skin: &str,
    throw_number: u8,
    angle_deg: f32,
    power: f32,
    elevation_deg: f32,
    spin: f32,
    existing_coins: &mut [SettledCoin],
) -> ThrowSimulationResult {
    let mut rng = rand::rng();

    // Clamp input ranges safely
    let angle_rad = angle_deg.clamp(-35.0, 35.0).to_radians();
    let elev_rad = elevation_deg.clamp(18.0, 55.0).to_radians();
    let p = power.clamp(0.05, 1.0);

    // Speed curve calibrated so ~0.50 power lands near the center line (3.75m)
    // Range: 3.5 m/s to 6.9 m/s
    let speed = 3.5 + (p * 3.4);

    // Initial velocity vectors
    let v_forward = speed * elev_rad.cos();
    let vx0 = v_forward * angle_rad.sin();
    let vy0 = v_forward * angle_rad.cos();
    let vz0 = speed * elev_rad.sin();

    // Time of flight until z reaches 0 (ground level)
    // z(t) = z0 + vz0*t - 0.5*g*t^2 = 0
    // 0.5*g*t^2 - vz0*t - z0 = 0
    let a = 0.5 * GRAVITY;
    let b = -vz0;
    let c = -RELEASE_HEIGHT_Z;
    let discriminant = b * b - 4.0 * a * c;
    let flight_time = if discriminant >= 0.0 {
        (-b + discriminant.sqrt()) / (2.0 * a)
    } else {
        0.8
    };

    // Generate sampled trajectory for silky smooth 60fps client interpolation
    let sample_count = 24;
    let mut trajectory = Vec::with_capacity(sample_count + 1);
    for i in 0..=sample_count {
        let frac = (i as f32) / (sample_count as f32);
        let t = frac * flight_time;
        let x = vx0 * t + (spin * 0.03 * t * t);
        let y = vy0 * t;
        let z = (RELEASE_HEIGHT_Z + vz0 * t - 0.5 * GRAVITY * t * t).max(0.0);
        trajectory.push(TrajectoryPoint { x, y, z, t });
    }

    // Impact coordinate
    let impact_x = vx0 * flight_time + (spin * 0.03 * flight_time * flight_time);
    let impact_y = vy0 * flight_time;

    // Check if impact is inside the Cajón de Barro
    let in_box_x = impact_x >= (BOX_MIN_X - 0.02) && impact_x <= (BOX_MAX_X + 0.02);
    let in_box_y = impact_y >= (BOX_MIN_Y - 0.02) && impact_y <= (BOX_MAX_Y + 0.02);

    let mut knockouts = Vec::new();
    let mut sound_cue = "thud_clay".to_string();
    let mut was_clavada = false;

    let (final_x, final_y, status) = if in_box_x && in_box_y {
        // Damp clay physics:
        // 1. Skid damping: damp clay absorbs most energy, slight skid based on forward speed
        let skid_distance = (vy0 * 0.025).clamp(0.02, 0.12);
        let skid_x = (vx0 * 0.02) + (spin * 0.015);
        let mut settled_x = (impact_x + skid_x).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
        let mut settled_y = (impact_y + skid_distance).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

        // Rare "Clavada": steep angle + moderate speed + 5% random chance
        if elevation_deg > 38.0 && p > 0.45 && p < 0.75 && rng.random_range(0..100) < 6 {
            was_clavada = true;
            sound_cue = "clavada".to_string();
        }

        // Check coin collisions with already settled coins in the box
        for existing in existing_coins.iter_mut() {
            if existing.status == CoinStatus::InBox || existing.status == CoinStatus::Clavada {
                let dx = existing.x - settled_x;
                let dy = existing.y - settled_y;
                let dist = (dx * dx + dy * dy).sqrt();
                let min_dist = COIN_RADIUS * 2.0;

                if dist < min_dist && dist > 0.0001 {
                    // Collision! Knock the existing coin
                    let old_x = existing.x;
                    let old_y = existing.y;
                    let was_on = existing.is_on_line;

                    let overlap = min_dist - dist;
                    let nx = dx / dist;
                    let ny = dy / dist;

                    // Push existing coin along normal, adjust our settled position slightly back
                    existing.x = (existing.x + nx * (overlap + 0.04)).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
                    existing.y = (existing.y + ny * (overlap + 0.04)).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

                    // Recalculate existing coin's distance and status
                    let new_dist = (existing.y - TARGET_LINE_Y).abs();
                    let new_is_on = new_dist <= COIN_RADIUS;
                    existing.is_on_line = new_is_on;
                    existing.dist_to_line_m = if new_is_on { 0.0 } else { new_dist - COIN_RADIUS };
                    existing.dist_to_line_mm = existing.dist_to_line_m * 1000.0;
                    existing.display_distance = format_distance(existing.dist_to_line_mm, new_is_on);

                    settled_x -= nx * 0.02;
                    settled_y -= ny * 0.02;

                    knockouts.push(KnockoutEvent {
                        victim_coin_id: existing.id.clone(),
                        victim_player_name: existing.player_name.clone(),
                        old_x,
                        old_y,
                        new_x: existing.x,
                        new_y: existing.y,
                        was_on_line: was_on,
                        is_now_on_line: new_is_on,
                    });
                }
            }
        }

        let coin_status = if was_clavada {
            CoinStatus::Clavada
        } else {
            CoinStatus::InBox
        };

        (settled_x, settled_y, coin_status)
    } else {
        // Landed outside the cajón
        sound_cue = "miss".to_string();
        (impact_x, impact_y, CoinStatus::OffBox)
    };

    // Calculate distance to center line (Y = 3.75m)
    let (is_on_line, dist_m, dist_mm) = if status == CoinStatus::InBox || status == CoinStatus::Clavada {
        let raw_diff = (final_y - TARGET_LINE_Y).abs();
        if raw_diff <= COIN_RADIUS {
            // Coin edge intersects or covers the line!
            if !was_clavada {
                sound_cue = "rayada".to_string();
            }
            (true, 0.0, 0.0)
        } else {
            let d_m = raw_diff - COIN_RADIUS;
            let d_mm = d_m * 1000.0;
            (false, d_m, d_mm)
        }
    } else {
        (false, 999.0, 999000.0)
    };

    if !knockouts.is_empty() && sound_cue != "rayada" && sound_cue != "clavada" {
        sound_cue = "knockout".to_string();
    }

    let display_distance = format_distance(dist_mm, is_on_line);

    let coin = SettledCoin {
        id: coin_id.to_string(),
        player_id: player_id.to_string(),
        player_name: player_name.to_string(),
        color: color.to_string(),
        avatar: avatar.to_string(),
        coin_skin: coin_skin.to_string(),
        throw_number,
        x: final_x,
        y: final_y,
        z: if was_clavada { 0.025 } else { 0.005 },
        status,
        is_on_line,
        dist_to_line_m: dist_m,
        dist_to_line_mm: dist_mm,
        display_distance,
    };

    ThrowSimulationResult {
        coin,
        trajectory,
        flight_duration_s: flight_time,
        knockouts,
        was_clavada,
        sound_cue,
    }
}

pub fn format_distance(dist_mm: f32, is_on_line: bool) -> String {
    if is_on_line {
        "🎯 ¡EN LA RAYA!".to_string()
    } else if dist_mm > 5000.0 {
        "❌ Fuera del cajón".to_string()
    } else if dist_mm < 10.0 {
        format!("{:.1} mm (¡Rozando!)", dist_mm)
    } else if dist_mm < 100.0 {
        format!("{:.1} mm", dist_mm)
    } else {
        format!("{:.1} cm", dist_mm / 10.0)
    }
}

/// Helper for AI bots to calculate ideal angle and power to target the center line (3.75m),
/// with customizable Gaussian jitter depending on bot difficulty/personality.
pub fn calculate_bot_throw(
    target_x: f32,
    target_y: f32,
    variance_sigma: f32, // e.g. 0.018 for Don Ramon, 0.075 for Novato
) -> (f32, f32, f32, f32) {
    let mut rng = rand::rng();

    // Standard trajectory parameters for 3.75m target:
    // With elevation = 28 deg, ideal power is ~0.50
    let ideal_elevation = 28.0;
    let ideal_power = 0.505;

    // Lateral angle to hit target_x from (0,0)
    let ideal_angle = (target_x / target_y).atan().to_degrees();

    // Add Gaussian-like noise (Box-Muller transform)
    let u1: f32 = rng.random_range(0.0001..1.0);
    let u2: f32 = rng.random_range(0.0001..1.0);
    let z0 = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f32::consts::PI * u2).cos();
    let z1 = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f32::consts::PI * u2).sin();

    let jittered_power = (ideal_power + (z0 * variance_sigma * 0.5)).clamp(0.10, 0.95);
    let jittered_angle = (ideal_angle + (z1 * variance_sigma * 45.0)).clamp(-25.0, 25.0);
    let jittered_elevation = (ideal_elevation + (z0 * 1.5)).clamp(22.0, 38.0);
    let spin = rng.random_range(-0.35..0.35);

    (jittered_angle, jittered_power, jittered_elevation, spin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perfect_throw_lands_in_cajon() {
        let mut coins = Vec::new();
        let res = simulate_throw(
            "c1",
            "p1",
            "Don Ramón",
            "#f59e0b",
            "🧔",
            "centenario",
            1,
            0.0,
            0.505,
            28.0,
            0.0,
            &mut coins,
        );

        assert_eq!(res.coin.status, CoinStatus::InBox);
        assert!(res.coin.y >= BOX_MIN_Y && res.coin.y <= BOX_MAX_Y);
        // Should land very close to the center line 3.75m
        assert!((res.coin.y - TARGET_LINE_Y).abs() < 0.20);
        assert!(res.coin.is_on_line, "Ideal throw should rayar");
    }

    #[test]
    fn test_wild_overshoot_lands_offbox() {
        let mut coins = Vec::new();
        let res = simulate_throw(
            "c2",
            "p2",
            "El Novato",
            "#ef4444",
            "🧒",
            "bronce",
            1,
            0.0,
            1.0, // Max power
            45.0,
            0.0,
            &mut coins,
        );

        assert_eq!(res.coin.status, CoinStatus::OffBox);
        assert!(res.coin.y > BOX_MAX_Y);
    }

    #[test]
    fn test_coin_collision_knocks_existing_coin() {
        let mut coins = vec![SettledCoin {
            id: "existing_1".to_string(),
            player_id: "p1".to_string(),
            player_name: "Rival".to_string(),
            color: "#10b981".to_string(),
            avatar: "🤠".to_string(),
            coin_skin: "centenario".to_string(),
            throw_number: 1,
            x: 0.0,
            y: 3.75,
            z: 0.005,
            status: CoinStatus::InBox,
            is_on_line: true,
            dist_to_line_m: 0.0,
            dist_to_line_mm: 0.0,
            display_distance: "🎯 ¡EN LA RAYA!".to_string(),
        }];

        let res = simulate_throw(
            "c3",
            "p2",
            "El Charro",
            "#3b82f6",
            "🤠",
            "diez_pesos",
            1,
            0.0,
            0.505,
            28.0,
            0.0,
            &mut coins,
        );

        assert!(!res.knockouts.is_empty(), "Should record knockout event");
        assert_ne!(coins[0].y, 3.75, "Existing coin should be displaced");
    }
}
