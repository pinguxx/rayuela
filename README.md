# 🪙 Rayuela Mexicana — El Cajón de Barro Online 🎯

[![CI/CD](https://github.com/pinguxx/rayuela/actions/workflows/ci.yml/badge.svg)](https://github.com/pinguxx/rayuela/actions/workflows/ci.yml)
[![Rust](https://img.shields.io/badge/Rust-1.80%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render)](https://render.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Un juego tradicional mexicano de feria y convivencia familiar desarrollado en **Rust** (con **Axum** y **WebSockets**) y un cliente web interactivo con física de impacto en arcilla y perspectiva **2.5D**.

Forma parte de la colección de juegos tradicionales mexicanos junto a **Lotería Mexicana**, **La Pirinola (Toma Todo)**, **El Juego de la Oca** y **Serpientes y Escaleras**.

---

## 🇲🇽 Guía en Español

A diferencia del juego infantil de saltar casillas (conocido en México como *el avión*, *avioncito* o *bebeleche*), **La Rayuela** en México es el histórico juego tradicional de precisión con monedas y fichas.

Los jugadores se colocan en la línea de tiro y lanzan sus monedas hacia **El Cajón de Barro** (una caja de madera rellena de arcilla humedecida para absorber el rebote). El objetivo es planchar la moneda exactamente sobre la línea divisoria (*rayar*) o dejarla lo más cerca posible.

---

### 🌟 Características Principales

1. **Física Realista de Barro en 2.5D:**
   * **Gesto libre de lanzamiento:** Arrastra hacia atrás para medir fuerza y ángulo o desliza el dedo/ratón para lanzar la moneda con arco parabólico.
   * **El Cajón de Barro:** Arcilla húmeda con fricción y absorción de impacto ($e \approx 0.18$), dejando huella donde se clava la moneda.
   * **Carambolas y Knockouts:** Las monedas en el cajón pueden ser golpeadas y desplazadas por tiros posteriores.
   * **Clavada de Antología:** Si el tiro entra con gran ángulo de descenso, la moneda puede clavarse verticalmente de canto en el barro (+5 puntos).

2. **Cámara Foto-Finish & Dictamen Oficial:**
   * Al terminar cada tanda de tiros, la cámara hace una transición cenital aérea sobre el cajón con un calibrador digital que mide la distancia exacta a la línea en milímetros.

3. **Multijugador en Tiempo Real y Modo Solitario con Bots:**
   * Salas privadas con código de 5 caracteres (ej. `RAYU26`) y código QR para unirse al instante desde el celular.
   * **Bots con Personalidades Mexicanas:** Juega contra *Don Ramón Bot* (jugador experto con pulso de cirujano), *El Charro Bot* (competitivo que busca carambolas), *Doña Chelo Bot*, *El Maestro* y *El Novato*.
   * Dichos populares y frases de ánimo familiares: *"¡Directo en la línea! ¡Tiro de campeón!"*, *"¡Puntería perfecta! ¡Tocó la raya!"*, *"¡Buen tiro! ¡Quedó muy cerca de la línea!"*.

4. **Audio Web Procedural y PWA:**
   * Motor de audio 100% sintetizado con Web Audio API (zumbido en el aire, impacto seco en barro, repique metálico de monedas y dianas de mariachi) sin archivos de audio pesados.
   * Instalable como PWA en Android e iOS.
   * **Trofeo Canvas Descargable:** Genera un certificado de victoria oficial con podio y estadísticas para compartir en redes.

---

## 🇺🇸 English Guide

A real-time multiplayer web adaptation of traditional Mexican **Rayuela**—the classic precision coin-pitching game. Built with a high-performance **Rust** backend (`Axum 0.8`, `Tokio`, `WebSockets`) and an interactive 2.5D Canvas frontend.

### Rules of Traditional Rayuela:
* **The Pitch:** Players take turns pitching heavy coins or metal tokens towards **El Cajón de Barro** (a damp clay wooden box set 3.75m away).
* **Rayar (3 points):** Landing directly on or overlapping the center line (*La Raya*).
* **Clavada (5 points):** Sticking the coin vertically edge-down into the damp clay.
* **Distance Point (1 point):** The single closest coin to the line at the end of the round.
* **Match Target:** First player to reach 15 (or 21) points wins!

---

## 🚀 Cómo Ejecutar Localmente

### Requisitos
* [Rust](https://www.rust-lang.org/) (versión 1.80 o superior)

### Pasos
```bash
# 1. Entrar al proyecto
cd c:\dev\rayuela

# 2. Correr las pruebas unitarias
cargo test

# 3. Iniciar el servidor
cargo run --release
```

Abre tu navegador en **[http://localhost:3000](http://localhost:3000)** (o con la IP de tu red local para jugar en el celular).

---

## 🐳 Despliegue en Docker & Render.com

El proyecto incluye un `Dockerfile` multietapa optimizado y un archivo `render.yaml` listo para desplegar:

```bash
docker build -t rayuela:latest .
docker run -p 3000:3000 rayuela:latest
```

---

## 📜 Licencia

MIT License — Tradición y código abierto.
