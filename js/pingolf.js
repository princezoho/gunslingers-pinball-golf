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
    wallE: 0.66, wallHalf: 9, settle: 26, settleT: 0.26, vMax: 7800,
    shotMin: 325, shotMax: 6500, pullPx: 240,     // power CURVE (squared) => gentle putts + big drives
    cupR: 44, holeSpd: 1500,
    // FAST flippers
    flipSweep: 1.45, flipUpSpd: 95, flipDnSpd: 28, flipHold: 0.05, flipKick: 2400, flipE: 0.5, flipHalf: 16, flipLiveOm: 6,
    bumpKick: 1750, boostSpeed: 3600, boostCd: 0.28
  };
  var KD = {}; (function () { for (var k in K) KD[k] = K[k]; })();   // pristine defaults
  var THEMES = {
    grass: { name: 'Grass (normal)', turf: 0x9aa86a, sky: 0xc9a06a, g: 2200, rollFric: 1100, groundE: 0.32, wallE: 0.66, bumpKick: 1750, vMax: 7800 },
    ice: { name: 'Ice (slides)', turf: 0xbfe6f0, sky: 0xaccfe0, g: 2200, rollFric: 230, groundE: 0.45, wallE: 0.9, bumpKick: 1950, vMax: 8800 },
    moon: { name: 'Moon (low-G)', turf: 0x9b94aa, sky: 0x2b2746, g: 780, rollFric: 600, groundE: 0.74, wallE: 0.84, bumpKick: 1650, vMax: 7800 },
    mud: { name: 'Mud (sticky)', turf: 0x7a5a30, sky: 0x8f7848, g: 2200, rollFric: 2550, groundE: 0.12, wallE: 0.4, bumpKick: 1500, vMax: 7800 },
    rubber: { name: 'Rubber (bouncy)', turf: 0xc0392b, sky: 0xb56550, g: 2200, rollFric: 950, groundE: 0.92, wallE: 0.97, bumpKick: 2150, vMax: 8800 },
    speed: { name: 'Speedway (fast)', turf: 0xf0a830, sky: 0xdfa83e, g: 2200, rollFric: 470, groundE: 0.35, wallE: 0.7, bumpKick: 2050, vMax: 9250 },
    sand: { name: 'Sand (drag)', turf: 0xd9c08a, sky: 0xe7c486, g: 2200, rollFric: 1900, groundE: 0.2, wallE: 0.5, bumpKick: 1600, vMax: 7500 }
  };
  var PHYS_KEYS = ['g', 'rollFric', 'groundE', 'wallE', 'cupR', 'shotMax', 'bumpKick', 'flipKick', 'vMax'];
  function applyPhys(phys) { PHYS_KEYS.forEach(function (k) { K[k] = (phys && phys[k] != null) ? phys[k] : KD[k]; }); }
  function themePhys(theme) { var t = THEMES[theme] || THEMES.grass, p = {}; PHYS_KEYS.forEach(function (k) { p[k] = t[k] != null ? t[k] : KD[k]; }); return p; }
  var COL = { gold: '#ffffff', cream: '#f5efdc', ink: '#191007', red: '#df3b32', grn: '#86d85f', blue: '#3aa0ff' };
  // POWER-UPS — beneficial pickups (roll over to grab). c/e = body+glow colour, ch = map glyph, dur = effect seconds (0 = instant)
  var PU = {
    magnet: { c: 0xff4477, e: 0x7a0a2a, ch: 'M', name: 'MAGNET', dur: 3.6, info: 'Pulls the ball toward the cup for a few seconds — grab it near the green and let it suck you in.' },
    shield: { c: 0x33b6ff, e: 0x0a4a7a, ch: 'S', name: 'SHIELD', dur: 0, info: 'Blocks the next hazard — one laser zap, enemy hit or stun just bounces off harmlessly.' },
    slow: { c: 0x9b6bff, e: 0x3a1a7a, ch: 'T', name: 'SLOW-MO', dur: 4.0, info: 'Bullet-time! Everything slows down so you can thread spinning windmills and laser gates.' },
    gem: { c: 0xff9a2a, e: 0x7a3a08, ch: '', name: 'GEM', dur: 0, info: 'Instant jackpot — a big pile of bonus points the moment you grab it.' },
    jump: { c: 0x49d36a, e: 0x14702a, ch: '↑', name: 'JUMP', dur: 0, info: 'Pops the ball up into the air — hop clean over walls and hazards like a proper mini-golf jump.' }
  };
  var PU_KINDS = ['magnet', 'shield', 'slow', 'gem', 'jump'];
  var BUILD = 'BUILD 222 · HOLE GENERATOR';

  /* ================================================================ HOLE BUILDER
     A tiny DSL: each hole function fills a builder with obstacles and returns it. */
  function builder() {
    var b = {
      walls: [], bumpers: [], boosters: [], flippers: [], windmills: [], lasers: [], loops: [], warps: [], portals: [], firerings: [], enemies: [], coins: [], powerups: [], spinners: [], cannons: [], bouncers: [], gates: [], conveyors: [], pendulums: [], turntables: [], multiball: null,
      terrainFeatures: [], noBox: false,
      wall: function (ax, az, bx, bz, o) { o = o || {}; var _dx = bx - ax, _dz = bz - az; this.walls.push({ ax: ax, az: az, bx: bx, bz: bz, e: o.e == null ? K.wallE : o.e, h: Math.min(o.h || 46, 240), c: o.c || 0x8a5a32, curve: !!o.curve, tunnel: !!o.tunnel, _mx: (ax + bx) / 2, _mz: (az + bz) / 2, _hl: Math.sqrt(_dx * _dx + _dz * _dz) / 2 + K.R + K.wallHalf + 8 }); return this; },   // _mx/_mz/_hl = bounding circle for fast broad-phase culling (skip far walls in predictPath + collide). curve:true = organic curb rail; tunnel:true = glass channel rail

      box: function (x0, z0, x1, z1, o) { this.wall(x0, z0, x1, z0, o); this.wall(x1, z0, x1, z1, o); this.wall(x1, z1, x0, z1, o); this.wall(x0, z1, x0, z0, o); this.hw = Math.max(Math.abs(x0), Math.abs(x1)); return this; },
      // SEE-THROUGH TUNNEL — a covered channel from (ax,az)→(bx,bz): two glass side rails (collision via wall()) + a translucent roof (rendered in buildScene). The ball rolls through on the ground and stays VISIBLE the whole way — the "blocking" geometry is see-through glass.
      tunnel: function (ax, az, bx, bz, o) { o = o || {}; var w = o.w || 200, h = o.h || 62; var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz); if (L < 1) return this; if (!o.noRails) { var nx = -dz / L, nz = dx / L; this.wall(ax + nx * w, az + nz * w, bx + nx * w, bz + nz * w, { tunnel: true, h: h, e: o.e }); this.wall(ax - nx * w, az - nz * w, bx - nx * w, bz - nz * w, { tunnel: true, h: h, e: o.e }); } (this.tunnels = this.tunnels || []).push({ ax: ax, az: az, bx: bx, bz: bz, w: w, h: h, roofOnly: !!o.noRails }); return this; },   // noRails:true = glass roof only over an EXISTING channel (collision already there) — zero physics change
      shape: function (poly, o) {   // ORGANIC FAIRWAY — poly is a closed ring of {x,z}; curb walls run along every edge and the green is rendered to this exact outline. No rectangle.
        o = o || {}; o.curve = true;   // smooth rail, no per-segment posts
        for (var i = 0; i < poly.length; i++) { var a = poly[i], bp = poly[(i + 1) % poly.length]; this.wall(a.x, a.z, bp.x, bp.z, o); }
        this.shape = poly; var mx = 0; for (var j = 0; j < poly.length; j++) mx = Math.max(mx, Math.abs(poly[j].x)); this.hw = mx; return this;
      },
      ring: function (cx, cz, r, n, o, a0, a1) { a0 = a0 || 0; a1 = a1 == null ? TAU : a1; n = n || 22; var prev = null; for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n, p = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; if (prev) this.wall(prev.x, prev.z, p.x, p.z, o); prev = p; } return this; },
      spiral: function (cx, cz, r0, r1, turns, n, o) { var prevIn = null, prevOut = null, w = (r1 - r0) * 0.18 + 60; for (var i = 0; i <= n; i++) { var t = i / n, a = t * turns * TAU, r = lerp(r1, r0, t); var inn = { x: cx + Math.cos(a) * (r - w / 2), z: cz + Math.sin(a) * (r - w / 2) }, out = { x: cx + Math.cos(a) * (r + w / 2), z: cz + Math.sin(a) * (r + w / 2) }; if (prevIn) { this.wall(prevIn.x, prevIn.z, inn.x, inn.z, o); this.wall(prevOut.x, prevOut.z, out.x, out.z, o); } prevIn = inn; prevOut = out; } return this; },
      bumper: function (x, z, r) { this.bumpers.push({ x: x, z: z, r: r || 40, flash: 0 }); return this; },
      booster: function (x, z, ang, r, spd) { this.boosters.push({ x: x, z: z, dx: Math.cos(ang), dz: Math.sin(ang), r: r || 110, spd: spd || K.boostSpeed, flash: 0 }); return this; },
      flip: function (side, x, z, len, rot, speed) { var rest = (side === 'L' ? -0.5 : PI + 0.5) + (rot || 0); this.flippers.push({ side: side, px: x, pz: z, len: len || 150, rot: rot || 0, speed: speed || 1, ang: rest, om: 0, held: false, holdT: 0, live: false }); return this; },
      windmill: function (x, z, r, blades, speed) { this.windmills.push({ x: x, z: z, r: r || 200, n: blades || 4, speed: speed || 1.6, ang: 0, om: 0 }); return this; },
      // SLIDING GATE — a solid bar slides back & forth along the track A→B, opening then closing a gap. Time your run through the open window. barFrac = bar length as a fraction of the track (rest is the gap); speed = slide rate; h = wall height.
      gate: function (ax, az, bx, bz, o) { o = o || {}; this.gates.push({ ax: ax, az: az, bx: bx, bz: bz, barFrac: o.barFrac == null ? 0.5 : o.barFrac, speed: o.speed == null ? 1.4 : o.speed, ph: o.phase || 0, h: o.h || 70, e: o.e == null ? 0.45 : o.e, flash: 0, cax: ax, caz: az, cbx: ax, cbz: az }); return this; },
      // CONVEYOR BELT — a moving strip that continuously DRAGS the ball along `ang` while it rolls over the zone (a steady current, unlike the booster's one-shot fling). w=width across, len=length along the belt, force=push strength.
      conveyor: function (x, z, w, len, ang, force) { this.conveyors.push({ x: x, z: z, w: w || 220, len: len || 520, ang: ang == null ? 0 : ang, force: force == null ? 2600 : force, flash: 0 }); return this; },
      // PENDULUM — a wrecking ball on an arm swings across the lane (cross-lane), dipping to ground level at the bottom of the arc. Time your pass for when the bob is up to one side. amp=swing angle, speed=swing rate, len=arm length, rb=bob radius.
      pendulum: function (x, z, o) { o = o || {}; this.pendulums.push({ x: x, z: z, len: o.len || 360, amp: o.amp == null ? 1.15 : o.amp, speed: o.speed == null ? 1.5 : o.speed, rb: o.rb || 46, ph: o.phase || 0, ang: 0, flash: 0 }); return this; },
      // TURNTABLE — a spinning disc that whirls the ball around it (a rotational current; the ball gains tangential speed and spirals off the edge). r=radius, spin=angular speed (sign = direction).
      turntable: function (x, z, r, spin) { this.turntables.push({ x: x, z: z, r: r || 220, spin: spin == null ? 2.2 : spin, ang: 0, flash: 0 }); return this; },
      cannon: function (x, z, ang, power) { this.cannons.push({ x: x, z: z, ang: ang == null ? 0 : ang, power: power || 4200, r: 60, flash: 0 }); return this; },   // roll in → BLAST the ball airborne in the cannon's direction
      bouncer: function (x, z, r) { this.bouncers.push({ x: x, z: z, r: r || 64, flash: 0 }); return this; },   // a spring pad — boings the ball straight up
      loopde: function (x, z, r, ang) { this.loops.push({ x: x, z: z, r: r || 130, ang: ang == null ? 0 : ang }); return this; },   // ang 0 = the loop runs DOWN the lane (tee->cup) like a traditional loop-de-loop; PI/2 was sideways
      warp: function (x, z, ex, ez, r) { this.warps.push({ x: x, z: z, ex: ex == null ? x : ex, ez: ez == null ? z + 360 : ez, r: r || 50, flash: 0 }); return this; },
      tube: function (ax, az, bx, bz, r) { this.warps.push({ x: ax, z: az, ex: bx, ez: bz, r: r || 58, flash: 0, tube: true }); return this; },   // a PIPE the ball rolls into and shoots out the far end (uses the warp teleport physics, drawn as an arcing tube)
      // SEPARATE FLOATING ISLAND — a green polygon at its OWN height (y), with a cliff skirt + curb walls; off every island is a void. Connect islands with drop-holes/tubes/portals.
      island: function (poly, y, o) { o = o || {}; y = y || 0; var p = poly.map(function (q) { return { x: q.x, z: q.z }; }); (this.islands = this.islands || []).push({ poly: p, y: y }); this.terrainFeatures.push({ kind: 'platform', poly: p, y: y }); for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; this.wall(a.x, a.z, b.x, b.z, { e: o.e == null ? 0.55 : o.e, h: o.h || 66, curve: true }); } this.noBox = true; return this; },
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
  function terrainFn(features, cup) {
    var feats = cup ? features.filter(function (f) { return !(f.kind === 'funnel' && hyp(f.x - cup.x, f.z - cup.z) < 140); }) : features;   // design rule: the cup sits ON the green, never at the bottom of a funnel pit
    var plats = feats.filter(function (f) { return f.kind === 'platform'; });   // SEPARATE ISLANDS: each is a polygon at its own height; OFF every island = a deep void (the ball falls)
    return function (x, z) {
      var h = 0;
      if (plats.length) { h = -2400; for (var pj = 0; pj < plats.length; pj++) { if (inPolyWind(plats[pj].poly, x, z) || edgeDist(plats[pj].poly, x, z) < 40) { h = plats[pj].y || 0; break; } } }   // land on the island under (x,z) (incl. its curb edge), else void
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
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
  function botFlip(b, tz) { var hw = b.hw || 410, px = hw - 50, fz = tz + 60; b.flip('L', -px, fz, 150).flip('R', px, fz, 150); return b; }
  function H1() { // GREENHORN GULCH — hourglass fairway: thread the waist between the slingshots, then curl into the offset green
    var b = builder().box(-410, -40, 410, 1660, { h: 52 });
    botFlip(b, 110);
    b.tunnel(0, 230, 0, 560, { w: 190, h: 64 });             // see-through glass tunnel over the opening straight into the waist
    b.wall(-410, 620, -130, 850, { h: 52, e: 0.62 }).wall(410, 620, 130, 850, { h: 52, e: 0.62 });    // the pinch
    b.wall(-130, 850, -410, 1090, { h: 52, e: 0.62 }).wall(130, 850, 410, 1090, { h: 52, e: 0.62 });  // opens back out
    b.bumper(-185, 740, 36).bumper(185, 740, 36);            // slingshots guard the waist
    b.hill(-220, 1330, 280, 120);                            // bank behind the green curls the ball toward the cup
    b.booster(-250, 1150, 0.62, 110, 2600);                  // ride the left lane into the green
    b.coin(0, 850, 1).coin(-180, 1180, 1).coin(60, 1330, 2);
    b.bumper(0, 1180, 40);
    return finish(b, 'GREENHORN GULCH', 3, { x: 0, z: 110 }, { x: 140, z: 1460 }, -470, 470, -60, 1680);
  }
  function H2() { // BUMPER BARN — three stalls: brave the bumper alley up the middle or bank the clean side lanes
    var b = builder().box(-470, -40, 470, 1980, { h: 52 });
    botFlip(b, 120, 180);
    b.bumper(-300, 520, 40).bumper(300, 520, 40);            // slingshots
    b.wall(-160, 760, -160, 1480, { h: 52 }).wall(160, 760, 160, 1480, { h: 52 });   // barn stalls
    b.tunnel(0, 760, 0, 1480, { w: 160, h: 66, noRails: true });                     // SEE-THROUGH glass barn roof over the bumper alley (reuses the stall walls — no physics change)
    b.bumper(0, 900, 44).bumper(0, 1130, 46).bumper(0, 1360, 44);                    // the gauntlet lane
    b.coin(-315, 900, 1).coin(-315, 1130, 1).coin(315, 900, 1).coin(315, 1130, 1);   // loot down the safe lanes
    b.booster(0, 1700, PI / 2, 130, 2900);
    b.powerup(0, 660, 'shield');                             // tank the alley
    b.funnel(0, 1830, 160, 90);
    return finish(b, 'BUMPER BARN', 4, { x: 0, z: 120 }, { x: 0, z: 1830 }, -530, 530, -60, 2000);
  }
  function H3() { // SLOPE SALOON — a true dogleg-left: drive long, bank off the corner, turn down the saloon corridor
    var b = builder().box(-490, -40, 490, 1920, { h: 52 });
    botFlip(b, 130);
    b.wall(490, 1100, -40, 1100, { h: 52, e: 0.78 });        // the elbow — lively bank wall
    b.wall(-40, 1100, -40, 1760, { h: 52, e: 0.6 });         // corridor wall (gap left at the top as an escape hatch)
    b.hill(330, 940, 300, 150);                              // corner bank kicks the drive around the elbow
    b.slope(-0.018, 0);                                      // the whole fairway leans toward the corridor
    b.bumper(-250, 1280, 40);                                // corridor guard
    b.booster(-270, 1180, PI / 2, 120, 2700);                // corridor speed pad to the green
    b.coin(330, 800, 1).coin(-270, 1080, 1).coin(-270, 1420, 1);
    b.powerup(150, 560, 'magnet');
    return finish(b, 'SLOPE SALOON', 4, { x: 0, z: 130 }, { x: -280, z: 1720 }, -550, 550, -60, 1940);
  }
  function H4() { // THE BIG JUMP — blast up the ramp and fly to the green
    var b = builder().box(-390, -40, 390, 2120, { h: 52 });
    botFlip(b, 120);
    b.bumper(-250, 560, 40).bumper(250, 600, 40);
    b.booster(0, 560, PI / 2, 150, 3700);                   // speed into the ramp
    b.ramp(780, 1060, 155, 330, 52);                        // launch ramp + lip
    b.bumper(-210, 1560, 44).bumper(210, 1600, 44).bumper(0, 1700, 46);
    b.powerup(-150, 480, 'jump');                           // hop before the launch ramp
    b.bumper(-150, 680, 34).bumper(150, 700, 34);
    return finish(b, 'THE BIG JUMP', 3, { x: 0, z: 120 }, { x: 0, z: 1990 }, -450, 450, -60, 2140);
  }
  function H5() { // WINDMILL RUN — split fairway: the windmill guards the short right lane, the long left is a bumper run
    var b = builder().box(-410, -40, 410, 2020, { h: 52 });
    botFlip(b, 120);
    b.bumper(-300, 560, 40).bumper(300, 560, 40);
    b.wall(-110, 820, 110, 820, { h: 52 }).wall(110, 820, 110, 1400, { h: 52 }).wall(110, 1400, -110, 1400, { h: 52 }).wall(-110, 1400, -110, 820, { h: 52 });   // centre island
    b.windmill(260, 1110, 195, 4, 2.0);                      // sweeps the short right lane
    b.bumper(-260, 1000, 38).bumper(-260, 1240, 38);         // pinball down the long left lane
    b.coin(260, 920, 2).coin(260, 1300, 2);                  // danger pay
    b.booster(0, 360, PI / 2, 130, 3000);
    b.funnel(0, 1860, 170, 90);
    b.bumper(0, 1620, 42);
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
    b.bumper(-500, 980, 44).bumper(500, 1280, 44);
    return finish(b, 'SPIRAL FUNNEL', 4, { x: 0, z: 120 }, { x: 0, z: 1120 }, -800, 800, -60, 1920);
  }
  function H7() { // LASER GAUNTLET — switchback trench: baffle walls zigzag the fairway and every gap is laser-gated
    var b = builder().box(-390, -40, 390, 2120, { h: 52 });
    botFlip(b, 120);
    b.wall(-390, 700, 90, 900, { h: 52, e: 0.55 });          // baffle 1 — gap on the right
    b.laser(90, 920, 390, 920, 2.4, 0.42, 0.0);
    b.wall(390, 1150, -90, 1350, { h: 52, e: 0.55 });        // baffle 2 — gap on the left
    b.laser(-390, 1370, -90, 1370, 2.4, 0.42, 1.2);
    b.laser(-390, 1760, 390, 1760, 3.0, 0.32, 0.6);          // final full gate, generous window
    b.bumper(250, 760, 38).bumper(-250, 1210, 38);           // gap guards
    b.powerup(0, 560, 'shield');                             // block one zap
    b.booster(240, 1010, PI / 2, 110, 2800);                 // slings you up the right gap
    b.coin(250, 840, 1).coin(-250, 1290, 1).coin(0, 1560, 2);
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
    b.bumper(-150, 1380, 40).bumper(150, 1420, 40);
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
    b.bumper(-300, 1440, 40).bumper(300, 1470, 40);
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
    b.funnel(0, 1780, 210, 115);                            // ice-rink catcher (tightened: must land near the cup)
    b.booster(0, 320, PI / 2, 130, 2600);
    b.bumper(-210, 1300, 40).bumper(210, 1340, 40);
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
    b.funnel(0, 2020, 165, 95);
    b.powerup(180, 1300, 'gem');                            // low-G loot
    b.bumper(-190, 1760, 40).bumper(190, 1800, 40);
    return finish(b, 'MOON CRATERS', 4, { x: 0, z: 120 }, { x: 0, z: 2020 }, -490, 490, -60, 2200);
  }
  function H12() { // GHOST TOWN PORTALS — the canyon wall seals the fairway: the vortex is the ONLY way through
    var b = builder().box(-470, -40, 470, 2160, { h: 56 });
    botFlip(b, 120);
    b.bumper(-300, 560, 40).bumper(300, 600, 40);
    b.wall(-470, 1210, 470, 1210, { h: 110, e: 0.7 });       // the canyon wall — bounces strays back toward the vortex
    b.portal(0, 1120, [{ x: -300, z: 1520 }, { x: 0, z: 1580 }, { x: 300, z: 1520 }], 64);   // right at the wall's foot
    b.coin(-90, 760, 1).coin(90, 760, 1).coin(0, 1380, 2);
    b.funnel(0, 2000, 160, 90);
    b.booster(0, 320, PI / 2, 130, 3000);
    b.bumper(-370, 1700, 40).bumper(370, 1700, 40);
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
    b.funnel(0, 2030, 150, 85);
    b.powerup(150, 1700, 'gem');                            // bonus past the loops
    b.bumper(-300, 720, 38).bumper(300, 1520, 38);
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
    b.bumper(-330, 1140, 38).bumper(330, 1620, 38);
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
    b.funnel(0, 2020, 150, 85);
    b.bumper(-340, 1060, 38).bumper(340, 1420, 38); b.enemy(-340, 700, 340, 700, 40, 1.0, 'spiky', 'patrol', 'knockback');
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
    b.funnel(0, 2020, 170, 100);
    b.booster(0, 320, PI / 2, 130, 3400);
    b.powerup(0, 1560, 'gem');                              // the big one
    b.bumper(-330, 1340, 40).bumper(330, 1380, 40);
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
    b.funnel(0, 2060, 150, 85);
    b.powerup(-160, 640, 'jump');                           // optional early hop
    b.bumper(-170, 760, 34).bumper(170, 800, 34);
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
    b.funnel(0, 1860, 150, 85);
    b.booster(0, 320, PI / 2, 130, 3000);
    b.powerup(0, 1400, 'magnet');                           // reel into the lower green
    b.bumper(-150, 1040, 38).bumper(150, 1080, 38);
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
    b.funnel(0, 1760, 225, 125);                            // springy catcher (tightened)
    b.booster(0, 300, PI / 2, 120, 2400);
    b.bumper(-330, 860, 42).bumper(330, 1200, 42);
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
    b.funnel(0, 2680, 160, 90);
    b.bumper(-340, 1900, 40).bumper(340, 1940, 40);
    return finish(b, 'THE LAST STAND', 6, { x: 0, z: 130 }, { x: 0, z: 2680 }, -550, 550, -60, 2840);
  }
  function finish(b, name, par, tee, cup, minX, maxX, minZ, maxZ) {
    b.name = name; b.par = Math.min(par, 4); b.tee = tee; b.cup = cup;
    b.terrain = terrainFn(b.terrainFeatures, cup);
    b.bounds = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
    return b;
  }

  // extra paddle pair anywhere down the lane (longer holes get several)
  function pad(b, z, hw, len) { hw = hw || (b.hw ? b.hw - 50 : 380); b.flip('L', -hw, z, len || 150).flip('R', hw, z, len || 150); return b; }

  /* ===================== NEW FRONT 9 — longer, harder, two-tier & contraptions, all par <=4 ===================== */
  function N1() { // DEAD MAN'S DRIFT — long sweeping S, three paddle banks, slingshots
    var b = builder().box(-460, -40, 460, 2520, { h: 54 });
    botFlip(b, 120); pad(b, 900, 410); pad(b, 1620, 410);
    b.wall(-460, 560, -150, 820, { h:54, e:.62 }).wall(460, 1180, 150, 1440, { h:54, e:.62 }); // the two drift kinks
    b.bumper(-210, 700, 38).bumper(210, 1300, 38).bumper(0, 1980, 42);
    b.hill(220, 2230, 300, 130);
    b.coin(0,780,1).coin(-140,1500,1).coin(160,2050,2);
    b.booster(-260, 360, 0.5, 110, 2500);
    b.tunnel(0, 230, 0, 540, { w: 300, h: 66 });   // see-through glass tunnel over the opening straight — roll through and stay visible
    return finish(b, "DEAD MAN'S DRIFT", 4, { x:0, z:120 }, { x:-150, z:2330 }, -520, 520, -60, 2540);
  }
  function N2() { // TWO-STEP MESA — climb a tier, a windmill gate, drop-hole to the low green
    var b = builder().box(-440, -40, 440, 2480, { h:56 });
    botFlip(b, 120); pad(b, 820, 380);
    b.tier(1180, 130, 9999);                              // upper deck back half
    b.ramp(980, 1200, 130, 9999, 999999);                // ramp onto the deck
    b.windmill(0, 760, 210, 4, 1.7);                     // gate before the climb
    b.bumper(-260, 520, 40).bumper(260, 560, 40);
    b.warp(0, 1640, 0, 2150, 56);                        // drop-hole down to the green
    b.coin(-120,1360,1).coin(120,1360,1).coin(0,1980,2);
    b.bumper(-250, 2040, 42).bumper(250, 2080, 42);
    b.booster(0, 300, PI/2, 130, 3000);
    return finish(b, 'TWO-STEP MESA', 4, { x:0, z:120 }, { x:0, z:2150 }, -500, 500, -60, 2500);
  }
  function N3() { // RATTLESNAKE GULCH — twin timed lasers, tight lane, paddles between
    var b = builder().box(-430, -40, 430, 2560, { h:54 });
    botFlip(b, 120); pad(b, 760, 380); pad(b, 1560, 380);
    b.laser(-430, 900, 430, 900, 2.4, 0.5, 0);          // gate 1
    b.laser(-430, 1360, 430, 1360, 2.4, 0.5, 1.2);      // gate 2 (staggered)
    b.bumper(-220, 600, 38).bumper(220, 640, 38).bumper(0, 1120, 40);
    b.hill(-220, 2250, 300, 130);
    b.coin(0,720,1).coin(0,1180,1).coin(0,1900,2);
    b.booster(0, 320, PI/2, 120, 2700);
    return finish(b, 'RATTLESNAKE GULCH', 4, { x:0, z:120 }, { x:150, z:2360 }, -490, 490, -60, 2580);
  }
  function N4() { // STAMPEDE ALLEY — a long bumper storm with boosters and four paddle banks
    var b = builder().box(-500, -40, 500, 2760, { h:54 });
    botFlip(b, 120); pad(b, 760, 420); pad(b, 1420, 420); pad(b, 2060, 420);
    var bx=[-300,-100,100,300], bz=[640,940,1240,1540,1840];
    for (var i=0;i<bz.length;i++){ b.bumper(bx[i%4], bz[i], 40); b.bumper(-bx[i%4], bz[i]+150, 40); }
    b.booster(-300, 360, 0.6, 110, 2500).booster(300, 2200, PI-0.6, 110, 2500);
    b.hill(0, 2480, 320, 130);
    b.coin(-360,900,1).coin(360,1300,1).coin(0,2300,2);
    return finish(b, 'STAMPEDE ALLEY', 4, { x:0, z:120 }, { x:0, z:2560 }, -560, 560, -60, 2780);
  }
  function N5() { // CANYON SPLIT — a sealed wall; a portal is the only way across, windmill guard
    var b = builder().box(-470, -40, 470, 2520, { h:56 });
    botFlip(b, 120); pad(b, 820, 400);
    b.wall(-470, 1300, 470, 1300, { h:120 });            // the canyon wall seals the fairway
    b.portal(-250, 1080, [{x:250,z:1640},{x:-250,z:1640}], 50); // cross to a random far side
    b.windmill(250, 1900, 200, 5, 1.8);
    b.bumper(-250, 600, 40).bumper(250, 640, 40);
    b.coin(-250,900,1).coin(250,1740,1).coin(0,2180,2);
    b.booster(0, 320, PI/2, 130, 2900); b.hill(0, 2300, 300, 120);
    return finish(b, 'CANYON SPLIT', 4, { x:0, z:120 }, { x:0, z:2360 }, -530, 530, -60, 2540);
  }
  function N6() { // HIGH NOON HOP — blast up a ramp and JUMP the gap through a fire hoop to the green
    var b = builder().box(-440, -40, 440, 2620, { h:56 });
    botFlip(b, 120); pad(b, 760, 380);
    b.ramp(900, 1180, 200, 9999, 60);                    // launch ramp
    b.firering(0, 1500, 120, 150, 150, 2.4);             // hoop over the gap
    b.tier(1700, 80, 9999);                              // landing deck
    b.bumper(-250, 560, 40).bumper(250, 600, 40);
    b.booster(0, 520, PI/2, 150, 3700);                 // speed into the ramp
    b.coin(0,820,1).coin(0,1500,2).coin(0,2150,1);
    b.bumper(-230, 2080, 42).bumper(230, 2120, 42);
    b.hill(0, 2380, 300, 120);
    return finish(b, 'HIGH NOON HOP', 4, { x:0, z:120 }, { x:0, z:2440 }, -500, 500, -60, 2640);
  }
  function N7() { // VARMINT VALLEY II — patrolling critters + chaser, tight paddled lane
    var b = builder().box(-470, -40, 470, 2560, { h:54 });
    botFlip(b, 120); pad(b, 820, 400); pad(b, 1640, 400);
    b.enemy(-300, 900, 300, 900, 42, 0.9, 'spiky', 'patrol', 'knockback');
    b.enemy(300, 1300, -300, 1300, 42, 0.9, 'blob', 'patrol', 'knockback');
    b.enemy(0, 1900, 0, 1900, 46, 1.1, 'ghost', 'chase', 'stun');
    b.bumper(-240, 600, 38).bumper(240, 640, 38);
    b.coin(-150,1100,1).coin(150,1500,1).coin(0,2150,2);
    b.booster(0, 320, PI/2, 120, 2600); b.hill(180, 2280, 300, 120);
    return finish(b, 'VARMINT VALLEY II', 4, { x:0, z:120 }, { x:-150, z:2360 }, -530, 530, -60, 2580);
  }
  function N8() { // WINDMILL ROW — three staggered turning gates down a long lane, paddles between
    var b = builder().box(-450, -40, 450, 2680, { h:54 });
    botFlip(b, 120); pad(b, 700, 390); pad(b, 1900, 390);
    b.windmill(0, 1000, 200, 4, 1.5).windmill(-180, 1450, 190, 3, -1.9).windmill(180, 1450, 190, 3, 1.9);
    b.bumper(-260, 600, 40).bumper(260, 640, 40);
    b.coin(0,820,1).coin(0,1220,1).coin(0,2150,2);
    b.booster(0, 320, PI/2, 130, 3000); b.hill(0, 2420, 300, 130);
    return finish(b, 'WINDMILL ROW', 4, { x:0, z:120 }, { x:0, z:2500 }, -510, 510, -60, 2700);
  }
  function N9() { // THE RECKONING — front-9 finale: tier, helix loop, laser, bumper storm, paddles
    var b = builder().box(-480, -40, 480, 2820, { h:56 });
    botFlip(b, 120); pad(b, 760, 410); pad(b, 1500, 410); pad(b, 2160, 410);
    b.booster(0, 360, PI/2, 150, 4200); b.loopde(0, 760, 150);
    b.laser(-480, 1180, 480, 1180, 2.2, 0.45, 0.4);
    b.windmill(0, 1560, 200, 5, 1.8);
    b.bumper(-300, 1900, 42).bumper(300, 1940, 42).bumper(0, 2200, 44);
    b.tier(2350, 70, 9999);
    b.coin(0,1000,1).coin(-180,1750,1).coin(180,1750,1).coin(0,2450,2);
    b.hill(0, 2560, 320, 130);
    return finish(b, 'THE RECKONING', 4, { x:0, z:120 }, { x:0, z:2620 }, -540, 540, -60, 2840);
  }

  /* ===================== ISLANDS 9 — organic free-form fairways floating over the sea (no rectangles) ===================== */
  function ribbon(wp, width) {   // build a curvy fairway polygon: smooth the waypoints into a spline, then offset ±width/2 to get left+right banks → an organic outline
    var v = wp.map(function (p) { return new T.Vector3(p[0], 0, p[1]); });
    var curve = new T.CatmullRomCurve3(v, false, 'catmullrom', 0.5);
    var N = 30, pts = curve.getSpacedPoints(N), L = [], R = [];
    for (var i = 0; i <= N; i++) {
      var p = pts[i], p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(N, i + 1)];
      var tx = p1.x - p0.x, tz = p1.z - p0.z, tl = hyp(tx, tz) || 1; tx /= tl; tz /= tl;
      var nx = -tz, nz = tx, t = i / N, w = (typeof width === 'function' ? width(t) : width) / 2;
      L.push({ x: p.x + nx * w, z: p.z + nz * w }); R.push({ x: p.x - nx * w, z: p.z - nz * w });
    }
    return L.concat(R.reverse());
  }
  function isl(name, par, wp, width, fn) {   // CRAZY-SHAPED gunslinger hole — organic tiered green in the normal desert world.
    var b = builder().shape(ribbon(wp, width), { h: 50, e: 0.6 });
    var poly = b.shape, w0 = (typeof width === 'function' ? width(0) : width), N = wp.length;
    // TEE — inset forward from the start cap, on the centerline (not jammed against the end edge)
    var s0 = wp[0], s1 = wp[1], sl = hyp(s1[0] - s0[0], s1[1] - s0[1]) || 1, tee = { x: s0[0] + (s1[0] - s0[0]) / sl * 90, z: s0[1] + (s1[1] - s0[1]) / sl * 90 };
    // CUP — inset back from the end along the path until the hole clears every edge by cupR + 26 (so it never punches half-off the green)
    var eN = wp[N - 1], eP = wp[N - 2], el = hyp(eN[0] - eP[0], eN[1] - eP[1]) || 1, edx = (eN[0] - eP[0]) / el, edz = (eN[1] - eP[1]) / el, cup, ins = 70;
    do { cup = { x: eN[0] - edx * ins, z: eN[1] - edz * ins }; ins += 28; } while (ins < 460 && (!inPoly(poly, cup.x, cup.z) || edgeDist(poly, cup.x, cup.z) < K.cupR + 26));
    // PADDLES — shrink until BOTH pivots sit safely inside the green (no poking through the curb)
    var fw = Math.min(w0 / 2 - 110, 230);
    while (fw > 80 && (!inPoly(poly, tee.x - fw, tee.z + 50) || !inPoly(poly, tee.x + fw, tee.z + 50) || edgeDist(poly, tee.x - fw, tee.z + 50) < 60 || edgeDist(poly, tee.x + fw, tee.z + 50) < 60)) fw -= 16;
    if (fw > 90) b.flip('L', tee.x - fw, tee.z + 50, 150).flip('R', tee.x + fw, tee.z + 50, 150);
    if (fn) fn(b, tee, cup);
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    poly.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
    return finish(b, name, par, tee, cup, minX - 40, maxX + 40, minZ - 40, maxZ + 40);
  }
  function ISL1() { return isl('TIDAL TWIST', 3, [[0, 0], [-220, 520], [240, 1040], [-160, 1560], [40, 2040]], 540, function (b) { b.hill(-160, 1040, 320, 90).hill(60, 1660, 280, 80); b.bumper(-40, 1040, 40).bouncer(-160, 1560).coin(-160, 520, 1).coin(240, 1040, 1); }); }
  function ISL2() { return isl('THE ELBOW', 3, [[0, 0], [0, 760], [120, 1080], [560, 1240], [980, 1320]], 500, function (b) { b.tier(880, 140, 9999); b.tube(20, 560, 560, 1240, 64); b.bumper(120, 1080, 42).coin(0, 760, 1).coin(560, 1240, 2); }); }
  function ISL3() {   // THREE FORKS — the fairway fans into THREE lanes (bumper alley / hill / slide) that all reconverge at the cup. Pick your route.
    var b = builder();
    var poly = [{ x: -250, z: 0 }, { x: -640, z: 480 }, { x: -700, z: 1000 }, { x: -680, z: 1620 }, { x: -340, z: 2060 }, { x: -150, z: 2360 }, { x: 150, z: 2360 }, { x: 340, z: 2060 }, { x: 680, z: 1620 }, { x: 700, z: 1000 }, { x: 640, z: 480 }, { x: 250, z: 0 }];
    b.shape(poly, { h: 62, e: 0.55 });
    b.wall(-230, 600, -230, 1600, { h: 62 });   // lane divider 1
    b.wall(230, 600, 230, 1600, { h: 62 });      // lane divider 2  → 3 lanes between z 600–1600, merging above
    b.bumper(-460, 880, 40).bumper(-460, 1320, 40);   // LEFT lane — bumper alley
    b.hill(0, 1080, 270, 120);                         // MID lane — a hill to climb
    b.tube(460, 860, 0, 1880, 60);                     // RIGHT lane — a SLIDE straight to the converge
    b.firering(0, 1780, 110, 170, 150);                // fire hoop in the merge
    b.coin(-460, 700, 1).coin(460, 700, 1).coin(0, 1880, 2);
    return finish(b, 'THREE FORKS', 4, { x: 0, z: 150 }, { x: 0, z: 2270 }, -760, 760, -80, 2480);
  }
  function ISL4() {   // DIAMONDBACK RUN — a long snake: THREE tight pinches between THREE big arenas, with a slide, a hill, a wrecking ball, a fire hoop and a teleport
    return isl('DIAMONDBACK RUN', 4,
      [[0, 0], [-340, 560], [320, 1080], [-300, 1580], [320, 2080], [-140, 2520], [0, 2880]],
      function (t) { return 165 + 540 * Math.pow(Math.sin(t * PI * 3), 2); },   // tight ~165 pinches between big ~705 arenas
      function (b, tee, cup) {
        b.hill(-340, 560, 320, 130);                                   // hill in arena 1
        b.bumper(-240, 560, 38).bumper(-440, 560, 38);
        b.tube(320, 1080, -300, 1580, 66);                             // SLIDE across the bend
        b.pendulum(0, 1330, { len: 270, amp: 0.8, speed: 1.2, rb: 36 });   // wrecking ball in a pinch
        b.firering(320, 2080, 115, 175, 150);                          // FIRE HOOP (bonus) in arena 3
        b.portal(-140, 2520, [{ x: 0, z: 2740 }], 52);                 // TELEPORT toward the cup
        b.coin(-340, 560, 1).coin(320, 2080, 1).coin(0, 2880, 2);
      });
  }
  function ISL5() {   // STEPPING STONES — floating isles: ride a LOOP-DE-LOOP on the tee isle into the tube, land on the mid isle, ride a CONVEYOR to the drop hole, fall to the cup isle
    function circ(cx, cz, r) { var p = [], n = 18, sd = cz * 0.01 + cx * 0.013; for (var i = 0; i < n; i++) { var t = i / n * TAU; var rr = r * (0.82 + 0.26 * Math.sin(t * 2 + sd) + 0.12 * Math.sin(t * 3 - sd * 1.7)); p.push({ x: Math.round(cx + Math.cos(t) * rr), z: Math.round(cz + Math.sin(t) * rr * 1.04) }); } return p; }   // organic BLOB island (lobed, seeded by position) — not a plain circle; min radius 0.44r keeps centers/exits safely inside
    var b = builder();
    b.island(circ(0, 360, 320), 180, { h: 90 });       // A — tee island (now wider, to fit the loop)
    b.island(circ(0, 1240, 360), 180, { h: 90 });       // B — mid island (tube lands here; a belt carries you on)
    b.island(circ(0, 2240, 360), -60, { h: 90 });       // C — cup island
    b.loopde(0, 470, 105, 0);                            // LOOP-DE-LOOP on the tee isle, into the tube mouth
    b.tube(0, 620, 0, 1240, 70);                         // A -> B
    b.conveyor(0, 1380, 320, 360, PI / 2, 2400);         // BELT on B: sweeps the ball toward the drop hole
    b.warp(0, 1540, 0, 2240, 74);                        // DROP B -> C
    b.bumper(-170, 1240, 36).coin(0, 620, 1).coin(0, 2300, 2);
    return finish(b, 'STEPPING STONES', 4, { x: 0, z: 230 }, { x: 0, z: 2300 }, -480, 480, -160, 2740);
  }
  function ISL6() {   // ARCHIPELAGO — the LONGEST island run: four separate isles, each hop a different contraption — TUBE, DROP, then PORTAL, descending to the cup isle
    function circ(cx, cz, r) { var p = [], n = 18, sd = cz * 0.01 + cx * 0.013; for (var i = 0; i < n; i++) { var t = i / n * TAU; var rr = r * (0.82 + 0.26 * Math.sin(t * 2 + sd) + 0.12 * Math.sin(t * 3 - sd * 1.7)); p.push({ x: Math.round(cx + Math.cos(t) * rr), z: Math.round(cz + Math.sin(t) * rr * 1.04) }); } return p; }   // organic BLOB island (lobed, seeded by position) — not a plain circle; min radius 0.44r keeps centers/exits safely inside
    var b = builder();
    b.island(circ(0, 320, 290), 220, { h: 90 });       // A — tee
    b.island(circ(0, 1100, 300), 220, { h: 90 });       // B — tube lands here
    b.island(circ(0, 1880, 300), 80, { h: 90 });        // C — drop lands here
    b.island(circ(0, 2660, 320), -100, { h: 90 });      // D — cup island (portal)
    b.tube(0, 480, 0, 1100, 68);                         // A -> B
    b.warp(0, 1280, 0, 1880, 72);                        // B -> C
    b.portal(0, 2060, [{ x: 0, z: 2660 }], 54);          // C -> D
    b.bumper(150, 1100, 36).bumper(-150, 1880, 36).coin(0, 480, 1).coin(0, 2060, 1).coin(0, 2720, 2);
    return finish(b, 'ARCHIPELAGO', 4, { x: 0, z: 240 }, { x: 0, z: 2720 }, -440, 440, -160, 3140);
  }
  function ISL7() {   // CASTAWAY COVE — TRUE floating islands: tee on the high isle, DROP through a hole onto a separate lower isle, then a portal TELEPORTS you to the cup island
    function circ(cx, cz, r) { var p = [], n = 18, sd = cz * 0.01 + cx * 0.013; for (var i = 0; i < n; i++) { var t = i / n * TAU; var rr = r * (0.82 + 0.26 * Math.sin(t * 2 + sd) + 0.12 * Math.sin(t * 3 - sd * 1.7)); p.push({ x: Math.round(cx + Math.cos(t) * rr), z: Math.round(cz + Math.sin(t) * rr * 1.04) }); } return p; }   // organic BLOB island (lobed, seeded by position) — not a plain circle; min radius 0.44r keeps centers/exits safely inside
    var b = builder();
    b.island(circ(0, 360, 340), 180, { h: 90 });      // A — tee island (high)
    b.island(circ(0, 1280, 360), 40, { h: 90 });       // B — middle island
    b.island(circ(0, 2200, 380), -120, { h: 90 });     // C — cup island (low)
    b.warp(0, 560, 0, 1280, 74);                        // DROP HOLE: roll off island A's far edge, fall onto island B
    b.portal(0, 1480, [{ x: 0, z: 2000 }], 56);        // PORTAL: island B → island C (the cup island)
    b.bumper(150, 1280, 40).coin(0, 560, 1).coin(0, 2000, 2);
    return finish(b, 'CASTAWAY COVE', 4, { x: 0, z: 240 }, { x: 0, z: 2300 }, -520, 520, -160, 2680);
  }
  function ISL8() {   // CORAL BEND — floating isles bridged by a TUBE: shoot through the pipe to the next island, then DROP to the cup isle
    function circ(cx, cz, r) { var p = [], n = 18, sd = cz * 0.01 + cx * 0.013; for (var i = 0; i < n; i++) { var t = i / n * TAU; var rr = r * (0.82 + 0.26 * Math.sin(t * 2 + sd) + 0.12 * Math.sin(t * 3 - sd * 1.7)); p.push({ x: Math.round(cx + Math.cos(t) * rr), z: Math.round(cz + Math.sin(t) * rr * 1.04) }); } return p; }   // organic BLOB island (lobed, seeded by position) — not a plain circle; min radius 0.44r keeps centers/exits safely inside
    var b = builder();
    b.island(circ(0, 340, 320), 140, { h: 90 });       // A — tee island
    b.island(circ(0, 1240, 340), 140, { h: 90 });       // B — same height: the TUBE bridges the gap
    b.island(circ(0, 2100, 360), -80, { h: 90 });       // C — lower cup island
    b.tube(0, 540, 0, 1240, 70);                         // TUBE: shoot across the gap from A to B
    b.warp(0, 1460, 0, 2100, 72);                        // DROP HOLE: fall from B down to the cup isle C
    b.bumper(-150, 1240, 40).bumper(150, 1240, 40).coin(0, 540, 1).coin(0, 2100, 2);
    return finish(b, 'CORAL BEND', 4, { x: 0, z: 230 }, { x: 0, z: 2160 }, -500, 500, -160, 2560);
  }
  function ISL9() {   // CONTRAPTION ALLEY — the WILD-9 finale: a gauntlet of ALL the new contraptions — conveyor, sliding gate, spinning turntable, swinging wrecking ball.
    var b = builder().box(-400, -40, 400, 2500, { h: 58 });
    b.conveyor(0, 560, 360, 320, PI / 2, 2200);                          // speed strip off the tee
    b.gate(-400, 1000, 400, 1000, { barFrac: 0.4, speed: 1.3, h: 70 });  // time the sliding gate
    b.turntable(0, 1380, 175, 1.8);                                       // spin zone
    b.pendulum(0, 1860, { len: 340, amp: 1.0, speed: 1.2, rb: 44 });     // dodge the wrecking ball
    b.coin(0, 560, 1).coin(0, 2180, 2);
    return finish(b, 'CONTRAPTION ALLEY', 4, { x: 0, z: 120 }, { x: 0, z: 2360 }, -460, 460, -60, 2620);
  }
  var ISLANDS9 = [ISL1, ISL2, ISL3, ISL4, ISL5, ISL6, ISL7, ISL8, ISL9];
  var FRONT9 = [N1, N2, N3, N4, N5, N6, N7, N8, N9];
  var MIDDLE9 = [H1, H2, H3, H4, H5, H6, H7, H8, H9];
  var BACK9  = [H10, H11, H12, H13, H14, H15, H16, H17, H18];
  var HOLES = FRONT9.concat(MIDDLE9, BACK9, ISLANDS9);


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
      var coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches; R3.r.setPixelRatio(Math.min(coarse ? 1.2 : 1.5, window.devicePixelRatio || 1));   // phones get a lighter pixel load; FXAA+MSAA keep edges clean   // cap at 1.5x: FXAA+MSAA keep edges clean, ~45% fewer pixels = solid 60fps on retina
      if (T.sRGBEncoding) R3.r.outputEncoding = T.sRGBEncoding;
      if (T.ACESFilmicToneMapping) { R3.r.toneMapping = T.ACESFilmicToneMapping; R3.r.toneMappingExposure = 1.14; }
      R3.r.shadowMap.enabled = true; R3.r.shadowMap.type = T.PCFSoftShadowMap || T.PCFShadowMap; R3.r.shadowMap.autoUpdate = false;   // we drive shadow updates manually (every few frames) instead of a full shadow re-render EVERY frame — big CPU + GC win, the soft shadows lag imperceptibly
      R3.scene = new T.Scene(); R3.scene.fog = new T.Fog(0xc9a06a, 2200, 5600);
      R3.cam = new T.PerspectiveCamera(58, 1, 1, 14000);
      var amb0 = new T.AmbientLight(0xffdcb0, 0.2); R3.scene.add(amb0); R3.amb = amb0;
      var hemi0 = new T.HemisphereLight(0xffe0ae, 0x4a3320, 0.42); R3.scene.add(hemi0); R3.hemi = hemi0;
      var sun = new T.DirectionalLight(0xffbf52, 1.6); sun.position.set(-820, 1250, -360); sun.castShadow = true;   // low, warm golden-hour sun
      sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
      var sc = sun.shadow.camera; sc.near = 100; sc.far = 4400; sc.left = -1150; sc.right = 1150; sc.top = 1150; sc.bottom = -1150;   // tight frustum around the table = much crisper shadows from the same 2048 map
      sun.shadow.bias = -0.0005; if ('normalBias' in sun.shadow) sun.shadow.normalBias = 2;
      R3.scene.add(sun.target); R3.scene.add(sun); R3.sun = sun;
      var rim = new T.DirectionalLight(0xbfe0ff, 0.6); rim.position.set(650, 760, 1050); R3.scene.add(rim); R3.rim = rim; var fill = new T.DirectionalLight(0xffcf8a, 0.28); fill.position.set(700, 380, -200); R3.scene.add(fill); R3.fill = fill; var spot = new T.SpotLight(0xfff0e0, 0, 2000, 0.55, 0.88, 0); spot.position.set(0, 1500, -160); R3.scene.add(spot.target); R3.scene.add(spot); R3.spot = spot; R3.spotBase = 0; R3.sunOff = { x: -1020, y: 760, z: -560 };   // cool back-rim + warm low fill + a theatrical SPOTLIGHT that tracks the ball (lit per mood)
      R3.prism = []; R3.prismDefaultCols = [0xff1f8f, 0x12d8ff, 0xffb02e, 0x9b5cff, 0x39ff9c];   // REAL coloured lights (magenta / cyan / amber / violet / lime) that orbit the table and ADDITIVELY illuminate the actual geometry — neon looks come from light, not a filter. Colours overridable per mood (vaporwave = magenta/cyan).
      for (var _pi = 0; _pi < R3.prismDefaultCols.length; _pi++) { var _pl = new T.PointLight(R3.prismDefaultCols[_pi], 0, 1900, 1.1); _pl.position.set(0, 300, 0); R3.scene.add(_pl); R3.prism.push(_pl); } R3.prismOn = false; R3.prismI = 0;
      initEnv(); initPost(); R3.zoom = 1; R3.ready = true; return true;
    } catch (e) { R3.ready = false; return false; }
  }
  // ===== LIGHTING MOODS — distinct cinematic looks (lights + tone-map exposure + fog + post-FX color grade) =====
  var MOODS = {
    daytime: { name: 'Daylight', exp: 1.26, sun: { c: 0xfff6e0, i: 2.5 }, amb: { c: 0xbcd0f0, i: 0.13 }, hemi: { s: 0xbcd8ff, g: 0x5a4d34, i: 0.3 }, rim: { c: 0xeaf4ff, i: 0.34 }, fill: { c: 0xffe8c0, i: 0.12 }, fog: 0xcfe2f2, grade: { sat: 1.2, sep: 0, shad: [0.82, 0.9, 1.06], high: [1.1, 1.07, 0.9], lo: 0.16, hi: 0.9, con: 1.34, bright: 0.97, lift: 0.18 }, ca: 0.0014, grain: 0.04, vig: 0.32, shadowR: 0.6 },   // harsh NOON sun: blazing key light + very low ambient so shadows stay DARK & hard-edged (not washed flat)
    sunset: { name: 'Sunset', exp: 1.14, sun: { c: 0xffbf52, i: 1.6 }, amb: { c: 0xffdcb0, i: 0.2 }, hemi: { s: 0xffe0ae, g: 0x4a3320, i: 0.42 }, rim: { c: 0xbfe0ff, i: 0.6 }, fill: { c: 0xffcf8a, i: 0.28 }, fog: 0xc9a06a, grade: { sat: 1.14, sep: 0, shad: [0.9, 0.97, 1.08], high: [1.12, 1.01, 0.82], lo: 0.18, hi: 0.75, con: 1.16, bright: 0.93, lift: 1 }, ca: 0.0026, grain: 0.13, vig: 0.4 },
    night: { name: 'Moody Night', exp: 0.64, sun: { c: 0x8aa2e6, i: 1.0 }, amb: { c: 0x1c2a52, i: 0.18 }, hemi: { s: 0x24345c, g: 0x05070e, i: 0.36 }, rim: { c: 0xb2ceff, i: 1.05 }, fill: { c: 0x2a3868, i: 0.15 }, fog: 0x070a18, grade: { sat: 0.95, sep: 0, shad: [0.28, 0.42, 0.9], high: [0.84, 0.98, 1.18], lo: 0.08, hi: 0.64, con: 1.38, bright: 0.72, lift: 1.5, gmAmt: 0.5, gm: [[0.02, 0.04, 0.12], [0.1, 0.21, 0.48], [0.62, 0.82, 1.0]] }, ca: 0.003, grain: 0.16, vig: 0.68 },
    noir: { name: 'Film Noir', exp: 1.0, sun: { c: 0xffffff, i: 2.15 }, amb: { c: 0x202020, i: 0.12 }, hemi: { s: 0x484848, g: 0x0e0e0e, i: 0.26 }, rim: { c: 0xffffff, i: 0.7 }, fill: { c: 0x2c2c2c, i: 0.09 }, fog: 0x1f2226, grade: { sat: 0, sep: 0, shad: [1, 1, 1], high: [1, 1, 1], lo: 0.2, hi: 0.78, con: 1.66, bright: 0.98, lift: 1.0 }, ca: 0.0015, grain: 0.24, vig: 0.7 },
    faded: { name: 'Dusty Faded', exp: 1.12, sun: { c: 0xffd89a, i: 1.95 }, amb: { c: 0xc8b08a, i: 0.22 }, hemi: { s: 0xe0c79a, g: 0x4a3a24, i: 0.4 }, rim: { c: 0xffe6b8, i: 0.5 }, fill: { c: 0xffcf88, i: 0.2 }, fog: 0xc8a972, grade: { sat: 0.78, sep: 0.12, shad: [0.86, 0.82, 0.7], high: [1.18, 1.04, 0.74], lo: 0.16, hi: 0.84, con: 1.04, bright: 0.98, lift: 1.4, gmAmt: 0.5, gm: [[0.22, 0.16, 0.1], [0.62, 0.5, 0.34], [0.98, 0.9, 0.72]] }, ca: 0.0024, grain: 0.34, vig: 0.52, shadowR: 1.2 },   // sun-baked DUSTY: warm low sun + hazy amber fog + airborne dust motes (not just a washed-out grade); warm sepia gradient, real grain, soft shadows
    redglow: { name: 'Red Glow', exp: 0.82, sun: { c: 0xff5a3a, i: 1.6 }, amb: { c: 0x441010, i: 0.22 }, hemi: { s: 0x561616, g: 0x0c0303, i: 0.36 }, rim: { c: 0xff9a66, i: 0.75 }, fill: { c: 0x741f1f, i: 0.2 }, fog: 0x190505, grade: { sat: 0.96, sep: 0, shad: [0.48, 0.09, 0.09], high: [1.52, 0.68, 0.34], lo: 0.12, hi: 0.72, con: 1.36, bright: 0.84, lift: 1.3, gmAmt: 0.52, gm: [[0.12, 0.01, 0.02], [0.66, 0.12, 0.05], [1.0, 0.62, 0.22]] }, ca: 0.0036, grain: 0.2, vig: 0.64 },
    sincity: { name: 'Sin City', exp: 1.05, sun: { c: 0xffffff, i: 2.35 }, amb: { c: 0x141414, i: 0.1 }, hemi: { s: 0x343434, g: 0x060606, i: 0.22 }, rim: { c: 0xffffff, i: 0.75 }, fill: { c: 0x222222, i: 0.08 }, fog: 0x101010, grade: { sat: 0.07, sep: 0, shad: [0.9, 0.9, 0.95], high: [1.06, 1.0, 1.0], lo: 0.16, hi: 0.74, con: 1.98, bright: 1.0, lift: 0.5 }, ca: 0.0016, grain: 0.28, vig: 0.78 },
    vaporwave: { name: 'Vaporwave', exp: 0.74, sun: { c: 0xff2da0, i: 2.4 }, amb: { c: 0x1a0838, i: 0.12 }, hemi: { s: 0x3a1170, g: 0x08112e, i: 0.3 }, rim: { c: 0x22d6ff, i: 3.2 }, fill: { c: 0x9020ff, i: 0.4 }, fog: 0x120426, grade: { sat: 1.34, sep: 0, shad: [1, 1, 1], high: [1, 1, 1], lo: 0.16, hi: 0.86, con: 1.22, bright: 0.66, lift: 0.9, gmAmt: 0.62, gm: [[0.22, 0.02, 0.46], [0.9, 0.14, 0.7], [0.2, 0.98, 1.0]], scan: 0.16 }, ca: 0.0098, grain: 0.06, vig: 0.5, lights: 'prism', prismCols: [0xff1f9f, 0x18e0ff, 0x18e0ff, 0xff1f9f, 0xb83cff], prismI: 6.8 },   // NEON 80s: hot magenta key + cyan rim + purple fill + ORBITING neon magenta/cyan point lights, dark base (low exp + post-darken) so the neon dominates, purple→magenta→cyan gradient map, scanlines + heavy chromatic aberration + bloom glow
    prismatic: { name: 'Prismatic', exp: 0.66, sun: { c: 0x161d33, i: 0.14 }, amb: { c: 0x0a0f22, i: 0.07 }, hemi: { s: 0x101733, g: 0x04030c, i: 0.12 }, rim: { c: 0x7a40ff, i: 0.25 }, fill: { c: 0x12193a, i: 0.08 }, fog: 0x03020a, grade: { sat: 1.42, sep: 0, shad: [1, 1, 1], high: [1, 1, 1], lo: 0.18, hi: 0.82, con: 1.26, bright: 0.5, lift: 0.45 }, ca: 0.0115, grain: 0.05, vig: 0.64, lights: 'prism', prismI: 15.0 },   // dark base (low exp) so the orbiting coloured POINT LIGHTS become the dominant light → distinct magenta/cyan/amber pools that mix additively on the real geometry; heavy chromatic aberration
    cartoon: { name: 'Cartoon', exp: 0.89, sun: { c: 0xffffff, i: 1.1 }, amb: { c: 0xdde6f5, i: 0.34 }, hemi: { s: 0xcfdcf0, g: 0x8a7a62, i: 0.36 }, rim: { c: 0xffffff, i: 0.3 }, fill: { c: 0xffffff, i: 0.22 }, fog: 0xc9b89a, grade: { sat: 1.42, sep: 0, shad: [0.97, 0.98, 1.02], high: [1.02, 1.0, 0.95], lo: 0.2, hi: 0.82, con: 1.22, bright: 0.9, lift: 0.4 }, ca: 0.0066, grain: 0.0, vig: 0.36 },   // FLAT-colour comic: moderate key + low exposure so the saturated flat colours stay PUNCHY without blowing out; clear lit/shadow split; heavy CA   // FLAT-colour comic: strong key + lower ambient so the 2-band toon reads a clear lit/shadow split; heavy chromatic aberration
    cel: { name: 'Cel Shaded', exp: 0.95, sun: { c: 0xfff0d0, i: 1.45 }, amb: { c: 0xc8d4ee, i: 0.4 }, hemi: { s: 0xc6d4ee, g: 0x6a5a3a, i: 0.5 }, rim: { c: 0xffffff, i: 0.42 }, fill: { c: 0xffe8c0, i: 0.3 }, fog: 0xccb89a, grade: { sat: 1.32, sep: 0, shad: [0.9, 0.96, 1.06], high: [1.04, 1.02, 0.94], lo: 0.18, hi: 0.82, con: 1.24, bright: 0.92, lift: 0.55 }, ca: 0.004, grain: 0.0, vig: 0.34 },   // FLAT-colour anime cel: smooth 4-band toon on flat colours, low exposure so they stay rich; more CA
    tron: { name: 'Tron', exp: 1.0, sun: { c: 0x2aa0ff, i: 1.2 }, amb: { c: 0x041018, i: 0.2 }, hemi: { s: 0x0a2030, g: 0x000408, i: 0.3 }, rim: { c: 0x46e0ff, i: 1.2 }, fill: { c: 0x103040, i: 0.2 }, fog: 0x020608, grade: { sat: 0.6, sep: 0, shad: [1, 1, 1], high: [1, 1, 1], lo: 0.2, hi: 0.8, con: 1.3, bright: 1.0, lift: 0.6, gmAmt: 0.72, gm: [[0.0, 0.03, 0.07], [0.05, 0.3, 0.7], [0.4, 0.95, 1.0]], edge: 1.25, style: 2.0 }, ca: 0.003, grain: 0.06, vig: 0.6 },
    line: { name: 'Line Art', exp: 1.05, sun: { c: 0xffffff, i: 1.4 }, amb: { c: 0xffffff, i: 0.7 }, hemi: { s: 0xffffff, g: 0xcccccc, i: 0.7 }, rim: { c: 0xffffff, i: 0.3 }, fill: { c: 0xffffff, i: 0.4 }, fog: 0xd6d2c6, grade: { sat: 0, sep: 0, shad: [1, 1, 1], high: [1, 1, 1], lo: 0.2, hi: 0.85, con: 1.42, bright: 0.84, lift: 0.18 }, ca: 0.0, grain: 0.05, vig: 0.34, lineEdges: true },   // ink-on-PAPER: muted paper tone kept below bloom so it never blows out; feature-edge lines + bold silhouette do the drawing
    wireframe: { name: 'Wireframe', exp: 1.0, sun: { c: 0xffffff, i: 1.5 }, amb: { c: 0x111111, i: 0.3 }, hemi: { s: 0x222222, g: 0x000000, i: 0.3 }, rim: { c: 0xffffff, i: 0.5 }, fill: { c: 0x222222, i: 0.2 }, fog: 0x000000, grade: { sat: 0.4, sep: 0, shad: [1, 1, 1], high: [1, 1, 1], lo: 0.2, hi: 0.8, con: 1.2, bright: 1.0, lift: 0.6 }, ca: 0.002, grain: 0.03, vig: 0.52, wire: true }
  };
  var MOOD_ORDER = ['daytime', 'sunset', 'night', 'noir', 'faded', 'redglow', 'sincity', 'prismatic', 'vaporwave', 'cartoon', 'cel', 'tron', 'line', 'wireframe'];
  // theatrical SPOTLIGHT per mood (tracks the ball; i=intensity, c=colour, a=cone angle). Dramatic for the dark looks, off for the flat/bright ones.
  var SPOTS = { sunset: { i: 0.45, c: 0xffe0b0, a: 0.55 }, daytime: { i: 0, c: 0xffffff, a: 0.55 }, night: { i: 1.4, c: 0xcfe0ff, a: 0.5 }, noir: { i: 0.55, c: 0xffffff, a: 0.48 }, faded: { i: 0.3, c: 0xffe8c8, a: 0.55 }, redglow: { i: 1.3, c: 0xff7a4a, a: 0.52 }, sincity: { i: 0.6, c: 0xffffff, a: 0.46 }, vaporwave: { i: 1.1, c: 0xff6ad5, a: 0.52 }, cartoon: { i: 0, c: 0xffffff, a: 0.55 }, cel: { i: 0.5, c: 0xfff0d0, a: 0.55 }, tron: { i: 1.3, c: 0x46e0ff, a: 0.52 }, line: { i: 0, c: 0xffffff, a: 0.55 }, wireframe: { i: 0, c: 0xffffff, a: 0.55 } };
  function resolveMood() {
    var um = null; try { um = localStorage.getItem('pg_mood'); } catch (e) { }
    if (um && MOODS[um]) return um;                                            // player's chosen look (settings override)
    if (St.hole && St.hole.mood && MOODS[St.hole.mood]) return St.hole.mood;   // hole's own default mood (night/noir holes)
    return 'sunset';
  }
  function applyMood(name) {
    var m = MOODS[name] || MOODS.sunset; St.mood = MOODS[name] ? name : 'sunset';
    if (!R3.ready) return m;
    if (R3.r.toneMapping) R3.r.toneMappingExposure = m.exp;
    function L(o, c, i) { if (!o) return; o.color.setHex(c); o.intensity = i; }
    L(R3.sun, m.sun.c, m.sun.i); L(R3.amb, m.amb.c, m.amb.i); L(R3.rim, m.rim.c, m.rim.i); L(R3.fill, m.fill.c, m.fill.i);
    if (R3.hemi) { R3.hemi.color.setHex(m.hemi.s); R3.hemi.groundColor.setHex(m.hemi.g); R3.hemi.intensity = m.hemi.i; }
    if (R3.sun && R3.sun.shadow) { R3.sun.shadow.radius = m.shadowR != null ? m.shadowR : 1; }   // crisp hard shadows (daytime) vs soft (default)
    if (R3.spot) { var sp = SPOTS[St.mood] || SPOTS.sunset; R3.spotBase = sp.i; R3.spot.color.setHex(sp.c); R3.spot.angle = sp.a; R3.spot.intensity = sp.i; }
    R3.prismOn = m.lights === 'prism'; R3.prismI = R3.prismOn ? (m.prismI || 3.0) : 0; var _pcols = m.prismCols || R3.prismDefaultCols; if (R3.prism) R3.prism.forEach(function (pl, _i) { pl.intensity = R3.prismOn ? R3.prismI : 0; if (R3.prismOn && _pcols) pl.color.setHex(_pcols[_i % _pcols.length]); });   // real coloured lights fire in prismatic + vaporwave (orbit + pulse in renderGL); colours per-mood (vaporwave overrides to neon magenta/cyan)
    ensureDust(); if (R3.moodDust) { R3.moodDust.visible = !!m.dust; R3.moodDust.material.opacity = m.dust ? (m.dustOp || 0.55) : 0; if (m.dust && m.dustC != null) R3.moodDust.material.color.setHex(m.dustC); }   // airborne dust motes for the Dusty look (moodDust — distinct from the old removed R3.dust)
    if (R3.scene && R3.scene.fog) R3.scene.fog.color.setHex(m.fog);
    if (R3.post && R3.post.mat) { var u = R3.post.mat.uniforms, g = m.grade; u.uSat.value = g.sat; u.uSep.value = g.sep; u.uShad.value.set(g.shad[0], g.shad[1], g.shad[2]); u.uHigh.value.set(g.high[0], g.high[1], g.high[2]); u.uLo.value = g.lo; u.uHi.value = g.hi; u.uCon.value = g.con; u.uBright.value = g.bright; u.uLift.value = g.lift; u.uGrain.value = m.grain; u.uVig.value = m.vig; R3.post.ca = m.ca;
      u.uGmAmt.value = g.gmAmt || 0; if (g.gm) { u.uGm0.value.set(g.gm[0][0], g.gm[0][1], g.gm[0][2]); u.uGm1.value.set(g.gm[1][0], g.gm[1][1], g.gm[1][2]); u.uGm2.value.set(g.gm[2][0], g.gm[2][1], g.gm[2][2]); } u.uPost.value = g.post || 0; u.uEdge.value = g.edge || 0; u.uStyle.value = g.style || 0; u.uScan.value = g.scan || 0; }
    // B&W moods (noir / sin city) → desaturate the HUD canvas + on-screen controls too, so the whole frame reads black-and-white
    var _gf = m.grade.sat < 0.12 ? 'grayscale(1) contrast(1.04)' : '';
    [St.hud, document.getElementById('cam'), document.getElementById('snd')].concat(R3.hudBtns || []).forEach(function (e) { if (e) try { e.style.filter = _gf; } catch (x) { } });
    if (R3.r.shadowMap) R3.r.shadowMap.needsUpdate = true;
    wireSync(); toonSync(); setFxOverlay(St.mood);
    return m;
  }
  // CINEMATIC FX OVERLAY — real bokeh/dust/film footage (assets/fx/*.mp4) screen-blended over the render per mood. Black footage → transparent; only the light/particles/grain show. This is the AAA way (compositing real plates), not 3D point sprites.
  // Overlays ONLY where the footage IS the aesthetic — NOT on every mood (owner: "doesn't make sense on night or rainbow"). Clean lighting looks (daytime / night / prismatic) get no plate.
  var FXLAYERS = {
    faded:     { src: 'dust-motes',     op: 0.3 },    // sun-baked airborne dust — the dust IS the look
    noir:      { src: 'film-dirt',      op: 0.26 },   // old-film scratches + dirt
    sincity:   { src: 'film-dirt',      op: 0.28 },   // B&W film damage
    sunset:    { src: 'bokeh-gold',     op: 0.15 },   // golden-hour bokeh, a dreamy hint
    redglow:   { src: 'bokeh-gold',     op: 0.16 },   // warm floating embers
    vaporwave: { src: 'particles-fine', op: 0.16 }    // retro VHS particle grain
  };
  function setFxOverlay(mood) {
    var v = document.getElementById('fxOverlay'); if (!v) return;
    var fx = FXLAYERS[mood];
    if (!fx) { v.style.opacity = 0; v.style.display = 'none'; return; }
    v.style.display = 'block';
    if (v._fxSrc !== fx.src) { v._fxSrc = fx.src; v.src = 'assets/fx/' + fx.src + '.mp4'; try { v.load(); } catch (e) { } var p = v.play(); if (p && p.catch) p.catch(function () { }); }
    v.style.opacity = fx.op;
  }
  // REAL wireframe: build LineSegments from each mesh's EdgesGeometry (only FEATURE edges — a flat floor = its outline, a box = 12 edges, NOT every triangle) on a black world; the ball keeps a full WireframeGeometry so it still reads as a sphere. Overlays follow moving objects (ball, obstacles) every frame.
  function buildWireframe() {
    R3.wireDirty = false;
    if (R3.wireGroup) { R3.scene.remove(R3.wireGroup); R3.wireGroup.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
    R3.wireGroup = new T.Group(); R3.wireGroup.frustumCulled = false;
    if (!R3.wireLineMat) R3.wireLineMat = new T.LineBasicMaterial({ color: 0x2cffe0, fog: false });
    var balls = R3.ballMeshes || [];
    R3.group.traverse(function (o) {
      if (!o.isMesh || !o.geometry || o === R3.ballLocator) return;
      var isBall = balls.indexOf(o) >= 0, eg;
      try { eg = isBall ? new T.WireframeGeometry(o.geometry) : new T.EdgesGeometry(o.geometry, 32); } catch (e) { return; }   // 32° threshold = only structural edges survive, smooth curves/terrain stay clean
      if (!eg) return;
      if (eg.attributes.position && eg.attributes.position.count === 0) { eg.dispose(); if (!isBall) return; try { eg = new T.WireframeGeometry(o.geometry); } catch (e2) { return; } }   // a smooth sphere has no hard edges → fall back to full wireframe so it isn't invisible
      var ls = new T.LineSegments(eg, R3.wireLineMat); ls.matrixAutoUpdate = false; ls.frustumCulled = false;
      o.updateWorldMatrix(true, false); ls.matrix.copy(o.matrixWorld); ls.userData.src = o;
      R3.wireGroup.add(ls);
    });
    R3.scene.add(R3.wireGroup);
  }
  function wireSync() {
    if (!R3.scene || !R3.group) return;
    if (St.mood === 'wireframe') {
      if (!R3.wireBg) R3.wireBg = new T.Color(0x02040b);
      if (R3.wireDirty || !R3.wireGroup) buildWireframe();
      R3.group.visible = false;                                  // hide the textured fills; the edge overlay renders instead
      if (R3.wireGroup) {
        R3.wireGroup.visible = true;
        R3.group.updateWorldMatrix(false, true);                 // refresh world matrices even though the group is hidden (so overlays track the ball / moving parts)
        var kids = R3.wireGroup.children;
        for (var i = 0; i < kids.length; i++) { var s = kids[i].userData.src; if (s && s.visible) { kids[i].visible = true; kids[i].matrix.copy(s.matrixWorld); } else kids[i].visible = false; }
      }
      if (R3.scene.background !== R3.wireBg) { R3.scene.background = R3.wireBg; if (R3.scene.fog) R3.scene.fog.color.setHex(0x02040b); }
    } else {
      if (!R3.group.visible) R3.group.visible = true;
      if (R3.wireGroup) R3.wireGroup.visible = false;
      if (R3.scene.overrideMaterial) R3.scene.overrideMaterial = null;
      if (R3.holeBg && R3.scene.background !== R3.holeBg) R3.scene.background = R3.holeBg;
    }
  }
  // REAL toon shading: a NEAREST-filtered gradient ramp drives MeshToonMaterial → genuine BANDED lighting (not a posterize filter); inverted-hull back-faces give a real geometry ink outline (not a 2D Sobel pass).
  function toonGrad(steps, floor, ceil) { floor = floor || 0; ceil = ceil == null ? 1 : ceil; var c = document.createElement('canvas'); c.width = steps; c.height = 1; var x = c.getContext('2d'); for (var i = 0; i < steps; i++) { var v = Math.round(255 * (floor + (ceil - floor) * Math.pow(i / (steps - 1), 0.85))); x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.fillRect(i, 0, 1, 1); } var t = new T.CanvasTexture(c); t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; }
  function buildOutline() {
    R3.outlineDirty = false;
    if (R3.toonOutline) R3.scene.remove(R3.toonOutline);   // geometry is SHARED with the originals — don't dispose
    R3.toonOutline = new T.Group(); R3.toonOutline.frustumCulled = false;
    if (!R3.outlineMat) R3.outlineMat = new T.ShaderMaterial({ uniforms: { oT: { value: 4.2 }, oCol: { value: new T.Color(0x0a0a0e) } }, side: T.BackSide, fog: false, vertexShader: ['uniform float oT;', 'void main(){ vec3 p = position + normalize(normal) * oT; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }'].join('\n'), fragmentShader: ['uniform vec3 oCol;', 'void main(){ gl_FragColor = vec4(oCol, 1.0); }'].join('\n') });
    if (!R3.inkMat) R3.inkMat = new T.LineBasicMaterial({ color: 0x14140f, fog: false });   // black feature-edge lines for Line Art (internal detail, not just silhouette)
    if (R3.lineEdgeGroup) R3.scene.remove(R3.lineEdgeGroup);
    R3.lineEdgeGroup = new T.Group(); R3.lineEdgeGroup.frustumCulled = false;
    R3.group.traverse(function (o) {
      if (!o.isMesh || !o.geometry || o === R3.ballLocator || o.renderOrder <= -1) return;   // skip the sky dome (renderOrder -2)
      if (!o.geometry.attributes || !o.geometry.attributes.normal) return;                    // hull needs normals
      var m = new T.Mesh(o.geometry, R3.outlineMat); m.matrixAutoUpdate = false; m.frustumCulled = false; m.userData.src = o; m.renderOrder = 1;
      o.updateWorldMatrix(true, false); m.matrix.copy(o.matrixWorld); R3.toonOutline.add(m);
      try { var eg = new T.EdgesGeometry(o.geometry, 32); if (eg.attributes.position && eg.attributes.position.count > 0) { var le = new T.LineSegments(eg, R3.inkMat); le.matrixAutoUpdate = false; le.frustumCulled = false; le.userData.src = o; le.renderOrder = 2; le.matrix.copy(o.matrixWorld); R3.lineEdgeGroup.add(le); } else eg.dispose(); } catch (e) { }   // internal feature-edge ink lines (Line Art only)
    });
    R3.scene.add(R3.toonOutline); R3.scene.add(R3.lineEdgeGroup);
  }
  function toonSync() {
    if (!R3.scene || !R3.group) return;
    var mood = St.mood, isToon = (mood === 'cartoon' || mood === 'cel'), isLine = (mood === 'line'), on = isToon || isLine;
    if (on) {
      if (!R3.toonGrad) { R3.toonGrad = toonGrad(4, 0.42, 0.9); R3.toonGradC = toonGrad(2, 0.5, 0.82); }   // cel = 4 SMOOTH bands (floored+capped so flat colours don't blow); cartoon = 2 hard FLAT bands. Both drop the texture map → flat colour.
      if (R3.outlineDirty || !R3.toonOutline) buildOutline();
      var grad = (mood === 'cel') ? R3.toonGrad : R3.toonGradC;
      R3.group.traverse(function (o) {
        if (!o.isMesh || !o.material || o === R3.ballLocator || o.renderOrder <= -1) return;
        if (!o.userData.origMat) o.userData.origMat = o.material;
        var src = o.userData.origMat;
        if (isLine) { if (!o.userData.lineMat) o.userData.lineMat = new T.MeshBasicMaterial({ color: 0xc9c4b6 }); o.material = o.userData.lineMat; }   // ink-on-paper: muted paper grey (below the bloom threshold so it never blows out), the outline + feature edges draw the lines
        else { var key = (mood === 'cel') ? 'celMat' : 'cartMat'; if (!o.userData[key]) { var fc = src.color ? src.color.clone() : new T.Color(0xffffff); var _hsl = {}; fc.getHSL(_hsl); if (mood === 'cartoon') { fc.offsetHSL(0, 0.32, -0.14); if (_hsl.s < 0.12) fc.offsetHSL(0, 0, -0.12); } else { fc.offsetHSL(0, 0.16, -0.06); if (_hsl.s < 0.12) fc.offsetHSL(0, 0, -0.08); }   /* both punch flat colours (cel softer); near-grey woods darkened so they read as wood, not white */ o.userData[key] = new T.MeshToonMaterial({ color: fc, gradientMap: grad }); } o.material = o.userData[key]; }   // BOTH cartoon + cel drop the texture map → FLAT colour (cartoon = 2 hard bands, cel = 4 smooth bands)
      });
      if (R3.toonOutline) { R3.toonOutline.visible = true; R3.group.updateWorldMatrix(false, true); var k = R3.toonOutline.children; for (var i = 0; i < k.length; i++) { var s = k[i].userData.src; if (s && s.visible) { k[i].visible = true; k[i].matrix.copy(s.matrixWorld); } else k[i].visible = false; } }
      if (R3.lineEdgeGroup) { var lev = isLine; R3.lineEdgeGroup.visible = lev; if (lev) { var le = R3.lineEdgeGroup.children; for (var j = 0; j < le.length; j++) { var ls = le[j].userData.src; if (ls && ls.visible) { le[j].visible = true; le[j].matrix.copy(ls.matrixWorld); } else le[j].visible = false; } } }   // internal feature lines show for Line Art only
      R3.toonActive = true;
    } else if (R3.toonActive) {
      R3.group.traverse(function (o) { if (o.userData.origMat) o.material = o.userData.origMat; });   // restore the real PBR materials
      if (R3.toonOutline) R3.toonOutline.visible = false;
      if (R3.lineEdgeGroup) R3.lineEdgeGroup.visible = false;
      R3.toonActive = false;
    }
  }
  // DUST: a real volumetric-feeling cloud of drifting, light-catching motes (for the Dusty look — atmosphere, not just a desaturated grade). A soft round sprite so they read as airborne dust, not square dots.
  function dustSprite() { if (R3._dustTex) return R3._dustTex; var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d'); var g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,248,230,1)'); g.addColorStop(0.4, 'rgba(255,240,210,0.5)'); g.addColorStop(1, 'rgba(255,235,200,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return (R3._dustTex = new T.CanvasTexture(c)); }
  function ensureDust() {
    if (R3.moodDust || !R3.scene) return;
    var N = 520, pos = new Float32Array(N * 3); R3.dustSpd = new Float32Array(N); R3.dustPh = new Float32Array(N);
    for (var i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 2800; pos[i * 3 + 1] = Math.random() * 1200; pos[i * 3 + 2] = (Math.random() - 0.5) * 2800; R3.dustSpd[i] = 0.4 + Math.random() * 1.1; R3.dustPh[i] = Math.random() * 6.28; }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    var mat = new T.PointsMaterial({ map: dustSprite(), color: 0xdcc49a, size: 16, transparent: true, opacity: 0.0, sizeAttenuation: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
    if ('toneMapped' in mat) mat.toneMapped = false;
    R3.moodDust = new T.Points(g, mat); R3.moodDust.frustumCulled = false; R3.moodDust.renderOrder = 5; R3.scene.add(R3.moodDust);
  }
  function tex(key, w, h, paint, rep) { if (R3['_' + key]) return R3['_' + key]; var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d')); var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); if (T.sRGBEncoding) t.encoding = T.sRGBEncoding; R3['_' + key] = t; return t; }
  function photoTex(file, srgb, rp) {   // real photographic PBR maps (CC0, Poly Haven) — diffuse in sRGB, normal maps LINEAR or lighting breaks
    var key = '_pt_' + file; if (R3[key]) return R3[key];
    var t = new T.TextureLoader().load('assets/tex/' + file.split('#')[0] + '?t=2');   // ?t bust: the ground-*.jpg tiles were regenerated (old ones were corrupted); force browsers past the cached copy
    t.wrapS = t.wrapT = T.RepeatWrapping; if (rp) t.repeat.set(rp[0], rp[1]);
    if (srgb && T.sRGBEncoding) t.encoding = T.sRGBEncoding;
    if (R3.r && R3.r.capabilities) t.anisotropy = Math.min(8, R3.r.capabilities.getMaxAnisotropy());
    return (R3[key] = t);
  }
  function dualTex(key, w, paint2, rep) {   // builds a COLOR map + matching grayscale BUMP map in one pass (photoreal ground needs both)
    if (R3['_' + key]) return R3['_' + key];
    var ca = document.createElement('canvas'), cb = document.createElement('canvas'); ca.width = ca.height = cb.width = cb.height = w;
    paint2(ca.getContext('2d'), cb.getContext('2d'), w);
    var mk = function (c, srgb) { var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); if (srgb && T.sRGBEncoding) t.encoding = T.sRGBEncoding; if (R3.r && R3.r.capabilities) t.anisotropy = Math.min(8, R3.r.capabilities.getMaxAnisotropy()); return t; };
    return (R3['_' + key] = { map: mk(ca, true), bump: mk(cb, false) });
  }
  function fbmFill(x, bx, w, opts) {   // seamless multi-octave value noise written per-pixel into BOTH canvases
    var P = opts.cells, seed = opts.seed;
    function h2(ix, iy, sd) { var n = Math.sin(((ix % P) + P) % P * 127.1 + ((iy % P) + P) % P * 311.7 + sd * 74.7) * 43758.5453; return n - Math.floor(n); }
    function vn(px, py, sc, sd) { var xx = px / w * sc, yy = py / w * sc, ix = Math.floor(xx), iy = Math.floor(yy), fx = xx - ix, fy = yy - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); var a = h2(ix, iy, sd), b = h2(ix + 1, iy, sd), c2 = h2(ix, iy + 1, sd), d = h2(ix + 1, iy + 1, sd); return a + (b - a) * fx + (c2 - a) * fy + (a - b - c2 + d) * fx * fy; }
    var idA = x.createImageData(w, w), idB = bx.createImageData(w, w), dA = idA.data, dB = idB.data;
    var c0 = opts.c0, c1 = opts.c1;
    for (var py = 0; py < w; py++) for (var px = 0; px < w; px++) {
      var n = 0, amp = 0.55, sc = P;   // 4 octaves, all period-locked => the tile is SEAMLESS
      for (var o = 0; o < 4; o++) { n += vn(px, py, sc, seed + o * 13) * amp; sc *= 2; amp *= 0.5; }
      n = n / 1.03; var i4 = (py * w + px) * 4;
      dA[i4] = c0[0] + (c1[0] - c0[0]) * n; dA[i4 + 1] = c0[1] + (c1[1] - c0[1]) * n; dA[i4 + 2] = c0[2] + (c1[2] - c0[2]) * n; dA[i4 + 3] = 255;
      var bv = 40 + n * 175; dB[i4] = dB[i4 + 1] = dB[i4 + 2] = bv; dB[i4 + 3] = 255;
    }
    x.putImageData(idA, 0, 0); bx.putImageData(idB, 0, 0);
  }
  function turfTex2() {   // sun-scorched fairway: noise base + tens of thousands of individual grass blades + dry patches, with a real bump map
    return dualTex('turf2', 1024, function (x, bx, w) {
      function rnd(n) { var v = Math.sin(n * 91.7 + 5.1) * 43758.5453; return v - Math.floor(v); }
      fbmFill(x, bx, w, { cells: 8, seed: 3.1, c0: [148, 152, 110], c1: [205, 208, 168] });
      for (var d = 0; d < 14; d++) { var dx2 = rnd(d * 7) * w, dy = rnd(d * 11 + 1) * w, dr = 60 + rnd(d * 3) * 180; var g = x.createRadialGradient(dx2, dy, 4, dx2, dy, dr); g.addColorStop(0, 'rgba(186,164,98,' + (0.10 + rnd(d) * 0.16).toFixed(2) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }   // sun-scorched dry patches
      for (var k = 0; k < 42000; k++) {   // individual grass blades — short directional strokes, light & dark
        var gx = rnd(k * 1.7) * w, gy = rnd(k * 2.3 + 1) * w, ln = 2.5 + rnd(k + 5) * 5, an = -PI / 2 + (rnd(k + 9) - .5) * 0.9, lt = rnd(k + 3);
        var ex = gx + Math.cos(an) * ln, ey = gy + Math.sin(an) * ln;
        x.strokeStyle = lt > 0.5 ? 'rgba(228,232,180,' + (0.10 + lt * 0.16).toFixed(2) + ')' : 'rgba(72,86,42,' + (0.10 + lt * 0.2).toFixed(2) + ')';
        x.lineWidth = 1.1; x.beginPath(); x.moveTo(gx, gy); x.lineTo(ex, ey); x.stroke();
        bx.strokeStyle = lt > 0.5 ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.30)'; bx.lineWidth = 1.1; bx.beginPath(); bx.moveTo(gx, gy); bx.lineTo(ex, ey); bx.stroke();
      }
      x.fillStyle = 'rgba(255,255,255,0.035)'; for (var st = 0; st < w; st += 256) x.fillRect(st, 0, 128, w);   // ghost of a mow stripe — barely there
    }, [10, 30]);
  }
  function sandTex2() {   // wind-rippled desert floor with real relief
    return dualTex('sand2', 1024, function (x, bx, w) {
      function rnd(n) { var v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
      fbmFill(x, bx, w, { cells: 6, seed: 9.7, c0: [196, 172, 128], c1: [240, 224, 186] });
      for (var d = 0; d < 22; d++) {   // wind ripples (sine-locked => seamless), carved into both color and relief
        var baseY = d * (w / 22) + 6, ph = rnd(d) * TAU;
        x.strokeStyle = 'rgba(140,112,72,0.13)'; x.lineWidth = w / 90; x.beginPath();
        for (var px2 = 0; px2 <= w; px2 += 8) { var py2 = baseY + Math.sin(px2 / w * TAU * 4 + ph) * (w / 80); px2 === 0 ? x.moveTo(px2, py2) : x.lineTo(px2, py2); } x.stroke();
        x.strokeStyle = 'rgba(255,250,232,0.12)'; x.lineWidth = w / 240; x.beginPath();
        for (px2 = 0; px2 <= w; px2 += 8) { py2 = baseY + w / 110 + Math.sin(px2 / w * TAU * 4 + ph) * (w / 80); px2 === 0 ? x.moveTo(px2, py2) : x.lineTo(px2, py2); } x.stroke();
        bx.strokeStyle = 'rgba(0,0,0,.35)'; bx.lineWidth = w / 90; bx.beginPath();
        for (px2 = 0; px2 <= w; px2 += 8) { py2 = baseY + Math.sin(px2 / w * TAU * 4 + ph) * (w / 80); px2 === 0 ? bx.moveTo(px2, py2) : bx.lineTo(px2, py2); } bx.stroke();
        bx.strokeStyle = 'rgba(255,255,255,.4)'; bx.lineWidth = w / 240; bx.beginPath();
        for (px2 = 0; px2 <= w; px2 += 8) { py2 = baseY + w / 110 + Math.sin(px2 / w * TAU * 4 + ph) * (w / 80); px2 === 0 ? bx.moveTo(px2, py2) : bx.lineTo(px2, py2); } bx.stroke();
      }
      for (var p = 0; p < 240; p++) { var rx = rnd(p * 3.7) * w, ry = rnd(p * 5.3 + 1) * w, rr = 2 + rnd(p * 2.1) * 7; x.fillStyle = 'rgba(112,88,56,' + (0.12 + rnd(p) * 0.16).toFixed(2) + ')'; x.beginPath(); x.arc(rx, ry, rr, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,248,230,0.14)'; x.beginPath(); x.arc(rx - rr * 0.3, ry - rr * 0.3, rr * 0.5, 0, TAU); x.fill(); bx.fillStyle = 'rgba(255,255,255,.5)'; bx.beginPath(); bx.arc(rx, ry, rr, 0, TAU); bx.fill(); }
    });
  }
  function turfTex() { return turfTex2().map; }
  function ballTex() { return tex('ball', 128, 128, function (x) { x.fillStyle = '#f7f3ea'; x.fillRect(0, 0, 128, 128); x.fillStyle = 'rgba(150,150,160,.35)'; for (var i = 12; i < 128; i += 22) for (var j = (i / 22 % 2 ? 22 : 10); j < 128; j += 22) { x.beginPath(); x.arc(j, i, 4.2, 0, 7); x.fill(); } x.fillStyle = '#c0202a'; x.beginPath(); x.arc(84, 60, 12, 0, 7); x.fill(); }); }
  function ballBump() { return tex('ballB', 128, 128, function (x) { x.fillStyle = '#888'; x.fillRect(0, 0, 128, 128); for (var i = 12; i < 128; i += 22) for (var j = (i / 22 % 2 ? 22 : 10); j < 128; j += 22) { var g = x.createRadialGradient(j, i, 0.5, j, i, 4.6); g.addColorStop(0, '#3a3a3a'); g.addColorStop(.75, '#6a6a6a'); g.addColorStop(1, '#888'); x.fillStyle = g; x.beginPath(); x.arc(j, i, 4.6, 0, 7); x.fill(); } }); }

  /* ---------------- AAA film look: IBL env, gradient skies, wood grain, post FX ---------------- */
  function envFromEquirect(t) { try { var pm = new T.PMREMGenerator(R3.r); pm.compileEquirectangularShader(); var e = pm.fromEquirectangular(t).texture; pm.dispose(); return e; } catch (e2) { return null; } }
  function initEnv() {   // REAL photographic desert HDRI -> PMREM image-based lighting: grounds every metal/glass/matte surface in a true light field (the believable-render lever). Procedural gradient is the instant fallback until the photo loads; the painted brand sky stays the VISIBLE backdrop (scene.background is never set).
    try {
      var c = document.createElement('canvas'); c.width = 256; c.height = 128; var x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, '#7fa8d0'); g.addColorStop(0.42, '#d9b88a'); g.addColorStop(0.55, '#f2cf9a'); g.addColorStop(0.62, '#8a6a42'); g.addColorStop(1, '#3a2a18');
      x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      var sg = x.createRadialGradient(70, 44, 2, 70, 44, 36); sg.addColorStop(0, 'rgba(255,246,218,1)'); sg.addColorStop(0.3, 'rgba(255,226,162,.8)'); sg.addColorStop(1, 'rgba(255,214,140,0)');
      x.fillStyle = sg; x.fillRect(0, 0, 256, 128);
      var t = new T.CanvasTexture(c); t.mapping = T.EquirectangularReflectionMapping; if (T.sRGBEncoding) t.encoding = T.sRGBEncoding;
      R3.env = envFromEquirect(t); t.dispose();
      new T.TextureLoader().load('assets/env-desert.jpg', function (ph) {   // swap to the real HDRI once decoded
        ph.mapping = T.EquirectangularReflectionMapping; if (T.sRGBEncoding) ph.encoding = T.sRGBEncoding;
        var real = envFromEquirect(ph); ph.dispose();
        if (real) { R3.env = real; if (R3.scene && St.hole && St.hole.theme !== 'moon') R3.scene.environment = real; }
      });
    } catch (e) { R3.env = null; }
  }
  var SKYGRAD = { grass: ['#7cc0cc', '#b7d8d2', '#eec79e'], ice: ['#e4d4ac', '#e9dcb4', '#dfcba4'], moon: ['#e6deb6', '#d8cdb2', '#bdaec6'], mud: ['#ee9e4a', '#f2b65a', '#f6c97c'], rubber: ['#d9cfa9', '#e0d7b1', '#e8dfbb'], speed: ['#70c2ac', '#8cccb6', '#eaa97c'], sand: ['#cfba82', '#dcc794', '#e8d4a2'] };   // gradient tops continue each painting's sky above the panorama
  function skyTex(theme, fallback) {   // vertical gradient sky (zenith -> warm horizon) instead of a flat color
    var cols = SKYGRAD[theme]; if (!cols) { var hx = '#' + new T.Color(fallback).getHexString(); cols = [hx, hx, hx]; }
    return tex('sky_' + theme, 4, 256, function (x) { var g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, cols[0]); g.addColorStop(0.62, cols[1]); g.addColorStop(1, cols[2]); x.fillStyle = g; x.fillRect(0, 0, 4, 256); });
  }
  function woodTex() {   // weathered saloon planks: seams, bezier grain streaks, the odd knot (neutral-light so wall color tints it)
    return tex('wood', 256, 256, function (x) {
      x.fillStyle = '#cdb392'; x.fillRect(0, 0, 256, 256);
      function rnd(n) { var v = Math.sin(n * 91.7 + 5.1) * 43758.5453; return v - Math.floor(v); }
      for (var p = 0; p < 4; p++) {
        var y0 = p * 64;
        x.fillStyle = 'rgba(' + (130 + Math.round(rnd(p) * 50)) + ',' + (96 + Math.round(rnd(p + 9) * 40)) + ',' + (58 + Math.round(rnd(p + 17) * 26)) + ',0.32)';
        x.fillRect(0, y0, 256, 64);
        x.fillStyle = 'rgba(40,22,8,.55)'; x.fillRect(0, y0, 256, 2);
        for (var gn = 0; gn < 26; gn++) {
          var gy = y0 + 4 + rnd(p * 31 + gn) * 56, ln = 30 + rnd(p * 17 + gn) * 170, gx = rnd(p * 13 + gn * 7) * 256;
          x.strokeStyle = 'rgba(82,52,24,' + (0.08 + rnd(gn) * 0.15).toFixed(2) + ')'; x.lineWidth = 1 + rnd(gn * 3) * 1.4;
          x.beginPath(); x.moveTo(gx - ln / 2, gy); x.bezierCurveTo(gx - ln / 6, gy + rnd(gn + 40) * 5 - 2.5, gx + ln / 6, gy - rnd(gn + 80) * 5 + 2.5, gx + ln / 2, gy); x.stroke();
        }
        if (rnd(p * 5) > 0.35 && x.ellipse) { var kx = rnd(p * 23) * 230 + 12, ky = y0 + 14 + rnd(p * 29) * 38;
          x.strokeStyle = 'rgba(60,34,12,.5)'; x.lineWidth = 2; x.beginPath(); x.ellipse(kx, ky, 7, 4.5, 0.3, 0, TAU); x.stroke();
          x.fillStyle = 'rgba(60,34,12,.45)'; x.beginPath(); x.ellipse(kx, ky, 3.4, 2.2, 0.3, 0, TAU); x.fill(); }
      }
    }, [3, 1]);
  }
  function skirtTex() {   // seamless desert SAND ground — light & warm so GROUNDC tints it to beige; dune ripples + grain + pebbles so the floor reads as real desert, not flat color
    return tex('skirt', 256, 256, function (x) {
      function rnd(n) { var v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
      x.fillStyle = '#e6d8bc'; x.fillRect(0, 0, 256, 256);                                   // light warm sand base
      for (var d = 0; d < 6; d++) {                                                          // wind-blown dune ripples (sine = seamless across x)
        var baseY = d * 42 + 8; x.strokeStyle = 'rgba(150,122,80,0.09)'; x.lineWidth = 11; x.beginPath();
        for (var px = 0; px <= 256; px += 4) { var py = baseY + Math.sin(px / 256 * TAU * 3) * 6; if (px === 0) x.moveTo(px, py); else x.lineTo(px, py); }
        x.stroke();
        x.strokeStyle = 'rgba(255,250,232,0.08)'; x.lineWidth = 3; x.beginPath();
        for (px = 0; px <= 256; px += 4) { py = baseY + 5 + Math.sin(px / 256 * TAU * 3) * 6; if (px === 0) x.moveTo(px, py); else x.lineTo(px, py); }
        x.stroke();
      }
      for (var i = 0; i < 2600; i++) { var gx = rnd(i) * 256, gy = rnd(i + 7) * 256, br = rnd(i + 13); x.fillStyle = br > 0.5 ? 'rgba(255,250,235,' + (0.05 + rnd(i + 3) * 0.10).toFixed(2) + ')' : 'rgba(120,96,60,' + (0.04 + rnd(i + 5) * 0.10).toFixed(2) + ')'; x.fillRect(gx, gy, 1.6, 1.6); }   // fine grain speckle
      for (var p = 0; p < 64; p++) { var rx = rnd(p * 3.7) * 256, ry = rnd(p * 5.3 + 1) * 256, rr = 1.4 + rnd(p * 2.1) * 3; x.fillStyle = 'rgba(112,88,56,' + (0.10 + rnd(p) * 0.13).toFixed(2) + ')'; x.beginPath(); x.arc(rx, ry, rr, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,248,230,0.10)'; x.beginPath(); x.arc(rx - rr * 0.3, ry - rr * 0.3, rr * 0.5, 0, TAU); x.fill(); }   // scattered pebbles
    });
  }
  function moteTex() { return tex('mote', 32, 32, function (x) { var g = x.createRadialGradient(16, 16, 1, 16, 16, 15); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); }); }
  function flagTex() {   // the pin pennant: brand red cloth wearing the cowboy-face icon logo (assets/logo-flag.png) — no strokes, no boxes
    var t = tex('flag', 256, 128, function (x) {
      x.fillStyle = '#c8332a'; x.fillRect(0, 0, 256, 128);
      x.fillStyle = 'rgba(120,16,10,.35)'; x.fillRect(0, 88, 256, 40);
    });
    if (!R3._flagLogoKicked) {
      R3._flagLogoKicked = true;
      var im = new Image();
      im.onload = function () {
        var c = t.image, x = c.getContext('2d');
        x.fillStyle = '#c8332a'; x.fillRect(0, 0, 256, 128);
        x.fillStyle = 'rgba(120,16,10,.35)'; x.fillRect(0, 88, 256, 40);
        var lh = 122, lw = lh * im.width / im.height; if (lw > 240) { lw = 240; lh = lw * im.height / im.width; }
        x.drawImage(im, (256 - lw) / 2, (128 - lh) / 2, lw, lh);
        t.needsUpdate = true;
      };
      im.src = 'assets/logo-flag.png';
    }
    return t;
  }
  function swirlTex(col) {   // glowing vortex spiral for portals (additive, rotated each frame)
    var key = 'swirl_' + col; if (R3['_' + key]) return R3['_' + key];
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var cc = new T.Color(col), rC = Math.round(cc.r * 255), gC = Math.round(cc.g * 255), bC = Math.round(cc.b * 255);
    for (var arm = 0; arm < 3; arm++) {
      for (var t = 0; t < 1; t += 0.02) {
        var ang = arm * TAU / 3 + t * TAU * 1.55, rad = 10 + t * 112;
        var px = 128 + Math.cos(ang) * rad, py = 128 + Math.sin(ang) * rad;
        var w = (1 - t), mixW = 1 - t * 0.75;
        x.fillStyle = 'rgba(' + Math.round(rC * mixW + 255 * (1 - mixW)) + ',' + Math.round(gC * mixW + 255 * (1 - mixW)) + ',' + Math.round(bC * mixW + 255 * (1 - mixW)) + ',' + (0.75 * w).toFixed(2) + ')';
        x.beginPath(); x.arc(px, py, 3 + 8 * w, 0, TAU); x.fill();
      }
    }
    var g2 = x.createRadialGradient(128, 128, 2, 128, 128, 46); g2.addColorStop(0, 'rgba(255,255,255,.95)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g2; x.fillRect(0, 0, 256, 256);
    var t2 = new T.CanvasTexture(c); if (T.sRGBEncoding) t2.encoding = T.sRGBEncoding; R3['_' + key] = t2; return t2;
  }
  // THE GUNSLINGERS AESTHETIC — the brand's painted backgrounds wrap the scene; brand prop cutouts dress the diorama
  var BGMAP = { grass: 'sky-grass.jpg', sand: 'sky-sand.jpg', mud: 'sky-mud.jpg', speed: 'sky-speed.jpg', rubber: 'sky-rubber.jpg', moon: 'sky-moon.jpg', ice: 'sky-ice.jpg' };
  var GTEX = { grass: 'tex/ground-grass.jpg', sand: 'tex/ground-sand.jpg', mud: 'tex/ground-mud.jpg', speed: 'tex/ground-speed.jpg', rubber: 'tex/ground-rubber.jpg', moon: 'tex/ground-moon.jpg', ice: 'tex/ground-ice.jpg' };   // the FLOOR is each theme's OWN painting foreground (soft painterly band lifted from sky-<theme>.jpg) so the ground IS the gunslinger art and meets the painted horizon seamlessly
  // BACKDROP VARIETY — most holes share the 'grass' gameplay theme (physics/turf), so without this they'd all wear sky-grass now that the painting IS the whole world. The BACKGROUND scene is chosen independently of theme and ROTATED per hole through EVERY usable brand painting (13 of them) so each hole in a nine gets a unique sky and no two in a row repeat. The local ground patch + fog haze are lifted from the SAME painting so floor + backdrop match. oy shifts each painting so its own horizon sits at eye level; rep=2 for the close building scenes (less obvious tiling), 3 for wide landscapes. Themed moon/ice holes keep their thematic painting so the night/ice world stays consistent.
  // g = the PAINTERLY ground tile (a crop of THIS painting's own foreground), so the floor is the actual gunslinger art, not a flat color. gt = a color multiplier (solved empirically) on that textured tile so the lit+tonemapped floor still RENDERS to the painting's ground-half average — painted look AND matched color. fog = horizon haze.
  // gt = the surface texture's tint (linear). The ground keeps its REAL surface texture (grass blades / ice / regolith craters, desaturated to gray detail) and gt colors it to THIS painting's ground-average — so it reads as grass/ice/crater IN the backdrop's color. Solved so (grayTexMean≈0.585 × gt) renders to the painting ground-half average.
  var POOL = [
    { bg: 'sky-grass.jpg', fog: 0xd8895c, gt: [0.641, 0.443, 0.406], oy: 0, rep: 3 },        // pink sunset mesas
    { bg: 'sky-sand.jpg', fog: 0xe0b878, gt: [0.715, 0.533, 0.365], oy: 0.22, rep: 3 },      // golden buttes + crescent moon
    { bg: 'bg-9.png', fog: 0x71af84, gt: [0.447, 0.551, 0.428], oy: -0.02, rep: 3 },         // green alien sky, UFOs over mesas
    { bg: 'sky-extra.jpg', fog: 0xdca878, gt: [0.663, 0.514, 0.481], oy: 0.10, rep: 3 },     // fiery orange sunset
    { bg: 'bg-desert.png', fog: 0xada39b, gt: [0.779, 0.645, 0.536], oy: 0.02, rep: 3 },     // pastel blue sky, pink clouds
    { bg: 'sky-mud.jpg', fog: 0xc9a6b0, gt: [0.533, 0.414, 0.447], oy: 0.05, rep: 3 },       // frontier town at dusk
    { bg: 'sky-rubber.jpg', fog: 0xd9b58a, gt: [0.626, 0.54, 0.421], oy: 0.12, rep: 3 },     // cream sky, crimson rocks
    { bg: 'bg-5.png', fog: 0x5a5860, gt: [0.594, 0.588, 0.647], oy: 0.34, rep: 3 },          // moonlit gray night desert
    { bg: 'sky-speed.jpg', fog: 0xc08c84, gt: [0.682, 0.536, 0.503], oy: 0.05, rep: 3 },     // teal-orange dusk
    { bg: 'bg-canyon.png', fog: 0xa49795, gt: [0.592, 0.548, 0.514], oy: 0, rep: 2 },        // pink canyon walls
    { bg: 'bg-town.png', fog: 0x877c84, gt: [0.451, 0.443, 0.469], oy: -0.05, rep: 2 },      // saloon street
    { bg: 'bg-18.png', fog: 0x83624b, gt: [0.708, 0.544, 0.417], oy: -0.05, rep: 2 },        // train depot
    { bg: 'bg-12.png', fog: 0x9e3a36, gt: [0.566, 0.212, 0.209], oy: -0.18, rep: 2 }         // burning town
  ];
  function nameHash(s) { s = s || ''; var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function sceneFor(hole) {   // moon/ice keep their thematic painting; every other hole rotates the full pool by hole index → unique sky per hole in a nine, never two in a row
    var th = hole.theme;
    if (th === 'moon') return { bg: 'sky-moon.jpg', fog: FOGC.moon, gt: [0.62, 0.5, 1.05], oy: 0, rep: 3 };   // regolith crater texture in the graveyard's saturated LAVENDER/periwinkle ground (live-tuned)
    if (th === 'ice') return { bg: 'sky-ice.jpg', fog: FOGC.ice, gt: [0.57, 0.458, 0.41], oy: 0, rep: 3 };   // ice texture in the ice-painting ground tone
    var idx = (typeof St !== 'undefined' && St.hi >= 0) ? St.hi : nameHash(hole.name);
    return POOL[idx % POOL.length];
  }
  function groundAlpha() {   // radial feather: the ground disc is solid under the play area, then dissolves to transparent at its rim so it melts into the painted horizon + fog — no hard circular edge cutting across the art
    if (R3._grndA) return R3._grndA;
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');   // broad feather over the outer ~45%: at the grazing game camera this melts the painted floor into the horizon-haze backing disc over a wide visible band, not a hard rim
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; R3._grndA = t; return t;
  }
  var GROUNDC = { grass: 0xe3d2a8, sand: 0xe6c486, mud: 0xddaab0, speed: 0xc89894, rubber: 0xd6c290, moon: 0xa89cc2, ice: 0xd0b890 };   // warm desert-beige sand tints (grass = pure beige to match the sunset backdrop floor)
  var FOGC = { grass: 0xd8895c, sand: 0xe0b878, mud: 0xdfa3ac, speed: 0xc08c84, rubber: 0xd4c08c, moon: 0xa898c4, ice: 0xceb084 };   // distance haze tuned to each painting's horizon so the skirt melts into the art
  function panoAlpha() {   // vertical fade: painting melts into the ground skirt like distance haze (also hides the cylinder facet line)
    if (R3._panoA) return R3._panoA;
    var c = document.createElement('canvas'); c.width = 1; c.height = 256; var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 256, 0, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.30, 'rgba(255,255,255,0)'); g.addColorStop(0.50, 'rgba(255,255,255,1)'); g.addColorStop(0.82, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');   // feather BOTH ends: bottom (0→0.30) dissolves into the ground, top (0.82→1) dissolves into the sky dome so the cylinder's top rim never reads as a hard horizontal edge when the camera tilts up
    x.fillStyle = g; x.fillRect(0, 0, 1, 256);
    var t = new T.CanvasTexture(c); t.wrapT = T.ClampToEdgeWrapping; R3._panoA = t; return t;
  }
  function panoMat(name) {
    var key = 'pano_' + name; if (R3['_' + key]) return R3['_' + key];
    var photo = name.indexOf('pano-') === 0;
    var m = new T.MeshBasicMaterial(photo ? { side: T.BackSide, fog: false, color: 0xbfa98a } : { side: T.BackSide, fog: false, color: 0xbfa98a, transparent: true, alphaMap: panoAlpha() });   // photo pano keeps its own ground as the distant valley floor — no haze dissolve
    if ('toneMapped' in m) m.toneMapped = false;
    var t = new T.TextureLoader().load('assets/' + name, function () { m.color.set(0xffffff); m.needsUpdate = true; });
    if (T.sRGBEncoding) t.encoding = T.sRGBEncoding;
    if (photo) { t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.repeat.set(1, 0.5); t.offset.y = 0.18; }   // photographic 360° pano: wraps seamlessly once; vertical zoom puts the mountain line at eye level
    else { t.wrapS = T.MirroredRepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.repeat.set(4, 1.12); t.offset.y = 0.22; }
    m.map = t;   // mirrored wrap = no visible seam (the paintings aren't tileable); land band at eye level, painted sky above, clamped sky-top blends into the gradient
    R3['_' + key] = m; return m;
  }
  function domeMat(name, rep, oy) {   // the WHOLE world is one brand painting wrapped on a big sphere: the painting's desert plain (bottom of the image) becomes the far FLOOR all around, its mesas the skyline, its sky the sky — one continuous hand-drawn scene, NO geometry seam between ground and sky. Player stands inside it.
    rep = rep || 3; oy = oy || 0;
    var key = 'dome_' + name + '_' + rep + '_' + oy; if (R3['_' + key]) return R3['_' + key];
    var m = new T.MeshBasicMaterial({ side: T.BackSide, fog: false, color: 0xbfa98a }); if ('toneMapped' in m) m.toneMapped = false;
    var t = new T.TextureLoader().load('assets/' + name, function () { m.color.set(0xffffff); m.needsUpdate = true; });
    if (T.sRGBEncoding) t.encoding = T.sRGBEncoding;
    t.wrapS = T.MirroredRepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.repeat.set(rep, 1); t.offset.set(0, oy);   // x: mirror-tile rep× around the horizon (no seam); y: image bottom (desert plain)→nadir, top (sky)→zenith; oy shifts so THIS painting's horizon lands at the equator (eye level)
    m.map = t; R3['_' + key] = m; return m;
  }
  function islandSky() {   // soft sea-and-sky gradient (cream zenith → blue → teal horizon) for the floating-island holes — no painted backdrop
    if (R3._islSky) return R3._islSky;
    var c = document.createElement('canvas'); c.width = 4; c.height = 256; var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#e7d8a6'); g.addColorStop(0.16, '#b6d2cc'); g.addColorStop(0.40, '#6aacb7'); g.addColorStop(0.62, '#3a929c'); g.addColorStop(1, '#176870');
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    var t = new T.CanvasTexture(c); if (T.sRGBEncoding) t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; R3._islSky = t; return t;
  }
  function inPoly(poly, x, z) {   // ray-cast point-in-polygon
    var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if (((a.z > z) !== (b.z > z)) && (x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x)) c = !c; } return c;
  }
  function inPolyWind(poly, x, z) {   // NONZERO winding rule — counts self-overlapping regions (curvy ribbons) as INSIDE, so the green fills solid. Same as inPoly for simple polygons.
    var wn = 0, n = poly.length; for (var i = 0; i < n; i++) { var a = poly[i], b = poly[(i + 1) % n], side = (b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z); if (a.z <= z) { if (b.z > z && side > 0) wn++; } else { if (b.z <= z && side < 0) wn--; } } return wn !== 0;
  }
  function edgeDist(poly, x, z) {   // shortest distance from (x,z) to the polygon boundary
    var best = 1e18; for (var i = 0; i < poly.length; i++) { var a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L)) : 0, px = a.x + t * dx, pz = a.z + t * dz, d = hyp(x - px, z - pz); if (d < best) best = d; } return best;
  }
  function buildShapedGreen(hole, bn, midZ, spanX, spanZ, polyArg, skB0) {   // CRAZY-SHAPED GREEN — renders a polygon as a grassy, terrain-FOLLOWING fairway. polyArg lets a hole render SEVERAL separate islands (one call each); skB0 sets how deep the cliff/skirt drops (floating-island look).
    if (!polyArg) { if (R3.turf) R3.turf.visible = false; if (R3._collar) R3._collar.visible = false; }   // single-green case hides the rectangular turf; ISLAND calls (polyArg set) must NOT touch R3.turf or they'd hide the PREVIOUS island's floor
    var poly = polyArg || hole.shape, i, cup = hole.cup, hasCup = inPoly(poly, cup.x, cup.z);   // only the island that CONTAINS the cup punches the cup hole
    var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; poly.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
    var gw = maxX - minX, gd = maxZ - minZ, cmx = (minX + maxX) / 2, cmz = (minZ + maxZ) / 2;
    // THE GREEN — a grid clipped to the organic outline; each vertex lifted by hole.terrain() so tiers/ramps/mounds read as real multi-level height; real grass texture; cup hole punched out
    var sxn = Math.max(12, Math.round(gw / 34)), szn = Math.max(12, Math.round(gd / 34));
    var geo = new T.PlaneGeometry(gw, gd, sxn, szn); geo.rotateX(-PI / 2); geo.translate(cmx, 0, cmz);
    var pos = geo.attributes.position;
    var floorY = (skB0 != null) ? (skB0 + 360 - 6) : -1e9;   // ISLAND: clamp green vertices to the island top so edge triangles don't plunge into the void (leaving the surface flat + solid)
    for (i = 0; i < pos.count; i++) pos.setY(i, Math.max(hole.terrain(pos.getX(i), pos.getZ(i)), floorY) + 0.5);
    var cell = Math.max(gw / sxn, gd / szn), openR = K.cupR + cell;
    var gidx = geo.index.array, keep = [];
    for (i = 0; i < gidx.length; i += 3) { var i0 = gidx[i], i1 = gidx[i + 1], i2 = gidx[i + 2], ccx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3, ccz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3; if (inPolyWind(poly, ccx, ccz) && (!hasCup || hyp(ccx - cup.x, ccz - cup.z) > openR)) keep.push(i0, i1, i2); }   // winding rule so curvy/self-overlapping islands fill solid
    geo.setIndex(keep); geo.computeVertexNormals();
    var grassN = photoTex('grass_n.jpg#isl', false, [Math.max(4, gw / 240), Math.max(4, gd / 240)]);
    var grassD = photoTex('grass_g.jpg#isl', true, [Math.max(4, gw / 240), Math.max(4, gd / 240)]);
    var _gc = new T.Color(0x4eaa3c); if (_gc.convertSRGBToLinear) _gc.convertSRGBToLinear();   // bright fairway green (gray grass texture × this tint reads as real grass)
    var green = new T.Mesh(geo, new T.MeshStandardMaterial({ map: grassD, normalMap: grassN, color: _gc, roughness: 1, metalness: 0, envMapIntensity: 0.1 })); green.receiveShadow = true; R3.group.add(green); if (!polyArg) R3.turf = green;   // don't reassign R3.turf for island calls (each island would otherwise hide the next)
    // CUP COLLAR — only the island holding the cup gets the worn rim
    if (hasCup) {
    var collarMat = green.material.clone();
    var cInner = K.cupR, cOuter = openR + cell + 30, cgeo = new T.RingGeometry(cInner, cOuter, 80, 3), cp = cgeo.attributes.position, cuv = cgeo.attributes.uv, ccol = new Float32Array(cp.count * 3);
    for (var ci = 0; ci < cp.count; ci++) {
      var lx = cp.getX(ci), ly = cp.getY(ci), wx2 = cup.x + lx, wz2 = cup.z - ly, rr = hyp(lx, ly), lip = clamp(1 - (rr - cInner) / 9, 0, 1), csh = 1 - 0.3 * lip;
      cuv.setXY(ci, ((wx2 - cmx) + gw / 2) / gw, ((cmz - wz2) + gd / 2) / gd);
      cp.setXYZ(ci, wx2, hole.terrain(wx2, wz2) + 0.7, wz2);
      ccol[ci * 3] = ccol[ci * 3 + 1] = ccol[ci * 3 + 2] = csh;
    }
    cgeo.computeVertexNormals(); cgeo.setAttribute('color', new T.BufferAttribute(ccol, 3)); collarMat.vertexColors = true;
    var collar = new T.Mesh(cgeo, collarMat); collar.receiveShadow = true; R3.group.add(collar);
    }
    // dirt SKIRT / CLIFF from the green edge down — deep (skB0) for floating islands, shallow for ground-level greens
    var skB = (skB0 != null ? skB0 : -40), verts = [], sidx = [];
    for (i = 0; i < poly.length; i++) { var a = poly[i], bp = poly[(i + 1) % poly.length], ay = hole.terrain(a.x, a.z), by = hole.terrain(bp.x, bp.z), base = verts.length / 3; verts.push(a.x, ay + 1, a.z, bp.x, by + 1, bp.z, bp.x, skB, bp.z, a.x, skB, a.z); sidx.push(base, base + 2, base + 1, base, base + 3, base + 2); }
    var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
    var skirt = new T.Mesh(sg, new T.MeshStandardMaterial({ color: 0x9a7548, roughness: 1, flatShading: true })); R3.group.add(skirt);
  }
  function metalMat(color, metalness, env, normScale) {   // realistic worn metal: scratched roughness + normal break up the reflection so it reads as REAL metal, not mirror plastic
    var m = new T.MeshStandardMaterial({ color: color, metalness: metalness == null ? 1 : metalness, roughness: 1, envMapIntensity: env == null ? 1.8 : env, roughnessMap: photoTex('metal_r.jpg#mtl', false, [2.4, 2.4]), normalMap: photoTex('metal_n.jpg#mtl', false, [2.4, 2.4]) });
    m.normalScale = new T.Vector2(normScale == null ? 0.32 : normScale, normScale == null ? 0.32 : normScale); return m;
  }
  function goldMat(env) { var m = metalMat(0xffce5c, 1, env == null ? 2.6 : env, 0.24); m.emissive = new T.Color(0x3a2600); m.emissiveIntensity = 0.18; return m; }   // rich warm gold: bright reflective metal with a faint warm glow so it reads as real gold, not flat yellow
  function spriteMat(name) {
    var key = 'sprm_' + name; if (R3['_' + key]) return R3['_' + key];
    var m = new T.MeshStandardMaterial({ transparent: true, alphaTest: .45, side: T.DoubleSide, roughness: .9, opacity: 0 });
    var t = new T.TextureLoader().load('assets/' + name + '.png', function () { m.opacity = 1; m.needsUpdate = true; });
    if (T.sRGBEncoding) t.encoding = T.sRGBEncoding;
    m.map = t; R3['_' + key] = m; return m;
  }
  // inverted-hull cartoon outline — gives 3D objects the same bold line work as the hand-drawn cutouts
  function outline(m, sc) { var o = new T.Mesh(m.geometry, R3._outm || (R3._outm = new T.MeshBasicMaterial({ color: 0x332012, side: T.BackSide }))); o.scale.setScalar(sc || 1.06); m.add(o); return o;
  }
  function initPost() {   // AAA pipeline: scene -> RT, bright-pass -> quarter-res separable gaussian BLOOM, then film composite (CA, grain, vignette, tilt-shift, halation, split-tone grade)
    try {
      var vsh = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
      var brightF = [
        'precision highp float; varying vec2 vUv; uniform sampler2D tD; uniform float uThresh;',
        'void main(){ vec3 c = texture2D(tD, vUv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));',
        '  float k = smoothstep(uThresh, uThresh + 0.22, l); gl_FragColor = vec4(c * k, 1.0); }'].join('\n');
      var blurF = [
        'precision highp float; varying vec2 vUv; uniform sampler2D tD; uniform vec2 uDir;',
        'void main(){ vec3 a = texture2D(tD, vUv).rgb * 0.227;',
        '  a += (texture2D(tD, vUv + uDir * 1.384).rgb + texture2D(tD, vUv - uDir * 1.384).rgb) * 0.316;',
        '  a += (texture2D(tD, vUv + uDir * 3.230).rgb + texture2D(tD, vUv - uDir * 3.230).rgb) * 0.070;',
        '  gl_FragColor = vec4(a, 1.0); }'].join('\n');
      var fsh = [
        'precision highp float; varying vec2 vUv;',
        'uniform sampler2D tD; uniform sampler2D tB; uniform float uT; uniform float uCA; uniform float uGrain; uniform float uVig; uniform float uDof; uniform float uFocus; uniform float uBloom; uniform vec2 uRes;',
        'uniform float uSat; uniform float uSep; uniform vec3 uShad; uniform vec3 uHigh; uniform float uLo; uniform float uHi; uniform float uCon; uniform float uBright; uniform float uLift;',
        'uniform float uGmAmt; uniform vec3 uGm0; uniform vec3 uGm1; uniform vec3 uGm2; uniform float uPost; uniform float uEdge; uniform float uStyle; uniform float uScan;',
        'float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 443.8975); q += dot(q, q.yzx + 19.19); return fract((q.x + q.y) * q.z); }',
        'void main(){',
        '  vec2 d = vUv - 0.5; float r2 = dot(d, d);',
        '  vec2 ca = d * (uCA * (0.5 + 2.4 * r2));',
        '  vec3 base = vec3(texture2D(tD, vUv + ca).r, texture2D(tD, vUv).g, texture2D(tD, vUv - ca).b);',
        '  float band = abs(vUv.y - uFocus);',
        '  float br = uDof * (smoothstep(0.10, 0.46, band) + 0.55 * smoothstep(0.14, 0.5, r2));',
        '  vec2 o1 = vec2(br, 0.0); vec2 o2 = vec2(0.0, br); vec2 o3 = vec2(br * 0.707, br * 0.707); vec2 o4 = vec2(br * 0.707, -br * 0.707);',
        '  vec3 ring = texture2D(tD, vUv + o1).rgb + texture2D(tD, vUv - o1).rgb + texture2D(tD, vUv + o2).rgb + texture2D(tD, vUv - o2).rgb;',
        '  ring += texture2D(tD, vUv + o3).rgb + texture2D(tD, vUv - o3).rgb + texture2D(tD, vUv + o4).rgb + texture2D(tD, vUv - o4).rgb;',
        '  ring *= 0.125;',
        '  vec3 col = mix(base, ring, clamp(br * 220.0, 0.0, 0.62));',
        '  col += max(ring - 0.78, 0.0) * 0.35;',
        '  col += texture2D(tB, vUv).rgb * uBloom;',                                       // BLOOM: lights actually glow
        '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
        '  col = mix(vec3(lum), col, uSat);',                                                                       // 1. saturation (0 = B&W for noir/sin city)
        '  vec3 sep = vec3(dot(col, vec3(0.393,0.769,0.189)), dot(col, vec3(0.349,0.686,0.168)), dot(col, vec3(0.272,0.534,0.131)));',
        '  col = mix(col, sep, uSep);',                                                                            // 2. sepia (dusty faded film)
        '  float gl = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);',
        '  col = mix(col * uShad, col * uHigh, smoothstep(uLo, uHi, gl));',                                        // 3. SPLIT-TONE: a distinct shadow colour and highlight colour = real cinematic depth (not a flat wash)
        '  col = clamp((col - 0.5) * uCon + 0.5, 0.0, 1.0);',                                                      // 4. contrast
        '  col = mix(col, col * col * (3.0 - 2.0 * col), 0.2);',                                                   // 5. gentle filmic S-curve (toe + shoulder) — richness, not a linear stretch
        '  col = clamp(col * uBright + vec3(0.055, 0.050, 0.044) * uLift, 0.0, 1.0);',                             // 6. brightness + (lifted) black point
        '  if (uGmAmt > 0.001) { float Lg = clamp(dot(col, vec3(0.299,0.587,0.114)), 0.0, 1.0); vec3 gm = Lg < 0.5 ? mix(uGm0, uGm1, Lg*2.0) : mix(uGm1, uGm2, (Lg-0.5)*2.0); col = mix(col, gm, uGmAmt); }',   // GRADIENT-MAP recolor — remaps the whole tonal range to a colour ramp (real LUT-style cinematic recolour)
        '  float edge = 0.0;',
        '  if (uEdge > 0.01) {',                                                                                  // edge styles only: blur the texture grain away, then run Sobel on the SMOOTH image (no grain speckle). No posterize — banding filters are banned.
        '    vec2 e2 = 4.5 / uRes;',
        '    vec3 t00=texture2D(tD,vUv+vec2(-e2.x,-e2.y)).rgb, t10=texture2D(tD,vUv+vec2(0.0,-e2.y)).rgb, t20=texture2D(tD,vUv+vec2(e2.x,-e2.y)).rgb;',
        '    vec3 t01=texture2D(tD,vUv+vec2(-e2.x,0.0)).rgb, t21=texture2D(tD,vUv+vec2(e2.x,0.0)).rgb;',
        '    vec3 t02=texture2D(tD,vUv+vec2(-e2.x,e2.y)).rgb, t12=texture2D(tD,vUv+vec2(0.0,e2.y)).rgb, t22=texture2D(tD,vUv+vec2(e2.x,e2.y)).rgb;',
        '    { vec3 LW=vec3(0.299,0.587,0.114); float l00=dot(t00,LW),l10=dot(t10,LW),l20=dot(t20,LW),l01=dot(t01,LW),l21=dot(t21,LW),l02=dot(t02,LW),l12=dot(t12,LW),l22=dot(t22,LW); float gx=(l20+2.0*l21+l22)-(l00+2.0*l01+l02); float gy=(l02+2.0*l12+l22)-(l00+2.0*l10+l20); edge=smoothstep(0.9, 1.8, sqrt(gx*gx+gy*gy)*uEdge); }',   // 3x3 Sobel on the SMOOTH grid → only strong STRUCTURAL edges survive, texture grain is below threshold
        '  }',
        '  if (uStyle == 1.0) { col = mix(col, vec3(0.03,0.03,0.04), edge); }',                                    // CARTOON / CEL: clean flat fills + ink outlines
        '  else if (uStyle == 2.0) { col = mix(col*0.07, uGm2 * 1.5, edge); }',                                    // TRON: dark world + neon edges only
        '  else if (uStyle == 3.0) { col = mix(vec3(0.97,0.96,0.93), vec3(0.05), edge); }',                        // LINE DRAWING: clean ink lines on paper
        '  else if (uStyle == 4.0) { col = mix(vec3(0.012,0.016,0.024), uGm2 * 1.6, edge); }',                     // WIREFRAME: bright edges on black
        '  if (uScan > 0.001) { col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.6)); }',                  // scanlines (vaporwave / retro)
        '  float n = hash(vUv * uRes * 0.5 + vec2(mod(uT, 64.0) * 17.31, mod(uT, 64.0) * 9.73));',
        '  col += (n - 0.5) * uGrain * (0.35 + 0.65 * (1.0 - lum));',                                             // 7. film grain on top of the grade
        '  col *= 1.0 - uVig * smoothstep(0.16, 0.6, r2);',                                                       // 8. vignette
        '  gl_FragColor = vec4(col, 1.0);',
        '}'].join('\n');
      // FXAA — edge smoothing on the final image: kills the jaggies on rounded silhouettes and the painted horizon line
      var fxaaF = [
        'precision highp float; varying vec2 vUv; uniform sampler2D tD; uniform vec2 uRes;',
        'void main(){',
        '  vec2 inv = 1.0 / uRes; vec3 L = vec3(0.299, 0.587, 0.114);',
        '  vec3 mC = texture2D(tD, vUv).rgb;',
        '  vec3 nw = texture2D(tD, vUv + vec2(-1.0,-1.0)*inv).rgb;',
        '  vec3 ne = texture2D(tD, vUv + vec2( 1.0,-1.0)*inv).rgb;',
        '  vec3 sw = texture2D(tD, vUv + vec2(-1.0, 1.0)*inv).rgb;',
        '  vec3 se = texture2D(tD, vUv + vec2( 1.0, 1.0)*inv).rgb;',
        '  float lNW=dot(nw,L), lNE=dot(ne,L), lSW=dot(sw,L), lSE=dot(se,L), lM=dot(mC,L);',
        '  float lMin = min(lM, min(min(lNW,lNE), min(lSW,lSE)));',
        '  float lMax = max(lM, max(max(lNW,lNE), max(lSW,lSE)));',
        '  vec2 dir = vec2(-((lNW+lNE)-(lSW+lSE)), ((lNW+lSW)-(lNE+lSE)));',
        '  float red = max((lNW+lNE+lSW+lSE)*0.25*0.0625, 0.0078125);',
        '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);',
        '  dir = clamp(dir*rcp, -8.0, 8.0) * inv;',
        '  vec3 rA = 0.5*(texture2D(tD, vUv + dir*(1.0/3.0-0.5)).rgb + texture2D(tD, vUv + dir*(2.0/3.0-0.5)).rgb);',
        '  vec3 rB = rA*0.5 + 0.25*(texture2D(tD, vUv + dir*-0.5).rgb + texture2D(tD, vUv + dir*0.5).rgb);',
        '  float lB = dot(rB, L);',
        '  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rA : rB, 1.0);',
        '}'].join('\n');
      var rt;
      if (R3.r.capabilities && R3.r.capabilities.isWebGL2 && T.WebGLMultisampleRenderTarget) { rt = new T.WebGLMultisampleRenderTarget(8, 8); rt.samples = (window.matchMedia && matchMedia('(pointer:coarse)').matches) ? 2 : 4; }
      else rt = new T.WebGLRenderTarget(8, 8);
      if (T.sRGBEncoding) rt.texture.encoding = T.sRGBEncoding;
      rt.texture.minFilter = T.LinearFilter; rt.texture.generateMipmaps = false;
      var mkRT = function () { var r = new T.WebGLRenderTarget(8, 8); r.texture.minFilter = T.LinearFilter; r.texture.generateMipmaps = false; return r; };
      var b1 = mkRT(), b2 = mkRT(), ldr = mkRT();   // ldr = the composited image, fed to the FXAA pass before it hits the screen
      var brightM = new T.ShaderMaterial({ vertexShader: vsh, fragmentShader: brightF, uniforms: { tD: { value: rt.texture }, uThresh: { value: 0.88 } }, depthTest: false, depthWrite: false });
      var blurM = new T.ShaderMaterial({ vertexShader: vsh, fragmentShader: blurF, uniforms: { tD: { value: b1.texture }, uDir: { value: new T.Vector2(0, 0) } }, depthTest: false, depthWrite: false });
      var mat = new T.ShaderMaterial({ vertexShader: vsh, fragmentShader: fsh, uniforms: { tD: { value: rt.texture }, tB: { value: b1.texture }, uT: { value: 0 }, uCA: { value: 0.0026 }, uGrain: { value: 0.13 }, uVig: { value: 0.4 }, uDof: { value: 0.004 }, uFocus: { value: 0.56 }, uBloom: { value: 0.82 }, uRes: { value: new T.Vector2(8, 8) }, uSat: { value: 1.14 }, uSep: { value: 0 }, uShad: { value: new T.Vector3(0.9, 0.97, 1.08) }, uHigh: { value: new T.Vector3(1.12, 1.01, 0.82) }, uLo: { value: 0.18 }, uHi: { value: 0.75 }, uCon: { value: 1.16 }, uBright: { value: 0.93 }, uLift: { value: 1 }, uGmAmt: { value: 0 }, uGm0: { value: new T.Vector3(0, 0, 0) }, uGm1: { value: new T.Vector3(0.5, 0.5, 0.5) }, uGm2: { value: new T.Vector3(1, 1, 1) }, uPost: { value: 0 }, uEdge: { value: 0 }, uStyle: { value: 0 }, uScan: { value: 0 } }, depthTest: false, depthWrite: false });
      var fxaaM = new T.ShaderMaterial({ vertexShader: vsh, fragmentShader: fxaaF, uniforms: { tD: { value: ldr.texture }, uRes: { value: new T.Vector2(8, 8) } }, depthTest: false, depthWrite: false });
      var qs = new T.Scene(), quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; qs.add(quad);
      R3.post = { on: true, ca: 0.0026, rt: rt, b1: b1, b2: b2, ldr: ldr, brightM: brightM, blurM: blurM, mat: mat, fxaaM: fxaaM, quad: quad, scene: qs, cam: new T.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    } catch (e) { R3.post = null; }
  }
  function renderGL() {
    var _rm = resolveMood(); if (_rm !== St.mood) applyMood(_rm);   // keep the active lighting mood in sync (hole default or player's setting)
    wireSync();   // enforce the real-wireframe override + black world every frame (survives hole rebuilds)
    toonSync();   // real toon shading (banded MeshToonMaterial) + inverted-hull ink outline for cartoon/cel/line
    if (R3.spot && R3.spotBase > 0.001 && St.hole && St.balls && St.balls[0]) { var _sb = St.balls[0], _sgy = St.hole.terrain(_sb.x, _sb.z); R3.spot.position.set(_sb.x + Math.sin(St.t * 0.9) * 90, _sgy + 1400, _sb.z - 120); R3.spot.target.position.set(_sb.x, _sgy, _sb.z); R3.spot.intensity = R3.spotBase * (0.82 + 0.18 * Math.sin(St.t * 3.5)); }   // SPOTLIGHT tracks the ball with a gentle sway + pulse = drama/action
    if (R3.moodDust && R3.moodDust.visible && St.hole) { var _db = St.hole.bounds, _dcx = (_db.minX + _db.maxX) / 2, _dcz = (_db.minZ + _db.maxZ) / 2; R3.moodDust.position.set(_dcx, St.hole.terrain(_dcx, _dcz) - 60, _dcz); var _dp = R3.moodDust.geometry.attributes.position, _da = _dp.array; for (var _di = 0; _di < R3.dustSpd.length; _di++) { _da[_di * 3 + 1] += R3.dustSpd[_di] * 0.5; _da[_di * 3] += Math.sin(St.t * 0.5 + R3.dustPh[_di]) * 0.45; _da[_di * 3 + 2] += Math.cos(St.t * 0.4 + R3.dustPh[_di]) * 0.3; if (_da[_di * 3 + 1] > 1200) _da[_di * 3 + 1] = 0; } _dp.needsUpdate = true; }   // dust slowly rises + drifts on the breeze, wrapping at the top
    if (R3.prismOn && R3.prism && St.hole) { var _bn = St.hole.bounds, _cx = (_bn.minX + _bn.maxX) / 2, _cz = (_bn.minZ + _bn.maxZ) / 2, _rr = Math.max(700, (_bn.maxX - _bn.minX + _bn.maxZ - _bn.minZ) * 0.32), _gy = St.hole.terrain(_cx, _cz); for (var _k = 0; _k < R3.prism.length; _k++) { var _a = St.t * 0.3 + _k * (TAU / R3.prism.length), _pl = R3.prism[_k]; _pl.position.set(_cx + Math.cos(_a) * _rr, _gy + 150 + Math.sin(St.t * 1.2 + _k * 1.7) * 90, _cz + Math.sin(_a) * _rr); _pl.intensity = R3.prismI * (0.55 + 0.45 * Math.sin(St.t * 2.3 + _k * 2.1)); } }   // PRISMATIC: real coloured point lights orbit the table at different heights + pulse → additive coloured illumination that actually lights the geometry & casts coloured speculars
    R3._sf = (R3._sf || 0) + 1; if (R3.r.shadowMap && (R3._sf & 3) === 0) R3.r.shadowMap.needsUpdate = true;   // re-render the shadow map every 4th frame (autoUpdate is off) — ~75% less shadow work, no visible lag
    var p = R3.post;
    if (p && p.on) {
      try {
        var w = R3.r.domElement.width, h = R3.r.domElement.height;
        if (w > 0 && h > 0 && (p.rt.width !== w || p.rt.height !== h)) {
          p.rt.setSize(w, h); p.mat.uniforms.uRes.value.set(w, h);
          p.ldr.setSize(w, h); p.fxaaM.uniforms.uRes.value.set(w, h);
          var bw = Math.max(8, w >> 2), bh = Math.max(8, h >> 2); p.b1.setSize(bw, bh); p.b2.setSize(bw, bh);
        }
        R3.r.setRenderTarget(p.rt); R3.r.render(R3.scene, R3.cam);
        // bloom chain: bright-pass -> H blur -> V blur (quarter res)
        p.quad.material = p.brightM; p.brightM.uniforms.tD.value = p.rt.texture;
        R3.r.setRenderTarget(p.b1); R3.r.render(p.scene, p.cam);
        p.quad.material = p.blurM; p.blurM.uniforms.tD.value = p.b1.texture; p.blurM.uniforms.uDir.value.set(1 / p.b1.width, 0);
        R3.r.setRenderTarget(p.b2); R3.r.render(p.scene, p.cam);
        p.blurM.uniforms.tD.value = p.b2.texture; p.blurM.uniforms.uDir.value.set(0, 1 / p.b1.height);
        R3.r.setRenderTarget(p.b1); R3.r.render(p.scene, p.cam);
        // film composite -> LDR target
        p.quad.material = p.mat; p.mat.uniforms.tD.value = p.rt.texture; p.mat.uniforms.tB.value = p.b1.texture;
        p.mat.uniforms.uT.value = (performance.now() % 64000) / 1000;
        p.mat.uniforms.uCA.value = p.ca * (1 + Math.min(St.shake || 0, 14) * 0.16);
        R3.r.setRenderTarget(p.ldr); R3.r.render(p.scene, p.cam);
        // FXAA -> screen: smooth the jagged silhouettes & the painted horizon edge
        R3.r.setRenderTarget(null);
        p.quad.material = p.fxaaM; p.fxaaM.uniforms.tD.value = p.ldr.texture;
        R3.r.render(p.scene, p.cam);
        return;
      } catch (e) { p.on = false; try { R3.r.setRenderTarget(null); } catch (e2) { } if (window.console) console.warn('film FX disabled:', e); }
    }
    R3.r.render(R3.scene, R3.cam);
  }

  /* ---------------- build scene from a hole ---------------- */
  function flipperShape(L) { var r0 = 16, r1 = 7, sh = new T.Shape(), phi = Math.asin((r0 - r1) / L); sh.absarc(0, 0, r0, PI / 2 + phi, 1.5 * PI - phi, false); sh.absarc(L, 0, r1, -PI / 2 - phi, PI / 2 + phi, false); return sh; }
  function buildScene(hole) {
    if (!R3.ready) return;
    St.shocks = []; hole._hull = undefined;   // walls may have changed (editor) — recompute the OOB hull lazily
    if (R3.group) R3.scene.remove(R3.group);
    R3.group = new T.Group(); R3.scene.add(R3.group);
    R3.portalSwirls = []; R3.flagWave = null;
    var skyC = (THEMES[hole.theme] || THEMES.grass).sky || 0xc9a06a;   // theme-specific sky + fog (e.g. dark night for Moon)
    R3.scene.background = skyTex(hole.theme || 'grass', skyC) || new T.Color(skyC); R3.holeBg = R3.scene.background; R3.wireDirty = true; R3.outlineDirty = true; if (R3.scene.fog) R3.scene.fog.color.setHex(FOGC[hole.theme || 'grass'] || skyC);
    R3.scene.environment = (hole.theme === 'moon') ? null : (R3.env || null);   // night scene: no warm desert IBL
    var scene = sceneFor(hole);   // this hole's backdrop painting + matching ground/fog/tint — computed up front so the turf can harmonize with it
    var bn = hole.bounds, midZ = (bn.minZ + bn.maxZ) / 2, spanX = bn.maxX - bn.minX + 600, spanZ = bn.maxZ - bn.minZ + 600;
    // terrain mesh
    var segX = 70, segZ = Math.round(spanZ / 30), geo = new T.PlaneGeometry(spanX, spanZ, segX, segZ);
    geo.rotateX(-PI / 2); geo.translate((bn.minX + bn.maxX) / 2, 0, midZ);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) pos.setY(i, hole.terrain(pos.getX(i), pos.getZ(i)));
    // the green stays FLAT — a real golf hole is a cylindrical cup cut straight down, not a sloped funnel (recess removed per design)
    var dimR = K.cupR * 1.18;   // dimR now only sizes the thin brass-lip glow ring hugging the cup, no terrain carving
    R3.cupDimple = null;
    geo.computeVertexNormals();
    // baked contact AO — a soft dark ring along the wall line, fading both ways: grounds the table like real GI
    var aoArr = new Float32Array(pos.count * 3);
    for (var ai = 0; ai < pos.count; ai++) {
      var ax2 = pos.getX(ai), az2 = pos.getZ(ai);
      var dEdge = Math.min(Math.abs(ax2 - bn.minX), Math.abs(bn.maxX - ax2), Math.abs(az2 - bn.minZ), Math.abs(bn.maxZ - az2));
      var inX = ax2 > bn.minX - 1 && ax2 < bn.maxX + 1, inZ = az2 > bn.minZ - 1 && az2 < bn.maxZ + 1;
      var sh3 = (inX && inZ) || dEdge < 240 ? 0.74 + 0.26 * clamp(dEdge / 240, 0, 1) : 1;
      var mot = Math.sin(ax2 * 0.0041 + Math.sin(az2 * 0.0029) * 2.6) + Math.sin(az2 * 0.0053 + Math.sin(ax2 * 0.0023) * 2.2) + 0.6 * Math.sin(ax2 * 0.0017 + az2 * 0.0013);   // multi-scale world-space patchiness — masks the texture tile grid
      sh3 *= 1 + mot * 0.13;
      aoArr[ai * 3] = aoArr[ai * 3 + 1] = aoArr[ai * 3 + 2] = sh3;
    }
    geo.setAttribute('color', new T.BufferAttribute(aoArr, 3));
    var TGROUND = { ice: ['snow_d.jpg', 'snow_n.jpg'], moon: ['snow_d.jpg', 'snow_n.jpg'], mud: ['mud_d.jpg', 'mud_n.jpg'], speed: ['asph_d.jpg', 'asph_n.jpg'], rubber: ['asph_d.jpg', 'asph_n.jpg'], sand: ['sand_d.jpg', 'sand_n.jpg'] };   // each theme gets its OWN photographic ground — ice is ice, moon is regolith, not green grass
    var tgf = TGROUND[hole.theme], tgN = photoTex((tgf ? tgf[1] : 'grass_n.jpg') + '#turf', false, [5, 15]);
    var gtex = (tgf ? tgf[0] : 'grass_d.jpg').replace('_d.', '_g.');   // the REAL surface texture, desaturated to gray detail (grass blades / snow / regolith) — gt tints it to the backdrop color
    var grndTile = photoTex(gtex + '#turf', true, [Math.max(6, Math.round(spanX / 200)), Math.max(10, Math.round(spanZ / 200))]);
    var _ice = hole.theme === 'ice';
    var turfMat = new T.MeshStandardMaterial({ map: grndTile, normalMap: tgN, color: new T.Color().setRGB(scene.gt[0], scene.gt[1], scene.gt[2]), vertexColors: true, roughness: _ice ? .6 : .95, metalness: 0, envMapIntensity: _ice ? .25 : .3 });   // the playfield is THIS hole's painted desert (its own painting foreground tile) + theme normal-map relief; the gt tint nudges the lit+tonemapped result to the painting's ground-average color — painted look AND matched color
    var turf = new T.Mesh(geo, turfMat); turf.receiveShadow = true; R3.group.add(turf); R3.turf = turf;
    // punch a REAL hole through the flat green at the cup — the solid grid would otherwise CAP it (you'd see only a ring, no hole). A clean turf collar hides the blocky grid cut behind a perfectly round rim.
    (function () {
      var cuP = hole.cup, ccy = hole.terrain(cuP.x, cuP.z);
      var cell = Math.max(spanX / segX, spanZ / segZ), openR = K.cupR + cell;
      var idx = geo.index ? geo.index.array : null;
      if (idx) {
        var keep = [];
        for (var t = 0; t < idx.length; t += 3) {
          var i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
          var mx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3, mz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
          if (hyp(mx - cuP.x, mz - cuP.z) > openR) keep.push(i0, i1, i2);
        }
        geo.setIndex(keep); geo.computeVertexNormals();
      }
      var collarMat = turfMat.clone(); collarMat.vertexColors = true;   // invisible patch: same material, UVs continue the turf's own map across the ring so the grass never breaks
      var cInner = K.cupR, cOuter = openR + cell + 36, cgeo = new T.RingGeometry(cInner, cOuter, 96, 4);
      var cp = cgeo.attributes.position, cuv = cgeo.attributes.uv, ccol = new Float32Array(cp.count * 3);
      var pxmin = (bn.minX + bn.maxX) / 2 - spanX / 2, pzmin = midZ - spanZ / 2;
      for (var ci = 0; ci < cp.count; ci++) {
        var lx = cp.getX(ci), ly = cp.getY(ci), wx2 = cuP.x + lx, wz2 = cuP.z - ly;   // ring is rotated -90° about X: local (x,y) -> world (x,-y)
        cuv.setXY(ci, (wx2 - pxmin) / spanX, 1 - (wz2 - pzmin) / spanZ);
        var rr = Math.sqrt(lx * lx + ly * ly), lip = clamp(1 - (rr - cInner) / 9, 0, 1), csh = 1 - 0.28 * lip;   // only the immediate lip darkens, like real worn turf at a cup
        ccol[ci * 3] = ccol[ci * 3 + 1] = ccol[ci * 3 + 2] = csh;
      }
      for (ci = 0; ci < cp.count; ci++) {   // CONFORM the ring to the actual terrain — a flat ring slices any slope into white shards
        var lx2 = cp.getX(ci), ly2 = cp.getY(ci);
        cp.setXYZ(ci, cuP.x + lx2, hole.terrain(cuP.x + lx2, cuP.z - ly2) + 0.5, cuP.z - ly2);
      }
      cgeo.computeVertexNormals();
      cgeo.setAttribute('color', new T.BufferAttribute(ccol, 3));
      var collar = new T.Mesh(cgeo, collarMat); collar.receiveShadow = true; R3.group.add(collar); R3._collar = collar;
    })();
    // GUNSLINGERS PAINTED WORLD — the painted dome backdrop + desert ground patch, rendered for EVERY hole (including the crazy-shaped ones — they live in the same gunslinger world, just with an organic tiered green).
    {
      var pr = Math.max(2600, spanZ * 0.62 + 600, spanX * 0.62 + 600), pcx = (bn.minX + bn.maxX) / 2;
      var theme = hole.theme || 'grass';
      var bgName = scene.bg;
      if (R3.scene.fog) R3.scene.fog.color.setHex(scene.fog || skyC);
      var domeR = pr * 2.7, domeY = 30;
      if (bgName) { var dome = new T.Mesh(new T.SphereGeometry(domeR, 64, 48), domeMat(bgName, scene.rep, scene.oy)); dome.position.set(pcx, domeY, midZ); dome.renderOrder = -2; R3.group.add(dome); }
      else { var dome = new T.Mesh(new T.SphereGeometry(domeR, 48, 32), new T.MeshBasicMaterial({ map: skyTex(theme, skyC), side: T.BackSide, fog: false })); if ('toneMapped' in dome.material) dome.material.toneMapped = false; dome.position.set(pcx, domeY, midZ); dome.renderOrder = -2; R3.group.add(dome); }
      var gr = Math.max(spanX, spanZ) * 0.85 + 700;
      var patchTile = photoTex(gtex + '#patch', true, [Math.max(8, Math.round(gr / 180)), Math.max(8, Math.round(gr / 180))]);
      var patchM = new T.MeshStandardMaterial({ map: patchTile, color: new T.Color().setRGB(scene.gt[0], scene.gt[1], scene.gt[2]), roughness: 1, transparent: true, alphaMap: groundAlpha(), depthWrite: false });
      var patchY = (Array.isArray(hole.islands) && hole.islands.length) ? (Math.min.apply(null, hole.islands.map(function (il) { return il.y || 0; })) - 520) : -34;   // ISLAND holes: sink the desert floor WAY below the lowest island so they float over a deep canyon (not covered by the flat patch)
      var patch = new T.Mesh(new T.CircleGeometry(gr, 96), patchM); patch.rotation.x = -PI / 2; patch.position.set(pcx, patchY, midZ); patch.receiveShadow = true; R3.group.add(patch);
    }
    R3.dust = null;   // removed the glowing additive "magic orb" motes — they read as fantasy sparkles, wrong for a Wild-West game
    if (Array.isArray(hole.islands) && hole.islands.length) { if (R3.turf) R3.turf.visible = false; if (R3._collar) R3._collar.visible = false; hole.islands.forEach(function (isl) { buildShapedGreen(hole, bn, midZ, spanX, spanZ, isl.poly, (isl.y || 0) - 360); }); }   // hide the rectangular turf ONCE, then render each island's own green floor (none of which hide each other now)
    else if (Array.isArray(hole.shape)) buildShapedGreen(hole, bn, midZ, spanX, spanZ);   // organic holes carry hole.shape as the polygon ARRAY (normal holes leave it as the builder method) — replace the rectangular green with the organic tiered one
    // DIORAMA DRESSING — props on the apron just outside the walls (visual only, no collision). PER-HOLE: the RNG is salted by the hole so every hole gets DIFFERENT props in DIFFERENT spots (before, it was seeded only by prop index → identical cacti on every level), and each hole draws from its own "biome" palette (saguaro / crystal field / fungal grove / boulder badlands / oasis / frontier / alien garden).
    (function () {
      var WESTERN = { grass: 1, sand: 1, mud: 1, speed: 1, rubber: 1 };
      var HS = (typeof St !== 'undefined' && St.hi >= 0) ? St.hi : nameHash(hole.name || '');   // per-hole salt
      var prnd = function (n) { var x = Math.sin((n + HS * 97.31 + 11) * 113.7 + 3.3) * 43758.5453; return x - Math.floor(x); };
      var cacM = new T.MeshStandardMaterial({ color: 0x39702f, roughness: .8, envMapIntensity: .15 });
      var rokM = new T.MeshStandardMaterial({ color: 0xa88a66, roughness: .95 });
      var rokM2 = new T.MeshStandardMaterial({ color: 0x8a7458, roughness: .95 });
      var fenM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#fen', true), normalMap: photoTex('wood_n.jpg#fen', false), color: 0xb98c5a, roughness: .8 });
      var moonRokM = new T.MeshStandardMaterial({ color: 0x6a6280, roughness: .95, flatShading: true });
      var cacVM = new T.MeshStandardMaterial({ vertexColors: true, roughness: .88, envMapIntensity: .08 });
      var ribCol = function (geo, rib, c1, c2) {   // ridge/valley vertex shading — gives the ribs real depth under the sun
        var pos = geo.attributes.position, col = new Float32Array(pos.count * 3), CA = new T.Color(c1), CB = new T.Color(c2); if (CA.convertSRGBToLinear) { CA.convertSRGBToLinear(); CB.convertSRGBToLinear(); }
        for (var i = 0; i < pos.count; i++) { var th = Math.atan2(pos.getZ(i), pos.getX(i)), rv = Math.sin(th * rib) * 0.5 + 0.5, cc = CB.clone().lerp(CA, 0.3 + rv * 0.7); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
        geo.setAttribute('color', new T.BufferAttribute(col, 3));
      };
      var ribDisp = function (geo, rib, amt) {   // pleat the surface into saguaro ribs
        var pos = geo.attributes.position;
        for (var i = 0; i < pos.count; i++) { var x = pos.getX(i), z = pos.getZ(i), rr = Math.sqrt(x * x + z * z); if (rr < 0.01) continue; var th = Math.atan2(z, x), f = 1 + (Math.sin(th * rib) * 0.5 + 0.5 - 0.5) * amt; pos.setX(i, x * f); pos.setZ(i, z * f); }
        geo.computeVertexNormals();
      };
      var mkSaguaro = function (ch, cr, seed) {   // a REAL saguaro: ribbed pleated trunk with a gentle lean, domed crown, curved elbow arms (TubeGeometry)
        var RIB = 12, cac = new T.Group();
        var tg = new T.CylinderGeometry(cr * .8, cr, ch, 64, 20);
        var tp = tg.attributes.position; var lean = (prnd(seed * 3.1) - .5) * cr * 0.5;
        for (var i = 0; i < tp.count; i++) { var ty = (tp.getY(i) + ch / 2) / ch; tp.setX(i, tp.getX(i) + Math.sin(ty * PI * 0.5) * lean); }
        ribDisp(tg, RIB, 0.15); ribCol(tg, RIB, 0x3f7230, 0x21451a);
        var trunk = new T.Mesh(tg, cacVM); trunk.position.y = ch / 2; trunk.castShadow = true; cac.add(trunk);
        var cg = new T.SphereGeometry(cr * .8, 64, 24, 0, TAU, 0, PI / 2); ribDisp(cg, RIB, 0.15); ribCol(cg, RIB, 0x477c35, 0x21451a);
        var crown = new T.Mesh(cg, cacVM); crown.position.set(lean, ch, 0); crown.castShadow = true; cac.add(crown);
        var na = 1 + (prnd(seed + 17) > 0.45 ? 1 : 0);
        for (var ai = 0; ai < na; ai++) {
          var sgn = ai ? -1 : 1, ay = ch * (0.38 + prnd(seed + 19 + ai) * 0.22), al = ch * (0.3 + prnd(seed + 29 + ai) * 0.25), ar = cr * (0.5 + prnd(seed + 31 + ai) * 0.12);
          var crv = new T.CatmullRomCurve3([new T.Vector3(sgn * cr * 0.5, ay, 0), new T.Vector3(sgn * cr * 2.1, ay + cr * 0.4, 0), new T.Vector3(sgn * cr * 2.7, ay + cr * 1.6, 0), new T.Vector3(sgn * cr * 2.8, ay + al, 0)]);
          var ag = new T.TubeGeometry(crv, 32, ar, 24, false); ribCol(ag, RIB, 0x3f7230, 0x27521e);
          var arm = new T.Mesh(ag, cacVM); arm.castShadow = true; cac.add(arm);
          var eg = new T.SphereGeometry(ar, 32, 18); ribCol(eg, RIB, 0x477c35, 0x2a5520);
          var ecap = new T.Mesh(eg, cacVM); ecap.position.set(sgn * cr * 2.8, ay + al, 0); ecap.castShadow = true; cac.add(ecap);
        }
        return cac;
      };
      var mkRock = function (R, seed, mat) {   // weathered boulder — noise-displaced, faceted like chiselled stone
        var geo = new T.IcosahedronGeometry(R, 2), pos = geo.attributes.position, v = new T.Vector3();
        for (var i = 0; i < pos.count; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)); var n = Math.sin(v.x * 0.23 + seed) * .5 + Math.sin(v.y * 0.31 + seed * 2.1) * .3 + Math.sin((v.x + v.z) * 0.17 + seed * 3.7) * .4; v.multiplyScalar(1 + n * 0.16); pos.setXYZ(i, v.x, v.y, v.z); }
        geo.computeVertexNormals();
        var mm = mat.clone(); mm.flatShading = true;
        return new T.Mesh(geo, mm);
      };
      var mkCrystal = function (h, seed) {   // a faceted gem cluster — glowing teal/violet spires (the reference's crystal props)
        var g = new T.Group(), n = 2 + Math.floor(prnd(seed) * 3), hue = 0.46 + prnd(seed + 5) * 0.2;
        for (var i = 0; i < n; i++) {
          var ch2 = h * (0.55 + prnd(seed + i) * 0.7), r = ch2 * 0.2;
          var cm = new T.MeshStandardMaterial({ color: new T.Color().setHSL(hue, 0.75, 0.5), roughness: 0.18, metalness: 0.0, flatShading: true, emissive: new T.Color().setHSL(hue, 0.85, 0.42), emissiveIntensity: 0.85, envMapIntensity: 0.2 });
          var cr2 = new T.Mesh(new T.ConeGeometry(r, ch2, 5), cm); cr2.castShadow = true;
          var ang = prnd(seed + i * 3) * TAU, rad = r * 1.3 * i; cr2.position.set(Math.cos(ang) * rad, ch2 / 2, Math.sin(ang) * rad);
          cr2.rotation.z = (prnd(seed + i * 7) - 0.5) * 0.5; cr2.rotation.y = prnd(seed + i) * TAU; g.add(cr2);
        }
        return g;
      };
      var mkMushroom = function (seed) {   // a cluster of toadstools — cream stems, candy caps (the reference's mushroom props)
        var g = new T.Group(), n = 2 + Math.floor(prnd(seed) * 4);
        var stemM = new T.MeshStandardMaterial({ color: 0xe9e0cd, roughness: 0.9 });
        var capM = new T.MeshStandardMaterial({ color: new T.Color().setHSL(0.95 + prnd(seed + 3) * 0.12, 0.62, 0.56), roughness: 0.7, flatShading: true });
        for (var i = 0; i < n; i++) {
          var sh = 18 + prnd(seed + i) * 34, sr = sh * 0.18, cr = sh * 0.52, m = new T.Group();
          var stem = new T.Mesh(new T.CylinderGeometry(sr * 0.8, sr, sh, 8), stemM); stem.position.y = sh / 2; stem.castShadow = true; m.add(stem);
          var cap = new T.Mesh(new T.SphereGeometry(cr, 12, 7, 0, TAU, 0, PI / 2), capM); cap.scale.y = 0.66; cap.position.y = sh; cap.castShadow = true; m.add(cap);
          var ang = prnd(seed + i * 5) * TAU, rad = prnd(seed + i * 2) * cr * 1.6; m.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad); m.scale.setScalar(0.7 + prnd(seed + i) * 0.6); g.add(m);
        }
        return g;
      };
      var mkTree = function (seed) {   // low-poly conifer — stacked cone tiers on a stubby trunk
        var g = new T.Group(), th2 = 80 + prnd(seed) * 90, tr = th2 * 0.06;
        var trunkM = new T.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, flatShading: true });
        var _lc = new T.Color().setHSL(0.33, 0.6, 0.26 + prnd(seed + 1) * 0.08); if (_lc.convertSRGBToLinear) _lc.convertSRGBToLinear();   // deep pine green (converted to linear so the warm sun doesn't wash it to pale cyan)
        var leafM = new T.MeshStandardMaterial({ color: _lc, roughness: 0.85, flatShading: true, envMapIntensity: 0.2 });
        var trunk = new T.Mesh(new T.CylinderGeometry(tr * 0.7, tr, th2 * 0.4, 7), trunkM); trunk.position.y = th2 * 0.2; trunk.castShadow = true; g.add(trunk);
        for (var i = 0; i < 3; i++) { var tw = th2 * (0.34 - i * 0.07), tht = th2 * 0.32, cone = new T.Mesh(new T.ConeGeometry(tw, tht, 7), leafM); cone.position.y = th2 * (0.35 + i * 0.22) + tht / 2; cone.castShadow = true; g.add(cone); }
        return g;
      };
      var pick = function (pal, r) { var s = 0, i; for (i = 0; i < pal.length; i++) s += pal[i][1]; var x = r * s; for (i = 0; i < pal.length; i++) { x -= pal[i][1]; if (x <= 0) return pal[i][0]; } return pal[pal.length - 1][0]; };
      // PER-HOLE BIOME PALETTES — each hole picks one, so its dressing has a distinct character instead of the same cactus mix everywhere
      var PALETTES = [
        [['cactus', 5], ['rock', 2], ['tree', 1], ['brand', 1], ['fence', 1]],   // saguaro flats
        [['crystal', 5], ['rock', 2], ['mushroom', 1], ['cactus', 1]],            // crystal field
        [['mushroom', 5], ['tree', 2], ['rock', 1], ['cactus', 1]],               // fungal grove
        [['rock', 5], ['cactus', 2], ['crystal', 1], ['fence', 1]],               // boulder badlands
        [['tree', 4], ['cactus', 2], ['mushroom', 2], ['rock', 1]],               // oasis
        [['fence', 3], ['brand', 3], ['cactus', 2], ['rock', 1]],                 // frontier ranch
        [['crystal', 3], ['mushroom', 3], ['tree', 2], ['rock', 1]]               // alien garden
      ];
      var isLunar = hole.theme === 'moon' || hole.theme === 'ice';
      var pal = isLunar ? [['crystal', 4], ['rock', 5]] : PALETTES[HS % PALETTES.length];   // moon/ice: rocks + glowing crystals
      var nProps = 30 + Math.floor(prnd(HS * 7 + 1) * 22);   // density varies per hole (30–52)
      for (var k = 0; k < nProps; k++) {
        var side = k % 4, px, pz, off = 80 + prnd(k * 3 + 1) * 170;
        if (side === 0) { px = bn.minX - 180 + prnd(k * 2) * (bn.maxX - bn.minX + 360); pz = bn.minZ - off; }
        else if (side === 1) { px = bn.minX - 180 + prnd(k * 2) * (bn.maxX - bn.minX + 360); pz = bn.maxZ + off; }
        else if (side === 2) { px = bn.minX - off; pz = bn.minZ + prnd(k * 2) * (bn.maxZ - bn.minZ); }
        else { px = bn.maxX + off; pz = bn.minZ + prnd(k * 2) * (bn.maxZ - bn.minZ); }
        var py = hole.terrain(px, pz), type = pick(pal, prnd(k + 99)), ob;
        if (type === 'cactus') {
          ob = mkSaguaro(95 + prnd(k + 11) * 150, 12 + prnd(k + 13) * 8, k); ob.position.set(px, py, pz); ob.rotation.y = prnd(k + 23) * TAU; R3.group.add(ob);
        } else if (type === 'rock') {
          ob = mkRock(24 + prnd(k + 7) * 38, k * 2.3, isLunar ? (hole.theme === 'moon' ? moonRokM : rokM) : (prnd(k + 29) > .5 ? rokM : rokM2)); ob.scale.y = 0.6; ob.position.set(px, py + 8, pz); ob.rotation.y = prnd(k + 31) * TAU; ob.castShadow = true; R3.group.add(ob);
        } else if (type === 'crystal') {
          ob = mkCrystal(70 + prnd(k + 9) * 90, k * 1.9); ob.position.set(px, py, pz); ob.rotation.y = prnd(k + 5) * TAU; R3.group.add(ob);
        } else if (type === 'mushroom') {
          ob = mkMushroom(k * 2.7); ob.position.set(px, py, pz); ob.rotation.y = prnd(k + 8) * TAU; R3.group.add(ob);
        } else if (type === 'tree') {
          ob = mkTree(k * 3.1); ob.position.set(px, py, pz); ob.rotation.y = prnd(k + 12) * TAU; R3.group.add(ob);
        } else if (type === 'brand') {   // brand art cutouts: barrels, skulls, lanterns, dynamite
          var SPR = [['barrel', 130], ['skull', 84], ['Lantern_2.6_', 96], ['Dynamite_2.1_', 80]];
          var sp = SPR[Math.floor(prnd(k + 61) * SPR.length)], sh2 = sp[1] * (0.85 + prnd(k + 67) * 0.5);
          var bb = new T.Mesh(new T.PlaneGeometry(sh2, sh2), spriteMat(sp[0]));
          bb.position.set(px, py + sh2 / 2 - 8, pz); bb.rotation.y = PI + (prnd(k + 71) - .5) * 0.7; R3.group.add(bb);
          var bsh2 = new T.Mesh(new T.CircleGeometry(sh2 * 0.34, 14), new T.MeshBasicMaterial({ color: 0x07040a, transparent: true, opacity: .4 })); bsh2.rotation.x = -PI / 2; bsh2.position.set(px, py + 1.6, pz); R3.group.add(bsh2);
        } else {   // fence
          var fg = new T.Group();
          for (var fp = 0; fp < 3; fp++) { var post = new T.Mesh(new T.BoxGeometry(9, 52 + prnd(k + fp) * 14, 9), fenM); post.position.set(fp * 56 - 56, 30, 0); post.castShadow = true; fg.add(post); }
          var rail = new T.Mesh(new T.BoxGeometry(150, 7, 5), fenM); rail.position.set(0, 46, 0); rail.rotation.z = (prnd(k + 41) - 0.5) * 0.16; fg.add(rail);
          var rail2 = new T.Mesh(new T.BoxGeometry(150, 7, 5), fenM); rail2.position.set(0, 24, 0); rail2.rotation.z = (prnd(k + 43) - 0.5) * 0.1; fg.add(rail2);
          fg.position.set(px, py, pz); fg.rotation.y = (side < 2 ? 0 : PI / 2) + (prnd(k + 47) - .5) * .5; R3.group.add(fg);
        }
      }
    })();
    // NO procedural town geometry of any kind — the painted panorama backdrop IS the town. Both near 3D boxes and far silhouettes tore horizontal seams across the hand-drawn mesa/sky; any flat box at the horizon stair-steps against the painting. The desert dressing (cacti/rocks/fences/brand props) below carries the world; the backdrop carries the skyline.
        // MOON CRATERS — flat decorative craters scattered on the pale lunar ground (purely visual, no collision; deterministic so they don't jitter on editor rebuilds)
    if (hole.theme === 'moon') {
      var prnd = function (n) { var x = Math.sin(n * 127.1 + 0.7) * 43758.5453; return x - Math.floor(x); };
      var _gc = scene.gt;   // craters are DARKER depressions in the same lavender ground tint, so they read as part of the floor, not bright white spots
      var cFloorMat = new T.MeshStandardMaterial({ color: new T.Color().setRGB(_gc[0] * 0.52, _gc[1] * 0.52, _gc[2] * 0.52), roughness: 1 }), cRimMat = new T.MeshStandardMaterial({ color: new T.Color().setRGB(_gc[0] * 0.34, _gc[1] * 0.34, _gc[2] * 0.34), roughness: 1 });
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
    var wm = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#wm', true), normalMap: photoTex('wood_n.jpg#wm', false), color: 0xc89058, roughness: .72 }), capm = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#cap', true), normalMap: photoTex('wood_n.jpg#cap', false), color: 0xd9b98a, roughness: .6, envMapIntensity: .4 });
    function turfDecal(cx, cz, r0, r1, segs, rings, mat, lift) {   // disc/annulus that FOLLOWS the turf ripples — flat decals z-fight the undulating ground into sawtooth tears
      var pos = [], idx = [], RG = rings;
      for (var ri = 0; ri <= RG; ri++) for (var si = 0; si <= segs; si++) {
        var rr = r0 + (r1 - r0) * ri / RG, aa = si / segs * TAU, wx = cx + Math.cos(aa) * rr, wz = cz + Math.sin(aa) * rr;
        pos.push(wx, hole.terrain(wx, wz) + lift, wz);
      }
      for (ri = 0; ri < RG; ri++) for (si = 0; si < segs; si++) { var a0 = ri * (segs + 1) + si; idx.push(a0, a0 + segs + 1, a0 + 1, a0 + 1, a0 + segs + 1, a0 + segs + 2); }
      var gg = new T.BufferGeometry(); gg.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3)); gg.setIndex(idx); gg.computeVertexNormals();
      var mm = new T.Mesh(gg, mat); R3.group.add(mm); return mm;
    }
    function plankMat(repX, repY, offY, tint, env) {   // real horizontal-plank timber. CACHE the textures by rounded repeat — a shaped hole has ~60 curb walls, and loading 2 fresh textures per wall (×hundreds) overwhelms the browser so most never load and the walls render BLACK. Buckets keep it to a handful of shared textures.
      var bx = Math.max(0.5, Math.round(repX * 2) / 2), by = Math.max(0.5, Math.round(repY * 2) / 2), key = '_plank_' + bx + '_' + by;
      if (!R3[key]) {
        var d = new T.TextureLoader().load('assets/tex/plank_d.jpg'), n = new T.TextureLoader().load('assets/tex/plank_n.jpg');
        d.wrapS = d.wrapT = n.wrapS = n.wrapT = T.RepeatWrapping; if (T.sRGBEncoding) d.encoding = T.sRGBEncoding;
        d.repeat.set(bx, by); n.repeat.set(bx, by);
        if (R3.r && R3.r.capabilities) { d.anisotropy = n.anisotropy = Math.min(8, R3.r.capabilities.getMaxAnisotropy()); }
        R3[key] = { d: d, n: n };
      }
      var tx = R3[key];
      var m = new T.MeshStandardMaterial({ map: tx.d, normalMap: tx.n, color: tint, roughness: .82, envMapIntensity: env == null ? .55 : env }); m.normalScale = new T.Vector2(1.4, 1.4); return m;
    }
    var postWoodM = plankMat(1, 2.2, 0, 0xb58a5c, .5);
    hole.walls.forEach(function (s) { if (s.tunnel) return; var dx = s.bx - s.ax, dz = s.bz - s.az, L = hyp(dx, dz); if (L < 1) return; var g = new T.Group(); var gy = hole.terrain((s.ax + s.bx) / 2, (s.az + s.bz) / 2);   // tunnel rails render as glass below, not plank
      var prnd2 = function (n) { var v = Math.sin((s.ax + s.az + n) * 12.97) * 43758.5453; return v - Math.floor(v); };
      var repX = Math.max(1.4, L / 360), repY = Math.max(0.55, s.h / 150), tint = new T.Color(s.c).lerp(new T.Color(0xffffff), 0.5);
      var pm = plankMat(repX, repY, prnd2(1) * 0.7, tint, .5);   // per-wall vertical offset so neighbouring walls never show the same board row -> no obvious repeat
      var mats = [pm];
      var body = new T.Mesh(new T.BoxGeometry(L + (s.curve ? 24 : 14), s.h, s.curve ? 26 : 22), pm); body.position.y = s.h / 2; body.castShadow = body.receiveShadow = true; g.add(body);
      var aoM = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });   // grime/contact AO darkening along the base of the wall
      var ao = new T.Mesh(new T.PlaneGeometry(L + 14, s.h * 0.34), aoM); ao.position.set(0, s.h * 0.17, 11.2); g.add(ao);
      var capW = s.curve ? L + 22 : L + 16;   // organic curb: overlap the cap rails so the curve reads as ONE continuous rail, not blocky segments
      var capM2 = plankMat(repX, 0.5, prnd2(3) * 0.7, new T.Color(0xe8cda0), .5); var cap = new T.Mesh(new T.BoxGeometry(capW, 9, 27), capM2); cap.position.y = s.h + 3; cap.castShadow = true; g.add(cap); mats.push(capM2);
      if (!s.curve) [-1, 1].forEach(function (sgn2) { var post = new T.Mesh(new T.CylinderGeometry(10, 12, s.h + 18, 24), postWoodM); post.position.set(sgn2 * (L / 2 + 3), (s.h + 18) / 2 - 5, 0); post.castShadow = true; g.add(post);   // posts only on straight box walls — an organic curb gets a clean rail instead of a post at every tiny segment
        var pcap = new T.Mesh(new T.SphereGeometry(10.5, 22, 14, 0, TAU, 0, PI / 2), postWoodM); pcap.position.set(sgn2 * (L / 2 + 3), s.h + 13, 0); g.add(pcap); });
      g.position.set((s.ax + s.bx) / 2, gy, (s.az + s.bz) / 2); g.rotation.y = -Math.atan2(dz, dx); R3.group.add(g); s._m3 = { mats: mats, fade: 0, gy: gy }; });
    // METAL TUNNELS — a polished-steel skeleton (corner rails + hoop-rib U-frames) with faint smoked-metal glazing, so the ball rolls through and stays visible but it reads as METAL, not cheap blue glass
    (hole.tunnels || []).forEach(function (tn) {
      var tdx = tn.bx - tn.ax, tdz = tn.bz - tn.az, tL = hyp(tdx, tdz); if (tL < 1) return;
      var tmx = (tn.ax + tn.bx) / 2, tmz = (tn.az + tn.bz) / 2, tgy = hole.terrain(tmx, tmz);
      var paneM = new T.MeshStandardMaterial({ color: 0x6f7a86, transparent: true, opacity: 0.17, roughness: 0.12, metalness: 0.92, side: T.DoubleSide, depthWrite: false, envMapIntensity: 1.5 });   // smoked metal-tinted glazing — see-through, but metallic not blue
      var steelM = metalMat(0xb2b8c2, 1, 1.8), boltM = metalMat(0x8a9099, 1, 1.4);   // polished steel frame
      var grp = new T.Group(); grp.position.set(tmx, tgy, tmz); grp.rotation.y = Math.atan2(tdx, tdz);
      [-1, 1].forEach(function (sgn) { if (!tn.roofOnly) { var side = new T.Mesh(new T.PlaneGeometry(tL, tn.h), paneM); side.rotation.y = PI / 2; side.position.set(sgn * tn.w, tn.h / 2, 0); grp.add(side); } });
      var roof = new T.Mesh(new T.PlaneGeometry(tn.w * 2, tL), paneM); roof.rotation.x = -PI / 2; roof.position.set(0, tn.h, 0); grp.add(roof);
      // four polished-steel corner rails running the length of the tunnel
      [[-1, tn.h], [1, tn.h], [-1, 0], [1, 0]].forEach(function (e) { var rail = new T.Mesh(new T.CylinderGeometry(7, 7, tL, 14), steelM); rail.rotation.x = PI / 2; rail.position.set(e[0] * tn.w, e[1], 0); rail.castShadow = true; grp.add(rail); });
      // metal HOOP RIBS — a U-frame (top beam + 2 posts) every ~120, with bolt collars where they meet the rails
      var ribs = Math.max(2, Math.round(tL / 120));
      for (var ri = 0; ri <= ribs; ri++) {
        var zz = -tL / 2 + (tL * ri / ribs);
        var beam = new T.Mesh(new T.BoxGeometry(tn.w * 2 + 16, 11, 11), steelM); beam.position.set(0, tn.h, zz); beam.castShadow = true; grp.add(beam);
        if (!tn.roofOnly) [-1, 1].forEach(function (sgn) { var post = new T.Mesh(new T.BoxGeometry(11, tn.h, 11), steelM); post.position.set(sgn * tn.w, tn.h / 2, zz); grp.add(post); var bolt = new T.Mesh(new T.CylinderGeometry(10, 10, 8, 12), boltM); bolt.rotation.x = PI / 2; bolt.position.set(sgn * tn.w, tn.h, zz); grp.add(bolt); });
      }
      R3.group.add(grp);
    });
    // bumpers — classic pinball POP BUMPERS: chrome base + slam ring, glossy red skirt, glass dome over a glowing bulb that FLASHES on every hit
    var chromeB = metalMat(0xf4f6fa, 1, 2.4);
    var bumpRed = new T.MeshPhysicalMaterial ? new T.MeshPhysicalMaterial({ color: 0x9c0e16, metalness: .15, roughness: .85, envMapIntensity: 1.0, clearcoat: 1, clearcoatRoughness: .14, roughnessMap: photoTex('metal_r.jpg#mtl', false, [2.4, 2.4]), normalMap: photoTex('metal_n.jpg#mtl', false, [2.4, 2.4]) }) : new T.MeshStandardMaterial({ color: 0x9c0e16, metalness: .2, roughness: .3 });
    var bumpGlass = new T.MeshPhysicalMaterial ? new T.MeshPhysicalMaterial({ color: 0xfff2cf, metalness: .05, roughness: .05, transparent: true, opacity: .22, envMapIntensity: 2.0, clearcoat: 1, clearcoatRoughness: .04, side: T.DoubleSide }) : new T.MeshStandardMaterial({ color: 0xfff2cf, transparent: true, opacity: .22, roughness: .08 });
    var glassM = new T.MeshPhysicalMaterial({ color: 0xfff8ea, metalness: 0, roughness: .02, transmission: .96, ior: 1.5, transparent: true, opacity: 1, envMapIntensity: 3.2, clearcoat: 1, clearcoatRoughness: .02, side: T.DoubleSide });
    var brassM = metalMat(0xd9a44e, 1, 1.7);
    var darkIronM = metalMat(0x3a3026, .9, 1.0, 0.7);
    hole.bumpers.forEach(function (bm, bmi) {
      var gy = hole.terrain(bm.x, bm.z), g = new T.Group(), r = bm.r, kind = bmi % 3;
      turfDecal(bm.x, bm.z, 0, r * 1.4, 40, 3, new T.MeshBasicMaterial({ color: 0x07040a, transparent: true, opacity: .35, depthWrite: false }), 1.6);
      bm.glow = turfDecal(bm.x, bm.z, 0, r * 1.95, 40, 3, new T.MeshBasicMaterial({ color: 0xffc24e, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }), 2.6);
      var ring = new T.Mesh(new T.TorusGeometry(r * 1.0, 5.5, 24, 128), goldMat()); ring.rotation.x = -PI / 2; ring.position.y = 32; ring.castShadow = true; g.add(ring); bm.ring = ring; bm.ringY0 = 32;
      var halo = new T.Mesh(new T.SphereGeometry(r * 0.92, 32, 20), new T.MeshBasicMaterial({ color: 0xffd86a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); halo.position.y = 30; g.add(halo); bm.halo = halo;
      if (kind === 1) {   // SALOON OIL LANTERN — brass body, real glass chimney, a living flame inside
        var lbase = new T.Mesh(new T.CylinderGeometry(r * .8, r * 1.05, 14, 96), brassM); lbase.position.y = 7; lbase.castShadow = true; g.add(lbase);
        var tank = new T.Mesh(new T.SphereGeometry(r * .62, 40, 26), brassM); tank.scale.y = .62; tank.position.y = 20; tank.castShadow = true; g.add(tank);
        var lpts = []; for (var li = 0; li <= 16; li++) { var lt = li / 16; lpts.push(new T.Vector2(r * (0.42 + Math.sin(lt * PI) * 0.16), 26 + lt * r * 1.15)); }
        var chim = new T.Mesh(new T.LatheGeometry(lpts, 96), glassM); chim.castShadow = false; g.add(chim);
        var flameM = new T.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xff9a1e, emissiveIntensity: .9, roughness: .4 });
        var flame = new T.Mesh(new T.SphereGeometry(r * .24, 24, 18), flameM); flame.scale.y = 1.7; flame.position.y = 30 + r * .5; g.add(flame); bm.coreM = flameM;
        var crown = new T.Mesh(new T.CylinderGeometry(r * .3, r * .48, 9, 40), brassM); crown.position.y = 27 + r * 1.18; crown.castShadow = true; g.add(crown);
        var knob = new T.Mesh(new T.SphereGeometry(r * .14, 20, 14), brassM); knob.position.y = 33 + r * 1.18; g.add(knob); bm.btnM = null;
      } else if (kind === 2) {   // WHISKEY BARREL — coopered staves, iron hoops, amber glow seeping from the bung
        var bpts = []; for (var bi2 = 0; bi2 <= 18; bi2++) { var bt = bi2 / 18; bpts.push(new T.Vector2(r * (0.78 + Math.sin(bt * PI) * 0.3), 2 + bt * r * 1.5)); }
        var barrelM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#brl', true), normalMap: photoTex('wood_n.jpg#brl', false), color: 0xb98050, roughness: .66, envMapIntensity: .5 }); barrelM.normalScale = new T.Vector2(1.6, 1.6); var barrel = new T.Mesh(new T.LatheGeometry(bpts, 112), barrelM); barrel.castShadow = true; g.add(barrel);
        var lidM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#brl', true), normalMap: photoTex('wood_n.jpg#brl', false), color: 0x96683c, roughness: .7 });
        var lid = new T.Mesh(new T.CylinderGeometry(r * .78, r * .78, 5, 56), lidM); lid.position.y = 3 + r * 1.5; lid.castShadow = true; g.add(lid);
        [0.22, 0.5, 0.78].forEach(function (hh) { var hp = new T.Mesh(new T.TorusGeometry(r * (0.78 + Math.sin(hh * PI) * 0.3) + 1.5, 2.6, 12, 64), darkIronM); hp.rotation.x = -PI / 2; hp.position.y = 2 + hh * r * 1.5; g.add(hp); });
        var bungM = new T.MeshStandardMaterial({ color: 0xffba3a, emissive: 0xd97a10, emissiveIntensity: .8, roughness: .35 });
        var bung = new T.Mesh(new T.CylinderGeometry(r * .2, r * .2, 4, 32), bungM); bung.position.y = 6 + r * 1.5; g.add(bung); bm.coreM = bungM;
      } else {   // CLASSIC POP BUMPER — chrome base, lacquered skirt, glowing bulb under a real glass dome
        var base = new T.Mesh(new T.CylinderGeometry(r * 1.06, r * 1.18, 10, 128), chromeB); base.position.y = 5; base.castShadow = true; g.add(base);
        var skirtC = new T.Mesh(new T.CylinderGeometry(r * 0.9, r * 1.04, 18, 128), bumpRed); skirtC.position.y = 19; skirtC.castShadow = true; g.add(skirtC);
        var coreM = new T.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb31e, emissiveIntensity: .55, roughness: .35 });
        var core = new T.Mesh(new T.SphereGeometry(r * 0.46, 36, 26), coreM); core.position.y = 30 + r * 0.16; g.add(core); bm.coreM = coreM;
        var dome = new T.Mesh(new T.SphereGeometry(r * 0.78, 96, 64, 0, TAU, 0, PI * 0.58), glassM); dome.scale.y = 0.85; dome.position.y = 28; g.add(dome);
        var cap = new T.Mesh(new T.CylinderGeometry(r * 0.52, r * 0.64, 8, 64), bumpRed); cap.position.y = 28 + r * 0.6; cap.castShadow = true; g.add(cap);
        var btn = new T.Mesh(new T.CylinderGeometry(r * 0.2, r * 0.24, 5, 36), new T.MeshStandardMaterial({ color: 0xfff3d4, emissive: 0xffce5a, emissiveIntensity: .4, roughness: .3 })); btn.position.y = 34 + r * 0.6; g.add(btn); bm.btnM = btn.material;
      }
      bm.idleSeed = bmi * 1.7;
      g.position.set(bm.x, gy, bm.z); R3.group.add(g); bm.mesh = g;
    });
    // one shared flash light — jumps to whichever bumper was just smacked (cheap, reads like the real coil flash)
    if (!R3.bumpLight) { R3.bumpLight = new T.PointLight(0xffc24e, 0, 1100, 2); R3.scene.add(R3.bumpLight); }
    R3.bumpLight.intensity = 0;
    // boosters
    hole.boosters.forEach(function (z) {
      var gy = hole.terrain(z.x, z.z), g = new T.Group();
      turfDecal(z.x, z.z, 0, z.r, 48, 4, new T.MeshStandardMaterial({ color: 0x1d86d8, emissive: 0x14589c, emissiveIntensity: .7, transparent: true, opacity: .78, roughness: .4 }), 2.2);
      turfDecal(z.x, z.z, z.r - 4, z.r + 4, 48, 1, new T.MeshStandardMaterial({ color: 0x4ad0ff, emissive: 0x1f8ad0, emissiveIntensity: .85, roughness: .35 }), 3.4);
      var chevM = new T.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: .45, side: T.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      [0, -0.5].forEach(function (off) {   // chevrons CONFORM to the turf like painted markings — floating arrows read as paper shards up close
        var zz = z.r * off, pts = [[0, z.r * 0.72 + zz], [-z.r * 0.46, z.r * 0.1 + zz], [0, z.r * 0.32 + zz], [0, z.r * 0.32 + zz], [z.r * 0.46, z.r * 0.1 + zz], [0, z.r * 0.72 + zz]];
        var arr = new Float32Array(18), ca2 = Math.cos(-Math.atan2(z.dx, z.dz)), sa2 = Math.sin(-Math.atan2(z.dx, z.dz));
        for (var pi2 = 0; pi2 < 6; pi2++) { var wx3 = z.x + pts[pi2][0] * ca2 + pts[pi2][1] * sa2, wz3 = z.z - pts[pi2][0] * sa2 + pts[pi2][1] * ca2; arr[pi2 * 3] = pts[pi2][0]; arr[pi2 * 3 + 1] = hole.terrain(wx3, wz3) - gy + 3.4; arr[pi2 * 3 + 2] = pts[pi2][1]; }
        var cg = new T.BufferGeometry(); cg.setAttribute('position', new T.BufferAttribute(arr, 3));
        cg.computeVertexNormals(); g.add(new T.Mesh(cg, chevM));
      });
      g.position.set(z.x, gy, z.z); g.rotation.y = -Math.atan2(z.dx, z.dz); R3.group.add(g); z.mesh = g;
    });
    // flippers
    var steelM = metalMat(0xd8dde6, 1, 1.8); var redM = new T.MeshPhysicalMaterial ? new T.MeshPhysicalMaterial({ color: 0xb01418, roughness: 1, metalness: .1, clearcoat: .85, clearcoatRoughness: .25, envMapIntensity: 1.1, roughnessMap: photoTex('metal_r.jpg#mtl', false, [2.4, 2.4]), normalMap: photoTex('metal_n.jpg#mtl', false, [2.4, 2.4]) }) : new T.MeshStandardMaterial({ color: 0xb01418, roughness: .3 });
    hole.flippers.forEach(function (f) {
      var gy = hole.terrain(f.px, f.pz), g = new T.Group();
      var pad = new T.Mesh(new T.ExtrudeGeometry(flipperShape(f.len), { depth: 16, bevelEnabled: true, bevelThickness: 4, bevelSize: 3.5, bevelSegments: 8, curveSegments: 24 }), steelM); pad.rotation.x = -PI / 2; pad.position.y = 17; pad.castShadow = true; g.add(pad);
      var rub = new T.Mesh(new T.ExtrudeGeometry(flipperShape(f.len), { depth: 7, bevelEnabled: true, bevelThickness: 2, bevelSize: 4.5, bevelSegments: 6, curveSegments: 24 }), redM); rub.rotation.x = -PI / 2; rub.position.y = 12; g.add(rub);   // red rubber band wrapping the underside edge, like a real machine
      var piv = new T.Mesh(new T.CylinderGeometry(17, 19, 26, 48), new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#pv', true), normalMap: photoTex('wood_n.jpg#pv', false), color: 0x9a7048, roughness: .7 })); piv.position.y = 11; g.add(piv);
      var pivCap = new T.Mesh(new T.SphereGeometry(13, 32, 20), steelM); pivCap.scale.y = .55; pivCap.position.y = 25; g.add(pivCap);
      g.position.set(f.px, gy + 6, f.pz); R3.group.add(g); f.mesh = g;
    });
    // windmills
    hole.windmills.forEach(function (wmi) {
      var gy = hole.terrain(wmi.x, wmi.z);
      [-1, 1].forEach(function (sgn) { var post = new T.Mesh(new T.CylinderGeometry(7, 10, wmi.r * 1.2, 8), new T.MeshStandardMaterial({ color: 0x6e4524, roughness: .85 })); post.position.set(wmi.x + sgn * wmi.r * 1.04, gy + wmi.r * 0.6, wmi.z); post.castShadow = true; R3.group.add(post); });
      var hub = new T.Group(); hub.position.set(wmi.x, gy + wmi.r, wmi.z);
      var railM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#wmr', true), normalMap: photoTex('wood_n.jpg#wmr', false), color: 0xb98a58, roughness: .8 });
      var bmatA = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#wma', true), normalMap: photoTex('wood_n.jpg#wma', false), color: 0xf0e6d2, roughness: .65 }), bmatB = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#wmb', true), normalMap: photoTex('wood_n.jpg#wmb', false), color: 0xd86040, roughness: .65 });
      for (var i = 0; i < wmi.n; i++) {   // built timber-frame sail: two rails carrying painted slats, like a real ranch windmill
        var bo = new T.Group(), bl = wmi.r * 0.96;
        [-1, 1].forEach(function (rs) { var rail = new T.Mesh(new T.BoxGeometry(5.5, bl, 6), railM); rail.position.set(rs * 10, bl / 2 + 8, 0); rail.castShadow = rs > 0; bo.add(rail); });
        for (var sl = 0; sl < 5; sl++) { var slat = new T.Mesh(new T.BoxGeometry(27, bl / 5 - 4, 7), i % 2 ? bmatB : bmatA); slat.position.y = 8 + bl / 5 * (sl + 0.5); slat.rotation.x = (Math.sin(i * 7 + sl * 3) ) * 0.05; slat.castShadow = sl === 2; bo.add(slat); }
        bo.rotation.z = i / wmi.n * TAU; hub.add(bo);
      }
      var cap = new T.Mesh(new T.SphereGeometry(17, 24, 16), goldMat(2.2)); hub.add(cap);
      R3.group.add(hub); wmi.mesh = hub;
    });
    // SLIDING GATES — two stone posts on a track + a wood-and-iron bar that slides between them, opening/closing a gap
    (hole.gates || []).forEach(function (ga) {
      var gdx = ga.bx - ga.ax, gdz = ga.bz - ga.az, gL = Math.sqrt(gdx * gdx + gdz * gdz) || 1, ux = gdx / gL, uz = gdz / gL, bl = gL * ga.barFrac;
      var gy = (hole.terrain(ga.ax, ga.az) + hole.terrain(ga.bx, ga.bz)) / 2; ga.gy = gy;
      var postM = new T.MeshStandardMaterial({ map: photoTex('rock_d.jpg#gp', true), normalMap: photoTex('rock_n.jpg#gp', false), color: 0x8d7a63, roughness: .95 });
      [[ga.ax, ga.az], [ga.bx, ga.bz]].forEach(function (p) { var post = new T.Mesh(new T.CylinderGeometry(15, 19, ga.h + 26, 10), postM); post.position.set(p[0], gy + (ga.h + 26) / 2, p[1]); post.castShadow = true; R3.group.add(post); var cap = new T.Mesh(new T.SphereGeometry(15, 18, 12), goldMat(1.8)); cap.scale.y = .6; cap.position.set(p[0], gy + ga.h + 26, p[1]); R3.group.add(cap); });
      var barG = new T.Group(); barG.position.set(ga.ax, 0, ga.az); barG.rotation.y = Math.atan2(-uz, ux);   // local +X runs along the track toward B
      var woodM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#gb', true), normalMap: photoTex('wood_n.jpg#gb', false), color: 0xb07a3e, roughness: .8 });
      var plank = new T.Mesh(new T.BoxGeometry(bl, ga.h * 0.62, 22), woodM); plank.position.set(bl / 2, gy + ga.h * 0.5, 0); plank.castShadow = true; barG.add(plank);
      [-1, 1].forEach(function (s) { var band = new T.Mesh(new T.BoxGeometry(bl * 0.12, ga.h * 0.66, 25), metalMat(0x33363c, 1, 1.2)); band.position.set(s * bl * 0.4, 0, 0); plank.add(band); });
      R3.group.add(barG); ga.plankMesh = plank; ga.bl = bl;
    });
    // CONVEYOR BELTS — a dark rubber strip with scrolling gold chevrons showing the drift direction
    (hole.conveyors || []).forEach(function (cv) {
      var gy = hole.terrain(cv.x, cv.z), g = new T.Group(); g.position.set(cv.x, gy + 1, cv.z); g.rotation.y = -cv.ang;   // local +X = belt drift direction
      var beltM = new T.MeshStandardMaterial({ color: 0x26282f, roughness: .75, metalness: .1 });
      var base = new T.Mesh(new T.BoxGeometry(cv.len, 7, cv.w), beltM); base.position.y = 3; base.receiveShadow = true; g.add(base);
      [-1, 1].forEach(function (s) { var rail = new T.Mesh(new T.BoxGeometry(cv.len, 11, 12), metalMat(0x55585f, 1, 1)); rail.position.set(0, 5, s * cv.w / 2); g.add(rail); });
      var arrM = new T.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x6a4e08, emissiveIntensity: .55, roughness: .5 });
      var nArr = Math.max(2, Math.round(cv.len / 150)); cv.arrows = []; cv.spacing = cv.len / nArr;
      for (var i = 0; i < nArr; i++) { var ar = new T.Mesh(new T.ConeGeometry(cv.w * 0.16, cv.w * 0.32, 3), arrM); ar.rotation.z = -PI / 2; ar.position.set(-cv.len / 2 + (i + 0.5) * cv.spacing, 8, 0); g.add(ar); cv.arrows.push(ar); }
      R3.group.add(g); cv.mesh = g;
    });
    // PENDULUMS — an A-frame gantry over the lane + a swinging iron wrecking ball
    (hole.pendulums || []).forEach(function (pd) {
      var gy = hole.terrain(pd.x, pd.z), H = gy + pd.len + pd.rb, woodM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#pen', true), color: 0x6e4a2c, roughness: .85 });
      [-1, 1].forEach(function (s) { var leg = new T.Mesh(new T.CylinderGeometry(11, 15, H - gy, 8), woodM); leg.position.set(pd.x + s * pd.len * 0.5, (gy + H) / 2, pd.z); leg.rotation.z = s * 0.18; leg.castShadow = true; R3.group.add(leg); });
      var beam = new T.Mesh(new T.BoxGeometry(pd.len * 1.15, 16, 16), woodM); beam.position.set(pd.x, H, pd.z); R3.group.add(beam);
      var g = new T.Group(); g.position.set(pd.x, H, pd.z);
      var arm = new T.Mesh(new T.CylinderGeometry(4.5, 4.5, pd.len, 8), metalMat(0x8a8e96, 1, 1.1)); arm.position.y = -pd.len / 2; g.add(arm);
      var bob = new T.Mesh(new T.SphereGeometry(pd.rb, 26, 20), metalMat(0x33363d, 1, 1.5)); bob.position.y = -pd.len; bob.castShadow = true; g.add(bob);
      g.rotation.z = pd.ang; R3.group.add(g); pd.pivot = g; pd.bobMesh = bob;
    });
    // TURNTABLES — a spinning steel disc with gold spoke-bars + a hub
    (hole.turntables || []).forEach(function (tt) {
      var gy = hole.terrain(tt.x, tt.z), g = new T.Group(); g.position.set(tt.x, gy + 2, tt.z);
      var disc = new T.Mesh(new T.CylinderGeometry(tt.r, tt.r, 9, 44), new T.MeshStandardMaterial({ color: 0x474a53, roughness: .55, metalness: .35 })); disc.position.y = 4; disc.receiveShadow = true; g.add(disc);
      var spokeM = new T.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x6a4e08, emissiveIntensity: .4, roughness: .5 });
      for (var i = 0; i < 3; i++) { var bar = new T.Mesh(new T.BoxGeometry(tt.r * 1.8, 5, 11), spokeM); bar.position.y = 9.5; bar.rotation.y = i / 3 * PI; g.add(bar); }
      var hub = new T.Mesh(new T.CylinderGeometry(20, 22, 16, 18), metalMat(0x33363d, 1, 1.3)); hub.position.y = 11; g.add(hub);
      R3.group.add(g); tt.mesh = g;
    });
    // CANNONS — a black iron cannon barrel on a wood carriage, pointing where it fires
    (hole.cannons || []).forEach(function (cn) {
      var gy = hole.terrain(cn.x, cn.z), g = new T.Group(); g.position.set(cn.x, gy, cn.z); g.rotation.y = cn.ang;
      var ironM = metalMat(0x2b2b30, 1, 1.4), woodM = new T.MeshStandardMaterial({ map: photoTex('wood_d.jpg#cn', true), color: 0x8a5a30, roughness: .8 });
      var barrel = new T.Mesh(new T.CylinderGeometry(20, 26, 96, 22), ironM); barrel.rotation.x = -PI / 2.6; barrel.position.set(0, 44, 0); barrel.castShadow = true; g.add(barrel);
      var mouth = new T.Mesh(new T.CylinderGeometry(20, 20, 8, 22), new T.MeshBasicMaterial({ color: 0x0a0608 })); mouth.rotation.x = -PI / 2.6; mouth.position.set(0, 44 + Math.sin(PI / 2.6) * 48, Math.cos(PI / 2.6) * 48); g.add(mouth);
      var carriage = new T.Mesh(new T.BoxGeometry(58, 26, 70), woodM); carriage.position.y = 16; carriage.castShadow = true; g.add(carriage);
      [-1, 1].forEach(function (s) { var wheel = new T.Mesh(new T.CylinderGeometry(24, 24, 10, 16), woodM); wheel.rotation.z = PI / 2; wheel.position.set(s * 32, 20, -14); g.add(wheel); });
      var ring = new T.Mesh(new T.TorusGeometry(cn.r, 4, 8, 28), new T.MeshStandardMaterial({ color: 0xc23a2a, emissive: 0x7a1208, emissiveIntensity: .6, roughness: .5 })); ring.rotation.x = -PI / 2; ring.position.y = 3; ring.position.set(0, 3, 0); g.add(ring);
      R3.group.add(g); cn.mesh = g;
    });
    // BOUNCERS — a springy red-and-white trampoline pad
    (hole.bouncers || []).forEach(function (bc) {
      var gy = hole.terrain(bc.x, bc.z), g = new T.Group(); g.position.set(bc.x, gy, bc.z);
      var rim = new T.Mesh(new T.CylinderGeometry(bc.r, bc.r, 16, 28), new T.MeshStandardMaterial({ color: 0xc83a3a, roughness: .5 })); rim.position.y = 8; rim.castShadow = true; g.add(rim);
      var pad = new T.Mesh(new T.CylinderGeometry(bc.r * 0.82, bc.r * 0.82, 6, 28), new T.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0x554a32, emissiveIntensity: .25, roughness: .6 })); pad.position.y = 16; g.add(pad);
      var coil = new T.Mesh(new T.TorusGeometry(bc.r * 0.5, 4, 8, 24), goldMat(1.6)); coil.rotation.x = -PI / 2; coil.position.y = 19; g.add(coil);
      R3.group.add(g); bc.mesh = g;
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
    (hole.loops || []).forEach(function (lo) {   // REAL mini-golf loop-de-loop: a galvanized steel CHANNEL — full ring trough with side walls and flat entry/exit tongues at the bottom (see any crazy-golf loop)
      var gy = hole.terrain(lo.x, lo.z), r = lo.r, fwx = Math.sin(lo.ang), fwz = Math.cos(lo.ang), ltx = Math.cos(lo.ang), ltz = -Math.sin(lo.ang);
      var cx = lo.x, cy = gy + r, cz = lo.z, W = 64, WALL = 20, SEG = 128, SHIFT = W + 14;   // total lateral twist over one turn: a track-width + clearance, so entry and exit sit side by side
      var steelM = new T.MeshStandardMaterial({ color: 0xc9ced4, metalness: .88, roughness: .32, envMapIntensity: 1.6, side: T.DoubleSide });
      function channelRing() {   // three swept strips: floor + two side walls, riding surface on the INSIDE of the ring
        var pos = [], idx = [], rows = SEG + 1;
        for (var i2 = 0; i2 < rows; i2++) {
          var th = i2 / SEG * TAU, fx2 = Math.sin(th) * r, fy2 = cy - Math.cos(th) * r, latS = (i2 / SEG - 0.5) * SHIFT;   // the HELIX: each step around also slides sideways
          var bxw = cx + fwx * fx2 + ltx * latS, bzw = cz + fwz * fx2 + ltz * latS, inx = (cx + ltx * latS - bxw) / r, iny = (cy - fy2) / r, inz = (cz + ltz * latS - bzw) / r;
          // 4 verts per row: wallL top, floor L, floor R, wallR top
          pos.push(bxw + ltx * W / 2 + inx * WALL, fy2 + iny * WALL, bzw + ltz * W / 2 + inz * WALL,
                   bxw + ltx * W / 2, fy2, bzw + ltz * W / 2,
                   bxw - ltx * W / 2, fy2, bzw - ltz * W / 2,
                   bxw - ltx * W / 2 + inx * WALL, fy2 + iny * WALL, bzw - ltz * W / 2 + inz * WALL);
          if (i2 < SEG) { var a0 = i2 * 4; for (var q = 0; q < 3; q++) idx.push(a0 + q, a0 + q + 4, a0 + q + 1, a0 + q + 1, a0 + q + 4, a0 + q + 5); }
        }
        var gg = new T.BufferGeometry(); gg.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3)); gg.setIndex(idx); gg.computeVertexNormals();
        var mm = new T.Mesh(gg, steelM); mm.castShadow = true; R3.group.add(mm);
      }
      channelRing();
      [-1, 1].forEach(function (sd) {   // flat entry/exit tongues — each on ITS side of the twist, so they sit beside each other instead of colliding
        var TL = r * 0.85, tcx = cx + fwx * sd * TL / 2 + ltx * sd * SHIFT / 2, tcz = cz + fwz * sd * TL / 2 + ltz * sd * SHIFT / 2, tgy = hole.terrain(tcx, tcz);
        var tg2 = new T.Group();
        var fl = new T.Mesh(new T.BoxGeometry(TL, 3, W), steelM); fl.position.y = 1.5; fl.receiveShadow = true; tg2.add(fl);
        [-1, 1].forEach(function (ws) { var wl = new T.Mesh(new T.BoxGeometry(TL, WALL * (sd === 1 ? 0.9 : 0.9), 3), steelM); wl.position.set(0, WALL * 0.45, ws * (W / 2 - 1.5)); wl.castShadow = true; tg2.add(wl); });
        tg2.position.set(tcx, tgy, tcz); tg2.rotation.y = Math.atan2(fwx, fwz); R3.group.add(tg2);
      });
      var base = new T.Mesh(new T.CircleGeometry(r * .6, 32), new T.MeshBasicMaterial({ color: 0x07040a, transparent: true, opacity: .3 })); base.rotation.x = -PI / 2; base.position.set(lo.x, gy + 1.2, lo.z); R3.group.add(base);
    });
    (hole.warps || []).forEach(function (wp) {
      var gy = hole.terrain(wp.x, wp.z), gy2 = hole.terrain(wp.ex, wp.ez);
      if (wp.tube) {   // a polished-STEEL pipe that arcs from the entrance up and over to the exit (metal, not wood)
        var dxt = wp.ex - wp.x, dzt = wp.ez - wp.z, dist = hyp(dxt, dzt), arc = 200 + dist * 0.22, R = wp.r;
        var crv = new T.CatmullRomCurve3([new T.Vector3(wp.x, gy + R * 0.5, wp.z), new T.Vector3(wp.x + dxt * 0.28, gy + arc * 0.7 + R, wp.z + dzt * 0.28), new T.Vector3(wp.x + dxt * 0.5, gy + arc + R, wp.z + dzt * 0.5), new T.Vector3(wp.x + dxt * 0.72, gy2 + arc * 0.7 + R, wp.z + dzt * 0.72), new T.Vector3(wp.ex, gy2 + R * 0.5, wp.ez)]);
        var tubeMat = metalMat(0xb4bac4, 1, 1.8); tubeMat.side = T.DoubleSide;   // polished steel
        var pipe = new T.Mesh(new T.TubeGeometry(crv, 44, R, 20, false), tubeMat); pipe.castShadow = true; R3.group.add(pipe);
        var bandM = metalMat(0x7c818b, 1, 1.3);   // darker steel bands every few segments for a riveted-pipe read
        for (var tb = 1; tb < 5; tb++) { var tp = crv.getPoint(tb / 5), band = new T.Mesh(new T.TorusGeometry(R * 1.06, R * 0.13, 10, 22), bandM); var tng = crv.getTangent(tb / 5); band.position.copy(tp); band.lookAt(tp.clone().add(tng)); R3.group.add(band); }
        var rimM = metalMat(0x6a6f78, 1, 1.2);
        [[wp.x, gy, wp.z], [wp.ex, gy2, wp.ez]].forEach(function (e, ei) { var mouth = new T.Mesh(new T.CylinderGeometry(R * 1.08, R * 1.08, 26, 20, 1, true), rimM); mouth.position.set(e[0], e[1] + R * 0.5, e[2]); R3.group.add(mouth); var hole2 = new T.Mesh(new T.CircleGeometry(R * 0.92, 20), new T.MeshBasicMaterial({ color: 0x0a0608 })); hole2.rotation.x = -PI / 2; hole2.position.set(e[0], e[1] + 2.5, e[2]); R3.group.add(hole2); if (ei === 0) wp.mesh = mouth; });
        return;
      }
      var pit = new T.Mesh(new T.CylinderGeometry(wp.r, wp.r * .7, 80, 22), new T.MeshStandardMaterial({ color: 0x0a0616, roughness: 1 })); pit.position.set(wp.x, gy - 38, wp.z); R3.group.add(pit);
      var ring1 = new T.Mesh(new T.TorusGeometry(wp.r, 6, 10, 24), new T.MeshStandardMaterial({ color: 0x2aa8ff, emissive: 0x1466cc, emissiveIntensity: .85, roughness: .35 })); ring1.rotation.x = -PI / 2; ring1.position.set(wp.x, gy + 2, wp.z); R3.group.add(ring1); wp.mesh = ring1;
      var ring2 = new T.Mesh(new T.TorusGeometry(wp.r * .9, 5, 10, 24), new T.MeshStandardMaterial({ color: 0x2aff9a, emissive: 0x12a866, emissiveIntensity: .75, roughness: .35 })); ring2.rotation.x = -PI / 2; ring2.position.set(wp.ex, gy2 + 2, wp.ez); R3.group.add(ring2);
      var glow = new T.Mesh(new T.CircleGeometry(wp.r * .9, 20), new T.MeshBasicMaterial({ color: 0x2aff9a, transparent: true, opacity: .25 })); glow.rotation.x = -PI / 2; glow.position.set(wp.ex, gy2 + 1.5, wp.ez); R3.group.add(glow);
    });
    (hole.portals || []).forEach(function (po) {   // swirling VORTEX portals: dark eye, spinning spiral arms (additive, blooms), hot emissive ring
      var pp = [[po.x, po.z]]; (po.exits || [{ x: po.ex, z: po.ez }]).forEach(function (e) { pp.push([e.x, e.z]); });
      pp.forEach(function (p, pi) {
        var g = hole.terrain(p[0], p[1]), col = pi === 0 ? 0xc45cff : 0x8a5cff;
        var eye = new T.Mesh(new T.CircleGeometry(po.r * 0.52, 22), new T.MeshBasicMaterial({ color: 0x0a0414, transparent: true, opacity: .92 })); eye.rotation.x = -PI / 2; eye.position.set(p[0], g + 1.8, p[1]); R3.group.add(eye);
        var swirl = new T.Mesh(new T.PlaneGeometry(po.r * 2.5, po.r * 2.5), new T.MeshBasicMaterial({ map: swirlTex(col), transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
        swirl.rotation.x = -PI / 2; swirl.position.set(p[0], g + 2.8, p[1]); R3.group.add(swirl);
        R3.portalSwirls.push({ m: swirl, dir: pi === 0 ? 1 : -1, sp: 2.4 + pi * 0.4 });
        var ring = new T.Mesh(new T.TorusGeometry(po.r, 6, 12, 30), new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.05, roughness: .3, metalness: .3 })); ring.rotation.x = -PI / 2; ring.position.set(p[0], g + 4, p[1]); ring.castShadow = true; R3.group.add(ring);
      });
    });
    (hole.firerings || []).forEach(function (fr) {
      var g = hole.terrain(fr.x, fr.z);
      var ring = new T.Mesh(new T.TorusGeometry(fr.r, 11, 14, 36), new T.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff3a00, emissiveIntensity: .85, roughness: .4 })); ring.position.set(fr.x, g + fr.h, fr.z); ring.castShadow = true; R3.group.add(ring); fr.mesh = ring;
      var postH = Math.max(12, fr.h - fr.r); var post = new T.Mesh(new T.CylinderGeometry(5, 8, postH, 8), new T.MeshStandardMaterial({ color: 0x6e4524, roughness: .85 })); post.position.set(fr.x, g + postH / 2, fr.z); post.castShadow = true; R3.group.add(post);
    });
    (hole.coins || []).forEach(function (cn) {
      var g = hole.terrain(cn.x, cn.z);
      var coinM = metalMat(0xffd54a, 1, 1.5); coinM.emissive = new T.Color(0xc89a10); coinM.emissiveIntensity = .42;
      var coinM2 = metalMat(0xa97c10, 1, 1.2); coinM2.emissive = new T.Color(0x6e4f06); coinM2.emissiveIntensity = .4;
      var grp = new T.Group();
      var disc = new T.Mesh(new T.CylinderGeometry(24, 24, 6, 64), coinM); disc.rotation.x = PI / 2; disc.castShadow = true; grp.add(disc);
      var crim = new T.Mesh(new T.CylinderGeometry(26.5, 26.5, 3.2, 64), coinM2); crim.rotation.x = PI / 2; grp.add(crim);   // milled darker edge ring
      var starShp = new T.Shape(); for (var si = 0; si < 10; si++) { var sa = si / 10 * TAU - PI / 2, sr = si % 2 ? 7.5 : 16, sx = Math.cos(sa) * sr, sy = Math.sin(sa) * sr; si ? starShp.lineTo(sx, sy) : starShp.moveTo(sx, sy); }
      var star = new T.Mesh(new T.ExtrudeGeometry(starShp, { depth: 6.5, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.2, bevelSegments: 3 }), coinM2); star.position.z = -4.5; grp.add(star);   // sheriff star embossed through both faces
      grp.position.set(cn.x, g + 40, cn.z); R3.group.add(grp); cn.mesh = grp;
    });
    (hole.powerups || []).forEach(function (pu) {
      var g = hole.terrain(pu.x, pu.z), cfg = PU[pu.kind] || PU.magnet;
      var gem = new T.Mesh(new T.OctahedronGeometry(26, 0), new T.MeshStandardMaterial({ color: cfg.c, emissive: cfg.e, emissiveIntensity: .75, metalness: .5, roughness: .25 })); gem.position.set(pu.x, g + 48, pu.z); gem.castShadow = true; R3.group.add(gem); pu.mesh = gem;
      var halo = new T.Mesh(new T.TorusGeometry(34, 4, 8, 24), new T.MeshBasicMaterial({ color: cfg.c, transparent: true, opacity: .5 })); halo.rotation.x = -PI / 2; halo.position.set(pu.x, g + 12, pu.z); R3.group.add(halo); pu.halo = halo;
    });
    var ENEMY_ART = { spiky: ['enemy-rat', 0.682], blob: ['enemy-opossum', 0.629], ghost: ['enemy-ghost', 1.438] };   // brand characters from the collection — the rat, the opossum, the demon — not procedural blobs
    (hole.enemies || []).forEach(function (en) {
      var g = new T.Group();
      var art = ENEMY_ART[en.type] || ENEMY_ART.spiky, hgt = en.r * 3.0, wid = hgt * art[1];   // billboard cutout of the real hand-drawn character
      var mat = spriteMat(art[0]); if (en.type === 'ghost') { mat = mat.clone(); mat.opacity = 0.78; mat.depthWrite = false; }
      var bb = new T.Mesh(new T.PlaneGeometry(wid, hgt), mat); bb.position.y = hgt * 0.5; g.add(bb); en.bb = bb;
      var sh = new T.Mesh(new T.CircleGeometry(en.r * 0.95, 22), new T.MeshBasicMaterial({ color: 0x07040a, transparent: true, opacity: .34, depthWrite: false })); sh.rotation.x = -PI / 2; sh.position.y = 1.6; g.add(sh);   // grounding contact shadow
      g.position.set(en.cx, hole.terrain(en.cx, en.cz), en.cz); R3.group.add(g); en.mesh = g; en.billboard = true;
    });
    var cu = hole.cup, cy = hole.terrain(cu.x, cu.z), cupD = 46;   // a proper cup: vertical-walled cylinder cut straight DOWN from the flat green
    // REAL golf cup: white plastic liner you look down into, black depth at the bottom, polished brass rim flush with the turf
    var liner = new T.Mesh(new T.CylinderGeometry(K.cupR - 1, K.cupR - 2.5, cupD, 64, 1, true), new T.MeshStandardMaterial({ color: 0xe9e4d8, roughness: .45, side: T.BackSide })); liner.position.set(cu.x, cy - cupD / 2, cu.z); R3.group.add(liner);   // top edge flush at green level (cy), walls drop straight down
    var pitB = new T.Mesh(new T.CircleGeometry(K.cupR - 2.5, 64), new T.MeshBasicMaterial({ color: 0x050308 })); pitB.rotation.x = -PI / 2; pitB.position.set(cu.x, cy - cupD + 1, cu.z); R3.group.add(pitB);
    var rim = new T.Mesh(new T.TorusGeometry(K.cupR + 0.5, 3, 16, 56), goldMat(2.4)); rim.rotation.x = -PI / 2; rim.position.set(cu.x, cy + 0.5, cu.z); R3.group.add(rim);   // brass rim sits flush in the flat turf
    R3.cupGlow = new T.Mesh(new T.RingGeometry(dimR * 0.96, dimR * 1.1, 36), new T.MeshBasicMaterial({ color: 0xf5c542, transparent: true, opacity: .3, side: T.DoubleSide })); R3.cupGlow.rotation.x = -PI / 2; R3.cupGlow.position.set(cu.x, cy + 1, cu.z); R3.group.add(R3.cupGlow);   // thin pulsing lip ring hugging the cup
    // flagstick: painted pole rising from the cup, brass finial, CLOTH pennant that waves in the wind
    var pole = new T.Mesh(new T.CylinderGeometry(2.8, 3.8, 232, 10), new T.MeshStandardMaterial({ color: 0xf0ebe0, roughness: .5 })); pole.position.set(cu.x, cy - cupD + 116, cu.z); pole.castShadow = true; R3.group.add(pole);   // pole foot rests at the cup bottom
    var fin = new T.Mesh(new T.SphereGeometry(6.5, 20, 14), goldMat(2.4)); fin.position.set(cu.x, cy - cupD + 235, cu.z); R3.group.add(fin);
    var FL = 92, FH = 46, fgeo = new T.PlaneGeometry(FL, FH, 14, 3); fgeo.translate(FL / 2 + 3, 0, 0);
    R3.flag = new T.Mesh(fgeo, new T.MeshStandardMaterial({ map: flagTex(), side: T.DoubleSide, roughness: .85 }));
    R3.flag.position.set(cu.x, cy - cupD + 203, cu.z); R3.flag.castShadow = true; R3.group.add(R3.flag);
    R3.flagWave = { geo: fgeo, base: fgeo.attributes.position.array.slice(0), L: FL };
    // balls
    R3.ballMeshes = []; R3.bsh = []; R3.shieldMeshes = [];
    // always-on-top ball locator — a glow that marks exactly where the ball is when geometry would hide it
    R3.ballLocator = new T.Mesh(new T.SphereGeometry(K.R * 1.1, 18, 14), new T.MeshBasicMaterial({ color: 0xffe39a, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }));
    R3.ballLocator.renderOrder = 10000; R3.ballLocator.visible = false; R3.group.add(R3.ballLocator);
  }
  function ensureBallMeshes() {
    if (!R3.shieldMeshes) R3.shieldMeshes = [];
    while (R3.ballMeshes.length < St.balls.length) {
      var m = new T.Mesh(new T.SphereGeometry(K.R, 48, 32), T.MeshPhysicalMaterial ? new T.MeshPhysicalMaterial({ map: ballTex(), bumpMap: ballBump(), bumpScale: 1.1, roughness: .3, clearcoat: .85, clearcoatRoughness: .3, envMapIntensity: .9 }) : new T.MeshStandardMaterial({ map: ballTex(), roughness: .3 })); m.castShadow = true; R3.group.add(m); R3.ballMeshes.push(m);
      var sh = new T.Mesh(new T.CircleGeometry(K.R * 1.2, 14), new T.MeshBasicMaterial({ color: 0x0a1606, transparent: true, opacity: .32 })); sh.rotation.x = -PI / 2; R3.group.add(sh); R3.bsh.push(sh);
      var bb = new T.Mesh(new T.SphereGeometry(K.R * 1.5, 18, 14), new T.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: .4, side: T.DoubleSide, depthWrite: false })); bb.visible = false; bb.renderOrder = 3; R3.group.add(bb); R3.shieldMeshes.push(bb);
    }
  }

  /* ================================================================ FLIPPERS */
  function flipPress(side, down) { var rising = false; St.hole.flippers.forEach(function (f) { if (f.side === side) { if (down) { if (!f.held) rising = true; f.held = true; f.holdT = K.flipHold; } else f.held = false; } }); if (down && rising) sfx('flipclick'); }   // soft mechanical click on each fresh press
  function flipRest(f) { return (f.side === 'L' ? -0.5 : PI + 0.5) + (f.rot || 0); }
  function flipUp(f) { var r = flipRest(f); return f.side === 'L' ? r + K.flipSweep : r - K.flipSweep; }
  function stepFlipper(f, dt) { var driving = f.held || f.holdT > 0; if (f.holdT > 0) f.holdT = Math.max(0, f.holdT - dt); var rest = flipRest(f), up = flipUp(f), target = driving ? up : rest, sp = (f.speed || 1), ms = (driving ? K.flipUpSpd : K.flipDnSpd) * sp * dt, prev = f.ang; f.ang += clamp(target - f.ang, -ms, ms); f.om = (f.ang - prev) / dt; var towardUp = (up - rest) >= 0 ? (f.om > K.flipLiveOm) : (f.om < -K.flipLiveOm); f.live = driving && towardUp; }
  function collideFlipper(b, f, gy) { if (b.y > gy + 60) return; var tx = f.px + Math.cos(f.ang) * f.len, tz = f.pz + Math.sin(f.ang) * f.len; var c = nearestOnSeg(b.x, b.z, f.px, f.pz, tx, tz); var dx = b.x - c.x, dz = b.z - c.z, d = hyp(dx, dz), R = K.R + K.flipHalf; if (d >= R) return; var nx, nz; if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 0; nz = -1; d = .01; } b.x = c.x + nx * R; b.z = c.z + nz * R; var rx = c.x - f.px, rz = c.z - f.pz, q = hyp(rx, rz); if (f.live) { var launch = Math.min(f.power || K.flipKick, Math.abs(f.om) * q * 0.75), cur = b.vx * nx + b.vz * nz; if (cur < launch) { b.vx += (launch - cur) * nx; b.vz += (launch - cur) * nz; } St.shake = Math.min(9, St.shake + 5); spark(b.x, gy + 20, b.z, 8); sfx('flip'); } else { var vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= (1 + K.flipE) * vn * nx; b.vz -= (1 + K.flipE) * vn * nz; } } }

  /* ================================================================ PHYSICS */
  function collideWall(b, s, gy) { if (b.y > gy + s.h - 4) return; var c = nearestOnSeg(b.x, b.z, s.ax, s.az, s.bx, s.bz); var dx = b.x - c.x, dz = b.z - c.z, d = hyp(dx, dz), R = K.R + K.wallHalf; if (d >= R) return; var nx, nz; if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 0; nz = -1; d = .01; } b.x = c.x + nx * R; b.z = c.z + nz * R; var vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= (1 + s.e) * vn * nx; b.vz -= (1 + s.e) * vn * nz; if (vn < -700) { sfx('tick'); } } }
  function containShape(b, poly) {   // hard backstop for the ORGANIC curb: per-segment walls let a fast ball tunnel through the joints, so if the ball ends up outside the polygon, find the nearest edge, shove it back inside and bounce it (so it never escapes the green by rolling)
    if (inPoly(poly, b.x, b.z)) return;
    var best = 1e18, bx = 0, bz = 0;
    for (var i = 0; i < poly.length; i++) { var a = poly[i], c = poly[(i + 1) % poly.length], p = nearestOnSeg(b.x, b.z, a.x, a.z, c.x, c.z), d = hyp(b.x - p.x, b.z - p.z); if (d < best) { best = d; bx = p.x; bz = p.z; } }
    if (best > 130) return;   // way outside (lofted clean over the rail) → leave it for the OOB rescue
    var R = K.R + K.wallHalf, nx = b.x - bx, nz = b.z - bz, nd = hyp(nx, nz) || 1; nx /= nd; nz /= nd;
    b.x = bx - nx * R; b.z = bz - nz * R;   // back inside the curb
    var vout = b.vx * nx + b.vz * nz; if (vout > 0) { b.vx -= 1.55 * vout * nx; b.vz -= 1.55 * vout * nz; if (vout > 600) sfx('tick'); }
  }
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
    var lo = b.loop, rr = lo.r - K.R - 4;   // ball rides the INSIDE of the channel
    lo.t += (lo.ride / (TAU * rr)) * dt;
    var th = lo.t * TAU, fx = Math.sin(lo.ang), fz = Math.cos(lo.ang), s = Math.sin(th);
    var lat = (lo.t - 0.5) * lo.shift * lo.fsgn;   // the helix slide: enter on one side, exit on the other
    b.x = lo.x + s * rr * fx + lo.lx * lat; b.z = lo.z + s * rr * fz + lo.lz * lat; b.y = lo.gy + K.R + rr * (1 - Math.cos(th));
    b.vx = fx * lo.ride * Math.cos(th); b.vz = fz * lo.ride * Math.cos(th); b.vy = 0; b.air = true; b.stillT = 0; b.settled = false;
    if (lo.t >= 1) { var lEnd = lo.shift / 2 * lo.fsgn; b.x = lo.x + fx * lo.r * .6 + lo.lx * lEnd; b.z = lo.z + fz * lo.r * .6 + lo.lz * lEnd; b.y = lo.gy + K.R; b.vx = fx * lo.sp * 1.12; b.vz = fz * lo.sp * 1.12; b.vy = 0; b.air = false; b.loop = null; b.loopCd = .5; pop3d(b.x, b.z, b.y, 'LOOP BOOST!', COL.gold); St.shake = Math.min(10, St.shake + 6); sfx('boost'); }
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
    // ISLAND HOLES: off every island is a deep void. If the ball drops into the gap between islands, rescue it to where the shot was played — BEFORE it plummets into the abyss (which read as a render bug). Works mid-air; the connectors (drop/portal/tube) teleport, so legit traversal never lingers over the void.
    if (hole.islands && hole.islands.length && gh <= -2000) {
      b.voidT = (b.voidT || 0) + dt;
      if (b.voidT > 0.4) {
        b.voidT = 0; var vrs = b.shotFrom || hole.tee, vgy = hole.terrain(vrs.x, vrs.z);
        pop3d(vrs.x, vrs.z, vgy, 'BACK ON THE ISLAND!', COL.gold); sfx('tick');
        b.x = vrs.x; b.z = vrs.z; b.y = vgy + K.R + 80; b.vx = 0; b.vz = 0; b.vy = 0; b.air = true; b.stillT = 0; b.settled = false;
        spawnShock(vrs.x, vgy, vrs.z, COL.gold); St.shake = Math.min(8, St.shake + 4);
        gh = vgy; surf = gh + K.R;   // refresh for the rest of this step
      }
    } else if (b.voidT) b.voidT = 0;
    if (b.y <= surf) {
      var n = normalAt(hole, b.x, b.z); b.y = surf;
      var vn = b.vx * n.x + b.vy * n.y + b.vz * n.z;
      if (vn < 0) { var e = (wasAir && -vn > 220) ? K.groundE : 0; b.vx -= (1 + e) * vn * n.x; b.vy -= (1 + e) * vn * n.y; b.vz -= (1 + e) * vn * n.z; if (wasAir && -vn > 520) { spark(b.x, surf, b.z, 6); St.shake = Math.min(7, St.shake + 3); } }
      var vd = b.vx * n.x + b.vy * n.y + b.vz * n.z, tx = b.vx - vd * n.x, ty = b.vy - vd * n.y, tz = b.vz - vd * n.z, ts = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (ts > 0) { var ns = Math.max(0, ts - K.rollFric * dt), kf = ns / ts; b.vx = tx * kf + vd * n.x; b.vy = ty * kf + vd * n.y; b.vz = tz * kf + vd * n.z; }
      b.air = false;
    } else b.air = true;
    // OUT-OF-BOUNDS RESCUE — lofted over the rail and stranded outside the playfield walls: after a beat, drop the ball back where the shot was played from
    if (!b.air) {
      var hu = hole._hull;
      if (hu === undefined) {
        hu = null;
        if (hole.walls.length) {
          var hx0 = 1e9, hx1 = -1e9, hz0 = 1e9, hz1 = -1e9;
          for (var hwi = 0; hwi < hole.walls.length; hwi++) { var hw = hole.walls[hwi]; hx0 = Math.min(hx0, hw.ax, hw.bx); hx1 = Math.max(hx1, hw.ax, hw.bx); hz0 = Math.min(hz0, hw.az, hw.bz); hz1 = Math.max(hz1, hw.az, hw.bz); }
          // only trust the hull when it encloses the legit play space (tee + cup) — odd custom levels skip the rule
          if (hole.tee.x > hx0 && hole.tee.x < hx1 && hole.tee.z > hz0 && hole.tee.z < hz1 && hole.cup.x > hx0 && hole.cup.x < hx1 && hole.cup.z > hz0 && hole.cup.z < hz1) hu = { minX: hx0, maxX: hx1, minZ: hz0, maxZ: hz1 };
        }
        hole._hull = hu;
      }
      var oob = (hu && (b.x < hu.minX || b.x > hu.maxX || b.z < hu.minZ || b.z > hu.maxZ));
      if (!oob && Array.isArray(hole.shape) && !inPoly(hole.shape, b.x, b.z)) oob = true;   // shaped holes: rolling off the organic green onto the desert apron (inside the wall bbox, outside the polygon) is OUT
      if (oob) {
        b.stillT = 0; b.settled = false;   // never settle out there — the rescue below always gets its chance
        b.oobT = (b.oobT || 0) + dt;
        if (b.oobT > 0.55) {
          b.oobT = 0; var rs = b.shotFrom || hole.tee;
          pop3d(b.x, b.z, gh, 'OUT OF BOUNDS!', COL.red); sfx('tick');
          b.x = rs.x; b.z = rs.z; b.y = hole.terrain(rs.x, rs.z) + K.R + 150; b.vx = 0; b.vz = 0; b.vy = 0; b.air = true; b.stillT = 0; b.settled = false;
          spawnShock(rs.x, hole.terrain(rs.x, rs.z), rs.z, COL.red); St.shake = Math.min(8, St.shake + 4);
        }
      } else b.oobT = 0;
    }
    var i, gy = gh;
    for (i = 0; i < hole.walls.length; i++) { var _w = hole.walls[i]; if (_w._hl !== undefined) { var _wx = b.x - _w._mx, _wz = b.z - _w._mz; if (_wx * _wx + _wz * _wz > _w._hl * _w._hl) continue; } collideWall(b, _w, gy); }   // broad-phase cull: skip far walls
    if (Array.isArray(hole.shape) && !b.air) containShape(b, hole.shape);   // organic-hole backstop so a fast ball can't tunnel through the curb
    for (i = 0; i < hole.bumpers.length; i++) collideBumper(b, hole.bumpers[i], gy);
    for (i = 0; i < hole.flippers.length; i++) collideFlipper(b, hole.flippers[i], gy);
    for (i = 0; i < hole.windmills.length; i++) collideWindmill(b, hole.windmills[i], gy);
    for (i = 0; i < hole.lasers.length; i++) collideLaser(b, hole.lasers[i], gy);
    var gts2 = hole.gates || []; for (i = 0; i < gts2.length; i++) { var ga2 = gts2[i], pbx = b.x, pbz = b.z; collideWall(b, { ax: ga2.cax, az: ga2.caz, bx: ga2.cbx, bz: ga2.cbz, e: ga2.e, h: ga2.h }, gy); if ((b.x - pbx) * (b.x - pbx) + (b.z - pbz) * (b.z - pbz) > 1) { ga2.flash = .25; } }
    var cvs = hole.conveyors || []; for (i = 0; i < cvs.length; i++) { var cv = cvs[i]; if (b.air || b.y > gy + 60) continue; var ca = Math.cos(cv.ang), sa = Math.sin(cv.ang), rx = b.x - cv.x, rz = b.z - cv.z, along = rx * ca + rz * sa, across = -rx * sa + rz * ca; if (Math.abs(along) < cv.len / 2 && Math.abs(across) < cv.w / 2) { b.vx += ca * cv.force * dt; b.vz += sa * cv.force * dt; cv.flash = .15; } }   // CONVEYOR: steady drag along the belt direction while rolling over it
    var pds2 = hole.pendulums || []; for (i = 0; i < pds2.length; i++) { var pd2 = pds2[i]; var pgy = hole.terrain(pd2.x, pd2.z), pH = pgy + pd2.len + pd2.rb, bobx = pd2.x + pd2.len * Math.sin(pd2.ang), boby = pH - pd2.len * Math.cos(pd2.ang), pdx = b.x - bobx, pdy = b.y - boby, pdz = b.z - pd2.z, pd3 = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz), PR = K.R + pd2.rb; if (pd3 < PR) { var ph2 = hyp(pdx, pdz) || 0.01, pnx = pdx / ph2, pnz = pdz / ph2; b.x = bobx + pnx * PR; b.z = pd2.z + pnz * PR; var pvn = b.vx * pnx + b.vz * pnz; if (pvn < 0) { b.vx -= 1.7 * pvn * pnx; b.vz -= 1.7 * pvn * pnz; } b.vx += pnx * 1500; b.vz += pnz * 1500; pd2.flash = .3; St.shake = Math.min(11, St.shake + 6); spark(bobx, pgy + 20, pd2.z, 12); pop3d(bobx, pd2.z, pgy, 'CLANG!', COL.red); sfx('bump'); } }   // PENDULUM: the swinging bob whacks the ball when it's low
    var tts = hole.turntables || []; for (i = 0; i < tts.length; i++) { var tt = tts[i]; if (b.air || b.y > gy + 60) continue; var trx = b.x - tt.x, trz = b.z - tt.z, td = hyp(trx, trz); if (td < tt.r) { var inv = 1 / (td || 1), tgx = -trz * inv, tgz = trx * inv, surf = tt.spin * Math.min(td, tt.r); b.vx += tgx * surf * 9 * dt; b.vz += tgz * surf * 9 * dt; tt.flash = .1; } }   // TURNTABLE: whirl the ball tangentially (no centripetal force → always spirals off the edge, never traps)
    // boosters
    if (b.boostCd > 0) b.boostCd -= dt;
    for (i = 0; i < hole.boosters.length; i++) { var z = hole.boosters[i]; if (b.boostCd <= 0 && b.y < gy + 70 && hyp(b.x - z.x, b.z - z.z) < z.r) { b.vx = z.dx * z.spd; b.vz = z.dz * z.spd; b.boostCd = K.boostCd; z.flash = .3; St.shake = Math.min(11, St.shake + 7); pop3d(z.x, z.z, gy, 'TURBO!', COL.blue); spark(z.x, gy + 16, z.z, 16); spawnShock(z.x, gy, z.z, COL.blue); sfx('boost'); break; } }
    // CANNON — roll in, get BLASTED airborne in the barrel's direction (a high arc)
    if (b.cannonCd > 0) b.cannonCd -= dt;
    var cns = hole.cannons || [];
    for (i = 0; i < cns.length; i++) { var cn = cns[i]; if ((b.cannonCd || 0) <= 0 && !b.air && hyp(b.x - cn.x, b.z - cn.z) < cn.r) { var cgy = hole.terrain(cn.x, cn.z); b.x = cn.x; b.z = cn.z; b.y = cgy + K.R; b.vx = Math.sin(cn.ang) * cn.power; b.vz = Math.cos(cn.ang) * cn.power; b.vy = cn.power * 0.42; b.air = true; b.cannonCd = 0.7; cn.flash = .3; b.stillT = 0; b.settled = false; pop3d(cn.x, cn.z, cgy, 'KABOOM!', COL.red); spark(cn.x, cgy + 20, cn.z, 18); spawnShock(cn.x, cgy, cn.z, COL.red); St.shake = Math.min(12, St.shake + 8); sfx('boost'); break; } }
    // BOUNCER — spring pad: roll over it and BOING straight up
    var bcs = hole.bouncers || [];
    for (i = 0; i < bcs.length; i++) { var bc = bcs[i]; if (!b.air && (b.bounceCd || 0) <= 0 && hyp(b.x - bc.x, b.z - bc.z) < bc.r) { var bgy = hole.terrain(bc.x, bc.z); b.y = bgy + K.R + 6; b.vy = 2300; b.air = true; b.bounceCd = 0.5; bc.flash = .3; b.stillT = 0; b.settled = false; pop3d(bc.x, bc.z, bgy, 'BOING!', COL.gold); spark(bc.x, bgy + 14, bc.z, 12); St.shake = Math.min(9, St.shake + 4); sfx('bump'); break; } }
    if (b.bounceCd > 0) b.bounceCd -= dt;
    // loop-de-loop (enter from either side with enough speed; ball rides the vertical loop, exits boosted)
    var lps = hole.loops || [];
    for (i = 0; i < lps.length; i++) { var lo2 = lps[i]; if (b.loopCd <= 0 && hyp(b.x - lo2.x, b.z - lo2.z) < 72) { var fwd = b.vx * Math.sin(lo2.ang) + b.vz * Math.cos(lo2.ang), sp2 = hyp(b.vx, b.vz); if (Math.abs(fwd) > 800 && sp2 > 900) { var dir = fwd >= 0 ? lo2.ang : lo2.ang + PI; b.loop = { x: lo2.x, z: lo2.z, r: lo2.r, ang: dir, t: 0, sp: Math.min(Math.max(sp2, 1800), 4200), ride: Math.min(Math.max(sp2 * 0.7, 1500), 2400), gy: hole.terrain(lo2.x, lo2.z), shift: lo2.r ? 78 : 78, lx: Math.cos(lo2.ang), lz: -Math.sin(lo2.ang), fsgn: fwd >= 0 ? 1 : -1 }; pop3d(lo2.x, lo2.z, hole.terrain(lo2.x, lo2.z), 'LOOP!', COL.gold); spawnShock(lo2.x, hole.terrain(lo2.x, lo2.z), lo2.z, COL.gold); St.shake = Math.min(10, St.shake + 5); sfx('boost'); return; } } }
    // drop holes / warps — roll in, fall to the linked exit (lower tier)
    if (b.warpCd > 0) b.warpCd -= dt;
    var wps = hole.warps || [];
    for (i = 0; i < wps.length; i++) { var wp = wps[i]; if (b.warpCd <= 0 && !b.air && hyp(b.x - wp.x, b.z - wp.z) < wp.r) { wp.flash = .3; b.x = wp.ex; b.z = wp.ez; b.y = hole.terrain(wp.ex, wp.ez) + K.R + 240; b.vx *= 0.3; b.vz *= 0.3; b.vy = 0; b.air = true; b.warpCd = 0.8; b.stillT = 0; b.settled = false; pop3d(wp.x, wp.z, hole.terrain(wp.x, wp.z), wp.tube ? 'TUBE!' : 'DROP!', COL.blue); spark(wp.x, hole.terrain(wp.x, wp.z) + 12, wp.z, 14); spawnShock(wp.x, hole.terrain(wp.x, wp.z), wp.z, COL.blue); St.shake = Math.min(10, St.shake + 6); sfx('boost'); return; } }
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
    var gts = hole.gates || []; for (i = 0; i < gts.length; i++) { var ga = gts[i]; ga.ph += ga.speed * dt; var gdx = ga.bx - ga.ax, gdz = ga.bz - ga.az, gL = hyp(gdx, gdz) || 1, ux = gdx / gL, uz = gdz / gL, bl = gL * ga.barFrac, slide = (gL - bl) * (0.5 - 0.5 * Math.cos(ga.ph)); ga.slide = slide; ga.cax = ga.ax + ux * slide; ga.caz = ga.az + uz * slide; ga.cbx = ga.cax + ux * bl; ga.cbz = ga.caz + uz * bl; if (ga.flash > 0) ga.flash -= dt; }
    var pds = hole.pendulums || []; for (i = 0; i < pds.length; i++) { var pd = pds[i]; pd.ang = pd.amp * Math.sin(St.t * pd.speed + pd.ph); if (pd.flash > 0) pd.flash -= dt; }
    var tts0 = hole.turntables || []; for (i = 0; i < tts0.length; i++) { var tt0 = tts0[i]; tt0.ang += tt0.spin * dt; if (tt0.flash > 0) tt0.flash -= dt; }
    for (i = 0; i < hole.lasers.length; i++) hole.lasers[i].on = laserActive(hole.lasers[i]);
    var pb0 = null; for (var pbi = 0; pbi < St.balls.length; pbi++) { if (!St.balls[pbi].sunk && !St.balls[pbi].dead) { pb0 = St.balls[pbi]; break; } }
    var ens0 = hole.enemies || []; for (i = 0; i < ens0.length; i++) { var en0 = ens0[i];
      if (en0.behavior === 'static') { en0.cx = en0.x; en0.cz = en0.z; }
      else if (en0.behavior === 'chase' && pb0) { var dxc = pb0.x - en0.cx, dzc = pb0.z - en0.cz, dlc = hyp(dxc, dzc) || 1, spc = en0.speed * 260 * dt; en0.cx += dxc / dlc * Math.min(spc, dlc); en0.cz += dzc / dlc * Math.min(spc, dlc); }
      else { en0.ph += en0.speed * dt; var eu = Math.abs((en0.ph % 2) - 1); en0.cx = en0.x + (en0.ex - en0.x) * eu; en0.cz = en0.z + (en0.ez - en0.z) * eu; }
    }
    var frs0 = hole.firerings || []; for (i = 0; i < frs0.length; i++) { if (frs0[i].passedCd > 0) frs0[i].passedCd -= dt; }
    if (St.state !== 'roll') {
      // PADDLES ALWAYS WORK: a live (up-swinging) flipper can knock a STOPPED/aiming ball — wake it back into a roll, no stroke charged (a pinball-style save)
      if (St.state === 'aim') {
        for (i = 0; i < St.balls.length; i++) { var rb = St.balls[i]; if (rb.sunk || rb.dead) continue; var rgy = hole.terrain(rb.x, rb.z);
          for (var rf = 0; rf < hole.flippers.length; rf++) { var ff = hole.flippers[rf]; if (!ff.live) continue; var sp0 = hyp(rb.vx, rb.vz); collideFlipper(rb, ff, rgy); if (hyp(rb.vx, rb.vz) > sp0 + 40) { rb.settled = false; rb.stillT = 0; rb.air = false; St.state = 'roll'; St.combo = 0; if (St.drag) St.drag = null; } }
        }
      }
      return;
    }
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
    if (St.teamBall && St.tbPlayers && St.tbPlayers.length) { St.tbShots.push(St.tbPlayers[St.tbTurn % St.tbPlayers.length]); St.tbTurn = (St.tbTurn + 1) % St.tbPlayers.length; tbTurnUpdate(); }   // alternate shot: credit the shooter, pass to the next partner
    if (St.bestBall) { bbTurnUpdate(); }   // refresh the shot counter for the current player
    recShot(); if (St.ghost && !St.ghost.playing) { St.ghost.playing = true; St.ghost.t = 0; }
    if (document.getElementById('pg-howto')) dismissHowTo();   // they figured it out
  }
  function aimDir() { return { x: Math.sin(St.aimYaw), z: Math.cos(St.aimYaw) }; }
  function bestStore() { try { return JSON.parse(localStorage.getItem('pg_best') || '{}'); } catch (e) { return {}; } }
  function holeKey() { return St.hi >= 0 ? ('h' + St.hi) : ('c:' + (St.customName || (St.hole && St.hole.name) || '?')); }
  function holeSunk() {
    St.state = 'sunk'; sfx('sink');
    St.scores[St.hi] = St.strokes; St.parDone = (St.parDone || 0) + St.hole.par; var over = St.strokes - St.hole.par;
    var word = St.strokes === 1 ? 'HOLE IN ONE!' : over <= -2 ? 'EAGLE!' : over === -1 ? 'BIRDIE!' : over === 0 ? 'PAR' : over === 1 ? 'BOGEY' : '+' + over;
    // personal-best per hole (persists across sessions/builds) — not while testing a draft
    if (!St.testing && !St.teamBall && !St.bestBall) { var bk = holeKey(), bs = bestStore(); St.newBest = (bs[bk] == null || St.strokes < bs[bk]); if (St.newBest) { bs[bk] = St.strokes; try { localStorage.setItem('pg_best', JSON.stringify(bs)); } catch (e) { } } St.holeBest = bs[bk]; if (St.newBest && St.strokes !== 1 && over > -2) word = word + ' · BEST'; }
    St.banner = word; St.bannerT = 3.2;
    var great = (over <= -1) || St.strokes === 1, cx = St.hole.cup.x, cz = St.hole.cup.z, gy = St.hole.terrain(cx, cz);
    St.shake = great ? 22 : (over <= 0 ? 14 : 9);
    sparkBurst(cx, cz, great ? 60 : over === 0 ? 38 : 22);
    spawnShock(cx, gy, cz, COL.gold, great ? 320 : 210, 0.62); spawnShock(cx, gy, cz, '#fff0c8', great ? 210 : 140, 0.5);   // celebratory cup rings
    if (great) {   // colourful confetti fountain for birdie-or-better
      var cols = ['#f5c542', '#df3b32', '#3aa0ff', '#86d85f', '#c45cff', '#ff8a2a', '#ffffff'];
      for (var k = 0; k < 70; k++) { var a = Math.random() * TAU, sp = 120 + Math.random() * 360; St.fx.push({ x: cx, y: gy + 16, z: cz, vx: Math.cos(a) * sp, vy: 280 + Math.random() * 420, vz: Math.sin(a) * sp, life: 1.1 + Math.random() * 0.7, max: 1.8, col: cols[(Math.random() * cols.length) | 0], r: 3 + Math.random() * 3 }); }
    }
    if (St.bestBall) { setTimeout(bestBallNext, 1500); } else if (St.teamBall) { setTimeout(teamBallFinish, 1500); } else if (St.daily) { setTimeout(dailyFinish, 1500); } else { setTimeout(nextHole, 3000); }
  }
  function nextHole() { var base = St.setBase || 0; if (St.hi >= base + 8) { finishGame(); return; } loadHole(St.hi + 1); }
  function finishGame() { var base = St.setBase || 0, t = 0; for (var i = base; i < base + 9; i++) t += (St.scores[i] || 0); St.total = t; St.state = 'done'; St.banner = (SETS[base / 9] ? SETS[base / 9].name : 'NINE') + ' COMPLETE'; St.bannerT = 2.5; showScorecard(); }
  var SETS = [{ base: 0, name: 'FRONT 9', sub: '9 brand-new holes — the toughest run' }, { base: 9, name: 'MIDDLE 9', sub: 'the original desert gauntlet' }, { base: 18, name: 'BACK 9', sub: 'ice, moon, ghost town & the loops' }, { base: 27, name: 'WILD 9', sub: 'crazy multi-tier free-form greens' }];
  function chooseSet() {
    var old = document.getElementById('pg-chooser'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:58;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:rgba(6,4,2,.16);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-chooser';   // BLUR the game behind, not a dark veil — owner: "blur background not overlay"
    elt('div', 'font:900 clamp(30px,7vw,54px) Wantedo,Georgia;color:#ffffff;text-align:center;', 'CHOOSE YOUR NINE', ov);
    elt('div', 'font:600 15px Georgia;color:#ffffff;margin-top:-12px;', 'No hole over par 4 — pick a run and play through.', ov);
    var daily = elt('button', 'width:min(540px,92vw);padding:16px 20px;border:none;background:transparent;color:#f5efdc;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:14px;', null, ov);
    var dl = elt('div', 'text-align:left;', null, daily);
    elt('div', 'font:900 22px Wantedo,Georgia;color:#ffffff;', 'DAILY HOLE #' + dailyNum(), dl);
    elt('div', 'font:600 12px Georgia;color:#ffffff;', 'One shot at today’s hole. Beat the par, share your score, challenge your friends.', dl);
    var dsp = elt('div', 'font:800 11px Georgia;color:#ffffff;margin-top:3px;min-height:14px;', '', dl);   // live social proof so the daily feels alive BEFORE you commit
    (function () { var nt = NET(); if (!nt) return; nt.daySummary().then(function (s) { if (!dsp.parentNode) return; dsp.textContent = (s && s.players > 0) ? ('' + s.players + ' played today' + (s.best != null ? '  ·  best ' + s.best : '')) : 'Be the first to play today!'; }); })();
    (function () {   // loss-aversion: a streak that's on the line today is a strong reason to come back
      var sk; try { sk = JSON.parse(localStorage.getItem('pg_streak') || 'null'); } catch (e) { sk = null; }
      var todayK = new Date().toISOString().slice(0, 10);
      if (sk && sk.count > 1 && sk.last === prevDay(todayK)) elt('div', 'font:800 12px Georgia;color:#ffffff;margin-top:3px;', 'Your ' + sk.count + '-day streak is on the line — play today!', dl);
    })();
    elt('div', 'font:900 15px Wantedo,Georgia;color:#ffffff;white-space:nowrap;', 'PLAY ▶', daily);
    daily.onmouseenter = function () { daily.style.transform = 'translateY(-3px)'; }; daily.onmouseleave = function () { daily.style.transform = 'none'; };
    daily.onclick = function () { ov.remove(); enterDaily(null, null); };
    if (NET()) {
      var lnks = elt('div', 'display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-top:-8px;', null, ov);
      var arc = elt('button', 'background:transparent;border:none;color:#ffffff;font:700 12px Georgia;cursor:pointer;text-decoration:underline;', 'Missed a day? Play past holes', lnks); arc.onclick = function () { ov.remove(); enterPastDaily(1); };
      var champ = elt('button', 'background:transparent;border:none;color:#ffffff;font:700 12px Georgia;cursor:pointer;text-decoration:underline;', 'All-time champions', lnks); champ.onclick = function () { showChampions(); };
      var own = elt('button', 'background:transparent;border:none;color:#ffffff;font:700 12px Georgia;cursor:pointer;text-decoration:underline;', 'Owner Studio', lnks); own.title = 'Set & edit the daily hole (passcode)'; own.onclick = function () { location.href = 'owner.html'; };
    }
    var tb = elt('button', 'width:min(540px,92vw);padding:13px 20px;border:none;background:transparent;color:#f5efdc;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:14px;', null, ov);
    var tbl = elt('div', 'text-align:left;', null, tb);
    elt('div', 'font:900 17px Wantedo,Georgia;color:#ffffff;', 'PASS & PLAY', tbl);
    elt('div', 'font:600 11px Georgia;color:#ffffff;', 'Team Ball (alternate shot) or Best Ball — with friends on one device.', tbl);
    elt('div', 'font:900 14px Wantedo,Georgia;color:#ffffff;white-space:nowrap;', 'PLAY ▶', tb);
    tb.onclick = function () { ov.remove(); showTeamBallSetup(); };
    var row = elt('div', 'display:flex;gap:18px;flex-wrap:wrap;justify-content:center;max-width:760px;', null, ov);
    SETS.forEach(function (set) {
      var card = elt('button', 'width:210px;min-height:150px;padding:20px 16px;border:none;background:transparent;color:#f5efdc;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;', null, row);
      elt('div', 'font:900 30px Wantedo,Georgia;color:#ffffff;', set.name, card);
      elt('div', 'font:600 13px Georgia;color:#ffffff;line-height:1.4;', set.sub, card);
      elt('div', 'font:900 13px Wantedo,Georgia;color:#ffffff;margin-top:4px;', 'PLAY ▶', card);
      card.onmouseenter = function () { card.style.transform = 'translateY(-4px)'; }; card.onmouseleave = function () { card.style.transform = 'none'; };
      card.onclick = function () { ov.remove(); St.setBase = set.base; St.scores = []; St.parDone = 0; loadHole(set.base); };
    });
    return ov;
  }
  function showScorecard() {
    var old = document.getElementById('pg-scorecard'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:56;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-scorecard';
    var box = elt('div', 'width:430px;max-width:94%;max-height:88%;overflow:auto;background:transparent;border:none;padding:18px;', null, ov); box.className = 'edscroll';
    elt('div', 'font:900 22px Wantedo, Georgia;color:#ffffff;text-align:center;', '' + (SETS[(St.setBase || 0) / 9] ? SETS[(St.setBase || 0) / 9].name : 'NINE') + ' COMPLETE', box);
    var bs = bestStore(), totPar = 0, totYou = 0;
    var hdr = elt('div', 'display:flex;font:700 10px Georgia;color:#ffffff;opacity:.7;margin:8px 0 2px;padding:0 6px;', null, box);
    ['HOLE', 'PAR', 'YOU', 'BEST'].forEach(function (t, i) { elt('div', i === 0 ? 'flex:1;' : 'width:46px;text-align:right;', t, hdr); });
    var base = St.setBase || 0;
    for (var hidx = base; hidx < base + 9; hidx++) { var sc = St.scores[hidx]; if (sc == null) continue; var h = HOLES[hidx](), par = h.par; totPar += par; totYou += sc; var over = sc - par;
      var r = elt('div', 'display:flex;align-items:center;padding:5px 6px;margin:1px 0;font:13px Georgia;color:#f5efdc;', null, box);
      elt('div', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', (hidx - base + 1) + '. ' + h.name, r);
      elt('div', 'width:46px;text-align:right;opacity:.7;', String(par), r);
      var yc = over < 0 ? '#ffffff' : over === 0 ? '#f5efdc' : '#f5efdc'; elt('div', 'width:46px;text-align:right;font-weight:700;color:' + yc + ';', sc + (over === 0 ? '' : (over > 0 ? ' +' + over : ' ' + over)), r);
      elt('div', 'width:46px;text-align:right;color:#ffffff;', bs['h' + hidx] != null ? ('' + bs['h' + hidx]) : '–', r);
    }
    var tp = totYou - totPar, tpStr = tp > 0 ? '+' + tp : tp === 0 ? 'EVEN' : String(tp);
    var tr = elt('div', 'display:flex;align-items:center;padding:9px 6px;margin-top:6px;border-top:1px solid rgba(245,197,66,.22);font:900 15px Georgia;color:#ffffff;', null, box);
    elt('div', 'flex:1;', 'TOTAL', tr); elt('div', 'width:46px;text-align:right;opacity:.7;', String(totPar), tr); elt('div', 'width:92px;text-align:right;', totYou + ' (' + tpStr + ')', tr);
    var act = elt('div', 'display:flex;gap:8px;margin-top:14px;', null, box);
    var pa = elt('button', 'flex:1;padding:11px;background:transparent;border:none;color:#ffffff;font:900 15px Wantedo,Georgia;cursor:pointer;', '▶ CHANGE NINE', act); pa.onclick = function () { ov.remove(); chooseSet(); };
    var ls = elt('button', 'flex:1;padding:11px;background:transparent;border:none;color:#ffffff;font:900 15px Wantedo,Georgia;cursor:pointer;', 'LEVEL SELECT', act); ls.onclick = function () { ov.remove(); levelMenu(); };
  }
  // saved edits to the built-in campaign holes (persist across reloads) — keyed by hole index
  function overStore() { try { return JSON.parse(localStorage.getItem('pg_over') || '{}'); } catch (e) { return {}; } }
  function saveOver(i, ser) { var o = overStore(); o['' + i] = ser; try { localStorage.setItem('pg_over', JSON.stringify(o)); return true; } catch (e) { return false; } }
  function clearOver(i) { var o = overStore(); delete o['' + i]; try { localStorage.setItem('pg_over', JSON.stringify(o)); } catch (e) { } }
  function hasOver(i) { return overStore()['' + i] != null; }
  // the hole the campaign actually plays at index hi: a saved edit if one exists, else the pristine built-in
  function builtinHole(hi) { var ov = overStore()['' + hi]; if (ov) { try { var d = edDeserialize(ov); d.terrain = terrainFn(d.terrainFeatures, d.cup); if (d.par == null) d.par = HOLES[hi]().par; d._ov = hi; return d; } catch (e) { } } return HOLES[hi](); }
  function loadHole(hi) {
    var scd = document.getElementById('pg-scorecard'); if (scd) scd.remove();
    St.hi = hi;
    St.hole = builtinHole(hi); applyPhys(St.hole.phys); buildScene(St.hole); clearBallMeshes();
    var t = St.hole.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = St.hole.terrain(t.x, t.z) + K.R;
    St.strokes = 0; St.camOrbit = 0; St.fx = []; St.pops = []; St.trail = []; St.coins = 0; St.points = 0; St.customName = null; St.magnetT = 0; St.slowT = 0;
    St.holeBest = bestStore()['h' + hi]; St.newBest = false; St.testing = false;
    St.daily = false; St.rec = null; St.ghost = null; St.ghostStrokes = null; St.ghostName = null; St.leaderGhost = null; St.challenged = false; St.dailyPractice = false; St.archive = false; St.daySummary = null; St.courseRecord = null; St.teamBall = false; St.bestBall = false; tbClearTurn(); if (R3.ghostMesh) R3.ghostMesh.visible = false;
    var hy = Math.atan2(St.hole.cup.x - t.x, St.hole.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.power = 0.5; St.state = 'aim';
    St.banner = '#' + (hi + 1) + '  ' + St.hole.name; St.bannerT = 2.0;   // hole-intro flash
  }
  function playDraftInGame(d, banner, customName) {
    applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures, d.cup); rebuildBox(d);
    (d.coins || []).forEach(function (c) { c.got = false; }); (d.powerups || []).forEach(function (p) { p.got = false; }); (d.firerings || []).forEach(function (f) { f.passed = false; f.passedCd = 0; });
    St.hole = d; St.hole.par = d.par; St.customName = customName || null;
    var t = d.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = d.terrain(t.x, t.z) + K.R; buildScene(d); clearBallMeshes();
    St.strokes = 0; St.combo = 0; St.camOrbit = 0; St.fx = []; St.pops = []; St.trail = []; St.coins = 0; St.points = 0; St.magnetT = 0; St.slowT = 0;
    St.testing = false; St.newBest = false; St.holeBest = bestStore()['c:' + (customName || d.name)];
    var hy = Math.atan2(d.cup.x - t.x, d.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.power = 0.5; St.state = 'aim';
    St.banner = banner; St.bannerT = 2.0;
  }
  function loadCustomLevel(name) { var o = edStore()[name]; if (!o) return false; St.hi = -1; playDraftInGame(edDeserialize(o), name, name); return true; }
  function skipLevel() { if (St.state === 'load') return; var base = St.setBase || 0; loadHole(St.hi < 0 ? base : (St.hi + 1 > base + 8 ? base : St.hi + 1)); }
  function openEditorWith(d) { ED.draft = d; ED.undo = []; ED.redo = []; ED.sel = null; ED.on = true; edShow(true); }
  function editBuiltin(i) { var ov = overStore()['' + i], d = null; if (ov) { try { d = edDeserialize(ov); } catch (e) { } } if (!d) d = HOLES[i](); d.theme = d.theme || 'grass'; d.phys = d.phys || themePhys(d.theme || 'grass'); d.turf = d.turf != null ? d.turf : (THEMES[d.theme || 'grass'] || THEMES.grass).turf; d._ov = i; openEditorWith(d); }
  function editCustom(name) { var o = edStore()[name]; if (o) openEditorWith(edDeserialize(o)); }
  function levelMenu() {
    var ov = ED.dom.lvlmenu;
    if (!ov) { ov = elt('div', 'position:fixed;inset:0;z-index:55;display:none;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; }); ED.dom.lvlmenu = ov; }
    ov.innerHTML = ''; ov.style.display = 'flex';
    var box = elt('div', 'width:392px;max-height:85%;overflow:auto;background:transparent;border:none;padding:16px;', null, ov);
    elt('div', 'font:800 19px Wantedo,Georgia;color:#ffffff;margin-bottom:8px;', '◎ SELECT LEVEL', box);
    var sec = function (t) { elt('div', 'font:700 11px Georgia;color:#ffffff;margin:11px 0 4px;', t, box); };
    var rowBtn = function (label, sub, play, edit) {
      var r = elt('div', 'display:flex;gap:5px;align-items:stretch;margin:3px 0;', null, box);
      var pb = elt('button', 'flex:1;display:flex;justify-content:space-between;align-items:center;padding:9px 11px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 13px Georgia;cursor:pointer;text-align:left;', null, r);
      elt('span', '', label, pb); if (sub) elt('span', 'font-size:10px;opacity:.6;margin-left:8px;white-space:nowrap;', sub, pb);
      pb.onclick = function () { ov.style.display = 'none'; play(); };
      if (edit) { var eb = elt('button', 'padding:0 11px;background:#3a2614;color:#cba;font:700 13px Georgia;cursor:pointer;', 'EDIT', r); eb.title = 'Edit in level editor'; eb.onclick = function () { ov.style.display = 'none'; edit(); }; }
    };
    SETS.forEach(function (set) {
      sec(set.name);
      for (var j = 0; j < 9; j++) { (function (i) { var h = HOLES[i](); rowBtn((j + 1) + '.  ' + h.name, 'par ' + h.par, function () { St.setBase = set.base; loadHole(i); }, function () { editBuiltin(i); }); })(set.base + j);
      }
    });
    var store = edStore(), names = Object.keys(store).sort();
    sec('MY LEVELS' + (names.length ? '' : ' — none yet (build one in the editor)'));
    names.forEach(function (n) { var lv = store[n], cnt = ['bumpers', 'flippers', 'windmills', 'loops', 'coins', 'powerups', 'walls', 'enemies', 'firerings'].reduce(function (a, k) { return a + ((lv[k] || []).length); }, 0); rowBtn(n, (lv.theme || 'grass').split(' ')[0] + ' · ' + cnt, function () { loadCustomLevel(n); }, function () { editCustom(n); }); });
    var cl = elt('button', 'margin-top:12px;width:100%;padding:9px;background:#3a2614;color:#ffffff;font:700 12px Georgia;cursor:pointer;', 'Close', box); cl.onclick = function () { ov.style.display = 'none'; };
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
    if (kind === 'flipclick') {   // soft, short mechanical "tock" on flipper press
      var tk = AU.ctx.currentTime, ok = AU.ctx.createOscillator(), gk = AU.ctx.createGain(); ok.type = 'triangle'; ok.frequency.setValueAtTime(300, tk); ok.frequency.exponentialRampToValueAtTime(150, tk + 0.04); gk.gain.setValueAtTime(0.16, tk); gk.gain.exponentialRampToValueAtTime(0.001, tk + 0.05); ok.connect(gk); gk.connect(AU.sfxGain || AU.ctx.destination); ok.start(tk); ok.stop(tk + 0.06);
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
    var gy0 = St.hole.terrain(b.x, b.z), camY = gy0 + (b.y - gy0) * 0.45;   // follow the ball up only partway: keeps the horizon grounded so a high shot never reveals the world's edge
    R3.cam.position.set(b.x - f.x * dist + jx, camY + ht, b.z - f.z * dist + jz);
    R3.cam.lookAt(b.x + f.x * 230, camY + 14, b.z + f.z * 230);
    var ff = clamp(hyp(b.vx, b.vz) / 4200, 0, 1), tf = 58 + ff * 14; R3.cam.fov += (tf - R3.cam.fov) * 0.1; R3.cam.updateProjectionMatrix();
    if (R3.sun) { R3.sun.position.set(b.x + R3.sunOff.x, R3.sunOff.y, b.z + R3.sunOff.z); R3.sun.target.position.set(b.x, b.y, b.z); R3.sun.target.updateMatrixWorld(); }
  }
  var _projV = null;
  function project(x, y, z) { if (!_projV) _projV = new T.Vector3(); var v = _projV.set(x, y, z).project(R3.cam); return { x: (v.x * .5 + .5) * St.w, y: (-v.y * .5 + .5) * St.h, vis: v.z < 1 }; }   // reuse scratch vector (called ~145x/frame during aim — don't allocate a Vector3 each time)
  function projInto(out, x, y, z) { if (!_projV) _projV = new T.Vector3(); var v = _projV.set(x, y, z).project(R3.cam); out.x = (v.x * .5 + .5) * St.w; out.y = (-v.y * .5 + .5) * St.h; out.vis = v.z < 1; return out; }   // allocation-free projection into a reused object
  var _sBS = { x: 0, y: 0, vis: false }, _sLP = { x: 0, y: 0, vis: false }, _sPE = { x: 0, y: 0, vis: false }, _sPP = { x: 0, y: 0, vis: false };   // drawAim scratch — no per-frame allocation

  /* ================================================================ sync + HUD */
  function segCross(ax, az, bx, bz, cx, cz, dx, dz) {   // 2D segment AB × CD -> t along AB, or -1
    var rX = bx - ax, rZ = bz - az, sX = dx - cx, sZ = dz - cz, den = rX * sZ - rZ * sX;
    if (Math.abs(den) < 1e-9) return -1;
    var t = ((cx - ax) * sZ - (cz - az) * sX) / den, u = ((cx - ax) * rZ - (cz - az) * rX) / den;
    return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : -1;
  }
  function xrayWalls(hole) {   // any wall standing between the camera and the ball goes see-through so the ball is NEVER hidden
    var pb = primeBall(); if (!pb || !R3.cam) { St.ballHidden = 0; return; }
    var cx = R3.cam.position.x, cy = R3.cam.position.y, cz = R3.cam.position.z, maxF = 0;
    for (var wi = 0; wi < hole.walls.length; wi++) {
      var s = hole.walls[wi], m3 = s._m3; if (!m3) continue;
      var blocking = false, t = segCross(cx, cz, pb.x, pb.z, s.ax, s.az, s.bx, s.bz);
      if (t > 0.02 && t < 0.985) { var losY = cy + (pb.y - cy) * t; blocking = losY < m3.gy + s.h + 14; }
      m3.fade += ((blocking ? 1 : 0) - m3.fade) * 0.3; if (!blocking && m3.fade < 0.015) m3.fade = 0;
      if (m3.fade > maxF) maxF = m3.fade;
      var tr = m3.fade > 0.01, op = 1 - m3.fade * 0.9;   // a blocking wall goes nearly clear (~10%) so you always see the ball + what you're doing
      for (var mi2 = 0; mi2 < m3.mats.length; mi2++) { var mm2 = m3.mats[mi2]; if (mm2.transparent !== tr) mm2.transparent = tr; mm2.opacity = op; }
    }
    St.ballHidden = maxF;   // drives the always-on-top ball locator
  }
  function syncMeshes() {
    ensureBallMeshes(); var hole = St.hole;
    xrayWalls(hole);
    for (var i = 0; i < St.balls.length; i++) { var b = St.balls[i], m = R3.ballMeshes[i], sh = R3.bsh[i], bb = R3.shieldMeshes ? R3.shieldMeshes[i] : null; if (!m) continue; if (b.sunk || b.dead) { m.visible = false; sh.visible = false; if (bb) bb.visible = false; continue; } m.visible = true; sh.visible = true; m.position.set(b.x, b.y, b.z); if (R3.cupDimple && !b.air) { var cdp = R3.cupDimple, dd2 = hyp(b.x - cdp.x, b.z - cdp.z); if (dd2 < cdp.R) m.position.y = b.y - cdp.d * (1 - (dd2 / cdp.R) * (dd2 / cdp.R)); } var sp = hyp(b.vx, b.vz); if (sp > 6) { var ax = new T.Vector3(b.vz, 0, -b.vx).normalize(); m.rotateOnWorldAxis(ax, sp / K.R * .018); } var gh = hole.terrain(b.x, b.z); sh.position.set(b.x, gh + 2, b.z); sh.material.opacity = clamp(.34 - (b.y - gh) / 600, 0, .34); if (bb) { if (b.shield) { bb.visible = true; var pul = 0.5 + 0.5 * Math.sin(St.t * 6); bb.position.set(b.x, b.y, b.z); var bsc = 1 + pul * 0.16; bb.scale.set(bsc, bsc, bsc); bb.material.opacity = 0.28 + pul * 0.26; } else bb.visible = false; } }
    for (i = St.balls.length; i < R3.ballMeshes.length; i++) { if (R3.ballMeshes[i]) { R3.ballMeshes[i].visible = false; R3.bsh[i].visible = false; if (R3.shieldMeshes && R3.shieldMeshes[i]) R3.shieldMeshes[i].visible = false; } }
    // ball locator glow — appears (and brightens) when a wall is hiding the ball, so its position is always clear
    var pbL = primeBall();
    if (R3.ballLocator) {
      if (pbL && !pbL.sunk && !pbL.dead && (St.ballHidden || 0) > 0.04) { R3.ballLocator.visible = true; R3.ballLocator.position.set(pbL.x, pbL.y, pbL.z); R3.ballLocator.material.opacity = Math.min(0.85, (St.ballHidden || 0) * 0.95); }
      else { R3.ballLocator.visible = false; }
    }
    syncGhost();
    var bigFl = 0, bigBm = null;
    for (i = 0; i < hole.bumpers.length; i++) {
      var bm = hole.bumpers[i]; if (!bm.mesh) continue;
      var fl = Math.max(0, bm.flash || 0), fn = fl / 0.25;   // 1 at impact -> 0
      var idle = 0.4 + 0.3 * Math.sin(St.t * 2.2 + (bm.idleSeed || 0));   // bulbs breathe even at rest
      var s2 = 1 + fn * 0.55; bm.mesh.scale.set(s2, 1, s2);
      if (bm.coreM) bm.coreM.emissiveIntensity = idle + fn * 5.5;
      if (bm.btnM) bm.btnM.emissiveIntensity = 0.35 + idle * 0.5 + fn * 4;
      if (bm.halo) bm.halo.material.opacity = fn * 0.8;
      if (bm.glow) bm.glow.material.opacity = idle * 0.035 + fn * 0.85;
      if (bm.ring) bm.ring.position.y = bm.ringY0 - fn * 17;   // chrome ring SLAMS down on the coil like the real machine
      if (fn > bigFl) { bigFl = fn; bigBm = bm; }
    }
    if (R3.bumpLight) { if (bigBm && bigFl > 0.02) { R3.bumpLight.position.set(bigBm.x, hole.terrain(bigBm.x, bigBm.z) + 70, bigBm.z); R3.bumpLight.intensity = bigFl * 9; } else R3.bumpLight.intensity = 0; }
    for (i = 0; i < hole.flippers.length; i++) if (hole.flippers[i].mesh) hole.flippers[i].mesh.rotation.y = -hole.flippers[i].ang;
    for (i = 0; i < hole.windmills.length; i++) { var wmm = hole.windmills[i]; if (wmm.mesh) wmm.mesh.rotation.z = wmm.ang; if (wmm.flash > 0) wmm.flash -= 0.04; }
    var gts3 = hole.gates || []; for (i = 0; i < gts3.length; i++) { var gam = gts3[i]; if (gam.plankMesh) { gam.plankMesh.position.x = (gam.slide || 0) + (gam.bl || 0) / 2; if (gam.plankMesh.material) gam.plankMesh.material.emissive && gam.plankMesh.material.emissive.setRGB(gam.flash > 0 ? 0.4 : 0, gam.flash > 0 ? 0.15 : 0, 0); } }
    var cvs3 = hole.conveyors || []; for (i = 0; i < cvs3.length; i++) { var cvm = cvs3[i]; if (cvm.arrows && cvm.arrows.length) { cvm._sc = ((cvm._sc || 0) + cvm.spacing * 0.06) % cvm.spacing; for (var ci = 0; ci < cvm.arrows.length; ci++) { var p = (((ci + 0.5) * cvm.spacing + cvm._sc) % cvm.len + cvm.len) % cvm.len; cvm.arrows[ci].position.x = p - cvm.len / 2; } } }   // scroll the chevrons along the belt
    var pds3 = hole.pendulums || []; for (i = 0; i < pds3.length; i++) { var pdm = pds3[i]; if (pdm.pivot) { pdm.pivot.rotation.z = pdm.ang; if (pdm.bobMesh && pdm.bobMesh.material && pdm.bobMesh.material.emissive) pdm.bobMesh.material.emissive.setRGB(pdm.flash > 0 ? 0.5 : 0, 0, 0); } }   // swing the pendulum
    var tts3 = hole.turntables || []; for (i = 0; i < tts3.length; i++) { if (tts3[i].mesh) tts3[i].mesh.rotation.y = tts3[i].ang; }   // spin the turntable
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
    for (i = 0; i < (hole.enemies || []).length; i++) { var en = hole.enemies[i]; if (en.mesh) { en.mesh.position.set(en.cx, hole.terrain(en.cx, en.cz), en.cz); if (en.billboard && R3.cam) en.mesh.rotation.y = Math.atan2(R3.cam.position.x - en.cx, R3.cam.position.z - en.cz); else en.mesh.rotation.y = St.t * 2.4; if (en.bb) en.bb.position.y = en.bb.geometry.parameters.height * 0.5 + Math.sin(St.t * 3 + en.cx * 0.01) * (en.r * 0.12); var ws = en.flash > 0 ? 1 + en.flash : 1; en.mesh.scale.set(ws, ws, ws); if (en.flash > 0) en.flash -= 0.04; } }
    for (i = 0; i < (hole.portals || []).length; i++) { var po = hole.portals[i]; if (po.flash > 0) po.flash -= 0.04; }
    if (R3.flag && R3.flagWave) {   // cloth simulation: ripples travel outward, pole edge pinned
      R3.flag.rotation.y = Math.sin(St.t * 0.7) * 0.35 + 0.2;
      var fw = R3.flagWave, fp = fw.geo.attributes.position, fb = fw.base;
      for (var fi = 0; fi < fp.count; fi++) {
        var fxr = Math.max(0, fb[fi * 3] - 3) / fw.L;
        fp.setZ(fi, Math.sin(St.t * 7.5 - fxr * 6) * 8.5 * fxr * fxr + Math.sin(St.t * 13 - fxr * 9) * 2 * fxr);
        fp.setY(fi, fb[fi * 3 + 1] + Math.sin(St.t * 5 - fxr * 4) * 2.4 * fxr);
      }
      fp.needsUpdate = true; fw.geo.computeVertexNormals();
    }
    if (R3.portalSwirls) for (i = 0; i < R3.portalSwirls.length; i++) { var psw = R3.portalSwirls[i]; psw.m.rotation.z = St.t * psw.sp * psw.dir; }
    if (R3.dust) { var dp2 = R3.dust.geometry.attributes.position, db2 = R3.dust.userData.base; for (i = 0; i < dp2.count; i++) { var ph3 = i * 1.71; dp2.setX(i, db2[i * 3] + Math.sin(St.t * 0.31 + ph3) * 40); dp2.setY(i, db2[i * 3 + 1] + Math.sin(St.t * 0.47 + ph3 * 1.3) * 24); dp2.setZ(i, db2[i * 3 + 2] + Math.cos(St.t * 0.26 + ph3) * 40); } dp2.needsUpdate = true; }
    if (R3.cupGlow) { var pu = 0.5 + 0.5 * Math.sin(St.t * 2.3); R3.cupGlow.scale.set(1 + pu * 0.55, 1 + pu * 0.55, 1); R3.cupGlow.material.opacity = 0.2 + pu * 0.34; }
  }
  function rrect(c, a, b, w, h, r) { c.beginPath(); c.moveTo(a + r, b); c.arcTo(a + w, b, a + w, b + h, r); c.arcTo(a + w, b + h, a, b + h, r); c.arcTo(a, b + h, a, b, r); c.arcTo(a, b, a + w, b, r); c.closePath(); }
  // AAA type straight on the glass — big Wantedo with a heavy ink outline, no boxes, no pills
  function hudTxt(c, txt, x, y, size, col, align) { c.textAlign = align || 'left'; c.shadowBlur = 0; c.shadowColor = 'transparent'; c.font = '900 ' + Math.round(size * 1.5) + 'px Wantedo, Georgia'; c.fillStyle = col; c.fillText(txt, x, y); return c.measureText(txt).width; }   // plain fill — no stroke, no shadow
  function drawHUD() {
    var c = St.hctx, w = St.w, h = St.h; c.setTransform(St.dpr, 0, 0, St.dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (St.state === 'load') return;
    syncMeshes(); placeCam(); renderGL();
    var i, b = primeBall();
    if (St.trail.length > 1) { c.lineCap = 'round'; for (i = 1; i < St.trail.length; i++) { var ta = project(St.trail[i - 1].x, St.trail[i - 1].y, St.trail[i - 1].z), tb = project(St.trail[i].x, St.trail[i].y, St.trail[i].z); if (!ta.vis || !tb.vis) continue; var al = i / St.trail.length; c.strokeStyle = 'rgba(255,240,180,' + (al * .5).toFixed(2) + ')'; c.lineWidth = al * 11; c.beginPath(); c.moveTo(ta.x, ta.y); c.lineTo(tb.x, tb.y); c.stroke(); } }
    if (St.magnetT > 0 && b) drawMagnetPull(c, b);
    if (St.shocks) for (i = 0; i < St.shocks.length; i++) { var sw = St.shocks[i], sf = sw.t / sw.max, wr = 14 + sf * (sw.rmax || 165), ccs = project(sw.x, sw.y, sw.z), exs = project(sw.x + wr, sw.y, sw.z), ezs = project(sw.x, sw.y, sw.z + wr); if (!ccs.vis) continue; var rx = hyp(exs.x - ccs.x, exs.y - ccs.y), rz = hyp(ezs.x - ccs.x, ezs.y - ccs.y); c.globalAlpha = clamp(1 - sf, 0, 1) * 0.65; c.strokeStyle = sw.col; c.lineWidth = 2 + (1 - sf) * 3; c.beginPath(); if (c.ellipse) c.ellipse(ccs.x, ccs.y, Math.max(rx, 1), Math.max(rz, 1), 0, 0, TAU); else c.arc(ccs.x, ccs.y, Math.max(rx, 1), 0, TAU); c.stroke(); } c.globalAlpha = 1;
    for (i = 0; i < St.fx.length; i++) { var p = St.fx[i], s = project(p.x, p.y, p.z); if (!s.vis) continue; c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.col || (p.gold ? COL.gold : '#fff0c0'); c.beginPath(); c.arc(s.x, s.y, p.r || (p.gold ? 4 : 2.4), 0, TAU); c.fill(); } c.globalAlpha = 1;
    c.textAlign = 'center'; for (i = 0; i < St.pops.length; i++) { var q = St.pops[i], qs = project(q.x, q.y, q.z); if (!qs.vis) continue; c.globalAlpha = clamp(q.life / q.max, 0, 1); c.font = '900 38px Wantedo, Georgia'; c.fillStyle = q.col; c.fillText(q.text, qs.x, qs.y); } c.globalAlpha = 1;
    if (St.state === 'aim' && b) drawAim(c, b);
    // HUD type — big Wantedo straight on screen, like a real cabinet
    var narrow = w < 720;
    var topLine = St.hi >= 0 ? ('HOLE ' + (St.hi - (St.setBase || 0) + 1) + '/9 · PAR ' + St.hole.par) : ('' + (St.customName || St.hole.name));
    hudTxt(c, topLine, 22, 36, narrow ? 15 : 19, '#ffffff');
    if (St.hi >= 0 && !narrow) hudTxt(c, St.hole.name, 22, 60, 15, 'rgba(255,255,255,.8)');
    var sy = narrow ? 92 : 124, ssz = narrow ? 34 : 40;
    var nw = hudTxt(c, String(St.strokes), 22, sy, ssz, COL.cream);
    hudTxt(c, St.strokes === 1 ? 'STROKE' : 'STROKES', 30 + nw, sy, Math.round(ssz * 0.42), '#ffffff');
    if (St.holeBest != null) hudTxt(c, 'BEST ' + St.holeBest, 22, sy + 26, 14, 'rgba(255,255,255,.85)');
    var dp = b ? Math.round(hyp(b.x - St.hole.cup.x, b.z - St.hole.cup.z)) : 0;
    hudTxt(c, 'TO PIN', w - 22, 26, 12, 'rgba(255,255,255,.85)', 'right');
    hudTxt(c, dp + ' YD', w - 22, narrow ? 56 : 68, narrow ? 15 : 26, COL.cream, 'right');
    var tot = St.scores.reduce(function (a, cv) { return a + (cv || 0); }, 0), tp = tot - (St.parDone || 0);
    if (!narrow && St.hi - (St.setBase || 0) > 0) hudTxt(c, 'THRU ' + (St.hi - (St.setBase || 0)) + ' · ' + tot + ' (' + (tp > 0 ? '+' + tp : tp === 0 ? 'E' : tp) + ')', w / 2, 34, 16, '#ffffff', 'center');
    if ((St.coins || 0) > 0 || (St.points || 0) > 0) { var cpz = 1 + (St.coinPulse || 0) * 0.55, cyy = sy + (St.holeBest != null ? 50 : 28); c.save(); c.translate(22, cyy); c.scale(cpz, cpz); hudTxt(c, '' + (St.coins || 0) + '   ' + (St.points || 0), 0, 0, 17, '#ffffff'); c.restore(); }
    // active power-up callouts — bare stroked type, no chips
    var badges = []; var pball = primeBall();
    if (St.magnetT > 0) badges.push(['MAGNET ' + St.magnetT.toFixed(1), '#ff6e99']);
    if (St.slowT > 0) badges.push(['SLOW-MO ' + St.slowT.toFixed(1), '#b08aff']);
    if (pball && pball.shield) badges.push(['SHIELD', '#55c6ff']);
    badges.forEach(function (bd, bi) { hudTxt(c, bd[0], w / 2, 64 + bi * 26, 17, bd[1], 'center'); });
    // bumper-combo meter — pulsing multiplier while the ball racks up hits this shot
    if (St.state === 'roll' && (St.combo || 0) >= 2) { var cpz = 1 + (St.comboPulse || 0) * 0.5; c.save(); c.translate(w / 2, h * 0.3); c.scale(cpz, cpz); c.textAlign = 'center'; c.globalAlpha = clamp(0.5 + (St.comboPulse || 0) * 1.1, 0, 1); var ctxt = 'COMBO ×' + St.combo; c.font = '900 ' + (narrow ? 38 : 52) + 'px Wantedo, Georgia'; c.fillStyle = St.combo >= 5 ? COL.red : '#ffffff'; c.fillText(ctxt, 0, 0); c.restore(); c.globalAlpha = 1; }
    c.textAlign = 'left';   // (build label moved to the owner menu — it was overlapping the bottom instruction)
    if (St.state === 'aim') powerMeter(c, w, h);
    if (St.bannerT > 0) { c.globalAlpha = clamp(St.bannerT, 0, 1); c.textAlign = 'center'; c.shadowBlur = 0; var bcap = narrow ? 50 : 62, bfs = bcap; c.font = '900 ' + bcap + 'px Wantedo, Georgia'; var btw = c.measureText(St.banner).width; if (btw > w - 36) bfs = Math.max(18, Math.floor(bcap * (w - 36) / btw)); c.font = '900 ' + bfs + 'px Wantedo, Georgia'; c.fillStyle = '#ffffff'; var by = Math.max(h * 0.26, 236); c.fillText(St.banner, w / 2, by); c.globalAlpha = 1; }   // hole-intro flash — parked below the top HUD; plain fill, no stroke
    c.globalAlpha = 0.85;
    var instr = St.state === 'aim' ? (narrow ? 'PULL BACK · RELEASE TO FIRE' : 'PULL BACK TO AIM · RELEASE TO FIRE · ◀ ▶ CAMERA')
      : St.state === 'roll' ? (narrow ? 'TAP L / R FOR FLIPPERS' : 'TAP SCREEN OR A / D FOR FLIPPERS · ◀ ▶ CAMERA') : '';
    if (instr) { var isz = narrow ? 11 : 14; c.font = '900 ' + Math.round(isz * 1.5) + 'px Wantedo, Georgia'; var iw = c.measureText(instr).width; if (iw > w - 24) isz = isz * (w - 24) / iw; hudTxt(c, instr, w / 2, h - 14, isz, COL.cream, 'center'); }   // auto-fit so it never overflows the screen
    c.globalAlpha = 1;
  }
  // simulate the shot forward (gravity, terrain, roll friction, wall bounces) so the aim guide shows the real path + bank shots
  var _predPool = [];   // reused point pool — predictPath runs every frame during a drag, so it must NOT allocate (garbage → GC stalls = the "buffering/stuck" hitch)
  function predictPath(b, power) {
    var f = aimDir(), v = lerp(K.shotMin, K.shotMax, power * power), hole = St.hole, bn = hole.bounds, pts = _predPool;
    var x = b.x, z = b.z, y = b.y, vx = f.x * v, vz = f.z * v, vy = 0, dt = 1 / 90, bounces = 0, walls = hole.walls, R = K.R + K.wallHalf;
    var p0 = pts[0] || (pts[0] = { x: 0, y: 0, z: 0 }); p0.x = x; p0.y = y; p0.z = z; var n = 1;
    for (var step = 0; step < 110 && bounces < 4; step++) {
      vy -= K.g * dt; vx *= (1 - K.airDrag * dt); vz *= (1 - K.airDrag * dt);
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (x < bn.minX + 12) { x = bn.minX + 12; vx = Math.abs(vx) * .5; bounces++; }
      else if (x > bn.maxX - 12) { x = bn.maxX - 12; vx = -Math.abs(vx) * .5; bounces++; }
      if (z < bn.minZ + 12) { z = bn.minZ + 12; vz = Math.abs(vz) * .5; bounces++; }
      else if (z > bn.maxZ - 12) { z = bn.maxZ - 12; vz = -Math.abs(vz) * .5; bounces++; }
      var gh = hole.terrain(x, z), surf = gh + K.R;
      if (y <= surf) { y = surf; if (vy < 0) vy = 0; var sp = Math.sqrt(vx * vx + vz * vz); if (sp > 0) { var ns = Math.max(0, sp - K.rollFric * dt), kf = ns / sp; vx *= kf; vz *= kf; } }
      for (var wi = 0; wi < walls.length; wi++) { var s = walls[wi]; if (y > gh + s.h - 4) continue; if (s._hl !== undefined) { var _bx = x - s._mx, _bz = z - s._mz; if (_bx * _bx + _bz * _bz > s._hl * s._hl) continue; }   // broad-phase cull
        var sdx = s.bx - s.ax, sdz = s.bz - s.az, l2 = sdx * sdx + sdz * sdz, tt = l2 ? clamp(((x - s.ax) * sdx + (z - s.az) * sdz) / l2, 0, 1) : 0, ccx = s.ax + sdx * tt, ccz = s.az + sdz * tt;   // inlined nearestOnSeg — no allocation
        var dx = x - ccx, dz = z - ccz, dd = Math.sqrt(dx * dx + dz * dz); if (dd < R) { var nx = dd > 1e-4 ? dx / dd : 0, nz = dd > 1e-4 ? dz / dd : -1; x = ccx + nx * R; z = ccz + nz * R; var vn = vx * nx + vz * nz; if (vn < 0) { var e = (s.e == null ? K.wallE : s.e); vx -= (1 + e) * vn * nx; vz -= (1 + e) * vn * nz; bounces++; } } }
      var pp = pts[n] || (pts[n] = { x: 0, y: 0, z: 0 }); pp.x = x; pp.y = y; pp.z = z; n++;
      if (Math.sqrt(vx * vx + vz * vz) < 45 && y <= surf + 1) break;
    }
    pts._n = n; return pts;   // pts._n = valid point count (the pool array itself is reused, never truncated)
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
    var bs = projInto(_sBS, b.x, b.y, b.z); if (!bs.vis) return;
    // while ACTIVELY dragging, recompute every frame so the trajectory tracks your finger smoothly (the wall-culling keeps it cheap ~2ms). Only when idle (just looking) do we throttle to ~12Hz to save the frame.
    var _now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var pts;
    if (St.drag) { pts = predictPath(b, St.power); St._aimPts = pts; St._aimMs = _now; }
    else if (St._aimPts && (_now - (St._aimMs || 0)) < 80) pts = St._aimPts;
    else { pts = predictPath(b, St.power); St._aimPts = pts; St._aimMs = _now; }
    var n = pts._n != null ? pts._n : pts.length;   // pooled array isn't truncated — use the valid count
    // faint connecting line
    c.globalAlpha = .5; c.lineWidth = 3; c.lineCap = 'round'; c.strokeStyle = 'rgba(255,240,200,.45)'; c.beginPath(); var started = false;
    for (var i = 0; i < n; i++) { var s = projInto(_sLP, pts[i].x, pts[i].y + 12, pts[i].z); if (!s.vis) { started = false; continue; } if (!started) { c.moveTo(s.x, s.y); started = true; } else c.lineTo(s.x, s.y); }
    c.stroke(); c.globalAlpha = 1;
    // dots along the path, green→gold→red, every few samples
    for (var j = 0; j < n; j += 3) { var sp2 = projInto(_sLP, pts[j].x, pts[j].y + 12, pts[j].z); if (!sp2.vis) continue; var tt = j / (n - 1 || 1); c.globalAlpha = .92; c.fillStyle = tt < .5 ? COL.grn : tt < .82 ? COL.gold : COL.red; c.beginPath(); c.arc(sp2.x, sp2.y, 2.6 + (1 - tt) * 2.6, 0, TAU); c.fill(); }
    // arrowhead at the end
    if (n > 2) { var pe = projInto(_sPE, pts[n - 1].x, pts[n - 1].y + 12, pts[n - 1].z), pp = projInto(_sPP, pts[n - 2].x, pts[n - 2].y + 12, pts[n - 2].z); if (pe.vis && pp.vis) { c.save(); c.translate(pe.x, pe.y); c.rotate(Math.atan2(pe.y - pp.y, pe.x - pp.x)); c.fillStyle = COL.red; c.beginPath(); c.moveTo(11, 0); c.lineTo(-7, -7); c.lineTo(-7, 7); c.closePath(); c.fill(); c.restore(); } }
    c.globalAlpha = 1;
    if (St.drag && St.drag.pull > 5) { c.strokeStyle = 'rgba(255,238,196,.6)'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(bs.x, bs.y); c.lineTo(St.drag.sx, St.drag.sy); c.stroke(); c.fillStyle = St.power > .8 ? COL.red : 'rgba(255,238,196,.92)'; c.beginPath(); c.arc(St.drag.sx, St.drag.sy, 9, 0, TAU); c.fill(); }
  }
  function powerMeter(c, w, h) {   // hard-edged powder-charge wedge: thin -> tall, solid fills, ink outline — no pills, no gradients
    var narrow = w < 720, bw = narrow ? Math.min(280, w - 32) : 280, bh = 26, x = w / 2 - bw / 2, yb = narrow ? h - 150 : h - 44, p = St.power;
    function wedgePath(f) { var xe = x + bw * f, he = 5 + (bh - 5) * f; c.beginPath(); c.moveTo(x, yb); c.lineTo(xe, yb); c.lineTo(xe, yb - he); c.lineTo(x, yb - 5); c.closePath(); }
    c.lineJoin = 'round';
    wedgePath(1); c.fillStyle = 'rgba(16,8,3,.55)'; c.fill();
    wedgePath(Math.max(0.02, p)); c.fillStyle = p > 0.8 ? COL.red : p > 0.45 ? COL.gold : COL.grn; c.fill();
    c.strokeStyle = 'rgba(16,8,3,.6)'; c.lineWidth = 2;
    [0.25, 0.5, 0.75].forEach(function (f) { var tx = x + bw * f, th = 5 + (bh - 5) * f; c.beginPath(); c.moveTo(tx, yb); c.lineTo(tx, yb - th); c.stroke(); });
    hudTxt(c, 'POWER ' + Math.round(p * 100) + '%', w / 2, yb - bh - 10, 17, p > 0.8 ? COL.red : COL.cream, 'center');
  }

  /* ================================================================ input */
  function ptr(e) { var r = St.scene.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) { e.preventDefault(); audioInit(); if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume(); musicStart(); if (ED.on) { edDown(ptr(e), e.shiftKey); return; } var p = ptr(e); St.ptr = St.ptr || {}; if (St.state === 'aim') { St.drag = { x0: p.x, y0: p.y, sx: p.x, sy: p.y, pull: 0, yaw0: St.camYaw, id: e.pointerId }; St.ptr[e.pointerId] = 'aim'; } else if (St.state === 'roll') { var side = p.x < St.w / 2 ? 'R' : 'L'; St.ptr[e.pointerId] = side; flipPress(side, true); } }
  function onMove(e) { if (ED.on) { ED.curS = ptr(e); if (ED.moving || ED.moving3d || ED.drawing || ED.erasing || ED.painting || ED.dragHandle || ED.camDrag) edMove(ED.curS); return; } if (!St.drag || (St.drag.id != null && e.pointerId !== St.drag.id)) return; var p = ptr(e); St.drag.sx = p.x; St.drag.sy = p.y; var dx = p.x - St.drag.x0, dy = p.y - St.drag.y0, len = Math.sqrt(dx * dx + dy * dy); St.drag.pull = len; if (len > 8) St.aimYaw = St.drag.yaw0 + Math.atan2(dx, dy); St.power = clamp(len / K.pullPx, 0.05, 1); }   // SLINGSHOT — only the pointer that STARTED the drag drives it (stray touches can't jam it)
  function onUp(e) { if (ED.on) { edUp(); return; } if (St.ptr) { var role = St.ptr[e.pointerId]; if (role === 'L' || role === 'R') { delete St.ptr[e.pointerId]; var any = false; for (var k in St.ptr) if (St.ptr[k] === role) any = true; flipPress(role, any); return; } delete St.ptr[e.pointerId]; } if (!St.drag) return; if (St.drag.id != null && e.pointerId !== St.drag.id) return; var pull = St.drag.pull; St.drag = null; if (pull >= 14) shoot(); }
  function onKey(down, e) {
    var k = e.code; if (ED.on || St.state === 'load') return;
    // A / D fire the flippers — available AT ANY TIME (they animate in every state; they bat the ball while it's rolling)
    if (k === 'KeyA') { flipPress('R', down); e.preventDefault(); return; }   // camera looks down +z, so the world-'R' flipper (at +x) is the paddle on the LEFT of the screen
    if (k === 'KeyD') { flipPress('L', down); e.preventDefault(); return; }
    // arrow keys drive the CAMERA only — left/right orbit, up/down zoom
    if (down) {
      if (k === 'ArrowLeft') { St.camOrbit -= 0.08; e.preventDefault(); }
      else if (k === 'ArrowRight') { St.camOrbit += 0.08; e.preventDefault(); }
      else if (k === 'ArrowUp') { R3.zoom = clamp(R3.zoom * 0.94, 0.55, 1.8); e.preventDefault(); }
      else if (k === 'ArrowDown') { R3.zoom = clamp(R3.zoom * 1.06, 0.55, 1.8); e.preventDefault(); }
    }
  }

  /* ================================================================ LEVEL EDITOR */
  var ED = { on: false, brush: 'draw', sel: null, scale: 1, ox: 0, oz: 0, moving: false, seg: null, poly: null, drawing: null, erasing: false, painting: false, lastPaint: null, dragHandle: null, size: 240, smoothAmt: 2, dom: {}, curS: null, flash: null, undo: [], redo: [], snap: 20, snapOn: true, view3d: false, orb: { yaw: -0.5, pitch: 0.62, dist: 1.35 }, camDrag: null, palOpen: true, panelOpen: true };
  function edEnter3D() { var d = ED.draft; applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures, d.cup); rebuildBox(d); (d.coins || []).forEach(function (c) { c.got = false; }); (d.powerups || []).forEach(function (p) { p.got = false; }); St.hole = d; St.hole.par = d.par; var t = d.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = d.terrain(t.x, t.z) + K.R; buildScene(d); clearBallMeshes(); ED.view3d = true; St.magnetT = 0; St.slowT = 0; }
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
        c.fillStyle = '#ffffff'; c.fillText(nm, pr.x, pr.y - 32);
      }
    }
    var hint = ED.sel ? '3D EDIT — drag the selected item to move · tap empty space to orbit · for 2D' : '3D EDIT — tap an item to select & edit · drag empty space to orbit · scroll zoom · for 2D';
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
  var ED_TOOLS = [['select', 'Select / Move'], ['draw', 'DRAW LEVEL SHAPE'], ['erase', 'Eraser (drag)'], ['tee', 'Tee'], ['cup', 'Cup'], ['wall', 'Wall click pts · Shift 45°'], ['shape', 'Shape (click corners)'], ['island', 'Island (drag a loop)'], ['bumper', 'Bumper'], ['booster', 'Booster'], ['flipL', 'Flipper L'], ['flipR', 'Flipper R'], ['windmill', 'Windmill'], ['loop', 'Loop-de-loop'], ['warp', 'Drop hole '], ['portal', 'Portal (teleport)'], ['firering', 'Fire Hoop '], ['enemy', 'Enemy '], ['coin', 'Coin '], ['powerup', 'Power-up '], ['laser', 'Laser (2 clicks)'], ['gate', 'Sliding Gate (2 clicks)'], ['conveyor', 'Conveyor Belt ⇒'], ['pendulum', 'Pendulum '], ['turntable', 'Turntable ⟳'], ['hill', 'Hill / Bank'], ['funnel', 'Funnel'], ['ramp', 'Ramp'], ['tier', 'Tier / Step ⤓'], ['raise', '⤒ Paint terrain UP'], ['lower', '⤓ Paint terrain DOWN']];
  var ED_PARAMS = { bumper: [['r', 'radius', 20, 90, 2], ['kick', 'bounce power', 600, 3200, 50]], booster: [['ang', 'angle', -3.14, 3.14, 0.05], ['spd', 'speed', 1200, 6000, 100], ['r', 'radius', 60, 260, 10]], flipper: [['len', 'length', 90, 220, 5], ['rot', 'rotation', -3.14, 3.14, 0.1], ['speed', 'paddle speed', 0.3, 3, 0.1], ['power', 'flip power', 800, 4000, 100]], windmill: [['r', 'radius', 90, 360, 10], ['n', 'blades', 2, 8, 1], ['speed', 'spin', -3, 3, 0.1]], laser: [['period', 'period', 0.8, 5, 0.1], ['onFrac', 'on-frac', 0.1, 0.9, 0.05], ['phase', 'phase', 0, 2, 0.1]], gate: [['barFrac', 'bar size', 0.25, 0.75, 0.05], ['speed', 'slide speed', 0.3, 3, 0.1], ['h', 'height', 40, 160, 10]], conveyor: [['w', 'width', 120, 500, 20], ['len', 'length', 200, 900, 40], ['ang', 'direction', -3.14, 3.14, 0.1], ['force', 'strength', 1000, 5000, 200]], pendulum: [['len', 'arm length', 180, 520, 20], ['amp', 'swing', 0.4, 1.5, 0.05], ['speed', 'speed', 0.4, 3, 0.1], ['rb', 'ball size', 24, 80, 4]], turntable: [['r', 'radius', 100, 420, 20], ['spin', 'spin (± dir)', -4, 4, 0.2]], loop: [['r', 'radius', 80, 220, 10], ['ang', 'angle', -3.14, 3.14, 0.05]], warp: [['r', 'radius', 30, 90, 4]], portal: [['r', 'radius', 30, 80, 4]], firering: [['r', 'radius', 60, 200, 10], ['h', 'height off ground', 60, 320, 10], ['points', 'points', 10, 500, 10]], enemy: [['type', 'type', 'select', ['spiky', 'blob', 'ghost']], ['behavior', 'behavior', 'select', ['patrol', 'chase', 'static']], ['effect', 'on hit', 'select', ['knockback', 'reset', 'stun']], ['r', 'size', 24, 90, 4], ['speed', 'speed', 0.2, 2.5, 0.1]], coin: [['value', 'coin value', 1, 20, 1]], powerup: [['kind', 'effect', 'select', ['magnet', 'shield', 'slow', 'gem', 'jump']]], wall: [['e', 'bounce', 0, 1, 0.05], ['h', 'height', 20, 240, 4]], hill: [['rad', 'radius', 120, 800, 20], ['h', 'height', -300, 300, 10]], funnel: [['rad', 'radius', 120, 900, 20], ['depth', 'depth', 40, 400, 10]], ramp: [['z0', 'start-z', -40, 3200, 20], ['z1', 'end-z', -40, 3200, 20], ['h', 'height', 40, 260, 10]], tier: [['h', 'step height (− lower)', -320, 320, 10]] };
  var ED_INFO = { bumper: { n: 'BUMPER', a: 'Kicks the ball away and builds a combo. Higher bounce power = bigger launch.' }, booster: { n: 'BOOSTER', a: 'Flings the ball in a fixed direction at a set speed. Place one before a loop or jump.' }, flipper: { n: 'FLIPPER', a: 'Tap your side of the screen while rolling to flip. ROTATE it to aim any way (even horizontal levels), set paddle SPEED and flip POWER.' }, windmill: { n: 'WINDMILL', a: 'Spinning blades swat the ball. More blades or faster spin = harder to pass.' }, loop: { n: 'LOOP-DE-LOOP', a: 'Ball rides up and over a vertical loop, exits boosted. Needs speed to enter.' }, warp: { n: 'DROP HOLE ', a: 'Roll the ball in and it falls out the linked GREEN exit — drag the green ring to a lower tier to build two-level holes.' }, warpExit: { n: 'DROP EXIT', a: 'Where the drop hole spits the ball out. Drag it onto the lower tier / cup area.' }, portal: { n: 'PORTAL', a: 'Teleports the ball, keeping its speed. Add 2+ exits and it pops out a RANDOM one each time — drag each exit anywhere, even other tiers.' }, portalExit: { n: 'PORTAL EXIT', a: 'One possible exit. With 2+ exits the ball comes out a random one. Drag it; use +add exit / −remove to change how many.' }, firering: { n: 'FIRE HOOP ', a: 'A vertical flaming ring up in the air — JUMP the ball through the opening (off a ramp, loop or booster) to score its points. Set its height + points.' }, enemy: { n: 'ENEMY ', a: 'Pick its TYPE (spiky/blob/ghost), BEHAVIOR (patrol / chase the ball / hold still) and EFFECT on hit: knockback (pings you away), reset (hard repel — knocks you back the way you came), or stun (brief freeze). None of them send you back to the start. Drag the red marker to set its patrol path.' }, enemyEnd: { n: 'ENEMY PATH END', a: 'The far end of the enemy patrol. Drag to set how far it roams.' }, coin: { n: 'COIN ', a: 'Roll over it to grab it — worth its value. Lay trails of coins for a Sonic-style rush.' }, powerup: { n: 'POWER-UP ', a: 'Roll over it to grab a beneficial effect. Pick the KIND: magnet (pulls you to the cup), shield (blocks the next hazard), slow-mo (bullet-time through gates), gem (bonus points), or jump (pops the ball up to hop walls).' }, tier: { n: 'TIER / STEP ⤓', a: 'Drops (negative height) or raises (positive) the whole green PAST this line — makes a lower or upper level. Drop a hole to fall onto it, or a ramp to climb back up. Drag to move the line.' }, laser: { n: 'LASER GATE', a: 'A TIMED GATE. You always see it (it flickers as it charges up); when the beam is ON it is a solid barrier that bounces the ball back. Time your run through the OFF window. period = cycle length, on-frac = how much of the cycle it is ON, phase = offset (stagger multiple lasers).' }, gate: { n: 'SLIDING GATE ⇄', a: 'A solid bar slides back and forth along the track, opening then closing a gap. Time your shot through the open side. bar size = how much of the track the bar fills (smaller = wider gap, easier); slide speed = how fast it moves; height blocks airborne balls.' }, conveyor: { n: 'CONVEYOR BELT ⇒', a: 'A moving strip that DRAGS the ball along its direction while it rolls across — a steady current, not a one-shot fling like the booster. Use it to sweep the ball off-line, carry it across a gap, or speed it up. Set width, length, direction and strength.' }, pendulum: { n: 'PENDULUM ', a: 'A wrecking ball on a swinging arm sweeps across the lane, dipping to the ground at the bottom of its arc and whacking any ball it hits. Time your pass for when the bob is up to one side. Set arm length, swing width, speed and ball size.' }, turntable: { n: 'TURNTABLE ⟳', a: 'A spinning disc that grabs the ball and whirls it around — it picks up tangential speed and spirals off the edge, flung in a new direction. Set the radius and the spin (sign sets the direction). Great for randomizing a shot or curving it around a corner.' }, wall: { n: 'WALL', a: 'A solid barrier. Bounce sets how lively it is; height blocks airborne balls.' }, hill: { n: 'HILL / BANK', a: 'Bumps the ground up (or down with negative height) so the ball rolls off the slope.' }, funnel: { n: 'FUNNEL', a: 'A bowl that draws the ball toward its center — a tricky approach to the cup.' }, ramp: { n: 'RAMP / JUMP', a: 'A raised plateau across the lane between start-z and end-z — launch the ball over a gap.' }, tee: { n: 'TEE (start)', a: 'Where the ball starts each shot. Drag to reposition.' }, cup: { n: 'CUP (hole)', a: 'Sink the ball here to finish the level. Cup size is in the Physics panel.' } };
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
    ['bumpers', 'boosters', 'flippers', 'windmills', 'lasers', 'gates', 'conveyors', 'pendulums', 'turntables', 'loops', 'warps', 'portals', 'firerings', 'enemies', 'coins', 'powerups'].forEach(function (k) { d[k] = []; });
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
    (d.gates || []).forEach(function (it, i) { L.push({ kind: 'gate', item: it, x: (it.ax + it.bx) / 2, z: (it.az + it.bz) / 2, arr: d.gates, idx: i }); });
    (d.conveyors || []).forEach(function (it, i) { L.push({ kind: 'conveyor', item: it, x: it.x, z: it.z, arr: d.conveyors, idx: i }); });
    (d.pendulums || []).forEach(function (it, i) { L.push({ kind: 'pendulum', item: it, x: it.x, z: it.z, arr: d.pendulums, idx: i }); });
    (d.turntables || []).forEach(function (it, i) { L.push({ kind: 'turntable', item: it, x: it.x, z: it.z, arr: d.turntables, idx: i }); });
    d.walls.forEach(function (it, i) { if (it._bnd) return; L.push({ kind: 'wall', item: it, x: (it.ax + it.bx) / 2, z: (it.az + it.bz) / 2, arr: d.walls, idx: i }); });
    d.terrainFeatures.forEach(function (it, i) { if (it.kind === 'slope') return; var z = it.z != null ? it.z : (it.z0 != null ? (it.z0 + (it.z1 || it.z0)) / 2 : 0); L.push({ kind: it.kind, item: it, x: it.x || 0, z: z, arr: d.terrainFeatures, idx: i }); });
    if (d.multiball) L.push({ kind: 'multiball', item: d.multiball, x: d.multiball.x, z: d.multiball.z });
    L.push({ kind: 'tee', item: d.tee, x: d.tee.x, z: d.tee.z }); L.push({ kind: 'cup', item: d.cup, x: d.cup.x, z: d.cup.z });
    return L;
  }
  function edHit(wx, wz) { var L = edItems(), best = null, bd = 1e9; for (var i = 0; i < L.length; i++) { var it = L[i], dd; if ((it.kind === 'wall' || it.kind === 'laser' || it.kind === 'gate') && it.item.ax != null) { var c = nearestOnSeg(wx, wz, it.item.ax, it.item.az, it.item.bx, it.item.bz); dd = hyp(wx - c.x, wz - c.z); } else dd = hyp(it.x - wx, it.z - wz); if (dd < bd) { bd = dd; best = it; } } return (best && bd < 34 / ED.scale) ? best : null; }
  // 3D editing: cast the click ray onto the level's ground plane to get a world (x,z), then pick the nearest item
  function ed3DToWorld(p) {
    if (!R3.cam) return null;
    var bn = ED.draft.bounds, cy = ED.draft.terrain ? ED.draft.terrain((bn.minX + bn.maxX) / 2, (bn.minZ + bn.maxZ) / 2) : 0;
    var ndcx = (p.x / St.w) * 2 - 1, ndcy = -(p.y / St.h) * 2 + 1;
    var ray = new T.Raycaster(); ray.setFromCamera({ x: ndcx, y: ndcy }, R3.cam);
    var plane = new T.Plane(new T.Vector3(0, 1, 0), -cy), pt = new T.Vector3();
    return ray.ray.intersectPlane(plane, pt) ? { x: pt.x, z: pt.z } : null;
  }
  function edHit3D(wx, wz) { var L = edItems(), best = null, bd = 1e9; for (var i = 0; i < L.length; i++) { var it = L[i], dd; if ((it.kind === 'wall' || it.kind === 'laser' || it.kind === 'gate') && it.item.ax != null) { var c = nearestOnSeg(wx, wz, it.item.ax, it.item.az, it.item.bx, it.item.bz); dd = hyp(wx - c.x, wz - c.z); } else dd = hyp(it.x - wx, it.z - wz); if (dd < bd) { bd = dd; best = it; } } return (best && bd < 120) ? best : null; }
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
  // rebuild the selected wall path from its ORIGINAL points: first SHARPEN (simplify, Douglas–Peucker), then ROUND (Chaikin). Both 0 = exact freehand.
  function applyPathShape() {
    if (!ED.sel || ED.sel.kind !== 'wallgroup' || !ED.sel.base) return;
    var d = ED.draft, base = ED.sel.base, closed = ED.sel.baseClosed, e = ED.sel.baseE, h = ED.sel.baseH;
    var simp = ED.sel.simplifyAmt || 0, level = ED.sel.smoothLevel || 0;
    ED.sel.items.forEach(function (g) { var idx = d.walls.indexOf(g); if (idx >= 0) d.walls.splice(idx, 1); });
    var pts = base.slice();
    if (simp > 0 && pts.length > 2) { pts = rdp(pts, simp * simp * 7); }
    if (level > 0 && pts.length > 1) { pts = closed ? chaikinClosed(pts, level) : chaikin(pts, level); }
    if (pts.length > 140) pts = simplifyPath(pts, 26);
    var newItems = [], i; for (i = 0; i < pts.length - 1; i++) { d.wall(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, { e: e, h: h }); newItems.push(last(d.walls)); }
    if (closed && pts.length > 2) { d.wall(pts[pts.length - 1].x, pts[pts.length - 1].z, pts[0].x, pts[0].z, { e: e, h: h }); newItems.push(last(d.walls)); }
    ED.sel.items = newItems; ED.sel.handles = computeHandles(newItems);
  }
  function selectWallGroupAt(wx, wz, shift) {
    var hit = edHit(wx, wz); if (!hit) { ED.sel = null; return; }
    if (hit.kind === 'wall' && !shift) { var grp = wallGroup(hit.item), oc = orderedChain(grp); ED.sel = { kind: 'wallgroup', items: grp, x: wx, z: wz, arr: ED.draft.walls, handles: computeHandles(grp), base: oc.pts, baseClosed: oc.closed, baseE: oc.e, baseH: oc.h, smoothLevel: 0, simplifyAmt: 0, snapped: false }; }
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
    else if (ED.brush === 'conveyor') { d.conveyor(wx, wz, 240, 480, Math.atan2(d.cup.z - wz, d.cup.x - wx), 2800); it = last(d.conveyors); }
    else if (ED.brush === 'pendulum') { d.pendulum(wx, wz, { len: 360, amp: 1.1, speed: 1.4, rb: 46 }); it = last(d.pendulums); }
    else if (ED.brush === 'turntable') { d.turntable(wx, wz, 200, 2.4); it = last(d.turntables); }
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
    for (var i = 0; i < L.length; i++) { var it = L[i]; if (!it.arr) continue; var dd; if ((it.kind === 'wall' || it.kind === 'laser' || it.kind === 'gate') && it.item.ax != null) { var c = nearestOnSeg(wx, wz, it.item.ax, it.item.az, it.item.bx, it.item.bz); dd = hyp(wx - c.x, wz - c.z); } else dd = hyp(it.x - wx, it.z - wz); if (dd < rad) del.push(it); }
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
    if (ED.brush === 'draw' || ED.brush === 'island') { edSnapshot(); var wr = edS2W(p.x, p.y); ED.drawing = [{ x: wr.x, z: wr.z }]; return; }
    if (ED.brush === 'erase') { edSnapshot(); ED.erasing = true; var we = edS2W(p.x, p.y); eraseAt(we.x, we.z); edPanel(); return; }
    if (ED.brush === 'raise' || ED.brush === 'lower') { edSnapshot(); ED.painting = true; ED.lastPaint = null; var wp2 = edS2W(p.x, p.y); paintAt(wp2.x, wp2.z, ED.brush === 'raise' ? 1 : -1); return; }
    var w = edS2W(p.x, p.y); w.x = edSnap(w.x); w.z = edSnap(w.z);
    if (ED.brush === 'wall' || ED.brush === 'laser' || ED.brush === 'gate') {
      if (!ED.seg) { ED.seg = { sx: w.x, sz: w.z }; }
      else {
        if (shift) { var aa = snapAngle(ED.seg.sx, ED.seg.sz, w.x, w.z); w.x = edSnap(aa.x); w.z = edSnap(aa.z); }
        if (hyp(w.x - ED.seg.sx, w.z - ED.seg.sz) < 16 / ED.scale) { ED.seg = null; ED.flash = { x: w.x, z: w.z, t: 0.2 }; return; }   // click the last point again to finish the line
        var d = ED.draft; edSnapshot();
        if (ED.brush === 'wall') { d.wall(ED.seg.sx, ED.seg.sz, w.x, w.z, { e: K.wallE, h: ED.draft.wallH || 80 }); selectWallGroupAt(w.x, w.z, false); edPanel(); ED.seg = { sx: w.x, sz: w.z }; }   // CHAIN: keep going — click again for a connected diagonal/straight segment
        else if (ED.brush === 'gate') { d.gate(ED.seg.sx, ED.seg.sz, w.x, w.z, { barFrac: 0.45, speed: 1.4, h: 74 }); ED.seg = null; }
        else { d.lasers.push({ ax: ED.seg.sx, az: ED.seg.sz, bx: w.x, bz: w.z, period: 2.2, onFrac: 0.45, phase: 0, on: false }); ED.seg = null; }
        ED.flash = { x: w.x, z: w.z, t: 0.35 };
      }
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
  function edClosePoly() { if (!ED.poly || ED.poly.length < 2) { ED.poly = null; return; } edSnapshot(); var d = ED.draft, p = ED.poly; for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; d.wall(a.x, a.z, b.x, b.z, { e: K.wallE, h: 80, curve: true }); } if (p.length >= 3) { d.noBox = true; d.shape = p.map(function (q) { return { x: q.x, z: q.z }; }); }   // organic green to the clicked outline
    selectWallGroupAt(p[0].x, p[0].z, false); ED.flash = { x: p[0].x, z: p[0].z, t: 0.35 }; ED.poly = null; edPanel(); }
  function edMove(p) {
    if (ED.view3d) {
      if (ED.moving3d && ED.sel) { var w3m = ed3DToWorld(p); if (w3m) { moveSelTo(edSnap(w3m.x), edSnap(w3m.z)); } return; }
      if (ED.camDrag) { ED.orb.yaw = ED.camDrag.yaw - (p.x - ED.camDrag.x) * 0.008; ED.orb.pitch = clamp(ED.camDrag.pitch + (p.y - ED.camDrag.y) * 0.006, 0.12, 1.45); } return;
    }
    if (ED.dragHandle) { var wh = edS2W(p.x, p.y); wh.x = edSnap(wh.x); wh.z = edSnap(wh.z); var v = ED.dragHandle.v; v.ends.forEach(function (en) { if (en.e === 'a') { en.w.ax = wh.x; en.w.az = wh.z; } else { en.w.bx = wh.x; en.w.bz = wh.z; } }); v.x = wh.x; v.z = wh.z; refreshHandlePositions(); return; }
    if ((ED.brush === 'draw' || ED.brush === 'island') && ED.drawing) { var wr = edS2W(p.x, p.y), lp = ED.drawing[ED.drawing.length - 1], ls = edW2S(lp.x, lp.z); if (hyp(p.x - ls.x, p.y - ls.y) > 10) ED.drawing.push({ x: wr.x, z: wr.z }); return; }
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
    else if (ED.sel.kind === 'wall' || ED.sel.kind === 'laser' || ED.sel.kind === 'gate') { var dx = wx - ED.sel.x, dz = wz - ED.sel.z; it.ax += dx; it.bx += dx; it.az += dz; it.bz += dz; ED.sel.x = wx; ED.sel.z = wz; }
    else { it.x = wx; it.z = wz; ED.sel.x = it.x; ED.sel.z = it.z; }
  }
  function edUp() { if (ED.moving3d) { ED.moving3d = false; edPanel(); return; } if (ED.camDrag) { ED.camDrag = null; return; } ED.moving = false; if (ED.dragHandle) { ED.dragHandle = null; edPanel(); } if (ED.erasing) { ED.erasing = false; edPanel(); } if (ED.painting) { ED.painting = false; edPanel(); } if (ED.brush === 'draw' && ED.drawing) edFinishDraw(); if (ED.brush === 'island' && ED.drawing) edFinishIsland(); }
  function simplifyPath(pts, minD) { if (pts.length < 4) return pts; var out = [pts[0]]; for (var i = 1; i < pts.length - 1; i++) { var l = out[out.length - 1]; if (hyp(pts[i].x - l.x, pts[i].z - l.z) >= minD) out.push(pts[i]); } out.push(pts[pts.length - 1]); return out; }
  function edFinishDraw() {
    var pts = ED.drawing; ED.drawing = null; if (!pts || pts.length < 2) { edPanel(); return; }
    pts = simplifyPath(pts, 42);
    var d = ED.draft, existing = d.walls.filter(function (w) { return !w._bnd; }).length, i;
    d.noBox = true; d.walls = d.walls.filter(function (w) { return !w._bnd; });
    // single-line wall following the exact path. Only close if the ends actually meet — never force it.
    var closed = pts.length > 3 && hyp(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 55;
    var sm = closed ? chaikinClosed(pts, 2) : chaikin(pts, 2);   // SMOOTH the hand-drawn path into rounded curbs (like the reference), not jagged segments
    if (closed) { for (i = 0; i < sm.length; i++) d.wall(sm[i].x, sm[i].z, sm[(i + 1) % sm.length].x, sm[(i + 1) % sm.length].z, { e: K.wallE, h: 80, curve: true }); d.shape = sm.map(function (p) { return { x: Math.round(p.x), z: Math.round(p.z) }; }); }   // CLOSED outline -> render the GREEN to this smooth organic shape, not a rectangle
    else { for (i = 0; i < sm.length - 1; i++) d.wall(sm[i].x, sm[i].z, sm[i + 1].x, sm[i + 1].z, { e: K.wallE, h: 80, curve: true }); }
    var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; pts.forEach(function (p) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z; });
    var mg = 110;
    if (existing === 0) { d.bounds = { minX: minx - mg, maxX: maxx + mg, minZ: minz - mg, maxZ: maxz + mg }; if (closed) { var cx = (minx + maxx) / 2; d.tee = { x: cx, z: minz + (maxz - minz) * 0.15 }; d.cup = { x: cx, z: minz + (maxz - minz) * 0.85 }; } else { d.tee = { x: Math.round(pts[0].x), z: Math.round(pts[0].z) }; d.cup = { x: Math.round(pts[pts.length - 1].x), z: Math.round(pts[pts.length - 1].z) }; } }
    else { d.bounds = { minX: Math.min(d.bounds.minX, minx - mg), maxX: Math.max(d.bounds.maxX, maxx + mg), minZ: Math.min(d.bounds.minZ, minz - mg), maxZ: Math.max(d.bounds.maxZ, maxz + mg) }; }
    ED.flash = { x: pts[0].x, z: pts[0].z, t: 0.35 }; edPanel();
  }
  // drag a loop → a SEPARATE FLOATING ISLAND (own green, curb walls). Draw several + connect with Drop holes / Portals / Tubes for a multi-island hole.
  function edFinishIsland() {
    var pts = ED.drawing; ED.drawing = null; if (!pts || pts.length < 3) { edPanel(); return; }
    pts = simplifyPath(pts, 42); if (pts.length < 3) { edPanel(); return; }
    var d = ED.draft, firstIsland = !(d.islands && d.islands.length);
    var poly = chaikinClosed(pts, 2).map(function (p) { return { x: Math.round(p.x), z: Math.round(p.z) }; });   // SMOOTH rounded island (like the reference), not a jagged polygon
    d.island(poly, 0, { h: 66 });   // adds d.islands entry + platform terrain + curb walls + noBox
    var cx = 0, cz = 0; poly.forEach(function (p) { cx += p.x; cz += p.z; }); cx = Math.round(cx / poly.length); cz = Math.round(cz / poly.length);
    if (firstIsland) d.tee = { x: cx, z: cz };   // start on the first island you draw
    d.cup = { x: cx, z: cz };                     // cup hops to the newest island (so tee=1st, cup=last)
    var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; poly.forEach(function (p) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z; });
    var mg = 170; d.bounds = { minX: Math.min(d.bounds.minX, minx - mg), maxX: Math.max(d.bounds.maxX, maxx + mg), minZ: Math.min(d.bounds.minZ, minz - mg), maxZ: Math.max(d.bounds.maxZ, maxz + mg) };
    ED.flash = { x: poly[0].x, z: poly[0].z, t: 0.35 }; edPanel();
  }
  function edDelete() { var s = ED.sel; if (!s || s.kind === 'tee' || s.kind === 'cup') return; edSnapshot(); if (s.kind === 'wallgroup') { var d = ED.draft; s.items.forEach(function (g) { var idx = d.walls.indexOf(g); if (idx >= 0) d.walls.splice(idx, 1); }); } else if (s.arr) s.arr.splice(s.idx, 1); ED.sel = null; edPanel(); }
  function edPlay() { var d = ED.draft; applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures, d.cup); rebuildBox(d); (d.coins || []).forEach(function (c) { c.got = false; }); (d.powerups || []).forEach(function (p) { p.got = false; }); (d.firerings || []).forEach(function (f) { f.passed = false; f.passedCd = 0; }); St.hole = d; St.hi = 0; St.hole.par = d.par; var t = d.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = d.terrain(t.x, t.z) + K.R; buildScene(d); St.strokes = 0; St.combo = 0; St.scores = []; St.parDone = 0; St.fx = []; St.pops = []; St.trail = []; St.coins = 0; St.points = 0; St.magnetT = 0; St.slowT = 0; var hy = Math.atan2(d.cup.x - t.x, d.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.camOrbit = 0; St.power = 0.5; St.state = 'aim'; St.testing = true; St.holeBest = null; St.banner = 'TEST · ' + d.name; St.bannerT = 1.6; ED.on = false; edShow(false); }
  function icon(c, kind, s, sel, item) {
    c.save();
    var SC = ED.scale || 0.1, it = item || {};
    // scaled footprint radius in screen px from a world size (so radius/size sliders are VISIBLE on the map)
    function R(world, mn) { return Math.max(mn || 7, world * SC); }
    if (kind === 'bumper') { var br = R(it.r || 44, 7); c.fillStyle = '#caa06a'; c.strokeStyle = '#5a3a1a'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, br, 0, TAU); c.fill(); c.stroke(); }
    else if (kind === 'booster') { var zr = R(it.r || 110, 9); c.fillStyle = 'rgba(42,168,255,.28)'; c.strokeStyle = '#2aa8ff'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, zr, 0, TAU); c.fill(); c.stroke(); var ba = (it.dx != null ? Math.atan2(it.dz, it.dx) : (PI / 2)); c.save(); c.translate(s.x, s.y); c.rotate(ba - PI / 2); c.fillStyle = '#eafaff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 3); c.lineTo(-5, 3); c.closePath(); c.fill(); c.restore(); }
    else if (kind === 'windmill') { var wr = R(it.r || 200, 10), n = it.n || 4; c.strokeStyle = '#c8442e'; c.lineWidth = 3; for (var a = 0; a < n; a++) { var aa2 = a / n * TAU; c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x + Math.cos(aa2) * wr, s.y + Math.sin(aa2) * wr); c.stroke(); } c.fillStyle = '#6e4524'; c.beginPath(); c.arc(s.x, s.y, 4, 0, TAU); c.fill(); }
    else if (kind === 'conveyor') { var cl = R(it.len || 480, 10) / 2, cw = R(it.w || 240, 8) / 2, ca = it.ang || 0; c.save(); c.translate(s.x, s.y); c.rotate(ca - PI / 2); c.fillStyle = sel ? 'rgba(245,197,66,.22)' : 'rgba(40,42,48,.5)'; c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.fillRect(-cw, -cl, cw * 2, cl * 2); c.strokeRect(-cw, -cl, cw * 2, cl * 2); c.fillStyle = '#ffffff'; for (var cai = -1; cai <= 1; cai++) { var cy = cai * cl * 0.55; c.beginPath(); c.moveTo(0, cy - 6); c.lineTo(6, cy + 5); c.lineTo(-6, cy + 5); c.closePath(); c.fill(); } c.restore(); }
    else if (kind === 'pendulum') { var sw = R((it.len || 360) * Math.sin(it.amp || 1.1), 6); c.strokeStyle = '#9a9aa2'; c.lineWidth = 3; c.beginPath(); c.moveTo(s.x - sw, s.y); c.lineTo(s.x + sw, s.y); c.stroke(); c.fillStyle = sel ? '#ffffff' : '#33363d'; c.strokeStyle = '#15161a'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, R(it.rb || 46, 4), 0, TAU); c.fill(); c.stroke(); }
    else if (kind === 'turntable') { var ttr = R(it.r || 200, 10); c.fillStyle = sel ? 'rgba(245,197,66,.18)' : 'rgba(71,74,83,.5)'; c.strokeStyle = '#ffffff'; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, ttr, 0, TAU); c.fill(); c.stroke(); for (var ti = 0; ti < 3; ti++) { var ta = ti / 3 * PI; c.beginPath(); c.moveTo(s.x - Math.cos(ta) * ttr, s.y - Math.sin(ta) * ttr); c.lineTo(s.x + Math.cos(ta) * ttr, s.y + Math.sin(ta) * ttr); c.stroke(); } var dir = (it.spin || 0) >= 0 ? 1 : -1; c.beginPath(); c.arc(s.x, s.y, ttr * 0.5, -0.6 * dir, 1.8 * dir); c.stroke(); }
    else if (kind === 'loop') { var lr = R(it.r || 130, 7); c.strokeStyle = '#e8902a'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, lr, 0, TAU); c.stroke(); c.fillStyle = '#e8902a'; c.font = '700 9px Georgia'; c.textAlign = 'center'; c.fillText('∞', s.x, s.y + 3); }
    else if (kind === 'warp') { var pr = R(it.r || 50, 8); c.fillStyle = '#0a0616'; c.beginPath(); c.arc(s.x, s.y, pr, 0, TAU); c.fill(); c.strokeStyle = '#2aa8ff'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, pr, 0, TAU); c.stroke(); c.fillStyle = '#2aa8ff'; c.font = '700 9px Georgia'; c.textAlign = 'center'; c.fillText('', s.x, s.y + 3); }
    else if (kind === 'warpExit') { c.strokeStyle = '#2aff9a'; c.lineWidth = 2.5; c.beginPath(); c.arc(s.x, s.y, 9, 0, TAU); c.stroke(); c.beginPath(); c.arc(s.x, s.y, 3, 0, TAU); c.stroke(); }
    else if (kind === 'portal') { var por = R(it.r || 46, 8); c.strokeStyle = '#c45cff'; c.lineWidth = 3; c.beginPath(); c.arc(s.x, s.y, por, 0, TAU); c.stroke(); c.fillStyle = 'rgba(196,92,255,.3)'; c.beginPath(); c.arc(s.x, s.y, por * .7, 0, TAU); c.fill(); }
    else if (kind === 'portalExit') { c.strokeStyle = '#c45cff'; c.lineWidth = 2.5; c.setLineDash([3, 3]); c.beginPath(); c.arc(s.x, s.y, 10, 0, TAU); c.stroke(); c.setLineDash([]); }
    else if (kind === 'firering') { var fr = R(it.r || 120, 8); c.strokeStyle = '#ff5a1e'; c.lineWidth = 3.5; c.beginPath(); c.arc(s.x, s.y, fr, 0, TAU); c.stroke(); c.fillStyle = '#ff8a2a'; c.font = '11px Georgia'; c.textAlign = 'center'; c.fillText('', s.x, s.y + 4); }
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
    var _dr = ED.draft, _hasShape = Array.isArray(_dr.shape) && _dr.shape.length >= 3, _hasIsl = Array.isArray(_dr.islands) && _dr.islands.length;
    function edFillPoly(poly) { if (!poly || poly.length < 3) return; c.beginPath(); var s0 = edW2S(poly[0].x, poly[0].z); c.moveTo(s0.x, s0.y); for (var _i = 1; _i < poly.length; _i++) { var _s = edW2S(poly[_i].x, poly[_i].z); c.lineTo(_s.x, _s.y); } c.closePath(); c.fill(); }
    if (_hasShape || _hasIsl) {   // ORGANIC / ISLAND hole — render the real green(s) on desert, NOT a rectangle
      c.fillStyle = '#b1925a'; c.fillRect(tl.x, tl.y, brc.x - tl.x, brc.y - tl.y);   // desert void
      c.fillStyle = '#4e9e3e'; if (_hasShape) edFillPoly(_dr.shape); if (_hasIsl) _dr.islands.forEach(function (il) { edFillPoly(il.poly); });
    } else {
      c.fillStyle = '#4e9e3e'; c.fillRect(tl.x, tl.y, brc.x - tl.x, brc.y - tl.y);   // plain box hole
    }
    c.strokeStyle = 'rgba(255,255,255,.09)'; c.lineWidth = 1;
    for (var gx = Math.ceil(bn.minX / 200) * 200; gx < bn.maxX; gx += 200) { var sx = edW2S(gx, 0).x; c.beginPath(); c.moveTo(sx, tl.y); c.lineTo(sx, brc.y); c.stroke(); }
    for (var gz = Math.ceil(bn.minZ / 200) * 200; gz < bn.maxZ; gz += 200) { var sy = edW2S(0, gz).y; c.beginPath(); c.moveTo(tl.x, sy); c.lineTo(brc.x, sy); c.stroke(); }
    ED.draft.terrainFeatures.forEach(function (t) { if (t.kind === 'hill' || t.kind === 'funnel') { var cc = edW2S(t.x, t.z); c.strokeStyle = t.kind === 'hill' ? 'rgba(120,210,100,.5)' : 'rgba(70,200,255,.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cc.x, cc.y, (t.rad || 300) * ED.scale, 0, TAU); c.stroke(); } else if (t.kind === 'ramp') { var a = edW2S(bn.minX, t.z1), b2 = edW2S(bn.maxX, t.z0); c.fillStyle = 'rgba(215,160,90,.35)'; c.fillRect(a.x, a.y, b2.x - a.x, b2.y - a.y); } else if (t.kind === 'tier') { var ty = edW2S(0, t.z0).y; c.strokeStyle = (t.h < 0 ? 'rgba(90,140,255,.8)' : 'rgba(120,210,100,.8)'); c.lineWidth = 3; c.setLineDash([11, 7]); c.beginPath(); c.moveTo(tl.x, ty); c.lineTo(brc.x, ty); c.stroke(); c.setLineDash([]); c.fillStyle = c.strokeStyle; c.font = '9px Georgia'; c.textAlign = 'left'; c.fillText((t.h < 0 ? 'drop ' : 'rise ') + Math.abs(t.h), tl.x + 4, ty - 4); } });
    var selWalls = (ED.sel && ED.sel.kind === 'wallgroup') ? ED.sel.items : null;
    ED.draft.walls.forEach(function (wl) { var a = edW2S(wl.ax, wl.az), b2 = edW2S(wl.bx, wl.bz); var inSel = selWalls && selWalls.indexOf(wl) >= 0; c.strokeStyle = inSel ? '#fff5c0' : (wl._bnd ? '#caa06a' : '#e6b878'); c.lineWidth = inSel ? 9 : (wl._bnd ? 5 : 6); c.lineCap = 'round'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); });
    ED.draft.lasers.forEach(function (l) { var a = edW2S(l.ax, l.az), b2 = edW2S(l.bx, l.bz); c.strokeStyle = '#ff3a4a'; c.lineWidth = 3; c.setLineDash([10, 7]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); c.setLineDash([]); c.fillStyle = '#ff3a4a'; [a, b2].forEach(function (p) { c.beginPath(); c.arc(p.x, p.y, 5, 0, TAU); c.fill(); }); });
    (ED.draft.gates || []).forEach(function (g) { var a = edW2S(g.ax, g.az), b2 = edW2S(g.bx, g.bz), sel = ED.sel && ED.sel.item === g; c.strokeStyle = sel ? '#ffd24a' : '#c79a55'; c.lineWidth = 3; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); var gdx = g.bx - g.ax, gdz = g.bz - g.az, gL = hyp(gdx, gdz) || 1, bl = gL * g.barFrac, ux = gdx / gL, uz = gdz / gL, ba = edW2S(g.ax + ux * (gL - bl) / 2, g.az + uz * (gL - bl) / 2), bb = edW2S(g.ax + ux * (gL + bl) / 2, g.az + uz * (gL + bl) / 2); c.strokeStyle = '#8a5a30'; c.lineWidth = 8; c.lineCap = 'round'; c.beginPath(); c.moveTo(ba.x, ba.y); c.lineTo(bb.x, bb.y); c.stroke(); c.lineCap = 'butt'; c.fillStyle = '#6e4524'; [a, b2].forEach(function (p) { c.beginPath(); c.arc(p.x, p.y, 5, 0, TAU); c.fill(); }); });
    (ED.draft.warps || []).forEach(function (wp) { var a = edW2S(wp.x, wp.z), b2 = edW2S(wp.ex, wp.ez); c.strokeStyle = 'rgba(42,255,154,.6)'; c.lineWidth = 2; c.setLineDash([7, 5]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); c.setLineDash([]); });
    (ED.draft.portals || []).forEach(function (po) { var a = edW2S(po.x, po.z); c.strokeStyle = 'rgba(196,92,255,.55)'; c.lineWidth = 2; c.setLineDash([7, 5]); (po.exits || [{ x: po.ex, z: po.ez }]).forEach(function (e) { var b2 = edW2S(e.x, e.z); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); }); c.setLineDash([]); });
    (ED.draft.enemies || []).forEach(function (en) { var a = edW2S(en.x, en.z), b2 = edW2S(en.ex, en.ez); c.strokeStyle = 'rgba(255,106,74,.5)'; c.lineWidth = 2; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke(); c.setLineDash([]); });
    (ED.draft.firerings || []).forEach(function (fr) { var cc = edW2S(fr.x, fr.z); c.strokeStyle = 'rgba(255,90,30,.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cc.x, cc.y, fr.r * ED.scale, 0, TAU); c.stroke(); });
    edItems().forEach(function (it) { if (it.kind === 'wall' || it.kind === 'laser' || it.kind === 'gate') return; icon(c, it.kind, edW2S(it.x, it.z), ED.sel && ED.sel.item === it.item, it.item); });
    if (ED.sel && ED.sel.kind === 'wallgroup' && ED.sel.handles) {
      ED.sel.handles.mids.forEach(function (m) { var s = edW2S(m.x, m.z); c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 4, 0, TAU); c.stroke(); });
      ED.sel.handles.verts.forEach(function (v) { var s = edW2S(v.x, v.z); c.fillStyle = '#fff'; c.strokeStyle = '#3a2614'; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, 6, 0, TAU); c.fill(); c.stroke(); });
    }
    if (ED.seg) { var a = edW2S(ED.seg.sx, ED.seg.sz); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(a.x, a.y, 5, 0, TAU); c.fill(); if (ED.curS) { c.setLineDash([6, 5]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(ED.curS.x, ED.curS.y); c.stroke(); c.setLineDash([]); } }
    if (ED.drawing && ED.drawing.length) { c.strokeStyle = '#ffd24a'; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); var ds = edW2S(ED.drawing[0].x, ED.drawing[0].z); c.moveTo(ds.x, ds.y); for (var dpi = 1; dpi < ED.drawing.length; dpi++) { var dpp = edW2S(ED.drawing[dpi].x, ED.drawing[dpi].z); c.lineTo(dpp.x, dpp.y); } c.stroke(); if (ED.drawing.length > 2) { c.strokeStyle = 'rgba(255,210,74,.4)'; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(ds.x, ds.y); var de = edW2S(ED.drawing[ED.drawing.length - 1].x, ED.drawing[ED.drawing.length - 1].z); c.lineTo(de.x, de.y); c.stroke(); c.setLineDash([]); } }
    if (ED.poly && ED.poly.length) { c.strokeStyle = '#ffd24a'; c.fillStyle = '#ffd24a'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); var p0 = edW2S(ED.poly[0].x, ED.poly[0].z); c.moveTo(p0.x, p0.y); for (var pi = 1; pi < ED.poly.length; pi++) { var pp = edW2S(ED.poly[pi].x, ED.poly[pi].z); c.lineTo(pp.x, pp.y); } if (ED.curS) c.lineTo(ED.curS.x, ED.curS.y); c.stroke(); ED.poly.forEach(function (v) { var s = edW2S(v.x, v.z); c.beginPath(); c.arc(s.x, s.y, 4, 0, TAU); c.fill(); }); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(p0.x, p0.y, 8, 0, TAU); c.stroke(); }
    if (ED.flash && ED.flash.t > 0) { var fs = edW2S(ED.flash.x, ED.flash.z), rr = (0.35 - ED.flash.t) / 0.35 * 30 + 6; c.strokeStyle = 'rgba(245,197,66,' + (ED.flash.t / 0.35).toFixed(2) + ')'; c.lineWidth = 3; c.beginPath(); c.arc(fs.x, fs.y, rr, 0, TAU); c.stroke(); ED.flash.t -= 0.016; }
    var inField = ED.curS && ED.curS.x > 208 && ED.curS.x < w - 210 && ED.curS.y > 54 && ED.curS.y < h - 6;
    if ((ED.brush === 'wall' || ED.brush === 'laser' || ED.brush === 'gate') && ED.seg && ED.curS && !ED.view3d) { var ss = edW2S(ED.seg.sx, ED.seg.sz); c.strokeStyle = ED.brush === 'laser' ? 'rgba(255,58,74,.85)' : ED.brush === 'gate' ? 'rgba(199,154,85,.9)' : 'rgba(255,210,74,.9)'; c.lineWidth = 4; c.lineCap = 'round'; c.setLineDash([9, 6]); c.beginPath(); c.moveTo(ss.x, ss.y); c.lineTo(ED.curS.x, ED.curS.y); c.stroke(); c.setLineDash([]); c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(ss.x, ss.y, 5, 0, TAU); c.fill(); }
    if (inField && ED.brush !== 'select') {
      var gx = ED.curS.x, gyy = ED.curS.y;
      c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(gx - 11, gyy); c.lineTo(gx + 11, gyy); c.moveTo(gx, gyy - 11); c.lineTo(gx, gyy + 11); c.stroke();
      if (ED.brush === 'draw' || ED.brush === 'erase' || ED.brush === 'raise' || ED.brush === 'lower') { var rr = Math.max(7, ED.size / 2 * ED.scale); c.strokeStyle = ED.brush === 'erase' ? 'rgba(255,90,90,.85)' : ED.brush === 'raise' ? 'rgba(120,230,110,.9)' : ED.brush === 'lower' ? 'rgba(120,160,255,.9)' : 'rgba(255,210,74,.85)'; c.lineWidth = 2; c.setLineDash([5, 5]); c.beginPath(); c.arc(gx, gyy, rr, 0, TAU); c.stroke(); c.setLineDash([]); }
      else { c.globalAlpha = 0.5; if (ED.brush === 'wall' || ED.brush === 'laser' || ED.brush === 'gate' || ED.brush === 'shape') { c.fillStyle = ED.brush === 'laser' ? '#ff3a4a' : ED.brush === 'gate' ? '#c79a55' : '#e6b878'; c.beginPath(); c.arc(gx, gyy, 5, 0, TAU); c.fill(); } else icon(c, ED.brush, { x: gx, y: gyy }, false); c.globalAlpha = 1; }
    }
    var tn = (ED_TOOLS.filter(function (t) { return t[0] === ED.brush; })[0] || [ED.brush, ED.brush])[1];
    var hint = ED.brush === 'select' ? '◀ Click a wall path = whole group (drag dots to bend) · Shift-click = one segment · click an item & drag to move'
      : (ED.brush === 'raise' || ED.brush === 'lower') ? ('⤒⤓ PAINT TERRAIN — drag to ' + (ED.brush === 'raise' ? 'RAISE' : 'LOWER') + ' the ground   ·   brush size = area   ·   Undo to revert')
        : ED.brush === 'erase' ? 'ERASER — DRAG over walls / items to delete them (size slider sets the wipe radius)    ·    Undo restores'
        : ED.brush === 'draw' ? 'DRAW — drag a CLOSED loop = walled arena, or an OPEN line = channel of the brush width (size slider)'
        : ED.brush === 'shape' ? 'SHAPE — click to drop corners, click the white ring (first point) to close the outline    ·    Esc cancels'
        : (ED.brush === 'wall' || ED.brush === 'laser' || ED.brush === 'gate') ? ('' + tn.toUpperCase() + '  —  click TWO points on the field to draw it')
          : ('' + tn.toUpperCase() + '  —  click the field to drop one    ·    switch to Select to move / Delete');
    c.textAlign = 'center'; c.font = 'bold 14px Georgia'; c.fillStyle = ED.brush === 'select' ? '#ffd24a' : '#eafaff'; c.fillText(hint, w / 2, h - 18);
    c.fillStyle = 'rgba(255,255,255,.4)'; c.font = '10px Georgia'; c.textAlign = 'left'; c.fillText('grid ' + (ED.snapOn ? ED.snap : 'off') + '   ·   undo ' + ED.undo.length, 214, h - 6);
  }
  /* ---- editor DOM ---- */
  function elt(tag, css, txt, parent) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; if (parent) parent.appendChild(e); return e; }
  // in-app dialog + toast (prompt()/alert()/confirm() are unreliable in embedded/preview frames — never use them)
  function edModal(title, build) {
    var m = ED.dom.modal; if (!m) return; m.innerHTML = ''; m.style.display = 'flex'; m.onclick = function (e) { if (e.target === m) m.style.display = 'none'; };
    var box = elt('div', 'width:380px;max-width:92%;max-height:84%;overflow:auto;background:transparent;border:none;padding:16px;', null, m);
    if (title) elt('div', 'font:800 16px Georgia;color:#ffffff;margin-bottom:10px;', title, box);
    build(box, function () { m.style.display = 'none'; });
    return box;
  }
  function edConfirm(msg, onYes) {
    edModal(null, function (box, close) {
      elt('div', 'font:13px Georgia;color:#f5efdc;line-height:1.4;margin-bottom:12px;', msg, box);
      var r = elt('div', 'display:flex;gap:8px;', null, box);
      var yes = elt('button', 'flex:1;padding:10px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:800 12px Georgia;cursor:pointer;', 'Yes', r); yes.onclick = function () { close(); onYes(); };
      var no = elt('button', 'flex:1;padding:10px;background:#3a2614;color:#ffffff;font:800 12px Georgia;cursor:pointer;', 'Cancel', r); no.onclick = close;
    });
  }
  function edToast(msg, good) {
    if (!ED.dom.root) return;
    var t = elt('div', 'position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:60;padding:9px 16px;background:' + (good === false ? '#7a2618' : '#1f5018') + ';color:#fff;font:700 13px Georgia;pointer-events:none;', msg, ED.dom.root);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2000);
  }
  function edGetNotes() { try { return JSON.parse(localStorage.getItem('pg_notes') || '[]'); } catch (e) { return []; } }
  function edNotes() {
    edModal('NOTES FOR THE BUILDER', function (box, close) {
      elt('div', 'font-size:11px;opacity:.85;line-height:1.4;margin-bottom:6px;', 'Type anything that is wrong or what you want changed. It SAVES on this device and the developer reads it to fix things. Your past notes are listed below.', box);
      var ta = elt('textarea', 'width:100%;height:90px;padding:8px;background:#1a1109;color:#f5efdc;font:12px Georgia;resize:vertical;', null, box); ta.placeholder = 'e.g. the bumper radius slider does nothing…';
      var sb = elt('button', 'width:100%;margin-top:8px;padding:10px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', 'Save note', box);
      var list = elt('div', 'margin-top:10px;', null, box);
      function render() { list.innerHTML = ''; var notes = edGetNotes(); if (!notes.length) { elt('div', 'opacity:.5;font-size:11px;', 'No notes yet.', list); return; } elt('div', 'font:700 11px Georgia;color:#ffffff;margin-bottom:3px;', 'SAVED NOTES (' + notes.length + ')', list); notes.slice().reverse().forEach(function (n) { var c = elt('div', 'background:rgba(245,197,66,.08);padding:6px;margin:4px 0;', null, list); elt('div', 'font-size:9px;opacity:.5;', n.t || '', c); elt('div', 'font-size:12px;white-space:pre-wrap;color:#f5efdc;', n.msg, c); }); }
      sb.onclick = function () { var msg = (ta.value || '').trim(); if (!msg) { edToast('Write a note first', false); return; } var notes = edGetNotes(); notes.push({ t: new Date().toLocaleString(), msg: msg, build: BUILD }); try { localStorage.setItem('pg_notes', JSON.stringify(notes)); } catch (e) { } ta.value = ''; render(); edToast('Note saved — thank you!'); };
      render();
    });
  }
  function edLiveRefresh() { if (ED.view3d) { applyPhys(ED.draft.phys); ED.dirty3d = true; } }   // batched 3D rebuild (applied once per frame)
  var BTN = 'display:block;width:184px;margin:3px 0;padding:7px 9px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 12px Georgia;cursor:pointer;text-align:left;';
  function edInit() {
    var root = elt('div', 'position:fixed;inset:0;z-index:40;display:none;pointer-events:none;', null, document.body); ED.dom.root = root;
    if (!document.getElementById('edscrollcss')) { var stl = elt('style', null, null, document.head); stl.id = 'edscrollcss'; stl.textContent = '.edscroll::-webkit-scrollbar{width:11px;height:11px}.edscroll::-webkit-scrollbar-track{background:#1a1109;scrollbar-color:#ffffff #1a1109}'; }
    // ---- TOP BAR: full width, single row, never wraps (scrolls if narrow) ----
    var top = elt('div', 'position:absolute;left:8px;right:8px;top:8px;height:40px;display:flex;gap:5px;align-items:center;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;pointer-events:auto;', null, root);
    ED.dom.topBtns = [];
    var mk = function (label, fn, col) { var b = elt('button', 'flex:0 0 auto;padding:7px 8px;background:' + (col || 'linear-gradient(180deg,#6a4628,#3a2614)') + ';color:#ffffff;font:700 11.5px Georgia;cursor:pointer;white-space:nowrap;', label, top); b.onclick = fn; b._full = label; b._icon = label.split(' ')[0]; b.title = b.title || label; ED.dom.topBtns.push(b); return b; };
    mk('▶ TEST', edPlay, 'linear-gradient(180deg,#3a8a30,#1f5018)');
    ED.dom.btn3d = mk('3D', function () { if (ED.view3d) { edExit3D(); ED.dom.btn3d.style.background = 'linear-gradient(180deg,#6a4628,#3a2614)'; } else { edEnter3D(); ED.dom.btn3d.style.background = 'linear-gradient(180deg,#2a7ab0,#15486a)'; } }, 'linear-gradient(180deg,#2a7ab0,#15486a)');
    ED.dom.btn3d.style.background = 'linear-gradient(180deg,#6a4628,#3a2614)';
    ED.dom.btnPal = mk('◧', function () { edTogglePanel('pal'); }); ED.dom.btnPal.title = 'Show / hide the tools panel (more room for the map)';
    ED.dom.btnPanel = mk('◨', function () { edTogglePanel('panel'); }); ED.dom.btnPanel.title = 'Show / hide the inspector panel';
    mk('↶', edUndo); mk('↷', edRedo);
    mk('＋ New', function () { edConfirm('Start a new blank level? Unsaved work is lost.', function () { edSnapshot(); ED.draft = newDraft(); ED.sel = null; edPanel(); edToast('New level'); }); });
    mk('Clear', function () { edConfirm('Clear all placed items? Keeps the level shape, tee, cup and theme.', edClearAll); });
    mk('Shapes', edShapes, 'linear-gradient(180deg,#5a4a8a,#2f2350)');
    mk('Save', edSave, 'linear-gradient(180deg,#3a8a30,#1f5018)'); mk('Levels', edLevels); mk('⇪ Export', edExport); mk('⇩ Import', edImport);
    mk('Notes', edNotes, 'linear-gradient(180deg,#b06a1a,#6a3c08)');
    mk('× Exit', function () { ED.on = false; edShow(false); if (St.state === 'load' || !St.hole) loadHole(0); });
    // ---- LEFT PALETTE: tool settings box + items ----
    var pal = elt('div', 'position:absolute;left:8px;top:56px;bottom:8px;width:212px;overflow-y:auto;overflow-x:hidden;pointer-events:auto;', null, root); pal.className = 'edscroll';
    var ts = elt('div', 'background:rgba(30,20,10,.6);padding:6px;margin-bottom:7px;', null, pal);
    ED.dom.snap = elt('button', 'display:block;width:100%;margin-bottom:5px;padding:5px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 11px Georgia;cursor:pointer;', '▦ grid snap: ON', ts); ED.dom.snap.onclick = function () { ED.snapOn = !ED.snapOn; ED.dom.snap.textContent = '▦ grid snap: ' + (ED.snapOn ? 'ON' : 'OFF'); };
    var sr = elt('div', 'font:700 10px Georgia;color:#ffffff;margin:3px 0 1px;', '/brush size: ' + ED.size, ts); var si = elt('input', 'width:100%;', null, ts); si.type = 'range'; si.min = 40; si.max = 520; si.step = 10; si.value = ED.size; si.oninput = function () { ED.size = parseInt(si.value, 10); sr.textContent = '/brush size: ' + ED.size; };
    var smr = elt('div', 'display:flex;gap:4px;align-items:center;margin-top:5px;', null, ts);
    var smb = elt('button', 'flex:0 0 auto;padding:5px 8px;background:linear-gradient(180deg,#5a4a8a,#2f2350);color:#ffffff;font:700 11px Georgia;cursor:pointer;', '〜 Smooth', smr); smb.onclick = smoothWalls;
    var smi = elt('input', 'flex:1;', null, smr); smi.type = 'range'; smi.min = 1; smi.max = 4; smi.step = 1; smi.value = ED.smoothAmt; var sml = elt('div', 'font:700 11px Georgia;color:#ffffff;min-width:8px;', String(ED.smoothAmt), smr); smi.oninput = function () { ED.smoothAmt = parseInt(smi.value, 10); sml.textContent = ED.smoothAmt; };
    elt('div', 'font:800 11px Georgia;color:#ffffff;opacity:.85;margin:0 0 3px 2px;', 'ITEMS — pick one, click field', pal);
    var FULLBTN = 'display:block;width:100%;margin:3px 0;padding:7px 9px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 12px Georgia;cursor:pointer;text-align:left;';
    var GBTN = 'padding:5px 3px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 10px Georgia;cursor:pointer;text-align:center;line-height:1.1;min-height:29px;';
    var mkTool = function (t, parent, style) { var bb = elt('button', style, t[1], parent); bb.onclick = function () { ED.brush = t[0]; ED.seg = null; ED.poly = null; ED.drawing = null; ED.erasing = false; ED.sel = null; edHi(); edPanel(); }; bb._tool = t[0]; return bb; };
    ['select', 'draw', 'erase'].forEach(function (key) { var t = ED_TOOLS.filter(function (x) { return x[0] === key; })[0]; if (t) mkTool(t, pal, FULLBTN); });   // prominent mode tools
    var grid = elt('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:3px;', null, pal);   // every placement tool, 2-column so they all fit
    ED_TOOLS.forEach(function (t) { if (t[0] === 'select' || t[0] === 'draw' || t[0] === 'erase') return; mkTool(t, grid, GBTN); });
    elt('div', 'height:6px;', '', pal); var del = elt('button', FULLBTN.replace('#6a4628,#3a2614', '#7a2618,#451008') + 'color:#ffd;', '×  Delete  (Del)', pal); del.onclick = edDelete;
    var dupb = elt('button', FULLBTN.replace('#6a4628,#3a2614', '#3a6a8a,#1f3850') + 'color:#dff;', '⧉  Duplicate  (Ctrl+D)', pal); dupb.onclick = edDuplicate;
    ED.dom.pal = pal;
    // ---- RIGHT INSPECTOR ----
    var panel = elt('div', 'position:absolute;right:8px;top:56px;bottom:8px;width:200px;overflow-y:auto;overflow-x:hidden;background:rgba(30,20,10,.94);padding:10px;color:#f5efdc;font:12px Georgia;pointer-events:auto;', null, root); ED.dom.panel = panel; panel.className = 'edscroll';
    var modal = elt('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);pointer-events:auto;', null, root); ED.dom.modal = modal;
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
  function edHi() { if (!ED.dom.pal) return; var bs = ED.dom.pal.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) { if (!bs[i]._tool) continue; var on = bs[i]._tool === ED.brush; bs[i].style.outline = on ? '3px solid #f5c542' : 'none'; bs[i].style.background = on ? 'linear-gradient(180deg,#f5d76e,#c9952c)' : 'linear-gradient(180deg,#6a4628,#3a2614)'; bs[i].style.color = on ? '#2a1c10' : '#ffffff'; } }
  function row(parent, label, val, min, max, step, fn) {
    var r = elt('div', 'margin:6px 0;', null, parent); elt('div', 'font-size:10px;opacity:.8;', label + ': ' + (Math.round(val * 100) / 100), r);
    var i = elt('input', 'width:100%;', null, r); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.oninput = function () { fn(parseFloat(i.value)); r.firstChild.textContent = label + ': ' + (Math.round(i.value * 100) / 100); };
    return r;
  }
  function edPanel() {
    var p = ED.dom.panel; if (!p) return; p.innerHTML = '';
    if (ED.sel && ED.sel.kind === 'wallgroup') {
      var gi = ED.sel.items, gcard = elt('div', 'background:rgba(245,197,66,.12);padding:8px;margin-bottom:10px;', null, p);
      elt('div', 'font:800 13px Georgia;color:#ffffff;', 'WALL PATH', gcard);
      elt('div', 'font-size:10px;line-height:1.35;opacity:.9;margin:3px 0 7px;', gi.length + ' segments. ROUND it into perfect curves, or SHARPEN it into clean straight/diagonal corners (like Illustrator). Drag white dots to bend corners; drag the line to move it; Shift-click for one segment.', gcard);
      elt('div', 'font:800 11px Georgia;color:#ffffff;margin-bottom:1px;', 'ROUND — perfect curves →', gcard);
      row(gcard, 'rounding', ED.sel.smoothLevel || 0, 0, 4, 1, function (v) { if (!ED.sel.snapped) { edSnapshot(); ED.sel.snapped = true; } ED.sel.smoothLevel = v; applyPathShape(); });
      elt('div', 'font:800 11px Georgia;color:#ffffff;margin:6px 0 1px;', 'SHARPEN — fewer, cleaner corners →', gcard);
      row(gcard, 'simplify', ED.sel.simplifyAmt || 0, 0, 6, 1, function (v) { if (!ED.sel.snapped) { edSnapshot(); ED.sel.snapped = true; } ED.sel.simplifyAmt = v; applyPathShape(); });
      row(gcard, 'bounce', gi[0] && gi[0].e != null ? gi[0].e : K.wallE, 0, 1, 0.05, function (v) { ED.sel.items.forEach(function (g) { g.e = v; }); edLiveRefresh(); });
      row(gcard, 'height (taller blocks airborne balls)', gi[0] && gi[0].h ? gi[0].h : 80, 20, 240, 4, function (v) { ED.sel.items.forEach(function (g) { g.h = v; }); edLiveRefresh(); });
      var gdl = elt('button', 'display:block;width:100%;margin-top:8px;padding:7px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:700 11px Georgia;cursor:pointer;', '× Delete this path', gcard); gdl.onclick = edDelete;
    } else if (ED.sel) {
      var k = ED.sel.kind, info = ED_INFO[k] || { n: k.toUpperCase(), a: '' }, it = ED.sel.item;
      var card = elt('div', 'background:rgba(245,197,66,.12);padding:8px;margin-bottom:10px;', null, p);
      elt('div', 'font:800 13px Georgia;color:#ffffff;', '' + info.n, card);
      if (info.a) elt('div', 'font-size:10px;line-height:1.35;opacity:.9;margin:3px 0 6px;', info.a, card);
      if (ED_PARAMS[k]) ED_PARAMS[k].forEach(function (pr) {
        if (pr[2] === 'select') { var wrap = elt('div', 'margin:6px 0;', null, card); elt('div', 'font-size:10px;opacity:.8;', pr[1], wrap); var seln = elt('select', 'width:100%;padding:4px;background:#1a1109;color:#f5efdc;font:12px Georgia;', null, wrap); pr[3].forEach(function (opt) { var o = document.createElement('option'); o.value = opt; o.textContent = opt; if ((it[pr[0]] || pr[3][0]) === opt) o.selected = true; seln.appendChild(o); }); seln.onchange = function () { edSnapshot(); it[pr[0]] = seln.value; edLiveRefresh(); }; return; }
        var get = pr[0] === 'ang' ? (it.dx != null ? Math.atan2(it.dz, it.dx) : it.ang) : it[pr[0]];
        row(card, pr[1], get == null ? pr[2] : get, pr[2], pr[3], pr[4], function (v) { if (pr[0] === 'ang') { if (it.dx != null) { it.dx = Math.cos(v); it.dz = Math.sin(v); } else it.ang = v; } else it[pr[0]] = v; edLiveRefresh(); });
      });
      if (k === 'portal' || k === 'portalExit') {
        var po = ED.sel.item, exs = po.exits || (po.exits = [{ x: po.ex, z: po.ez }]);
        elt('div', 'font-size:10px;opacity:.9;margin:5px 0 2px;color:' + (exs.length > 1 ? '#c45cff' : '#f5efdc') + ';', exs.length + ' exit' + (exs.length > 1 ? 's — ball pops out a RANDOM one' : ''), card);
        var pact2 = elt('div', 'display:flex;gap:5px;', null, card);
        var addB = elt('button', 'flex:1;padding:6px;background:linear-gradient(180deg,#5a4a8a,#2f2350);color:#dff;font:700 11px Georgia;cursor:pointer;', '+ add exit', pact2); addB.onclick = function () { edSnapshot(); exs.push({ x: po.x + (exs.length % 2 ? 1 : -1) * (200 + exs.length * 40), z: po.z + 240 }); edPanel(); };
        if (exs.length > 1) { var remB = elt('button', 'flex:1;padding:6px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 11px Georgia;cursor:pointer;', '− remove', pact2); remB.onclick = function () { edSnapshot(); exs.pop(); edPanel(); }; }
      }
      var px = it.x != null ? it.x : it.px, pz = it.z != null ? it.z : it.pz;
      if (px != null) elt('div', 'font-size:10px;opacity:.65;margin-top:4px;', 'position   x ' + Math.round(px) + '   z ' + Math.round(pz) + '   (drag on map)', card);
      if (ED.sel.arr) { var act = elt('div', 'display:flex;gap:5px;margin-top:8px;', null, card); var dup = elt('button', 'flex:1;padding:6px;background:linear-gradient(180deg,#3a6a8a,#1f3850);color:#dff;font:700 11px Georgia;cursor:pointer;', '⧉ Duplicate', act); dup.onclick = edDuplicate; var dl = elt('button', 'flex:1;padding:6px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:700 11px Georgia;cursor:pointer;', '× Delete', act); dl.onclick = edDelete; }
      else elt('div', 'font-size:9px;opacity:.6;margin-top:5px;', '(permanent — drag on the map to move)', card);
    } else {
      elt('div', 'font-size:10px;opacity:.65;margin-bottom:9px;line-height:1.4;', 'Nothing selected. Pick a tool ◀ and click the field to build. Use Select to grab any item and edit its stats here.', p);
    }
    elt('div', 'font:700 12px Georgia;color:#ffffff;margin:4px 0 2px;', 'LEVEL', p);
    var ni = elt('input', 'width:100%;margin:2px 0;', null, p); ni.value = ED.draft.name; ni.oninput = function () { ED.draft.name = ni.value; };
    row(p, 'par', ED.draft.par, 1, 8, 1, function (v) { ED.draft.par = Math.round(v); });
    row(p, 'width', ED.draft.bounds.maxX - ED.draft.bounds.minX, 400, 1600, 20, function (v) { ED.draft.bounds.minX = -v / 2; ED.draft.bounds.maxX = v / 2; rebuildBox(ED.draft); edLiveRefresh(); });
    row(p, 'length', ED.draft.bounds.maxZ - ED.draft.bounds.minZ, 800, 3200, 20, function (v) { ED.draft.bounds.maxZ = ED.draft.bounds.minZ + v; rebuildBox(ED.draft); edLiveRefresh(); });
    row(p, 'border wall height', ED.draft.wallH || 52, 30, 240, 4, function (v) { ED.draft.wallH = v; rebuildBox(ED.draft); edLiveRefresh(); });
    var rwl = elt('button', 'display:block;width:100%;margin:3px 0 6px;padding:6px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 11px Georgia;cursor:pointer;', 'Taller walls (whole level)', p);
    rwl.onclick = function () { edSnapshot(); var nh = Math.min(240, Math.max(120, (ED.draft.wallH || 52) + 50)); ED.draft.wallH = nh; ED.draft.walls.forEach(function (w) { if (!w._bnd) w.h = Math.max(w.h || 52, nh); }); rebuildBox(ED.draft); edLiveRefresh(); edPanel(); };
    var sf = null, tf = ED.draft.terrainFeatures; for (var si = 0; si < tf.length; si++) if (tf[si].kind === 'slope') sf = tf[si]; if (!sf) { sf = { kind: 'slope', perX: 0, perZ: 0 }; tf.push(sf); }
    row(p, 'tilt L→R', sf.perX || 0, -0.2, 0.2, 0.01, function (v) { sf.perX = v; });
    row(p, 'tilt tee→cup', sf.perZ || 0, -0.15, 0.15, 0.01, function (v) { sf.perZ = v; });
    var bt = elt('button', 'display:block;width:100%;margin:5px 0;padding:6px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 11px Georgia;cursor:pointer;', ED.draft.noBox ? '▣ walls: CUSTOM shape' : '▢ walls: rectangle box', p); bt.onclick = function () { ED.draft.noBox = !ED.draft.noBox; rebuildBox(ED.draft); edPanel(); };
    if (ED.draft.noBox) elt('div', 'font-size:9px;opacity:.7;margin-bottom:4px;', 'use the Wall or Shape tool to draw your outline', p);
    elt('div', 'font:700 12px Georgia;color:#ffffff;margin:12px 0 2px;', 'TERRAIN & PHYSICS', p);
    if (!ED.draft.phys) ED.draft.phys = themePhys(ED.draft.theme || 'grass');
    var ph = ED.draft.phys;
    var tw = elt('div', 'margin:3px 0 6px;', null, p); elt('div', 'font-size:10px;opacity:.8;', 'terrain theme (sets all physics)', tw);
    var tsel = elt('select', 'width:100%;padding:5px;background:#1a1109;color:#f5efdc;font:12px Georgia;', null, tw);
    Object.keys(THEMES).forEach(function (tk) { var o = document.createElement('option'); o.value = tk; o.textContent = THEMES[tk].name; if ((ED.draft.theme || 'grass') === tk) o.selected = true; tsel.appendChild(o); });
    tsel.onchange = function () { edSnapshot(); ED.draft.theme = tsel.value; ED.draft.phys = themePhys(tsel.value); ED.draft.turf = THEMES[tsel.value].turf; edPanel(); };
    row(p, 'gravity', ph.g, 400, 3500, 50, function (v) { ph.g = v; });
    row(p, 'friction / grip', ph.rollFric, 100, 2700, 30, function (v) { ph.rollFric = v; });
    row(p, 'ground bounce', ph.groundE, 0, 1, 0.05, function (v) { ph.groundE = v; });
    row(p, 'wall bounce', ph.wallE, 0, 1, 0.05, function (v) { ph.wallE = v; });
    row(p, 'default bumper kick', ph.bumpKick, 600, 3000, 50, function (v) { ph.bumpKick = v; });
    row(p, 'default flip power', ph.flipKick, 800, 4000, 100, function (v) { ph.flipKick = v; });
    row(p, 'max drive', ph.shotMax, 2500, 9000, 100, function (v) { ph.shotMax = v; });
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
    var box = elt('div', 'width:360px;max-height:80%;overflow:auto;background:transparent;border:none;padding:14px;', null, m);
    elt('div', 'font:800 16px Georgia;color:#ffffff;margin-bottom:8px;', 'MY LEVELS', box);
    var sr = elt('div', 'display:flex;gap:6px;margin-bottom:12px;', null, box);
    var nin = elt('input', 'flex:1;padding:7px;background:#1a1109;color:#f5efdc;font:13px Georgia;', null, sr); nin.value = ED.draft.name;
    var sb = elt('button', 'padding:7px 12px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:700 12px Georgia;cursor:pointer;', 'Save', sr);
    sb.onclick = function () { var nm = (nin.value || '').trim(); if (!nm) return; ED.draft.name = nm; var s = edStore(); s[nm] = edSerialize(); try { localStorage.setItem('pg_levels', JSON.stringify(s)); } catch (e) { alert('Save failed (storage full?): ' + e.message); } edLevels(); edPanel(); };
    var s = edStore(), names = Object.keys(s).sort();
    if (!names.length) elt('div', 'opacity:.6;font-size:12px;margin:8px 0;', 'No saved levels yet — build one and hit Save.', box);
    names.forEach(function (n) {
      var lv = s[n] || {}, cnt = ['bumpers', 'boosters', 'flippers', 'windmills', 'loops', 'lasers', 'walls'].reduce(function (a, kk) { return a + ((lv[kk] || []).length); }, 0);
      var rd = elt('div', 'display:flex;gap:5px;align-items:center;padding:7px;margin:5px 0;background:rgba(245,197,66,.08);', null, box);
      elt('div', 'flex:1;font:700 13px Georgia;color:#f5efdc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', n, rd);
      elt('div', 'font-size:10px;opacity:.55;margin-right:3px;', cnt + ' items', rd);
      var lb = elt('button', 'padding:6px 10px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 11px Georgia;cursor:pointer;', 'Load', rd);
      lb.onclick = function () { edSnapshot(); ED.draft = edDeserialize(s[n]); ED.sel = null; m.style.display = 'none'; edPanel(); };
      var rb = elt('button', 'padding:6px 8px;background:#3a2614;color:#cba;font:700 11px Georgia;cursor:pointer;', 'EDIT', rd);
      rb.onclick = function () { edModal('RENAME', function (bx, close) { var ri = elt('input', 'width:100%;padding:9px;background:#1a1109;color:#f5efdc;font:13px Georgia;margin-bottom:10px;', null, bx); ri.value = n; var ok = elt('button', 'width:100%;padding:10px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 12px Georgia;cursor:pointer;', 'Rename', bx); ok.onclick = function () { var nn = (ri.value || '').trim(); if (!nn || nn === n) { close(); return; } var st = edStore(); st[nn] = st[n]; st[nn].name = nn; delete st[n]; localStorage.setItem('pg_levels', JSON.stringify(st)); close(); edLevels(); edToast('Renamed '); }; setTimeout(function () { ri.focus(); ri.select(); }, 40); }); };
      var xb = elt('button', 'padding:6px 8px;background:linear-gradient(180deg,#7a2618,#451008);color:#ffd;font:700 11px Georgia;cursor:pointer;', '×', rd);
      xb.onclick = function () { edConfirm('Delete level "' + n + '"? This cannot be undone.', function () { var st = edStore(); delete st[n]; localStorage.setItem('pg_levels', JSON.stringify(st)); edLevels(); edToast('Deleted'); }); };
    });
    var cl = elt('button', 'margin-top:10px;width:100%;padding:9px;background:#3a2614;color:#ffffff;font:700 12px Georgia;cursor:pointer;', 'Close', box); cl.onclick = function () { m.style.display = 'none'; };
  }
  function chaikin(pts, iters) { for (var k = 0; k < iters; k++) { var out = [pts[0]]; for (var i = 0; i < pts.length - 1; i++) { var p = pts[i], q = pts[i + 1]; out.push({ x: p.x * .75 + q.x * .25, z: p.z * .75 + q.z * .25 }); out.push({ x: p.x * .25 + q.x * .75, z: p.z * .25 + q.z * .75 }); } out.push(pts[pts.length - 1]); pts = out; } return pts; }
  function chaikinClosed(pts, iters) { for (var k = 0; k < iters; k++) { var out = []; for (var i = 0; i < pts.length; i++) { var p = pts[i], q = pts[(i + 1) % pts.length]; out.push({ x: p.x * .75 + q.x * .25, z: p.z * .75 + q.z * .25 }); out.push({ x: p.x * .25 + q.x * .75, z: p.z * .25 + q.z * .75 }); } pts = out; } return pts; }
  function ptSegDist(p, a, b) { var dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-6) return hyp(p.x - a.x, p.z - a.z); var t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / L2, 0, 1); return hyp(p.x - (a.x + dx * t), p.z - (a.z + dz * t)); }
  function rdp(pts, tol) { if (pts.length < 3) return pts.slice(); var dmax = 0, idx = 0, end = pts.length - 1, i; for (i = 1; i < end; i++) { var d = ptSegDist(pts[i], pts[0], pts[end]); if (d > dmax) { dmax = d; idx = i; } } if (dmax > tol) { var l = rdp(pts.slice(0, idx + 1), tol), r = rdp(pts.slice(idx), tol); return l.slice(0, -1).concat(r); } return [pts[0], pts[end]]; }   // Douglas–Peucker: drop redundant points, keep sharp corners (Illustrator-style simplify)
  function snapAngle(ax, az, bx, bz) { var dx = bx - ax, dz = bz - az, d = hyp(dx, dz); if (d < 1) return { x: bx, z: bz }; var st = PI / 4, a = Math.round(Math.atan2(dz, dx) / st) * st; return { x: ax + Math.cos(a) * d, z: az + Math.sin(a) * d }; }   // constrain to 0/45/90° for clean straight + diagonal lines
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
    var box = elt('div', 'width:300px;background:transparent;border:none;padding:14px;', null, m);
    elt('div', 'font:800 16px Georgia;color:#ffffff;margin-bottom:3px;', 'HOLE SHAPES', box);
    elt('div', 'font-size:10px;opacity:.7;margin-bottom:10px;line-height:1.35;', 'Replaces the layout with a preset course shape. Undo (Ctrl+Z) reverts. You can keep adding items after.', box);
    [['s', 'S-Curve  〰'], ['z', 'Z-Bend  ⟋'], ['w', 'W-Zigzag  ⋀⋁'], ['circle', 'Round Arena  ◯'], ['twotier', 'Two-Tier Drop  '], ['threetier', 'Three-Tier Drop  ']].forEach(function (sh) {
      var b = elt('button', 'display:block;width:100%;margin:5px 0;padding:11px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 13px Georgia;cursor:pointer;text-align:left;', sh[1], box); b.onclick = function () { applyShape(sh[0]); };
    });
    var cl = elt('button', 'margin-top:8px;width:100%;padding:8px;background:#3a2614;color:#ffffff;font:700 12px Georgia;cursor:pointer;', 'Cancel', box); cl.onclick = function () { m.style.display = 'none'; };
  }
  function edSerialize() { var d = ED.draft; return { name: d.name, par: d.par, bounds: d.bounds, tee: d.tee, cup: d.cup, walls: d.walls.filter(function (w) { return !w._bnd; }).map(function (w) { return { ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, e: w.e, h: w.h }; }), bumpers: d.bumpers.map(function (b) { return { x: b.x, z: b.z, r: b.r, kick: b.kick }; }), bouncers: (d.bouncers || []).map(function (b) { return { x: b.x, z: b.z, r: b.r }; }), boosters: d.boosters.map(function (b) { return { x: b.x, z: b.z, ang: Math.atan2(b.dz, b.dx), r: b.r, spd: b.spd }; }), flippers: d.flippers.map(function (f) { return { side: f.side, px: f.px, pz: f.pz, len: f.len, rot: f.rot, speed: f.speed, power: f.power }; }), windmills: d.windmills.map(function (w) { return { x: w.x, z: w.z, r: w.r, n: w.n, speed: w.speed }; }), lasers: d.lasers.map(function (l) { return { ax: l.ax, az: l.az, bx: l.bx, bz: l.bz, period: l.period, onFrac: l.onFrac, phase: l.phase }; }), gates: (d.gates || []).map(function (g) { return { ax: g.ax, az: g.az, bx: g.bx, bz: g.bz, barFrac: g.barFrac, speed: g.speed, h: g.h }; }), conveyors: (d.conveyors || []).map(function (cv) { return { x: cv.x, z: cv.z, w: cv.w, len: cv.len, ang: cv.ang, force: cv.force }; }), pendulums: (d.pendulums || []).map(function (pd) { return { x: pd.x, z: pd.z, len: pd.len, amp: pd.amp, speed: pd.speed, rb: pd.rb }; }), turntables: (d.turntables || []).map(function (tt) { return { x: tt.x, z: tt.z, r: tt.r, spin: tt.spin }; }), loops: d.loops.map(function (l) { return { x: l.x, z: l.z, r: l.r, ang: l.ang }; }), warps: d.warps.map(function (w) { return { x: w.x, z: w.z, ex: w.ex, ez: w.ez, r: w.r, tube: !!w.tube }; }), portals: d.portals.map(function (w) { return { x: w.x, z: w.z, exits: (w.exits || [{ x: w.ex, z: w.ez }]).map(function (e) { return { x: e.x, z: e.z }; }), r: w.r }; }), firerings: d.firerings.map(function (f) { return { x: f.x, z: f.z, r: f.r, h: f.h, points: f.points }; }), enemies: d.enemies.map(function (e) { return { x: e.x, z: e.z, ex: e.ex, ez: e.ez, r: e.r, speed: e.speed, type: e.type, behavior: e.behavior, effect: e.effect }; }), coins: d.coins.map(function (c) { return { x: c.x, z: c.z, value: c.value }; }), powerups: (d.powerups || []).map(function (p) { return { x: p.x, z: p.z, kind: p.kind }; }), terrain: d.terrainFeatures, noBox: d.noBox, wallH: d.wallH || 52, theme: d.theme || 'grass', phys: d.phys || themePhys(d.theme || 'grass'), turf: d.turf, shape: (Array.isArray(d.shape) ? d.shape.map(function (p) { return { x: p.x, z: p.z }; }) : null), islands: (Array.isArray(d.islands) ? d.islands.map(function (il) { return { poly: il.poly.map(function (p) { return { x: p.x, z: p.z }; }), y: il.y || 0 }; }) : null), mood: d.mood || null, multiball: d.multiball ? { x: d.multiball.x, z: d.multiball.z, r: d.multiball.r } : null }; }
  function edDeserialize(o) { var d = builder(); d.name = o.name || 'LEVEL'; d.par = o.par || 3; d.bounds = o.bounds; d.tee = o.tee; d.cup = o.cup; d.noBox = !!o.noBox; d.wallH = o.wallH || 52; d.theme = o.theme || 'grass'; d.phys = o.phys || themePhys(d.theme); d.turf = o.turf != null ? o.turf : (THEMES[d.theme] || THEMES.grass).turf; rebuildBox(d); (o.loops || []).forEach(function (l) { d.loopde(l.x, l.z, l.r, l.ang); }); (o.warps || []).forEach(function (w) { if (w.tube) d.tube(w.x, w.z, w.ex, w.ez, w.r); else d.warp(w.x, w.z, w.ex, w.ez, w.r); }); (o.portals || []).forEach(function (w) { d.portal(w.x, w.z, w.exits || (w.ex != null ? [{ x: w.ex, z: w.ez }] : null), w.r); }); (o.firerings || []).forEach(function (f) { d.firering(f.x, f.z, f.r, f.h, f.points); }); (o.enemies || []).forEach(function (e) { d.enemy(e.x, e.z, e.ex, e.ez, e.r, e.speed, e.type, e.behavior, e.effect); }); (o.coins || []).forEach(function (c) { d.coin(c.x, c.z, c.value); }); (o.powerups || []).forEach(function (p) { d.powerup(p.x, p.z, p.kind); }); (o.walls || []).forEach(function (w) { d.wall(w.ax, w.az, w.bx, w.bz, { e: w.e, h: w.h }); }); (o.bumpers || []).forEach(function (b) { d.bumper(b.x, b.z, b.r); if (b.kick != null) last(d.bumpers).kick = b.kick; }); (o.bouncers || []).forEach(function (b) { d.bouncer(b.x, b.z, b.r); }); (o.boosters || []).forEach(function (b) { d.booster(b.x, b.z, b.ang, b.r, b.spd); }); (o.flippers || []).forEach(function (f) { d.flip(f.side, f.px, f.pz, f.len, f.rot, f.speed); if (f.power != null) last(d.flippers).power = f.power; }); (o.windmills || []).forEach(function (w) { d.windmill(w.x, w.z, w.r, w.n, w.speed); }); (o.lasers || []).forEach(function (l) { d.lasers.push({ ax: l.ax, az: l.az, bx: l.bx, bz: l.bz, period: l.period, onFrac: l.onFrac, phase: l.phase, on: false }); }); (o.gates || []).forEach(function (g) { d.gate(g.ax, g.az, g.bx, g.bz, { barFrac: g.barFrac, speed: g.speed, h: g.h }); }); (o.conveyors || []).forEach(function (cv) { d.conveyor(cv.x, cv.z, cv.w, cv.len, cv.ang, cv.force); }); (o.pendulums || []).forEach(function (pd) { d.pendulum(pd.x, pd.z, { len: pd.len, amp: pd.amp, speed: pd.speed, rb: pd.rb }); }); (o.turntables || []).forEach(function (tt) { d.turntable(tt.x, tt.z, tt.r, tt.spin); }); (o.terrain || []).forEach(function (t) { d.terrainFeatures.push(t); }); if (o.multiball) d.mball(o.multiball.x, o.multiball.z, o.multiball.r); if (Array.isArray(o.shape) && o.shape.length >= 3) d.shape = o.shape.map(function (p) { return { x: p.x, z: p.z }; }); if (Array.isArray(o.islands) && o.islands.length) { d.islands = o.islands.map(function (il) { return { poly: il.poly.map(function (p) { return { x: p.x, z: p.z }; }), y: il.y || 0 }; }); d.noBox = true; } if (o.mood) d.mood = o.mood; return d; }
  function edStore() { try { return JSON.parse(localStorage.getItem('pg_levels') || '{}'); } catch (e) { return {}; } }
  // headless: can the auto-bot sink this draft? (used to gate owner publishing) — restores all state, silences audio
  function testDraftBeatable(d, tries, maxStrokes) {
    tries = tries || 12; maxStrokes = maxStrokes || 12;
    var S = { hole: St.hole, hi: St.hi, balls: St.balls, state: St.state, strokes: St.strokes, testing: St.testing, daily: St.daily, rec: St.rec, ghost: St.ghost, aimYaw: St.aimYaw, camYaw: St.camYaw, power: St.power, auOn: (typeof AU !== 'undefined' ? AU.on : null) };
    var beatable = false, best = 99;
    try {
      if (typeof AU !== 'undefined') AU.on = false;
      applyPhys(d.phys); d.terrain = terrainFn(d.terrainFeatures, d.cup); rebuildBox(d);
      St.hole = d; St.hi = 0; St.hole.par = d.par; St.daily = false; St.rec = null; St.ghost = null; St.testing = true;
      var cup = d.cup;
      for (var t = 0; t < tries && !beatable; t++) {
        var tt = d.tee; St.balls = [newBall(tt.x, tt.z, true)]; St.balls[0].y = d.terrain(tt.x, tt.z) + K.R; St.state = 'aim'; St.strokes = 0;
        var scale = 0.78 + (t % 5) * 0.11, strokes = 0;
        while (strokes < maxStrokes) {
          if (St.state !== 'aim') break;
          var b = primeBall(); if (!b) break;
          var dx = cup.x - b.x, dz = cup.z - b.z, dist = hyp(dx, dz);
          St.aimYaw = Math.atan2(dx, dz) + (Math.random() * 2 - 1) * (0.03 + (t / tries) * 0.55); St.camYaw = St.aimYaw;
          St.power = clamp(Math.sqrt(dist / 2600) * scale + (Math.random() * 2 - 1) * 0.12, 0.1, 1);
          shoot(); strokes++;
          var settled = false;
          for (var s = 0; s < 1100; s++) { tick(1 / 60); var pb = primeBall(); if (St.state === 'sunk' || (pb && pb.sunk)) { beatable = true; break; } if (St.state === 'aim') { settled = true; break; } }
          if (beatable) { best = Math.min(best, strokes); break; }
          if (!settled) break;
        }
      }
    } catch (e) { }
    St.hole = S.hole; St.hi = S.hi; St.balls = S.balls; St.state = S.state; St.strokes = S.strokes; St.testing = S.testing; St.daily = S.daily; St.rec = S.rec; St.ghost = S.ghost; St.aimYaw = S.aimYaw; St.camYaw = S.camYaw; St.power = S.power;
    if (typeof AU !== 'undefined' && S.auOn != null) AU.on = S.auOn;
    if (S.hole) applyPhys(S.hole.phys || themePhys(S.hole.theme || 'grass'));
    return { beatable: beatable, strokes: beatable ? best : null };
  }
  function edSave() {
    edModal('SAVE LEVEL', function (box, close) {
      elt('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', 'Level name', box);
      var nin = elt('input', 'width:100%;padding:9px;background:#1a1109;color:#f5efdc;font:13px Georgia;margin-bottom:10px;', null, box); nin.value = ED.draft.name || 'MY LEVEL';
      var sb = elt('button', 'width:100%;padding:11px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', 'Save to my levels', box);
      sb.onclick = function () { var nm = (nin.value || '').trim(); if (!nm) { edToast('Enter a name', false); return; } ED.draft.name = nm; var s = edStore(); s[nm] = edSerialize(); try { localStorage.setItem('pg_levels', JSON.stringify(s)); close(); edToast('Saved "' + nm + '" '); edPanel(); } catch (e) { edToast('Save failed: storage full', false); } };
      // ---- OWNER: publish this edited layout as the live daily (custom hole_json) ----
      if (St.ownerMode && NET()) {
        elt('div', 'border-top:1px solid #5a3a1a;margin:13px 0 9px;', null, box);
        elt('div', 'font:800 12px Georgia;color:#ffffff;margin-bottom:6px;', 'OWNER · set the daily for everyone', box);
        var dRow = elt('div', 'display:flex;gap:6px;margin-bottom:7px;', null, box);
        var dayIn = elt('input', 'flex:1;padding:9px;background:#1a1109;color:#f5efdc;font:13px Georgia;', null, dRow); dayIn.type = 'date'; dayIn.value = NET().todayKey();
        var passIn = elt('input', 'width:100%;padding:9px;background:#1a1109;color:#f5efdc;font:13px Georgia;margin-bottom:7px;', null, box); passIn.type = 'password'; passIn.placeholder = 'Owner passcode';
        try { passIn.value = sessionStorage.getItem('pg_owner_pass') || ''; } catch (e) { }
        var pubB = elt('button', 'width:100%;padding:11px;background:linear-gradient(180deg,#1d9bf0,#0d6fb8);color:#fff;font:800 13px Georgia;cursor:pointer;', 'Publish this edited hole as the daily', box);
        var bankB = elt('button', 'width:100%;margin-top:6px;padding:9px;background:linear-gradient(180deg,#b8862a,#6a4a10);color:#fff;font:700 12px Georgia;cursor:pointer;', 'Bank this hole for later', box);
        var ownerDo = function (fn, okMsg) {
          var pass = (passIn.value || '').trim(); if (!pass) { edToast('Enter the owner passcode', false); return; }
          try { sessionStorage.setItem('pg_owner_pass', pass); } catch (e) { }
          var nm = (nin.value || '').trim() || 'Daily Hole'; ED.draft.name = nm; var ser = edSerialize();
          fn(pass, nm, ser).then(function () { close(); edToast(okMsg); }, function (e) { edToast(/unauth/i.test(e.message || '') ? 'Wrong passcode' : ('Failed: ' + e.message), false); });
        };
        pubB.onclick = function () {
          var day = dayIn.value || NET().todayKey();
          var doPub = function () { ownerDo(function (p, nm, ser) { return NET().publishDaily(p, day, nm, null, ser); }, 'Published for ' + day + ' — live now'); };
          pubB.disabled = true; pubB.textContent = 'Testing it\'s beatable…';
          setTimeout(function () {
            var res = testDraftBeatable(ED.draft, 12, 12);
            pubB.disabled = false; pubB.textContent = 'Publish this edited hole as the daily';
            if (res.beatable) { edToast('Auto-tester sank it in ' + res.strokes + ' — publishing'); doPub(); }
            else edConfirm('The auto-tester could NOT sink this hole in 12 tries — players may find it unbeatable. Publish as the daily anyway?', doPub);
          }, 40);
        };
        bankB.onclick = function () { ownerDo(function (p, nm, ser) { return NET().saveBank(p, nm, null, ser, null); }, 'Banked '); };
      }
      if (ED.draft._ov != null) {
        var oi = ED.draft._ov, bn = (HOLES[oi] && HOLES[oi]().name) || ('#' + (oi + 1));
        elt('div', 'border-top:1px solid #5a3a1a;margin:13px 0 9px;', null, box);
        elt('div', 'font-size:11px;opacity:.85;margin-bottom:6px;line-height:1.4;', 'This is campaign Level #' + (oi + 1) + ' · ' + bn + '. Save your edits straight back into it — it\'ll play this version every time, even after a reload:', box);
        var ob = elt('button', 'width:100%;padding:11px;background:linear-gradient(180deg,#b8862a,#6a4a10);color:#fff;font:800 13px Georgia;cursor:pointer;', 'Save into Level #' + (oi + 1) + ' (campaign)', box);
        ob.onclick = function () { if (saveOver(oi, edSerialize())) { close(); edToast('Saved into Level #' + (oi + 1) + ' — plays every time'); } else edToast('Save failed: storage full', false); };
        if (hasOver(oi)) { var rvb = elt('button', 'width:100%;margin-top:6px;padding:8px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:700 11px Georgia;cursor:pointer;', '↺ Revert Level #' + (oi + 1) + ' to original', box); rvb.onclick = function () { edConfirm('Revert Level #' + (oi + 1) + ' to the original built-in? Your saved edits for it are removed.', function () { clearOver(oi); close(); edToast('Reverted to original'); }); }; }
      }
      setTimeout(function () { nin.focus(); nin.select(); }, 40);
    });
  }
  function edLoad() { var s = edStore(), names = Object.keys(s); if (!names.length) { alert('No saved levels yet.'); return; } var pick = prompt('Load which level?\n\n' + names.map(function (n, i) { return (i + 1) + ') ' + n; }).join('\n'), '1'); if (!pick) return; var n = names[parseInt(pick, 10) - 1] || (s[pick] ? pick : null); if (!n || !s[n]) { alert('Not found.'); return; } ED.draft = edDeserialize(s[n]); ED.sel = null; edPanel(); }
  function edExport() {
    var json = JSON.stringify(edSerialize(), null, 2);
    edModal('⇪ EXPORT LEVEL', function (box, close) {
      elt('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', 'Copy this JSON, or download it as a .json file:', box);
      var ta = elt('textarea', 'width:100%;height:150px;padding:8px;background:#1a1109;color:#cfe;font:11px monospace;resize:vertical;', null, box); ta.value = json; ta.readOnly = true;
      var rb = elt('div', 'display:flex;gap:6px;margin-top:8px;', null, box);
      var cp = elt('button', 'flex:1;padding:10px;background:linear-gradient(180deg,#3a6a8a,#1f3850);color:#dff;font:800 12px Georgia;cursor:pointer;', '⧉ Copy', rb);
      cp.onclick = function () { ta.select(); try { document.execCommand('copy'); } catch (e) { } try { if (navigator.clipboard) navigator.clipboard.writeText(json); } catch (e) { } edToast('Copied '); };
      var dl = elt('button', 'flex:1;padding:10px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 12px Georgia;cursor:pointer;', '⇩ Download .json', rb);
      dl.onclick = function () { try { var blob = new Blob([json], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = (ED.draft.name || 'level').replace(/[^a-z0-9_-]+/gi, '_') + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); edToast('Downloaded '); } catch (e) { edToast('Download blocked — use Copy', false); } };
      setTimeout(function () { ta.select(); }, 50);
    });
  }
  function edImport() {
    edModal('⇩ IMPORT LEVEL', function (box, close) {
      elt('div', 'font-size:11px;opacity:.8;margin-bottom:4px;', 'Paste level JSON below, or choose a .json file:', box);
      var ta = elt('textarea', 'width:100%;height:130px;padding:8px;background:#1a1109;color:#cfe;font:11px monospace;resize:vertical;', null, box); ta.placeholder = '{ … level json … }';
      var fi = elt('input', 'margin:8px 0;color:#f5efdc;font:11px Georgia;width:100%;', null, box); fi.type = 'file'; fi.accept = '.json,application/json';
      fi.onchange = function () { var f = fi.files && fi.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { ta.value = rd.result; }; rd.readAsText(f); };
      var lb = elt('button', 'width:100%;padding:11px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 13px Georgia;cursor:pointer;', '⇩ Load this level', box);
      lb.onclick = function () { var t = (ta.value || '').trim(); if (!t) { edToast('Paste JSON or pick a file', false); return; } try { var o = JSON.parse(t); edSnapshot(); ED.draft = edDeserialize(o); ED.sel = null; close(); edPanel(); edToast('Imported "' + (ED.draft.name || 'level') + '" '); } catch (e) { edToast('Bad JSON — check the text', false); } };
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
    recSample(dt); ghostStep(dt);
  }
  function tick(dt) { if (St.slowT > 0) { St.slowT = Math.max(0, St.slowT - dt); dt *= 0.45; } St.acc += dt; var fx = 1 / K.hz, guard = 0; while (St.acc >= fx && guard++ < 90) { physStep(fx); St.acc -= fx; } stepVisuals(dt); }
  function frame(ts) { var dt = Math.min(0.05, (ts - St.last) / 1000 || 0); St.last = ts; var _g1 = document.getElementById('glassTL'), _g2 = document.getElementById('glassTR'), _g3 = document.getElementById('glassPM'); if (_g1) { var _gd = (ED.on || St.state === 'load') ? 'none' : 'block'; _g1.style.display = _gd; if (_g2) _g2.style.display = _gd; if (_g3) _g3.style.display = (!ED.on && St.state === 'aim') ? 'block' : 'none'; } if (ED.on) { if (ED.view3d) { if (ED.dirty3d) { ED.dirty3d = false; buildScene(ED.draft); } St.t += dt; var hh = St.hole; for (var wi = 0; wi < (hh.windmills || []).length; wi++) hh.windmills[wi].ang += hh.windmills[wi].speed * dt; for (var ei = 0; ei < (hh.enemies || []).length; ei++) { var en = hh.enemies[ei]; en.ph += en.speed * dt; var eu = Math.abs((en.ph % 2) - 1); en.cx = en.x + (en.ex - en.x) * eu; en.cz = en.z + (en.ez - en.z) * eu; } syncMeshes(); orbitCam(); renderGL(); if (St.hctx) draw3DHud(St.hctx); } else if (St.hctx) drawEditor(St.hctx); requestAnimationFrame(frame); return; } if (St.state !== 'load') tick(dt); drawHUD(); requestAnimationFrame(frame); }
  function resize() { var r = St.scene.getBoundingClientRect(); St.dpr = Math.min(2, window.devicePixelRatio || 1); St.w = r.width; St.h = r.height; St.hud.width = Math.round(St.w * St.dpr); St.hud.height = Math.round(St.h * St.dpr); if (R3.ready) { R3.r.setSize(St.w, St.h, false); R3.cam.aspect = St.w / St.h; R3.cam.updateProjectionMatrix(); } if (ED.on) edToolbarLabels(); }
  function audioUI() {
    var dock = document.getElementById('snd'); if (!dock) return;
    var mb = document.getElementById('mute');
    var panel = elt('div', 'position:absolute;right:0;bottom:48px;width:210px;padding:12px 13px;background:linear-gradient(180deg,#2a1c10,#160d06);color:#f3eedd;font:12px Georgia;display:none;', null, dock);
    AU.panel = panel;
    elt('div', 'font:900 13px Wantedo,Georgia;color:#ffffff;letter-spacing:1px;margin-bottom:10px;text-align:center;', 'AUDIO', panel);
    function row(label, key) {
      var r = elt('div', 'margin-bottom:9px;', null, panel);
      var top = elt('div', 'display:flex;justify-content:space-between;margin-bottom:3px;', null, r);
      elt('span', 'color:#ffffff;', label, top);
      var val = elt('span', 'color:#ffffff;font-weight:700;', Math.round(AU[key] * 100) + '%', top);
      var sl = elt('input', 'width:100%;accent-color:#ffffff;cursor:pointer;', null, r); sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '5'; sl.value = String(Math.round(AU[key] * 100));
      sl.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      sl.addEventListener('input', function () { AU[key] = clamp((+sl.value) / 100, 0, 1); val.textContent = Math.round(AU[key] * 100) + '%'; if (!AU.ctx) audioInit(); musicStart(); audioApply(); audioSavePrefs(); });
      return sl;
    }
    row('Master', 'master'); row('Music', 'music'); row('SFX', 'sfx');
    var btnrow = elt('div', 'display:flex;gap:6px;margin-top:4px;', null, panel);
    var BCSS = 'flex:1;padding:7px;background:linear-gradient(180deg,#6a4628,#3a2614);color:#ffffff;font:800 11px Georgia;cursor:pointer;';
    var mt = elt('button', BCSS, AU.on ? 'ON' : 'OFF', btnrow);
    mt.addEventListener('click', function (e) { e.stopPropagation(); AU.on = !AU.on; mt.textContent = AU.on ? 'ON' : 'OFF'; if (AU.on) { if (!AU.ctx) audioInit(); musicStart(); } audioApply(); audioSavePrefs(); if (mb) mb.textContent = AU.on ? "SND" : "OFF"; });
    var nx = elt('button', BCSS, 'Track', btnrow);
    nx.addEventListener('click', function (e) { e.stopPropagation(); if (!AU.ctx) audioInit(); if (!AU.started) musicStart(); else musicNext(); });
    if (mb) { mb.textContent = AU.on ? "SND" : "OFF"; mb.title = 'Audio & volume'; mb.addEventListener('click', function (e) { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }); }
  }
  /* ================================================================ DAILY · GHOSTS · SHARING
     The viral loop: one daily hole, record your run, race other players' ghosts, share your score. */
  var DAILY_EPOCH = Date.UTC(2026, 0, 1);
  function dailyNum() { return Math.max(1, Math.floor((Date.now() - DAILY_EPOCH) / 86400000) + 1); }
  function dailyIndexFor(n) { return 27 + ((((n * 7 + 5) % 4) + 4) % 4); }   // deterministic APPROACHABLE weird hole (27-30: organic snakes + branching forks, all SINGLE-green) — the multi-island holes (31-35) are too hard for a casual daily, so the fallback avoids them. Owner should publish generated single-green holes for variety.
  function dailyIndex() { return dailyIndexFor(dailyNum()); }            // spread across all 36 holes
  function dailyNumFor(ymd) { try { var t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); return Math.max(1, Math.floor((t - DAILY_EPOCH) / 86400000) + 1); } catch (e) { return dailyNum(); } }
  function pastDayKey(daysAgo) { var net = NET(); var base = net ? net.todayKey() : new Date().toISOString().slice(0, 10); try { var d = new Date(base + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - daysAgo); return d.toISOString().slice(0, 10); } catch (e) { return base; } }
  function shareBase() { return location.origin + (location.pathname || '/game.html'); }
  function msToNextDaily() { var now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0); return Math.max(0, next - now.getTime()); }
  function fmtCountdown() { var ms = msToNextDaily(), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000); var p = function (x) { return (x < 10 ? '0' : '') + x; }; return 'Next daily in ' + h + 'h ' + p(m) + 'm ' + p(s) + 's'; }
  // ---- run recording (powers ghosts + highlight GIF) ----
  function recStart(hi) { St.rec = { hi: hi, par: (St.hole ? St.hole.par : 3), name: (St.hole ? St.hole.name : ''), shots: [], path: [], acc: 0 }; }
  function recShot() { if (!St.rec) return; var b = primeBall(); St.rec.shots.push({ i: St.rec.path.length, p: St.power, y: St.aimYaw, fx: b ? Math.round(b.x) : 0, fz: b ? Math.round(b.z) : 0 }); }
  function recSample(dt) { if (!St.rec || St.state !== 'roll') return; St.rec.acc += dt; if (St.rec.acc < 0.05) return; St.rec.acc = 0; var b = primeBall(); if (!b) return; St.rec.path.push([Math.round(b.x), Math.round(b.y), Math.round(b.z)]); if (St.rec.path.length > 1600) St.rec.path.shift(); }
  // ---- ghost encode/decode for shareable links ----
  function encGhost(rec) {
    try { var o = { h: rec.hi, par: rec.par, s: rec.shots.map(function (sh) { return [sh.i, +(+sh.p).toFixed(3), +(+sh.y).toFixed(3)]; }), p: [] };
      var cp = capReplay(rec.path);   // bound the encoded path so a long run doesn't make a ~16KB challenge link / DB row / fetch
      for (var i = 0; i < cp.length; i++) { o.p.push(cp[i][0], cp[i][1], cp[i][2]); }
      // URL-SAFE base64 (+ -> -, / -> _, strip =) so the ghost survives a URL hash parsed by URLSearchParams (where + would become a space)
      return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); } catch (e) { return ''; }
  }
  function decGhost(str) {
    try { var b = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';   // accept URL-safe AND legacy base64
      var o = JSON.parse(decodeURIComponent(escape(atob(b)))); var path = [];
      for (var i = 0; i + 2 < o.p.length; i += 3) path.push([o.p[i], o.p[i + 1], o.p[i + 2]]);
      return { hi: o.h, par: o.par, path: path, shots: (o.s || []).map(function (a) { return { i: a[0], p: a[1], y: a[2] }; }), t: 0, playing: false }; } catch (e) { return null; }
  }
  // ---- ghost playback (translucent rival ball) ----
  function ghostStep(dt) { var g = St.ghost; if (g && g.playing && g.path && g.path.length) g.t += dt; }
  function syncGhost() {
    var g = St.ghost;
    if (!g || !g.path || !g.path.length || !g.playing) { if (R3.ghostMesh) R3.ghostMesh.visible = false; return; }
    if (!R3.ghostMesh) { var gm = new T.Mesh(new T.SphereGeometry(K.R * 1.04, 24, 16), new T.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: .42, depthWrite: false })); if (R3.group) R3.group.add(gm); R3.ghostMesh = gm; }
    var fps = 20, f = g.t * fps, i = Math.floor(f), fr = f - i, last = g.path.length - 1;
    if (i >= last) { i = last; fr = 0; }
    var a = g.path[i], b = g.path[Math.min(i + 1, last)];
    R3.ghostMesh.visible = true; R3.ghostMesh.position.set(a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr + 1, a[2] + (b[2] - a[2]) * fr);
  }
  // ---- player handle (for the leaderboard) ----
  function playerName() { try { return localStorage.getItem('pg_name') || ''; } catch (e) { return ''; } }
  function setPlayerName(n) { try { localStorage.setItem('pg_name', (n || '').slice(0, 24)); } catch (e) { } if (St.pendingTeam && n) joinPendingTeam((n || '').slice(0, 24)); }
  // ---- team membership (team-vs-team daily competition) ----
  function getTeam() { try { return JSON.parse(localStorage.getItem('pg_team') || 'null'); } catch (e) { return null; } }
  function setTeam(t) { try { if (t) localStorage.setItem('pg_team', JSON.stringify(t)); else localStorage.removeItem('pg_team'); } catch (e) { } }
  // one-tap team invite: ?team=CODE stashes St.pendingTeam; this joins it once we have a player name
  function joinPendingTeam(name) {
    if (!St.pendingTeam || !name) return; var net = NET(); if (!net) return;
    var code = St.pendingTeam; St.pendingTeam = null;   // consume so we only try once
    net.joinTeam(code, name).then(function (j) { if (j && j.team_id) { setTeam({ id: j.team_id, name: j.name, code: code }); socialToast('Joined team “' + j.name + '”! Race today’s daily for your crew.'); } });
  }
  // ---- daily play streak (retention) ----
  function prevDay(ymd) { try { var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); } catch (e) { return ''; } }
  function streakUpdate(day) {
    var s; try { s = JSON.parse(localStorage.getItem('pg_streak') || 'null'); } catch (e) { s = null; }
    if (!s || typeof s.count !== 'number') s = { count: 0, last: '' };
    if (s.last === day) return s.count;                 // already counted today
    s.count = (s.last === prevDay(day)) ? s.count + 1 : 1;   // continue or restart
    s.last = day;
    try { localStorage.setItem('pg_streak', JSON.stringify(s)); } catch (e) { }
    return s.count;
  }
  // ---- lifetime career stats (progression / retention) ----
  function statsGet() { try { var s = JSON.parse(localStorage.getItem('pg_stats') || 'null'); return (s && typeof s.played === 'number') ? s : { played: 0, over: 0, beat: 0, ace: 0, lastDay: '' }; } catch (e) { return { played: 0, over: 0, beat: 0, ace: 0, lastDay: '' }; } }
  function statsUpdate(day, over, beatGhost, ace) {
    var s = statsGet(); if (day && s.lastDay === day) return s;   // count each day once
    s.played++; s.over += (over || 0); if (beatGhost) s.beat++; if (ace) s.ace++; s.lastDay = day || s.lastDay;
    try { localStorage.setItem('pg_stats', JSON.stringify(s)); } catch (e) { } return s;
  }
  // ---- one-shot-per-day lock (Wordle-style; replays are practice and don't post) ----
  function dailyDone() { try { return JSON.parse(localStorage.getItem('pg_daily_done') || 'null'); } catch (e) { return null; } }
  function markDailyDone(day, strokes, rec) {
    if (!day) return; var d = dailyDone(); if (d && d.day === day && d.strokes <= strokes) return;   // keep your best of the day
    var o = { day: day, strokes: strokes };
    if (rec) { o.par = rec.par; o.hi = rec.hi; o.holeName = rec.name || (St.hole && St.hole.name) || ''; try { o.ghost = encGhost(rec); } catch (e) { } }
    try { localStorage.setItem('pg_daily_done', JSON.stringify(o)); } catch (e) { }
  }
  function alreadyPlayedToday(day) { var d = dailyDone(); return !!(d && day && d.day === day); }
  // revisit: rebuild a rec from the stored result and show the card again — no replay needed (Wordle-style)
  function reviewStoredDaily() {
    var st = dailyDone(); if (!st || !st.ghost || st.day !== St.dailyDay) return false;
    var g = decGhost(st.ghost); if (!g) return false;
    St.strokes = st.strokes;
    St.rec = { hi: (st.hi != null ? st.hi : St.hi), par: (st.par != null ? st.par : (St.hole ? St.hole.par : 3)), name: st.holeName || (St.hole && St.hole.name) || 'the hole', shots: g.shots, path: g.path, acc: 0 };
    showDailyCard(St.rec); return true;
  }
  var NET = function () { return (typeof PGNet !== 'undefined') ? PGNet : (window.PGNet || null); };
  // ---- enter the daily hole (built-in index path) ----
  function loadDaily(idx, ghost) {
    if (!(idx >= 0 && idx < 36)) idx = dailyIndex();
    St.setBase = Math.floor(idx / 9) * 9; St.scores = St.scores || []; St.parDone = 0;
    loadHole(idx);
    St.daily = true; St.dailyN = dailyNum(); recStart(idx); St.dailyPractice = alreadyPlayedToday(St.dailyDay);
    if (ghost && ghost.path && ghost.path.length) { St.ghost = ghost; St.ghost.playing = false; St.ghost.t = 0; St.ghostStrokes = (ghost.cs != null ? ghost.cs : (ghost.shots && ghost.shots.length)) || null; St.ghostName = ghost.name || St.ghostName || 'your challenger'; St.challenged = !!ghost.name; }
    St.banner = 'DAILY #' + St.dailyN + (St.dailyPractice ? ' · PRACTICE' : '') + ' · ' + (St.dailyTitle || St.hole.name); St.bannerT = 2.6;
  }
  // ---- enter the daily hole (owner-published custom hole_json) ----
  function loadDailyDraft(holeJson, title, ghost) {
    try {
      var d = edDeserialize(holeJson); St.setBase = 0; St.dailyTitle = title || d.name;
      playDraftInGame(d, null, title || d.name); St.hi = -1;
      St.daily = true; St.dailyN = dailyNum(); recStart(-1); St.dailyPractice = alreadyPlayedToday(St.dailyDay);
      if (ghost && ghost.path && ghost.path.length) { St.ghost = ghost; St.ghost.playing = false; St.ghost.t = 0; St.ghostStrokes = (ghost.cs != null ? ghost.cs : (ghost.shots && ghost.shots.length)) || null; St.ghostName = ghost.name || St.ghostName || 'your challenger'; St.challenged = !!ghost.name; }
      St.banner = 'DAILY #' + St.dailyN + (St.dailyPractice ? ' · PRACTICE' : '') + ' · ' + St.dailyTitle; St.bannerT = 2.6;
    } catch (e) { loadDaily(dailyIndex(), ghost); }
  }
  // ---- the async daily orchestrator: published hole + real rival ghost ----
  function enterDaily(explicitIdx, ghost) {
    var net = NET(); St.dailyDay = net ? net.todayKey() : null; St.dailyTitle = null; St.dailySubmitted = false; St.ghostName = null;
    St.archive = false; St.archiveDaysAgo = 0;
    St.dailyPractice = alreadyPlayedToday(St.dailyDay);   // replaying today = practice (won't post)
    var ch = document.getElementById('pg-chooser'); if (ch) ch.remove();
    if (explicitIdx != null) { loadDaily(explicitIdx, ghost); afterDailyLoaded(ghost); return; }   // shared ?daily=N → that exact hole
    if (net && net.enabled) {
      net.fetchDaily(St.dailyDay).then(function (d) {
        if (d && d.hole_json) loadDailyDraft(d.hole_json, d.title, ghost);
        else if (d && d.hole_index != null) { St.dailyTitle = d.title; loadDaily(d.hole_index, ghost); }
        else loadDaily(dailyIndex(), ghost);
        afterDailyLoaded(ghost);
      }, function () { loadDaily(dailyIndex(), ghost); afterDailyLoaded(ghost); });
    } else { loadDaily(dailyIndex(), ghost); afterDailyLoaded(ghost); }
  }
  // ---- archive: play a PAST day's hole (casual; never posts / counts) ----
  function enterPastDaily(daysAgo) {
    var net = NET(); if (!net) return;
    var day = pastDayKey(daysAgo), n = dailyNumFor(day);
    St.dailyDay = day; St.archive = true; St.archiveDaysAgo = daysAgo; St.dailyTitle = null; St.dailySubmitted = false; St.ghostName = null; St.dailyPractice = true;
    var sc = document.getElementById('pg-daily'); if (sc) sc.remove();
    var ch = document.getElementById('pg-chooser'); if (ch) ch.remove();
    var fin = function () { St.archive = true; St.archiveDaysAgo = daysAgo; St.dailyPractice = true; St.dailyN = n; St.banner = 'ARCHIVE · DAILY #' + n + ' · ' + (St.dailyTitle || St.hole.name); St.bannerT = 2.6; afterDailyLoaded(null); };
    if (net.enabled) {
      net.fetchDaily(day).then(function (d) {
        if (d && d.hole_json) loadDailyDraft(d.hole_json, d.title, null);
        else if (d && d.hole_index != null) { St.dailyTitle = d.title; loadDaily(d.hole_index, null); }
        else loadDaily(dailyIndexFor(n), null);
        fin();
      }, function () { loadDaily(dailyIndexFor(n), null); fin(); });
    } else { loadDaily(dailyIndexFor(n), null); fin(); }
  }
  // one-time how-to-play coachmark for brand-new players (incoming shared-link traffic)
  function showHowTo() {
    if (St.dailyPractice || St.archive) return;
    if (document.getElementById('pg-howto')) return;
    var seen = false; try { seen = !!localStorage.getItem('pg_seen_howto'); } catch (e) { }
    var hasName = !!playerName();
    if (seen && hasName) return;   // returning, named player → straight to play
    var ov = elt('div', 'position:fixed;left:50%;top:46%;transform:translate(-50%,-50%);z-index:9000;width:min(400px,92vw);background:rgba(12,8,4,.4);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:none;padding:22px;text-align:center;', null, document.body); ov.id = 'pg-howto';
    elt('div', 'font:900 13px Wantedo,Georgia;color:#ffffff;letter-spacing:2px;', 'GUNSLINGERS DAILY #' + dailyNum(), ov);
    elt('div', 'font:900 23px Wantedo,Georgia;color:#ffffff;margin:1px 0 12px;', St.dailyTitle || (St.hole ? St.hole.name : 'TODAY’S HOLE'), ov);
    var nin = null;
    if (!hasName) {
      elt('div', 'font:700 14px Georgia;color:#f3eedd;margin-bottom:7px;', 'What do they call you, partner?', ov);
      nin = elt('input', 'width:100%;padding:12px;background:rgba(0,0,0,.3);border:none;outline:none;color:#f5efdc;font:16px Georgia;text-align:center;margin-bottom:14px;', null, ov);
      nin.placeholder = 'Your name'; nin.maxLength = 24; setTimeout(function () { try { nin.focus(); } catch (e) { } }, 60);
    }
    elt('div', 'font:600 13px Georgia;color:#ffffff;line-height:1.5;margin-bottom:15px;', 'Pull BACK from the ball and let go — like a slingshot. Aim any way, pull farther for power. Sink it in as few shots as you can!', ov);
    var b = elt('button', 'background:transparent;border:none;color:#ffffff;font:900 19px Wantedo,Georgia;cursor:pointer;', '▶ PLAY TODAY’S HOLE', ov);
    var go = function () { if (nin) { var v = (nin.value || '').trim(); if (v) setPlayerName(v); } dismissHowTo(); };
    b.onclick = go;
    if (nin) nin.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }
  function dismissHowTo() { try { localStorage.setItem('pg_seen_howto', '1'); } catch (e) { } var h = document.getElementById('pg-howto'); if (h) h.remove(); }
  function afterDailyLoaded(urlGhost) {
    showHowTo();
    if (St.pendingTeam && playerName()) setTimeout(function () { joinPendingTeam(playerName()); }, 900);   // invited via ?team= and already named → auto-join
    var net = NET(); if (!net || !net.enabled || !St.dailyDay) return;
    var recHi = St.hi;   // the daily's hole layout (>=0 for seeded/published-index; -1 for custom) — for the all-time course record
    Promise.all([net.daySummary(St.dailyDay), urlGhost ? Promise.resolve(null) : net.fetchGhosts(St.dailyDay, 3), net.courseRecord(recHi)]).then(function (res) {
      if (!St.daily) return;
      var sum = res[0], rows = res[1];
      St.courseRecord = res[2] || null;                       // best score ever on this hole (before this run)
      if (!urlGhost && rows && rows.length && !St.ghost) {   // race the best real player ghost that ISN'T you
        var me = playerName(), pick = null;
        for (var ri = 0; ri < rows.length; ri++) { if (rows[ri].name !== me) { pick = rows[ri]; break; } }
        if (pick) { var g = decGhost(pick.ghost); if (g) { g.playing = false; g.t = 0; St.ghost = g; St.ghostName = pick.name; St.ghostStrokes = pick.strokes; St.leaderGhost = { path: g.path, name: pick.name, strokes: pick.strokes }; } }
      }
      St.daySummary = sum || null;                           // for the difficulty line on the card
      var parts = [];                                        // one social-proof toast up front
      if (St.dailyPractice) parts.push('Practice — you already played today');
      else if (St.challenged && St.ghostName && St.ghostStrokes != null) parts.push('' + St.ghostName + ' challenged you — beat ' + St.ghostStrokes);
      else if (St.ghostName && St.ghostStrokes != null) parts.push('racing ' + St.ghostName);
      if (sum && sum.players > 0) { parts.push('' + sum.players + ' today'); if (sum.best != null) parts.push('best ' + sum.best); }
      socialToast(parts.length ? parts.join('  ·  ') : 'Be the first to post today’s score!');
      // revisit (already played today) → show the stored result card instead of making them replay
      if (St.dailyPractice && !document.getElementById('pg-daily')) { var sd = dailyDone(); if (sd && sd.ghost && sd.day === St.dailyDay) setTimeout(reviewStoredDaily, 350); }
    }).catch(function () { });
  }
  // ---- the share card shown on finishing the daily hole ----
  function copyText(str, okMsg) {
    function done() { socialToast(okMsg || 'Copied '); }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(str).then(done, function () { legacyCopy(str); done(); }); return; } } catch (e) { }
    legacyCopy(str); done();
  }
  function legacyCopy(str) { try { var ta = document.createElement('textarea'); ta.value = str; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) { } }
  function socialToast(msg) {
    var t = elt('div', 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;padding:11px 20px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 14px Georgia;pointer-events:none;opacity:0;transition:opacity .2s;', msg, document.body);
    requestAnimationFrame(function () { t.style.opacity = '1'; }); setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 1800);
  }
  // varied CTA so the shared feed looks organic, not templated — stable per player+day, different across players
  var SHARE_CTAS = ['Can you beat me?', 'Your move, partner.', 'Think you can do better?', 'Beat my score, gunslinger.', 'Reckon you can top that?', 'Step up and take your shot.', 'Bet you can’t beat it.', 'Your turn — draw!'];
  function dailyCTA() { return SHARE_CTAS[(nameHash(playerName() || 'anon') + (St.dailyN || 0)) % SHARE_CTAS.length]; }
  // shared "everyone's struggling with this one" difficulty read — needs enough of a sample to be meaningful
  function difficultyLine(sum) {
    if (!sum || sum.players < 3 || sum.avg_over == null) return null;
    var a = Number(sum.avg_over);
    var label = a >= 1.5 ? 'Brutal hole today' : a >= 0.6 ? 'Playing tough today' : a > -0.4 ? '◎ A fair test today' : 'Easy par day';
    return label + ' — field avg ' + (a === 0 ? 'even' : (a > 0 ? '+' + a : String(a)));
  }
  function shareStrings(rec) {
    var n = St.dailyN, name = rec.name || (St.hole && St.hole.name) || 'the hole', strokes = St.strokes, par = rec.par, over = strokes - par;
    var verdict = strokes === 1 ? 'HOLE IN ONE! ' : over <= -2 ? 'EAGLE ' : over === -1 ? 'BIRDIE ' : over === 0 ? 'PAR ' : over === 1 ? 'BOGEY ' : '+' + over + ' ';
    var overStr = over === 0 ? 'E' : (over > 0 ? '+' + over : String(over));
    var bar = ''; for (var k = 0; k < Math.min(strokes - 1, 11); k++) bar += '●'; bar += '◎';
    var link = shareBase() + '?daily' + (rec.hi >= 0 ? '=' + rec.hi : '');   // custom (hi<0) -> '?daily' = today's published
    var vs = '';
    if (St.ghostStrokes != null && St.ghostName) { vs = (strokes < St.ghostStrokes) ? '\nBeat ' + St.ghostName + ' (' + strokes + ' vs ' + St.ghostStrokes + ')' : (strokes === St.ghostStrokes) ? '\nTied ' + St.ghostName + ' (' + strokes + ')' : ''; }
    var streak = (St.streak > 1) ? '\n' + St.streak + '-day streak' : '';
    var rank = (St.standing && St.standing.total > 1) ? '\n#' + St.standing.rank + ' of ' + St.standing.total + ' today' : '';
    var diff = '';   // shared-difficulty hook on notable days (≥3 players); only the extremes are share-worthy
    if (St.daySummary && St.daySummary.players >= 3 && St.daySummary.avg_over != null) {
      var da = Number(St.daySummary.avg_over);
      if (da >= 1.5) diff = '\nBrutal one — field avg +' + da; else if (da < -0.4) diff = '\nEveryone’s acing it — field avg ' + da;
    }
    var record = '';   // course-record brag (huge viral hook) — only on live, fixed-layout runs
    if (rec.hi >= 0 && !St.archive && !St.dailyPractice) { var cr = St.courseRecord; if (!cr || strokes < cr.best) record = '\nNEW COURSE RECORD'; else if (strokes === cr.best) record = '\nTied the course record'; }
    var text = 'Gunslingers Daily #' + n + '\n' + name + ' — ' + strokes + ' strokes (' + overStr + ') ' + (over <= -1 || strokes === 1 ? '' : '') + '\n' + bar + vs + record + streak + rank + diff + '\n' + dailyCTA() + ' ' + link + '\n#GunslingersGolf';
    var who = (playerName() || '').slice(0, 24);   // personalize the challenge so the recipient sees who dared them
    var ghostLink = link + '#g=' + encGhost(rec) + (who ? '&n=' + encodeURIComponent(who) : '') + '&s=' + strokes;
    return { text: text, link: link, ghostLink: ghostLink, verdict: verdict, over: over, overStr: overStr, strokes: strokes, par: par, name: name, n: n };
  }
  function dailyFinish() {
    var rec = St.rec; if (!rec) return;
    var cu = St.hole.cup; rec.path.push([Math.round(cu.x), Math.round(St.hole.terrain(cu.x, cu.z) + K.R), Math.round(cu.z)]);
    if (!St.dailyPractice) { St.streak = streakUpdate(St.dailyDay || new Date().toISOString().slice(0, 10)); markDailyDone(St.dailyDay, St.strokes, rec); statsUpdate(St.dailyDay, St.strokes - rec.par, (St.ghostStrokes != null && St.strokes < St.ghostStrokes), St.strokes === 1); } St.standing = null;
    showDailyCard(rec);
  }
  function submitDailyRun(rec, nm) {
    var net = NET(); if (!net || !net.enabled || !St.dailyDay || St.dailyPractice || St.archive) return Promise.resolve(null);
    if (St.dailySubmitted) return Promise.resolve(true);
    St.dailySubmitted = true; setPlayerName(nm);
    return net.submitRun(St.dailyDay, nm, St.strokes, rec.par, encGhost(rec)).then(function (ok) { if (ok === false) St.dailySubmitted = false; return ok; });   // reset so a retry can resubmit
  }
  // downsample a path so a long/struggly run doesn't play a 30-80s replay (cap ~14s at 20fps)
  function capReplay(path) {
    var max = 280; if (!path || path.length <= max) return (path || []).slice();
    var step = path.length / max, out = []; for (var i = 0; i < max; i++) out.push(path[Math.floor(i * step)]); out.push(path[path.length - 1]); return out;
  }
  // pick the most shareable segment of the run: your BEST shot — the one whose ball-path covered the
  // most ground (a long drive, bank, loop or sinking putt) — NOT just the final tap-in.
  function highlightSubPath(rec) {
    var path = rec.path || []; if (path.length < 4) return path.slice();
    var shots = rec.shots || [], n = path.length;
    var bestStart = -1, bestEnd = -1, bestLen = -1;
    for (var k = 0; k < shots.length; k++) {
      var si = shots[k].i | 0, ei = (k + 1 < shots.length) ? (shots[k + 1].i | 0) : n;
      if (si < 0) si = 0; if (ei > n) ei = n;
      if (ei - si < 4) continue;   // too short to read as a highlight
      var d = 0; for (var j = si; j + 1 < ei; j++) { var a = path[j], b = path[j + 1]; if (a && b) { var dx = a[0] - b[0], dz = a[2] - b[2]; d += Math.sqrt(dx * dx + dz * dz); } }
      if (d > bestLen) { bestLen = d; bestStart = si; bestEnd = ei; }
    }
    var startI, endI;
    if (bestStart >= 0) { startI = bestStart; endI = bestEnd; }       // your biggest shot
    else { startI = Math.max(0, n - 26); endI = n; }                   // fallback (capped/decoded ghosts): last chunk
    var sub = path.slice(startI, endI), MAXF = 34;
    if (sub.length > MAXF) { var step = sub.length / MAXF, ds = []; for (var i = 0; i < MAXF; i++) ds.push(sub[Math.floor(i * step)]); ds.push(sub[sub.length - 1]); sub = ds; }
    return sub;
  }
  var lastGifUrl = null;   // bound the blob-URL leak: hold at most one generated GIF object URL at a time
  // render the highlight to an animated GIF Blob (synchronous: borrows R3.cam, must not yield to the main loop)
  function makeHighlightGif(rec, label) {
    var GQ = global_GIF(); if (!GQ) return null;
    var W = 256, H = 160, sub = highlightSubPath(rec);
    if (sub.length < 2) return null;
    var tmp;
    try { tmp = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch (e) { return null; }
    tmp.setPixelRatio(1); tmp.setSize(W, H, false);
    if (T.sRGBEncoding) tmp.outputEncoding = T.sRGBEncoding;
    if (R3.r.toneMapping) { tmp.toneMapping = R3.r.toneMapping; tmp.toneMappingExposure = R3.r.toneMappingExposure; }
    var cap = document.createElement('canvas'); cap.width = W; cap.height = H; var cx = cap.getContext('2d');
    var ball = R3.ballMeshes && R3.ballMeshes[0], prevA = R3.cam.aspect, prevF = R3.cam.fov, ghostWas = R3.ghostMesh ? R3.ghostMesh.visible : false;
    if (R3.ghostMesh) R3.ghostMesh.visible = false;
    R3.cam.aspect = W / H; R3.cam.fov = 56; R3.cam.updateProjectionMatrix();
    var frames = [];
    for (var i = 0; i < sub.length; i++) {
      var c = sub[i], nx = sub[Math.min(i + 1, sub.length - 1)];
      var dx = nx[0] - c[0], dz = nx[2] - c[2], dl = hyp(dx, dz) || 1; dx /= dl; dz /= dl;
      if (ball) { ball.visible = true; ball.position.set(c[0], c[1], c[2]); }
      R3.cam.position.set(c[0] - dx * 470, c[1] + 300, c[2] - dz * 470);
      R3.cam.lookAt(c[0] + dx * 150, c[1] + 10, c[2] + dz * 150);
      try { tmp.render(R3.scene, R3.cam); } catch (e) { break; }
      cx.drawImage(tmp.domElement, 0, 0, W, H);
      cx.textAlign = 'left';
      cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(0, H - 33, W, 33);
      cx.font = '700 10px Georgia'; cx.fillStyle = '#ffffff'; cx.fillText('GUNSLINGERS DAILY #' + St.dailyN, 7, H - 20);   // brand line
      cx.font = '800 14px Georgia'; cx.fillStyle = '#fff'; cx.fillText(label || '', 7, H - 6);                            // player · score (the brag)
      frames.push(GQ.quantize(cx.getImageData(0, 0, W, H).data, W, H));
    }
    R3.cam.aspect = prevA; R3.cam.fov = prevF; R3.cam.updateProjectionMatrix();
    if (R3.ghostMesh) R3.ghostMesh.visible = ghostWas;
    try { tmp.forceContextLoss(); } catch (e) { } try { tmp.dispose(); } catch (e) { }
    if (!frames.length) return null;
    var hold = frames[frames.length - 1]; frames.push(hold); frames.push(hold); frames.push(hold);   // linger on the sink
    try { return new Blob([GQ.encode(frames, W, H, 6)], { type: 'image/gif' }); } catch (e) { return null; }
  }
  function global_GIF() { return (typeof GIFQuick !== 'undefined') ? GIFQuick : (window.GIFQuick || null); }
  function showDailyCard(rec) {
    var old = document.getElementById('pg-daily'); if (old) old.remove();
    var S = shareStrings(rec);
    var ov = elt('div', 'position:fixed;inset:0;z-index:57;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-daily';
    var _cardCss = document.createElement('style'); _cardCss.textContent = '#pg-daily button,#pg-daily a,#pg-daily input{border:none!important;outline:none;}#pg-daily input{background:rgba(0,0,0,.26);text-align:center;}'; ov.appendChild(_cardCss);   // no boxes/strokes — flat controls on the blur
    var box = elt('div', 'width:420px;max-width:94%;max-height:92%;overflow:auto;background:transparent;border:none;padding:20px;text-align:center;', null, ov); box.className = 'edscroll';
    // × dismiss — close the card and just play/look around (it auto-pops on revisit; let people get out of it)
    var closeX = elt('div', 'position:fixed;top:12px;right:16px;z-index:59;width:40px;height:40px;line-height:38px;text-align:center;font:900 26px Georgia;color:#f5efdc;cursor:pointer;background:transparent;', '×', ov);
    closeX.title = 'Close — practice this hole'; closeX.onclick = function () { ov.remove(); if ((St.state === 'sunk' || St.state === 'done') && St.hi >= 0) { try { loadHole(St.hi); } catch (e) { } } };
    elt('div', 'font:900 13px Wantedo,Georgia;color:#ffffff;letter-spacing:2px;', 'GUNSLINGERS DAILY #' + S.n, box);
    elt('div', 'font:900 26px Wantedo,Georgia;color:#ffffff;margin:2px 0 4px;', S.name, box);   // hole name = the ONE marigold accent; everything else defaults to cream/white
    if (St.streak > 1) elt('div', 'font:800 13px Georgia;color:#f5efdc;margin-bottom:6px;', '' + St.streak + '-day streak', box);
    var sc = S.over < 0 ? '#ffffff' : S.over === 0 ? '#f5efdc' : '#f5efdc';
    elt('div', 'font:900 46px Wantedo,Georgia;color:' + sc + ';line-height:1.05;', S.strokes + ' strokes', box);
    elt('div', 'font:900 18px Wantedo,Georgia;color:' + sc + ';margin-bottom:8px;', S.verdict + '  (' + S.overStr + ')', box);
    var bar = ''; for (var k = 0; k < Math.min(S.strokes - 1, 11); k++) bar += '●'; bar += '◎';
    elt('div', 'font:20px Georgia;margin:4px 0 10px;', bar, box);
    // ---- head-to-head vs the ghost you raced ----
    if (St.ghostStrokes != null && St.ghostName) {
      var won = S.strokes < St.ghostStrokes, tied = S.strokes === St.ghostStrokes;
      var hcol = won ? '#ffffff' : tied ? '#ffffff' : '#f5efdc';
      var hmsg = won ? 'You beat ' + St.ghostName + '!' : tied ? 'Dead heat with ' + St.ghostName : '' + St.ghostName + ' won this round';
      var hwrap = elt('div', 'margin:2px auto 12px;padding:6px 12px;max-width:320px;', null, box);
      elt('div', 'font:900 15px Wantedo,Georgia;color:' + hcol + ';', hmsg, hwrap);
      elt('div', 'font:700 12px Georgia;color:#ffffff;margin-top:2px;', 'You ' + S.strokes + '  ·  ' + St.ghostName + ' ' + St.ghostStrokes + (won ? '  — rub it in below ' : tied ? '' : '  — rematch & win it back'), hwrap);
    }
    // ---- shared difficulty read ----
    var diff = difficultyLine(St.daySummary);
    if (diff) elt('div', 'font:800 13px Georgia;color:#f5efdc;margin:2px auto 10px;padding:4px 12px;max-width:340px;', diff, box);
    // ---- all-time course record on this hole layout (St.courseRecord = the record BEFORE this run) ----
    if (NET() && St.hi >= 0) {
      var cr = St.courseRecord, crMsg = '', crCol = '#ffffff';
      if (!St.archive && !St.dailyPractice) {
        if (!cr) { crMsg = 'COURSE RECORD — first to conquer this hole (' + S.strokes + ')!'; crCol = '#ffffff'; }
        else if (S.strokes < cr.best) { crMsg = 'NEW COURSE RECORD! You beat ' + cr.name + '’s ' + cr.best; crCol = '#ffffff'; }
        else if (S.strokes === cr.best) { crMsg = 'You TIED the course record (' + cr.best + ' · ' + cr.name + ')'; }
        else { crMsg = 'Course record: ' + cr.best + ' by ' + cr.name; }
      } else if (cr) { crMsg = 'Course record: ' + cr.best + ' by ' + cr.name; }
      if (crMsg) elt('div', 'font:800 13px Georgia;color:' + crCol + ';margin:2px auto 10px;padding:4px 12px;max-width:340px;', crMsg, box);
    }
    // ---- post score + live leaderboard ----
    var net = NET();
    if (net && net.enabled && St.dailyDay) {
      var lbWrap = elt('div', 'margin:2px 0 12px;', null, box);
      var firstTime = !playerName() && !St.dailyPractice && !St.archive;
      if (firstTime) setPlayerName('Gunslinger' + (100 + Math.floor(Math.random() * 900)));   // EVERY finisher lands on the board — anon players get an auto-name they can change below + re-post
      if (St.archive) elt('div', 'font:800 12px Georgia;color:#f5efdc;margin-bottom:6px;line-height:1.4;', 'Archive · Daily #' + St.dailyN + ' — a past hole, just for fun (doesn’t count).', lbWrap);
      else if (St.dailyPractice) elt('div', 'font:800 12px Georgia;color:#f5efdc;margin-bottom:6px;line-height:1.4;', 'Practice round — you already played today’s daily. Scores count once a day; come back tomorrow for a fresh hole!', lbWrap);
      else if (firstTime) elt('div', 'font:800 12px Georgia;color:#f5efdc;margin-bottom:6px;', 'You’re on the board! Change your name below + tap POST to claim it.', lbWrap);
      var postRow = elt('div', 'display:flex;gap:6px;', null, lbWrap);
      var nameIn = elt('input', 'flex:1;padding:10px;background:#1a1109;color:#f5efdc;font:14px Georgia;text-align:center;', null, postRow);
      nameIn.placeholder = 'Your name'; nameIn.maxLength = 24; nameIn.value = playerName();
      nameIn.onchange = function () { var v = (nameIn.value || '').trim(); if (v) { setPlayerName(v); if (!St.dailyPractice && !St.archive) { postBtn.disabled = false; postBtn.textContent = 'POST as ' + v.slice(0, 12); postBtn.style.color = '#ffffff'; } } };   // change your name → re-post under it
      if (firstTime) { nameIn.style.borderColor = '#ffffff'; nameIn.style.boxShadow = '0 0 0 2px rgba(245,197,66,.3)'; nameIn.onfocus = function () { nameIn.style.boxShadow = '0 0 0 2px rgba(245,197,66,.6)'; }; }
      var postBtn = elt('button', 'padding:10px 16px;background:transparent;color:#f5efdc;font:900 14px Wantedo,Georgia;cursor:pointer;white-space:nowrap;', 'POST', postRow);
      if (St.dailyPractice || St.archive) { postRow.style.display = 'none'; }   // no posting on practice/archive runs
      var lbBox = elt('div', 'margin-top:10px;', null, lbWrap);
      function renderLB() {
        lbBox.textContent = '';
        if (St.standing && St.standing.total) {
          var sd = St.standing, suffix = St.archive ? '' : ' today', smsg;
          if (!St.archive && sd.rank === 1 && sd.total === 1) smsg = 'First to finish today — you set the pace!';
          else if (!St.archive && sd.rank === 1) smsg = 'You’re LEADING — #1 of ' + sd.total + ' today!';   // top of the pack — defend it
          else smsg = 'You’re #' + sd.rank + ' of ' + sd.total + suffix;
          elt('div', 'font:900 14px Wantedo,Georgia;color:#f5efdc;margin-bottom:6px;', smsg, lbBox);
        }
        elt('div', 'font:700 11px Georgia;color:#f5efdc;opacity:.8;letter-spacing:1px;margin-bottom:4px;', St.archive ? ('DAILY #' + St.dailyN + ' LEADERBOARD') : 'TODAY’S LEADERBOARD', lbBox);
        var me = playerName();
        var rowsBox = elt('div', 'max-height:200px;overflow-y:auto;', null, lbBox);   // capped + scrollable so it can't push the share buttons off-screen
        net.leaderboard(St.dailyDay, 12).then(function (rows) {
          if (!rows || !rows.length) { elt('div', 'font:600 12px Georgia;color:#ffffff;', 'Be the first to post a score!', rowsBox); return; }
          var myRow = null;
          rows.forEach(function (r, i) {
            var mine = me && r.name === me;
            var row = elt('div', 'display:flex;align-items:center;padding:4px 8px;margin:1px 0;font:13px Georgia;color:' + (mine ? '#ffffff' : '#f5efdc') + ';', null, rowsBox);
            if (mine) myRow = row;
            elt('div', 'width:26px;color:#f5efdc;font-weight:700;', (i + 1) + '.', row);
            elt('div', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:' + (mine ? '800' : '400') + ';', r.name + (mine ? ' (you)' : ''), row);
            var ov = r.par != null ? (r.strokes - r.par) : 0, oc = ov < 0 ? '#ffffff' : ov === 0 ? '#f5efdc' : '#f5efdc';
            elt('div', 'font-weight:800;color:' + oc + ';', r.strokes + (r.par != null && ov !== 0 ? (ov > 0 ? ' +' + ov : ' ' + ov) : ''), row);
          });
          if (myRow && myRow.offsetTop > rowsBox.clientHeight) rowsBox.scrollTop = myRow.offsetTop - rowsBox.clientHeight / 2;   // keep your own row in view
        });
      }
      function doPost() {
        var nm = (nameIn.value || '').trim() || 'Anon'; postBtn.disabled = true; postBtn.textContent = 'Posting…'; postBtn.style.opacity = '1';
        submitDailyRun(rec, nm).then(function (ok) {
          if (ok === false) { postBtn.disabled = false; postBtn.textContent = 'Retry post'; postBtn.style.color = '#ffffff'; return; }   // submit failed (offline?) — let them try again
          postBtn.textContent = 'Posted '; postBtn.style.color = '#ffffff';
          net.standing(St.dailyDay, nm).then(function (st) { if (st && st.total) St.standing = st; renderLB(); });
        });
      }
      postBtn.onclick = doPost;
      if (St.dailyPractice || St.archive) { renderLB(); } else { doPost(); }   // practice/archive never post; EVERY real finish auto-posts (we always have a name now)
      // ---- TEAMS: form a posse, battle other teams on the daily ----
      var teamWrap = elt('div', 'margin:6px 0 12px;padding:6px 4px;text-align:left;', null, lbWrap);
      function myTeamName() { return (playerName() || (nameIn.value || '').trim() || '').slice(0, 24); }
      function renderTeams() {
        teamWrap.textContent = '';
        elt('div', 'font:900 12px Wantedo,Georgia;color:#f5efdc;letter-spacing:1px;margin-bottom:6px;text-align:center;', 'TEAMS', teamWrap);
        var team = getTeam();
        if (team && team.id) {
          elt('div', 'font:800 13px Georgia;color:#f5efdc;text-align:center;margin-bottom:4px;', 'Your team: ' + team.name, teamWrap);
          var codeRow = elt('div', 'display:flex;gap:6px;align-items:center;justify-content:center;margin-bottom:8px;', null, teamWrap);
          elt('div', 'font:700 12px Georgia;color:#ffffff;', 'Code', codeRow);
          elt('div', 'font:900 14px Wantedo,Georgia;color:#f5efdc;letter-spacing:2px;', team.code, codeRow);
          var cpy = elt('button', 'padding:4px 10px;background:transparent;color:#f5efdc;font:800 12px Georgia;cursor:pointer;text-decoration:underline;', 'Invite', codeRow);
          cpy.onclick = function () { var jl = S.link + (S.link.indexOf('?') > -1 ? '&' : '?') + 'team=' + team.code; copyText('Join my Gunslingers posse “' + team.name + '”! One tap to join + play today’s daily ' + jl, 'Team invite copied — one tap joins them!'); };
          var tlist = elt('div', 'margin-top:2px;', null, teamWrap);
          net.teamStanding(St.dailyDay).then(function (rows) {
            if (!rows || !rows.length) { elt('div', 'font:600 12px Georgia;color:#ffffff;text-align:center;', 'No team scores yet today — rally your crew!', tlist); return; }
            elt('div', 'font:700 11px Georgia;color:#f5efdc;opacity:.8;letter-spacing:1px;margin-bottom:4px;text-align:center;', 'TEAM LEADERBOARD', tlist);
            rows.slice(0, 8).forEach(function (r, i) {
              var mine = team.id && r.team_id === team.id;
              var rw = elt('div', 'display:flex;align-items:center;padding:4px 8px;margin:2px 0;font:13px Georgia;color:#f5efdc;' + (mine ? 'background:rgba(245,197,66,.2);' : 'background:rgba(245,197,66,.06);'), null, tlist);
              elt('div', 'width:24px;color:#f5efdc;font-weight:700;', (i + 1) + '.', rw);
              elt('div', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:' + (mine ? '800' : '400') + ';', r.team + (mine ? ' (you)' : '') + ' · ' + r.members + 'p', rw);
              elt('div', 'font-weight:800;color:#f5efdc;white-space:nowrap;', 'best ' + r.best, rw);
            });
          });
          // team all-time record + current streak
          var trec = elt('div', 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(245,197,66,.15);', null, teamWrap);
          net.teamRecord(team.id).then(function (tr) {
            if (!tr || tr.best == null) return;   // no team record yet
            elt('div', 'font:800 12px Georgia;color:#f5efdc;text-align:center;', 'Team record: ' + tr.best + ' (best ball) · ' + tr.days + ' day' + (tr.days === 1 ? '' : 's') + ' played', trec);
            var cur = false; try { var dd = Date.parse(St.dailyDay + 'T00:00:00Z'), ld = Date.parse(tr.last_day + 'T00:00:00Z'); cur = (dd - ld) >= 0 && (dd - ld) <= 86400000; } catch (e) { }
            if (tr.streak >= 2 && cur) elt('div', 'font:800 12px Georgia;color:#f5efdc;text-align:center;margin-top:2px;', '' + tr.streak + '-day team streak — keep it alive!', trec);
          });
        } else {
          elt('div', 'font:600 12px Georgia;color:#ffffff;margin-bottom:6px;line-height:1.4;text-align:center;', 'Form a posse and battle other teams on the daily.', teamWrap);
          var crRow = elt('div', 'display:flex;gap:6px;margin-bottom:6px;', null, teamWrap);
          var crIn = elt('input', 'flex:1;min-width:0;padding:9px;background:#1a1109;color:#f5efdc;font:13px Georgia;text-align:center;', null, crRow); crIn.placeholder = 'New team name'; crIn.maxLength = 24;
          var crBtn = elt('button', 'padding:9px 14px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;white-space:nowrap;', 'CREATE', crRow);
          var jnRow = elt('div', 'display:flex;gap:6px;', null, teamWrap);
          var jnIn = elt('input', 'flex:1;min-width:0;padding:9px;background:#1a1109;color:#f5efdc;font:13px Georgia;text-align:center;letter-spacing:2px;', null, jnRow); jnIn.placeholder = 'Invite code'; jnIn.maxLength = 6;
          var jnBtn = elt('button', 'padding:9px 14px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;white-space:nowrap;', 'JOIN', jnRow);
          crBtn.onclick = function () {
            var tn = (crIn.value || '').trim(); if (!tn) { socialToast('Name your team first'); return; }
            var who = myTeamName(); if (!who) { socialToast('Enter your name above first'); try { nameIn.focus(); } catch (e) { } return; }
            crBtn.disabled = true; crBtn.textContent = '…';
            net.createTeam(tn).then(function (t) {
              if (!t || !t.code) { crBtn.disabled = false; crBtn.textContent = 'CREATE'; socialToast('Couldn’t create team — try again'); return; }
              setPlayerName(who);
              net.joinTeam(t.code, who).then(function () { setTeam({ id: t.id, name: t.name, code: t.code }); socialToast('Team “' + t.name + '” created — code ' + t.code); renderTeams(); });
            });
          };
          jnBtn.onclick = function () {
            var code = (jnIn.value || '').trim(); if (!code) { socialToast('Enter an invite code'); return; }
            var who = myTeamName(); if (!who) { socialToast('Enter your name above first'); try { nameIn.focus(); } catch (e) { } return; }
            jnBtn.disabled = true; jnBtn.textContent = '…';
            net.joinTeam(code, who).then(function (j) {
              if (!j || !j.team_id) { jnBtn.disabled = false; jnBtn.textContent = 'JOIN'; socialToast('No team with that code'); return; }
              setPlayerName(who); setTeam({ id: j.team_id, name: j.name, code: code.toUpperCase() }); socialToast('Joined “' + j.name + '”!'); renderTeams();
            });
          };
        }
      }
      if (!St.archive) renderTeams();   // teams compete on the live daily, not past-hole archive
    }
    var prim = 'width:100%;padding:12px;font:900 16px Wantedo,Georgia;cursor:pointer;margin-top:9px;background:transparent;letter-spacing:.5px;';
    if (navigator.share) {   // mobile: one-tap native share sheet (Messages, WhatsApp, Discord, X, …) — the most usable way to share
      var nsb = elt('button', prim + 'color:#f5efdc;', 'SHARE MY SHOT (GIF)', box);
      nsb.onclick = function () {
        var s = shareStrings(rec), origTxt = nsb.textContent;
        nsb.disabled = true; nsb.textContent = 'Rendering your shot…';
        setTimeout(function () {
          var file = null;
          try { var blob = makeHighlightGif(rec, (playerName() ? playerName().slice(0, 16) + ' · ' : '') + s.strokes + ' strokes (' + s.overStr + ')'); if (blob) file = new File([blob], 'gunslingers-daily-' + s.n + '.gif', { type: 'image/gif' }); } catch (e) { }
          nsb.disabled = false; nsb.textContent = origTxt;
          if (file && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ text: s.text, files: [file] }).catch(function () { }); }   // attach the animated highlight GIF
          else { try { navigator.share({ title: 'Gunslingers Daily #' + s.n, text: s.text }).catch(function () { }); } catch (e) { copyText(s.text, 'Result copied — paste anywhere!'); } }   // no file-share support → text only
        }, 40);
      };
    }
    var xb = elt('button', prim + 'color:#f5efdc;', 'SHARE ON X', box);
    xb.onclick = function () { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareStrings(rec).text), '_blank', 'noopener'); };
    var dc = elt('button', prim + 'color:#f5efdc;', 'COPY FOR DISCORD', box);
    dc.onclick = function () { copyText(shareStrings(rec).text, 'Result copied — paste in Discord!'); };
    var cb = elt('button', prim + 'color:#f5efdc;', 'COPY CHALLENGE LINK (+ GHOST)', box);
    cb.onclick = function () { copyText(S.ghostLink, 'Challenge link copied — friends race your ghost!'); };
    // ---- highlight GIF (a primary share asset — grouped with the share buttons) ----
    if (global_GIF()) {
      var gifWrap = elt('div', 'margin-top:8px;', null, box);
      var gb = elt('button', prim.replace('margin-top:9px;', 'margin-top:0;') + 'color:#f5efdc;', 'MAKE HIGHLIGHT GIF', gifWrap);
      gb.onclick = function () {
        gb.disabled = true; gb.textContent = 'Rendering…'; gb.style.opacity = '.7';
        setTimeout(function () {
          var blob = makeHighlightGif(rec, (playerName() ? playerName().slice(0, 16) + ' · ' : '') + S.strokes + ' strokes (' + S.overStr + ')');
          if (!blob) { gb.textContent = 'GIF unavailable'; return; }
          if (lastGifUrl) { try { URL.revokeObjectURL(lastGifUrl); } catch (e) { } }   // free the previous GIF's blob (its card is gone)
          var url = URL.createObjectURL(blob); lastGifUrl = url;
          gb.remove();
          var img = elt('img', 'width:100%;display:block;margin-bottom:8px;', null, gifWrap); img.src = url;
          var grow = elt('div', 'display:flex;gap:8px;', null, gifWrap);
          var dl = elt('a', 'flex:1;text-align:center;padding:11px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;text-decoration:none;', 'SAVE GIF', grow);
          dl.href = url; dl.download = 'gunslingers-daily-' + St.dailyN + '.gif'; dl.target = '_blank'; dl.rel = 'noopener';   // iOS ignores download -> open in a new tab so the game isn't lost
          var file = null; try { file = new File([blob], dl.download, { type: 'image/gif' }); } catch (e) { }
          if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
            var sh = elt('button', 'flex:1;padding:11px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;', 'SHARE GIF', grow);
            sh.onclick = function () { navigator.share({ files: [file], text: shareStrings(rec).text }).catch(function () { }); };   // fresh text (incl. rank/streak)
          }
          socialToast('Highlight ready — save it & post it!');
        }, 60);
      };
    }
    var row = elt('div', 'display:flex;gap:8px;margin-top:8px;', null, box);
    var rep = elt('button', 'flex:1;padding:11px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;', 'WATCH REPLAY', row);
    rep.onclick = function () { ov.remove(); var rp = capReplay(rec.path); St.ghost = { path: rp, shots: rec.shots, par: rec.par, t: 0, playing: true }; setTimeout(function () { showDailyCard(rec); }, (rp.length / 20 + 0.6) * 1000); };
    var pf = elt('button', 'flex:1;padding:11px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;', 'FULL GAME', row);
    pf.onclick = function () { ov.remove(); St.daily = false; St.ghost = null; chooseSet(); };
    // watch how the day's best player sank it
    if (St.leaderGhost && St.leaderGhost.path && St.leaderGhost.path.length && St.leaderGhost.name !== playerName()) {
      var lg = St.leaderGhost;
      var wl = elt('button', 'width:100%;padding:11px;margin-top:8px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;', 'WATCH ' + lg.name + '’S RUN (' + lg.strokes + ')', box);
      wl.onclick = function () { ov.remove(); var lp = capReplay(lg.path); St.ghost = { path: lp, shots: [], par: rec.par, t: 0, playing: true }; setTimeout(function () { St.ghost = null; showDailyCard(rec); }, (lp.length / 20 + 0.6) * 1000); };
    }
    if (St.dailyPractice) {   // already played today → let them dismiss the result and hit balls for fun (won't post)
      var prac = elt('button', 'width:100%;padding:11px;margin-top:8px;background:transparent;color:#f5efdc;font:900 14px Wantedo,Georgia;cursor:pointer;', 'PRACTICE THIS HOLE', box);
      prac.onclick = function () { ov.remove(); recStart(St.hi >= 0 ? St.hi : -1); if (St.ghost) { St.ghost.playing = false; St.ghost.t = 0; } };
    }
    // ---- archive: play an older day's hole (more to play; never counts) ----
    if (NET() && (St.archiveDaysAgo || 0) < 14) {
      var older = (St.archiveDaysAgo || 0) + 1;
      var arcBtn = elt('button', 'width:100%;padding:11px;margin-top:8px;background:transparent;color:#f5efdc;font:900 13px Wantedo,Georgia;cursor:pointer;', St.archive ? 'OLDER HOLE (DAILY #' + (St.dailyN - 1) + ')' : 'PLAY YESTERDAY’S HOLE', box);
      arcBtn.onclick = function () { ov.remove(); enterPastDaily(older); };
    }
    // ---- lifetime career stats ----
    var cs = statsGet();
    if (cs.played > 0) {
      var avg = cs.over / cs.played, avgStr = (Math.abs(avg) < 0.05) ? 'even' : (avg > 0 ? '+' + avg.toFixed(1) : avg.toFixed(1));
      var line = '' + cs.played + ' dail' + (cs.played === 1 ? 'y' : 'ies') + ' · avg ' + avgStr + ' vs par · beat the ghost ' + cs.beat + '×' + (cs.ace ? ' · ' + cs.ace + ' ace' + (cs.ace > 1 ? 's' : '') : '');
      elt('div', 'font:700 12px Georgia;color:#ffffff;margin-top:12px;padding:8px;background:rgba(245,197,66,.06);', line, box);
    }
    var streakLive = (St.streak > 1 && !St.archive && !St.dailyPractice);   // remind them what's at stake right as they leave
    var paintCd = function () { var t = fmtCountdown(); return streakLive ? ('Keep your ' + St.streak + '-day streak — ' + t.replace('Next daily in', 'next hole in')) : t; };
    var cd = elt('div', 'font:800 13px Wantedo,Georgia;color:#f5efdc;margin-top:10px;', paintCd(), box);
    var cdIv = setInterval(function () { if (!document.body.contains(cd)) { clearInterval(cdIv); return; } cd.textContent = paintCd(); }, 1000);
    elt('div', 'font:600 11px Georgia;color:#ffffff;margin-top:4px;line-height:1.5;', 'A fresh hole drops every day. Share your score and challenge your friends.', box);
    return ov;
  }
  // ===== TEAM BALL — local pass & play: partners take turns hitting the SAME ball (alternate shot) =====
  var TB_POOL = [7, 6, 4, 30, 33], TEAM_BALL_HOLE = 7;
  function tbNextHole() { var pool = TB_POOL.filter(function (h) { return h !== St.hi; }); return pool[(Math.random() * pool.length) | 0]; }
  function tbClearTurn() { var e = document.getElementById('pg-tbturn'); if (e) e.remove(); }
  function turnBadge(text) {
    var e = document.getElementById('pg-tbturn');
    if (!e) { e = elt('div', 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:40;padding:8px 18px;background:linear-gradient(180deg,#8a6a1e,#5a3a10);color:#fff;font:900 15px Wantedo,Georgia;pointer-events:none;text-align:center;white-space:nowrap;', null, document.body); e.id = 'pg-tbturn'; }
    e.textContent = text;
  }
  function tbTurnUpdate() {
    if (!St.teamBall || !St.tbPlayers || !St.tbPlayers.length) { tbClearTurn(); return; }
    turnBadge('' + St.tbPlayers[St.tbTurn % St.tbPlayers.length] + '’s turn — shot ' + (St.strokes + 1));
  }
  function bbTurnUpdate() {
    if (!St.bestBall || !St.bbPlayers || !St.bbPlayers.length) { tbClearTurn(); return; }
    var best = St.bbScores && St.bbScores.length ? Math.min.apply(null, St.bbScores) : null;
    turnBadge('' + St.bbPlayers[St.bbIdx] + ' — player ' + (St.bbIdx + 1) + ' of ' + St.bbPlayers.length + (best != null ? ' · best so far ' + best : '') + ' · shot ' + (St.strokes + 1));
  }
  function enterTeamBall(players, hi) {
    players = (players || []).map(function (s) { return (s || '').trim().slice(0, 16); }).filter(Boolean);
    if (players.length < 2) players = ['Player 1', 'Player 2'];
    if (players.length > 4) players = players.slice(0, 4);
    if (hi == null) hi = TEAM_BALL_HOLE;
    St.daily = false; St.ghost = null;
    loadHole(hi);
    St.teamBall = true; St.tbPlayers = players; St.tbTurn = 0; St.tbShots = [];
    St.banner = 'TEAM BALL — ' + players.join(', '); St.bannerT = 2.6;
    tbTurnUpdate();
  }
  // share a local pass-&-play result — native share sheet on mobile, copy fallback on desktop
  function shareLocalResult(text) { if (navigator.share) { try { navigator.share({ title: 'Gunslingers Pinball Golf', text: text }).catch(function () { }); return; } catch (e) { } } copyText(text, 'Result copied — paste anywhere!'); }
  function teamBallFinish() {
    tbClearTurn();
    var hole = St.hole, n = St.tbShots.length || St.strokes, par = hole ? hole.par : 3, over = n - par;
    var verdict = n === 1 ? 'HOLE IN ONE! ' : over <= -2 ? 'EAGLE ' : over === -1 ? 'BIRDIE ' : over === 0 ? 'PAR ' : over === 1 ? 'BOGEY ' : '+' + over + ' ';
    var counts = {}; St.tbShots.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; });
    var old = document.getElementById('pg-teamball'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:57;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-teamball';
    var box = elt('div', 'width:400px;max-width:94%;max-height:92%;overflow:auto;background:transparent;border:none;padding:22px;text-align:center;', null, ov); box.className = 'edscroll';
    elt('div', 'font:900 13px Wantedo,Georgia;color:#ffffff;letter-spacing:2px;', 'TEAM BALL', box);
    elt('div', 'font:900 24px Wantedo,Georgia;color:#f5efdc;margin:2px 0 6px;', hole ? hole.name : '', box);
    var sc = over < 0 ? '#ffffff' : over === 0 ? '#f5efdc' : '#f5efdc';
    elt('div', 'font:900 44px Wantedo,Georgia;color:' + sc + ';line-height:1.05;', n + ' shots', box);
    elt('div', 'font:900 18px Wantedo,Georgia;color:' + sc + ';margin-bottom:12px;', verdict + ' (par ' + par + ')', box);
    elt('div', 'font:700 11px Georgia;color:#f5efdc;opacity:.8;letter-spacing:1px;margin-bottom:6px;', 'WHO HIT WHAT', box);
    St.tbPlayers.forEach(function (p) {
      var rw = elt('div', 'display:flex;justify-content:space-between;padding:4px 10px;margin:1px 0;font:13px Georgia;color:#f5efdc;', null, box);
      elt('div', 'font-weight:700;', p, rw);
      elt('div', 'font-weight:800;color:#f5efdc;', (counts[p] || 0) + ' shot' + ((counts[p] || 0) === 1 ? '' : 's'), rw);
    });
    var prim = 'width:100%;padding:12px;font:900 16px Wantedo,Georgia;cursor:pointer;margin-top:11px;background:transparent;border:none;';
    var tbText = 'Team Ball — ' + St.tbPlayers.join(', ') + ' sank ' + (hole ? hole.name : 'the hole') + ' in ' + n + ' shots (' + verdict.replace(/[]/g, '').trim() + ')! Play Gunslingers Pinball Golf ' + shareBase() + '?daily';
    var sh = elt('button', prim + 'color:#f5efdc;', 'SHARE RESULT', box);
    sh.onclick = function () { shareLocalResult(tbText); };
    var again = elt('button', prim + 'color:#f5efdc;', 'NEXT HOLE, SAME TEAM', box);
    again.onclick = function () { ov.remove(); enterTeamBall(St.tbPlayers, tbNextHole()); };
    var nt = elt('button', prim + 'color:#f5efdc;', 'NEW TEAM', box);
    nt.onclick = function () { ov.remove(); St.teamBall = false; showTeamBallSetup(); };
    var ex = elt('button', prim + 'color:#f5efdc;', 'BACK TO MENU', box);
    ex.onclick = function () { ov.remove(); St.teamBall = false; chooseSet(); };
  }
  // ===== BEST BALL — local pass & play: each partner plays the SAME hole solo; the team's lowest score wins =====
  function enterBestBall(players, hi) {
    players = (players || []).map(function (s) { return (s || '').trim().slice(0, 16); }).filter(Boolean);
    if (players.length < 2) players = ['Player 1', 'Player 2'];
    if (players.length > 4) players = players.slice(0, 4);
    if (hi == null) hi = TEAM_BALL_HOLE;
    St.daily = false; St.ghost = null;
    loadHole(hi);
    St.bestBall = true; St.bbPlayers = players; St.bbIdx = 0; St.bbScores = []; St.bbHole = hi;
    St.banner = 'BEST BALL — ' + players[0] + ' up first'; St.bannerT = 2.6;
    bbTurnUpdate();
  }
  function bestBallNext() {
    if (!St.bestBall) return;
    St.bbScores[St.bbIdx] = St.strokes;   // record the player who just sank
    St.bbIdx++;
    if (St.bbIdx < St.bbPlayers.length) {   // hand the SAME hole to the next partner, fresh from the tee
      newShotBall(); St.strokes = 0; St.state = 'aim';
      St.banner = '' + St.bbPlayers[St.bbIdx] + ' — your turn!'; St.bannerT = 2.2;
      bbTurnUpdate();
    } else { bestBallFinish(); }
  }
  function bestBallFinish() {
    tbClearTurn();
    var hole = St.hole, par = hole ? hole.par : 3;
    var rows = St.bbPlayers.map(function (p, i) { return { name: p, s: St.bbScores[i] }; }).sort(function (a, b) { return a.s - b.s; });
    var best = rows[0], over = best.s - par;
    var verdict = best.s === 1 ? 'HOLE IN ONE! ' : over <= -2 ? 'EAGLE ' : over === -1 ? 'BIRDIE ' : over === 0 ? 'PAR ' : over === 1 ? 'BOGEY ' : '+' + over + ' ';
    var old = document.getElementById('pg-teamball'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:57;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-teamball';
    var box = elt('div', 'width:400px;max-width:94%;max-height:92%;overflow:auto;background:transparent;border:none;padding:22px;text-align:center;', null, ov); box.className = 'edscroll';
    elt('div', 'font:900 13px Wantedo,Georgia;color:#ffffff;letter-spacing:2px;', 'BEST BALL', box);
    elt('div', 'font:900 24px Wantedo,Georgia;color:#f5efdc;margin:2px 0 6px;', hole ? hole.name : '', box);
    var sc = over < 0 ? '#ffffff' : over === 0 ? '#f5efdc' : '#f5efdc';
    elt('div', 'font:900 30px Wantedo,Georgia;color:' + sc + ';line-height:1.1;', '' + best.name + ' — ' + best.s, box);
    elt('div', 'font:900 17px Wantedo,Georgia;color:' + sc + ';margin-bottom:12px;', verdict + ' is the team’s best (par ' + par + ')', box);
    elt('div', 'font:700 11px Georgia;color:#f5efdc;opacity:.8;letter-spacing:1px;margin-bottom:6px;', 'EVERYONE’S SCORE', box);
    rows.forEach(function (r, i) {
      var rw = elt('div', 'display:flex;justify-content:space-between;align-items:center;padding:4px 10px;margin:1px 0;font:13px Georgia;color:' + (i === 0 ? '#ffffff' : '#f5efdc') + ';', null, box);
      elt('div', 'font-weight:' + (i === 0 ? '800' : '600') + ';', (i === 0 ? '' : (i + 1) + '. ') + r.name, rw);
      var ro = r.s - par, roc = ro < 0 ? '#ffffff' : ro === 0 ? '#f5efdc' : '#f5efdc';
      elt('div', 'font-weight:800;color:' + roc + ';', r.s + (ro !== 0 ? (ro > 0 ? ' +' + ro : ' ' + ro) : ''), rw);
    });
    var prim = 'width:100%;padding:12px;font:900 16px Wantedo,Georgia;cursor:pointer;margin-top:11px;background:transparent;border:none;';
    var bbText = 'Best Ball — ' + best.name + ' led the crew with ' + best.s + ' on ' + (hole ? hole.name : 'the hole') + ' (' + St.bbPlayers.join(', ') + ')! Play Gunslingers Pinball Golf ' + shareBase() + '?daily';
    var sh = elt('button', prim + 'color:#f5efdc;', 'SHARE RESULT', box);
    sh.onclick = function () { shareLocalResult(bbText); };
    var again = elt('button', prim + 'color:#f5efdc;', 'NEXT HOLE, SAME TEAM', box);
    again.onclick = function () { ov.remove(); enterBestBall(St.bbPlayers, tbNextHole()); };
    var nt = elt('button', prim + 'color:#f5efdc;', 'NEW TEAM', box);
    nt.onclick = function () { ov.remove(); St.bestBall = false; showTeamBallSetup(); };
    var ex = elt('button', prim + 'color:#f5efdc;', 'BACK TO MENU', box);
    ex.onclick = function () { ov.remove(); St.bestBall = false; chooseSet(); };
  }
  function showTeamBallSetup() {
    var old = document.getElementById('pg-tbsetup'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:58;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-tbsetup';
    var _tbCss = document.createElement('style'); _tbCss.textContent = '#pg-tbsetup button,#pg-tbsetup input{border:none!important;outline:none;}#pg-tbsetup input{background:rgba(0,0,0,.26);}'; ov.appendChild(_tbCss);
    var box = elt('div', 'width:390px;max-width:92%;background:transparent;border:none;padding:22px;text-align:center;', null, ov);
    elt('div', 'font:900 24px Wantedo,Georgia;color:#ffffff;', 'PASS & PLAY', box);
    var blurb = elt('div', 'font:600 12px Georgia;color:#ffffff;margin:6px 0 12px;line-height:1.5;min-height:34px;', '', box);
    var mode = 'team';   // 'team' = alternate shot, 'best' = best ball
    var modeRow = elt('div', 'display:flex;gap:8px;margin-bottom:12px;', null, box);
    var mTeam = elt('button', '', 'Team Ball', modeRow);
    var mBest = elt('button', '', 'Best Ball', modeRow);
    function paintMode() {
      var on = 'flex:1;padding:10px;background:transparent;color:#ffffff;font:900 14px Wantedo,Georgia;cursor:pointer;text-decoration:underline;text-underline-offset:5px;';
      var off = 'flex:1;padding:10px;background:transparent;color:#9a9a9a;font:900 14px Wantedo,Georgia;cursor:pointer;';
      mTeam.style.cssText = (mode === 'team' ? on : off); mBest.style.cssText = (mode === 'best' ? on : off);
      blurb.textContent = mode === 'team'
        ? 'Take turns hitting the SAME ball — fewest shots as a team wins.'
        : 'Each partner plays the hole solo; the team’s LOWEST score wins.';
    }
    mTeam.onclick = function () { mode = 'team'; paintMode(); }; mBest.onclick = function () { mode = 'best'; paintMode(); }; paintMode();
    var inp = elt('input', 'width:100%;padding:11px;background:#1a1109;color:#f5efdc;font:14px Georgia;text-align:center;', null, box);
    inp.placeholder = 'Names, comma-separated (2–4)'; inp.value = (playerName() || 'Tex') + ', Annie';
    var start = elt('button', 'width:100%;padding:13px;margin-top:12px;background:transparent;color:#ffffff;font:900 18px Wantedo,Georgia;cursor:pointer;', '▶ START', box);
    start.onclick = function () { var names = (inp.value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); if (names.length < 2) { socialToast('Add at least 2 players'); return; } ov.remove(); if (mode === 'best') enterBestBall(names, TEAM_BALL_HOLE); else enterTeamBall(names, TEAM_BALL_HOLE); };
    var cancel = elt('button', 'width:100%;padding:11px;margin-top:8px;background:transparent;border:none;color:#ffffff;font:900 14px Wantedo,Georgia;cursor:pointer;', '← BACK', box);
    cancel.onclick = function () { ov.remove(); chooseSet(); };
  }
  // ALL-TIME CHAMPIONS — the persistent competitive ladder (daily wins, then scoring average)
  function showChampions() {
    var net = NET(); if (!net) return;
    var old = document.getElementById('pg-champs'); if (old) old.remove();
    var ov = elt('div', 'position:fixed;inset:0;z-index:59;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-champs';
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    var box = elt('div', 'width:404px;max-width:94%;max-height:88%;overflow:auto;background:transparent;border:none;padding:20px;text-align:center;', null, ov); box.className = 'edscroll';
    elt('div', 'font:900 22px Wantedo,Georgia;color:#ffffff;', 'CHAMPIONS', box);
    var sub = elt('div', 'font:600 12px Georgia;color:#ffffff;margin:4px 0 10px;line-height:1.4;min-height:30px;', '', box);
    var mode = 'players', period = 'all';
    var tabRow = elt('div', 'display:flex;gap:8px;margin-bottom:6px;', null, box);
    var tP = elt('button', '', 'PLAYERS', tabRow);
    var tT = elt('button', '', 'TEAMS', tabRow);
    var perRow = elt('div', 'display:flex;gap:8px;margin-bottom:10px;', null, box);
    var pW = elt('button', '', 'THIS WEEK', perRow);
    var pA = elt('button', '', 'ALL-TIME', perRow);
    var listBox = elt('div', 'min-height:60px;', null, box);
    var me = playerName(), myTeam = getTeam();
    var shareRank = elt('button', 'width:100%;padding:11px;margin-top:10px;background:transparent;border:none;color:#ffffff;font:900 15px Wantedo,Georgia;cursor:pointer;display:none;', 'SHARE MY RANK', box);   // viral flex: brag your standing
    function paintTabs() {
      var on = 'flex:1;padding:9px;border:none;background:transparent;color:#ffffff;font:900 13px Wantedo,Georgia;cursor:pointer;text-decoration:underline;text-underline-offset:5px;';
      var off = 'flex:1;padding:9px;border:none;background:transparent;color:#9a9a9a;font:900 13px Wantedo,Georgia;cursor:pointer;';
      tP.style.cssText = (mode === 'players' ? on : off); tT.style.cssText = (mode === 'teams' ? on : off);
      pW.style.cssText = (period === 'week' ? on : off); pA.style.cssText = (period === 'all' ? on : off);
    }
    function render() {
      paintTabs();
      var pl = period === 'week' ? 'This week’s ' : 'All-time ', days = period === 'week' ? 7 : null;
      sub.textContent = mode === 'players' ? (pl + 'players ranked by daily wins, then scoring average. Play every day to climb.') : (pl + 'teams ranked by daily wins (your crew’s best score each day). Recruit + dominate.');
      listBox.textContent = ''; elt('div', 'font:600 12px Georgia;color:#ffffff;', 'Loading…', listBox);
      (mode === 'players' ? net.champions(25, days) : net.teamChampions(25, days)).then(function (rows) {
        listBox.textContent = '';
        if (!rows || !rows.length) { elt('div', 'font:600 13px Georgia;color:#ffffff;', mode === 'players' ? 'No champions yet — win a daily to claim the top spot!' : 'No team champions yet — form a posse and win a daily!', listBox); return; }
        rows.forEach(function (r, i) {
          var mine = mode === 'players' ? (me && r.name === me) : (myTeam && myTeam.name === r.name);
          var row = elt('div', 'display:flex;align-items:center;gap:8px;padding:5px 10px;margin:2px 0;font:13px Georgia;color:' + (mine ? '#ffffff' : '#f5efdc') + ';', null, listBox);
          elt('div', 'width:28px;color:#ffffff;font-weight:700;text-align:center;', i === 0 ? '' : i === 1 ? '' : i === 2 ? '' : (i + 1) + '.', row);
          elt('div', 'flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:' + (mine ? '800' : '400') + ';', r.name + (mine ? ' (you)' : ''), row);
          elt('div', 'font-weight:800;color:#ffffff;white-space:nowrap;', r.wins + '', row);
          if (mode === 'players') { var av = Number(r.avg_over), avs = av === 0 ? 'E' : (av > 0 ? '+' + av : '' + av); elt('div', 'font:600 11px Georgia;color:#ffffff;white-space:nowrap;', r.dailies + 'd · avg ' + avs, row); }
          else { elt('div', 'font:600 11px Georgia;color:#ffffff;white-space:nowrap;', r.days + 'd · best ' + r.best, row); }
        });
        // viral flex: if you're on the board, let you share your rank
        var myIdx = -1; rows.forEach(function (r, i) { var mine = mode === 'players' ? (me && r.name === me) : (myTeam && myTeam.name === r.name); if (mine) myIdx = i; });
        if (myIdx >= 0) {
          shareRank.style.display = 'block';
          var who = mode === 'players' ? 'I’m' : ('Team ' + myTeam.name + ' is'), pr = period === 'week' ? 'this week' : 'all-time', rk = rows[myIdx];
          shareRank.onclick = function () { shareLocalResult('' + who + ' #' + (myIdx + 1) + ' ' + pr + ' on Gunslingers Pinball Golf — ' + rk.wins + ' daily win' + (rk.wins === 1 ? '' : 's') + '! Climb past me ' + shareBase() + '?daily'); };
        } else { shareRank.style.display = 'none'; }
      });
    }
    tP.onclick = function () { mode = 'players'; render(); };
    tT.onclick = function () { mode = 'teams'; render(); };
    pW.onclick = function () { period = 'week'; render(); };
    pA.onclick = function () { period = 'all'; render(); };
    render();
    var close = elt('button', 'width:100%;padding:12px;margin-top:12px;background:transparent;border:none;color:#ffffff;font:900 15px Wantedo,Georgia;cursor:pointer;', '← BACK', box);
    close.onclick = function () { ov.remove(); };
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
    var lookBtn = elt('button', 'position:fixed;right:14px;bottom:64px;z-index:21;width:44px;height:44px;border:none;outline:none;background:transparent;color:#ffffff;font:900 15px Wantedo,Georgia;letter-spacing:.5px;cursor:pointer;', 'FX', document.body); lookBtn.title = 'Lighting look'; lookBtn.onclick = function () { showLookPicker(); };   // FX = the lighting-look picker (emoji removed; needs a visible label)   // LIGHTING LOOK picker (night / film noir / sunset / daytime / faded / red glow / sin city)
    St.scene.addEventListener('wheel', function (e) { e.preventDefault(); if (ED.on && ED.view3d) { ED.orb.dist = clamp(ED.orb.dist * (e.deltaY > 0 ? 1.08 : 0.92), 0.5, 4); return; } R3.zoom = clamp(R3.zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.55, 1.8); }, { passive: false });
    audioUI();
    try { if (document.fonts) document.fonts.load('40px Wantedo'); } catch (e) {}
    edInit();
    var BTNCSS = 'position:fixed;left:14px;z-index:30;padding:2px 0;border:none;background:transparent;color:#ffffff;font:900 15px Wantedo,Georgia;cursor:pointer;letter-spacing:.5px;text-align:left;';
    // OWNER MODE: in-game admin/dev tools (EDIT LEVEL + OWNER) are HIDDEN from regular players. Enable on YOUR device with game.html?owner=1 (or after logging into owner.html); disable with ?owner=0. Players just get a clean game; admin lives in owner.html.
    var _ownerMode = false; try { var _oq = new URLSearchParams(location.search); if (_oq.get('owner') === '0') localStorage.removeItem('pg_ownerMode'); else if (_oq.get('owner') === '1' || _oq.has('edit')) localStorage.setItem('pg_ownerMode', '1'); _ownerMode = localStorage.getItem('pg_ownerMode') === '1' || sessionStorage.getItem('pg_ownerMode') === '1'; } catch (e) { }
    var lb = elt('button', BTNCSS + 'bottom:74px;', 'LEVELS', document.body); lb.onclick = levelMenu;
    var sk = elt('button', BTNCSS + 'bottom:44px;', 'SKIP', document.body); sk.onclick = skipLevel;
    ED.dom.gameBtns = [lb, sk];
    if (_ownerMode) {
      var eb = elt('button', BTNCSS + 'bottom:104px;', 'EDIT LEVEL', document.body);
      eb.onclick = function () { if (St.testing && ED.draft) { edEnter(); return; } if (St.hole && St.hi >= 0) { editBuiltin(St.hi); return; } if (St.hole && St.hi < 0 && St.customName) { editCustom(St.customName); return; } edEnter(); };
      ED.dom.gameBtns.unshift(eb);
    }
    // OWNER / DEBUG menu — high z-index so it's reachable on EVERY screen (over the chooser, daily card, etc.)
    if (_ownerMode) {
    var ownBtn = elt('button', 'position:fixed;left:12px;bottom:140px;z-index:9600;padding:5px 11px;border:none;background:rgba(20,13,6,.5);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#ffffff;font:900 13px Wantedo,Georgia;cursor:pointer;letter-spacing:.5px;', 'OWNER', document.body);
    var ownMenu = elt('div', 'position:fixed;left:12px;bottom:178px;z-index:9601;width:214px;padding:7px;background:rgba(18,12,5,.5);backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);display:none;flex-direction:column;gap:4px;', null, document.body);
    function ownRow(label, fn) { var r = elt('button', 'padding:10px 11px;border:none;background:rgba(245,197,66,.09);color:#f5efdc;font:800 13px Georgia;cursor:pointer;text-align:left;', label, ownMenu); r.onclick = function () { ownMenu.style.display = 'none'; fn(); }; return r; }
    ownBtn.onclick = function () { ownMenu.style.display = ownMenu.style.display === 'none' ? 'flex' : 'none'; };
    function clearOverlays() { document.querySelectorAll('#pg-chooser,#pg-daily,#pg-howto,#pg-over,#pg-scorecard,#pg-champs,#pg-teamball,#pg-tbsetup').forEach(function (e) { e.remove(); }); }
    ownRow('Generate the daily — 3 new wacky holes', function () { clearOverlays(); genStudio(); });
    ownRow('Daily Studio (dates / bank)', function () { location.href = 'owner.html'; });
    ownRow('Level Editor', function () { clearOverlays(); if (St.testing && ED.draft) edEnter(); else if (St.hole && St.hi >= 0) editBuiltin(St.hi); else edEnter(); });
    ownRow('◎ Jump to any hole (0–35)', function () { var v = prompt('Load hole # (0–35):', String(St.hi >= 0 ? St.hi : 0)); var n = parseInt(v, 10); if (n >= 0 && n < 36) { clearOverlays(); St.daily = false; St.dailyPractice = false; St.archive = false; loadHole(n); } });
    ownRow('Reset today’s daily (replay)', function () { try { localStorage.removeItem('pg_daily_done'); } catch (e) { } location.reload(); });
    ownRow('Hard reload', function () { location.replace(location.pathname + '?bust=' + Date.now()); });
    elt('div', 'padding:7px 11px 3px;color:rgba(245,197,66,.6);font:700 11px Georgia;', BUILD, ownMenu);
    }
    R3.hudBtns = (ED.dom.gameBtns || []).slice(); if (typeof lookBtn !== 'undefined' && lookBtn) R3.hudBtns.push(lookBtn); if (typeof ownBtn !== 'undefined' && ownBtn) R3.hudBtns.push(ownBtn);   // controls that also go B&W in noir/sin city
    St.scores = []; St.parDone = 0; St.setBase = 0; loadHole(0);
    var _qs, _hs; try { _qs = new URLSearchParams(location.search); } catch (e) { _qs = null; }
    try { _hs = new URLSearchParams((location.hash || '').replace(/^#/, '')); } catch (e) { _hs = null; }
    var _tm = _qs && _qs.get('team'); if (_tm) St.pendingTeam = _tm.toUpperCase().trim();   // one-tap team invite: join once we have a name
    try { if (sessionStorage.getItem('pg_ownerMode') === '1') St.ownerMode = true; } catch (e) { }
    if (_qs && (_qs.get('owner') === '1' || _qs.has('edit'))) { St.ownerMode = true; try { sessionStorage.setItem('pg_ownerMode', '1'); } catch (e) { } }
    var _ed = _qs && _qs.get('edit');
    var _pv = _qs && _qs.get('preview');
    if (_pv != null && _pv !== '') {   // owner: preview a generated hole stashed in localStorage (pg_preview) by the Daily Studio
      var _pvOk = false;
      try { var _po = JSON.parse(localStorage.getItem('pg_preview') || 'null'); if (_po) { var _ph = edDeserialize(_po); PG.__loadHoleObj(_ph); St.banner = '' + _ph.name; St.bannerT = 2.4; _pvOk = true; } } catch (e) { }
      if (!_pvOk) chooseSet();
    } else if (_ed != null && _ed !== '' && !isNaN(parseInt(_ed, 10))) {
      var _ei = parseInt(_ed, 10); loadHole(_ei >= 0 && _ei < 36 ? _ei : 0); editBuiltin(St.hi);   // owner: tweak a candidate's layout
    } else if (_qs && (_qs.has('daily') || (_hs && _hs.has('g')))) {
      var _dv = _qs.get('daily'), _gh = (_hs && _hs.has('g')) ? decGhost(_hs.get('g')) : null;
      if (_gh && _hs) { var _gn = _hs.get('n'), _gs = _hs.get('s'); if (_gn) { try { _gh.name = decodeURIComponent(_gn); } catch (e) { _gh.name = _gn; } } if (_gs != null && !isNaN(parseInt(_gs, 10))) _gh.cs = parseInt(_gs, 10); }
      var _explicit = (_dv != null && _dv !== '') ? parseInt(_dv, 10) : null;          // ?daily=N → that exact hole
      if (_explicit == null && _gh && _gh.hi >= 0 && _gh.hi < 36) _explicit = _gh.hi;   // a shared ghost pins its hole
      enterDaily(_explicit, _gh);
    } else if (_qs && _qs.get('gen')) { /* generator host (hidden iframe from Daily Studio) — engine only, no UI; PG.__proposeWacky is ready */ }
    else { chooseSet(); }
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
          var bar = elt('div', 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;padding:11px 18px;background:linear-gradient(180deg,#3a8a30,#1f5018);color:#fff;font:800 14px Georgia;cursor:pointer;', 'New build v' + m[1] + ' ready — tap to update', document.body);
          bar.onclick = function () { location.replace(self + '?bust=' + Date.now()); };
        }
      }).catch(function () { });
    }, 20000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  /* test hooks */
  PG.game = St; PG.K = K; PG.HOLES = HOLES;
  PG.__tick = tick; PG.__render = drawHUD; PG.__load = loadHole; PG.__St = St; PG.__HOLES = HOLES; PG.__K = K;
  PG.__AU = AU; PG.__audioInit = function () { audioInit(); }; PG.__musicStart = function () { musicStart(); }; PG.__audioApply = function () { audioApply(); }; PG.__audioUI = AU; PG.__sfx = function (k) { sfx(k); }; PG.__sfxLoadAll = function () { sfxLoadAll(); }; PG.__spawnShock = function (x, gy, z, col) { spawnShock(x, gy, z, col); };
  // ============ PROCEDURAL WACKY HOLE GENERATOR ("propose new holes" — fresh weird holes every time) ============
  function genName(rnd) {
    var A = ['RATTLER', 'CACTUS', 'DUST DEVIL', 'SIDEWINDER', 'COYOTE', 'BUZZARD', 'FOOL’S GOLD', 'THUNDER', 'CROOKED', 'MESA', 'BANDIT', 'OUTLAW', 'DESERT', 'TUMBLEWEED', 'SCORPION', 'IRON', 'DEADWOOD', 'SILVER', 'RUSTY SPUR', 'BLACKJACK', 'PERDITION', 'DRY GULCH', 'WIDOW’S', 'GALLOWS'];
    var B = ['RUN', 'GULCH', 'PASS', 'TRAIL', 'BEND', 'SPINE', 'RIDGE', 'CROSSING', 'HOLLOW', 'DRIFT', 'ALLEY', 'CANYON', 'BLUFF', 'TWIST', 'GAMBIT', 'SHUFFLE', 'TANGLE', 'SNAKE', 'RECKONING', 'STANDOFF'];
    return A[Math.floor(rnd() * A.length)] + ' ' + B[Math.floor(rnd() * B.length)];
  }
  // generate ONE crazy-shaped, structure-packed, beatable-by-construction hole from a seed
  function genWacky(seed) {
    var s = (seed >>> 0) || 0x2545F491; if (s === 0) s = 1;
    function rnd() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s = s >>> 0; return s / 4294967296; }
    function rr(a, b) { return a + rnd() * (b - a); }
    function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
    function ch(p) { return rnd() < p; }
    // winding centerline: 4-7 waypoints. style 0 = zigzag snake, 1 = one big sweeping curve, 2 = wide switchbacks
    var nWp = ri(4, 7), style = ri(0, 2), wp = [[0, 0]], z = 0, sgn = ch(0.5) ? 1 : -1, drift = sgn * rr(140, 300);
    for (var i = 1; i < nWp; i++) {
      z += Math.round(rr(470, 700)); var x;
      if (style === 1) { drift += sgn * rr(60, 180); x = clamp(drift, -440, 440); }                  // sweeping drift to one side
      else { x = sgn * (style === 2 ? rr(260, 460) : rr(160, 360)); sgn = -sgn; }                     // zigzag / wide switchbacks
      wp.push([Math.round(x), z]);
    }
    // width fn (3 profiles): rhythmic pinches (DIAMONDBACK), a narrow chute opening to a wide finish, or one big central arena
    var freq = ri(2, 4), base = rr(165, 205), bulge = rr(420, 620), profile = ri(0, 2);
    var width = profile === 1
      ? function (t) { return base + bulge * (0.25 + 0.75 * t); }
      : profile === 2
        ? function (t) { return base + bulge * Math.pow(Math.sin(t * PI), 1.4); }
        : function (t) { return base + bulge * Math.pow(Math.sin(t * PI * freq), 2); };
    // obstacle plan — a "bunch of structures", but pinch-aware so a neck is never fully blocked
    function obs(b, tee, cup) {
      for (var k = 1; k < nWp - 1; k++) {
        var wx = wp[k][0], wz = wp[k][1], ww = width(k / (nWp - 1)), r = rnd(), spin = (ch(0.5) ? 1 : -1);
        if (ww < 250) {                                   // PINCH — only pass-through stuff
          if (r < 0.45) b.bumper(wx - 70, wz, 34).bumper(wx + 70, wz, 34);
          else if (r < 0.75) b.turntable(wx, wz, Math.min(ww * 0.34, 115), rr(1.4, 2.0) * spin);
          else b.windmill(wx, wz, Math.min(ww * 0.42, 120), 3, rr(1.2, 1.8) * spin);
        } else {                                          // ARENA — full toolkit
          if (r < 0.18) b.hill(wx, wz, Math.min(ww * 0.7, 340), rr(80, 150));
          else if (r < 0.34) b.bumper(wx - 80, wz, 38).bumper(wx + 80, wz, 38).bumper(wx, wz - 90, 36);
          else if (r < 0.50) b.pendulum(wx, wz, { len: rr(255, 335), amp: rr(0.7, 0.95), speed: rr(1.0, 1.35), rb: 38 });
          else if (r < 0.64) b.turntable(wx, wz, Math.min(ww * 0.4, 170), rr(1.4, 2.2) * spin);
          else if (r < 0.78) b.windmill(wx, wz, Math.min(ww * 0.45, 195), ri(3, 4), rr(1.2, 1.9) * spin);
          else if (r < 0.90) b.gate(wx - ww / 2 - 26, wz, wx + ww / 2 + 26, wz, { barFrac: 0.38, speed: rr(1.05, 1.4), h: 70 });
          else b.conveyor(wx, wz, Math.min(ww * 0.85, 350), 330, PI / 2, 2300);
        }
      }
      // SLIDE across a bend (tube), loop-de-loop, TELEPORT shortcut, a multi-level step-down, a fire-hoop bonus
      if (ch(0.55) && nWp >= 4) { var a = ri(1, nWp - 3); b.tube(wp[a][0], wp[a][1], wp[a + 1][0], wp[a + 1][1], 64); }
      if (ch(0.4)) { var li = ri(1, nWp - 2); b.loopde(wp[li][0], wp[li][1], 108, 0); }
      if (ch(0.4) && nWp >= 4) { var pk = ri(1, nWp - 3), ex = wp[Math.min(pk + 2, nWp - 1)]; b.portal(wp[pk][0], wp[pk][1], [{ x: ex[0], z: ex[1] }], 50); }   // TELEPORT toward the cup
      if (ch(0.34) && nWp >= 4) { var tk = ri(1, nWp - 2); b.tier(wp[tk][1], -(44 + Math.floor(rnd() * 64)), 9999); }   // multi-level: the green steps DOWN past here
      if (ch(0.5)) b.firering(wp[nWp - 2][0], wp[nWp - 2][1], 110, 175, 150);
      if (ch(0.45)) { var pw = wp[ri(1, nWp - 1)], pk = ['slow', 'shield', 'magnet', 'jump', 'gem'][Math.floor(rnd() * 5)]; b.powerup(pw[0], pw[1], pk); }   // a power-up to grab mid-run
      if (ch(0.3)) { var bw = wp[ri(1, nWp - 2)]; b.bouncer(bw[0], bw[1], 56); }   // a spring pad
      b.coin(wp[1][0], wp[1][1], 1).coin(wp[nWp - 1][0], wp[nWp - 1][1], 2);
    }
    var par = wp[nWp - 1][1] > 2600 ? 4 : 3;   // longer hole → higher par (isl caps at 4)
    var h = isl(genName(rnd), par, wp, width, obs);
    h.mood = ['sunset', 'sunset', 'daytime', 'night', 'night', 'noir', 'faded', 'redglow', 'sincity'][Math.floor(rnd() * 9)];   // varied cinematic look per generated hole (night/noir/etc.)
    return h;
  }
  // serialize any built hole object to the editor/daily JSON (so a generated hole can be published as the daily)
  function serializeHole(h) { var sv = ED.draft; ED.draft = h; try { return edSerialize(); } finally { ED.draft = sv; } }
  PG.__genWacky = function (seed) { return genWacky(seed); };
  // ---- in-game GENERATOR STUDIO: generate 3 fresh wacky holes, preview / edit / publish one as today's daily ----
  function gsBtn(a, b) { return 'flex:1;min-width:118px;padding:10px;border:none;background:linear-gradient(180deg,' + a + ',' + b + ');color:#fff;font:800 12px Georgia;cursor:pointer;'; }
  function gsToast(msg) { var t = elt('div', 'position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:9800;max-width:84vw;text-align:center;padding:11px 18px;background:rgba(18,12,5,.84);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#f5efdc;font:800 13px Georgia;', msg, document.body); setTimeout(function () { t.remove(); }, 3400); }
  function gsSummary(h) {
    var t = [], a = function (n, k) { if (n) t.push(n + ' ' + k); };
    a((h.terrainFeatures || []).filter(function (f) { return f.kind === 'hill'; }).length, 'hills');
    a((h.bumpers || []).length, 'bumpers'); a((h.windmills || []).length, 'windmills');
    a((h.gates || []).length, 'gates'); a((h.conveyors || []).length, 'belts');
    a((h.pendulums || []).length, 'pendulums'); a((h.turntables || []).length, 'turntables');
    a((h.warps || []).filter(function (w) { return w.tube; }).length, 'slide tubes');
    a((h.loops || []).length, 'loops'); a((h.firerings || []).length, 'fire hoops');
    return t.length ? t.join(' · ') : 'open green';
  }
  function genStudio() {
    document.querySelectorAll('#pg-genstudio,#pg-chooser,#pg-daily,#pg-howto,#pg-over,#pg-scorecard,#pg-champs,#pg-teamball,#pg-tbsetup').forEach(function (e) { e.remove(); });
    var ov = elt('div', 'position:fixed;inset:0;z-index:9700;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-genstudio';
    var panel = elt('div', 'width:min(94vw,560px);max-height:90vh;overflow:auto;padding:20px 18px;color:#f5efdc;', null, ov);
    var holes = [];
    function gen() { holes = []; var base = (new Date().getTime() ^ (St.frame || 0)) >>> 0; for (var i = 0; i < 3; i++) holes.push(genWacky(base + i * 0x9E3779B1)); }
    function publishGen(h, btn) {
      if (!NET()) { gsToast('No backend connection — can’t publish'); return; }
      var pass = ''; try { pass = sessionStorage.getItem('pg_owner_pass') || ''; } catch (e) { }
      if (!pass) pass = (prompt('Owner passcode:') || '').trim();
      if (!pass) return; try { sessionStorage.setItem('pg_owner_pass', pass); } catch (e) { }
      var day = NET().todayKey(), ser = serializeHole(h);
      btn.disabled = true; btn.textContent = 'Testing it’s beatable…';
      setTimeout(function () {
        var res = testDraftBeatable(h, 12, 12);
        btn.disabled = false; btn.textContent = 'Publish as today’s daily';
        var go = function () { NET().publishDaily(pass, day, h.name, null, ser).then(function () { ov.remove(); gsToast('“' + h.name + '” is live as today’s daily '); }, function (e) { gsToast(/unauth/i.test(e.message || '') ? 'Wrong passcode' : ('Publish failed: ' + e.message)); }); };
        if (res.beatable) { gsToast('Auto-tester sank it in ' + res.strokes + ' — publishing'); go(); }
        else if (confirm('The auto-tester could not sink “' + h.name + '” in 12 tries — players may find it unbeatable. Publish anyway?')) go();
      }, 40);
    }
    function render() {
      panel.innerHTML = '';
      elt('div', 'font:900 21px Wantedo,Georgia;color:#ffffff;margin-bottom:3px;', 'GENERATE THE DAILY', panel);
      elt('div', 'font:600 12px Georgia;opacity:.82;margin-bottom:6px;line-height:1.45;', 'Three brand-new wacky holes, generated fresh every time. Preview one, tweak it in the editor, or publish it as today’s daily for everyone.', panel);
      holes.forEach(function (h, i) {
        var card = elt('div', 'padding:12px 0;border-top:1px solid rgba(245,197,66,.18);', null, panel);
        elt('div', 'font:800 16px Georgia;color:#f5efdc;', (i + 1) + ')  ' + h.name + '   ·  par ' + h.par, card);
        elt('div', 'font:600 12px Georgia;opacity:.74;margin:3px 0 9px;line-height:1.4;', gsSummary(h), card);
        var row = elt('div', 'display:flex;gap:7px;flex-wrap:wrap;', null, card);
        var pv = elt('button', gsBtn('#3a8a30', '#1f5018'), '▶ Preview', row);
        var ed = elt('button', gsBtn('#6a4628', '#3a2614'), 'Edit', row);
        var pb = elt('button', gsBtn('#1d9bf0', '#0d6fb8'), 'Publish as today’s daily', row);
        pv.onclick = function () { ov.remove(); St.daily = false; St.dailyPractice = false; St.archive = false; PG.__loadHoleObj(h); St.banner = '' + h.name; St.bannerT = 2.2; };
        ed.onclick = function () { ov.remove(); h.theme = h.theme || 'grass'; h.phys = h.phys || themePhys('grass'); openEditorWith(h); };
        pb.onclick = function () { publishGen(h, pb); };
      });
      var bar = elt('div', 'display:flex;gap:8px;margin-top:18px;', null, panel);
      var rg = elt('button', gsBtn('#b8862a', '#6a4a10'), 'Regenerate 3', bar);
      var cl = elt('button', gsBtn('#5a3a22', '#2a1c10'), '× Close', bar);
      rg.onclick = function () { gen(); render(); };
      cl.onclick = function () { ov.remove(); };
    }
    gen(); render();
  }
  PG.__genStudio = function () { genStudio(); };
  // headless beatability test of a serialized hole JSON (used by owner.html's generator iframe before publishing) → {beatable, strokes}
  PG.__testHole = function (json, tries) {
    tries = tries || 9; var maxStrokes = 13, h;
    try { h = edDeserialize(json); } catch (e) { return { beatable: false, err: 'deserialize' }; }
    var sunk = false, best = 99;
    for (var t = 0; t < tries && !sunk; t++) {
      try { PG.__loadHoleObj(h); } catch (e) { return { beatable: false, err: 'load' }; }
      var cup = St.hole.cup, scale = 0.78 + (t % 5) * 0.11, strokes = 0;
      while (strokes < maxStrokes) {
        if (St.state !== 'aim') break;
        var b = primeBall(); if (!b) break;
        var dx = cup.x - b.x, dz = cup.z - b.z, dist = hyp(dx, dz);
        St.aimYaw = Math.atan2(dx, dz) + (Math.random() * 2 - 1) * (0.03 + (t / tries) * 0.5); St.camYaw = St.aimYaw;
        St.power = clamp(Math.sqrt(dist / 2600) * scale + (Math.random() * 2 - 1) * 0.1, 0.1, 1);
        shoot(); strokes++;
        var settled = false;
        for (var s = 0; s < 800; s++) { tick(1 / 60); var pb = primeBall(); if (St.state === 'sunk' || (pb && pb.sunk)) { sunk = true; break; } if (St.state === 'aim') { settled = true; break; } }
        if (sunk) { best = Math.min(best, strokes); break; } if (!settled) break;
      }
    }
    return { beatable: sunk, strokes: sunk ? best : null };
  };
  // propose N fresh wacky holes — returns [{name, par, json}] ready to preview/publish
  PG.__proposeWacky = function (n, baseSeed) {
    n = n || 3; var out = [], seed = (baseSeed >>> 0) || ((new Date().getTime() ^ (St.frame || 0)) >>> 0);
    for (var i = 0; i < n; i++) { var h = genWacky(seed + i * 0x9E3779B1); out.push({ name: h.name, par: h.par, json: serializeHole(h) }); }
    return out;
  };
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
  // campaign-override + path-shape hooks (edit/save built-in levels; smooth/sharpen wall paths)
  PG.__overGet = function () { return overStore(); }; PG.__overSave = function (i) { return saveOver(i, edSerialize()); }; PG.__overClear = function (i) { if (i == null) { try { localStorage.removeItem('pg_over'); } catch (e) { } } else clearOver(i); };
  PG.__selectWallAt = function (wx, wz) { selectWallGroupAt(wx, wz, false); return ED.sel ? { kind: ED.sel.kind, segs: ED.sel.items ? ED.sel.items.length : 0, baseLen: ED.sel.base ? ED.sel.base.length : 0, closed: !!ED.sel.baseClosed } : null; };
  PG.__pathShape = function (simplify, round) { if (!ED.sel || ED.sel.kind !== 'wallgroup') return null; ED.sel.simplifyAmt = simplify || 0; ED.sel.smoothLevel = round || 0; applyPathShape(); return { segs: ED.sel.items.length }; };
  PG.__snapAngle = function (ax, az, bx, bz) { return snapAngle(ax, az, bx, bz); };
  // film-look hooks: toggle the post pass / live-tune aberration, grain, vignette
  PG.__fx = function (on) { if (R3.post) R3.post.on = on !== false; return R3.post ? R3.post.on : null; };
  PG.__fxSet = function (ca, grain, vig, dof) { if (!R3.post) return null; var u = R3.post.mat.uniforms; if (ca != null) R3.post.ca = ca; if (grain != null) u.uGrain.value = grain; if (vig != null) u.uVig.value = vig; if (dof != null) u.uDof.value = dof; return { ca: R3.post.ca, grain: u.uGrain.value, vig: u.uVig.value, dof: u.uDof.value, on: R3.post.on }; };
  PG.__mood = function (name) { if (name != null) { try { if (name === 'auto') localStorage.removeItem('pg_mood'); else localStorage.setItem('pg_mood', name); } catch (e) { } applyMood(resolveMood()); } return St.mood; };
  PG.__moods = function () { return MOOD_ORDER.map(function (k) { return { key: k, name: MOODS[k].name }; }); };
  PG.__applyMood = function () { applyMood(resolveMood()); };
  function showLookPicker() {
    var ex = document.getElementById('pg-look'); if (ex) { ex.remove(); return; }
    var ov = elt('div', 'position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(6,4,2,.22);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);', null, document.body); ov.id = 'pg-look';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    var box = elt('div', 'width:min(340px,90vw);max-height:88vh;overflow:auto;padding:20px;text-align:center;', null, ov);
    elt('div', 'font:900 21px Wantedo,Georgia;color:#ffffff;margin-bottom:2px;', 'LIGHTING LOOK', box);
    elt('div', 'font:600 12px Georgia;color:#ffffff;margin-bottom:10px;', 'Pick the mood — changes the whole game instantly.', box);
    var saved = 'auto'; try { saved = localStorage.getItem('pg_mood') || 'auto'; } catch (e) { }
    function row(key, label) {
      var active = (key === saved);
      var b = elt('button', 'display:block;width:100%;padding:11px;border:none;background:transparent;cursor:pointer;font:900 17px Wantedo,Georgia;color:' + (active ? '#ffffff' : '#cbb892') + ';' + (active ? 'text-decoration:underline;text-underline-offset:5px;' : ''), label, box);
      b.onclick = function () { try { if (key === 'auto') localStorage.removeItem('pg_mood'); else localStorage.setItem('pg_mood', key); } catch (e) { } applyMood(resolveMood()); ov.remove(); };
      return b;
    }
    row('auto', 'Auto (this hole’s look)');
    MOOD_ORDER.forEach(function (k) { row(k, MOODS[k].name); });
  }
  PG.__showLook = function () { showLookPicker(); };
  // daily / social hooks (testing + owner tooling)
  PG.__dailyNum = dailyNum; PG.__dailyIndex = dailyIndex; PG.__loadDaily = function (idx, ghost) { loadDaily(idx == null ? dailyIndex() : idx, ghost || null); return { hi: St.hi, name: St.hole.name, daily: St.daily, dailyN: St.dailyN }; };
  PG.__dailyState = function () { return { daily: !!St.daily, dailyN: St.dailyN, recShots: St.rec ? St.rec.shots.length : 0, recPath: St.rec ? St.rec.path.length : 0, ghost: !!St.ghost, ghostPlaying: St.ghost ? St.ghost.playing : false }; };
  PG.__encGhost = function () { return St.rec ? encGhost(St.rec) : null; }; PG.__decGhost = decGhost;
  PG.__shareStrings = function () { return St.rec ? shareStrings(St.rec) : null; }; PG.__dailyFinish = function () { dailyFinish(); };
  PG.__makeGif = function () { var b = St.rec ? makeHighlightGif(St.rec, 'test') : null; return b ? { size: b.size, type: b.type } : null; }; PG.__makeGifBlob = function () { return St.rec ? makeHighlightGif(St.rec, 'test') : null; };
  PG.__highlightSubPath = function (rec) { return highlightSubPath(rec || St.rec); };
  PG.__isl = function (name, par, wp, width, fn) { return isl(name, par, wp, width, fn); }; PG.__ribbon = function (wp, w) { return ribbon(wp, w); }; PG.__builder = function () { return builder(); }; PG.__finishHole = function (b, name, par, tee, cup, mnx, mxx, mnz, mxz) { return finish(b, name, par, tee, cup, mnx, mxx, mnz, mxz); }; PG.__loadHoleObj = function (h) { h.terrain = terrainFn(h.terrainFeatures, h.cup); rebuildBox(h); St.hole = h; St.hi = -1; St.customName = h.name; var t = h.tee; St.balls = [newBall(t.x, t.z, true)]; St.balls[0].y = h.terrain(t.x, t.z) + K.R; buildScene(h); St.strokes = 0; St.state = 'aim'; St.testing = true; var hy = Math.atan2(h.cup.x - t.x, h.cup.z - t.z); St.holeYaw = hy; St.camYaw = hy; St.aimYaw = hy; St.power = 0.5; return h.name; };
  PG.__enterDaily = function (idx, ghost) { enterDaily(idx == null ? null : idx, ghost || null); }; PG.__net = function () { return NET(); }; PG.__submitRun = function (nm) { return St.rec ? submitDailyRun(St.rec, nm || 'Tester') : null; };
  PG.__edSave = function () { edSave(); }; PG.__setOwnerMode = function (v) { St.ownerMode = !!v; };
  PG.__testDraft = function (tries, max) { return ED.draft ? testDraftBeatable(ED.draft, tries, max) : null; };
  PG.__streak = function (day) { return streakUpdate(day); }; PG.__prevDay = function (d) { return prevDay(d); };
  PG.__countdown = function () { return { ms: msToNextDaily(), str: fmtCountdown() }; };
  PG.__dailyDone = function () { return dailyDone(); }; PG.__clearDailyDone = function () { try { localStorage.removeItem('pg_daily_done'); } catch (e) { } };
  PG.__getTeam = function () { return getTeam(); }; PG.__setTeam = function (t) { setTeam(t); }; PG.__clearTeam = function () { setTeam(null); };
  PG.__pendingTeam = function (c) { if (c !== undefined) St.pendingTeam = c; return St.pendingTeam; }; PG.__joinPendingTeam = function (n) { joinPendingTeam(n); };
  PG.__enterTeamBall = function (players, hi) { enterTeamBall(players, hi); }; PG.__teamBallFinish = function () { teamBallFinish(); }; PG.__showTeamBallSetup = function () { showTeamBallSetup(); };
  PG.__enterBestBall = function (players, hi) { enterBestBall(players, hi); };
  PG.__showChampions = function () { showChampions(); };
  PG.__cta = function () { return dailyCTA(); }; PG.__ctas = function () { return SHARE_CTAS; };
  PG.__capReplay = function (path) { return capReplay(path); };
  PG.__stats = function () { return statsGet(); }; PG.__clearStats = function () { try { localStorage.removeItem('pg_stats'); } catch (e) { } };
  PG.__enterPastDaily = function (daysAgo) { enterPastDaily(daysAgo || 1); }; PG.__dailyIndexFor = dailyIndexFor; PG.__dailyNumFor = dailyNumFor;
  PG.__clearHowTo = function () { try { localStorage.removeItem('pg_seen_howto'); } catch (e) { } }; PG.__showHowTo = function () { showHowTo(); };
})();
