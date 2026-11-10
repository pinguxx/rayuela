use rand::RngExt;
use serde::{Deserialize, Serialize};

/// Dimensions and physics constants for the Mexican Rayuela courts.
/// Units are in meters and seconds.
pub const BOX_MIN_X: f32 = -0.50; // 100 cm wide (-50cm to +50cm)
pub const BOX_MAX_X: f32 = 0.50;
pub const BOX_MIN_Y: f32 = 3.00; // Court target area starts 3.0m from throw line
pub const BOX_MAX_Y: f32 = 4.50; // Court ends 4.5m from throw line (1.5m deep)
pub const TARGET_LINE_Y: f32 = 3.75; // Center line (La Raya)
pub const COIN_RADIUS: f32 = 0.055; // 5.5cm radius (11.0cm diameter, perfectly matches on-screen visual coin scale)
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

fn propagate_chain_reactions(
    initial_victim_idx: usize,
    existing_coins: &mut [SettledCoin],
    knockouts: &mut Vec<KnockoutEvent>,
    current_time: f32,
    min_dist: f32,
) {
    let mut active_movers = vec![initial_victim_idx];
    let len = existing_coins.len();
    let mut passes = 0;

    while let Some(source_idx) = active_movers.pop() {
        passes += 1;
        if passes > 15 {
            break; // Guard against infinite cascade loops
        }
        let src_x = existing_coins[source_idx].x;
        let src_y = existing_coins[source_idx].y;

        for target_idx in 0..len {
            if target_idx == source_idx {
                continue;
            }
            if existing_coins[target_idx].status != CoinStatus::InBox && existing_coins[target_idx].status != CoinStatus::Clavada {
                continue;
            }

            let dx = existing_coins[target_idx].x - src_x;
            let dy = existing_coins[target_idx].y - src_y;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist < min_dist {
                let (nx, ny) = if dist > 0.0001 {
                    (dx / dist, dy / dist)
                } else {
                    (0.0, 1.0)
                };
                let overlap = min_dist - dist;
                let push_amount = (overlap * 0.65 + 0.07).clamp(0.08, 0.30);

                let old_target_x = existing_coins[target_idx].x;
                let old_target_y = existing_coins[target_idx].y;
                let was_on = existing_coins[target_idx].is_on_line;

                existing_coins[target_idx].x = (old_target_x + nx * push_amount).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
                existing_coins[target_idx].y = (old_target_y + ny * push_amount).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

                let new_dist = (existing_coins[target_idx].y - TARGET_LINE_Y).abs();
                let new_is_on = new_dist <= COIN_RADIUS;
                existing_coins[target_idx].is_on_line = new_is_on;
                existing_coins[target_idx].dist_to_line_m = if new_is_on { 0.0 } else { new_dist - COIN_RADIUS };
                existing_coins[target_idx].dist_to_line_mm = existing_coins[target_idx].dist_to_line_m * 1000.0;
                existing_coins[target_idx].display_distance = format_distance(existing_coins[target_idx].dist_to_line_mm, new_is_on);

                let coll_time = current_time + (passes as f32) * 0.05;
                if let Some(existing_k) = knockouts.iter_mut().find(|k| k.victim_coin_id == existing_coins[target_idx].id) {
                    existing_k.new_x = existing_coins[target_idx].x;
                    existing_k.new_y = existing_coins[target_idx].y;
                    existing_k.is_now_on_line = new_is_on;
                } else {
                    knockouts.push(KnockoutEvent {
                        victim_coin_id: existing_coins[target_idx].id.clone(),
                        victim_player_name: existing_coins[target_idx].player_name.clone(),
                        collision_time_s: coll_time,
                        collision_x: src_x,
                        collision_y: src_y,
                        old_x: old_target_x,
                        old_y: old_target_y,
                        new_x: existing_coins[target_idx].x,
                        new_y: existing_coins[target_idx].y,
                        was_on_line: was_on,
                        is_now_on_line: new_is_on,
                    });
                }

                // Chain reaction: pushed coin can push another coin
                active_movers.push(target_idx);
            }
        }
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
) -> bool {
    let min_dist = COIN_RADIUS * 2.05;
    let mut any_hit = false;

    for i in 0..existing_coins.len() {
        if existing_coins[i].status != CoinStatus::InBox && existing_coins[i].status != CoinStatus::Clavada {
            continue;
        }

        let dx = existing_coins[i].x - *cur_x;
        let dy = existing_coins[i].y - *cur_y;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist < min_dist {
            any_hit = true;
            let old_x = existing_coins[i].x;
            let old_y = existing_coins[i].y;
            let was_on = existing_coins[i].is_on_line;

            let (nx, ny) = if dist > 0.0001 {
                (dx / dist, dy / dist)
            } else {
                (0.0, 1.0)
            };
            let overlap = min_dist - dist;

            // Momentum transfer: strong visible push for victim
            let push_dist = (overlap * 0.60 + 0.10 + *slide_speed * 0.16).clamp(0.12, 0.42);
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

            // Thrown coin separates from contact point, deflects, and retains enough speed to hit other coins!
            *cur_x -= nx * (overlap * 0.50);
            *cur_y -= ny * (overlap * 0.50);
            *slide_speed = (*slide_speed * 0.72).max(0.22);
            *slide_dir_x -= nx * 0.65;
            *slide_dir_y -= ny * 0.65;
            let norm = (*slide_dir_x * *slide_dir_x + *slide_dir_y * *slide_dir_y).sqrt().max(0.001);
            *slide_dir_x /= norm;
            *slide_dir_y /= norm;

            *sound_cue = "knockout".to_string();

            if !knockouts.iter().any(|k| k.victim_coin_id == existing_coins[i].id && (k.collision_time_s - current_time).abs() < 0.15) {
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
            }

            // Propagate chain collisions strictly from this displaced victim to other coins it strikes
            propagate_chain_reactions(i, existing_coins, knockouts, current_time + 0.04, min_dist);
        }
    }
    any_hit
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
        // Check for Clavada on damp clay only (if not landing directly on another coin)
        let clavada_candidate = court_theme == "cajon_barro" && elevation_deg > 38.0 && p > 0.45 && p < 0.75 && rng.random_range(0..100) < 6;
        let candidate_x = impact1_x.clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
        let candidate_y = impact1_y.clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);
        let hits_settled = existing_coins.iter().any(|c| {
            (c.status == CoinStatus::InBox || c.status == CoinStatus::Clavada)
                && ((c.x - candidate_x).powi(2) + (c.y - candidate_y).powi(2)).sqrt() < (COIN_RADIUS * 2.05)
        });

        if clavada_candidate && !hits_settled {
            was_clavada = true;
            sound_cue = "clavada".to_string();
            (candidate_x, candidate_y, CoinStatus::Clavada)
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

                    // Check for low-altitude skim collision (< 4cm above ground)
                    if z <= 0.045 {
                        let mut test_x = x;
                        let mut test_y = y;
                        let mut test_dir_x = if vx.abs() > 0.001 { vx / vx.abs() } else { 0.0 };
                        let mut test_dir_y = if vy.abs() > 0.001 { vy / vy.abs() } else { 1.0 };
                        let mut test_spd = (vx * vx + vy * vy).sqrt();
                        let hit = check_and_apply_collision(
                            &mut test_x,
                            &mut test_y,
                            &mut test_dir_x,
                            &mut test_dir_y,
                            &mut test_spd,
                            current_time + dt,
                            existing_coins,
                            &mut knockouts,
                            &mut sound_cue,
                        );
                        if hit {
                            vx = test_dir_x * test_spd;
                            vy = test_dir_y * test_spd;
                            cur_x = test_x;
                            cur_y = test_y;
                            break;
                        }
                    }
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
            let max_slide_steps = 35;

            for _ in 0..max_slide_steps {
                if slide_speed <= 0.06 {
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
                        slide_speed *= 0.70;
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
                    let collided = check_and_apply_collision(
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
                    if collided {
                        trajectory.push(TrajectoryPoint {
                            x: cur_x,
                            y: cur_y,
                            z: 0.0,
                            t: current_time,
                            is_bounce: true,
                        });
                    }
                }

                // Surface friction deceleration
                slide_speed -= court.friction * GRAVITY * slide_dt * 0.75;

                trajectory.push(TrajectoryPoint {
                    x: cur_x,
                    y: cur_y,
                    z: 0.0,
                    t: current_time,
                    is_bounce: false,
                });
            }

            let mut settled_x = cur_x.clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
            let mut settled_y = cur_y.clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

            // 4. Final Settling Separation: Guarantee NO two coins can ever sit overlapping on the board!
            let min_allowed = COIN_RADIUS * 2.05;
            let mut any_settling_collision = false;

            for pass in 0..5 {
                let mut had_overlap = false;
                for i in 0..existing_coins.len() {
                    if existing_coins[i].status != CoinStatus::InBox && existing_coins[i].status != CoinStatus::Clavada {
                        continue;
                    }
                    let dx = existing_coins[i].x - settled_x;
                    let dy = existing_coins[i].y - settled_y;
                    let dist = (dx * dx + dy * dy).sqrt();

                    if dist < min_allowed {
                        had_overlap = true;
                        any_settling_collision = true;
                        let (nx, ny) = if dist > 0.0001 {
                            (dx / dist, dy / dist)
                        } else {
                            (0.0, 1.0)
                        };
                        let overlap = min_allowed - dist;
                        let push_amount = (overlap * 0.55 + 0.04).clamp(0.05, 0.25);

                        let old_x = existing_coins[i].x;
                        let old_y = existing_coins[i].y;
                        let was_on = existing_coins[i].is_on_line;

                        existing_coins[i].x = (old_x + nx * push_amount).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
                        existing_coins[i].y = (old_y + ny * push_amount).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

                        settled_x = (settled_x - nx * (overlap * 0.50)).clamp(BOX_MIN_X + COIN_RADIUS, BOX_MAX_X - COIN_RADIUS);
                        settled_y = (settled_y - ny * (overlap * 0.50)).clamp(BOX_MIN_Y + COIN_RADIUS, BOX_MAX_Y - COIN_RADIUS);

                        let new_dist = (existing_coins[i].y - TARGET_LINE_Y).abs();
                        let new_is_on = new_dist <= COIN_RADIUS;
                        existing_coins[i].is_on_line = new_is_on;
                        existing_coins[i].dist_to_line_m = if new_is_on { 0.0 } else { new_dist - COIN_RADIUS };
                        existing_coins[i].dist_to_line_mm = existing_coins[i].dist_to_line_m * 1000.0;
                        existing_coins[i].display_distance = format_distance(existing_coins[i].dist_to_line_mm, new_is_on);

                        sound_cue = "knockout".to_string();

                        let coll_time = current_time + (pass as f32) * 0.06;
                        if let Some(existing_k) = knockouts.iter_mut().find(|k| k.victim_coin_id == existing_coins[i].id) {
                            existing_k.new_x = existing_coins[i].x;
                            existing_k.new_y = existing_coins[i].y;
                            existing_k.is_now_on_line = new_is_on;
                        } else {
                            knockouts.push(KnockoutEvent {
                                victim_coin_id: existing_coins[i].id.clone(),
                                victim_player_name: existing_coins[i].player_name.clone(),
                                collision_time_s: coll_time,
                                collision_x: settled_x,
                                collision_y: settled_y,
                                old_x,
                                old_y,
                                new_x: existing_coins[i].x,
                                new_y: existing_coins[i].y,
                                was_on_line: was_on,
                                is_now_on_line: new_is_on,
                            });
                        }

                        // Chain reactions ONLY propagate from this directly contacted coin i
                        propagate_chain_reactions(i, existing_coins, &mut knockouts, coll_time, min_allowed);
                    }
                }
                if !had_overlap {
                    break;
                }
            }

            // If settling separation adjusted settled_x, settled_y, append smooth settling trajectory point
            if any_settling_collision || (settled_x - cur_x).abs() > 0.001 || (settled_y - cur_y).abs() > 0.001 {
                current_time += 0.22;
                trajectory.push(TrajectoryPoint {
                    x: settled_x,
                    y: settled_y,
                    z: 0.0,
                    t: current_time,
                    is_bounce: true,
                });
            }

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

    #[test]
    fn test_three_coins_chain_knockout_no_overlap() {
        // Setup two existing settled coins near the rayuela line (like Don Ramón and Jugador 1)
        let mut coins = vec![
            SettledCoin {
                id: "coin_ramon".to_string(),
                player_id: "p_ramon".to_string(),
                player_name: "Don Ramón".to_string(),
                color: "#0284c7".to_string(),
                avatar: "🧔".to_string(),
                coin_skin: "centenario".to_string(),
                throw_number: 1,
                x: -0.06,
                y: 3.73,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
            SettledCoin {
                id: "coin_jugador".to_string(),
                player_id: "p_jugador".to_string(),
                player_name: "Jugador 1".to_string(),
                color: "#f59e0b".to_string(),
                avatar: "🤠".to_string(),
                coin_skin: "diez_pesos".to_string(),
                throw_number: 1,
                x: 0.06,
                y: 3.73,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
        ];

        // Third coin thrown right down the middle at (0.0, 3.73) (like elo)
        let res = simulate_throw(
            "coin_elo",
            "p_elo",
            "elo",
            "#ec4899",
            "👵",
            "centenario",
            "cajon_barro",
            1,
            0.0,
            0.465,
            28.0,
            0.0,
            &mut coins,
        );

        assert!(!res.knockouts.is_empty(), "Should record knockout when throwing near existing coins");

        // Combine all 3 settled coins
        let mut all_settled = coins.clone();
        all_settled.push(res.coin);

        assert_eq!(all_settled.len(), 3);

        // Verify that NO TWO COINS overlap (distance must be >= 2.0 * COIN_RADIUS - small tolerance)
        let min_required = COIN_RADIUS * 1.95;
        for i in 0..all_settled.len() {
            for j in (i + 1)..all_settled.len() {
                let dx = all_settled[j].x - all_settled[i].x;
                let dy = all_settled[j].y - all_settled[i].y;
                let dist = (dx * dx + dy * dy).sqrt();
                assert!(
                    dist >= min_required,
                    "Coins {} and {} overlap! dist={:.4}m < min={:.4}m",
                    all_settled[i].player_name,
                    all_settled[j].player_name,
                    dist,
                    min_required
                );
            }
        }
    }

    #[test]
    fn test_thrown_coin_hits_multiple_coins_sequentially() {
        // Coin 1 placed at y=3.62 (directly in the slide path after impact1 at ~3.60)
        // Coin 2 placed at y=3.78 (downstream near the center line)
        let mut coins = vec![
            SettledCoin {
                id: "coin_obstacle_1".to_string(),
                player_id: "p1".to_string(),
                player_name: "Obstacle 1".to_string(),
                color: "#10b981".to_string(),
                avatar: "🧔".to_string(),
                coin_skin: "centenario".to_string(),
                throw_number: 1,
                x: 0.0,
                y: 3.62,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: false,
                dist_to_line_m: 0.13,
                dist_to_line_mm: 130.0,
                display_distance: "13.0 cm".to_string(),
            },
            SettledCoin {
                id: "coin_obstacle_2".to_string(),
                player_id: "p2".to_string(),
                player_name: "Obstacle 2".to_string(),
                color: "#ef4444".to_string(),
                avatar: "🤠".to_string(),
                coin_skin: "diez_pesos".to_string(),
                throw_number: 1,
                x: 0.01,
                y: 3.78,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
        ];

        // Strong throw aimed straight down center
        let res = simulate_throw(
            "coin_striker",
            "p3",
            "Striker",
            "#f59e0b",
            "🔥",
            "centenario",
            "cajon_barro",
            1,
            0.0,
            0.52,
            26.0,
            0.0,
            &mut coins,
        );

        // Striker must hit both obstacle 1 and obstacle 2!
        let victims: Vec<&str> = res.knockouts.iter().map(|k| k.victim_coin_id.as_str()).collect();
        assert!(
            victims.contains(&"coin_obstacle_1"),
            "Should hit obstacle 1, knockouts: {:?}",
            victims
        );
        assert!(
            victims.contains(&"coin_obstacle_2"),
            "Should hit obstacle 2 as well, knockouts: {:?}",
            victims
        );

        // All 3 coins must have zero overlap
        let mut all_settled = coins.clone();
        all_settled.push(res.coin);
        let min_required = COIN_RADIUS * 1.95;
        for i in 0..all_settled.len() {
            for j in (i + 1)..all_settled.len() {
                let dx = all_settled[j].x - all_settled[i].x;
                let dy = all_settled[j].y - all_settled[i].y;
                let dist = (dx * dx + dy * dy).sqrt();
                assert!(
                    dist >= min_required,
                    "Overlap between {} and {}: dist={:.4}m",
                    all_settled[i].player_name,
                    all_settled[j].player_name,
                    dist
                );
            }
        }
    }

    #[test]
    fn test_untouched_coins_do_not_move_between_turns() {
        let mut coins = vec![
            SettledCoin {
                id: "coin_quiet_1".to_string(),
                player_id: "p1".to_string(),
                player_name: "Quiet 1".to_string(),
                color: "#10b981".to_string(),
                avatar: "🧔".to_string(),
                coin_skin: "centenario".to_string(),
                throw_number: 1,
                x: 0.25,
                y: 3.75,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
            SettledCoin {
                id: "coin_quiet_2".to_string(),
                player_id: "p2".to_string(),
                player_name: "Quiet 2".to_string(),
                color: "#ef4444".to_string(),
                avatar: "🤠".to_string(),
                coin_skin: "diez_pesos".to_string(),
                throw_number: 1,
                x: 0.37,
                y: 3.75,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
        ];

        let orig_x1 = coins[0].x;
        let orig_y1 = coins[0].y;
        let orig_x2 = coins[1].x;
        let orig_y2 = coins[1].y;

        // Player throws to the FAR LEFT side of the court (x < -0.20)
        let res = simulate_throw(
            "coin_thrower",
            "p3",
            "Left Thrower",
            "#f59e0b",
            "🔥",
            "centenario",
            "cajon_barro",
            1,
            -15.0,
            0.52,
            26.0,
            0.0,
            &mut coins,
        );

        // Neither quiet coin should be in knockouts
        assert!(res.knockouts.is_empty(), "No knockouts should happen for untouched coins!");

        // Coordinates of untouched coins must be 100% strictly identical (zero drift between turns)
        assert_eq!(coins[0].x, orig_x1, "Quiet 1 X moved unexpectedly!");
        assert_eq!(coins[0].y, orig_y1, "Quiet 1 Y moved unexpectedly!");
        assert_eq!(coins[1].x, orig_x2, "Quiet 2 X moved unexpectedly!");
        assert_eq!(coins[1].y, orig_y2, "Quiet 2 Y moved unexpectedly!");
    }

    #[test]
    fn test_chain_reaction_only_moves_connected_coins() {
        let mut coins = vec![
            // Direct victim right in the line of throw
            SettledCoin {
                id: "coin_victim_a".to_string(),
                player_id: "p1".to_string(),
                player_name: "Victim A".to_string(),
                color: "#10b981".to_string(),
                avatar: "🧔".to_string(),
                coin_skin: "centenario".to_string(),
                throw_number: 1,
                x: 0.0,
                y: 3.65,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
            // Secondary victim directly behind Victim A (should receive chain reaction)
            SettledCoin {
                id: "coin_victim_b".to_string(),
                player_id: "p2".to_string(),
                player_name: "Victim B".to_string(),
                color: "#ef4444".to_string(),
                avatar: "🤠".to_string(),
                coin_skin: "diez_pesos".to_string(),
                throw_number: 1,
                x: 0.0,
                y: 3.76,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
            // Untouched bystander coin far to the right
            SettledCoin {
                id: "coin_bystander".to_string(),
                player_id: "p3".to_string(),
                player_name: "Bystander".to_string(),
                color: "#8b5cf6".to_string(),
                avatar: "💀".to_string(),
                coin_skin: "bronce_cantina".to_string(),
                throw_number: 1,
                x: 0.35,
                y: 3.75,
                z: 0.005,
                status: CoinStatus::InBox,
                is_on_line: true,
                dist_to_line_m: 0.0,
                dist_to_line_mm: 0.0,
                display_distance: "🎯 ¡EN LA RAYA!".to_string(),
            },
        ];

        let bystander_x = coins[2].x;
        let bystander_y = coins[2].y;

        let res = simulate_throw(
            "coin_striker",
            "p4",
            "Striker",
            "#f59e0b",
            "🔥",
            "centenario",
            "cajon_barro",
            1,
            0.0,
            0.52,
            26.0,
            0.0,
            &mut coins,
        );

        let knocked_ids: Vec<&str> = res.knockouts.iter().map(|k| k.victim_coin_id.as_str()).collect();
        assert!(knocked_ids.contains(&"coin_victim_a"), "Victim A must be hit!");
        assert!(!knocked_ids.contains(&"coin_bystander"), "Bystander must NEVER be hit!");

        // Bystander coordinates must remain 100% untouched
        assert_eq!(coins[2].x, bystander_x);
        assert_eq!(coins[2].y, bystander_y);
    }
}
