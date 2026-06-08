# 🤠 Gunslingers Pinball Golf

A 3D Wild-West **pinball + mini-golf** hybrid that runs entirely in the browser — no build step, no dependencies beyond Three.js. Putt the ball through pinball chaos (flippers, bumpers, Dutch windmills, lasers, loop-de-loops, fire hoops, teleport portals) and mini-golf wackiness (ramps, jumps, funnels, multi-tier greens) across 20 hand-built holes, then **build your own levels** in a full 2D + 3D editor.

Play against golf par — birdies, bogeys, hole-in-ones — with your **best score saved per hole** (across sessions), bumper-chain **combos**, and an end-of-round **scorecard**. Each terrain has its own look and physics, and hits land with juicy feedback: shockwaves, particle bursts, a Wild-West soundtrack and comic-book sound effects.

The game itself is procedurally rendered (Three.js geometry + a 2D canvas HUD) — the playfield needs no image assets. A cowboy-themed **landing page** (`index.html`) is the front door; the game lives in `game.html`.

## ▶ Play it

It's a static site. Serve the folder over HTTP and open it:

```bash
python3 -m http.server 8754
# then visit http://localhost:8754   (landing page → click PLAY)
# the game directly:  http://localhost:8754/game.html
```

(Opening via `file://` won't work because the font / asset loads need HTTP.)

## 🎮 Controls

**Aiming a shot** — drag on the table: left/right to aim, down for power, release to fire. A live trajectory preview shows the path, including bank shots off the walls.

**Flippers (while the ball rolls)** — tap the left/right half of the screen, or press `A`/`←` and `D`/`→`.

**Power-ups** — roll over them to grab: **Magnet** (pulls you to the cup), **Shield** (blocks the next hazard), **Slow-mo** (bullet-time through gates), **Gem** (bonus points), **Jump** (hop over walls).

Buttons (top-left in game): **Level Editor**, **Levels** (pick/skip any hole), **Skip**.

**Sound & music** — tap the 🔊 speaker (bottom-right) for the audio panel: independent **Master / Music / SFX** volume sliders, a mute toggle, and a track-skip for the Wild-West soundtrack. Everything defaults to **50%** (never full-blast) and your levels are remembered between sessions.

## 🛠 Level Editor

- **2D top-down editor** with a tool palette: walls (freehand draw, click-corners, or 2-click), bumpers, boosters, flippers, windmills, loops, drop-holes, **portals with up to 3 random exits**, fire hoops, enemies (patrol/chase, knockback/reset/stun), coins, power-ups, lasers, hills, funnels, ramps, tiers, and up/down terrain painting.
- **3D editor mode** (🧊): orbit the level in 3D and click items to select/drag them.
- Every item has live, editable stats (radius, bounce, speed, rotation, height, points, …).
- **7 terrain themes**, each with its own physics: Grass, Ice (slides), Moon (low-G), Mud, Rubber, Speedway, Sand.
- Per-level settings: gravity, friction, bounce, cup size, par, board size, tilt.
- **Test** your level instantly, then jump back to editing.
- **Save / Load / Export (JSON or download) / Import (paste or file)**. Saves persist in `localStorage` and survive reloads.
- Undo/redo, duplicate, delete, grid snap, collapsible panels, responsive layout.

## 🧱 Tech

Single-file engine in [`js/pingolf.js`](js/pingolf.js): a fixed-timestep 3D heightfield golf/pinball simulation, a `builder()` DSL for holes, a self-contained DOM/canvas editor, and a small Web-Audio mixer (master/music/SFX gains) driving a looping soundtrack. Rendering via [Three.js](https://threejs.org/) (`vendor/three.min.js`, MIT). `index.html` is the landing page, `game.html` hosts the engine.

## 🎨 Art & audio

The branded **Gunslingers** artwork, backgrounds and music are **not bundled** in this repo (they're the author's IP, and the soundtrack is large). The game is fully playable without them — the playfield is procedural, and the landing page / soundtrack **degrade gracefully** when the assets are absent (a CSS Western theme stands in for the hero art, and the game simply runs without music). Drop your own `assets/` in to re-skin it.

## 📄 License

Code is released under the [MIT License](LICENSE). See the LICENSE file for notes on the bundled Three.js and font.
