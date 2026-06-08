/* ============================================================================
   GUNSLINGERS PINBALL GOLF — v6.  Full 9-hole 3D pinball-minigolf.
   One engine, a library of obstacles (walls, bumpers, FAST flippers, speed-up
   boosters, windmills, lasers, spirals, multi-tier ramps, jumps, slopes, multiball),
   and 9 authored holes. Fast, juicy, addictive. Behind-the-ball camera; pull to
   power (power-curve = gentle putts to big drives), drag to angle, tap to flip.
   ============================================================================ */
(function () {
  'use strict';
  var T = window.THREE;
  var PG = (window.PG = {});
  var PI = Math.PI, TAU = PI * 2;

  /* ---------------- math ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function nearestOnSeg(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    var t = l2 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
    return { x: ax + dx * t, z: az + dz * t, t: t };
  }

  /* ---------------- tunables ---------------- */
  var K = {
    R: 15, hz: 360, g: 2200,
    rollFric: 1100, airDrag: 0.05, groundE: 0.32,
    wallE: 0.66, wallHalf: 9, settle: 26, settleT: 0.26, vMax: 6200,
    shotMin: 260, shotMax: 5200, pullPx: 240,     // power CURVE (squared) => gentle putts + big drives
    cupR: 44, holeSpd: 1500,
    // FAST flippers
    flipSweep: 1.45, flipUpSpd: 95, flipDnSpd: 28, flipHold: 0.05, flipKick: 2400, flipE: 0.5, flipHalf: 16, flipLiveOm: 6,
    bumpKick: 1750, boostSpeed: 3600, boostCd: 0.28
  };
  var KD = {}; (function () { for (var k in K) KD[k] = K[k]; })();   // pristine defaults
  var THEMES = {
    grass: { name: 'Grass (normal)', turf: 0x54ad44, sky: 0xc9a06a, g: 2200, rollFric: 1100, groundE: 0.32, wallE: 0.66, bumpKick: 1750, vMax: 6200 },
    ice: { name: 'Ice ❄ (slides)', turf: 0xbfe6f0, sky: 0xaccfe0, g: 2200, rollFric: 230, groundE: 0.45, wallE: 0.9, bumpKick: 1950, vMax: 7000 },
    moon: { name: 'Moon 🌙 (low-G)', turf: 0x9b94aa, sky: 0x2b2746, g: 780, rollFric: 600, groundE: 0.74, wallE: 0.84, bumpKick: 1650, vMax: 6200 },
    mud: { name: 'Mud 🟤 (sticky)', turf: 0x7a5a30, sky: 0x8f7848, g: 2200, rollFric: 2550, groundE: 0.12, wallE: 0.4, bumpKick: 1500, vMax: 6200 },
    rubber: { name: 'Rubber 🔴 (bouncy)', turf: 0xc0392b, sky: 0xb56550, g: 2200, rollFric: 950, groundE: 0.92, wallE: 0.97, bumpKick: 2150, vMax: 7000 },
    speed: { name: 'Speedway ⚡ (fast)', turf: 0xf0a830, sky: 0xdfa83e, g: 2200, rollFric: 470, groundE: 0.35, wallE: 0.7, bumpKick: 2050, vMax: 7400 },
    sand: { name: 'Sand 🏜 (drag)', turf: 0xd9c08a, sky: 0xe7c486, g: 2200, rollFric: 1900, groundE: 0.2, wallE: 0.5, bumpKick: 1600, vMax: 6000 }
  };
  var PHYS_KEYS = ['g', 'rollFric', 'groundE', 'wallE', 'cupR', 'shotMax', 'bumpKick', 'flipKick', 'vMax'];
  function applyPhys(phys) { PHYS_KEYS.forEach(function (k) { K[k] = (phys && phys[k] != null) ? phys[k] : KD[k]; }); }
  function themePhys(theme) { var t = THEMES[theme] || THEMES.grass, p = {}; PHYS_KEYS.forEach(function (k) { p[k] = t[k] != null ? t[k] : KD[k]; }); return p; }
  var COL = { gold: '#f5c542', cream: '#f5efdc', ink: '#191007', red: '#df3b32', grn: '#86d85f', blue: '#3aa0ff' };
  // POWER-UPS — beneficial pickups (roll over to grab). c/e = body+glow colour, ch = map glyph, dur = effect seconds (0 = instant)
  var PU = {
    magnet: { c: 0xff4477, e: 0x7a0a2a, ch: 'M', name: 'MAGNET', dur: 3.6, info: 'Pulls the ball toward the cup for a few seconds — grab it near the green and let it suck you in.' },
    shield: { c: 0x33b6ff, e: 0x0a4a7a, ch: 'S', name: 'SHIELD', dur: 0, info: 'Blocks the next hazard — one laser zap, enemy hit or stun just bounces off harmlessly.' },
    slow: { c: 0x9b6bff, e: 0x3a1a7a, ch: 'T', name: 'SLOW-MO', dur: 4.0, info: 'Bullet-time! Everything slows down so you can thread spinning windmills and laser gates.' },
    gem: { c: 0xff9a2a, e: 0x7a3a08, ch: '★', name: 'GEM', dur: 0, info: 'Instant jackpot — a big pile of bonus points the moment you grab it.' },
    jump: { c: 0x49d36a, e: 0x14702a, ch: '↑', name: 'JUMP', dur: 0, info: 'Pops the ball up into the air — hop clean over walls and hazards like a proper mini-golf jump.' }
  };
  var PU_KINDS = ['magnet', 'shield', 'slow', 'gem', 'jump'];
  var BUILD = 'BUILD 51 · COIN CHIME';

  /* ================================================================ HOLE BUILDER
     A tiny DSL: each hole function fills a builder with obstacles and returns it. */
  function builder() {
    var b = {
      walls: [], bumpers: [], boosters: [], flippers: [], windmills: [], lasers: [], loops: [], warps: [], portals: [], firerings: [], enemies: [], coins: [], powerups: [], spinners: [], multiball: null,
      terrainFeatures: [], noBox: false,
      wall: function (ax, az, bx, bz, o) { o = o || {}; this.walls.push({ ax: ax, az: az, bx: bx, bz: bz, e: o.e == null ? K.wallE : o.e, h: Math.min(o.h || 46, 240), c: o.c || 0x8a5a32 }); return this; },   // editor can raise height up to 240
      box: function (x0, z0, x1, z1, o) { this.wall(x0, z0, x1, z0, o); this.wall(x1, z0, x1, z1, o); this.wall(x1, z1, x0, z1, o); this.wall(x0, z1, x0, z0, o); return this; },
      ring: function (cx, cz, r, n, o, a0, a1) { a0 = a0 || 0; a1 = a1 == null ? TAU : a1; n = n || 22; var prev = null; for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n, p = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; if (prev) this.wall(prev.x, prev.z, p.x, p.z, o); prev = p; } return this; },
      spiral: function (cx, cz, r0, r1, turns, n, o) { var prevIn = null, prevOut = null, w = (r1 - r0) * 0.18 + 60; for (var i = 0; i <= n; i++) { var t = i / n, a = t * turns * TAU, r = lerp(r1, r0, t); var inn = { x: cx + Math.cos(a) * (r - w / 2), z: cz + Math.sin(a) * (r - w / 2) }, out = { x: cx + Math.cos(a) * (r + w / 2), z: cz + Math.sin(a) * (r + w / 2) }; if (prevIn) { this.wall(prevIn.x, prevIn.z, inn.x, inn.z, o); this.wall(prevOut.x, prevOut.z, out.x, out.z, o); } prevIn = inn; prevOut = out; } return this; },
      bumper: function (x, z, r) { this.bumpers.push({ x: x, z: z, r: r || 40, flash: 0 }); return this; },
      booster: function (x, z, ang, r, spd) { this.boosters.push({ x: x, z: z, dx: Math.cos(ang), dz: Math.sin(ang), r: r || 110, spd: spd || K.boostSpeed, flash: 0 }); return this; },
      flip: function (side, x, z, len, rot, speed) { var rest = (side === 'L' ? -0.5 : PI + 0.5) + (rot || 0); this.flippers.push({ side: side, px: x, pz: z, len: len || 150, rot: rot || 0, speed: speed || 1, ang: rest, om: 0, held: false, holdT: 0, live: false }); return this; },
      windmill: function (x, z, r, blades, speed) { this.windmills.push({ x: x, z: z, r: r || 200, n: blades || 4, speed: speed || 1.6, ang: 0, om: 0 }); return this; },
      loopde: function (x, z, r, ang) { this.loops.push({ x: x, z: z, r: r || 130, ang: ang == null ? PI / 2 : ang }); return this; },
      warp: function (x, z, ex, ez, r) { this.warps.push({ x: x, z: z, ex: ex == null ? x : ex, ez: ez == null ? z + 360 : ez, r: r || 50, flash: 0 }); return this; },
      portal: function (x, z, exits, r) { this.portals.push({ x: x, z: z, exits: (exits && exits.length) ? exits : [{ x: x + 320, z: z }], r: r || 46, flash: 0 }); return this; },
      firering: function (x, z, r, h, points, period) { this.firerings.push({ x: x, z: z, r: r || 120, h: h == null ? 170 : h, points: points == null ? 100 : points, period: period || 2.4, on: true, flash: 0, passedCd: 0, passed: false }); return this; },
      enemy: function (x, z, ex, ez, r, speed, type, behavior, effect) { this.enemies.push({ x: x, z: z, ex: ex == null ? x + 420 : ex, ez: ez == null ? z : ez, r: r || 42, speed: speed || 0.8, type: type || 'spiky', behavior: behavior || 'patrol', effect: effect || 'knockback', ph: 0, cx: x, cz: z, flash: 0 }); return this; },
      coin: function (x, z, value) { this.coins.push({ x: x, z: z, value: value || 1, got: false }); return this; },
      powerup: function (x, z, kind) { this.powerups.push({ x: x, z: z, kind: PU[kind] ? kind : 'magnet', got: false, flash: 0 }); return this; },
      laser: function (ax, az, bx, bz, period, onFrac, phase) { this.lasers.push({ ax: ax, az: az, bx: bx, bz: bz, period: period || 2.2, onFrac: onFrac == null ? 0.5 : onFrac, phase: phase || 0, on: false }); return this; },
      mball: function (x, z, r) { this.multiball = { x: x, z: z, r: r || 70, used: false }; return this; },
      // terrain feature: {kind:'hill'|'ramp'|'tier'|'slope'|'pit', ...}
      hill: function (x, z, rad, h) { this.terrainFeatures.push({ kind: 'hill', x: x, z: z, rad: rad, h: h }); return this; },
      ramp: function (z0, z1, h, halfW, lip) { this.terrainFeatures.push({ kind: 'ramp', z0: z0, z1: z1, h: h, halfW: halfW || 9999, lip: lip || 40 }); return this; },
      tier: function (z0, h, halfW) { this.terrainFeatures.push({ kind: 'tier', z0: z0, h: h, halfW: halfW || 9999 }); return this; },
      slope: function (perX, perZ) { this.terrainFeatures.push({ kind: 'slope', perX: perX || 0, perZ: perZ || 0 }); return this; },
      funnel: function (x, z, rad, depth) { this.terrainFeatures.push({ kind: 'funnel', x: x, z: z, rad: rad, depth: depth }); return this; }
    };
    return b;
  }
  function gauss(d, w) { var x = d / w; return Math.exp(-x * x); }
  function terrainFn(features) {
    return function (x, z) {
      var h = 0;
      for (var i = 0; i < features.length; i++) {
        var f = features[i];
        if (f.kind === 'hill') h += f.h * gauss(hyp(x - f.x, z - f.z), f.rad);
        else if (f.kind === 'ramp') { var up = clamp((z - f.z0) / (f.z1 - f.z0), 0, 1), drop = clamp((z - f.z1) / f.lip, 0, 1); h += f.h * (up - drop) * clamp(1 - Math.abs(x) / f.halfW, 0, 1); }
        else if (f.kind === 'tier') { if (z > f.z0 && Math.abs(x) < f.halfW) h += f.h * clamp((z - f.z0) / 60, 0, 1); }
        else if (f.kind === 'slope') h += x * f.perX + z * f.perZ;
        else if (f.kind === 'funnel') { var dd = hyp(x - f.x, z - f.z); if (dd < f.rad) { var u = 1 - dd / f.rad; h -= f.depth * u * u; } }
      }
      return h;
    };
  }

  /* ================================================================ THE 9 HOLES */
  // every hole gets a bottom flipper V near the tee (where the ball drains back to you, like a real pinball table)
  function botFlip(b, tz, sp) { sp = sp || 165; b.flip('L', -sp, tz + 160, 150).flip('R', sp, tz + 160, 150); return b; }
  function H1() { // GREENHORN GULCH — learn it: slingshots, a bumper cluster, a speed pad
    var b = builder().box(-410, -40, 410, 1660, { h: 52 });
    botFlip(b, 110);
    b.bumper(-250, 520, 38).bumper(250, 560, 38);            // slingshots off the flippers
    b.bumper(0, 840, 50).bumper(-175, 1090, 44).bumper(175, 1130, 44);
    b.booster(0, 1300, PI / 2, 130, 2800);
    return finish(b, 'GREENHORN GULCH', 3, { x: 0, z: 110 }, { x: 0, z: 1520 }, -470, 470, -60, 1680);
  }
  function H2() { // BUMPER BARN — a dense pinball field you ricochet through
    var b = builder().box(-470, -40, 470, 1980, { h: 52 });
    botFlip(b, 120, 180);
    b.bumper(-300, 560, 40).bumper(300, 560, 40);            // slingshots
    var rows = [[3, 820], [2, 1030], [3, 1250], [2, 1480]];
    rows.forEach(function (r, ri) { var n = r[0], z = r[1]; for (var i = 0; i < n; i++) { var x = (i - (n - 1) / 2) * 235; b.bumper(x + (ri % 2 ? 64 : -64), z, 46); } });
    b.booster(0, 1700, PI / 2, 130, 2900);
    b.powerup(0, 700, 'shield');                            // tank the bumper chaos
    return finish(b, 'BUMPER BARN', 4, { x: 0, z: 120 }, { x: 0, z: 1830 }, -530, 530, -60, 2000);
  }
  function H3() { // SLOPE SALOON — banked S-curve, gravity curls your roll
    var b = builder().box(-490, -40, 490, 1920, { h: 52 });
    botFlip(b, 130);
    b.hill(290, 720, 360, 160).hill(-290, 1240, 360, 160);  // two banks form an S
    b.bumper(0, 980, 48).bumper(-150, 560, 38).bumper(170, 1360, 40);
    b.booster(-260, 360, PI / 2, 130, 2800);
    return finish(b, 'SLOPE SALOON', 3, { x: -290, z: 130 }, { x: 290, z: 1780 }, -550, 550, -60, 1940);
  }
  function H4() { // THE BIG JUMP — blast up the ramp and fly to the green
    var b = builder().box(-390, -40, 390, 2120, { h: 52 });
    botFlip(b, 120);
    b.bumper(-250, 560, 40).bumper(250, 600, 40);
    b.booster(0, 560, PI / 2, 150, 3700);                   // speed into the ramp
    b.ramp(780, 1060, 155, 330, 52);                        // launch ramp + lip
    b.bumper(-210, 1560, 44).bumper(210, 1600, 44).bumper(0, 1700, 46);
    b.powerup(-150, 480, 'jump');                           // hop before the launch ramp
    return finish(b, 'THE BIG JUMP', 3, { x: 0, z: 120 }, { x: 0, z: 1990 }, -450, 450, -60, 2140);
  }
  function H5() { // WINDMILL RUN — time the spinning blades, then finish past the bumpers
    var b = builder().box(-410, -40, 410, 2020, { h: 52 });
    botFlip(b, 120);
    b.bumper(-300, 600, 40).bumper(300, 640, 40);
    b.windmill(0, 1080, 250, 4, 1.9);
    b.bumper(-300, 1480, 40).bumper(300, 1520, 40);
    b.booster(0, 360, PI / 2, 130, 3000);
    return finish(b, 'WINDMILL RUN', 4, { x: 0, z: 120 }, { x: 0, z: 1860 }, -470, 470, -60, 2040);
  }
  function H6() { // SPIRAL FUNNEL — run into a round arena; the funnel curls the ball to the centre cup
    var b = builder();
    b.wall(-220, -40, -220, 440, { h: 52 }).wall(220, -40, 220, 440, { h: 52 }).wall(-220, -40, 220, -40, { h: 52 });
    b.bumper(-150, 300, 36).bumper(150, 320, 36);
    b.ring(0, 1120, 720, 46, { h: 52 }, -PI / 2 + 0.28, -PI / 2 + TAU - 0.28);   // arena with a front opening
    b.funnel(0, 1120, 680, 250);                            // funnel toward the centre cup
    b.bumper(-370, 1120, 46).bumper(370, 1120, 46).bumper(0, 1520, 46).bumper(-200, 820, 40).bumper(200, 860, 40);
    b.booster(0, 250, PI / 2, 150, 3500);
    b.powerup(0, 700, 'magnet');                            // help curl into the centre cup
    return finish(b, 'SPIRAL FUNNEL', 4, { x: 0, z: 120 }, { x: 0, z: 1120 }, -800, 800, -60, 1920);
  }
  function H7() { // LASER GAUNTLET — time your run through the beams
    var b = builder().box(-390, -40, 390, 2120, { h: 52 });
    botFlip(b, 120);
    b.bumper(-280, 560, 40).bumper(280, 600, 40);
    b.laser(-390, 900, 390, 900, 2.4, 0.4, 0.0);
    b.laser(-390, 1400, 390, 1400, 2.4, 0.4, 1.2);
    b.bumper(-250, 1740, 42).bumper(250, 1780, 42);
    b.booster(0, 640, PI / 2, 140, 3400);
    b.powerup(0, 760, 'shield');                            // block one laser zap
    return finish(b, 'LASER GAUNTLET', 4, { x: 0, z: 120 }, { x: 0, z: 1990 }, -450, 450, -60, 2140);
  }
  function H8() { // HIGHRISE — blast up two ramps to a top-tier green
    var b = builder().box(-390, -40, 390, 2270, { h: 52 });
    botFlip(b, 120);
    b.bumper(-260, 540, 40).bumper(260, 580, 40);
    b.ramp(620, 900, 130, 9999, 999999);                    // climb to tier 1 (plateau)
    b.bumper(-190, 1110, 42).bumper(190, 1150, 42);
    b.ramp(1340, 1620, 150, 9999, 999999);                  // climb to tier 2
    b.booster(0, 460, PI / 2, 150, 4200).booster(0, 1190, PI / 2, 150, 4400);
    return finish(b, 'HIGHRISE', 4, { x: 0, z: 120 }, { x: 0, z: 2180 }, -450, 450, -60, 2290);
  }
  function H9() { // THE GAUNTLET — twin windmills, a laser, dense bumpers: the finale
    var b = builder().box(-510, -40, 510, 2320, { h: 52 });
    botFlip(b, 120, 185);
    b.bumper(-330, 560, 40).bumper(330, 560, 40).bumper(0, 620, 46);
    b.windmill(-250, 1120, 190, 3, 2.0).windmill(250, 1270, 190, 3, -2.0);
    b.bumper(0, 850, 48).bumper(-360, 940, 40).bumper(360, 990, 40);
    b.laser(-510, 1640, 510, 1640, 1.8, 0.42, 0.0);
    b.bumper(-210, 1870, 42).bumper(210, 1900, 42);
    b.booster(-290, 360, PI / 2, 120, 3300).booster(290, 390, PI / 2, 120, 3300);
    b.powerup(0, 700, 'slow');                              // bullet-time the gauntlet
    return finish(b, 'THE GAUNTLET', 5, { x: 0, z: 120 }, { x: 0, z: 2190 }, -570, 570, -60, 2340);
  }
  // give a hole a terrain theme (turf colour + physics); ov overrides individual phys keys for beatability
  function themed(b, t, ov) { b.theme = t; b.turf = (THEMES[t] || THEMES.grass).turf; b.phys = themePhys(t); if (ov) for (var k in ov) b.phys[k] = ov[k]; return b; }

  function H10() { // FROZEN POND — ICE: everything slides; the funnel catches your slippery roll
    var b = builder().box(-440, -40, 440, 2060, { h: 56 });
    themed(b, 'ice', { rollFric: 430 });                    // slick, but tamed just enough to settle
    botFlip(b, 120);
    b.bumper(-300, 560, 40).bumper(300, 600, 40).bumper(-180, 980, 44).bumper(180, 1040, 44);
    b.coin(-90, 820, 1).coin(90, 880, 1).coin(0, 1240, 2);
    b.bumper(-330, 1560, 42).bumper(330, 1600, 42);
    b.funnel(0, 1780, 380, 210);                            // ice-rink catcher around the cup
    b.booster(0, 320, PI / 2, 130, 2600);
    return finish(b, 'FROZEN POND', 4, { x: 0, z: 120 }, { x: 0, z: 1780 }, -500, 500, -60, 2080);
  }
  function H11() { // MOON CRATERS — low-G floaty bounces; boost up the ramp and leap the fire hoop
    var b = builder().box(-430, -40, 430, 2180, { h: 56 });
    themed(b, 'moon');
    botFlip(b, 120);
    b.bumper(-280, 560, 40).bumper(280, 600, 40);
    b.booster(0, 700, PI / 2, 150, 3600);
    b.ramp(820, 1020, 120, 360, 48);                        // launch pad
    b.firering(0, 1080, 150, 175, 150, 2.6);                // soar through for a bonus
    b.coin(-120, 820, 1).coin(120, 820, 1).coin(0, 1320, 2);
    b.bumper(-300, 1520, 44).bumper(300, 1560, 44);
    b.funnel(0, 2020, 320, 180);
    b.powerup(180, 1300, 'gem');                            // low-G loot
    return finish(b, 'MOON CRATERS', 4, { x: 0, z: 120 }, { x: 0, z: 2020 }, -490, 490, -60, 2200);
  }
  function H12() { // GHOST TOWN PORTALS — step into the portal, get spat out one of THREE random ways
    var b = builder().box(-470, -40, 470, 2160, { h: 56 });
    botFlip(b, 120);
    b.bumper(-300, 560, 40).bumper(300, 600, 40);
    b.portal(0, 980, [{ x: -300, z: 1500 }, { x: 0, z: 1560 }, { x: 300, z: 1500 }], 56);   // 3-exit random teleport
    b.coin(-90, 760, 1).coin(90, 760, 1).coin(0, 1300, 2);
    b.bumper(-380, 1760, 40).bumper(380, 1760, 40);     // pushed to the rails — cup lane stays open
    b.funnel(0, 2000, 380, 210);
    b.booster(0, 320, PI / 2, 130, 3000);
    return finish(b, 'GHOST TOWN PORTALS', 4, { x: 0, z: 120 }, { x: 0, z: 2000 }, -530, 530, -60, 2180);
  }
  function H13() { // LOOP-DE-LOOP CITY — Sonic-style loops and speed boosters down the strip
    var b = builder().box(-410, -40, 410, 2180, { h: 56 });
    botFlip(b, 120);
    b.booster(0, 320, PI / 2, 140, 4000);
    b.loopde(0, 720, 150);
    b.bumper(-300, 980, 40).bumper(300, 1020, 40);
    b.booster(0, 1180, PI / 2, 140, 4200);
    b.loopde(0, 1520, 150);
    b.coin(0, 560, 1).coin(0, 900, 1).coin(0, 1360, 2);
    b.bumper(-250, 1840, 44).bumper(250, 1880, 44);
    b.funnel(0, 2030, 300, 170);
    b.powerup(150, 1700, 'gem');                            // bonus past the loops
    return finish(b, 'LOOP-DE-LOOP CITY', 4, { x: 0, z: 120 }, { x: 0, z: 2030 }, -470, 470, -60, 2200);
  }
  function H14() { // DUTCH WINDMILL ROW — time three turning gates, each spinning a different way
    var b = builder().box(-380, -40, 380, 2280, { h: 60 });
    botFlip(b, 120);
    b.bumper(-260, 540, 38).bumper(260, 580, 38);
    b.powerup(0, 700, 'slow');                              // bullet-time to thread the gates
    b.windmill(0, 900, 230, 3, 1.7);
    b.windmill(0, 1380, 230, 3, -2.1);
    b.windmill(0, 1860, 230, 3, 2.5);
    b.coin(-150, 720, 1).coin(150, 1140, 1).coin(-150, 1620, 1);
    b.booster(0, 320, PI / 2, 130, 3200);
    return finish(b, 'DUTCH WINDMILL ROW', 5, { x: 0, z: 120 }, { x: 0, z: 2140 }, -440, 440, -60, 2300);
  }
  function H15() { // VARMINT VALLEY — dodge the critters patrolling (and one that chases) the fairway
    var b = builder().box(-470, -40, 470, 2180, { h: 56 });
    botFlip(b, 120);
    b.bumper(-320, 540, 38).bumper(320, 580, 38);
    b.powerup(0, 700, 'shield');                            // tank one varmint hit
    b.enemy(-300, 880, 300, 880, 44, 1.1, 'spiky', 'patrol', 'knockback');
    b.enemy(300, 1240, -300, 1240, 44, 0.9, 'ghost', 'patrol', 'knockback');
    b.enemy(0, 1560, 60, 1560, 40, 0.7, 'blob', 'chase', 'knockback');     // a slow chaser
    b.coin(-150, 720, 1).coin(150, 1060, 1).coin(0, 1420, 2);
    b.booster(0, 320, PI / 2, 130, 3000);
    b.funnel(0, 2020, 320, 180);
    return finish(b, 'VARMINT VALLEY', 5, { x: 0, z: 120 }, { x: 0, z: 2020 }, -530, 530, -60, 2200);
  }
  function H16() { // COIN RUSH — speedway turf; grab the loot trail and ride the jump
    var b = builder().box(-420, -40, 420, 2220, { h: 56 });
    themed(b, 'speed');
    botFlip(b, 120);
    b.coin(-80, 520, 1).coin(80, 520, 1).coin(-80, 700, 1).coin(80, 700, 1).coin(0, 940, 2);
    b.coin(-150, 1140, 1).coin(150, 1140, 1);
    b.ramp(1240, 1480, 140, 9999, 999999);                  // jump to the upper green
    b.coin(0, 1340, 2).coin(-120, 1700, 1).coin(120, 1700, 1).coin(0, 1880, 3);
    b.bumper(-300, 1640, 42).bumper(300, 1680, 42);
    b.funnel(0, 2020, 320, 190);
    b.booster(0, 320, PI / 2, 130, 3400);
    b.powerup(0, 1560, 'gem');                              // the big one
    return finish(b, 'COIN RUSH', 4, { x: 0, z: 120 }, { x: 0, z: 2020 }, -480, 480, -60, 2240);
  }
  function H17() { // FIRE LEAP CANYON — boost up the ramp and soar through the ring of fire
    var b = builder().box(-400, -40, 400, 2260, { h: 56 });
    botFlip(b, 120);
    b.bumper(-260, 540, 38).bumper(260, 580, 38);
    b.coin(-140, 660, 1).coin(140, 660, 1);
    b.booster(0, 760, PI / 2, 150, 4400);
    b.ramp(900, 1140, 165, 340, 54);                        // launch
    b.firering(0, 1240, 150, 200, 200, 2.2);                // big-points fire hoop
    b.coin(0, 1560, 2);
    b.bumper(-280, 1740, 42).bumper(280, 1780, 42);
    b.funnel(0, 2060, 300, 180);
    b.powerup(-160, 640, 'jump');                           // optional early hop
    return finish(b, 'FIRE LEAP CANYON', 4, { x: 0, z: 120 }, { x: 0, z: 2060 }, -460, 460, -60, 2280);
  }
  function H18() { // DOUBLE DECKER — climb to the upper deck, dive the drop-hole down to the green
    var b = builder().box(-440, -40, 440, 2180, { h: 56 });
    botFlip(b, 120);
    b.tier(720, 120, 9999);                                 // raised back half: the upper deck
    b.bumper(-300, 520, 40).bumper(300, 560, 40);
    b.ramp(560, 760, 120, 9999, 999999);                    // ramp up onto the deck
    b.warp(0, 1180, 0, 1700, 56);                           // drop-hole express to the green
    b.coin(-120, 940, 1).coin(120, 940, 1).coin(0, 1500, 2);
    b.bumper(-280, 1640, 42).bumper(280, 1680, 42);
    b.funnel(0, 1860, 320, 200);
    b.booster(0, 320, PI / 2, 130, 3000);
    b.powerup(0, 1400, 'magnet');                           // reel into the lower green
    return finish(b, 'DOUBLE DECKER', 5, { x: 0, z: 120 }, { x: 0, z: 1860 }, -500, 500, -60, 2200);
  }
  function H19() { // RUBBER ROOM — everything is springy; ricochet your way into the catcher
    var b = builder().box(-440, -40, 440, 2040, { h: 64 });
    themed(b, 'rubber', { groundE: 0.6, wallE: 0.7, bumpKick: 1700 }); // bouncy floor, tamed walls so it can finish
    botFlip(b, 120);
    b.bumper(-320, 620, 44).bumper(320, 660, 44);           // slingshots out to the sides
    b.bumper(-230, 1040, 46).bumper(230, 1080, 46);         // a middle pair — the lane stays open between
    b.bumper(-330, 1380, 44).bumper(330, 1420, 44);
    b.coin(0, 540, 1).coin(0, 880, 1).coin(0, 1220, 1);
    b.funnel(0, 1760, 400, 240);                            // big catcher
    b.booster(0, 300, PI / 2, 120, 2400);
    return finish(b, 'RUBBER ROOM', 5, { x: 0, z: 120 }, { x: 0, z: 1760 }, -500, 500, -60, 2060);
  }
  function H20() { // THE LAST STAND — the whole arsenal: loop, windmill, fire, portal, varmint, drop-hole
    var b = builder().box(-490, -40, 490, 2820, { h: 60 });
    botFlip(b, 130, 185);
    b.bumper(-340, 560, 40).bumper(340, 600, 40);
    b.booster(0, 340, PI / 2, 140, 3600);
    b.loopde(0, 820, 150);
    b.windmill(0, 1180, 250, 3, 2.0);
    b.booster(0, 1360, PI / 2, 150, 4200);
    b.ramp(1380, 1580, 150, 360, 54);                       // launch through the fire
    b.firering(0, 1660, 150, 195, 250, 2.2);
    b.portal(0, 1980, [{ x: -320, z: 2300 }, { x: 0, z: 2340 }, { x: 320, z: 2300 }], 56);
    b.warp(0, 2160, 0, 2540, 50);                           // shortcut drop-hole
    b.enemy(-330, 2420, 330, 2420, 44, 1.0, 'spiky', 'patrol', 'knockback');
    b.powerup(0, 1000, 'gem');                              // jackpot mid-run
    b.powerup(0, 2240, 'magnet');                           // suck into the final cup
    b.coin(0, 660, 1).coin(0, 1760, 2).coin(0, 2420, 3);
    b.bumper(-340, 2560, 42).bumper(340, 2600, 42);
    b.funnel(0, 2680, 360, 210);
    return finish(b, 'THE LAST STAND', 6, { x: 0, z: 130 }, { x: 0, z: 2680 }, -550, 550, -60, 2840);
  }
  function finish(b, name, par, tee, cup, minX, maxX, minZ, maxZ) {
    b.name = name; b.par = par; b.tee = tee; b.cup = cup;
    b.terrain = terrainFn(b.terrainFeatures);
    b.bounds = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
    return b;
  }
  var HOLES = [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12, H13, H14, H15, H16, H17, H18, H19, H20];

  /* ================================================================ STATE */
  var St = {
    hole: null, hi: 0, balls: [], state: 'load', strokes: 0, scores: [], total: 0,
    aimYaw: 0, camYaw: 0, camOrbit: 0, holeYaw: 0, power: 0.5, drag: null, t: 0,
    fx: [], pops: [], trail: [], shake: 0, banner: '', bannerT: 0, last: 0, acc: 0, w: 0, h: 0, dpr: 1
  };
  function newBall(x, z, prime) { return { x: x, y: 0, z: z, vx: 0, vy: 0, vz: 0, air: false, stillT: 0, sunk: false, dead: false, prime: !!prime, loop: null, loopCd: 0, warpCd: 0, portalCd: 0, shield: false, hzCd: 0 }; }
  function primeBall() { for (var i = 0; i < St.balls.length; i++) if (St.balls[i].prime && !St.balls[i].dead) return St.balls[i]; return St.balls[0]; }

  /* ================================================================ THREE */
  var R3 = { ready: false };
  function initGL(canvas) {
    if (!T) return false;
    try {
      R3.r = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
      R3.r.setPixelRatio(Math.min(1.6, window.devicePixelRatio || 1));
      if (T.sRGBEncoding) R3.r.outputEncoding = T.sRGBEncoding;
      if (T.ACESFilmicToneMapping) { R3.r.toneMapping = T.ACESFilmicToneMapping; R3.r.toneMappingExposure = 1.05; }
      R3.r.shadowMap.enabled = true; R3.r.shadowMap.type = T.PCFSoftShadowMap || T.PCFShadowMap;
      R3.scene = new T.Scene(); R3.scene.fog = new T.Fog(0xc9a06a, 2400, 6500);
      R3.cam = new T.PerspectiveCamera(58, 1, 1, 14000);
      R3.scene.add(new T.AmbientLight(0xffe6c4, 0.55));
      R3.scene.add(new T.HemisphereLight(0xffe0aa, 0x40301a, 0.5));
      var sun = new T.DirectionalLight(0xffe1b0, 2.0); sun.position.set(-700, 1400, -300); sun.castShadow = true;
      sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
      var sc = sun.shadow.camera; sc.near = 100; sc.far = 4200; sc.left = -1400; sc.right = 1400; sc.top = 1400; sc.bottom = -1400;
      sun.shadow.bias = -0.0005; if ('normalBias' in sun.shadow) sun.shadow.normalBias = 2;
      R3.scene.add(sun.target); R3.scene.add(sun); R3.sun = sun; R3.sunOff = { x: -600, y: 1300, z: -400 };
      R3.zoom = 1; R3.ready = true; return true;
    } catch (e) { R3.ready = false; return false; }
  }
  function tex(key, w, h, paint, rep) { if (R3['_' + key]) return R3['_' + key]; var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d')); var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); if (T.sRGBEncoding) t.encoding = T.sRGBEncoding; R3['_' + key] = t; return t; }
  function turfTex() { return tex('turf', 256, 256, function (x) { x.fillStyle = '#54ad44'; x.fillRect(0, 0, 256, 256); for (var i = 0; i < 256; i += 26) { x.fillStyle = (i / 26) % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,40,0,.06)'; x.fillRect(i, 0, 13, 256); } for (var k = 0; k < 4200; k++) { var g = (k * 53) % 46; x.fillStyle = 'rgba(' + (50 + g) + ',' + (150 + g) + ',' + (50 + (g >> 1)) + ',.3)'; x.fillRect((k * 97) % 256, (k * 181) % 256, 1, 2); } }, [10, 30]); }
  function ballTex() { return tex('ball', 64, 64, function (x) { x.fillStyle = '#f7f3ea'; x.fillRect(0, 0, 64, 64); x.fillStyle = 'rgba(150,150,160,.4)'; for (var i = 6; i < 64; i += 11) for (var j = (i / 11 % 2 ? 11 : 5); j < 64; j += 11) { x.beginPath(); x.arc(j, i, 2.1, 0, 7); x.fill(); } x.fillStyle = '#c0202a'; x.beginPath(); x.arc(42, 30, 6, 0, 7); x.fill(); }); }

  /* ---------------- build scene from a hole ---------------- */
  function flipperShape(L) { var r0 = 16, r1 = 7, sh = new T.Shape(), phi = Math.asin((r0 - r1) / L); sh.absarc(0, 0, r0, PI / 2 + phi, 1.5 * PI - phi, false); sh.absarc(L, 0, r1, -PI / 2 - phi, PI / 2 + phi, false); return sh; }
  function buildScene(hole) {
    if (!R3.ready) return;
    St.shocks = [];
    if (R3.group) R3.scene.remove(R3.group);
    R3.group = new T.Group(); R3.scene.add(R3.group);
    var skyC = (THEMES[hole.theme] || THEMES.grass).sky || 0xc9a06a;   // theme-specific sky + fog (e.g. dark night for Moon)
    R3.scene.background = new T.Color(skyC); if (R3.scene.fog) R3.scene.fog.color.setHex(skyC);
    var bn = hole.bounds, midZ = (bn.minZ + bn.maxZ) / 2, spanX = bn.maxX - bn.minX + 600, spanZ = bn.maxZ - bn.minZ + 600;
    // terrain mesh
    var segX = 70, segZ = Math.round(spanZ / 30), geo = new T.PlaneGeometry(spanX, spanZ, segX, segZ);
    geo.rotateX(-PI / 2); geo.translate((bn.minX + bn.maxX) / 2, 0, midZ);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) pos.setY(i, hole.terrain(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    var turfMat = (hole.theme && hole.theme !== 'grass' && hole.turf) ? new T.MeshStandardMaterial({ color: hole.turf, roughness: hole.theme === 'ice' ? .35 : 1, metalness: hole.theme === 'ice' ? .2 : 0 }) : new T.MeshStandardMaterial({ map: turfTex(), roughness: 1 });
    var turf = new T.Mesh(geo, turfMat); turf.receiveShadow = true; R3.group.add(turf); R3.turf = turf;
    // skirt
    var skirt = new T.Mesh(new T.PlaneGeometry(24000, 24000), new T.MeshStandardMaterial({ color: new T.Color(skyC).multiplyScalar(0.6), roughness: 1 })); skirt.rotation.x = -PI / 2; skirt.position.set(0, -320, midZ); skirt.receiveShadow = true; R3.group.add(skirt);
    // MOON CRATERS — flat decorative craters scattered on the pale lunar ground (purely visual, no collision; deterministic so they don't jitter on editor rebuilds)
    if (hole.theme === 'moon') {
      var prnd = function (n) { var x = Math.sin(n * 127.1 + 0.7) * 43758.5453; return x - Math.floor(x); };
      var cFloorMat = new T.MeshStandardMaterial({ color: 0x5e5775, roughness: 1 }), cRimMat = new T.MeshStandardMaterial({ color: 0x423d54, roughness: 1 });
      for (var ci = 0; ci < 12; ci++) {
        var ccx = bn.minX + 50 + prnd(ci * 3) * (bn.maxX - bn.minX - 100), ccz = bn.minZ + 50 + prnd(ci * 3 + 1) * (bn.maxZ - bn.minZ - 100), ccr = 38 + prnd(ci * 3 + 2) * 92, cgy = hole.terrain(ccx, ccz);
        var cRim = new T.Mesh(new T.RingGeometry(ccr, ccr * 1.13, 26), cRimMat); cRim.rotation.x = -PI / 2; cRim.position.set(ccx, cgy + 1.0, ccz); R3.group.add(cRim);
        var cFloor = new T.Mesh(new T.CircleGeometry(ccr, 22), cFloorMat); cFloor.rotation.x = -PI / 2; cFloor.position.set(ccx, cgy + 1.4, ccz); cFloor.receiveShadow = true; R3.group.add(cFloor);
      }
    }
    // SPEEDWAY chevrons — racing arrows on the ground pointing tee->cup (flat decals, no collision; explicit world verts avoid rotation confusion)
    if (hole.theme === 'speed') {
      var stee = hole.tee, scup = hole.cup, sdx = scup.x - stee.x, sdz = scup.z - stee.z, sdl = Math.sqrt(sdx * sdx + sdz * sdz) || 1; sdx /= sdl; sdz /= sdl;
      var spx = -sdz, spz = sdx, chMat = new T.MeshBasicMaterial({ color: 0x4a2f12, transparent: true, opacity: 0.62, side: T.DoubleSide, depthWrite: false }), nCh = 7, chL = 130, chW = 46;
      for (var chi = 0; chi < nCh; chi++) {
        var f = (chi + 1) / (nCh + 1), bx = stee.x + (scup.x - stee.x) * f, bz = stee.z + (scup.z - stee.z) * f, sgy = hole.terrain(bx, bz) + 2;
        var tx = bx + sdx * chL * 0.5, tz = bz + sdz * chL * 0.5, b1x = bx - sdx * chL * 0.5 + spx * chW, b1z = bz - sdz * chL * 0.5 + spz * chW, b2x = bx - sdx * chL * 0.5 - spx * chW, b2z = bz - sdz * chL * 0.5 - spz * chW;
        var cg = new T.BufferGeometry(); cg.setAttribute('position', new T.BufferAttribute(new Float32Array([tx, sgy, tz, b1x, sgy, b1z, b2x, sgy, b2z]), 3)); cg.setIndex([0, 1, 2]); cg.computeVertexNormals();
        R3.group.add(new T.Mesh(cg, chMat));
      }
    }
    // ICE — dark "shattered" crack-stars on the pale-blue turf (thin tapered slivers radiating from a few points; flat decals, no collision)
    if (hole.theme === 'ice') {
      var iprnd = function (n) { var x = Math.sin(n * 91.7 + 2.3) * 43758.5453; return x - Math.floor(x); };
      var crackMat = new T.MeshBasicMaterial({ color: 0x244150, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false });
      for (var ist = 0; ist < 4; ist++) {
        var icx = bn.minX + 90 + iprnd(ist * 5) * (bn.maxX - bn.minX - 180), icz = bn.minZ + 90 + iprnd(ist * 5 + 1) * (bn.maxZ - bn.minZ - 180), igy = hole.terrain(icx, icz) + 2, irays = 3 + Math.floor(iprnd(ist * 5 + 2) * 3);
        for (var ir = 0; ir < irays; ir++) {
          var iang = ir / irays * TAU + iprnd(ist * 5 + 3 + ir) * 0.7, ilen = 70 + iprnd(ist * 7 + ir) * 130, idx = Math.sin(iang), idz = Math.cos(iang), ipx = -idz, ipz = idx;
          var icg = new T.BufferGeometry(); icg.setAttribute('position', new T.BufferAttribute(new Float32Array([icx + idx * ilen, igy, icz + idz * ilen, icx + ipx * 5, igy, icz + ipz * 5, icx - ipx * 5, igy, icz - ipz * 5]), 3)); icg.setIndex([0, 1, 2]); icg.computeVertexNormals();
          R3.group.add(new T.Mesh(icg, crackMat));
        }
      }
    }
    // RUBBER — concentric "bounce ripple" rings on the springy turf (flat decals, no collision)
    if (hole.theme === 'rubber') {
      var rprnd = function (n) { var x = Math.sin(n * 73.3 + 1.1) * 43758.5453; return x - Math.floor(x); };
      var ringMat = new T.MeshBasicMaterial({ color: 0x6e2018, transparent: true, opacity: 0.42, side: T.DoubleSide, depthWrite: false });
      for (var rp = 0; rp < 5; rp++) {
        var rcx = bn.minX + 80 + rprnd(rp * 4) * (bn.maxX - bn.minX - 160), rcz = bn.minZ + 80 + rprnd(rp * 4 + 1) * (bn.maxZ - bn.minZ - 160), rgy = hole.terrain(rcx, rcz) + 2, nr = 2 + Math.floor(rprnd(rp * 4 + 2) * 2);
        for (var ri = 0; ri < nr; ri++) {
          var rad = 26 + ri * 25 + rprnd(rp * 4 + 3) * 8, rg = new T.Mesh(new T.RingGeometry(rad, rad + 7, 28), ringMat); rg.rotation.x = -PI / 2; rg.position.set(rcx, rgy, rcz); R3.group.add(rg);
        }
      }
    }
    // walls
    var wm = new T.MeshStandardMaterial({ color: 0x8a5a32, roughness: .8 }), capm = new T.MeshStandardMaterial({ color: 0xe6b878, roughness: .55 });
    hole.walls.forEach(function (s) { var dx = s.bx - s.ax, dz = s.bz - s.az, L = hyp(dx, dz); if (L < 1) return; var g = new T.Group(); var gy = hole.terrain((s.ax + s.bx) / 2, (s.az + s.bz) / 2); var body = new T.Mesh(new T.BoxGeometry(L + 14, s.h, 22), new T.MeshStandardMaterial({ color: s.c, roughness: .8 })); body.position.y = s.h / 2; body.castShadow = body.receiveShadow = true; g.add(body); var cap = new T.Mesh(new T.BoxGeometry(L + 14, 8, 26), capm); cap.position.y = s.h; g.add(cap); g.position.set((s.ax + s.bx) / 2, gy, (s.az + s.bz) / 2); g.rotation.y = -Math.atan2(dz, dx); R3.group.add(g); });
    // bumpers (solid grounded barrels)
    var woodMat = new T.MeshStandardMaterial({ color: 0x8a5a2e, roughness: .82 }), hoopMat = new T.MeshStandardMaterial({ color: 0x35210f, roughness: .55, metalness: .3 }), topMat = new T.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x9a6a10, emissiveIntensity: .5, roughness: .4 });
    hole.bumpers.forEach(function (bm) { var gy = hole.terrain(bm.x, bm.z), g = new T.Group(), bh = bm.r * 1.5; var cs = new T.Mesh(new T.CircleGeometry(bm.r * 1.3, 20), new T.MeshBasicMaterial({ color: 0x07040a, transparent: true, opacity: .42 })); cs.rotation.x = -PI / 2; cs.position.set(bm.x, gy + 1.2, bm.z); R3.group.add(cs); var body = new T.Mesh(new T.CylinderGeometry(bm.r * .9, bm.r, bh, 20), woodMat); body.position.y = bh / 2; body.castShadow = true; g.add(body);[0.28, 0.72].forEach(function (f) { var hp = new T.Mesh(new T.CylinderGeometry(bm.r * .96, bm.r * .96, 7, 20), hoopMat); hp.position.y = bh * f; g.add(hp); }); var litMat = new T.MeshStandardMaterial({ color: 0xf5c542, emissive: 0xffcc33, emissiveIntensity: 0, roughness: .5 }); var cap = new T.Mesh(new T.CylinderGeometry(bm.r * .82, bm.r * .9, 10, 20), litMat); cap.position.y = bh + 3; cap.castShadow = true; g.add(cap); bm.litMat = litMat; var glow = new T.Mesh(new T.CylinderGeometry(bm.r * .96, bm.r * .96, 7, 20), new T.MeshBasicMaterial({ color: 0xffe089, transparent: true, opacity: 0 })); glow.position.y = bh * 0.5; g.add(glow); bm.glow = glow; g.position.set(bm.x, gy, bm.z); R3.group.add(g); bm.mesh = g; });
    // boosters
    hole.boosters.forEach(function (z) { var gy = hole.terrain(z.x, z.z), g = new T.Group(); var pad = new T.Mesh(new T.CircleGeometry(z.r, 28), new T.MeshStandardMaterial({ color: 0x2aa8ff, emissive: 0x1466aa, emissiveIntensity: .55, transparent: true, opacity: .5, roughness: .4 })); pad.rotation.x = -PI / 2; pad.position.y = 2.5; g.add(pad); var ar = new T.Mesh(new T.ConeGeometry(z.r * .5, z.r * 1.1, 4), new T.MeshStandardMaterial({ color: 0xeafaff, emissive: 0x4ad0ff, emissiveIntensity: .7 })); ar.rotation.x = PI / 2; ar.position.y = 7; g.add(ar); g.position.set(z.x, gy, z.z); g.rotation.y = -Math.atan2(z.dx, z.dz); R3.group.add(g); z.mesh = g; });
    // flippers
    var chrome = new T.MeshStandardMaterial({ color: 0xe9edf3, metalness: .6, roughness: .3 }), redM = new T.MeshStandardMaterial({ color: 0xc01818, roughness: .4 });
    hole.flippers.forEach(function (f) { var gy = hole.terrain(f.px, f.pz), g = new T.Group(); var pad = new T.Mesh(new T.ExtrudeGeometry(flipperShape(f.len), { depth: 18, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 2 }), chrome); pad.rotation.x = -PI / 2; pad.position.y = 16; pad.castShadow = true; g.add(pad); var piv = new T.Mesh(new T.CylinderGeometry(18, 20, 24, 16), redM); piv.position.y = 10; g.add(piv); g.position.set(f.px, gy + 6, f.pz); R3.group.add(g); f.mesh = g; });
    // windmills
    hole.windmills.forEach(function (wmi) {
      var gy = hole.terrain(wmi.x, wmi.z);
      [-1, 1].forEach(function (sgn) { var post = new T.Mesh(new T.CylinderGeometry(7, 10, wmi.r * 1.2, 8), new T.MeshStandardMaterial({ color: 0x6e4524, roughness: .85 })); post.position.set(wmi.x + sgn * wmi.r * 1.04, gy + wmi.r * 0.6, wmi.z); post.castShadow = true; R3.group.add(post); });
      var hub = new T.Group(); hub.position.set(wmi.x, gy + wmi.r, wmi.z);
      var bmatA = new T.MeshStandardMaterial({ color: 0xe8e0d0, roughness: .55 }), bmatB = new T.MeshStandardMaterial({ color: 0xc8442e, roughness: .6 });
      for (var i = 0; i < wmi.n; i++) { var blade = new T.Mesh(new T.BoxGeometry(22, wmi.r * 0.96, 10), i % 2 ? bmatB : bmatA); blade.position.y = wmi.r * 0.5; blade.castShadow = true; var bo = new T.Group(); bo.rotation.z = i / wmi.n * TAU; bo.add(blade); hub.add(bo); }
      var cap = new T.Mesh(new T.SphereGeometry(17, 12, 10), new T.MeshStandardMaterial({ color: 0x4a2f18 })); hub.add(cap);
      R3.group.add(hub); wmi.mesh = hub;
    });
    // lasers
    hole.lasers.forEach(function (la) {
      var dx = la.bx - la.ax, dz = la.bz - la.az, L = hyp(dx, dz), gy = hole.terrain((la.ax + la.bx) / 2, (la.az + la.bz) / 2);
      var m = new T.Mesh(new T.CylinderGeometry(7, 7, L, 8), new T.MeshStandardMaterial({ color: 0xff2a3a, emissive: 0xff2a3a, emissiveIntensity: .9, transparent: true, opacity: 1 }));
      m.rotation.z = PI / 2; m.rotation.y = Math.atan2(dz, dx); m.position.set((la.ax + la.bx) / 2, gy + 30, (la.az + la.bz) / 2); R3.group.add(m); la.mesh = m;
      // emitter posts at each end so the gate's location is ALWAYS visible (even when the beam is off)
      [[la.ax, la.az], [la.bx, la.bz]].forEach(function (e) { var pg = hole.terrain(e[0], e[1]), post = new T.Mesh(new T.CylinderGeometry(13, 16, 64, 10), new T.MeshStandardMaterial({ color: 0x3a1418, emissive: 0x6a0a12, emissiveIntensity: .5, roughness: .6 })); post.position.set(e[0], pg + 32, e[1]); post.castShadow = true; R3.group.add(post); });
    });
    // multiball pad
    if (hole.multiball) { var mb = hole.multiball, gy = hole.terrain(mb.x, mb.z); var pad = new T.Mesh(new T.CircleGeometry(mb.r, 26), new T.MeshStandardMaterial({ color: 0xb84aff, emissive: 0x6a18aa, emissiveIntensity: .6, transparent: true, opacity: .55, roughness: .4 })); pad.rotation.x = -PI / 2; pad.position.set(mb.x, gy + 2.5, mb.z); R3.group.add(pad); mb.mesh = pad; }
    // cup + flag
    (hole.loops || []).forEach(function (lo) {
      var gy = hole.terrain(lo.x, lo.z), px = Math.cos(lo.ang), pz = -Math.sin(lo.ang);
      var mat = new T.MeshStandardMaterial({ color: 0xe8902a, emissive: 0x5a2c00, emissiveIntensity: .35, metalness: .35, roughness: .45 });
      [-26, 26].forEach(function (off) { var m = new T.Mesh(new T.TorusGeometry(lo.r, 9, 12, 44), mat); m.position.set(lo.x + px * off, gy + lo.r, lo.z + pz * off); m.rotation.y = lo.ang - PI / 2; m.castShadow = true; R3.group.add(m); });
      var base = new T.Mesh(new T.CircleGeometry(lo.r * .55, 22), new T.MeshBasicMaterial({ color: 0x07040a, transparent: true, opacity: .32 })); base.rotation.x = -PI / 2; base.position.set(lo.x, gy + 1.5, lo.z); R3.group.add(base);
    });
    (hole.warps || []).forEach(function (wp) {
      var gy = hole.terrain(wp.x, wp.z), gy2 = hole.terrain(wp.ex, wp.ez);
      var pit = new T.Mesh(new T.CylinderGeometry(wp.r, wp.r * .7, 80, 22), new T.MeshStandardMaterial({ color: 0x0a0616, roughness: 1 })); pit.position.set(wp.x, gy - 38, wp.z); R3.group.add(pit);
      var ring1 = new T.Mesh(new T.TorusGeometry(wp.r, 6, 10, 24), new T.MeshStandardMaterial({ color: 0x2aa8ff, emissive: 0x1466cc, emissiveIntensity: .85, roughness: .35 })); ring1.rotation.x = -PI / 2; ring1.position.set(wp.x, gy + 2, wp.z); R3.group.add(ring1); wp.mesh = ring1;
      var ring2 = new T.Mesh(new T.TorusGeometry(wp.r * .9, 5, 10, 24), new T.MeshStandardMaterial({ color: 0x2aff9a, emissive: 0x12a866, emissiveIntensity: .75, roughness: .35 })); ring2.rotation.x = -PI / 2; ring2.position.set(wp.ex, gy2 + 2, wp.ez); R3.group.add(ring2);
      var glow = new T.Mesh(new T.CircleGeometry(wp.r * .9, 20), new T.MeshBasicMaterial({ color: 0x2aff9a, transparent: true, opacity: .25 })); glow.rotation.x = -PI / 2; glow.position.set(wp.ex, gy2 + 1.5, wp.ez); R3.group.add(glow);
    });
    (hole.portals || []).forEach(function (po) {
      var pp = [[po.x, po.z]]; (po.exits || [{ x: po.ex, z: po.ez }]).forEach(function (e) { pp.push([e.x, e.z]); });
      pp.forEach(function (p, pi) { var g = hole.terrain(p[0], p[1]), col = pi === 0 ? 0xc45cff : 0x9b6cff; var ring = new T.Mesh(new T.TorusGeometry(po.r, 7, 12, 28), new T.MeshStandardMaterial({ color: col, emissive: 0x7a18cc, emissiveIntensity: .9, roughness: .3 })); ring.rotation.x = -PI / 2; ring.position.set(p[0], g + 3, p[1]); R3.group.add(ring); var disc = new T.Mesh(new T.CircleGeometry(po.r * .85, 24), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: .22 })); disc.rotation.x = -PI / 2; disc.position.set(p[0], g + 1.5, p[1]); R3.group.add(disc); });
    });
    (hole.firerings || []).forEach(function (fr) {
      var g = hole.terrain(fr.x, fr.z);
      var ring = new T.Mesh(new T.TorusGeometry(fr.r, 11, 14, 36), new T.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff3a00, emissiveIntensity: .85, roughness: .4 })); ring.position.set(fr.x, g + fr.h, fr.z); ring.castShadow = true; R3.group.add(ring); fr.mesh = ring;
      var postH = Math.max(12, fr.h - fr.r); var post = new T.Mesh(new T.CylinderGeometry(5, 8, postH, 8), new T.MeshStandardMaterial({ color: 0x6e4524, roughness: .85 })); post.position.set(fr.x, g + postH / 2, fr.z); post.castShadow = true; R3.group.add(post);
    });
    (hole.coins || []).forEach(function (cn) {
      var g = hole.terrain(cn.x, cn.z);
      var coin = new T.Mesh(new T.TorusGeometry(22, 7, 10, 18), new T.MeshStandardMaterial({ color: 0xffd54a, emissive: 0x9a7600, emissiveIntensity: .5, metalness: .7, roughness: .25 })); coin.position.set(cn.x, g + 40, cn.z); coin.castShadow = true; R3.group.add(coin); cn.mesh = coin;
    });
    (hole.powerups || []).forEach(function (pu) {
      var g = hole.terrain(pu.x, pu.z), cfg = PU[pu.kind] || PU.magnet;
      var gem = new T.Mesh(new T.OctahedronGeometry(26, 0), new T.MeshStandardMaterial({ color: cfg.c, emissive: cfg.e, emissiveIntensity: .75, metalness: .5, roughness: .25 })); gem.position.set(pu.x, g + 48, pu.z); gem.castShadow = true; R3.group.add(gem); pu.mesh = gem;
      var halo = new T.Mesh(new T.TorusGeometry(34, 4, 8, 24), new T.MeshBasicMaterial({ color: cfg.c, transparent: true, opacity: .5 })); halo.rotation.x = -PI / 2; halo.position.set(pu.x, g + 12, pu.z); R3.group.add(halo); pu.halo = halo;
    });
    (hole.enemies || []).forEach(function (en) {
      var g = new T.Group(), col = en.type === 'blob' ? 0x2f9a3a : en.type === 'ghost' ? 0x8a4adf : 0x9a1f1f;
      var body = new T.Mesh(new T.SphereGeometry(en.r, 16, 12), new T.MeshStandardMaterial({ color: col, roughness: .55, transparent: en.type === 'ghost', opacity: en.type === 'ghost' ? .6 : 1 })); body.position.y = en.r; body.castShadow = en.type !== 'ghost'; g.add(body);
      if (en.type === 'spiky') for (var s = 0; s < 8; s++) { var a = s / 8 * TAU, spike = new T.Mesh(new T.ConeGeometry(en.r * .24, en.r * .6, 6), new T.MeshStandardMaterial({ color: 0x550f0f })); spike.position.set(Math.cos(a) * en.r * .92, en.r, Math.sin(a) * en.r * .92); spike.rotation.x = PI / 2; spike.rotation.z = -a; g.add(spike); }
      [[-.42, .72], [.42, .72]].forEach(function (e) { var eye = new T.Mesh(new T.SphereGeometry(en.r * .2, 8, 8), new T.MeshStandardMaterial({ color: 0xffee44, emissive: 0xaa8800, emissiveIntensity: .7 })); eye.position.set(e[0] * en.r, en.r * 1.15, e[1] * en.r); g.add(eye); });
      g.position.set(en.cx, hole.terrain(en.cx, en.cz), en.cz); R3.group.add(g); en.mesh = g;
    });
    var cu = hole.cup, cy = hole.terrain(cu.x, cu.z);
    var cup = new T.Mesh(new T.CylinderGeometry(K.cupR, K.cupR * .8, 70, 22), new T.MeshStandardMaterial({ color: 0x07050a, roughness: 1 })); cup.position.set(cu.x, cy - 30, cu.z); R3.group.add(cup);
    var rim = new T.Mesh(new T.TorusGeometry(K.cupR, 4, 8, 22), new T.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x4a3a10, roughness: .4 })); rim.rotation.x = -PI / 2; rim.position.set(cu.x, cy + 1, cu.z); R3.group.add(rim);
    R3.cupGlow = new T.Mesh(new T.RingGeometry(K.cupR + 7, K.cupR + 34, 30), new T.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: .45, side: T.DoubleSide })); R3.cupGlow.rotation.x = -PI / 2; R3.cupGlow.position.set(cu.x, cy + 2.5, cu.z); R3.group.add(R3.cupGlow);   // pulsing target marker
    var pole = new T.Mesh(new T.CylinderGeometry(3, 3, 220, 8), new T.MeshStandardMaterial({ color: 0xeeeeee })); pole.position.set(cu.x, cy + 110, cu.z); pole.castShadow = true; R3.group.add(pole);
    R3.flag = new T.Mesh(new T.PlaneGeometry(80, 50), new T.MeshStandardMaterial({ color: 0xdf3b32, side: T.DoubleSide })); R3.flag.position.set(cu.x + 42, cy + 190, cu.z); R3.group.add(R3.flag);
    // balls
    R3.ballMeshes = []; R3.bsh = []; R3.shieldMeshes = [];
  }
  function ensureBallMeshes() {
    if (!R3.shieldMeshes) R3.shieldMeshes = [];
    while (R3.ballMeshes.length < St.balls.length) {
      var m = new T.Mesh(new T.SphereGeometry(K.R, 22, 16), new T.MeshStandardMaterial({ map: ballTex(), roughness: .35 })); m.castShadow = true; R3.group.add(m); R3.ballMeshes.push(m);
      var sh = new T.Mesh(new T.CircleGeometry(K.R * 1.2, 14), new T.MeshBasicMaterial({ color: 0x0a1606, transparent: true, opacity: .32 })); sh.rotation.x = -PI / 2; R3.group.add(sh); R3.bsh.push(sh);
      var bb = new T.Mesh(new T.SphereGeometry(K.R * 1.5, 18, 14), new T.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: .4, side: T.DoubleSide, depthWrite: false })); bb.visible = false; bb.renderOrder = 3; R3.group.add(bb); R3.shieldMeshes.push(bb);
    }
  }

  /* ================================================================ FLIPPERS */
  function flipPress(side, down) { St.hole.flippers.forEach(function (f) { if (f.side === side) { if (down) { f.held = true; f.holdT = K.flipHold; } else f.held = false; } }); }
  function flipRest(f) { return (f.side === 'L' ? -0.5 : PI + 0.5) + (f.rot || 0); }
  function flipUp(f) { var r = flipRest(f); return f.side === 'L' ? r + K.flipSweep : r - K.flipSweep; }
  function stepFlipper(f, dt) { var driving = f.held || f.holdT > 0; if (f.holdT > 0) f.holdT = Math.max(0, f.holdT - dt); var rest = flipRest(f), up = flipUp(f), target = driving ? up : rest, sp = (f.speed || 1), ms = (driving ? K.flipUpSpd : K.flipDnSpd) * sp * dt, prev = f.ang; f.ang += clamp(target - f.ang, -ms, ms); f.om = (f.ang - prev) / dt; var towardUp = (up - rest) >= 0 ? (f.om > K.flipLiveOm) : (f.om < -K.flipLiveOm); f.live = driving && towardUp; }
  function collideFlipper(b, f, gy) { if (b.y > gy + 60) return; var tx = f.px + Math.cos(f.ang) * f.len, tz = f.pz + Math.sin(f.ang) * f.len; var c = nearestOnSeg(b.x, b.z, f.px, f.pz, tx, tz); var dx = b.x - c.x, dz = b.z - c.z, d = hyp(dx, dz), R = K.R + K.flipHalf; if (d >= R) return; var nx, nz; if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 0; nz = -1; d = .01; } b.x = c.x + nx * R; b.z = c.z + nz * R; var rx = c.x - f.px, rz = c.z - f.pz, q = hyp(rx, rz); if (f.live) { var launch = Math.min(f.power || K.flipKick, Math.abs(f.om) * q * 0.75), cur = b.vx * nx + b.vz * nz; if (cur < launch) { b.vx += (launch - cur) * nx; b.vz += (launch - cur) * nz; } St.shake = Math.min(9, St.shake + 5); spark(b.x, gy + 20, b.z, 8); sfx('flip'); } else { var vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= (1 + K.flipE) * vn * nx; b.vz -= (1 + K.flipE) * vn * nz; } } }

  /* ================================================================ PHYSICS */
  function collideWall(b, s, gy) { if (b.y > gy + s.h - 4) return; var c = nearestOnSeg(b.x, b.z, s.ax, s.az, s.bx, s.bz); var dx = b.x - c.x, dz = b.z - c.z, d = hyp(dx, dz), R = K.R + K.wallHalf; if (d >= R) return; var nx, nz; if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 0; nz = -1; d = .01; } b.x = c.x + nx * R; b.z = c.z + nz * R; var vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= (1 + s.e) * vn * nx; b.vz -= (1 + s.e) * vn * nz; if (vn < -700) { sfx('tick'); } } }
  function collideBumper(b, bm, gy) { if (b.y > gy + 110) return; var dx = b.x - bm.x, dz = b.z - bm.z, d = hyp(dx, dz) || .001, R = K.R + bm.r; if (d >= R) return; var nx = dx / d, nz = dz / d; b.x = bm.x + nx * R; b.z = bm.z + nz * R; var vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 2.0 * vn * nx; b.vz -= 2.0 * vn * nz; } var bk = bm.kick || K.bumpKick; b.vx += nx * bk; b.vz += nz * bk; bm.flash = .25; St.combo = (St.combo || 0) + 1; St.comboPulse = 0.6; St.shake = Math.min(12, St.shake + 6 + Math.min(St.combo, 6)); spark(bm.x, gy + 40, bm.z, 12 + Math.min(St.combo * 2, 14)); pop3d(bm.x, bm.z, gy, St.combo > 1 ? 'POP x' + St.combo + '!' : 'POP!', St.combo >= 4 ? COL.red : COL.gold); sfx('bump'); }
  function windmillBlades(wm) { var segs = []; for (var i = 0; i < wm.n; i++) { var a = wm.ang + i / wm.n * TAU; segs.push({ ax: wm.x, az: wm.z, bx: wm.x + Math.cos(a) * wm.r, bz: wm.z + Math.sin(a) * wm.r, a: a }); } return segs; }
  function collideWindmill(b, wm, gy) {
    // VERTICAL Dutch windmill: blades sweep down across the passage at z=wm.z. Blocked when a blade is near straight-down.
    if (Math.abs(b.z - wm.z) > K.R + 16 || Math.abs(b.x - wm.x) > wm.r * 0.95 || b.y > gy + wm.r * 0.85) return;
    var win = (TAU / wm.n) * 0.16, nearest = 1e9;
    for (var i = 0; i < wm.n; i++) { var a = ((wm.ang + i / wm.n * TAU) % TAU + TAU) % TAU, dd = Math.abs(a - PI); dd = Math.min(dd, TAU - dd); if (dd < nearest) nearest = dd; }
    if (nearest < win) {
      if (b.vz >= 0) { b.z = wm.z - (K.R + 15); b.vz = -Math.abs(b.vz) * 0.55; } else { b.z = wm.z + (K.R + 15); b.vz = Math.abs(b.vz) * 0.55; }
      b.vx *= 0.7; wm.flash = .3; St.shake = Math.min(10, St.shake + 5); spark(b.x, gy + 20, b.z, 8); pop3d(b.x, b.z, gy, 'WHACK!', '#ff8a2a'); sfx('tick');
    }
  }
  function laserActive(la) { var p = ((St.t + la.phase * la.period) % la.period) / la.period; return p < la.onFrac; }
  function collideLaser(b, la, gy) {
    if (!la.on || b.y > gy + 70) return;
    var c = nearestOnSeg(b.x, b.z, la.ax, la.az, la.bx, la.bz), dx = b.x - c.x, dz = b.z - c.z, d = hyp(dx, dz);
    if (d >= K.R + 14) return;            // not touching the beam
    if (b.hzCd > 0) return;               // brief immunity (just bounced, or shield window)
    var nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : -1;
    if (b.shield) { b.shield = false; b.hzCd = 0.6; b.x = c.x + nx * (K.R + 15); b.z = c.z + nz * (K.R + 15); pop3d(b.x, b.z, b.y, 'BLOCKED!', '#33b6ff'); spark(b.x, b.y + 14, b.z, 12); St.shake = Math.min(8, St.shake + 4); sfx('boost'); return; }
    // a laser is a TIMED GATE: when on it gently STOPS the ball at the beam (wait for the off window) — it does NOT delete your progress or fling you back
    b.x = c.x + nx * (K.R + 14); b.z = c.z + nz * (K.R + 14);
    var vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.2 * vn * nx; b.vz -= 1.2 * vn * nz; }   // soft reject
    b.vx *= 0.34; b.vz *= 0.34;                                                                      // shed momentum so it settles right at the gate
    b.hzCd = 0.22;
    pop3d(b.x, b.z, b.y, 'ZAP!', '#ff4a5a'); spark(b.x, b.y + 14, b.z, 10); St.shake = Math.min(8, St.shake + 4); sfx('tick');
  }
  function stepLoop(b, dt) {
    var lo = b.loop; lo.t += (lo.sp / (TAU * lo.r)) * dt;
    var th = lo.t * TAU, fx = Math.sin(lo.ang), fz = Math.cos(lo.ang), s = Math.sin(th);
    b.x = lo.x + s * lo.r * fx; b.z = lo.z + s * lo.r * fz; b.y = lo.gy + lo.r * (1 - Math.cos(th));
    b.vx = fx * lo.sp; b.vz = fz * lo.sp; b.vy = 0; b.air = true; b.stillT = 0; b.settled = false;
    if (lo.t >= 1) { b.x = lo.x + fx * lo.r * .5; b.z = lo.z + fz * lo.r * .5; b.y = lo.gy + K.R; b.vx = fx * lo.sp * 1.05; b.vz = fz * lo.sp * 1.05; b.vy = 0; b.air = false; b.loop = null; b.loopCd = .5; St.shake = Math.min(10, St.shake + 6); sfx('boost'); }
  }
  function stepBall(b, dt, hole) {
    if (b.sunk || b.dead) return;
    if (b.loopCd > 0) b.loopCd -= dt;
    if (b.hzCd > 0) b.hzCd -= dt;
    if (b.loop) { stepLoop(b, dt); return; }
    b.vy -= K.g * dt; var ad = 1 - K.airDrag * dt; b.vx *= ad; b.vz *= ad;
    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz); if (sp > K.vMax) { var s = K.vMax / sp; b.vx *= s; b.vy *= s; b.vz *= s; }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    var bn = hole.bounds;
    if (b.x < bn.minX + 12) { b.x = bn.minX + 12; b.vx = Math.abs(b.vx) * .5; }
    if (b.x > bn.maxX - 12) { b.x = bn.maxX - 12; b.vx = -Math.abs(b.vx) * .5; }
    if (b.z < bn.minZ + 12) { b.z = bn.minZ + 12; b.vz = Math.abs(b.vz) * .5; }
    if (b.z > bn.maxZ - 12) { b.z = bn.maxZ - 12; b.vz = -Math.abs(b.vz) * .5; }
    // ground
    var gh = hole.terrain(b.x, b.z), surf = gh + K.R, wasAir = b.air;
    if (b.y <= surf) {
      var n = normalAt(hole, b.x, b.z); b.y = surf;
      var vn = b.vx * n.x + b.vy * n.y + b.vz * n.z;
      if (vn < 0) { var e = (wasAir && -vn > 220) ? K.groundE : 0; b.vx -= (1 + e) * vn * n.x; b.vy -= (1 + e) * vn * n.y; b.vz -= (1 + e) * vn * n.z; if (wasAir && -vn > 520) { spark(b.x, surf, b.z, 6); St.shake = Math.min(7, St.shake + 3); } }
      var vd = b.vx * n.x + b.vy * n.y + b.vz * n.z, tx = b.vx - vd * n.x, ty = b.vy - vd * n.y, tz = b.vz - vd * n.z, ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (ts > 0) { var ns = Math.max(0, ts - K.rollFric * dt), kf = ns / ts; b.vx = tx * kf + vd * n.x; b.vy = ty * kf + vd * n.y; b.vz = tz * kf + vd * n.z; }
      b.air = false;
    } else b.air = true;
    var i, gy = gh;
    for (i = 0; i < hole.walls.length; i++) collideWall(b, hole.walls[i], gy);
    for (i = 0; i < hole.bumpers.length; i++) collideBumper(b, hole.bumpers[i], gy);
    for (i = 0; i < hole.flippers.length; i++) collideFlipper(b, hole.flippers[i], gy);
    for (i = 0; i < hole.windmills.length; i++) collideWindmill(b, hole.windmills[i], gy);
    for (i = 0; i < hole.lasers.length; i++) collideLaser(b, hole.lasers[i], gy);
    // boosters
    if (b.boostCd > 0) b.boostCd -= dt;
    for (i = 0; i < hole.boosters.length; i++) { var z = hole.boosters[i]; if (b.boostCd <= 0 && b.y < gy + 70 && hyp(b.x - z.x, b.z - z.z) < z.r) { b.vx = z.dx * z.spd; b.vz = z.dz * z.spd; b.boostCd = K.boostCd; z.flash = .3; St.shake = Math.min(11, St.shake + 7); pop3d(z.x, z.z, gy, 'TURBO!', COL.blue); spark(z.x, gy + 16, z.z, 16); spawnShock(z.x, gy, z.z, COL.blue); sfx('boost'); break; } }
    // loop-de-loop (enter from either side with enough speed; ball rides the vertical loop, exits boosted)
    var lps = hole.loops || [];
    for (i = 0; i < lps.length; i++) { var lo2 = lps[i]; if (b.loopCd <= 0 && hyp(b.x - lo2.x, b.z - lo2.z) < 46) { var fwd = b.vx * Math.sin(lo2.ang) + b.vz * Math.cos(lo2.ang), sp2 = hyp(b.vx, b.vz); if (Math.abs(fwd) > 1050 && sp2 > 1150) { var dir = fwd >= 0 ? lo2.ang : lo2.ang + PI; b.loop = { x: lo2.x, z: lo2.z, r: lo2.r, ang: dir, t: 0, sp: Math.min(sp2, 4200), gy: hole.terrain(lo2.x, lo2.z) }; pop3d(lo2.x, lo2.z, hole.terrain(lo2.x, lo2.z), 'LOOP!', COL.gold); spawnShock(lo2.x, hole.terrain(lo2.x, lo2.z), lo2.z, COL.gold); St.shake = Math.min(10, St.shake + 5); sfx('boost'); return; } } }
    // drop holes / warps — roll in, fall to the linked exit (lower tier)
    if (b.warpCd > 0) b.warpCd -= dt;
    var wps = hole.warps || [];
    for (i = 0; i < wps.length; i++) { var wp = wps[i]; if (b.warpCd <= 0 && !b.air && hyp(b.x - wp.x, b.z - wp.z) < wp.r) { wp.flash = .3; b.x = wp.ex; b.z = wp.ez; b.y = hole.terrain(wp.ex, wp.ez) + K.R + 240; b.vx *= 0.3; b.vz *= 0.3; b.vy = 0; b.air = true; b.warpCd = 0.8; b.stillT = 0; b.settled = false; pop3d(wp.x, wp.z, hole.terrain(wp.x, wp.z), 'DROP!', COL.blue); spark(wp.x, hole.terrain(wp.x, wp.z) + 12, wp.z, 14); spawnShock(wp.x, hole.terrain(wp.x, wp.z), wp.z, COL.blue); St.shake = Math.min(10, St.shake + 6); sfx('boost'); return; } }
    // portals — teleport to the linked twin, keeping speed & direction
    if (b.portalCd > 0) b.portalCd -= dt;
    var prt = hole.portals || [];
    for (i = 0; i < prt.length; i++) { var po = prt[i]; if (b.portalCd <= 0 && !b.air && hyp(b.x - po.x, b.z - po.z) < po.r) { po.flash = .3; var exs = po.exits || [{ x: po.ex, z: po.ez }], ex = exs[Math.floor(Math.random() * exs.length)], psp = hyp(b.vx, b.vz) || 1, ux = b.vx / psp, uz = b.vz / psp; b.x = ex.x + ux * (po.r + K.R + 14); b.z = ex.z + uz * (po.r + K.R + 14); b.y = hole.terrain(b.x, b.z) + K.R; b.portalCd = 0.5; pop3d(ex.x, ex.z, hole.terrain(ex.x, ex.z), exs.length > 1 ? '⁇ WARP!' : 'WARP!', '#c45cff'); spark(ex.x, hole.terrain(ex.x, ex.z) + 14, ex.z, 12); spawnShock(ex.x, hole.terrain(ex.x, ex.z), ex.z, '#c45cff'); St.shake = Math.min(9, St.shake + 4); sfx('boost'); return; } }
    // ring of fire — a VERTICAL flaming hoop; jump the ball through the opening for points
    var frs = hole.firerings || [];
    for (i = 0; i < frs.length; i++) { var fr = frs[i]; if (fr.passedCd <= 0 && Math.abs(b.z - fr.z) < K.R + 12) { var cyf = hole.terrain(fr.x, fr.z) + fr.h, dxr = b.x - fr.x, dyr = b.y - cyf, rr = Math.sqrt(dxr * dxr + dyr * dyr); if (rr < fr.r - K.R * 0.5 && b.air) { fr.passed = true; fr.flash = .6; fr.passedCd = 0.9; St.points = (St.points || 0) + fr.points; St.combo = (St.combo || 0) + 1; St.comboPulse = 0.6; pop3d(fr.x, fr.z, cyf, 'RING +' + fr.points + '!', COL.gold); spark(fr.x, cyf, fr.z, 18); spawnShock(fr.x, cyf, fr.z, COL.gold); St.shake = Math.min(10, St.shake + 5); b.vx *= 1.12; b.vz *= 1.12; sfx('boost'); } } }
    // enemies — effect on contact: knockback / reset (back to shot) / stun
    var ens = hole.enemies || [];
    for (i = 0; i < ens.length; i++) { var en = ens[i]; var dxe = b.x - en.cx, dze = b.z - en.cz, de = hyp(dxe, dze), Re = K.R + en.r; if (de < Re && b.y < gy + 90) { if (b.hzCd > 0) continue; var nex = de > .01 ? dxe / de : 0, nez = de > .01 ? dze / de : 1; b.x = en.cx + nex * Re; b.z = en.cz + nez * Re; en.flash = .3; St.shake = Math.min(12, St.shake + 7); spark(en.cx, gy + 24, en.cz, 14); sfx('bump'); if (b.shield) { b.shield = false; b.hzCd = 0.5; var vneS = b.vx * nex + b.vz * nez; if (vneS < 0) { b.vx -= 2 * vneS * nex; b.vz -= 2 * vneS * nez; } pop3d(en.cx, en.cz, gy, 'BLOCKED!', '#33b6ff'); continue; } if (en.effect === 'reset') { var vne0 = b.vx * nex + b.vz * nez; if (vne0 < 0) { b.vx -= 2.4 * vne0 * nex; b.vz -= 2.4 * vne0 * nez; } b.vx *= 0.28; b.vz *= 0.28; b.hzCd = 0.3; pop3d(en.cx, en.cz, gy, 'REPEL!', COL.red); return; } else if (en.effect === 'stun') { b.vx *= 0.1; b.vz *= 0.1; b.hzCd = 0.2; pop3d(en.cx, en.cz, gy, 'STUN!', COL.red); } else { var vne = b.vx * nex + b.vz * nez; if (vne < 0) { b.vx -= 1.9 * vne * nex; b.vz -= 1.9 * vne * nez; } b.vx += nex * 1700; b.vz += nez * 1700; pop3d(en.cx, en.cz, gy, 'POW!', COL.red); } } }
    // coins — roll over to collect
    var cns = hole.coins || [];
    for (i = 0; i < cns.length; i++) { var cn = cns[i]; if (!cn.got && b.y < gy + 130 && hyp(b.x - cn.x, b.z - cn.z) < K.R + 26) { cn.got = true; St.coins = (St.coins || 0) + cn.value; St.coinPulse = 0.5; pop3d(cn.x, cn.z, gy + 40, '+' + cn.value, COL.gold); spark(cn.x, gy + 36, cn.z, 14); sfx('coin'); } }
    // power-ups — roll over to grab a beneficial effect
    var pus = hole.powerups || [];
    for (i = 0; i < pus.length; i++) { var pu = pus[i]; if (!pu.got && b.y < gy + 130 && hyp(b.x - pu.x, b.z - pu.z) < K.R + 30) { pu.got = true; pu.flash = .5; applyPowerup(pu.kind, b, gy); } }
    // magnet — while active, accelerate toward the cup
    if (St.magnetT > 0 && !b.air) { var mdx = hole.cup.x - b.x, mdz = hole.cup.z - b.z, ml = hyp(mdx, mdz) || 1; b.vx += mdx / ml * 2600 * dt; b.vz += mdz / ml * 2600 * dt; }
    // cup
    var cu = hole.cup, dc = hyp(b.x - cu.x, b.z - cu.z), gsp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    if (dc < K.cupR + K.R) { if (gsp < K.holeSpd && !b.air) { b.sunk = true; b.x = cu.x; b.z = cu.z; return; } if (dc < K.cupR && gsp < K.holeSpd * 1.3) { var dl = dc || 1; b.vx += (cu.x - b.x) / dl * 36; b.vz += (cu.z - b.z) / dl * 36; } }
    // settle
    var planar = hyp(b.vx, b.vz);
    if (!b.air && planar < K.settle && Math.abs(b.vy) < K.settle) { b.stillT += dt; if (b.stillT > K.settleT) { b.vx = b.vy = b.vz = 0; b.settled = true; } } else { b.stillT = 0; b.settled = false; }
  }
  function normalAt(hole, x, z) { var e = 3, hx = hole.terrain(x + e, z) - hole.terrain(x - e, z), hz = hole.terrain(x, z + e) - hole.terrain(x, z - e); var nx = -hx, ny = 2 * e, nz = -hz, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; return { x: nx / l, y: ny / l, z: nz / l }; }
  function applyPowerup(kind, b, gy) {
    var p = PU[kind] || PU.magnet;
    if (kind === 'magnet') St.magnetT = p.dur;
    else if (kind === 'slow') St.slowT = p.dur;
    else if (kind === 'shield') b.shield = true;
    else if (kind === 'gem') St.points = (St.points || 0) + 250;
    else if (kind === 'jump') { b.vy = Math.max(b.vy, 1550); b.air = true; b.settled = false; b.stillT = 0; }
    pop3d(b.x, b.z, gy + 42, p.name + '!', '#' + ('00000' + p.c.toString(16)).slice(-6));
    spark(b.x, gy + 32, b.z, 16); St.shake = Math.min(9, St.shake + 4); sfx('boost');
  }

  function physStep(dt) {
    var hole = St.hole, i;
    if (St.magnetT > 0) St.magnetT = Math.max(0, St.magnetT - dt);
    for (i = 0; i < hole.flippers.length; i++) stepFlipper(hole.flippers[i], dt);
    for (i = 0; i < hole.windmills.length; i++) { var wm = hole.windmills[i]; wm.om = wm.speed; wm.ang += wm.speed * dt; }
    for (i = 0; i < hole.lasers.length; i++) hole.lasers[i].on = laserActive(hole.lasers[i]);
    var pb0 = null; for (var pbi = 0; pbi < St.balls.length; pbi++) { if (!St.balls[pbi].sunk && !St.balls[pbi].dead) { pb0 = St.balls[pbi]; break; } }
    var ens0 = hole.enemies || []; for (i = 0; i < ens0.length; i++) { var en0 = ens0[i];
      if (en0.behavior === 'static') { en0.cx = en0.x; en0.cz = en0.z; }
      else if (en0.behavior === 'chase' && pb0) { var dxc = pb0.x - en0.cx, dzc = pb0.z - en0.cz, dlc = hyp(dxc, dzc) || 1, spc = en0.speed * 260 * dt; en0.cx += dxc / dlc * Math.min(spc, dlc); en0.cz += dzc / dlc * Math.min(spc, dlc); }
      else { en0.ph += en0.speed * dt; var eu = Math.abs((en0.ph % 2) - 1); en0.cx = en0.x + (en0.ex - en0.x) * eu; en0.cz = en0.z + (en0.ez - en0.z) * eu; }
    }
    var frs0 = hole.firerings || []; for (i = 0; i < frs0.length; i++) { if (frs0[i].passedCd > 0) frs0[i].passedCd -= dt; }
    if (St.state !== 'roll') return;
    var anyMoving = false, anySunk = false;
    for (i = 0; i < St.balls.length; i++) { var b = St.balls[i]; if (b.sunk || b.dead) { if (b.sunk) anySunk = true; continue; } stepBall(b, dt, hole); if (b.sunk) anySunk = true; else if (!b.settled) anyMoving = true; }
    if (anySunk) { holeSunk(); return; }
    if (!anyMoving) endShot();
  }
  function endShot() {
    // keep the ball nearest the cup (rewards multiball), drop the rest
    var hole = St.hole, best = null, bd = 1e9;
    for (var i = 0; i < St.balls.length; i++) { var b = St.balls[i]; if (b.dead || b.sunk) continue; var d = hyp(b.x - hole.cup.x, b.z - hole.cup.z); if (d < bd) { bd = d; best = b; } }
    if (!best) { newShotBall(); return; }
    trimBallMeshes(1);                                  // remove any extra ball meshes from the scene (no ghosts)
    St.balls = [best]; best.prime = true;
    St.state = 'aim'; St.power = 0.5; St.aimYaw = St.camYaw;
  }
  function trimBallMeshes(n) {
    if (!R3.ballMeshes) return;
    while (R3.ballMeshes.length > n) {
      var m = R3.ballMeshes.pop(); if (m) { if (R3.group) R3.group.remove(m); if (m.geometry) m.geometry.dispose(); }
      var sh = R3.bsh.pop(); if (sh) { if (R3.group) R3.group.remove(sh); if (sh.geometry) sh.geometry.dispose(); }
      if (R3.shieldMeshes) { var bb = R3.shieldMeshes.pop(); if (bb) { if (R3.group) R3.group.remove(bb); if (bb.geometry) bb.geometry.dispose(); } }
    }
  }
  function clearBallMeshes() { trimBallMeshes(0); }
  function newShotBall() { var t = St.hole.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = St.hole.terrain(t.x, t.z) + K.R; St.state = 'aim'; }

  /* ================================================================ shot / hole flow */
  function shoot() {
    if (St.state !== 'aim') return; var b = primeBall(); if (!b) return;
    var curved = St.power * St.power, power = lerp(K.shotMin, K.shotMax, curved), f = aimDir();
    b.vx = f.x * power; b.vz = f.z * power; b.vy = 0; b.stillT = 0; b.air = false; b.settled = false; b.shotFrom = { x: b.x, z: b.z };
    St.strokes++; St.state = 'roll'; St.shake = 2; St.combo = 0; sfx('hit');
  }
  function aimDir() { return { x: Math.sin(St.aimYaw), z: Math.cos(St.aimYaw) }; }
  function bestStore() { try { return JSON.parse(localStorage.getItem('pg_best') || '{}'); } catch (e) { return {}; } }
  function holeKey() { return St.hi >= 0 ? ('h' + St.hi) : ('c:' + (St.customName || (St.hole && St.hole.name) || '?')); }
  function holeSunk() {
    St.state = 'sunk'; sfx('sink');
    St.scores[St.hi] = St.strokes; St.parDone = (St.parDone || 0) + St.hole.par; var over = St.strokes - St.hole.par;
    var word = St.strokes === 1 ? 'HOLE IN ONE!' : over <= -2 ? 'EAGLE!' : over === -1 ? 'BIRDIE!' : over === 0 ? 'PAR' : over === 1 ? 'BOGEY' : '+' + over;
    // personal-best per hole (persists across sessions/builds) — not while testing a draft
    if (!St.testing) { var bk = holeKey(), bs = bestStore(); St.newBest = (bs[bk] == null || St.strokes < bs[bk]); if (St.newBest) { bs[bk] = St.strokes; try { localStorage.setItem('pg_best', JSON.stringify(bs)); } catch (e) { } } St.holeBest = bs[bk]; if (St.newBest && St.strokes !== 1 && over > -2) word = word + ' · ★ BEST'; }
    St.banner = word; St.bannerT = 3.2;
    var great = (over <= -1) || St.strokes === 1, cx = St.hole.cup.x, cz = St.hole.cup.z, gy = St.hole.terrain(cx, cz);
    St.shake = great ? 22 : (over <= 0 ? 14 : 9);
    sparkBurst(cx, cz, great ? 60 : over === 0 ? 38 : 22);
    spawnShock(cx, gy, cz, COL.gold, great ? 320 : 210, 0.62); spawnShock(cx, gy, cz, '#fff0c8', great ? 210 : 140, 0.5);   // celebratory cup rings
    if (great) {   // colourful confetti fountain for birdie-or-better
      var cols = ['#f5c542', '#df3b32', '#3aa0ff', '#86d85f', '#c45cff', '#ff8a2a', '#ffffff'];
      for (var k = 0; k < 70; k++) { var a = Math.random() * TAU, sp = 120 + Math.random() * 360; St.fx.push({ x: cx, y: gy + 16, z: cz, vx: Math.cos(a) * sp, vy: 280 + Math.random() * 420, vz: Math.sin(a) * sp, life: 1.1 + Math.random() * 0.7, max: 1.8, col: cols[(Math.random() * cols.length) | 0], r: 3 + Math.random() * 3 }); }
    }
    setTimeout(nextHole, 3000);
  }
  function nextHole() { if (St.hi >= HOLES.length - 1) { finishGame(); return; } loadHole(St.hi + 1); }
  function finishGame() { St.total = St.scores.reduce(function (a, c) { return a + (c || 0); }, 0); St.state = 'done'; St.banner = 'COURSE COMPLETE'; St.bannerT = 2.5; showScorecard(); }
  function showScorecard() {
    var old = document.getElementById('pg-scorecard'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:56;display:flex;align-items:center;justify-content:center;background:rgba(8,5,2,.82);', null, document.body); ov.id = 'pg-scorecard';
    var box = elt('div', 'width:430px;max-width:94%;max-height:88%;overflow:auto;background:#241a0e;border:2px solid #f5c542;border-radius:14px;padding:18px;box-shadow:0 10px 50px rgba(0,0,0,.7);', null, ov); box.className = 'edscroll';
    elt('div', 'font:900 22px Wantedo, Georgia;color:#f5c542;text-align:center;', '🏆 COURSE COMPLETE', box);
    var bs = bestStore(), totPar = 0, totYou = 0;
    var hdr = elt('div', 'display:flex;font:700 10px Georgia;color:#f5c542;opacity:.7;margin:8px 0 2px;padding:0 6px;', null, box);
    ['HOLE', 'PAR', 'YOU', 'BEST'].forEach(function (t, i) { elt('div', i === 0 ? 'flex:1;' : 'width:46px;text-align:right;', t, hdr); });
    HOLES.forEach(function (hf, i) { var sc = St.scores[i]; if (sc == null) return; var h = hf(), par = h.par; totPar += par; totYou += sc; var over = sc - par;
      var r = elt('div', 'display:flex;align-items:center;padding:5px 6px;margin:2px 0;background:rgba(245,197,66,.06);border-radius:6px;font:13px Georgia;color:#f5efdc;', null, box);
      elt('div', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', (i + 1) + '. ' + h.name, r);
      elt('div', 'width:46px;text-align:right;opacity:.7;', String(par), r);
      var yc = over < 0 ? '#86d85f' : over === 0 ? '#f5efdc' : '#df8a6a'; elt('div', 'width:46px;text-align:right;font-weight:700;color:' + yc + ';', sc + (over === 0 ? '' : (over > 0 ? ' +' + over : ' ' + over)), r);
      elt('div', 'width:46px;text-align:right;color:#f5c542;', bs['h' + i] != null ? ('★' + bs['h' + i]) : '–', r);
    });
    var tp = totYou - totPar, tpStr = tp > 0 ? '+' + tp : tp === 0 ? 'EVEN' : String(tp);
    var tr = elt('div', 'display:flex;align-items:center;padding:9px 6px;margin-top:6px;border-top:2px solid #5a3a1a;font:900 15px Georgia;color:#f5c542;', null, box);
    elt('div', 'flex:1;', 'TOTAL', tr); elt('div', 'width:46px;text-align:right;opacity:.7;', String(totPar), tr); elt('div', 'width:92px;text-align:right;', totYou + ' (' + tpStr + ')', tr);
    var act = elt('div', 'display:flex;gap:8px;margin-top:14px;', null, box);
    var pa = elt('button', 'flex:1;padding:11px;border:2px solid #160d06;border-radius:9px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', '▶ Play Again', act); pa.onclick = function () { ov.remove(); loadHole(0); };
    var ls = elt('button', 'flex:1;padding:11px;border:2px solid #160d06;border-radius:9px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:800 13px Georgia;cursor:pointer;', '📋 Level Select', act); ls.onclick = function () { ov.remove(); levelMenu(); };
  }
  function loadHole(hi) {
    var scd = document.getElementById('pg-scorecard'); if (scd) scd.remove();
    St.hi = hi;
    St.hole = HOLES[hi](); applyPhys(St.hole.phys); buildScene(St.hole); clearBallMeshes();
    var t = St.hole.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = St.hole.terrain(t.x, t.z) + K.R;
    St.strokes = 0; St.camOrbit = 0; St.fx = []; St.pops = []; St.trail = []; St.coins = 0; St.points = 0; St.customName = null; St.magnetT = 0; St.slowT = 0;
    St.holeBest = bestStore()['h' + hi]; St.newBest = false; St.testing = false;
    var hy = Math.atan2(St.hole.cup.x - t.x, St.hole.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.power = 0.5; St.state = 'aim';
    St.banner = '#' + (hi + 1) + '  ' + St.hole.name; St.bannerT = 2.0;   // hole-intro flash
  }
  function playDraftInGame(d, banner, customName) {
    applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures); rebuildBox(d);
    (d.coins || []).forEach(function (c) { c.got = false; }); (d.powerups || []).forEach(function (p) { p.got = false; }); (d.firerings || []).forEach(function (f) { f.passed = false; f.passedCd = 0; });
    St.hole = d; St.hole.par = d.par; St.customName = customName || null;
    var t = d.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = d.terrain(t.x, t.z) + K.R; buildScene(d); clearBallMeshes();
    St.strokes = 0; St.combo = 0; St.camOrbit = 0; St.fx = []; St.pops = []; St.trail = []; St.coins = 0; St.points = 0; St.magnetT = 0; St.slowT = 0;
    St.testing = false; St.newBest = false; St.holeBest = bestStore()['c:' + (customName || d.name)];
    var hy = Math.atan2(d.cup.x - t.x, d.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.power = 0.5; St.state = 'aim';
    St.banner = banner; St.bannerT = 2.0;
  }
  function loadCustomLevel(name) { var o = edStore()[name]; if (!o) return false; St.hi = -1; playDraftInGame(edDeserialize(o), name, name); return true; }
  function skipLevel() { if (St.state === 'load') return; loadHole(St.hi < 0 ? 0 : (St.hi + 1) % HOLES.length); }
  function openEditorWith(d) { ED.draft = d; ED.undo = []; ED.redo = []; ED.sel = null; ED.on = true; edShow(true); }
  function editBuiltin(i) { var d = HOLES[i](); d.theme = d.theme || 'grass'; d.phys = d.phys || themePhys(d.theme || 'grass'); d.turf = d.turf != null ? d.turf : (THEMES[d.theme || 'grass'] || THEMES.grass).turf; openEditorWith(d); }
  function editCustom(name) { var o = edStore()[name]; if (o) openEditorWith(edDeserialize(o)); }
  function levelMenu() {
    var ov = ED.dom.lvlmenu;
    if (!ov) { ov = elt('div', 'position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;background:rgba(8,5,2,.82);', null, document.body); ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; }); ED.dom.lvlmenu = ov; }
    ov.innerHTML = ''; ov.style.display = 'flex';
    var box = elt('div', 'width:392px;max-height:85%;overflow:auto;background:#241a0e;border:2px solid #f5c542;border-radius:12px;padding:16px;box-shadow:0 10px 50px rgba(0,0,0,.6);', null, ov);
    elt('div', 'font:800 19px Wantedo,Georgia;color:#f5c542;margin-bottom:8px;', '⛳ SELECT LEVEL', box);
    var sec = function (t) { elt('div', 'font:700 11px Georgia;color:#caa06a;margin:11px 0 4px;', t, box); };
    var rowBtn = function (label, sub, play, edit) {
      var r = elt('div', 'display:flex;gap:5px;align-items:stretch;margin:3px 0;', null, box);
      var pb = elt('button', 'flex:1;display:flex;justify-content:space-between;align-items:center;padding:9px 11px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 13px Georgia;cursor:pointer;text-align:left;', null, r);
      elt('span', '', label, pb); if (sub) elt('span', 'font-size:10px;opacity:.6;margin-left:8px;white-space:nowrap;', sub, pb);
      pb.onclick = function () { ov.style.display = 'none'; play(); };
      if (edit) { var eb = elt('button', 'padding:0 11px;border:2px solid #160d06;border-radius:8px;background:#3a2614;color:#cba;font:700 13px Georgia;cursor:pointer;', '✎', r); eb.title = 'Edit in level editor'; eb.onclick = function () { ov.style.display = 'none'; edit(); }; }
    };
    sec('THE ' + HOLES.length + ' HOLES');
    HOLES.forEach(function (hf, i) { var h = hf(); rowBtn((i + 1) + '.  ' + h.name, 'par ' + h.par, function () { loadHole(i); }, function () { editBuiltin(i); }); });
    var store = edStore(), names = Object.keys(store).sort();
    sec('MY LEVELS' + (names.length ? '' : ' — none yet (build one in the editor)'));
    names.forEach(function (n) { var lv = store[n], cnt = ['bumpers', 'flippers', 'windmills', 'loops', 'coins', 'powerups', 'walls', 'enemies', 'firerings'].reduce(function (a, k) { return a + ((lv[k] || []).length); }, 0); rowBtn(n, (lv.theme || 'grass').split(' ')[0] + ' · ' + cnt, function () { loadCustomLevel(n); }, function () { editCustom(n); }); });
    var cl = elt('button', 'margin-top:12px;width:100%;padding:9px;border:2px solid #160d06;border-radius:8px;background:#3a2614;color:#f5c542;font:700 12px Georgia;cursor:pointer;', 'Close', box); cl.onclick = function () { ov.style.display = 'none'; };
  }

  /* ================================================================ fx + audio */
  function spark(x, y, z, n) { for (var i = 0; i < n; i++) { var a = Math.random() * TAU, s = 50 + Math.random() * 180; St.fx.push({ x: x, y: y, z: z, vx: Math.cos(a) * s, vy: 80 + Math.random() * 200, vz: Math.sin(a) * s, life: .5, max: .5 }); } }
  function sparkBurst(x, z, n) { var y = St.hole.terrain(x, z); for (var i = 0; i < n; i++) { var a = Math.random() * TAU, s = 100 + Math.random() * 240; St.fx.push({ x: x, y: y + 12, z: z, vx: Math.cos(a) * s, vy: 200 + Math.random() * 280, vz: Math.sin(a) * s, life: 1, max: 1, gold: true }); } }
  function spawnShock(x, gy, z, col, rmax, dur) { (St.shocks || (St.shocks = [])).push({ x: x, y: gy + 4, z: z, t: 0, max: dur || 0.45, col: col || COL.gold, rmax: rmax || 165 }); }  // expanding ground-ring shockwave (drawn projected in drawHUD)
  function pop3d(x, z, gy, text, col) { St.pops.push({ x: x, y: gy + 70, z: z, text: text, col: col, life: .85, max: .85 }); if (St.pops.length > 8) St.pops.shift(); }
  // --- AUDIO: master / music / sfx volumes (default 50%, never full), music soundtrack, persisted ---
  var AU = { ctx: null, on: true, master: 0.5, music: 0.5, sfx: 0.5, masterGain: null, sfxGain: null, musicEl: null, tracks: ['assets/audio/music1.mp3', 'assets/audio/music2.mp3', 'assets/audio/music3.mp3'], ti: 0, started: false, buf: {} };
  // comic POW/BAM one-shots (assets/audio/*.wav); each kind → wav name(s). Falls back to the synth beep below if a sample is missing/loading.
  var SFXMAP = { hit: ['12-whack'], bump: ['03-pow', '18-bam', '28-powie'], flip: ['21-sock'], tick: ['02-thunk'], boost: ['10-zam'], sink: ['07-kapwa'] };
  function sfxLoad(name) { if (!AU.ctx || AU.buf[name] !== undefined) return; AU.buf[name] = 'loading'; fetch('assets/audio/' + name + '.wav').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (ab) { return AU.ctx.decodeAudioData(ab); }).then(function (b) { AU.buf[name] = b; }).catch(function () { AU.buf[name] = 'fail'; }); }
  function sfxLoadAll() { for (var k in SFXMAP) { for (var i = 0; i < SFXMAP[k].length; i++) sfxLoad(SFXMAP[k][i]); } }
  function audioLoadPrefs() { try { var p = JSON.parse(localStorage.getItem('pg_audio') || 'null'); if (p) { if (typeof p.master === 'number') AU.master = clamp(p.master, 0, 1); if (typeof p.music === 'number') AU.music = clamp(p.music, 0, 1); if (typeof p.sfx === 'number') AU.sfx = clamp(p.sfx, 0, 1); if (typeof p.on === 'boolean') AU.on = p.on; } } catch (e) { } }
  function audioSavePrefs() { try { localStorage.setItem('pg_audio', JSON.stringify({ master: AU.master, music: AU.music, sfx: AU.sfx, on: AU.on })); } catch (e) { } }
  function audioApply() { if (AU.masterGain) AU.masterGain.gain.value = AU.on ? AU.master : 0; if (AU.sfxGain) AU.sfxGain.gain.value = AU.sfx; if (AU.musicEl) AU.musicEl.volume = clamp((AU.on ? 1 : 0) * AU.master * AU.music, 0, 1); }
  function audioInit() { if (AU.ctx) return; try { AU.ctx = new (window.AudioContext || window.webkitAudioContext)(); AU.masterGain = AU.ctx.createGain(); AU.sfxGain = AU.ctx.createGain(); AU.sfxGain.connect(AU.masterGain); AU.masterGain.connect(AU.ctx.destination); sfxLoadAll(); } catch (e) { } audioApply(); }
  function musicStart() { // begin the soundtrack on first user gesture (browser autoplay policy); cycles tracks; silent if assets absent
    if (AU.started) return; AU.started = true;
    try {
      var el = new Audio(); AU.musicEl = el; el.loop = false; el.preload = 'auto';
      el.addEventListener('ended', function () { AU.ti = (AU.ti + 1) % AU.tracks.length; el.src = AU.tracks[AU.ti]; el.play().catch(function () { }); });
      el.addEventListener('error', function () { }); // missing/blocked file → no music, game continues
      el.src = AU.tracks[AU.ti]; audioApply(); el.play().catch(function () { AU.started = false; });
    } catch (e) { AU.started = false; }
  }
  function musicNext() { if (!AU.musicEl) return; AU.ti = (AU.ti + 1) % AU.tracks.length; AU.musicEl.src = AU.tracks[AU.ti]; if (AU.on && AU.master > 0 && AU.music > 0) AU.musicEl.play().catch(function () { }); audioApply(); }
  function sfx(kind) {
    if (!AU.on || !AU.ctx || AU.master <= 0 || AU.sfx <= 0) return;
    if (kind === 'coin') {   // bright 2-note "bling-bling" arpeggio so coins feel distinct & rewarding
      var t0 = AU.ctx.currentTime, dest0 = AU.sfxGain || AU.ctx.destination, notes = [988, 1319];   // B5 -> E6
      for (var ni = 0; ni < notes.length; ni++) { var oc = AU.ctx.createOscillator(), gc = AU.ctx.createGain(), tn = t0 + ni * 0.07; oc.type = 'triangle'; oc.frequency.setValueAtTime(notes[ni], tn); gc.gain.setValueAtTime(0.0001, tn); gc.gain.exponentialRampToValueAtTime(0.42, tn + 0.012); gc.gain.exponentialRampToValueAtTime(0.0008, tn + 0.17); oc.connect(gc); gc.connect(dest0); oc.start(tn); oc.stop(tn + 0.21); }
      return;
    }
    var names = SFXMAP[kind];
    if (names) { // prefer the comic POW/BAM sample when it's decoded
      var nm = names.length > 1 ? names[(Math.random() * names.length) | 0] : names[0], b = AU.buf[nm];
      if (b === undefined) sfxLoad(nm);
      else if (b && b !== 'loading' && b !== 'fail') {
        try { var src = AU.ctx.createBufferSource(); src.buffer = b; var bg = AU.ctx.createGain(); bg.gain.value = (kind === 'tick' ? 0.4 : kind === 'flip' ? 0.7 : 0.95); src.connect(bg); bg.connect(AU.sfxGain || AU.ctx.destination); src.start(); return; } catch (e) { }
      }
    } // ...else fall through to the synth beep (sample missing, still loading, or no mapping)
    var t = AU.ctx.currentTime, o = AU.ctx.createOscillator(), g = AU.ctx.createGain(); var m = ({ hit: [190, 'sawtooth', .12], bump: [520, 'square', .07], flip: [360, 'triangle', .05], tick: [200, 'square', .04], boost: [320, 'sawtooth', .2], sink: [660, 'sine', .25], coin: [780, 'triangle', .09] })[kind] || [200, 'square', .04]; o.type = m[1]; o.frequency.setValueAtTime(m[0], t); o.frequency.exponentialRampToValueAtTime(m[0] * (kind === 'sink' || kind === 'coin' ? 1.7 : .6), t + m[2]); g.gain.setValueAtTime(.46, t); g.gain.exponentialRampToValueAtTime(.001, t + m[2]); o.connect(g); g.connect(AU.sfxGain || AU.ctx.destination); o.start(t); o.stop(t + m[2] + .02); }

  /* ================================================================ camera */
  function placeCam() {
    var b = primeBall(); if (!b) return; var cu = St.hole.cup, ddx = cu.x - b.x, ddz = cu.z - b.z;
    if (hyp(ddx, ddz) > 130) St.holeYaw = Math.atan2(ddx, ddz);
    var target = St.holeYaw + St.camOrbit, dy = target - St.camYaw; while (dy > PI) dy -= TAU; while (dy < -PI) dy += TAU; St.camYaw += dy * 0.14;
    var f = { x: Math.sin(St.camYaw), z: Math.cos(St.camYaw) }, dist = 560 * R3.zoom, ht = 510 * R3.zoom;   // higher/steeper so walls never hide the ball
    var jx = St.shake ? (Math.random() - .5) * St.shake * 2 : 0, jz = St.shake ? (Math.random() - .5) * St.shake * 2 : 0;
    R3.cam.position.set(b.x - f.x * dist + jx, b.y + ht, b.z - f.z * dist + jz);
    R3.cam.lookAt(b.x + f.x * 230, b.y + 14, b.z + f.z * 230);
    var ff = clamp(hyp(b.vx, b.vz) / 4200, 0, 1), tf = 58 + ff * 14; R3.cam.fov += (tf - R3.cam.fov) * 0.1; R3.cam.updateProjectionMatrix();
    if (R3.sun) { R3.sun.position.set(b.x + R3.sunOff.x, R3.sunOff.y, b.z + R3.sunOff.z); R3.sun.target.position.set(b.x, b.y, b.z); R3.sun.target.updateMatrixWorld(); }
  }
  function project(x, y, z) { var v = new T.Vector3(x, y, z).project(R3.cam); return { x: (v.x * .5 + .5) * St.w, y: (-v.y * .5 + .5) * St.h, vis: v.z < 1 }; }

  /* ================================================================ sync + HUD */
  function syncMeshes() {
    ensureBallMeshes(); var hole = St.hole;
    for (var i = 0; i < St.balls.length; i++) { var b = St.balls[i], m = R3.ballMeshes[i], sh = R3.bsh[i], bb = R3.shieldMeshes ? R3.shieldMeshes[i] : null; if (!m) continue; if (b.sunk || b.dead) { m.visible = false; sh.visible = false; if (bb) bb.visible = false; continue; } m.visible = true; sh.visible = true; m.position.set(b.x, b.y, b.z); var sp = hyp(b.vx, b.vz); if (sp > 6) { var ax = new T.Vector3(b.vz, 0, -b.vx).normalize(); m.rotateOnWorldAxis(ax, sp / K.R * .018); } var gh = hole.terrain(b.x, b.z); sh.position.set(b.x, gh + 2, b.z); sh.material.opacity = clamp(.34 - (b.y - gh) / 600, 0, .34); if (bb) { if (b.shield) { bb.visible = true; var pul = 0.5 + 0.5 * Math.sin(St.t * 6); bb.position.set(b.x, b.y, b.z); var bsc = 1 + pul * 0.16; bb.scale.set(bsc, bsc, bsc); bb.material.opacity = 0.28 + pul * 0.26; } else bb.visible = false; } }
    for (i = St.balls.length; i < R3.ballMeshes.length; i++) { if (R3.ballMeshes[i]) { R3.ballMeshes[i].visible = false; R3.bsh[i].visible = false; if (R3.shieldMeshes && R3.shieldMeshes[i]) R3.shieldMeshes[i].visible = false; } }
    for (i = 0; i < hole.bumpers.length; i++) { var bm = hole.bumpers[i]; if (bm.mesh) { var fl = Math.max(0, bm.flash || 0), s2 = 1 + fl * 1.4; bm.mesh.scale.set(s2, 1, s2); if (bm.litMat) bm.litMat.emissiveIntensity = fl * 3.4; if (bm.glow) bm.glow.material.opacity = fl * 1.7; } }
    for (i = 0; i < hole.flippers.length; i++) if (hole.flippers[i].mesh) hole.flippers[i].mesh.rotation.y = -hole.flippers[i].ang;
    for (i = 0; i < hole.windmills.length; i++) { var wmm = hole.windmills[i]; if (wmm.mesh) wmm.mesh.rotation.z = wmm.ang; if (wmm.flash > 0) wmm.flash -= 0.04; }
    for (i = 0; i < hole.lasers.length; i++) {
      var la = hole.lasers[i]; if (!la.mesh) continue; la.mesh.visible = true;
      var pp = ((St.t + la.phase * la.period) % la.period) / la.period, secToOn = pp < la.onFrac ? 0 : (1 - pp) * la.period, warn = !la.on && secToOn < 0.45;
      if (la.on) { la.mesh.material.emissiveIntensity = 1.1; la.mesh.material.opacity = .96; la.mesh.scale.set(1, 1, 1); }
      else if (warn) { var fl = 0.5 + 0.5 * Math.sin(St.t * 42); la.mesh.material.emissiveIntensity = .3 + fl * .85; la.mesh.material.opacity = .35 + fl * .45; var th = .5 + fl * .5; la.mesh.scale.set(th, 1, th); }   // charging-up warning flicker
      else { la.mesh.material.emissiveIntensity = .16; la.mesh.material.opacity = .26; la.mesh.scale.set(.38, 1, .38); }   // idle: thin dim line so you always see where the gate is
    }
    for (i = 0; i < (hole.firerings || []).length; i++) { var fr = hole.firerings[i]; if (fr.mesh) { fr.mesh.material.emissiveIntensity = 0.7 + Math.sin(St.t * 20 + i) * 0.3 + (fr.flash || 0); var ffs = 1 + (fr.flash || 0) * 0.4; fr.mesh.scale.set(ffs, ffs, ffs); if (fr.flash > 0) fr.flash -= 0.04; } }
    for (i = 0; i < (hole.coins || []).length; i++) { var cn = hole.coins[i]; if (cn.mesh) { cn.mesh.visible = !cn.got; cn.mesh.rotation.y = St.t * 3.4; cn.mesh.position.y = hole.terrain(cn.x, cn.z) + 40 + Math.sin(St.t * 3 + cn.x * 0.01) * 4; } }
    for (i = 0; i < (hole.powerups || []).length; i++) { var pu = hole.powerups[i]; if (pu.mesh) { pu.mesh.visible = !pu.got; pu.mesh.rotation.y = St.t * 2.4; pu.mesh.rotation.x = St.t * 1.3; pu.mesh.position.y = hole.terrain(pu.x, pu.z) + 48 + Math.sin(St.t * 2.6 + pu.x * 0.01) * 5; } if (pu.halo) pu.halo.visible = !pu.got; }
    for (i = 0; i < (hole.enemies || []).length; i++) { var en = hole.enemies[i]; if (en.mesh) { en.mesh.position.set(en.cx, hole.terrain(en.cx, en.cz), en.cz); en.mesh.rotation.y = St.t * 2.4; var ws = en.flash > 0 ? 1 + en.flash : 1; en.mesh.scale.set(ws, ws, ws); if (en.flash > 0) en.flash -= 0.04; } }
    for (i = 0; i < (hole.portals || []).length; i++) { var po = hole.portals[i]; if (po.flash > 0) po.flash -= 0.04; }
    if (R3.flag) R3.flag.rotation.y = Math.sin(St.t * 1.5) * .3;
    if (R3.cupGlow) { var pu = 0.5 + 0.5 * Math.sin(St.t * 2.3); R3.cupGlow.scale.set(1 + pu * 0.55, 1 + pu * 0.55, 1); R3.cupGlow.material.opacity = 0.2 + pu * 0.34; }
  }
  function rrect(c, a, b, w, h, r) { c.beginPath(); c.moveTo(a + r, b); c.arcTo(a + w, b, a + w, b + h, r); c.arcTo(a + w, b + h, a, b + h, r); c.arcTo(a, b + h, a, b, r); c.arcTo(a, b, a + w, b, r); c.closePath(); }
  function panel(c, x, y, w, h) { var g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#5c3c23'); g.addColorStop(1, '#321e10'); rrect(c, x, y, w, h, 10); c.fillStyle = g; c.fill(); c.strokeStyle = COL.gold; c.lineWidth = 3; c.stroke(); }
  function drawHUD() {
    var c = St.hctx, w = St.w, h = St.h; c.setTransform(St.dpr, 0, 0, St.dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (St.state === 'load') return;
    syncMeshes(); placeCam(); R3.r.render(R3.scene, R3.cam);
    var i, b = primeBall();
    if (St.trail.length > 1) { c.lineCap = 'round'; for (i = 1; i < St.trail.length; i++) { var ta = project(St.trail[i - 1].x, St.trail[i - 1].y, St.trail[i - 1].z), tb = project(St.trail[i].x, St.trail[i].y, St.trail[i].z); if (!ta.vis || !tb.vis) continue; var al = i / St.trail.length; c.strokeStyle = 'rgba(255,240,180,' + (al * .5).toFixed(2) + ')'; c.lineWidth = al * 11; c.beginPath(); c.moveTo(ta.x, ta.y); c.lineTo(tb.x, tb.y); c.stroke(); } }
    if (St.magnetT > 0 && b) drawMagnetPull(c, b);
    if (St.shocks) for (i = 0; i < St.shocks.length; i++) { var sw = St.shocks[i], sf = sw.t / sw.max, wr = 14 + sf * (sw.rmax || 165), ccs = project(sw.x, sw.y, sw.z), exs = project(sw.x + wr, sw.y, sw.z), ezs = project(sw.x, sw.y, sw.z + wr); if (!ccs.vis) continue; var rx = hyp(exs.x - ccs.x, exs.y - ccs.y), rz = hyp(ezs.x - ccs.x, ezs.y - ccs.y); c.globalAlpha = clamp(1 - sf, 0, 1) * 0.65; c.strokeStyle = sw.col; c.lineWidth = 2 + (1 - sf) * 3; c.beginPath(); if (c.ellipse) c.ellipse(ccs.x, ccs.y, Math.max(rx, 1), Math.max(rz, 1), 0, 0, TAU); else c.arc(ccs.x, ccs.y, Math.max(rx, 1), 0, TAU); c.stroke(); } c.globalAlpha = 1;
    for (i = 0; i < St.fx.length; i++) { var p = St.fx[i], s = project(p.x, p.y, p.z); if (!s.vis) continue; c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.col || (p.gold ? COL.gold : '#fff0c0'); c.beginPath(); c.arc(s.x, s.y, p.r || (p.gold ? 4 : 2.4), 0, TAU); c.fill(); } c.globalAlpha = 1;
    c.textAlign = 'center'; for (i = 0; i < St.pops.length; i++) { var q = St.pops[i], qs = project(q.x, q.y, q.z); if (!qs.vis) continue; c.globalAlpha = clamp(q.life / q.max, 0, 1); c.font = '900 26px Wantedo, Georgia'; c.lineWidth = 4; c.strokeStyle = COL.ink; c.strokeText(q.text, qs.x, qs.y); c.fillStyle = q.col; c.fillText(q.text, qs.x, qs.y); } c.globalAlpha = 1;
    if (St.state === 'aim' && b) drawAim(c, b);
    // panels
    // panels — responsive so they never overlap on narrow screens
    var narrow = w < 720, lw = narrow ? Math.max(150, Math.min(236, w - 142)) : 250, rw = narrow ? 122 : 156;
    panel(c, 12, 12, lw, 58); c.textAlign = 'left'; c.fillStyle = COL.gold; c.font = '900 10px Wantedo, Georgia';
    var topLine = St.hi >= 0 ? ('HOLE ' + (St.hi + 1) + ' / ' + HOLES.length + (narrow ? '' : ('  ·  ' + St.hole.name)) + '  ·  PAR ' + St.hole.par) : ('★ ' + (St.customName || St.hole.name));
    c.fillText(topLine, 24, 30); c.fillStyle = COL.cream; c.font = 'bold 22px Georgia'; c.fillText(St.strokes + (St.strokes === 1 ? ' STROKE' : ' STROKES'), 24, 54);
    if (St.holeBest != null) { c.textAlign = 'right'; c.fillStyle = COL.gold; c.font = 'bold 11px Georgia'; c.fillText('★ BEST ' + St.holeBest, 12 + lw - 11, 50); c.textAlign = 'left'; }
    panel(c, w - rw - 12, 12, rw, 58); c.textAlign = 'right'; c.fillStyle = COL.gold; c.font = '900 10px Wantedo, Georgia'; c.fillText('TO PIN', w - 24, 30); var dp = b ? Math.round(hyp(b.x - St.hole.cup.x, b.z - St.hole.cup.z)) : 0; c.fillStyle = COL.cream; c.font = 'bold ' + (narrow ? 18 : 22) + 'px Georgia'; c.fillText(dp + ' yd', w - 24, 54);
    // running to-par score (progression) — only when there's room between the two side panels
    var tot = St.scores.reduce(function (a, cv) { return a + (cv || 0); }, 0), tp = tot - (St.parDone || 0);
    if (!narrow) { panel(c, w / 2 - 78, 12, 156, 40); c.textAlign = 'center'; c.fillStyle = COL.cream; c.font = 'bold 15px Georgia'; c.fillText('THRU ' + St.hi + '  ·  ' + tot + '  (' + (tp > 0 ? '+' + tp : tp === 0 ? 'E' : tp) + ')', w / 2, 38); }
    if ((St.coins || 0) > 0 || (St.points || 0) > 0) { var cpx = narrow ? 12 : (w / 2 - 78), cpw = narrow ? lw : 156, cpy = narrow ? 76 : 56; panel(c, cpx, cpy, cpw, 30); c.textAlign = 'center'; var cpz = 1 + (St.coinPulse || 0) * 0.7, ccx = cpx + cpw / 2; c.save(); c.translate(ccx, cpy + 20); c.scale(cpz, cpz); c.fillStyle = (St.coinPulse || 0) > 0.25 ? '#fff0a0' : COL.gold; c.font = 'bold 14px Georgia'; c.fillText('🪙 ' + (St.coins || 0) + '      ★ ' + (St.points || 0), 0, 0); c.restore(); }
    // active power-up badges
    var badges = []; var pball = primeBall();
    if (St.magnetT > 0) badges.push(['MAGNET ' + St.magnetT.toFixed(1) + 's', '#ff4477']);
    if (St.slowT > 0) badges.push(['SLOW-MO ' + St.slowT.toFixed(1) + 's', '#9b6bff']);
    if (pball && pball.shield) badges.push(['SHIELD', '#33b6ff']);
    if (badges.length) { var by = (narrow && ((St.coins || 0) > 0 || (St.points || 0) > 0)) ? 114 : 96; badges.forEach(function (bd, bi) { var bw = 132, bx = w / 2 - bw / 2; panel(c, bx, by + bi * 26, bw, 22); c.textAlign = 'center'; c.fillStyle = bd[1]; c.font = '900 12px Wantedo, Georgia'; c.fillText('✦ ' + bd[0], w / 2, by + bi * 26 + 16); }); }
    // bumper-combo meter — pulsing multiplier while the ball racks up hits this shot
    if (St.state === 'roll' && (St.combo || 0) >= 2) { var cpz = 1 + (St.comboPulse || 0) * 0.5; c.save(); c.translate(w / 2, h * 0.3); c.scale(cpz, cpz); c.textAlign = 'center'; c.globalAlpha = clamp(0.5 + (St.comboPulse || 0) * 1.1, 0, 1); var ctxt = 'COMBO ×' + St.combo; c.font = '900 ' + (narrow ? 26 : 34) + 'px Wantedo, Georgia'; c.lineWidth = 5; c.strokeStyle = COL.ink; c.strokeText(ctxt, 0, 0); c.fillStyle = St.combo >= 5 ? COL.red : COL.gold; c.fillText(ctxt, 0, 0); c.restore(); c.globalAlpha = 1; }
    c.textAlign = 'left'; c.fillStyle = COL.gold; c.font = '900 14px Georgia'; c.fillText(BUILD, 18, h - 26);
    if (St.state === 'aim') powerMeter(c, w, h);
    if (St.bannerT > 0) { c.globalAlpha = clamp(St.bannerT, 0, 1); c.textAlign = 'center'; c.font = '42px Wantedo, Georgia'; c.fillStyle = COL.ink; c.fillText(St.banner, w / 2 + 2, h * .4 + 2); c.fillStyle = COL.gold; c.fillText(St.banner, w / 2, h * .4); c.globalAlpha = 1; }
    c.textAlign = 'center'; c.fillStyle = 'rgba(245,239,220,.9)'; c.font = 'italic 13px Georgia';
    if (St.state === 'aim') c.fillText('DRAG: left/right to AIM, down for POWER · release to shoot · ⟲ ⟳ turn view', w / 2, h - 14);
    else if (St.state === 'roll') c.fillText('TAP left / right (or A / D) to fire the flippers', w / 2, h - 14);
  }
  // simulate the shot forward (gravity, terrain, roll friction, wall bounces) so the aim guide shows the real path + bank shots
  function predictPath(b, power) {
    var f = aimDir(), v = lerp(K.shotMin, K.shotMax, power * power), hole = St.hole, bn = hole.bounds;
    var x = b.x, z = b.z, y = b.y, vx = f.x * v, vz = f.z * v, vy = 0, dt = 1 / 90, pts = [{ x: x, y: y, z: z }], bounces = 0, walls = hole.walls;
    for (var step = 0; step < 150 && bounces < 4; step++) {
      vy -= K.g * dt; vx *= (1 - K.airDrag * dt); vz *= (1 - K.airDrag * dt);
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (x < bn.minX + 12) { x = bn.minX + 12; vx = Math.abs(vx) * .5; bounces++; }
      else if (x > bn.maxX - 12) { x = bn.maxX - 12; vx = -Math.abs(vx) * .5; bounces++; }
      if (z < bn.minZ + 12) { z = bn.minZ + 12; vz = Math.abs(vz) * .5; bounces++; }
      else if (z > bn.maxZ - 12) { z = bn.maxZ - 12; vz = -Math.abs(vz) * .5; bounces++; }
      var gh = hole.terrain(x, z), surf = gh + K.R;
      if (y <= surf) { y = surf; if (vy < 0) vy = 0; var sp = Math.sqrt(vx * vx + vz * vz); if (sp > 0) { var ns = Math.max(0, sp - K.rollFric * dt), kf = ns / sp; vx *= kf; vz *= kf; } }
      for (var wi = 0; wi < walls.length; wi++) { var s = walls[wi]; if (y > gh + s.h - 4) continue; var cc = nearestOnSeg(x, z, s.ax, s.az, s.bx, s.bz), dx = x - cc.x, dz = z - cc.z, dd = Math.sqrt(dx * dx + dz * dz), R = K.R + K.wallHalf; if (dd < R) { var nx = dd > 1e-4 ? dx / dd : 0, nz = dd > 1e-4 ? dz / dd : -1; x = cc.x + nx * R; z = cc.z + nz * R; var vn = vx * nx + vz * nz; if (vn < 0) { var e = (s.e == null ? K.wallE : s.e); vx -= (1 + e) * vn * nx; vz -= (1 + e) * vn * nz; bounces++; } } }
      pts.push({ x: x, y: y, z: z });
      if (Math.sqrt(vx * vx + vz * vz) < 45 && y <= surf + 1) break;
    }
    return pts;
  }
  // magnet power-up: pulsing "tractor beam" from the ball to the cup so the pull is visible in-world (not just the HUD badge)
  function drawMagnetPull(c, b) {
    if (St.magnetT <= 0 || !b || !St.hole) return;
    var cup = St.hole.cup, bs = project(b.x, b.y + 10, b.z), cs = project(cup.x, St.hole.terrain(cup.x, cup.z) + 8, cup.z);
    if (!bs.vis || !cs.vis) return;
    var pulse = 0.5 + 0.5 * Math.sin(St.t * 7);
    c.save(); c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,68,119,' + (0.4 + pulse * 0.4).toFixed(2) + ')'; c.lineWidth = 3 + pulse * 2.2;
    c.setLineDash([9, 13]); c.lineDashOffset = -St.t * 70;            // dashes stream toward the cup
    c.beginPath(); c.moveTo(bs.x, bs.y); c.lineTo(cs.x, cs.y); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,68,119,' + (0.28 + pulse * 0.4).toFixed(2) + ')';   // pulsing ring on the cup
    c.beginPath(); c.arc(cs.x, cs.y, 7 + pulse * 7, 0, TAU); c.fill();
    c.restore();
  }
  function drawAim(c, b) {
    var bs = project(b.x, b.y, b.z); if (!bs.vis) return;
    var pts = predictPath(b, St.power), n = pts.length;
    // faint connecting line
    c.globalAlpha = .5; c.lineWidth = 3; c.lineCap = 'round'; c.strokeStyle = 'rgba(255,240,200,.45)'; c.beginPath(); var started = false;
    for (var i = 0; i < n; i++) { var s = project(pts[i].x, pts[i].y + 12, pts[i].z); if (!s.vis) { started = false; continue; } if (!started) { c.moveTo(s.x, s.y); started = true; } else c.lineTo(s.x, s.y); }
    c.stroke(); c.globalAlpha = 1;
    // dots along the path, green→gold→red, every few samples
    for (var j = 0; j < n; j += 3) { var sp2 = project(pts[j].x, pts[j].y + 12, pts[j].z); if (!sp2.vis) continue; var tt = j / (n - 1 || 1); c.globalAlpha = .92; c.fillStyle = tt < .5 ? COL.grn : tt < .82 ? COL.gold : COL.red; c.beginPath(); c.arc(sp2.x, sp2.y, 2.6 + (1 - tt) * 2.6, 0, TAU); c.fill(); }
    // arrowhead at the end
    if (n > 2) { var pe = project(pts[n - 1].x, pts[n - 1].y + 12, pts[n - 1].z), pp = project(pts[n - 2].x, pts[n - 2].y + 12, pts[n - 2].z); if (pe.vis && pp.vis) { c.save(); c.translate(pe.x, pe.y); c.rotate(Math.atan2(pe.y - pp.y, pe.x - pp.x)); c.fillStyle = COL.red; c.beginPath(); c.moveTo(11, 0); c.lineTo(-7, -7); c.lineTo(-7, 7); c.closePath(); c.fill(); c.restore(); } }
    c.globalAlpha = 1;
    if (St.drag && St.drag.pull > 5) { c.strokeStyle = 'rgba(255,238,196,.6)'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(bs.x, bs.y); c.lineTo(St.drag.sx, St.drag.sy); c.stroke(); c.fillStyle = St.power > .8 ? COL.red : 'rgba(255,238,196,.92)'; c.beginPath(); c.arc(St.drag.sx, St.drag.sy, 9, 0, TAU); c.fill(); }
  }
  function powerMeter(c, w, h) { var x = w / 2 - 120, y = h - 48, bw = 240, bh = 18; c.fillStyle = 'rgba(20,12,6,.7)'; rrect(c, x - 3, y - 3, bw + 6, bh + 6, 8); c.fill(); var g = c.createLinearGradient(x, 0, x + bw, 0); g.addColorStop(0, COL.grn); g.addColorStop(.6, COL.gold); g.addColorStop(1, COL.red); rrect(c, x, y, bw * St.power, bh, 7); c.fillStyle = g; c.fill(); c.strokeStyle = COL.gold; c.lineWidth = 2; rrect(c, x, y, bw, bh, 7); c.stroke(); c.fillStyle = COL.cream; c.font = 'bold 12px Georgia'; c.textAlign = 'center'; c.fillText('POWER ' + Math.round(St.power * 100) + '%', w / 2, y - 7); }

  /* ================================================================ input */
  function ptr(e) { var r = St.scene.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) { e.preventDefault(); audioInit(); if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume(); musicStart(); if (ED.on) { edDown(ptr(e), e.shiftKey); return; } var p = ptr(e); St.ptr = St.ptr || {}; if (St.state === 'aim') { St.drag = { x0: p.x, y0: p.y, sx: p.x, sy: p.y, pull: 0, yaw0: St.camYaw }; St.ptr[e.pointerId] = 'aim'; } else if (St.state === 'roll') { var side = p.x < St.w / 2 ? 'L' : 'R'; St.ptr[e.pointerId] = side; flipPress(side, true); } }
  function onMove(e) { if (ED.on) { ED.curS = ptr(e); if (ED.moving || ED.moving3d || ED.drawing || ED.erasing || ED.painting || ED.dragHandle || ED.camDrag) edMove(ED.curS); return; } if (!St.drag) return; var p = ptr(e); St.drag.sx = p.x; St.drag.sy = p.y; var dx = p.x - St.drag.x0, dy = p.y - St.drag.y0; St.aimYaw = St.drag.yaw0 - dx * 0.0048; St.drag.pull = Math.max(0, dy); St.power = clamp(St.drag.pull / K.pullPx, 0.05, 1); }
  function onUp(e) { if (ED.on) { edUp(); return; } if (St.ptr) { var role = St.ptr[e.pointerId]; if (role === 'L' || role === 'R') { delete St.ptr[e.pointerId]; var any = false; for (var k in St.ptr) if (St.ptr[k] === role) any = true; flipPress(role, any); return; } delete St.ptr[e.pointerId]; } if (!St.drag) return; var pull = St.drag.pull; St.drag = null; if (pull >= 14) shoot(); }
  function onKey(down, e) { var k = e.code; if (St.state === 'roll') { if (k === 'ArrowLeft' || k === 'KeyA') { flipPress('L', down); e.preventDefault(); } else if (k === 'ArrowRight' || k === 'KeyD') { flipPress('R', down); e.preventDefault(); } } else if (down && St.state === 'aim') { if (k === 'ArrowLeft' || k === 'KeyA') { St.camOrbit -= 0.06; e.preventDefault(); } else if (k === 'ArrowRight' || k === 'KeyD') { St.camOrbit += 0.06; e.preventDefault(); } } }

  /* ================================================================ LEVEL EDITOR */
  var ED = { on: false, brush: 'draw', sel: null, scale: 1, ox: 0, oz: 0, moving: false, seg: null, poly: null, drawing: null, erasing: false, painting: false, lastPaint: null, dragHandle: null, size: 240, smoothAmt: 2, dom: {}, curS: null, flash: null, undo: [], redo: [], snap: 20, snapOn: true, view3d: false, orb: { yaw: -0.5, pitch: 0.62, dist: 1.35 }, camDrag: null, palOpen: true, panelOpen: true };
  function edEnter3D() { var d = ED.draft; applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures); rebuildBox(d); (d.coins || []).forEach(function (c) { c.got = false; }); (d.powerups || []).forEach(function (p) { p.got = false; }); St.hole = d; St.hole.par = d.par; var t = d.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = d.terrain(t.x, t.z) + K.R; buildScene(d); clearBallMeshes(); ED.view3d = true; St.magnetT = 0; St.slowT = 0; }
  function edExit3D() { ED.view3d = false; ED.camDrag = null; ED.moving3d = false; }
  function orbitCam() {
    var bn = ED.draft.bounds, cx = (bn.minX + bn.maxX) / 2, cz = (bn.minZ + bn.maxZ) / 2, span = Math.max(bn.maxX - bn.minX, bn.maxZ - bn.minZ);
    var cy = ED.draft.terrain ? ED.draft.terrain(cx, cz) : 0, o = ED.orb, dist = span * o.dist, cp = Math.cos(o.pitch);
    R3.cam.position.set(cx + Math.sin(o.yaw) * dist * cp, cy + dist * Math.sin(o.pitch) + 120, cz + Math.cos(o.yaw) * dist * cp);
    R3.cam.lookAt(cx, cy + 40, cz); R3.cam.fov = 48; R3.cam.updateProjectionMatrix(); R3.cam.updateMatrixWorld();
    if (R3.sun) { R3.sun.position.set(cx + R3.sunOff.x, R3.sunOff.y, cz + R3.sunOff.z); R3.sun.target.position.set(cx, cy, cz); R3.sun.target.updateMatrixWorld(); }
  }
  function draw3DHud(c) {
    c.setTransform(St.dpr, 0, 0, St.dpr, 0, 0); c.clearRect(0, 0, St.w, St.h);
    if (ED.sel && ED.sel.x != null) {                       // highlight + label the selected item in 3D
      var sy = (St.hole && St.hole.terrain ? St.hole.terrain(ED.sel.x, ED.sel.z) : 0) + 44, pr = project(ED.sel.x, sy, ED.sel.z);
      if (pr.vis) {
        c.strokeStyle = COL.gold; c.lineWidth = 3; c.beginPath(); c.arc(pr.x, pr.y, 22, 0, TAU); c.stroke();
        var nm = (ED_INFO[ED.sel.kind] || { n: String(ED.sel.kind).toUpperCase() }).n;
        c.font = 'bold 12px Wantedo, Georgia'; c.textAlign = 'center'; var tw = c.measureText(nm).width;
        c.fillStyle = 'rgba(8,6,3,.82)'; c.fillRect(pr.x - tw / 2 - 7, pr.y - 46, tw + 14, 19);
        c.fillStyle = COL.gold; c.fillText(nm, pr.x, pr.y - 32);
      }
    }
    var hint = ED.sel ? '🧊 3D EDIT — drag the selected item to move · tap empty space to orbit · 🧊 for 2D' : '🧊 3D EDIT — tap an item to select & edit · drag empty space to orbit · scroll zoom · 🧊 for 2D';
    c.textAlign = 'center'; c.font = 'bold 14px Georgia'; c.fillStyle = COL.ink; c.fillText(hint, St.w / 2 + 1, St.h - 17); c.fillStyle = '#eafaff'; c.fillText(hint, St.w / 2, St.h - 18);
  }
  function edSnap(v) { return ED.snapOn ? Math.round(v / ED.snap) * ED.snap : Math.round(v); }
  function last(a) { return a[a.length - 1]; }
  function edSnapshot() { try { ED.undo.push(JSON.stringify(edSerialize())); if (ED.undo.length > 60) ED.undo.shift(); ED.redo.length = 0; } catch (e) {} }
  function edApply(json) { var keepBrush = ED.brush; ED.draft = edDeserialize(JSON.parse(json)); ED.sel = null; ED.brush = keepBrush; edPanel(); }
  function edUndo() { if (!ED.undo.length) return; ED.redo.push(JSON.stringify(edSerialize())); edApply(ED.undo.pop()); }
  function edRedo() { if (!ED.redo.length) return; ED.undo.push(JSON.stringify(edSerialize())); edApply(ED.redo.pop()); }
  function selectItem(it) { var L = edItems(); for (var i = 0; i < L.length; i++) if (L[i].item === it) { ED.sel = L[i]; edPanel(); return; } }
  function edDuplicate() { if (!ED.sel || !ED.sel.arr) return; edSnapshot(); var src = ED.sel.item, copy = JSON.parse(JSON.stringify(src)); if (copy.x != null) copy.x += 40; if (copy.z != null) copy.z += 40; if (copy.px != null) { copy.px += 40; copy.pz += 40; } if (copy.ax != null) { copy.ax += 40; copy.bx += 40; copy.az += 40; copy.bz += 40; } ED.sel.arr.push(copy); selectItem(copy); }
  var ED_TOOLS = [['select', 'Select / Move'], ['draw', '✏ DRAW LEVEL SHAPE'], ['erase', '🧽 Eraser (drag)'], ['tee', 'Tee'], ['cup', 'Cup'], ['wall', 'Wall (2 clicks)'], ['shape', 'Shape (click corners)'], ['bumper', 'Bumper'], ['booster', 'Booster'], ['flipL', 'Flipper L'], ['flipR', 'Flipper R'], ['windmill', 'Windmill'], ['loop', 'Loop-de-loop'], ['warp', 'Drop hole ⭳'], ['portal', 'Portal (teleport)'], ['firering', 'Fire Hoop 🔥'], ['enemy', 'Enemy 👾'], ['coin', 'Coin 🪙'], ['powerup', 'Power-up ✦'], ['laser', 'Laser (2 clicks)'], ['hill', 'Hill / Bank'], ['funnel', 'Funnel'], ['ramp', 'Ramp'], ['tier', 'Tier / Step ⤓'], ['raise', '⤒ Paint terrain UP'], ['lower', '⤓ Paint terrain DOWN']];
  var ED_PARAMS = { bumper: [['r', 'radius', 20, 90, 2], ['kick', 'bounce power', 600, 3200, 50]], booster: [['ang', 'angle', -3.14, 3.14, 0.05], ['spd', 'speed', 1200, 6000, 100], ['r', 'radius', 60, 260, 10]], flipper: [['len', 'length', 90, 220, 5], ['rot', 'rotation', -3.14, 3.14, 0.1], ['speed', 'paddle speed', 0.3, 3, 0.1], ['power', 'flip power', 800, 4000, 100]], windmill: [['r', 'radius', 90, 360, 10], ['n', 'blades', 2, 8, 1], ['speed', 'spin', -3, 3, 0.1]], laser: [['period', 'period', 0.8, 5, 0.1], ['onFrac', 'on-frac', 0.1, 0.9, 0.05], ['phase', 'phase', 0, 2, 0.1]], loop: [['r', 'radius', 80, 220, 10], ['ang', 'angle', -3.14, 3.14, 0.05]], warp: [['r', 'radius', 30, 90, 4]], portal: [['r', 'radius', 30, 80, 4]], firering: [['r', 'radius', 60, 200, 10], ['h', 'height off ground', 60, 320, 10], ['points', 'points', 10, 500, 10]], enemy: [['type', 'type', 'select', ['spiky', 'blob', 'ghost']], ['behavior', 'behavior', 'select', ['patrol', 'chase', 'static']], ['effect', 'on hit', 'select', ['knockback', 'reset', 'stun']], ['r', 'size', 24, 90, 4], ['speed', 'speed', 0.2, 2.5, 0.1]], coin: [['value', 'coin value', 1, 20, 1]], powerup: [['kind', 'effect', 'select', ['magnet', 'shield', 'slow', 'gem', 'jump']]], wall: [['e', 'bounce', 0, 1, 0.05], ['h', 'height', 20, 240, 4]], hill: [['rad', 'radius', 120, 800, 20], ['h', 'height', -300, 300, 10]], funnel: [['rad', 'radius', 120, 900, 20], ['depth', 'depth', 40, 400, 10]], ramp: [['z0', 'start-z', -40, 3200, 20], ['z1', 'end-z', -40, 3200, 20], ['h', 'height', 40, 260, 10]], tier: [['h', 'step height (− lower)', -320, 320, 10]] };
  var ED_INFO = { bumper: { n: 'BUMPER', a: 'Kicks the ball away and builds a combo. Higher bounce power = bigger launch.' }, booster: { n: 'BOOSTER', a: 'Flings the ball in a fixed direction at a set speed. Place one before a loop or jump.' }, flipper: { n: 'FLIPPER', a: 'Tap your side of the screen while rolling to flip. ROTATE it to aim any way (even horizontal levels), set paddle SPEED and flip POWER.' }, windmill: { n: 'WINDMILL', a: 'Spinning blades swat the ball. More blades or faster spin = harder to pass.' }, loop: { n: 'LOOP-DE-LOOP', a: 'Ball rides up and over a vertical loop, exits boosted. Needs speed to enter.' }, warp: { n: 'DROP HOLE ⭳', a: 'Roll the ball in and it falls out the linked GREEN exit — drag the green ring to a lower tier to build two-level holes.' }, warpExit: { n: 'DROP EXIT', a: 'Where the drop hole spits the ball out. Drag it onto the lower tier / cup area.' }, portal: { n: 'PORTAL', a: 'Teleports the ball, keeping its speed. Add 2+ exits and it pops out a RANDOM one each time — drag each exit anywhere, even other tiers.' }, portalExit: { n: 'PORTAL EXIT', a: 'One possible exit. With 2+ exits the ball comes out a random one. Drag it; use +add exit / −remove to change how many.' }, firering: { n: 'FIRE HOOP 🔥', a: 'A vertical flaming ring up in the air — JUMP the ball through the opening (off a ramp, loop or booster) to score its points. Set its height + points.' }, enemy: { n: 'ENEMY 👾', a: 'Pick its TYPE (spiky/blob/ghost), BEHAVIOR (patrol / chase the ball / hold still) and EFFECT on hit: knockback (pings you away), reset (hard repel — knocks you back the way you came), or stun (brief freeze). None of them send you back to the start. Drag the red marker to set its patrol path.' }, enemyEnd: { n: 'ENEMY PATH END', a: 'The far end of the enemy patrol. Drag to set how far it roams.' }, coin: { n: 'COIN 🪙', a: 'Roll over it to grab it — worth its value. Lay trails of coins for a Sonic-style rush.' }, powerup: { n: 'POWER-UP ✦', a: 'Roll over it to grab a beneficial effect. Pick the KIND: magnet (pulls you to the cup), shield (blocks the next hazard), slow-mo (bullet-time through gates), gem (bonus points), or jump (pops the ball up to hop walls).' }, tier: { n: 'TIER / STEP ⤓', a: 'Drops (negative height) or raises (positive) the whole green PAST this line — makes a lower or upper level. Drop a hole to fall onto it, or a ramp to climb back up. Drag to move the line.' }, laser: { n: 'LASER GATE', a: 'A TIMED GATE. You always see it (it flickers as it charges up); when the beam is ON it is a solid barrier that bounces the ball back. Time your run through the OFF window. period = cycle length, on-frac = how much of the cycle it is ON, phase = offset (stagger multiple lasers).' }, wall: { n: 'WALL', a: 'A solid barrier. Bounce sets how lively it is; height blocks airborne balls.' }, hill: { n: 'HILL / BANK', a: 'Bumps the ground up (or down with negative height) so the ball rolls off the slope.' }, funnel: { n: 'FUNNEL', a: 'A bowl that draws the ball toward its center — a tricky approach to the cup.' }, ramp: { n: 'RAMP / JUMP', a: 'A raised plateau across the lane between start-z and end-z — launch the ball over a gap.' }, tee: { n: 'TEE (start)', a: 'Where the ball starts each shot. Drag to reposition.' }, cup: { n: 'CUP (hole)', a: 'Sink the ball here to finish the level. Cup size is in the Physics panel.' } };
  function rebuildBox(d) { d.walls = d.walls.filter(function (w) { return !w._bnd; }); if (d.noBox) return; var bn = d.bounds, bh = d.wallH || 52;[[bn.minX, bn.minZ, bn.maxX, bn.minZ], [bn.maxX, bn.minZ, bn.maxX, bn.maxZ], [bn.maxX, bn.maxZ, bn.minX, bn.maxZ], [bn.minX, bn.maxZ, bn.minX, bn.minZ]].forEach(function (s) { d.walls.push({ ax: s[0], az: s[1], bx: s[2], bz: s[3], e: K.wallE, h: bh, c: 0x8a5a32, _bnd: true }); }); }
  function newDraft() { var d = builder(); d.name = 'MY LEVEL'; d.par = 3; d.bounds = { minX: -420, maxX: 420, minZ: -40, maxZ: 1680 }; d.tee = { x: 0, z: 90 }; d.cup = { x: 0, z: 1520 }; d.theme = 'grass'; d.phys = themePhys('grass'); d.turf = THEMES.grass.turf; rebuildBox(d); return d; }
  function edFit() { var bn = ED.draft.bounds, pL = ED.palOpen === false ? 16 : 214, pR = ED.panelOpen === false ? 16 : 214, pT = 64, pB = 58; var aw = St.w - pL - pR, ah = St.h - pT - pB; ED.scale = Math.min(aw / (bn.maxX - bn.minX), ah / (bn.maxZ - bn.minZ)); ED.ox = pL + (aw - (bn.maxX - bn.minX) * ED.scale) / 2; ED.oz = pT + (ah - (bn.maxZ - bn.minZ) * ED.scale) / 2; }
  function edTogglePanel(which) {
    if (which === 'pal') { ED.palOpen = !ED.palOpen; if (ED.dom.pal) ED.dom.pal.style.display = ED.palOpen ? '' : 'none'; }
    else { ED.panelOpen = !ED.panelOpen; if (ED.dom.panel) ED.dom.panel.style.display = ED.panelOpen ? '' : 'none'; }
    if (ED.dom.btnPal) ED.dom.btnPal.style.background = ED.palOpen ? 'linear-gradient(180deg,#6a4628,#3a2614)' : 'linear-gradient(180deg,#2a2a2a,#161616)';
    if (ED.dom.btnPanel) ED.dom.btnPanel.style.background = ED.panelOpen ? 'linear-gradient(180deg,#6a4628,#3a2614)' : 'linear-gradient(180deg,#2a2a2a,#161616)';
  }
  function edToolbarLabels() { var icon = (St.w || window.innerWidth) < 820; (ED.dom.topBtns || []).forEach(function (b) { var nt = icon ? b._icon : b._full; if (b.textContent !== nt) b.textContent = nt; }); }   // icon-only toolbar on narrow screens so every button (incl Exit) fits
  function edClearAll() {   // wipe all placed obstacles/items but keep the level shape (walls), tee, cup, bounds, theme
    edSnapshot(); var d = ED.draft;
    ['bumpers', 'boosters', 'flippers', 'windmills', 'lasers', 'loops', 'warps', 'portals', 'firerings', 'enemies', 'coins', 'powerups'].forEach(function (k) { d[k] = []; });
    d.terrainFeatures = d.terrainFeatures.filter(function (t) { return t.kind === 'slope'; });
    ED.sel = null; edHi(); edPanel(); edToast('Cleared all items');
  }
  function edW2S(x, z) { var bn = ED.draft.bounds; return { x: ED.ox + (x - bn.minX) * ED.scale, y: ED.oz + (bn.maxZ - z) * ED.scale }; }
  function edS2W(sx, sy) { var bn = ED.draft.bounds; return { x: (sx - ED.ox) / ED.scale + bn.minX, z: bn.maxZ - (sy - ED.oz) / ED.scale }; }
  function edItems() {
    var d = ED.draft, L = [];
    d.bumpers.forEach(function (it, i) { L.push({ kind: 'bumper', item: it, x: it.x, z: it.z, arr: d.bumpers, idx: i }); });
    d.boosters.forEach(function (it, i) { L.push({ kind: 'booster', item: it, x: it.x, z: it.z, arr: d.boosters, idx: i }); });
    d.flippers.forEach(function (it, i) { L.push({ kind: 'flipper', item: it, x: it.px, z: it.pz, arr: d.flippers, idx: i }); });
    d.windmills.forEach(function (it, i) { L.push({ kind: 'windmill', item: it, x: it.x, z: it.z, arr: d.windmills, idx: i }); });
    d.loops.forEach(function (it, i) { L.push({ kind: 'loop', item: it, x: it.x, z: it.z, arr: d.loops, idx: i }); });
    d.warps.forEach(function (it, i) { L.push({ kind: 'warp', item: it, x: it.x, z: it.z, arr: d.warps, idx: i }); L.push({ kind: 'warpExit', item: it, x: it.ex, z: it.ez, arr: null, idx: i }); });
    d.portals.forEach(function (it, i) { L.push({ kind: 'portal', item: it, x: it.x, z: it.z, arr: d.portals, idx: i }); var pex = it.exits || (it.exits = [{ x: it.ex, z: it.ez }]); pex.forEach(function (e, j) { L.push({ kind: 'portalExit', item: it, exitIdx: j, x: e.x, z: e.z, arr: null, idx: i }); }); });
    d.firerings.forEach(function (it, i) { L.push({ kind: 'firering', item: it, x: it.x, z: it.z, arr: d.firerings, idx: i }); });
    d.enemies.forEach(function (it, i) { L.push({ kind: 'enemy', item: it, x: it.x, z: it.z, arr: d.enemies, idx: i }); L.push({ kind: 'enemyEnd', item: it, x: it.ex, z: it.ez, arr: null, idx: i }); });
    d.coins.forEach(function (it, i) { L.push({ kind: 'coin', item: it, x: it.x, z: it.z, arr: d.coins, idx: i }); });
    (d.powerups || []).forEach(function (it, i) { L.push({ kind: 'powerup', item: it, x: it.x, z: it.z, arr: d.powerups, idx: i }); });
    d.lasers.forEach(function (it, i) { L.push({ kind: 'laser', item: it, x: (it.ax + it.bx) / 2, z: (it.az + it.bz) / 2, arr: d.lasers, idx: i }); });
    d.walls.forEach(function (it, i) { if (it._bnd) return; L.push({ kind: 'wall', item: it, x: (it.ax + it.bx) / 2, z: (it.az + it.bz) / 2, arr: d.walls, idx: i }); });
    d.terrainFeatures.forEach(function (it, i) { if (it.kind === 'slope') return; var z = it.z != null ? it.z : (it.z0 != null ? (it.z0 + (it.z1 || it.z0)) / 2 : 0); L.push({ kind: it.kind, item: it, x: it.x || 0, z: z, arr: d.terrainFeatures, idx: i }); });
    if (d.multiball) L.push({ kind: 'multiball', item: d.multiball, x: d.multiball.x, z: d.multiball.z });
    L.push({ kind: 'tee', item: d.tee, x: d.tee.x, z: d.tee.z }); L.push({ kind: 'cup', item: d.cup, x: d.cup.x, z: d.cup.z });
    return L;
  }
  function edHit(wx, wz) { var L = edItems(), best = null, bd = 1e9; for (var i = 0; i < L.length; i++) { var it = L[i], dd; if ((it.kind === 'wall' || it.kind === 'laser') && it.item.ax != null) { var c = nearestOnSeg(wx, wz, it.item.ax, it.item.az, it.item.bx, it.item.bz); dd = hyp(wx - c.x, wz - c.z); } else dd = hyp(it.x - wx, it.z - wz); if (dd < bd) { bd = dd; best = it; } } return (best && bd < 34 / ED.scale) ? best : null; }
  // 3D editing: cast the click ray onto the level's ground plane to get a world (x,z), then pick the nearest item
  function ed3DToWorld(p) {
    if (!R3.cam) return null;
    var bn = ED.draft.bounds, cy = ED.draft.terrain ? ED.draft.terrain((bn.minX + bn.maxX) / 2, (bn.minZ + bn.maxZ) / 2) : 0;
    var ndcx = (p.x / St.w) * 2 - 1, ndcy = -(p.y / St.h) * 2 + 1;
    var ray = new T.Raycaster(); ray.setFromCamera({ x: ndcx, y: ndcy }, R3.cam);
    var plane = new T.Plane(new T.Vector3(0, 1, 0), -cy), pt = new T.Vector3();
    return ray.ray.intersectPlane(plane, pt) ? { x: pt.x, z: pt.z } : null;
  }
  function edHit3D(wx, wz) { var L = edItems(), best = null, bd = 1e9; for (var i = 0; i < L.length; i++) { var it = L[i], dd; if ((it.kind === 'wall' || it.kind === 'laser') && it.item.ax != null) { var c = nearestOnSeg(wx, wz, it.item.ax, it.item.az, it.item.bx, it.item.bz); dd = hyp(wx - c.x, wz - c.z); } else dd = hyp(it.x - wx, it.z - wz); if (dd < bd) { bd = dd; best = it; } } return (best && bd < 120) ? best : null; }
  function wallGroup(start) {
    var src = ED.draft.walls.filter(function (w) { return !w._bnd; }), EP = 30;
    function near(ax, az, bx, bz) { return Math.abs(ax - bx) < EP && Math.abs(az - bz) < EP; }
    function touch(a, b) { return near(a.ax, a.az, b.ax, b.az) || near(a.ax, a.az, b.bx, b.bz) || near(a.bx, a.bz, b.ax, b.az) || near(a.bx, a.bz, b.bx, b.bz); }
    var group = [start], changed = true, guard = 0;
    while (changed && guard++ < 4000) { changed = false; for (var i = 0; i < src.length; i++) { var w = src[i]; if (group.indexOf(w) >= 0) continue; for (var j = 0; j < group.length; j++) { if (touch(w, group[j])) { group.push(w); changed = true; break; } } } }
    return group;
  }
  function computeHandles(walls) {
    var EP = 26, verts = []; function find(x, z) { for (var i = 0; i < verts.length; i++) if (Math.abs(verts[i].x - x) < EP && Math.abs(verts[i].z - z) < EP) return verts[i]; return null; }
    walls.forEach(function (w) { var va = find(w.ax, w.az); if (!va) { va = { x: w.ax, z: w.az, ends: [] }; verts.push(va); } va.ends.push({ w: w, e: 'a' }); var vb = find(w.bx, w.bz); if (!vb) { vb = { x: w.bx, z: w.bz, ends: [] }; verts.push(vb); } vb.ends.push({ w: w, e: 'b' }); });
    var mids = walls.map(function (w) { return { w: w, x: (w.ax + w.bx) / 2, z: (w.az + w.bz) / 2 }; });
    return { verts: verts, mids: mids };
  }
  function refreshHandlePositions() { if (!ED.sel || ED.sel.kind !== 'wallgroup' || !ED.sel.handles) return; ED.sel.handles.mids.forEach(function (m) { m.x = (m.w.ax + m.w.bx) / 2; m.z = (m.w.az + m.w.bz) / 2; }); }
  function orderedChain(walls) {
    if (!walls.length) return { pts: [], closed: false, e: K.wallE, h: 46 };
    var EP = 30; function near(ax, az, bx, bz) { return Math.abs(ax - bx) < EP && Math.abs(az - bz) < EP; }
    var segs = walls.map(function (w) { return { a: { x: w.ax, z: w.az }, b: { x: w.bx, z: w.bz }, used: false }; });
    function deg(pt) { var n = 0; segs.forEach(function (s) { if (near(s.a.x, s.a.z, pt.x, pt.z) || near(s.b.x, s.b.z, pt.x, pt.z)) n++; }); return n; }
    var start = segs[0].a, i; for (i = 0; i < segs.length; i++) { if (deg(segs[i].a) === 1) { start = segs[i].a; break; } if (deg(segs[i].b) === 1) { start = segs[i].b; break; } }
    function findNext(pt) { for (var k = 0; k < segs.length; k++) { var s = segs[k]; if (s.used) continue; if (near(s.a.x, s.a.z, pt.x, pt.z)) return { s: s, end: s.b }; if (near(s.b.x, s.b.z, pt.x, pt.z)) return { s: s, end: s.a }; } return null; }
    var pts = [start], cur = start, nx, guard = 0; while ((nx = findNext(cur)) && guard++ < 4000) { nx.s.used = true; pts.push(nx.end); cur = nx.end; }
    var closed = pts.length > 2 && near(pts[0].x, pts[0].z, pts[pts.length - 1].x, pts[pts.length - 1].z); if (closed) pts.pop();
    return { pts: pts, closed: closed, e: walls[0].e, h: walls[0].h };
  }
  function applyPathSmooth(level) {
    if (!ED.sel || ED.sel.kind !== 'wallgroup' || !ED.sel.base) return;
    var d = ED.draft, base = ED.sel.base, closed = ED.sel.baseClosed, e = ED.sel.baseE, h = ED.sel.baseH;
    ED.sel.items.forEach(function (g) { var idx = d.walls.indexOf(g); if (idx >= 0) d.walls.splice(idx, 1); });
    var sm = level <= 0 ? base.slice() : (closed ? chaikinClosed(base, level) : chaikin(base, level));
    if (sm.length > 120) sm = simplifyPath(sm, 28);
    var newItems = []; for (var i = 0; i < sm.length - 1; i++) { d.wall(sm[i].x, sm[i].z, sm[i + 1].x, sm[i + 1].z, { e: e, h: h }); newItems.push(d.walls[d.walls.length - 1]); }
    if (closed) { d.wall(sm[sm.length - 1].x, sm[sm.length - 1].z, sm[0].x, sm[0].z, { e: e, h: h }); newItems.push(d.walls[d.walls.length - 1]); }
    ED.sel.items = newItems; ED.sel.handles = computeHandles(newItems);
  }
  function selectWallGroupAt(wx, wz, shift) {
    var hit = edHit(wx, wz); if (!hit) { ED.sel = null; return; }
    if (hit.kind === 'wall' && !shift) { var grp = wallGroup(hit.item), oc = orderedChain(grp); ED.sel = { kind: 'wallgroup', items: grp, x: wx, z: wz, arr: ED.draft.walls, handles: computeHandles(grp), base: oc.pts, baseClosed: oc.closed, baseE: oc.e, baseH: oc.h, smoothLevel: 0, snapped: false }; }
    else ED.sel = hit;   // shift-click (or non-wall) selects just the one item/segment
  }
  function edPlace(wx, wz) {
    var d = ED.draft; wx = edSnap(wx); wz = edSnap(wz); edSnapshot(); var it = null;
    if (ED.brush === 'tee') { d.tee.x = wx; d.tee.z = wz; }
    else if (ED.brush === 'cup') { d.cup.x = wx; d.cup.z = wz; }
    else if (ED.brush === 'bumper') { d.bumper(wx, wz, 44); it = last(d.bumpers); it.kick = K.bumpKick; }
    else if (ED.brush === 'booster') { d.booster(wx, wz, PI / 2, 120, 3200); it = last(d.boosters); }
    else if (ED.brush === 'flipL') { d.flip('L', wx, wz, 150); it = last(d.flippers); it.power = K.flipKick; }
    else if (ED.brush === 'flipR') { d.flip('R', wx, wz, 150); it = last(d.flippers); it.power = K.flipKick; }
    else if (ED.brush === 'windmill') { d.windmill(wx, wz, 200, 4, 1.8); it = last(d.windmills); }
    else if (ED.brush === 'loop') { d.loopde(wx, wz, 130, Math.atan2(d.cup.x - d.tee.x, d.cup.z - d.tee.z)); it = last(d.loops); }
    else if (ED.brush === 'warp') { d.warp(wx, wz, wx, wz + 420, 50); it = last(d.warps); }
    else if (ED.brush === 'portal') { d.portal(wx, wz, [{ x: wx + 320, z: wz - 200 }, { x: wx - 320, z: wz - 200 }], 46); it = last(d.portals); }
    else if (ED.brush === 'firering') { d.firering(wx, wz, 120, 170, 100); it = last(d.firerings); }
    else if (ED.brush === 'enemy') { d.enemy(wx, wz, wx + 420, wz, 42, 0.8); it = last(d.enemies); }
    else if (ED.brush === 'coin') { d.coin(wx, wz, 1); it = last(d.coins); }
    else if (ED.brush === 'powerup') { d.powerup(wx, wz, 'magnet'); it = last(d.powerups); }
    else if (ED.brush === 'hill') { d.hill(wx, wz, 320, 150); it = last(d.terrainFeatures); }
    else if (ED.brush === 'funnel') { d.funnel(wx, wz, 420, 200); it = last(d.terrainFeatures); }
    else if (ED.brush === 'ramp') { d.ramp(wz, wz + 280, 140, 9999, 50); it = last(d.terrainFeatures); }
    else if (ED.brush === 'tier') { d.tier(wz, -170, 9999); it = last(d.terrainFeatures); }
    ED.flash = { x: wx, z: wz, t: 0.35 };
    if (it) selectItem(it);
  }
  function paintAt(wx, wz, dir) {
    var d = ED.draft, tf = d.terrainFeatures, last = ED.lastPaint, rad = Math.max(60, ED.size / 2);
    if (last && hyp(wx - last.x, wz - last.z) < rad * 0.45) return;
    if (tf.filter(function (t) { return t.kind === 'hill'; }).length > 80) return;
    d.hill(Math.round(wx), Math.round(wz), rad, dir * 95);
    ED.lastPaint = { x: wx, z: wz }; ED.flash = { x: wx, z: wz, t: 0.2 };
  }
  function eraseAt(wx, wz) {
    var rad = ED.size / 2, L = edItems(), del = [];
    for (var i = 0; i < L.length; i++) { var it = L[i]; if (!it.arr) continue; var dd; if ((it.kind === 'wall' || it.kind === 'laser') && it.item.ax != null) { var c = nearestOnSeg(wx, wz, it.item.ax, it.item.az, it.item.bx, it.item.bz); dd = hyp(wx - c.x, wz - c.z); } else dd = hyp(it.x - wx, it.z - wz); if (dd < rad) del.push(it); }
    del.forEach(function (it) { var idx = it.arr.indexOf(it.item); if (idx >= 0) it.arr.splice(idx, 1); if (ED.sel && ED.sel.item === it.item) ED.sel = null; });
    if (del.length) ED.flash = { x: wx, z: wz, t: 0.25 };
    return del.length > 0;
  }
  function edDown(p, shift) {
    if (ED.view3d) {
      var w3 = ed3DToWorld(p), hit3 = w3 ? edHit3D(w3.x, w3.z) : null;
      if (hit3) {
        if (hit3.kind === 'wall' || hit3.kind === 'laser') { selectWallGroupAt(hit3.x, hit3.z, shift); } else { ED.sel = hit3; }
        if (ED.sel) { edSnapshot(); ED.moving3d = true; edHi(); edPanel(); }
        return;
      }
      ED.sel = null; edPanel(); ED.camDrag = { x: p.x, y: p.y, yaw: ED.orb.yaw, pitch: ED.orb.pitch }; return;
    }
    if (ED.brush === 'draw') { edSnapshot(); var wr = edS2W(p.x, p.y); ED.drawing = [{ x: wr.x, z: wr.z }]; return; }
    if (ED.brush === 'erase') { edSnapshot(); ED.erasing = true; var we = edS2W(p.x, p.y); eraseAt(we.x, we.z); edPanel(); return; }
    if (ED.brush === 'raise' || ED.brush === 'lower') { edSnapshot(); ED.painting = true; ED.lastPaint = null; var wp2 = edS2W(p.x, p.y); paintAt(wp2.x, wp2.z, ED.brush === 'raise' ? 1 : -1); return; }
    var w = edS2W(p.x, p.y); w.x = edSnap(w.x); w.z = edSnap(w.z);
    if (ED.brush === 'wall' || ED.brush === 'laser') {
      if (!ED.seg) { ED.seg = { sx: w.x, sz: w.z }; }
      else { var d = ED.draft; edSnapshot(); if (ED.brush === 'wall') { d.wall(ED.seg.sx, ED.seg.sz, w.x, w.z, { e: K.wallE, h: 80 }); selectWallGroupAt(w.x, w.z, false); edPanel(); } else { d.lasers.push({ ax: ED.seg.sx, az: ED.seg.sz, bx: w.x, bz: w.z, period: 2.2, onFrac: 0.45, phase: 0, on: false }); } ED.seg = null; ED.flash = { x: w.x, z: w.z, t: 0.35 }; }
      return;
    }
    if (ED.brush === 'shape') {
      if (!ED.poly) ED.poly = [];
      if (ED.poly.length >= 3 && hyp(w.x - ED.poly[0].x, w.z - ED.poly[0].z) < 40 / ED.scale) { edClosePoly(); }
      else ED.poly.push({ x: w.x, z: w.z });
      return;
    }
    if (ED.brush === 'select') {
      if (ED.sel && ED.sel.kind === 'wallgroup' && ED.sel.handles) {
        var thr = 18 / ED.scale, H = ED.sel.handles, gi;
        for (gi = 0; gi < H.verts.length; gi++) { if (hyp(H.verts[gi].x - w.x, H.verts[gi].z - w.z) < thr) { edSnapshot(); ED.dragHandle = { v: H.verts[gi] }; return; } }
        for (gi = 0; gi < H.mids.length; gi++) { var m = H.mids[gi]; if (hyp(m.x - w.x, m.z - w.z) < thr) { edSnapshot(); var ww = m.w, d2 = ED.draft, nb = { ax: w.x, az: w.z, bx: ww.bx, bz: ww.bz, e: ww.e, h: ww.h, c: ww.c }; ww.bx = w.x; ww.bz = w.z; d2.walls.push(nb); ED.sel.items.push(nb); ED.sel.handles = computeHandles(ED.sel.items); var nv = null; ED.sel.handles.verts.forEach(function (v) { if (Math.abs(v.x - w.x) < 6 && Math.abs(v.z - w.z) < 6) nv = v; }); if (nv) ED.dragHandle = { v: nv }; return; } }
      }
      selectWallGroupAt(w.x, w.z, shift); ED.moving = !!ED.sel; if (ED.sel) edSnapshot(); edPanel(); return;
    }
    edPlace(w.x, w.z);
  }
  function edClosePoly() { if (!ED.poly || ED.poly.length < 2) { ED.poly = null; return; } edSnapshot(); var d = ED.draft, p = ED.poly; for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; d.wall(a.x, a.z, b.x, b.z, { e: K.wallE, h: 80 }); } selectWallGroupAt(p[0].x, p[0].z, false); ED.flash = { x: p[0].x, z: p[0].z, t: 0.35 }; ED.poly = null; edPanel(); }
  function edMove(p) {
    if (ED.view3d) {
      if (ED.moving3d && ED.sel) { var w3m = ed3DToWorld(p); if (w3m) { moveSelTo(edSnap(w3m.x), edSnap(w3m.z)); } return; }
      if (ED.camDrag) { ED.orb.yaw = ED.camDrag.yaw - (p.x - ED.camDrag.x) * 0.008; ED.orb.pitch = clamp(ED.camDrag.pitch + (p.y - ED.camDrag.y) * 0.006, 0.12, 1.45); } return;
    }
    if (ED.dragHandle) { var wh = edS2W(p.x, p.y); wh.x = edSnap(wh.x); wh.z = edSnap(wh.z); var v = ED.dragHandle.v; v.ends.forEach(function (en) { if (en.e === 'a') { en.w.ax = wh.x; en.w.az = wh.z; } else { en.w.bx = wh.x; en.w.bz = wh.z; } }); v.x = wh.x; v.z = wh.z; refreshHandlePositions(); return; }
    if (ED.brush === 'draw' && ED.drawing) { var wr = edS2W(p.x, p.y), lp = ED.drawing[ED.drawing.length - 1], ls = edW2S(lp.x, lp.z); if (hyp(p.x - ls.x, p.y - ls.y) > 10) ED.drawing.push({ x: wr.x, z: wr.z }); return; }
    if (ED.brush === 'erase' && ED.erasing) { var wq = edS2W(p.x, p.y); eraseAt(wq.x, wq.z); return; }
    if ((ED.brush === 'raise' || ED.brush === 'lower') && ED.painting) { var wp3 = edS2W(p.x, p.y); paintAt(wp3.x, wp3.z, ED.brush === 'raise' ? 1 : -1); return; }
    if (!(ED.brush === 'select' && ED.moving && ED.sel)) return;
    var w = edS2W(p.x, p.y); w.x = edSnap(w.x); w.z = edSnap(w.z);
    moveSelTo(w.x, w.z);
  }
  function moveSelTo(wx, wz) {
    if (!ED.sel) return;
    if (ED.sel.kind === 'wallgroup') { var gdx = wx - ED.sel.x, gdz = wz - ED.sel.z; ED.sel.items.forEach(function (g) { g.ax += gdx; g.bx += gdx; g.az += gdz; g.bz += gdz; }); ED.sel.x = wx; ED.sel.z = wz; return; }
    var it = ED.sel.item;
    if (ED.sel.kind === 'flipper') { it.px = wx; it.pz = wz; }
    else if (ED.sel.kind === 'warpExit' || ED.sel.kind === 'enemyEnd') { it.ex = wx; it.ez = wz; ED.sel.x = wx; ED.sel.z = wz; }
    else if (ED.sel.kind === 'portalExit') { var pex = it.exits || (it.exits = [{ x: it.ex, z: it.ez }]); pex[ED.sel.exitIdx] = { x: wx, z: wz }; ED.sel.x = wx; ED.sel.z = wz; }
    else if (ED.sel.kind === 'tier') { it.z0 = wz; ED.sel.z = wz; }
    else if (ED.sel.kind === 'ramp') { var rdz = wz - ED.sel.z; it.z0 += rdz; it.z1 += rdz; ED.sel.z = wz; }
    else if (ED.sel.kind === 'wall' || ED.sel.kind === 'laser') { var dx = wx - ED.sel.x, dz = wz - ED.sel.z; it.ax += dx; it.bx += dx; it.az += dz; it.bz += dz; ED.sel.x = wx; ED.sel.z = wz; }
    else { it.x = wx; it.z = wz; ED.sel.x = it.x; ED.sel.z = it.z; }
  }
  function edUp() { if (ED.moving3d) { ED.moving3d = false; edPanel(); return; } if (ED.camDrag) { ED.camDrag = null; return; } ED.moving = false; if (ED.dragHandle) { ED.dragHandle = null; edPanel(); } if (ED.erasing) { ED.erasing = false; edPanel(); } if (ED.painting) { ED.painting = false; edPanel(); } if (ED.brush === 'draw' && ED.drawing) edFinishDraw(); }
  function simplifyPath(pts, minD) { if (pts.length < 4) return pts; var out = [pts[0]]; for (var i = 1; i < pts.length - 1; i++) { var l = out[out.length - 1]; if (hyp(pts[i].x - l.x, pts[i].z - l.z) >= minD) out.push(pts[i]); } out.push(pts[pts.length - 1]); return out; }
  function edFinishDraw() {
    var pts = ED.drawing; ED.drawing = null; if (!pts || pts.length < 2) { edPanel(); return; }
    pts = simplifyPath(pts, 42);
    var d = ED.draft, existing = d.walls.filter(function (w) { return !w._bnd; }).length, i;
    d.noBox = true; d.walls = d.walls.filter(function (w) { return !w._bnd; });
    // single-line wall following the exact path. Only close if the ends actually meet — never force it.
    var closed = pts.length > 3 && hyp(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 55;
    for (i = 0; i < pts.length - 1; i++) d.wall(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, { e: K.wallE, h: 80 });
    if (closed) d.wall(pts[pts.length - 1].x, pts[pts.length - 1].z, pts[0].x, pts[0].z, { e: K.wallE, h: 80 });
    var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; pts.forEach(function (p) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z; });
    var mg = 110;
    if (existing === 0) { d.bounds = { minX: minx - mg, maxX: maxx + mg, minZ: minz - mg, maxZ: maxz + mg }; if (closed) { var cx = (minx + maxx) / 2; d.tee = { x: cx, z: minz + (maxz - minz) * 0.15 }; d.cup = { x: cx, z: minz + (maxz - minz) * 0.85 }; } else { d.tee = { x: Math.round(pts[0].x), z: Math.round(pts[0].z) }; d.cup = { x: Math.round(pts[pts.length - 1].x), z: Math.round(pts[pts.length - 1].z) }; } }
    else { d.bounds = { minX: Math.min(d.bounds.minX, minx - mg), maxX: Math.max(d.bounds.maxX, maxx + mg), minZ: Math.min(d.bounds.minZ, minz - mg), maxZ: Math.max(d.bounds.maxZ, maxz + mg) }; }
    ED.flash = { x: pts[0].x, z: pts[0].z, t: 0.35 }; edPanel();
  }
  function edDelete() { var s = ED.sel; if (!s || s.kind === 'tee' || s.kind === 'cup') return; edSnapshot(); if (s.kind === 'wallgroup') { var d = ED.draft; s.items.forEach(function (g) { var idx = d.walls.indexOf(g); if (idx >= 0) d.walls.splice(idx, 1); }); } else if (s.arr) s.arr.splice(s.idx, 1); ED.sel = null; edPanel(); }
  function edPlay() { var d = ED.draft; applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures); rebuildBox(d); (d.coins || []).forEach(function (c) { c.got = false; }); (d.powerups || []).forEach(function (p) { p.got = false; }); (d.firerings || []).forEach(function (f) { f.passed = false; f.passedCd = 0; }); St.hole = d; St.hi = 0; St.hole.par = d.par; var t = d.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = d.terrain(t.x, t.z) + K.R; buildScene(d); St.strokes = 0; St.combo = 0; St.scores = []; St.parDone = 0; St.fx = []; St.pops = []; St.trail = []; St.coins = 0; St.points = 0; St.magnetT = 0; St.slowT = 0; var hy = Math.atan2(d.cup.x - t.x, d.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.camOrbit = 0; St.power = 0.5; St.state = 'aim'; St.testing = true; St.holeBest = null; St.banner = 'TEST · ' + d.name; St.bannerT = 1.6; ED.on = false; edShow(false); }
  function icon(c, kind, s, sel, item) {
    c.save();
    var SC = ED.scale || 0.1, it = item || {};
    // scaled footprint radius in screen px from a world size (so radius/size sliders are VISIBLE on the map)
    function R(world, mn) { return Math.max(mn || 7, world * SC); }
    if (kind === 'bumper') { var br = R(it.r || 44, 7); c.fillStyle = '#caa06a'; c.strokeStyle = '#5a3a1a'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, br, 0, TAU); c.fill(); c.stroke(); }
    else if (kind === 'booster') { var zr = R(it.r || 110, 9); c.fillStyle = 'rgba(42,168,255,.28)'; c.strokeStyle = '#2aa8ff'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, zr, 0, TAU); c.fill(); c.stroke(); var ba = (it.dx != null ? Math.atan2(it.dz, it.dx) : (PI / 2)); c.save(); c.translate(s.x, s.y); c.rotate(ba - PI / 2); c.fillStyle = '#eafaff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 3); c.lineTo(-5, 3); c.closePath(); c.fill(); c.restore(); }
    else if (kind === 'windmill') { var wr = R(it.r || 200, 10), n = it.n || 4; c.strokeStyle = '#c8442e'; c.lineWidth = 3; for (var a = 0; a < n; a++) { var aa2 = a / n * TAU; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(aa2) * wr, s.y + Math.sin(aa2) * wr); c.stroke(); } c.fillStyle = '#6e4524'; c.beginPath(); c.arc(s.x, s.y, 4, 0, TAU); c.fill(); }
    else if (kind === 'loop') { var lr = R(it.r || 130, 7); c.strokeStyle = '#e8902a'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, lr, 0, TAU); c.stroke(); c.fillStyle = '#e8902a'; c.font = '700 9px Georgia'; c.textAlign = 'center'; c.fillText('∞', s.x, s.y + 3); }
    else if (kind === 'warp') { var pr = R(it.r || 50, 8); c.fillStyle = '#0a0616'; c.beginPath(); c.arc(s.x, s.y, pr, 0, TAU); c.fill(); c.strokeStyle = '#2aa8ff'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, pr, 0, TAU); c.stroke(); c.fillStyle = '#2aa8ff'; c.font = '700 9px Georgia'; c.textAlign = 'center'; c.fillText('⭳', s.x, s.y + 3); }
    else if (kind === 'warpExit') { c.strokeStyle = '#2aff9a'; c.lineWidth = 2.5; c.beginPath(); c.arc(s.x, s.y, 9, 0, TAU); c.stroke(); c.beginPath(); c.arc(s.x, s.y, 3, 0, TAU); c.stroke(); }
    else if (kind === 'portal') { var por = R(it.r || 46, 8); c.strokeStyle = '#c45cff'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, por, 0, TAU); c.stroke(); c.fillStyle = 'rgba(196,92,255,.3)'; c.beginPath(); c.arc(s.x, s.y, por * .7, 0, TAU); c.fill(); }
    else if (kind === 'portalExit') { c.strokeStyle = '#c45cff'; c.lineWidth = 2.5; c.setLineDash([3, 3]); c.beginPath(); c.arc(s.x, s.y, 10, 0, TAU); c.stroke(); c.setLineDash([]); }
    else if (kind === 'firering') { var fr = R(it.r || 120, 8); c.strokeStyle = '#ff5a1e'; c.lineWidth = 3.5; c.beginPath(); c.arc(s.x, s.y, fr, 0, TAU); c.stroke(); c.fillStyle = '#ff8a2a'; c.font = '11px Georgia'; c.textAlign = 'center'; c.fillText('🔥', s.x, s.y + 4); }
    else if (kind === 'enemy') { var er = R(it.r || 42, 8); c.fillStyle = '#9a1f1f'; c.beginPath(); c.arc(s.x, s.y, er, 0, TAU); c.fill(); c.strokeStyle = '#550f0f'; c.lineWidth = 1.5; for (var ea = 0; ea < 8; ea++) { var aa = ea / 8 * TAU; c.beginPath(); c.moveTo(s.x + Math.cos(aa) * er, s.y + Math.sin(aa) * er); c.lineTo(s.x + Math.cos(aa) * (er + 5), s.y + Math.sin(aa) * (er + 5)); c.stroke(); } c.fillStyle = '#ffee44'; c.beginPath(); c.arc(s.x - 3, s.y - 1, 2, 0, TAU); c.arc(s.x + 3, s.y - 1, 2, 0, TAU); c.fill(); }
    else if (kind === 'enemyEnd') { c.strokeStyle = '#ff6a4a'; c.lineWidth = 2; c.setLineDash([3, 3]); c.beginPath(); c.arc(s.x, s.y, 9, 0, TAU); c.stroke(); c.setLineDash([]); c.fillStyle = '#ff6a4a'; c.font = '700 8px Georgia'; c.textAlign = 'center'; c.fillText('▶◀', s.x, s.y + 3); }
    else if (kind === 'coin') { c.fillStyle = '#ffd54a'; c.strokeStyle = '#9a7600'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, 9, 0, TAU); c.fill(); c.stroke(); c.fillStyle = '#9a7600'; c.font = '700 10px Georgia'; c.textAlign = 'center'; c.fillText('$', s.x, s.y + 4); }
    else if (kind === 'powerup') { var pc = PU[(item && item.kind)] || PU.magnet, hx = '#' + ('00000' + pc.c.toString(16)).slice(-6); c.fillStyle = hx; c.strokeStyle = '#0b0712'; c.lineWidth = 2; c.beginPath(); c.moveTo(s.x, s.y - 11); c.lineTo(s.x + 10, s.y); c.lineTo(s.x, s.y + 11); c.lineTo(s.x - 10, s.y); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = '700 10px Georgia'; c.textAlign = 'center'; c.fillText(pc.ch, s.x, s.y + 4); }
    else if (kind === 'tier') { c.fillStyle = '#5a8cff'; c.strokeStyle = '#1a3a7a'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 8, 0, TAU); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = '700 10px Georgia'; c.textAlign = 'center'; c.fillText('⤓', s.x, s.y + 3); }
    else if (kind === 'hill' || kind === 'funnel') { var hr = R(it.rad || 360, 9); c.strokeStyle = kind === 'hill' ? '#7ad06a' : '#46c8ff'; c.lineWidth = 1.5; c.setLineDash([4, 4]); c.beginPath(); c.arc(s.x, s.y, hr, 0, TAU); c.stroke(); c.setLineDash([]); c.fillStyle = c.strokeStyle; c.font = '700 9px Georgia'; c.textAlign = 'center'; c.fillText(kind === 'hill' ? 'H' : 'F', s.x, s.y + 3); }
    else if (kind === 'ramp') { c.fillStyle = '#d7a05a'; c.fillRect(s.x - 9, s.y - 6, 18, 12); c.fillStyle = '#3a2410'; c.font = '700 8px Georgia'; c.textAlign = 'center'; c.fillText('R', s.x, s.y + 3); }
    else if (kind === 'flipper' || kind === 'flipL' || kind === 'flipR') { var side = it.side || (kind === 'flipR' ? 'R' : 'L'), rest = (side === 'L' ? -0.5 : PI + 0.5) + (it.rot || 0), len = R(it.len || 150, 12); c.save(); c.translate(s.x, s.y); c.rotate(rest); c.strokeStyle = '#dadada'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(len, 0); c.stroke(); c.fillStyle = '#888'; c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fill(); c.fillStyle = '#e0563a'; c.beginPath(); c.arc(len, 0, 4, 0, TAU); c.fill(); c.restore(); }
    else if (kind === 'tee') { c.fillStyle = '#fff'; c.beginPath(); c.arc(s.x, s.y, 8, 0, TAU); c.fill(); c.fillStyle = '#2a1c10'; c.font = '700 9px Georgia'; c.textAlign = 'center'; c.fillText('T', s.x, s.y + 3); }
    else if (kind === 'cup') { var cr = R((ED.draft && ED.draft.phys && ED.draft.phys.cupR) || K.cupR || 44, 7); c.fillStyle = '#10080a'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, cr, 0, TAU); c.fill(); c.stroke(); c.fillStyle = '#df3b32'; c.fillRect(s.x + 1, s.y - 16, 11, 8); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(s.x + 1, s.y); c.lineTo(s.x + 1, s.y - 16); c.stroke(); }
    if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 2; var selR = 15; if (it.r) selR = Math.max(15, R(it.r) + 5); else if (it.rad) selR = Math.max(15, R(it.rad) + 5); else if (it.len) selR = Math.max(15, R(it.len) + 5); c.beginPath(); c.arc(s.x, s.y, selR, 0, TAU); c.stroke(); }
    c.restore();
  }
  function drawEditor(c) {
    edFit(); var w = St.w, h = St.h; c.setTransform(St.dpr, 0, 0, St.dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = '#241a0e'; c.fillRect(0, 0, w, h);
    var bn = ED.draft.bounds, tl = edW2S(bn.minX, bn.maxZ), brc = edW2S(bn.maxX, bn.minZ);
    c.fillStyle = '#4e9e3e'; c.fillRect(tl.x, tl.y, brc.x - tl.x, brc.y - tl.y);
    c.strokeStyle = 'rgba(255,255,255,.09)'; c.lineWidth = 1;
    for (var gx = Math.ceil(bn.minX / 200) * 200; gx < bn.maxX; gx += 200) { var sx = edW2S(gx, 0).x; c.beginPath(); c.moveTo(sx, tl.y); c.lineTo(sx, brc.y); c.stroke(); }
    for (var gz = Math.ceil(bn.minZ / 200) * 200; gz < bn.maxZ; gz += 200) { var sy = edW2S(0, gz).y; c.beginPath(); c.moveTo(tl.x, sy); c.lineTo(brc.x, sy); c.stroke(); }
    ED.draft.terrainFeatures.forEach(function (t) { if (t.kind === 'hill' || t.kind === 'funnel') { var cc = edW2S(t.x, t.z); c.strokeStyle = t.kind === 'hill' ? 'rgba(120,210,100,.5)' : 'rgba(70,200,255,.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cc.x, cc.y, (t.rad || 300) * ED.scale, 0, TAU); c.stroke(); } else if (t.kind === 'ramp') { var a = edW2S(bn.minX, t.z1), b2 = edW2S(bn.maxX, t.z0); c.fillStyle = 'rgba(215,160,90,.35)'; c.fillRect(a.x, a.y, b2.x - a.x, b2.y - a.y); } else if (t.kind === 'tier') { var ty = edW2S(0, t.z0).y; c.strokeStyle = (t.h < 0 ? 'rgba(90,140,255,.8)' : 'rgba(120,210,100,.8)'); c.lineWidth = 3; c.setLineDash([11, 7]); c.beginPath(); c.moveTo(tl.x, ty); c.lineTo(brc.x, ty); c.stroke(); c.setLineDash([]); c.fillStyle = c.strokeStyle; c.font = '9px Georgia'; c.textAlign = 'left'; c.fillText((t.h < 0 ? 'drop ' : 'rise ') + Math.abs(t.h), tl.x + 4, ty - 4); } });
    var selWalls = (ED.sel && ED.sel.kind === 'wallgroup') ? ED.sel.items : null;
    ED.draft.walls.forEach(function (wl) { var a = edW2S(wl.ax, wl.az), b2 = edW2S(wl.bx, wl.bz); var inSel = selWalls && selWalls.indexOf(wl) >= 0; c.strokeStyle = inSel ? '#fff5c0' : (wl._bnd ? '#caa06a' : '#e6b878'); c.lineWidth = inSel ? 9 : (wl._bnd ? 5 : 6); c.lineCap = 'round'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); });
    ED.draft.lasers.forEach(function (l) { var a = edW2S(l.ax, l.az), b2 = edW2S(l.bx, l.bz); c.strokeStyle = '#ff3a4a'; c.lineWidth = 3; c.setLineDash([10, 7]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); c.setLineDash([]); c.fillStyle = '#ff3a4a'; [a, b2].forEach(function (p) { c.beginPath(); c.arc(p.x, p.y, 5, 0, TAU); c.fill(); }); });
    (ED.draft.warps || []).forEach(function (wp) { var a = edW2S(wp.x, wp.z), b2 = edW2S(wp.ex, wp.ez); c.strokeStyle = 'rgba(42,255,154,.6)'; c.lineWidth = 2; c.setLineDash([7, 5]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); c.setLineDash([]); });
    (ED.draft.portals || []).forEach(function (po) { var a = edW2S(po.x, po.z); c.strokeStyle = 'rgba(196,92,255,.55)'; c.lineWidth = 2; c.setLineDash([7, 5]); (po.exits || [{ x: po.ex, z: po.ez }]).forEach(function (e) { var b2 = edW2S(e.x, e.z); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); }); c.setLineDash([]); });
    (ED.draft.enemies || []).forEach(function (en) { var a = edW2S(en.x, en.z), b2 = edW2S(en.ex, en.ez); c.strokeStyle = 'rgba(255,106,74,.5)'; c.lineWidth = 2; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); c.setLineDash([]); });
    (ED.draft.firerings || []).forEach(function (fr) { var cc = edW2S(fr.x, fr.z); c.strokeStyle = 'rgba(255,90,30,.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cc.x, cc.y, fr.r * ED.scale, 0, TAU); c.stroke(); });
    edItems().forEach(function (it) { if (it.kind === 'wall' || it.kind === 'laser') return; icon(c, it.kind, edW2S(it.x, it.z), ED.sel && ED.sel.item === it.item, it.item); });
    if (ED.sel && ED.sel.kind === 'wallgroup' && ED.sel.handles) {
      ED.sel.handles.mids.forEach(function (m) { var s = edW2S(m.x, m.z); c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 4, 0, TAU); c.stroke(); });
      ED.sel.handles.verts.forEach(function (v) { var s = edW2S(v.x, v.z); c.fillStyle = '#fff'; c.strokeStyle = '#3a2614'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 6, 0, TAU); c.fill(); c.stroke(); });
    }
    if (ED.seg) { var a = edW2S(ED.seg.sx, ED.seg.sz); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(a.x, a.y, 5, 0, TAU); c.fill(); if (ED.curS) { c.setLineDash([6, 5]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(ED.curS.x, ED.curS.y); c.stroke(); c.setLineDash([]); } }
    if (ED.drawing && ED.drawing.length) { c.strokeStyle = '#ffd24a'; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); var ds = edW2S(ED.drawing[0].x, ED.drawing[0].z); c.moveTo(ds.x, ds.y); for (var dpi = 1; dpi < ED.drawing.length; dpi++) { var dpp = edW2S(ED.drawing[dpi].x, ED.drawing[dpi].z); c.lineTo(dpp.x, dpp.y); } c.stroke(); if (ED.drawing.length > 2) { c.strokeStyle = 'rgba(255,210,74,.4)'; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(ds.x, ds.y); var de = edW2S(ED.drawing[ED.drawing.length - 1].x, ED.drawing[ED.drawing.length - 1].z); c.lineTo(de.x, de.y); c.stroke(); c.setLineDash([]); } }
    if (ED.poly && ED.poly.length) { c.strokeStyle = '#ffd24a'; c.fillStyle = '#ffd24a'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); var p0 = edW2S(ED.poly[0].x, ED.poly[0].z); c.moveTo(p0.x, p0.y); for (var pi = 1; pi < ED.poly.length; pi++) { var pp = edW2S(ED.poly[pi].x, ED.poly[pi].z); c.lineTo(pp.x, pp.y); } if (ED.curS) c.lineTo(ED.curS.x, ED.curS.y); c.stroke(); ED.poly.forEach(function (v) { var s = edW2S(v.x, v.z); c.beginPath(); c.arc(s.x, s.y, 4, 0, TAU); c.fill(); }); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(p0.x, p0.y, 8, 0, TAU); c.stroke(); }
    if (ED.flash && ED.flash.t > 0) { var fs = edW2S(ED.flash.x, ED.flash.z), rr = (0.35 - ED.flash.t) / 0.35 * 30 + 6; c.strokeStyle = 'rgba(245,197,66,' + (ED.flash.t / 0.35).toFixed(2) + ')'; c.lineWidth = 3; c.beginPath(); c.arc(fs.x, fs.y, rr, 0, TAU); c.stroke(); ED.flash.t -= 0.016; }
    var inField = ED.curS && ED.curS.x > 208 && ED.curS.x < w - 210 && ED.curS.y > 54 && ED.curS.y < h - 6;
    if (inField && ED.brush !== 'select') {
      var gx = ED.curS.x, gyy = ED.curS.y;
      c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(gx - 11, gyy); c.lineTo(gx + 11, gyy); c.moveTo(gx, gyy - 11); c.lineTo(gx, gyy + 11); c.stroke();
      if (ED.brush === 'draw' || ED.brush === 'erase' || ED.brush === 'raise' || ED.brush === 'lower') { var rr = Math.max(7, ED.size / 2 * ED.scale); c.strokeStyle = ED.brush === 'erase' ? 'rgba(255,90,90,.85)' : ED.brush === 'raise' ? 'rgba(120,230,110,.9)' : ED.brush === 'lower' ? 'rgba(120,160,255,.9)' : 'rgba(255,210,74,.85)'; c.lineWidth = 2; c.setLineDash([5, 5]); c.beginPath(); c.arc(gx, gyy, rr, 0, TAU); c.stroke(); c.setLineDash([]); }
      else { c.globalAlpha = 0.5; if (ED.brush === 'wall' || ED.brush === 'laser' || ED.brush === 'shape') { c.fillStyle = ED.brush === 'laser' ? '#ff3a4a' : '#e6b878'; c.beginPath(); c.arc(gx, gyy, 5, 0, TAU); c.fill(); } else icon(c, ED.brush, { x: gx, y: gyy }, false); c.globalAlpha = 1; }
    }
    var tn = (ED_TOOLS.filter(function (t) { return t[0] === ED.brush; })[0] || [ED.brush, ED.brush])[1];
    var hint = ED.brush === 'select' ? '◀ Click a wall path = whole group (drag dots to bend) · Shift-click = one segment · click an item & drag to move'
      : (ED.brush === 'raise' || ED.brush === 'lower') ? ('⤒⤓ PAINT TERRAIN — drag to ' + (ED.brush === 'raise' ? 'RAISE' : 'LOWER') + ' the ground   ·   brush size = area   ·   Undo to revert')
        : ED.brush === 'erase' ? '🧽 ERASER — DRAG over walls / items to delete them (size slider sets the wipe radius)    ·    Undo restores'
        : ED.brush === 'draw' ? '✏ DRAW — drag a CLOSED loop = walled arena, or an OPEN line = channel of the brush width (size slider)'
        : ED.brush === 'shape' ? '✋ SHAPE — click to drop corners, click the white ring (first point) to close the outline    ·    Esc cancels'
        : (ED.brush === 'wall' || ED.brush === 'laser') ? ('✋ ' + tn.toUpperCase() + '  —  click TWO points on the field to draw it')
          : ('✋ ' + tn.toUpperCase() + '  —  click the field to drop one    ·    switch to Select to move / Delete');
    c.textAlign = 'center'; c.font = 'bold 14px Georgia'; c.fillStyle = ED.brush === 'select' ? '#ffd24a' : '#eafaff'; c.fillText(hint, w / 2, h - 18);
    c.fillStyle = 'rgba(255,255,255,.4)'; c.font = '10px Georgia'; c.textAlign = 'left'; c.fillText('grid ' + (ED.snapOn ? ED.snap : 'off') + '   ·   undo ' + ED.undo.length, 214, h - 6);
  }
  /* ---- editor DOM ---- */
  function elt(tag, css, txt, parent) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e; }
  // in-app dialog + toast (prompt()/alert()/confirm() are unreliable in embedded/preview frames — never use them)
  function edModal(title, build) {
    var m = ED.dom.modal; if (!m) return; m.innerHTML = ''; m.style.display = 'flex'; m.onclick = function (e) { if (e.target === m) m.style.display = 'none'; };
    var box = elt('div', 'width:380px;max-width:92%;max-height:84%;overflow:auto;background:#241a0e;border:2px solid #f5c542;border-radius:12px;padding:16px;box-shadow:0 8px 40px rgba(0,0,0,.6);', null, m);
    if (title) elt('div', 'font:800 16px Georgia;color:#f5c542;margin-bottom:10px;', title, box);
    build(box, function () { m.style.display = 'none'; });
    return box;
  }
  function edConfirm(msg, onYes) {
    edModal(null, function (box, close) {
      elt('div', 'font:13px Georgia;color:#f5efdc;line-height:1.4;margin-bottom:12px;', msg, box);
      var r = elt('div', 'display:flex;gap:8px;', null, box);
      var yes = elt('button', 'flex:1;padding:10px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:800 12px Georgia;cursor:pointer;', 'Yes', r); yes.onclick = function () { close(); onYes(); };
      var no = elt('button', 'flex:1;padding:10px;border:2px solid #160d06;border-radius:8px;background:#3a2614;color:#f5c542;font:800 12px Georgia;cursor:pointer;', 'Cancel', r); no.onclick = close;
    });
  }
  function edToast(msg, good) {
    if (!ED.dom.root) return;
    var t = elt('div', 'position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:60;padding:9px 16px;border-radius:8px;border:2px solid #160d06;background:' + (good === false ? '#7a2618' : '#1f5018') + ';color:#fff;font:700 13px Georgia;box-shadow:0 4px 18px rgba(0,0,0,.5);pointer-events:none;', msg, ED.dom.root);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2000);
  }
  function edGetNotes() { try { return JSON.parse(localStorage.getItem('pg_notes') || '[]'); } catch (e) { return []; } }
  function edNotes() {
    edModal('📝 NOTES FOR THE BUILDER', function (box, close) {
      elt('div', 'font-size:11px;opacity:.85;line-height:1.4;margin-bottom:6px;', 'Type anything that is wrong or what you want changed. It SAVES on this device and the developer reads it to fix things. Your past notes are listed below.', box);
      var ta = elt('textarea', 'width:100%;height:90px;padding:8px;border-radius:6px;border:1px solid #5a3a1a;background:#1a1109;color:#f5efdc;font:12px Georgia;resize:vertical;', null, box); ta.placeholder = 'e.g. the bumper radius slider does nothing…';
      var sb = elt('button', 'width:100%;margin-top:8px;padding:10px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', '✓ Save note', box);
      var list = elt('div', 'margin-top:10px;', null, box);
      function render() { list.innerHTML = ''; var notes = edGetNotes(); if (!notes.length) { elt('div', 'opacity:.5;font-size:11px;', 'No notes yet.', list); return; } elt('div', 'font:700 11px Georgia;color:#f5c542;margin-bottom:3px;', 'SAVED NOTES (' + notes.length + ')', list); notes.slice().reverse().forEach(function (n) { var c = elt('div', 'background:rgba(245,197,66,.08);border:1px solid #5a3a1a;border-radius:6px;padding:6px;margin:4px 0;', null, list); elt('div', 'font-size:9px;opacity:.5;', n.t || '', c); elt('div', 'font-size:12px;white-space:pre-wrap;color:#f5efdc;', n.msg, c); }); }
      sb.onclick = function () { var msg = (ta.value || '').trim(); if (!msg) { edToast('Write a note first', false); return; } var notes = edGetNotes(); notes.push({ t: new Date().toLocaleString(), msg: msg, build: BUILD }); try { localStorage.setItem('pg_notes', JSON.stringify(notes)); } catch (e) { } ta.value = ''; render(); edToast('Note saved ✓ — thank you!'); };
      render();
    });
  }
  function edLiveRefresh() { if (ED.view3d) { applyPhys(ED.draft.phys); ED.dirty3d = true; } }   // batched 3D rebuild (applied once per frame)
  var BTN = 'display:block;width:184px;margin:3px 0;padding:7px 9px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 12px Georgia;cursor:pointer;text-align:left;';
  function edInit() {
    var root = elt('div', 'position:fixed;inset:0;z-index:40;display:none;pointer-events:none;', null, document.body); ED.dom.root = root;
    if (!document.getElementById('edscrollcss')) { var stl = elt('style', null, null, document.head); stl.id = 'edscrollcss'; stl.textContent = '.edscroll::-webkit-scrollbar{width:11px;height:11px}.edscroll::-webkit-scrollbar-track{background:#1a1109;border-radius:6px}.edscroll::-webkit-scrollbar-thumb{background:#7a5230;border:2px solid #241a0e;border-radius:6px}.edscroll::-webkit-scrollbar-thumb:hover{background:#9a6a40}.edscroll{scrollbar-width:thin;scrollbar-color:#7a5230 #1a1109}'; }
    // ---- TOP BAR: full width, single row, never wraps (scrolls if narrow) ----
    var top = elt('div', 'position:absolute;left:8px;right:8px;top:8px;height:40px;display:flex;gap:5px;align-items:center;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;pointer-events:auto;', null, root);
    ED.dom.topBtns = [];
    var mk = function (label, fn, col) { var b = elt('button', 'flex:0 0 auto;padding:7px 8px;border:2px solid #160d06;border-radius:8px;background:' + (col || 'linear-gradient(180deg,#6a4628,#3a2614)') + ';color:#f5c542;font:700 11.5px Georgia;cursor:pointer;white-space:nowrap;', label, top); b.onclick = fn; b._full = label; b._icon = label.split(' ')[0]; b.title = b.title || label; ED.dom.topBtns.push(b); return b; };
    mk('▶ TEST', edPlay, 'linear-gradient(180deg,#3a8a30,#1f5018)');
    ED.dom.btn3d = mk('🧊 3D', function () { if (ED.view3d) { edExit3D(); ED.dom.btn3d.style.background = 'linear-gradient(180deg,#6a4628,#3a2614)'; } else { edEnter3D(); ED.dom.btn3d.style.background = 'linear-gradient(180deg,#2a7ab0,#15486a)'; } }, 'linear-gradient(180deg,#2a7ab0,#15486a)');
    ED.dom.btn3d.style.background = 'linear-gradient(180deg,#6a4628,#3a2614)';
    ED.dom.btnPal = mk('◧', function () { edTogglePanel('pal'); }); ED.dom.btnPal.title = 'Show / hide the tools panel (more room for the map)';
    ED.dom.btnPanel = mk('◨', function () { edTogglePanel('panel'); }); ED.dom.btnPanel.title = 'Show / hide the inspector panel';
    mk('↶', edUndo); mk('↷', edRedo);
    mk('＋ New', function () { edConfirm('Start a new blank level? Unsaved work is lost.', function () { edSnapshot(); ED.draft = newDraft(); ED.sel = null; edPanel(); edToast('New level'); }); });
    mk('🗑 Clear', function () { edConfirm('Clear all placed items? Keeps the level shape, tee, cup and theme.', edClearAll); });
    mk('⬡ Shapes', edShapes, 'linear-gradient(180deg,#5a4a8a,#2f2350)');
    mk('💾 Save', edSave, 'linear-gradient(180deg,#3a8a30,#1f5018)'); mk('📚 Levels', edLevels); mk('⇪ Export', edExport); mk('⇩ Import', edImport);
    mk('📝 Notes', edNotes, 'linear-gradient(180deg,#b06a1a,#6a3c08)');
    mk('✕ Exit', function () { ED.on = false; edShow(false); if (St.state === 'load' || !St.hole) loadHole(0); });
    // ---- LEFT PALETTE: tool settings box + items ----
    var pal = elt('div', 'position:absolute;left:8px;top:56px;bottom:8px;width:212px;overflow-y:auto;overflow-x:hidden;pointer-events:auto;', null, root); pal.className = 'edscroll';
    var ts = elt('div', 'background:rgba(30,20,10,.6);border:1px solid #5a3a1a;border-radius:8px;padding:6px;margin-bottom:7px;', null, pal);
    ED.dom.snap = elt('button', 'display:block;width:100%;margin-bottom:5px;padding:5px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 11px Georgia;cursor:pointer;', '▦ grid snap: ON', ts); ED.dom.snap.onclick = function () { ED.snapOn = !ED.snapOn; ED.dom.snap.textContent = '▦ grid snap: ' + (ED.snapOn ? 'ON' : 'OFF'); };
    var sr = elt('div', 'font:700 10px Georgia;color:#f5c542;margin:3px 0 1px;', '✏/🧽 brush size: ' + ED.size, ts); var si = elt('input', 'width:100%;', null, ts); si.type = 'range'; si.min = 40; si.max = 520; si.step = 10; si.value = ED.size; si.oninput = function () { ED.size = parseInt(si.value, 10); sr.textContent = '✏/🧽 brush size: ' + ED.size; };
    var smr = elt('div', 'display:flex;gap:4px;align-items:center;margin-top:5px;', null, ts);
    var smb = elt('button', 'flex:0 0 auto;padding:5px 8px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#5a4a8a,#2f2350);color:#f5c542;font:700 11px Georgia;cursor:pointer;', '〜 Smooth', smr); smb.onclick = smoothWalls;
    var smi = elt('input', 'flex:1;', null, smr); smi.type = 'range'; smi.min = 1; smi.max = 4; smi.step = 1; smi.value = ED.smoothAmt; var sml = elt('div', 'font:700 11px Georgia;color:#f5c542;min-width:8px;', String(ED.smoothAmt), smr); smi.oninput = function () { ED.smoothAmt = parseInt(smi.value, 10); sml.textContent = ED.smoothAmt; };
    elt('div', 'font:800 11px Georgia;color:#f5c542;opacity:.85;margin:0 0 3px 2px;', 'ITEMS — pick one, click field', pal);
    var FULLBTN = 'display:block;width:100%;margin:3px 0;padding:7px 9px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 12px Georgia;cursor:pointer;text-align:left;';
    var GBTN = 'padding:5px 3px;border:2px solid #160d06;border-radius:7px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 10px Georgia;cursor:pointer;text-align:center;line-height:1.1;min-height:29px;';
    var mkTool = function (t, parent, style) { var bb = elt('button', style, t[1], parent); bb.onclick = function () { ED.brush = t[0]; ED.seg = null; ED.poly = null; ED.drawing = null; ED.erasing = false; ED.sel = null; edHi(); edPanel(); }; bb._tool = t[0]; return bb; };
    ['select', 'draw', 'erase'].forEach(function (key) { var t = ED_TOOLS.filter(function (x) { return x[0] === key; })[0]; if (t) mkTool(t, pal, FULLBTN); });   // prominent mode tools
    var grid = elt('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:3px;', null, pal);   // every placement tool, 2-column so they all fit
    ED_TOOLS.forEach(function (t) { if (t[0] === 'select' || t[0] === 'draw' || t[0] === 'erase') return; mkTool(t, grid, GBTN); });
    elt('div', 'height:6px;', '', pal); var del = elt('button', FULLBTN.replace('#6a4628,#3a2614', '#7a2618,#451008') + 'color:#ffd;', '✕  Delete  (Del)', pal); del.onclick = edDelete;
    var dupb = elt('button', FULLBTN.replace('#6a4628,#3a2614', '#3a6a8a,#1f3850') + 'color:#dff;', '⧉  Duplicate  (Ctrl+D)', pal); dupb.onclick = edDuplicate;
    ED.dom.pal = pal;
    // ---- RIGHT INSPECTOR ----
    var panel = elt('div', 'position:absolute;right:8px;top:56px;bottom:8px;width:200px;overflow-y:auto;overflow-x:hidden;background:rgba(30,20,10,.94);border:2px solid #5a3a1a;border-radius:10px;padding:10px;color:#f5efdc;font:12px Georgia;pointer-events:auto;', null, root); ED.dom.panel = panel; panel.className = 'edscroll';
    var modal = elt('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,5,2,.72);pointer-events:auto;', null, root); ED.dom.modal = modal;
    document.body.appendChild(root);
    window.addEventListener('keydown', edKey);
    St.scene.addEventListener('contextmenu', function (e) { if (ED.on) { e.preventDefault(); var w = edS2W(ptr(e).x, ptr(e).y); var hit = edHit(w.x, w.z); if (hit && hit.arr) { ED.sel = hit; edDelete(); } } });
  }
  function edKey(e) {
    if (!ED.on) return; var tag = (e.target && e.target.tagName) || ''; if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') { edDelete(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.shiftKey ? edRedo() : edUndo(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { edRedo(); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { edDuplicate(); e.preventDefault(); }
    else if (e.key === 'Escape') { ED.poly = null; ED.seg = null; ED.drawing = null; ED.sel = null; edPanel(); }
  }
  function edHi() { if (!ED.dom.pal) return; var bs = ED.dom.pal.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) { if (!bs[i]._tool) continue; var on = bs[i]._tool === ED.brush; bs[i].style.outline = on ? '3px solid #f5c542' : 'none'; bs[i].style.background = on ? 'linear-gradient(180deg,#f5d76e,#c9952c)' : 'linear-gradient(180deg,#6a4628,#3a2614)'; bs[i].style.color = on ? '#2a1c10' : '#f5c542'; } }
  function row(parent, label, val, min, max, step, fn) {
    var r = elt('div', 'margin:6px 0;', null, parent); elt('div', 'font-size:10px;opacity:.8;', label + ': ' + (Math.round(val * 100) / 100), r);
    var i = elt('input', 'width:100%;', null, r); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.oninput = function () { fn(parseFloat(i.value)); r.firstChild.textContent = label + ': ' + (Math.round(i.value * 100) / 100); };
    return r;
  }
  function edPanel() {
    var p = ED.dom.panel; if (!p) return; p.innerHTML = '';
    if (ED.sel && ED.sel.kind === 'wallgroup') {
      var gi = ED.sel.items, gcard = elt('div', 'background:rgba(245,197,66,.12);border:1px solid #f5c542;border-radius:8px;padding:8px;margin-bottom:10px;', null, p);
      elt('div', 'font:800 13px Georgia;color:#f5c542;', '✦ WALL PATH', gcard);
      elt('div', 'font-size:10px;line-height:1.35;opacity:.9;margin:3px 0 7px;', gi.length + ' segments. Drag the SMOOTHNESS slider below to round the line — you\'ll see it curve as you drag. Drag white dots to bend corners; drag the line to move it; Shift-click for one segment.', gcard);
      elt('div', 'font:800 11px Georgia;color:#7affb0;margin-bottom:1px;', '✨ SMOOTHNESS — drag this →', gcard);
      row(gcard, 'rounding', ED.sel.smoothLevel || 0, 0, 4, 1, function (v) { if (!ED.sel.snapped) { edSnapshot(); ED.sel.snapped = true; } ED.sel.smoothLevel = v; applyPathSmooth(v); });
      row(gcard, 'bounce', gi[0] && gi[0].e != null ? gi[0].e : K.wallE, 0, 1, 0.05, function (v) { ED.sel.items.forEach(function (g) { g.e = v; }); edLiveRefresh(); });
      row(gcard, 'height (taller blocks airborne balls)', gi[0] && gi[0].h ? gi[0].h : 80, 20, 240, 4, function (v) { ED.sel.items.forEach(function (g) { g.h = v; }); edLiveRefresh(); });
      var gdl = elt('button', 'display:block;width:100%;margin-top:8px;padding:7px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:700 11px Georgia;cursor:pointer;', '✕ Delete this path', gcard); gdl.onclick = edDelete;
    } else if (ED.sel) {
      var k = ED.sel.kind, info = ED_INFO[k] || { n: k.toUpperCase(), a: '' }, it = ED.sel.item;
      var card = elt('div', 'background:rgba(245,197,66,.12);border:1px solid #f5c542;border-radius:8px;padding:8px;margin-bottom:10px;', null, p);
      elt('div', 'font:800 13px Georgia;color:#f5c542;', '✦ ' + info.n, card);
      if (info.a) elt('div', 'font-size:10px;line-height:1.35;opacity:.9;margin:3px 0 6px;', info.a, card);
      if (ED_PARAMS[k]) ED_PARAMS[k].forEach(function (pr) {
        if (pr[2] === 'select') { var wrap = elt('div', 'margin:6px 0;', null, card); elt('div', 'font-size:10px;opacity:.8;', pr[1], wrap); var seln = elt('select', 'width:100%;padding:4px;border-radius:5px;background:#1a1109;color:#f5efdc;border:1px solid #5a3a1a;font:12px Georgia;', null, wrap); pr[3].forEach(function (opt) { var o = document.createElement('option'); o.value = opt; o.textContent = opt; if ((it[pr[0]] || pr[3][0]) === opt) o.selected = true; seln.appendChild(o); }); seln.onchange = function () { edSnapshot(); it[pr[0]] = seln.value; edLiveRefresh(); }; return; }
        var get = pr[0] === 'ang' ? (it.dx != null ? Math.atan2(it.dz, it.dx) : it.ang) : it[pr[0]];
        row(card, pr[1], get == null ? pr[2] : get, pr[2], pr[3], pr[4], function (v) { if (pr[0] === 'ang') { if (it.dx != null) { it.dx = Math.cos(v); it.dz = Math.sin(v); } else it.ang = v; } else it[pr[0]] = v; edLiveRefresh(); });
      });
      if (k === 'portal' || k === 'portalExit') {
        var po = ED.sel.item, exs = po.exits || (po.exits = [{ x: po.ex, z: po.ez }]);
        elt('div', 'font-size:10px;opacity:.9;margin:5px 0 2px;color:' + (exs.length > 1 ? '#c45cff' : '#f5efdc') + ';', exs.length + ' exit' + (exs.length > 1 ? 's — ball pops out a RANDOM one' : ''), card);
        var pact2 = elt('div', 'display:flex;gap:5px;', null, card);
        var addB = elt('button', 'flex:1;padding:6px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#5a4a8a,#2f2350);color:#dff;font:700 11px Georgia;cursor:pointer;', '+ add exit', pact2); addB.onclick = function () { edSnapshot(); exs.push({ x: po.x + (exs.length % 2 ? 1 : -1) * (200 + exs.length * 40), z: po.z + 240 }); edPanel(); };
        if (exs.length > 1) { var remB = elt('button', 'flex:1;padding:6px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 11px Georgia;cursor:pointer;', '− remove', pact2); remB.onclick = function () { edSnapshot(); exs.pop(); edPanel(); }; }
      }
      var px = it.x != null ? it.x : it.px, pz = it.z != null ? it.z : it.pz;
      if (px != null) elt('div', 'font-size:10px;opacity:.65;margin-top:4px;', 'position   x ' + Math.round(px) + '   z ' + Math.round(pz) + '   (drag on map)', card);
      if (ED.sel.arr) { var act = elt('div', 'display:flex;gap:5px;margin-top:8px;', null, card); var dup = elt('button', 'flex:1;padding:6px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#3a6a8a,#1f3850);color:#dff;font:700 11px Georgia;cursor:pointer;', '⧉ Duplicate', act); dup.onclick = edDuplicate; var dl = elt('button', 'flex:1;padding:6px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:700 11px Georgia;cursor:pointer;', '✕ Delete', act); dl.onclick = edDelete; }
      else elt('div', 'font-size:9px;opacity:.6;margin-top:5px;', '(permanent — drag on the map to move)', card);
    } else {
      elt('div', 'font-size:10px;opacity:.65;margin-bottom:9px;line-height:1.4;', 'Nothing selected. Pick a tool ◀ and click the field to build. Use Select to grab any item and edit its stats here.', p);
    }
    elt('div', 'font:700 12px Georgia;color:#f5c542;margin:4px 0 2px;', 'LEVEL', p);
    var ni = elt('input', 'width:100%;margin:2px 0;', null, p); ni.value = ED.draft.name; ni.oninput = function () { ED.draft.name = ni.value; };
    row(p, 'par', ED.draft.par, 1, 8, 1, function (v) { ED.draft.par = Math.round(v); });
    row(p, 'width', ED.draft.bounds.maxX - ED.draft.bounds.minX, 400, 1600, 20, function (v) { ED.draft.bounds.minX = -v / 2; ED.draft.bounds.maxX = v / 2; rebuildBox(ED.draft); edLiveRefresh(); });
    row(p, 'length', ED.draft.bounds.maxZ - ED.draft.bounds.minZ, 800, 3200, 20, function (v) { ED.draft.bounds.maxZ = ED.draft.bounds.minZ + v; rebuildBox(ED.draft); edLiveRefresh(); });
    row(p, 'border wall height', ED.draft.wallH || 52, 30, 240, 4, function (v) { ED.draft.wallH = v; rebuildBox(ED.draft); edLiveRefresh(); });
    var sf = null, tf = ED.draft.terrainFeatures; for (var si = 0; si < tf.length; si++) if (tf[si].kind === 'slope') sf = tf[si]; if (!sf) { sf = { kind: 'slope', perX: 0, perZ: 0 }; tf.push(sf); }
    row(p, 'tilt L→R', sf.perX || 0, -0.2, 0.2, 0.01, function (v) { sf.perX = v; });
    row(p, 'tilt tee→cup', sf.perZ || 0, -0.15, 0.15, 0.01, function (v) { sf.perZ = v; });
    var bt = elt('button', 'display:block;width:100%;margin:5px 0;padding:6px;border:2px solid #160d06;border-radius:7px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 11px Georgia;cursor:pointer;', ED.draft.noBox ? '▣ walls: CUSTOM shape' : '▢ walls: rectangle box', p); bt.onclick = function () { ED.draft.noBox = !ED.draft.noBox; rebuildBox(ED.draft); edPanel(); };
    if (ED.draft.noBox) elt('div', 'font-size:9px;opacity:.7;margin-bottom:4px;', 'use the Wall or Shape tool to draw your outline', p);
    elt('div', 'font:700 12px Georgia;color:#f5c542;margin:12px 0 2px;', 'TERRAIN & PHYSICS', p);
    if (!ED.draft.phys) ED.draft.phys = themePhys(ED.draft.theme || 'grass');
    var ph = ED.draft.phys;
    var tw = elt('div', 'margin:3px 0 6px;', null, p); elt('div', 'font-size:10px;opacity:.8;', 'terrain theme (sets all physics)', tw);
    var tsel = elt('select', 'width:100%;padding:5px;border-radius:5px;background:#1a1109;color:#f5efdc;border:1px solid #5a3a1a;font:12px Georgia;', null, tw);
    Object.keys(THEMES).forEach(function (tk) { var o = document.createElement('option'); o.value = tk; o.textContent = THEMES[tk].name; if ((ED.draft.theme || 'grass') === tk) o.selected = true; tsel.appendChild(o); });
    tsel.onchange = function () { edSnapshot(); ED.draft.theme = tsel.value; ED.draft.phys = themePhys(tsel.value); ED.draft.turf = THEMES[tsel.value].turf; edPanel(); };
    row(p, 'gravity', ph.g, 400, 3500, 50, function (v) { ph.g = v; });
    row(p, 'friction / grip', ph.rollFric, 100, 2700, 30, function (v) { ph.rollFric = v; });
    row(p, 'ground bounce', ph.groundE, 0, 1, 0.05, function (v) { ph.groundE = v; });
    row(p, 'wall bounce', ph.wallE, 0, 1, 0.05, function (v) { ph.wallE = v; });
    row(p, 'default bumper kick', ph.bumpKick, 600, 3000, 50, function (v) { ph.bumpKick = v; });
    row(p, 'default flip power', ph.flipKick, 800, 4000, 100, function (v) { ph.flipKick = v; });
    row(p, 'max drive', ph.shotMax, 2500, 7500, 100, function (v) { ph.shotMax = v; });
    row(p, 'cup size', ph.cupR, 30, 80, 2, function (v) { ph.cupR = v; edLiveRefresh(); });
  }
  function edShow(on) { if (!on) { ED.view3d = false; ED.camDrag = null; ED.moving3d = false; if (ED.dom.btn3d) ED.dom.btn3d.style.background = 'linear-gradient(180deg,#6a4628,#3a2614)'; } if (ED.dom.root) ED.dom.root.style.display = on ? 'block' : 'none'; if (ED.dom.modal) ED.dom.modal.style.display = 'none'; var ws = document.getElementById('cam'), sn = document.getElementById('snd'); if (ws) ws.style.display = on ? 'none' : ''; if (sn) sn.style.display = on ? 'none' : ''; (ED.dom.gameBtns || []).forEach(function (b) { b.style.display = on ? 'none' : ''; }); if (on) { edToolbarLabels(); edHi(); edPanel(); } }
  function edEnter() {
    if (!ED.draft) ED.draft = newDraft(); ED.on = true; ED.sel = null; ED.view3d = false; ED.camDrag = null;
    ED.palOpen = true; ED.panelOpen = (St.w || window.innerWidth) >= 620;   // on narrow screens start with the inspector hidden so the map is visible (tap ◨ to open)
    if (ED.dom.pal) ED.dom.pal.style.display = '';
    if (ED.dom.panel) ED.dom.panel.style.display = ED.panelOpen ? '' : 'none';
    var base = 'linear-gradient(180deg,#6a4628,#3a2614)', off = 'linear-gradient(180deg,#2a2a2a,#161616)';
    if (ED.dom.btnPal) ED.dom.btnPal.style.background = base;
    if (ED.dom.btnPanel) ED.dom.btnPanel.style.background = ED.panelOpen ? base : off;
    if (ED.dom.btn3d) ED.dom.btn3d.style.background = base;
    edShow(true);
  }
  function edLevels() {
    var m = ED.dom.modal; if (!m) return; m.innerHTML = ''; m.style.display = 'flex'; m.onclick = function (e) { if (e.target === m) m.style.display = 'none'; };
    var box = elt('div', 'width:360px;max-height:80%;overflow:auto;background:#241a0e;border:2px solid #f5c542;border-radius:12px;padding:14px;box-shadow:0 8px 40px rgba(0,0,0,.6);', null, m);
    elt('div', 'font:800 16px Georgia;color:#f5c542;margin-bottom:8px;', '📚 MY LEVELS', box);
    var sr = elt('div', 'display:flex;gap:6px;margin-bottom:12px;', null, box);
    var nin = elt('input', 'flex:1;padding:7px;border-radius:6px;border:1px solid #5a3a1a;background:#1a1109;color:#f5efdc;font:13px Georgia;', null, sr); nin.value = ED.draft.name;
    var sb = elt('button', 'padding:7px 12px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:700 12px Georgia;cursor:pointer;', '💾 Save', sr);
    sb.onclick = function () { var nm = (nin.value || '').trim(); if (!nm) return; ED.draft.name = nm; var s = edStore(); s[nm] = edSerialize(); try { localStorage.setItem('pg_levels', JSON.stringify(s)); } catch (e) { alert('Save failed (storage full?): ' + e.message); } edLevels(); edPanel(); };
    var s = edStore(), names = Object.keys(s).sort();
    if (!names.length) elt('div', 'opacity:.6;font-size:12px;margin:8px 0;', 'No saved levels yet — build one and hit Save.', box);
    names.forEach(function (n) {
      var lv = s[n] || {}, cnt = ['bumpers', 'boosters', 'flippers', 'windmills', 'loops', 'lasers', 'walls'].reduce(function (a, kk) { return a + ((lv[kk] || []).length); }, 0);
      var rd = elt('div', 'display:flex;gap:5px;align-items:center;padding:7px;margin:5px 0;background:rgba(245,197,66,.08);border:1px solid #5a3a1a;border-radius:8px;', null, box);
      elt('div', 'flex:1;font:700 13px Georgia;color:#f5efdc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', n, rd);
      elt('div', 'font-size:10px;opacity:.55;margin-right:3px;', cnt + ' items', rd);
      var lb = elt('button', 'padding:6px 10px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 11px Georgia;cursor:pointer;', 'Load', rd);
      lb.onclick = function () { edSnapshot(); ED.draft = edDeserialize(s[n]); ED.sel = null; m.style.display = 'none'; edPanel(); };
      var rb = elt('button', 'padding:6px 8px;border:2px solid #160d06;border-radius:6px;background:#3a2614;color:#cba;font:700 11px Georgia;cursor:pointer;', '✎', rd);
      rb.onclick = function () { edModal('✎ RENAME', function (bx, close) { var ri = elt('input', 'width:100%;padding:9px;border-radius:6px;border:1px solid #5a3a1a;background:#1a1109;color:#f5efdc;font:13px Georgia;margin-bottom:10px;', null, bx); ri.value = n; var ok = elt('button', 'width:100%;padding:10px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 12px Georgia;cursor:pointer;', 'Rename', bx); ok.onclick = function () { var nn = (ri.value || '').trim(); if (!nn || nn === n) { close(); return; } var st = edStore(); st[nn] = st[n]; st[nn].name = nn; delete st[n]; localStorage.setItem('pg_levels', JSON.stringify(st)); close(); edLevels(); edToast('Renamed ✓'); }; setTimeout(function () { ri.focus(); ri.select(); }, 40); }); };
      var xb = elt('button', 'padding:6px 8px;border:2px solid #160d06;border-radius:6px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:700 11px Georgia;cursor:pointer;', '✕', rd);
      xb.onclick = function () { edConfirm('Delete level "' + n + '"? This cannot be undone.', function () { var st = edStore(); delete st[n]; localStorage.setItem('pg_levels', JSON.stringify(st)); edLevels(); edToast('Deleted'); }); };
    });
    var cl = elt('button', 'margin-top:10px;width:100%;padding:9px;border:2px solid #160d06;border-radius:8px;background:#3a2614;color:#f5c542;font:700 12px Georgia;cursor:pointer;', 'Close', box); cl.onclick = function () { m.style.display = 'none'; };
  }
  function chaikin(pts, iters) { for (var k = 0; k < iters; k++) { var out = [pts[0]]; for (var i = 0; i < pts.length - 1; i++) { var p = pts[i], q = pts[i + 1]; out.push({ x: p.x * .75 + q.x * .25, z: p.z * .75 + q.z * .25 }); out.push({ x: p.x * .25 + q.x * .75, z: p.z * .25 + q.z * .75 }); } out.push(pts[pts.length - 1]); pts = out; } return pts; }
  function chaikinClosed(pts, iters) { for (var k = 0; k < iters; k++) { var out = []; for (var i = 0; i < pts.length; i++) { var p = pts[i], q = pts[(i + 1) % pts.length]; out.push({ x: p.x * .75 + q.x * .25, z: p.z * .75 + q.z * .25 }); out.push({ x: p.x * .25 + q.x * .75, z: p.z * .25 + q.z * .75 }); } pts = out; } return pts; }
  function smoothWalls() {
    var d = ED.draft, src = d.walls.filter(function (w) { return !w._bnd; }), bnd = d.walls.filter(function (w) { return w._bnd; });
    if (src.length < 2) { ED.flash = { x: ED.draft.tee.x, z: ED.draft.tee.z, t: 0.35 }; return; }
    edSnapshot();
    var EP = 30; function near(ax, az, bx, bz) { return Math.abs(ax - bx) < EP && Math.abs(az - bz) < EP; }
    // trace connected wall chains by matching endpoints (order-independent — handles interleaved corridor rails)
    var segs = src.map(function (w) { return { a: { x: w.ax, z: w.az }, b: { x: w.bx, z: w.bz }, e: w.e, h: w.h, used: false }; });
    function findNext(pt) { for (var k = 0; k < segs.length; k++) { var s = segs[k]; if (s.used) continue; if (near(s.a.x, s.a.z, pt.x, pt.z)) return { seg: s, end: s.b }; if (near(s.b.x, s.b.z, pt.x, pt.z)) return { seg: s, end: s.a }; } return null; }
    var chains = [], si;
    for (si = 0; si < segs.length; si++) {
      if (segs[si].used) continue; var seg = segs[si]; seg.used = true; var pts = [seg.a, seg.b], e = seg.e, h = seg.h, cur, nx, guard = 0;
      cur = pts[pts.length - 1]; while ((nx = findNext(cur)) && guard++ < 4000) { nx.seg.used = true; pts.push(nx.end); cur = nx.end; if (near(cur.x, cur.z, pts[0].x, pts[0].z)) break; }
      cur = pts[0]; while ((nx = findNext(cur)) && guard++ < 4000) { nx.seg.used = true; pts.unshift(nx.end); cur = nx.end; if (near(cur.x, cur.z, pts[pts.length - 1].x, pts[pts.length - 1].z)) break; }
      chains.push({ e: e, h: h, pts: pts });
    }
    d.walls = bnd;
    var amt = ED.smoothAmt || 2;
    chains.forEach(function (ch) {
      var pts = ch.pts; if (pts.length < 3) { d.wall(pts[0].x, pts[0].z, pts[pts.length - 1].x, pts[pts.length - 1].z, { e: ch.e, h: ch.h }); return; }
      var closed = near(pts[0].x, pts[0].z, pts[pts.length - 1].x, pts[pts.length - 1].z), sm;
      if (closed) { sm = chaikinClosed(pts.slice(0, -1), amt); if (sm.length > 80) sm = simplifyPath(sm, 32); for (var i = 0; i < sm.length; i++) d.wall(sm[i].x, sm[i].z, sm[(i + 1) % sm.length].x, sm[(i + 1) % sm.length].z, { e: ch.e, h: ch.h }); }
      else { sm = chaikin(pts, amt); if (sm.length > 80) sm = simplifyPath(sm, 32); for (var j = 0; j < sm.length - 1; j++) d.wall(sm[j].x, sm[j].z, sm[j + 1].x, sm[j + 1].z, { e: ch.e, h: ch.h }); }
    });
    ED.flash = { x: ED.draft.tee.x, z: ED.draft.tee.z, t: 0.35 }; ED.sel = null; edPanel();
  }
  function genCorridor(d, pts, halfW) {
    var L = [], R = [], i;
    for (i = 0; i < pts.length; i++) { var pv = pts[i - 1] || pts[i], nv = pts[i + 1] || pts[i], dx = nv.x - pv.x, dz = nv.z - pv.z, dl = Math.hypot(dx, dz) || 1, nx = -dz / dl, nz = dx / dl; L.push({ x: pts[i].x + nx * halfW, z: pts[i].z + nz * halfW }); R.push({ x: pts[i].x - nx * halfW, z: pts[i].z - nz * halfW }); }
    for (i = 0; i < pts.length - 1; i++) { d.wall(L[i].x, L[i].z, L[i + 1].x, L[i + 1].z); d.wall(R[i].x, R[i].z, R[i + 1].x, R[i + 1].z); }
    d.wall(L[0].x, L[0].z, R[0].x, R[0].z); d.wall(L[pts.length - 1].x, L[pts.length - 1].z, R[pts.length - 1].x, R[pts.length - 1].z);
  }
  function applyShape(kind) {
    edSnapshot(); var d = newDraft(); d.walls = []; d.terrainFeatures = []; d.noBox = true; var i, pts, hw = 155;
    if (kind === 's') { d.name = 'S-CURVE'; d.bounds = { minX: -560, maxX: 560, minZ: -40, maxZ: 2200 }; pts = []; for (i = 0; i <= 28; i++) { var t = i / 28; pts.push({ x: Math.sin(t * TAU) * 370, z: 70 + t * 2010 }); } genCorridor(d, pts, hw); d.tee = { x: pts[0].x, z: pts[0].z }; d.cup = { x: pts[28].x, z: pts[28].z }; }
    else if (kind === 'z') { d.name = 'Z-BEND'; d.bounds = { minX: -580, maxX: 580, minZ: -40, maxZ: 2100 }; pts = chaikin([{ x: -360, z: 300 }, { x: 360, z: 300 }, { x: -360, z: 1780 }, { x: 360, z: 1780 }], 3); genCorridor(d, pts, 170); d.tee = { x: -360, z: 300 }; d.cup = { x: 360, z: 1780 }; }
    else if (kind === 'w') { d.name = 'W-ZIGZAG'; d.bounds = { minX: -620, maxX: 620, minZ: -40, maxZ: 1850 }; pts = chaikin([{ x: -440, z: 300 }, { x: -210, z: 1500 }, { x: 0, z: 360 }, { x: 210, z: 1500 }, { x: 440, z: 360 }], 3); genCorridor(d, pts, 165); d.tee = { x: -440, z: 300 }; d.cup = { x: 440, z: 360 }; }
    else if (kind === 'circle') { d.name = 'ROUND ARENA'; d.bounds = { minX: -760, maxX: 760, minZ: -40, maxZ: 1560 }; var cz = 760, rad = 660; d.ring(0, cz, rad, 44); d.tee = { x: 0, z: cz - rad + 130 }; d.cup = { x: 0, z: cz + rad - 170 }; d.bumper(-220, cz, 44); d.bumper(220, cz, 44); }
    else if (kind === 'twotier') { d.name = 'TWO-TIER DROP'; d.noBox = false; d.bounds = { minX: -440, maxX: 440, minZ: -40, maxZ: 2400 }; rebuildBox(d); var mid = 1180; d.wall(-440, mid, 440, mid, { e: K.wallE, h: 70 }); d.tier(mid, -190); d.warp(0, mid - 360, 0, mid + 380, 58); d.tee = { x: 0, z: 150 }; d.cup = { x: 0, z: 2220 }; d.bumper(-230, 640, 44); d.bumper(230, 640, 44); d.bumper(0, mid + 760, 46); }
    else if (kind === 'threetier') { d.name = 'THREE-TIER DROP'; d.noBox = false; d.bounds = { minX: -440, maxX: 440, minZ: -40, maxZ: 3000 }; rebuildBox(d); var m1 = 1000, m2 = 2000; d.wall(-440, m1, 440, m1, { e: K.wallE, h: 70 }); d.wall(-440, m2, 440, m2, { e: K.wallE, h: 70 }); d.tier(m1, -170); d.tier(m2, -170); d.warp(0, m1 - 320, 0, m1 + 300, 54); d.warp(0, m2 - 320, 0, m2 + 300, 54); d.tee = { x: 0, z: 150 }; d.cup = { x: 0, z: 2840 }; d.bumper(-230, 560, 44); d.bumper(230, 560, 44); d.bumper(0, m1 + 600, 46); }
    ED.draft = d; ED.sel = null; if (ED.dom.modal) ED.dom.modal.style.display = 'none'; edPanel();
  }
  function edShapes() {
    var m = ED.dom.modal; if (!m) return; m.innerHTML = ''; m.style.display = 'flex'; m.onclick = function (e) { if (e.target === m) m.style.display = 'none'; };
    var box = elt('div', 'width:300px;background:#241a0e;border:2px solid #f5c542;border-radius:12px;padding:14px;box-shadow:0 8px 40px rgba(0,0,0,.6);', null, m);
    elt('div', 'font:800 16px Georgia;color:#f5c542;margin-bottom:3px;', '⬡ HOLE SHAPES', box);
    elt('div', 'font-size:10px;opacity:.7;margin-bottom:10px;line-height:1.35;', 'Replaces the layout with a preset course shape. Undo (Ctrl+Z) reverts. You can keep adding items after.', box);
    [['s', 'S-Curve  〰'], ['z', 'Z-Bend  ⟋'], ['w', 'W-Zigzag  ⋀⋁'], ['circle', 'Round Arena  ◯'], ['twotier', 'Two-Tier Drop  ⭳'], ['threetier', 'Three-Tier Drop  ⛰']].forEach(function (sh) {
      var b = elt('button', 'display:block;width:100%;margin:5px 0;padding:11px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 13px Georgia;cursor:pointer;text-align:left;', sh[1], box); b.onclick = function () { applyShape(sh[0]); };
    });
    var cl = elt('button', 'margin-top:8px;width:100%;padding:8px;border:2px solid #160d06;border-radius:8px;background:#3a2614;color:#f5c542;font:700 12px Georgia;cursor:pointer;', 'Cancel', box); cl.onclick = function () { m.style.display = 'none'; };
  }
  function edSerialize() { var d = ED.draft; return { name: d.name, par: d.par, bounds: d.bounds, tee: d.tee, cup: d.cup, walls: d.walls.filter(function (w) { return !w._bnd; }).map(function (w) { return { ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, e: w.e, h: w.h }; }), bumpers: d.bumpers.map(function (b) { return { x: b.x, z: b.z, r: b.r, kick: b.kick }; }), boosters: d.boosters.map(function (b) { return { x: b.x, z: b.z, ang: Math.atan2(b.dz, b.dx), r: b.r, spd: b.spd }; }), flippers: d.flippers.map(function (f) { return { side: f.side, px: f.px, pz: f.pz, len: f.len, rot: f.rot, speed: f.speed, power: f.power }; }), windmills: d.windmills.map(function (w) { return { x: w.x, z: w.z, r: w.r, n: w.n, speed: w.speed }; }), lasers: d.lasers.map(function (l) { return { ax: l.ax, az: l.az, bx: l.bx, bz: l.bz, period: l.period, onFrac: l.onFrac, phase: l.phase }; }), loops: d.loops.map(function (l) { return { x: l.x, z: l.z, r: l.r, ang: l.ang }; }), warps: d.warps.map(function (w) { return { x: w.x, z: w.z, ex: w.ex, ez: w.ez, r: w.r }; }), portals: d.portals.map(function (w) { return { x: w.x, z: w.z, exits: (w.exits || [{ x: w.ex, z: w.ez }]).map(function (e) { return { x: e.x, z: e.z }; }), r: w.r }; }), firerings: d.firerings.map(function (f) { return { x: f.x, z: f.z, r: f.r, h: f.h, points: f.points }; }), enemies: d.enemies.map(function (e) { return { x: e.x, z: e.z, ex: e.ex, ez: e.ez, r: e.r, speed: e.speed, type: e.type, behavior: e.behavior, effect: e.effect }; }), coins: d.coins.map(function (c) { return { x: c.x, z: c.z, value: c.value }; }), powerups: (d.powerups || []).map(function (p) { return { x: p.x, z: p.z, kind: p.kind }; }), terrain: d.terrainFeatures, noBox: d.noBox, wallH: d.wallH || 52, theme: d.theme || 'grass', phys: d.phys || themePhys(d.theme || 'grass'), turf: d.turf, multiball: d.multiball ? { x: d.multiball.x, z: d.multiball.z, r: d.multiball.r } : null }; }
  function edDeserialize(o) { var d = builder(); d.name = o.name || 'LEVEL'; d.par = o.par || 3; d.bounds = o.bounds; d.tee = o.tee; d.cup = o.cup; d.noBox = !!o.noBox; d.wallH = o.wallH || 52; d.theme = o.theme || 'grass'; d.phys = o.phys || themePhys(d.theme); d.turf = o.turf != null ? o.turf : (THEMES[d.theme] || THEMES.grass).turf; rebuildBox(d); (o.loops || []).forEach(function (l) { d.loopde(l.x, l.z, l.r, l.ang); }); (o.warps || []).forEach(function (w) { d.warp(w.x, w.z, w.ex, w.ez, w.r); }); (o.portals || []).forEach(function (w) { d.portal(w.x, w.z, w.exits || (w.ex != null ? [{ x: w.ex, z: w.ez }] : null), w.r); }); (o.firerings || []).forEach(function (f) { d.firering(f.x, f.z, f.r, f.h, f.points); }); (o.enemies || []).forEach(function (e) { d.enemy(e.x, e.z, e.ex, e.ez, e.r, e.speed, e.type, e.behavior, e.effect); }); (o.coins || []).forEach(function (c) { d.coin(c.x, c.z, c.value); }); (o.powerups || []).forEach(function (p) { d.powerup(p.x, p.z, p.kind); }); (o.walls || []).forEach(function (w) { d.wall(w.ax, w.az, w.bx, w.bz, { e: w.e, h: w.h }); }); (o.bumpers || []).forEach(function (b) { d.bumper(b.x, b.z, b.r); if (b.kick != null) last(d.bumpers).kick = b.kick; }); (o.boosters || []).forEach(function (b) { d.booster(b.x, b.z, b.ang, b.r, b.spd); }); (o.flippers || []).forEach(function (f) { d.flip(f.side, f.px, f.pz, f.len, f.rot, f.speed); if (f.power != null) last(d.flippers).power = f.power; }); (o.windmills || []).forEach(function (w) { d.windmill(w.x, w.z, w.r, w.n, w.speed); }); (o.lasers || []).forEach(function (l) { d.lasers.push({ ax: l.ax, az: l.az, bx: l.bx, bz: l.bz, period: l.period, onFrac: l.onFrac, phase: l.phase, on: false }); }); (o.terrain || []).forEach(function (t) { d.terrainFeatures.push(t); }); if (o.multiball) d.mball(o.multiball.x, o.multiball.z, o.multiball.r); return d; }
  function edStore() { try { return JSON.parse(localStorage.getItem('pg_levels') || '{}'); } catch (e) { return {}; } }
  function edSave() {
    edModal('💾 SAVE LEVEL', function (box, close) {
      elt('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', 'Level name', box);
      var nin = elt('input', 'width:100%;padding:9px;border-radius:6px;border:1px solid #5a3a1a;background:#1a1109;color:#f5efdc;font:13px Georgia;margin-bottom:10px;', null, box); nin.value = ED.draft.name || 'MY LEVEL';
      var sb = elt('button', 'width:100%;padding:11px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', '💾 Save to my levels', box);
      sb.onclick = function () { var nm = (nin.value || '').trim(); if (!nm) { edToast('Enter a name', false); return; } ED.draft.name = nm; var s = edStore(); s[nm] = edSerialize(); try { localStorage.setItem('pg_levels', JSON.stringify(s)); close(); edToast('Saved "' + nm + '" ✓'); edPanel(); } catch (e) { edToast('Save failed: storage full', false); } };
      setTimeout(function () { nin.focus(); nin.select(); }, 40);
    });
  }
  function edLoad() { var s = edStore(), names = Object.keys(s); if (!names.length) { alert('No saved levels yet.'); return; } var pick = prompt('Load which level?\n\n' + names.map(function (n, i) { return (i + 1) + ') ' + n; }).join('\n'), '1'); if (!pick) return; var n = names[parseInt(pick, 10) - 1] || (s[pick] ? pick : null); if (!n || !s[n]) { alert('Not found.'); return; } ED.draft = edDeserialize(s[n]); ED.sel = null; edPanel(); }
  function edExport() {
    var json = JSON.stringify(edSerialize(), null, 2);
    edModal('⇪ EXPORT LEVEL', function (box, close) {
      elt('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', 'Copy this JSON, or download it as a .json file:', box);
      var ta = elt('textarea', 'width:100%;height:150px;padding:8px;border-radius:6px;border:1px solid #5a3a1a;background:#1a1109;color:#cfe;font:11px monospace;resize:vertical;', null, box); ta.value = json; ta.readOnly = true;
      var rb = elt('div', 'display:flex;gap:6px;margin-top:8px;', null, box);
      var cp = elt('button', 'flex:1;padding:10px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#3a6a8a,#1f3850);color:#dff;font:800 12px Georgia;cursor:pointer;', '⧉ Copy', rb);
      cp.onclick = function () { ta.select(); try { document.execCommand('copy'); } catch (e) { } try { if (navigator.clipboard) navigator.clipboard.writeText(json); } catch (e) { } edToast('Copied ✓'); };
      var dl = elt('button', 'flex:1;padding:10px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 12px Georgia;cursor:pointer;', '⇩ Download .json', rb);
      dl.onclick = function () { try { var blob = new Blob([json], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = (ED.draft.name || 'level').replace(/[^a-z0-9_-]+/gi, '_') + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); edToast('Downloaded ✓'); } catch (e) { edToast('Download blocked — use Copy', false); } };
      setTimeout(function () { ta.select(); }, 50);
    });
  }
  function edImport() {
    edModal('⇩ IMPORT LEVEL', function (box, close) {
      elt('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', 'Paste level JSON below, or choose a .json file:', box);
      var ta = elt('textarea', 'width:100%;height:130px;padding:8px;border-radius:6px;border:1px solid #5a3a1a;background:#1a1109;color:#cfe;font:11px monospace;resize:vertical;', null, box); ta.placeholder = '{ … level json … }';
      var fi = elt('input', 'margin:8px 0;color:#f5efdc;font:11px Georgia;width:100%;', null, box); fi.type = 'file'; fi.accept = '.json,application/json';
      fi.onchange = function () { var f = fi.files && fi.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { ta.value = rd.result; }; rd.readAsText(f); };
      var lb = elt('button', 'width:100%;padding:11px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', '⇩ Load this level', box);
      lb.onclick = function () { var t = (ta.value || '').trim(); if (!t) { edToast('Paste JSON or pick a file', false); return; } try { var o = JSON.parse(t); edSnapshot(); ED.draft = edDeserialize(o); ED.sel = null; close(); edPanel(); edToast('Imported "' + (ED.draft.name || 'level') + '" ✓'); } catch (e) { edToast('Bad JSON — check the text', false); } };
    });
  }

  /* ================================================================ loop + boot */
  function stepVisuals(dt) {
    if (St.state === 'aim' && !St.drag) St.aimYaw = St.camYaw;
    if (St.coinPulse > 0) St.coinPulse = Math.max(0, St.coinPulse - dt);
    if (St.comboPulse > 0) St.comboPulse = Math.max(0, St.comboPulse - dt * 2.2);
    for (var i = St.fx.length - 1; i >= 0; i--) { var p = St.fx[i]; p.life -= dt; if (p.life <= 0) { St.fx.splice(i, 1); continue; } p.vy -= 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
    if (St.shocks) for (var si = St.shocks.length - 1; si >= 0; si--) { St.shocks[si].t += dt; if (St.shocks[si].t >= St.shocks[si].max) St.shocks.splice(si, 1); }
    for (i = St.pops.length - 1; i >= 0; i--) { var q = St.pops[i]; q.life -= dt; q.y += 60 * dt; if (q.life <= 0) St.pops.splice(i, 1); }
    var b = primeBall(); if (b && St.state === 'roll' && hyp(b.vx, b.vz) > 220) { St.trail.push({ x: b.x, y: b.y, z: b.z }); if (St.trail.length > 16) St.trail.shift(); } else if (St.trail.length) St.trail.shift();
    if (St.shake > 0) St.shake = Math.max(0, St.shake - dt * 36);
    if (St.hole) { for (i = 0; i < St.hole.bumpers.length; i++) if (St.hole.bumpers[i].flash > 0) St.hole.bumpers[i].flash -= dt; for (i = 0; i < St.hole.boosters.length; i++) if (St.hole.boosters[i].flash > 0) St.hole.boosters[i].flash -= dt; }
    if (St.bannerT > 0 && St.bannerT < 900) St.bannerT -= dt; St.t += dt;
  }
  function tick(dt) { if (St.slowT > 0) { St.slowT = Math.max(0, St.slowT - dt); dt *= 0.45; } St.acc += dt; var fx = 1 / K.hz, guard = 0; while (St.acc >= fx && guard++ < 90) { physStep(fx); St.acc -= fx; } stepVisuals(dt); }
  function frame(ts) { var dt = Math.min(0.05, (ts - St.last) / 1000 || 0); St.last = ts; if (ED.on) { if (ED.view3d) { if (ED.dirty3d) { ED.dirty3d = false; buildScene(ED.draft); } St.t += dt; var hh = St.hole; for (var wi = 0; wi < (hh.windmills || []).length; wi++) hh.windmills[wi].ang += hh.windmills[wi].speed * dt; for (var ei = 0; ei < (hh.enemies || []).length; ei++) { var en = hh.enemies[ei]; en.ph += en.speed * dt; var eu = Math.abs((en.ph % 2) - 1); en.cx = en.x + (en.ex - en.x) * eu; en.cz = en.z + (en.ez - en.z) * eu; } syncMeshes(); orbitCam(); R3.r.render(R3.scene, R3.cam); if (St.hctx) draw3DHud(St.hctx); } else if (St.hctx) drawEditor(St.hctx); requestAnimationFrame(frame); return; } if (St.state !== 'load') tick(dt); drawHUD(); requestAnimationFrame(frame); }
  function resize() { var r = St.scene.getBoundingClientRect(); St.dpr = Math.min(2, window.devicePixelRatio || 1); St.w = r.width; St.h = r.height; St.hud.width = Math.round(St.w * St.dpr); St.hud.height = Math.round(St.h * St.dpr); if (R3.ready) { R3.r.setSize(St.w, St.h, false); R3.cam.aspect = St.w / St.h; R3.cam.updateProjectionMatrix(); } if (ED.on) edToolbarLabels(); }
  function audioUI() {
    var dock = document.getElementById('snd'); if (!dock) return;
    var mb = document.getElementById('mute');
    var panel = elt('div', 'position:absolute;right:0;bottom:48px;width:210px;padding:12px 13px;border:2px solid #160d06;border-radius:12px;background:linear-gradient(180deg,#2a1c10,#160d06);box-shadow:0 7px 24px rgba(0,0,0,.6);color:#f3eedd;font:12px Georgia;display:none;', null, dock);
    AU.panel = panel;
    elt('div', 'font:900 13px Wantedo,Georgia;color:#f5c542;letter-spacing:1px;margin-bottom:10px;text-align:center;', '♪ AUDIO', panel);
    function row(label, key) {
      var r = elt('div', 'margin-bottom:9px;', null, panel);
      var top = elt('div', 'display:flex;justify-content:space-between;margin-bottom:3px;', null, r);
      elt('span', 'color:#e8dcc0;', label, top);
      var val = elt('span', 'color:#f5c542;font-weight:700;', Math.round(AU[key] * 100) + '%', top);
      var sl = elt('input', 'width:100%;accent-color:#f5c542;cursor:pointer;', null, r); sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '5'; sl.value = String(Math.round(AU[key] * 100));
      sl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      sl.addEventListener('input', function () { AU[key] = clamp((+sl.value) / 100, 0, 1); val.textContent = Math.round(AU[key] * 100) + '%'; if (!AU.ctx) audioInit(); musicStart(); audioApply(); audioSavePrefs(); });
      return sl;
    }
    row('Master', 'master'); row('Music', 'music'); row('SFX', 'sfx');
    var btnrow = elt('div', 'display:flex;gap:6px;margin-top:4px;', null, panel);
    var BCSS = 'flex:1;padding:7px;border:2px solid #160d06;border-radius:8px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:800 11px Georgia;cursor:pointer;';
    var mt = elt('button', BCSS, AU.on ? '🔊 ON' : '🔇 OFF', btnrow);
    mt.addEventListener('click', function (e) { e.stopPropagation(); AU.on = !AU.on; mt.textContent = AU.on ? '🔊 ON' : '🔇 OFF'; if (AU.on) { if (!AU.ctx) audioInit(); musicStart(); } audioApply(); audioSavePrefs(); if (mb) mb.textContent = AU.on ? '🔊' : '🔇'; });
    var nx = elt('button', BCSS, '⏭ Track', btnrow);
    nx.addEventListener('click', function (e) { e.stopPropagation(); if (!AU.ctx) audioInit(); if (!AU.started) musicStart(); else musicNext(); });
    if (mb) { mb.textContent = AU.on ? '🔊' : '🔇'; mb.title = 'Audio & volume'; mb.addEventListener('click', function (e) { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }); }
  }
  function boot() {
    audioLoadPrefs();
    St.scene = document.getElementById('scene'); St.hud = document.getElementById('hud'); St.hctx = St.hud.getContext('2d');
    initGL(St.scene); resize(); window.addEventListener('resize', resize);
    St.scene.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    St.scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', function (e) { onKey(true, e); }); window.addEventListener('keyup', function (e) { onKey(false, e); });
    var cb = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); }); };
    cb('rotL', function () { St.camOrbit -= 0.14; }); cb('rotR', function () { St.camOrbit += 0.14; });
    cb('zin', function () { R3.zoom = clamp(R3.zoom * 0.86, 0.55, 1.8); }); cb('zout', function () { R3.zoom = clamp(R3.zoom * 1.16, 0.55, 1.8); }); cb('vreset', function () { R3.zoom = 1; St.camOrbit = 0; });
    St.scene.addEventListener('wheel', function (e) { e.preventDefault(); if (ED.on && ED.view3d) { ED.orb.dist = clamp(ED.orb.dist * (e.deltaY > 0 ? 1.08 : 0.92), 0.5, 4); return; } R3.zoom = clamp(R3.zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.55, 1.8); }, { passive: false });
    audioUI();
    try { if (document.fonts) document.fonts.load('40px Wantedo'); } catch (e) {}
    edInit();
    var BTNCSS = 'position:fixed;left:12px;z-index:30;padding:7px 11px;border:2px solid #160d06;border-radius:9px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#f5c542;font:700 12px Georgia;cursor:pointer;';
    var eb = elt('button', BTNCSS + 'top:80px;', '🔧 LEVEL EDITOR', document.body); eb.onclick = edEnter;
    var lb = elt('button', BTNCSS + 'top:116px;', '📋 LEVELS', document.body); lb.onclick = levelMenu;
    var sk = elt('button', BTNCSS + 'top:152px;', '⏭ SKIP', document.body); sk.onclick = skipLevel;
    ED.dom.gameBtns = [eb, lb, sk];
    St.scores = []; St.parDone = 0; St.hi = 0; loadHole(0);
    var ld = document.getElementById('load'); if (ld) { ld.classList.add('gone'); setTimeout(function () { ld.style.display = 'none'; }, 450); }
    requestAnimationFrame(function (t) { St.last = t; frame(t); });
    versionWatch();
  }
  // never let the player stare at a stale cached build: poll the published version, offer a one-tap reload
  function versionWatch() {
    var sc = document.querySelector('script[src*="pingolf.js"]'); var cur = (sc && (sc.src.match(/[?&]v=(\d+)/) || [])[1]) || '0', shown = false;
    var self = (location.pathname.split('/').pop() || 'game.html'); // poll THIS page (the game), not the landing
    setInterval(function () {
      if (shown) return;
      fetch(self + '?vchk=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
        var m = t.match(/pingolf\.js\?v=(\d+)/);
        if (m && m[1] !== cur) {
          shown = true;
          var bar = elt('div', 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;padding:11px 18px;border:2px solid #160d06;border-radius:10px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 14px Georgia;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.55);', '🔄 New build v' + m[1] + ' ready — tap to update', document.body);
          bar.onclick = function () { location.reload(true); };
        }
      }).catch(function () { });
    }, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  /* test hooks */
  PG.game = St; PG.K = K; PG.HOLES = HOLES;
  PG.__tick = tick; PG.__render = drawHUD; PG.__load = loadHole; PG.__St = St; PG.__HOLES = HOLES; PG.__K = K;
  PG.__AU = AU; PG.__audioInit = function () { audioInit(); }; PG.__musicStart = function () { musicStart(); }; PG.__audioApply = function () { audioApply(); }; PG.__audioUI = AU; PG.__sfx = function (k) { sfx(k); }; PG.__sfxLoadAll = function () { sfxLoadAll(); }; PG.__spawnShock = function (x, gy, z, col) { spawnShock(x, gy, z, col); };
  // headless beatability bot: plays hole `hi` up to `tries` times, each as multiple aimed strokes from the ball's live position toward the cup; returns {sunk, tries, strokes}. Test-only; leaves St on hole hi (caller should reload).
  PG.__beatN = function (hi, tries, maxStrokes) {
    tries = tries || 16; maxStrokes = maxStrokes || 14;
    loadHole(hi); St.testing = true;
    var cup = St.hole.cup, sunk = false, used = 0, bestStrokes = 99;
    for (var t = 0; t < tries && !sunk; t++) {
      used = t + 1; newShotBall(); St.strokes = 0;
      var scale = 0.78 + (t % 5) * 0.11, strokes = 0;
      while (strokes < maxStrokes) {
        if (St.state !== 'aim') break;
        var b = primeBall(); if (!b) break;
        var dx = cup.x - b.x, dz = cup.z - b.z, dist = hyp(dx, dz);
        St.aimYaw = Math.atan2(dx, dz) + (Math.random() * 2 - 1) * (0.03 + (t / tries) * 0.55);
        St.camYaw = St.aimYaw;
        St.power = clamp(Math.sqrt(dist / 2600) * scale + (Math.random() * 2 - 1) * 0.12, 0.1, 1);
        shoot(); strokes++;
        var settled = false;
        for (var s = 0; s < 1100; s++) { tick(1 / 60); var pb = primeBall(); if (St.state === 'sunk' || (pb && pb.sunk)) { sunk = true; break; } if (St.state === 'aim') { settled = true; break; } }
        if (sunk) { bestStrokes = Math.min(bestStrokes, strokes); break; }
        if (!settled) break; // timed out mid-roll → abandon this try
      }
    }
    return { hi: hi, sunk: sunk, tries: used, strokes: sunk ? bestStrokes : null };
  };
  PG.__edSerialize = function () { return edSerialize(); }; PG.__edDeserialize = function (o) { return edDeserialize(o); };
  PG.__edDown = function (px, py, shift) { edDown({ x: px, y: py }, !!shift); }; PG.__edMove = function (px, py) { edMove({ x: px, y: py }); }; PG.__edUp = function () { edUp(); };
  PG.__project = function (x, y, z) { return project(x, y, z); }; PG.__ed3dWorld = function (px, py) { return ed3DToWorld({ x: px, y: py }); }; PG.__orbitCam = function () { orbitCam(); }; PG.__edSel = function () { return ED.sel; };
  PG.__predictPath = function (power) { var b = primeBall(); return b ? predictPath(b, power == null ? St.power : power) : []; };
  PG.__finishGame = function (scores) { if (scores) St.scores = scores; finishGame(); };
  PG.__edUndo = function () { edUndo(); }; PG.__edRedo = function () { edRedo(); }; PG.__edStore = function () { return edStore(); }; PG.__edSaveAs = function (nm) { ED.draft.name = nm; var s = edStore(); s[nm] = edSerialize(); localStorage.setItem('pg_levels', JSON.stringify(s)); return Object.keys(s); }; PG.__edDelLevel = function (nm) { var s = edStore(); delete s[nm]; localStorage.setItem('pg_levels', JSON.stringify(s)); return Object.keys(s); };
  PG.__shoot = function (dx, dz, power) { St.aimYaw = Math.atan2(dx, dz); St.camYaw = St.aimYaw; St.power = power; shoot(); };
  PG.__flip = function (side, down) { flipPress(side, down); };
  PG.__ed = ED; PG.__edEnter = edEnter; PG.__edPlay = edPlay; PG.__edPlace = function (brush, x, z) { ED.brush = brush; edPlace(x, z); }; PG.__edDraft = function () { return ED.draft; };
  PG.__R3 = R3; PG.__sync = syncMeshes; PG.__edShape = function (k) { applyShape(k); }; PG.__edTest = function () { edPlay(); }; PG.__edFit = function () { edFit(); }; PG.__edW2S = function (x, z) { return edW2S(x, z); }; PG.__themePhys = function (t) { return themePhys(t); }; PG.__THEMES = THEMES; PG.__levelMenu = function () { levelMenu(); }; PG.__loadCustom = function (n) { return loadCustomLevel(n); }; PG.__ed3d = function (on) { if (on) edEnter3D(); else edExit3D(); }; PG.__orb = function () { return ED.orb; }; PG.__skip = function () { skipLevel(); }; PG.__editBuiltin = function (i) { editBuiltin(i); };
})();
