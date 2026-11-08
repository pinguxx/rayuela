use rand::RngExt;
use serde::{Deserialize, Serialize};

/// Dimensions and physics constants for the Mexican Rayuela courts.
/// Units are in meters and seconds.
pub const BOX_MIN_X: f32 = -0.50; // 100 cm wide (-50cm to +50cm)
pub const BOX_MAX_X: f32 = 0.50;
pub const BOX_MIN_Y: f32 = 3.00; // Court target area starts 3.0m from throw line
pub const BOX_MAX_Y: f32 = 4.50; // Court ends 4.5m from throw line (1.5m deep)
pub const TARGET_LINE_Y: f32 = 3.75; // Center line (La Raya)
pub const COIN_RADIUS: f32 = 0.038; // ~3.8cm radius (~7.6cm diameter for heavy cantina coin)
pub const GRAVITY: f32 = 9.81;
pub const RELEASE_HEIGHT_Z: f32 = 0.12; // Natural release height right above throw line

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoinStatus {
    InFlight,
    InBox,    // Succeeded landing in target area
    OffBox,   // Out of bounds
    Clavada,  // Rare landing stuck edge-down vertically in clay!
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrajectoryPoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub t: f32,
    #[serde(default)]
    pub is_bounce: bool,
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
    pub collision_time_s: f32,
    pub collision_x: f32,
    pub collision_y: f32,
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
    pub sound_cue: String, // "rayada", "clavada", "thud_clay", "bounce_tile", "wall_bounce", "knockout", "miss"
    pub court_theme: String,
}

/// Physical properties for each court venue
struct CourtPhysics {
    restitution: f32,    // Vertical bounce elasticity (0.15 = clay, 0.58 = tile)
    friction: f32,       // Surface slide deceleration (high = clay, low = polished tile)
    has_back_wall: bool, // Reflects coins forward if hitting back wall (carambola)
}

fn get_court_physics(theme: &str) -> CourtPhysics {
    match theme {
        "piso_pared" => CourtPhysics {
            restitution: 0.52,
            friction: 0.30,
            has_back_wall: true,
        },
        _ => CourtPhysics {
            // "cajon_barro" default (heavy damp clay absorbs almost all vertical bounce)
            restitution: 0.08,
            friction: 0.88,
            has_back_wall: false,
        },
    }
}

fn check_and_apply_collision(
    cur_x: &mut f32,
    cur_y: &mut f32,
    slide_dir_x: &mut f32,
    slide_dir_y: &mut f32,
    slide_speed: &mut f32,
    current_time: f32,
    existing_coins: &mut [SettledCoin],
    knockouts: &mut Vec<KnockoutEvent>,
    sound_cue: &mut String,
) {
    let min_dist = COIN_RADIUS * 2.1;

    for i in 0..existing_coins.len() {
        if existing_coins[i].status != CoinStatus::InBox && existing_coins[i].status != CoinStatus::Clavada {
            continue;
        }

        let dx = existing_coins[i].x - *cur_x;
        let dy = existing_coins[i].y - *cur_y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist < min_dist && dist > 0.0001 {
            let old_x = existing_coins[i].x;
            let old_y = existing_coins[i].y;
            let was_on = existing_coins[i].is_on_line;

            let nx = dx / dist;
            let ny = dy / dist;

            // Momentum transfer proportional to speed with a clear, visible push
            let push_dist = (0.10 + *slide_speed * 0.12).clamp(0.08, 0.35);
            let target_x = (old_x + nx * push_dist).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
            let target_y = (old_y + ny * push_dist).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

            existing_coins[i].x = target_x;
            existing_coins[i].y = target_y;

            let new_dist = (existing_coins[i].y - TARGET_LINE_Y).abs();
            let new_is_on = new_dist <= COIN_RADIUS;
            existing_coins[i].is_on_line = new_is_on;
            existing_coins[i].dist_to_line_m = if new_is_on { 0.0 } else { new_dist - COIN_RADIUS };
            existing_coins[i].dist_to_line_mm = existing_coins[i].dist_to_line_m * 1000.0;
            existing_coins[i].display_distance = format_distance(existing_coins[i].dist_to_line_mm, new_is_on);

            // Thrown coin deflects and loses speed
            *slide_speed *= 0.40;
            *slide_dir_x -= nx * 0.4;
            *slide_dir_y -= ny * 0.4;
            let norm = (*slide_dir_x * *slide_dir_x + *slide_dir_y * *slide_dir_y).sqrt().max(0.001);
            *slide_dir_x /= norm;
            *slide_dir_y /= norm;

            *sound_cue = "knockout".to_string();

            knockouts.push(KnockoutEvent {
                victim_coin_id: existing_coins[i].id.clone(),
                victim_player_name: existing_coins[i].player_name.clone(),
                collision_time_s: current_time,
                collision_x: *cur_x,
                collision_y: *cur_y,
                old_x,
                old_y,
                new_x: existing_coins[i].x,
                new_y: existing_coins[i].y,
                was_on_line: was_on,
                is_now_on_line: new_is_on,
            });

            // Secondary chain collision: check if the pushed coin strikes another coin
            let displaced_x = existing_coins[i].x;
            let displaced_y = existing_coins[i].y;
            for j in 0..existing_coins.len() {
                if j == i || (existing_coins[j].status != CoinStatus::InBox && existing_coins[j].status != CoinStatus::Clavada) {
                    continue;
                }
                let c_dx = existing_coins[j].x - displaced_x;
                let c_dy = existing_coins[j].y - displaced_y;
                let c_dist = (c_dx * c_dx + c_dy * c_dy).sqrt();
                if c_dist < min_dist && c_dist > 0.0001 {
                    let c_old_x = existing_coins[j].x;
                    let c_old_y = existing_coins[j].y;
                    let c_was_on = existing_coins[j].is_on_line;
                    let c_nx = c_dx / c_dist;
                    let c_ny = c_dy / c_dist;
                    let c_push = 0.08;
                    existing_coins[j].x = (c_old_x + c_nx * c_push).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
                    existing_coins[j].y = (c_old_y + c_ny * c_push).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);
                    let c_new_dist = (existing_coins[j].y - TARGET_LINE_Y).abs();
                    let c_new_is_on = c_new_dist <= COIN_RADIUS;
                    existing_coins[j].is_on_line = c_new_is_on;
                    existing_coins[j].dist_to_line_m = if c_new_is_on { 0.0 } else { c_new_dist - COIN_RADIUS };
                    existing_coins[j].dist_to_line_mm = existing_coins[j].dist_to_line_m * 1000.0;
                    existing_coins[j].display_distance = format_distance(existing_coins[j].dist_to_line_mm, c_new_is_on);

                    knockouts.push(KnockoutEvent {
                        victim_coin_id: existing_coins[j].id.clone(),
                        victim_player_name: existing_coins[j].player_name.clone(),
                        collision_time_s: current_time + 0.05,
                        collision_x: displaced_x,
                        collision_y: displaced_y,
                        old_x: c_old_x,
                        old_y: c_old_y,
                        new_x: existing_coins[j].x,
                        new_y: existing_coins[j].y,
                        was_on_line: c_was_on,
                        is_now_on_line: c_new_is_on,
                    });
                }
            }
        }
    }
}

/// Simulates a full physics throw with realistic multi-bounce, surface slide,
/// back-wall carambola rebound, and dynamic coin-on-coin collisions.
pub fn simulate_throw(
    coin_id: &str,
    player_id: &str,
    player_name: &str,
    color: &str,
    avatar: &str,
    coin_skin: &str,
    court_theme: &str,
    throw_number: u8,
    angle_deg: f32,
    power: f32,
    elevation_deg: f32,
    spin: f32,
    existing_coins: &mut [SettledCoin],
) -> ThrowSimulationResult {
    let mut rng = rand::rng();
    let court = get_court_physics(court_theme);

    // Clamp input ranges safely
    let angle_rad = angle_deg.clamp(-35.0, 35.0).to_radians();
    let elev_rad = elevation_deg.clamp(18.0, 55.0).to_radians();
    let p = power.clamp(0.05, 1.0);

    // Speed curve calibrated so ~0.50 power lands near the center line (3.75m)
    let speed = 4.2 + (p * 4.4);

    // Initial velocity vectors
    let v_forward = speed * elev_rad.cos();
    let mut vx = v_forward * angle_rad.sin();
    let mut vy = v_forward * angle_rad.cos();
    let vz0 = speed * elev_rad.sin();

    // 1. First parabolic flight in air until impact 1 (z = 0)
    let a = 0.5 * GRAVITY;
    let b = -vz0;
    let c = -RELEASE_HEIGHT_Z;
    let discriminant = b * b - 4.0 * a * c;
    let flight_time_1 = if discriminant >= 0.0 {
        (-b + discriminant.sqrt()) / (2.0 * a)
    } else {
        0.8
    };

    let mut trajectory = Vec::new();

    // Sample initial flight arc (24 points)
    let sample_count_1 = 22;
    for i in 0..sample_count_1 {
        let frac = (i as f32) / (sample_count_1 as f32);
        let t = frac * flight_time_1;
        let x = vx * t + (spin * 0.03 * t * t);
        let y = vy * t;
        let z = (RELEASE_HEIGHT_Z + vz0 * t - 0.5 * GRAVITY * t * t).max(0.0);
        trajectory.push(TrajectoryPoint { x, y, z, t, is_bounce: false });
    }

    // Impact 1 coordinate
    let impact1_x = vx * flight_time_1 + (spin * 0.03 * flight_time_1 * flight_time_1);
    let impact1_y = vy * flight_time_1;
    let mut current_time = flight_time_1;

    // Check if impact is inside or near court bounds
    let in_court_x = impact1_x >= (BOX_MIN_X - 0.15) && impact1_x <= (BOX_MAX_X + 0.15);
    let in_court_y = impact1_y >= (BOX_MIN_Y - 0.20) && impact1_y <= (BOX_MAX_Y + 0.35);

    let mut knockouts = Vec::new();
    let mut sound_cue = if court_theme == "piso_pared" {
        "bounce_tile".to_string()
    } else {
        "thud_clay".to_string()
    };
    let mut was_clavada = false;

    // Mark impact 1 in trajectory
    trajectory.push(TrajectoryPoint {
        x: impact1_x,
        y: impact1_y,
        z: 0.0,
        t: current_time,
        is_bounce: true,
    });

    let (final_x, final_y, status) = if in_court_x && in_court_y {
        // Check for Clavada on damp clay only
        if court_theme == "cajon_barro" && elevation_deg > 38.0 && p > 0.45 && p < 0.75 && rng.random_range(0..100) < 6 {
            was_clavada = true;
            sound_cue = "clavada".to_string();
            let settled_x = impact1_x.clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
            let settled_y = impact1_y.clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);
            (settled_x, settled_y, CoinStatus::Clavada)
        } else {
            // 2. Multi-Bounce Arc: Rebound velocity on impact 1
            let vz_impact = (vz0 - GRAVITY * flight_time_1).abs();
            let vz_bounce = vz_impact * court.restitution;

            let mut cur_x = impact1_x;
            let mut cur_y = impact1_y;

            // Forward speed damped by surface impact
            vy *= (1.0 - (court.friction * 0.78)).max(0.08);
            vx *= 0.60;

            // If bounce height is significant (> 1.5 cm on tile/patio), simulate hop in air
            if vz_bounce > 0.40 {
                let bounce_dur = (2.0 * vz_bounce) / GRAVITY;
                let bounce_samples = 10;

                for j in 1..=bounce_samples {
                    let frac = (j as f32) / (bounce_samples as f32);
                    let dt = frac * bounce_dur;
                    let x = cur_x + vx * dt;
                    let y = cur_y + vy * dt;
                    let z = (vz_bounce * dt - 0.5 * GRAVITY * dt * dt).max(0.0);
                    trajectory.push(TrajectoryPoint {
                        x,
                        y,
                        z,
                        t: current_time + dt,
                        is_bounce: j == bounce_samples,
                    });
                }

                current_time += bounce_dur;
                cur_x += vx * bounce_dur;
                cur_y += vy * bounce_dur;

                // Rebound for small secondary bounce
                vy *= (1.0 - (court.friction * 0.45)).max(0.10);
            }

            // 3. Ground Roll & Slide Phase (decelerating across surface)
            let mut slide_speed = (vx * vx + vy * vy).sqrt();
            let mut slide_dir_x = if slide_speed > 0.001 { vx / slide_speed } else { 0.0 };
            let mut slide_dir_y = if slide_speed > 0.001 { vy / slide_speed } else { 1.0 };

            // Check if coin landed directly on an existing coin
            check_and_apply_collision(
                &mut cur_x,
                &mut cur_y,
                &mut slide_dir_x,
                &mut slide_dir_y,
                &mut slide_speed,
                current_time,
                existing_coins,
                &mut knockouts,
                &mut sound_cue,
            );

            let slide_dt = 0.035;
            let sub_steps = 4;
            let sub_dt = slide_dt / (sub_steps as f32);
            let max_slide_steps = 22;

            for _ in 0..max_slide_steps {
                if slide_speed <= 0.08 {
                    break;
                }

                for _ in 0..sub_steps {
                    current_time += sub_dt;
                    cur_x += slide_dir_x * slide_speed * sub_dt;
                    cur_y += slide_dir_y * slide_speed * sub_dt;

                    // Back-wall carambola rebound on Piso & Pared
                    if court.has_back_wall && cur_y >= (BOX_MAX_Y - 0.02) {
                        cur_y = BOX_MAX_Y - 0.02;
                        slide_dir_y = -slide_dir_y.abs(); // Rebound backwards toward line!
                        slide_speed *= 0.65;
                        sound_cue = "wall_bounce".to_string();
                        trajectory.push(TrajectoryPoint {
                            x: cur_x,
                            y: cur_y,
                            z: 0.0,
                            t: current_time,
                            is_bounce: true,
                        });
                    }

                    // Check coin-on-coin collisions with zero tunneling
                    check_and_apply_collision(
                        &mut cur_x,
                        &mut cur_y,
                        &mut slide_dir_x,
                        &mut slide_dir_y,
                        &mut slide_speed,
                        current_time,
                        existing_coins,
                        &mut knockouts,
                        &mut sound_cue,
                    );
                }

                // Surface friction deceleration
                slide_speed -= court.friction * GRAVITY * slide_dt * 0.85;

                trajectory.push(TrajectoryPoint {
                    x: cur_x,
                    y: cur_y,
                    z: 0.0,
                    t: current_time,
                    is_bounce: false,
                });
            }

            let settled_x = cur_x.clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
            let settled_y = cur_y.clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

            (settled_x, settled_y, CoinStatus::InBox)
        }
    } else {
        // Landed outside court boundaries
        sound_cue = "miss".to_string();
        (impact1_x, impact1_y, CoinStatus::OffBox)
    };

    // Calculate final distance to center line
    let (is_on_line, dist_m, dist_mm) = if status == CoinStatus::InBox || status == CoinStatus::Clavada {
        let raw_diff = (final_y - TARGET_LINE_Y).abs();
        if raw_diff <= COIN_RADIUS {
            if !was_clavada && sound_cue != "knockout" {
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

    let total_flight_duration = current_time;

    ThrowSimulationResult {
        coin,
        trajectory,
        flight_duration_s: total_flight_duration,
        knockouts,
        was_clavada,
        sound_cue,
        court_theme: court_theme.to_string(),
    }
}

pub fn format_distance(dist_mm: f32, is_on_line: bool) -> String {
    if is_on_line {
        "🎯 ¡EN LA RAYA!".to_string()
    } else if dist_mm > 5000.0 {
        "❌ Fuera de cancha".to_string()
    } else if dist_mm < 10.0 {
        format!("{:.1} mm (¡Rozando!)", dist_mm)
    } else if dist_mm < 100.0 {
        format!("{:.1} mm", dist_mm)
    } else {
        format!("{:.1} cm", dist_mm / 10.0)
    }
}

/// Helper for AI bots to calculate ideal angle and power to target the center line (3.75m),
/// calibrated for the active court's physics.
pub fn calculate_bot_throw(
    target_x: f32,
    target_y: f32,
    variance_sigma: f32,
    court_theme: &str,
) -> (f32, f32, f32, f32) {
    let mut rng = rand::rng();

    // Calibration: on bouncy tile, slightly less power because of bounce/slide forward
    let ideal_elevation = 28.0;
    let ideal_power = match court_theme {
        "piso_pared" => 0.42,
        _ => 0.465, // cajon_barro clay
    };

    // Lateral angle to hit target_x from (0,0)
    let ideal_angle = (target_x / target_y).atan().to_degrees();

    // Box-Muller Gaussian jitter
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
            "cajon_barro",
            1,
            0.0,
            0.465,
            28.0,
            0.0,
            &mut coins,
        );

        assert_eq!(res.coin.status, CoinStatus::InBox);
        assert!(res.coin.y >= BOX_MIN_Y && res.coin.y <= BOX_MAX_Y);
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
            "cajon_barro",
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
            "cajon_barro",
            1,
            0.0,
            0.465,
            28.0,
            0.0,
            &mut coins,
        );

        assert!(!res.knockouts.is_empty(), "Should record knockout event");
        assert_ne!(coins[0].y, 3.75, "Existing coin should be displaced");
    }

    #[test]
    fn test_multi_court_wall_bounce() {
        let mut coins = Vec::new();
        // High power throw on piso_pared hits back wall
        let res = simulate_throw(
            "c4",
            "p1",
            "Don Ramón",
            "#f59e0b",
            "🧔",
            "centenario",
            "piso_pared",
            1,
            0.0,
            0.85,
            26.0,
            0.0,
            &mut coins,
        );

        // Should have bounced off the back wall
        assert!(res.trajectory.iter().any(|pt| pt.is_bounce));
    }
}
