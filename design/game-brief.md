# 🪙 Rayuela Mexicana — El Cajón de Barro
**Digital Adaptation Brief & Specification**
*Part of the Traditional Mexican Game Suite (Lotería, Pirinola, Oca, Serpientes y Escaleras)*

---

## 🎯 1. Overview & Vision
*Rayuela* is the iconic Mexican cantina and courtyard coin-tossing game of precision. Unlike hopscotch (*el avión*), Mexican Rayuela tests players' nerves and touch as they pitch heavy coins (*monedas pesadas / fichas*) down a cantina lane toward **El Cajón de Barro** (a wooden box filled with damp clay).

The digital version brings this historic Mexican tradition to web and mobile browsers with 2.5D perspective coin tossing, authentic clay impact and coin collision physics, real-time multiplayer with room codes and QR invites, Mexican cantina AI bots, and procedural Web Audio.

---

## 🎲 2. Core Mechanics

### 2.1 The Pitch & Controls
* **Perspective:** 2.5D view from the throw line looking down the cantina lane toward the clay box.
* **Input (Touch / Mouse):**
  * **Swipe / Flick:** Drag back to gauge power and angle, then release or flick forward.
  * **Velocity & Arc:** Throw strength determines distance; pitch angle determines trajectory height.
  * **Spin & Drift:** Subtle lateral angles add spin, affecting how the coin bites into the clay upon landing.

### 2.2 Cajón de Barro Physics
* **Dimensions:**
  * Box: 100 cm wide $\times$ 150 cm deep, situated 3.5 meters from the throw line.
  * Center Line (*La Raya*): Carved across the middle of the clay box ($Y = 3.75\text{ m}$).
* **Clay Damping & Collisions:**
  * Damp clay absorbs momentum with minimal bounce ($e \approx 0.18$), leaving a mark where the coin settles.
  * Coins can knock opponent coins off the line or deeper into the box.
  * If a coin lands directly on edge with high downward momentum, it triggers a rare **Clavada**!

### 2.3 Scoring & Victory Rules (Puntos de Precisión)
* **Round Structure:**
  * Each player throws **2 coins per round**, alternating turns with opponents.
  * Coins remain on the clay throughout the round.
* **Scoring at Round End (*El Dictamen del Cantinero*):**
  * **Rayar (Raya Limpia):** Coin touches or covers the center line $\rightarrow$ **3 points**.
  * **Clavada:** Coin sticks edge-down in the clay $\rightarrow$ **5 points**.
  * **Punto de Distancia:** The single closest coin to the line (if no *raya*, or among non-rayadas) $\rightarrow$ **1 point**.
* **Target Match:** First player to reach **15 points** (or 21 in long matches) wins!

---

## 🤖 3. Mexican Cantina Bots (Solo & AI Fill)
* 👨‍🦳 **Don Ramón Bot:** Experienced cantina hustler, very high precision and steady hands.
* 🤠 **El Charro Bot:** Aggressive thrower that targets opponent coins to knock them off *la raya*.
* 🍸 **El Cantinero:** Balanced thrower with witty bar banter.
* 🧒 **El Novato:** High variance, occasionally throws wild or overshoots.

---

## 🌐 4. Technical Architecture
* **Backend:** Rust 1.80+ / 1.99, Axum 0.8, Tokio 1.54, WebSockets, Serde.
* **Frontend:** Zero-dependency Vanilla JS, HTML5 Canvas, Web Audio API, responsive PWA.
* **Networking:** Rooms with 4-to-6 uppercase letters, QR code modal, spectator support, reconnection via localStorage session tokens.
* **Deployment:** Multi-stage Dockerfile + `render.yaml` for Render.com.
