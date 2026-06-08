<div align="center">

[![Gunslingers Pinball Golf](docs/shots/landing.jpg)](https://princezoho.github.io/gunslingers-pinball-golf/)

# 🤠 Gunslingers Pinball Golf

**A 3D Wild-West _pinball + mini-golf_ hybrid — six-shooter chaos and high-desert putting, right in your browser.**

### [▶ &nbsp;Play the live demo](https://princezoho.github.io/gunslingers-pinball-golf/)

No installs, no sign-up. Runs on Three.js + a single JS file.

</div>

---

Putt the ball through pinball mayhem — flippers, bumpers, Dutch windmills, lasers, loop-de-loops, fire hoops and teleport portals — and mini-golf wackiness — ramps, jumps, funnels, multi-tier greens — across **20 hand-built holes**. Play against golf par (birdies, bogeys, hole-in-ones), chain **bumper combos**, save your **best score per hole**, and tally it on an end-of-round scorecard. Then **build your own courses** in a full **2D + 3D level editor**.

## 📸 Screenshots

|  |  |
|:--:|:--:|
| [![Bumper Barn](docs/shots/game-table.jpg)](https://princezoho.github.io/gunslingers-pinball-golf/) | [![Moon Craters](docs/shots/game-moon.jpg)](https://princezoho.github.io/gunslingers-pinball-golf/) |
| **Bumper Barn** — pinball-style obstacle holes | **Moon Craters** — low-gravity, night sky, crater turf |

[![Combos and shockwaves](docs/shots/game-combo.jpg)](https://princezoho.github.io/gunslingers-pinball-golf/)

> Chain bumper hits for an escalating **COMBO ×N**, with shockwaves, particle bursts, a Wild-West soundtrack and comic-book sound effects on every hit.

## ▶ Play it

The easiest way is the **[live demo](https://princezoho.github.io/gunslingers-pinball-golf/)**. To run it locally it's a static site — serve the folder over HTTP:

```bash
python3 -m http.server 8754
# then visit http://localhost:8754   (landing page → click PLAY)
# the game directly:  http://localhost:8754/game.html
```

(Opening via `file://` won't work because the font / asset loads need HTTP.)

## 🎮 Controls

**Aiming a shot** — drag on the table: left/right to aim, down for power, release to fire. A live trajectory preview shows the path, including bank shots off the walls.

**Flippers (while the ball rolls)** — tap the left/right half of the screen, or press `A`/`←` and `D`/`→`.

**Power-ups** — roll over them to grab: **Magnet** (pulls you to the cup, with a tractor-beam), **Shield** (a bubble that blocks the next hazard), **Slow-mo** (bullet-time through gates), **Gem** (bonus points), **Jump** (hop over walls).

**Sound & music** — tap the 🔊 speaker (bottom-right) for the audio panel: independent **Master / Music / SFX** sliders, mute, and a track-skip for the soundtrack. Everything defaults to **50%** (never full-blast).

Buttons (top-left in game): **Level Editor**, **Levels** (pick/skip any hole), **Skip**.

## 🛠 Level Editor

- **2D top-down editor** with a tool palette: walls (freehand draw, click-corners, or 2-click), bumpers, boosters, flippers, windmills, loops, drop-holes, **portals with up to 3 random exits**, fire hoops, enemies (patrol/chase, knockback/reset/stun), coins, power-ups, lasers, hills, funnels, ramps, tiers, and up/down terrain painting.
- **3D editor mode** (🧊): orbit the level in 3D and click items to select/drag them.
- Every item has live, editable stats (radius, bounce, speed, rotation, height, points, …).
- **7 terrain themes**, each with its own physics _and look_: Grass, Ice (slides), Moon (low-G), Mud, Rubber, Speedway, Sand.
- Per-level settings: gravity, friction, bounce, cup size, par, board size, tilt.
- **Test** your level instantly, then jump back to editing.
- **Save / Load / Export (JSON or download) / Import (paste or file)**. Saves persist in `localStorage` and survive reloads.
- Undo/redo, duplicate, delete, grid snap, collapsible panels, responsive layout.

## 🧱 Tech

Single-file engine in [`js/pingolf.js`](js/pingolf.js): a fixed-timestep 3D heightfield golf/pinball simulation, a `builder()` DSL for holes, a self-contained DOM/canvas editor, and a small Web-Audio mixer (master/music/SFX gains) driving a looping soundtrack. Rendering via [Three.js](https://threejs.org/) (`vendor/three.min.js`, MIT). `index.html` is the landing page, `game.html` hosts the engine.

## 🎨 Art & audio

The **Gunslingers** artwork, characters, backgrounds and Wild-West music are bundled in [`assets/`](assets) so the game looks and sounds the way it's meant to. **These assets are © 2026 princezoho, all rights reserved — included to play and view, not licensed for reuse.** Only the *code* is MIT (see below).

## 📄 License

**Code** is released under the [MIT License](LICENSE). The bundled **art & music are reserved** (see the LICENSE file), along with notes on Three.js and the display font.
