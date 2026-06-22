# Gunslingers Pinball Golf — QA Bug Log (Phase 2)

Errors found while testing every user story in [FEATURE-AUDIT.csv](FEATURE-AUDIT.csv).
Sources: live runtime testing (preview server) + 4 parallel code audits (gameplay, social, UI, owner).
Status: OPEN → FIXED (Phase 3) → VERIFIED (Phase 4).

## Live runtime test results (passed)
- **All 36 holes beatable** by the headless bot (0 failures). Core shoot→physics→sink→score loop solid.
- **All 14 looks** apply without error; render loop stays alive; wireframe hides surfaces, others keep them.
- Pickers/modals (FX look picker, Team Ball setup) build DOM overlays without throwing.
- No console errors on load. No empty icon buttons (FX/SND/cam labels all present).
- "NaN soft-lock" investigated → **NOT a real bug**: only triggers when the debug hook `PG.__shoot()` is called with no args (`atan2(undefined,undefined)`=NaN). Real game path (`onUp`→`shoot()`) uses the finite `St.aimYaw`. Noted hardening item B-H1.

## Bugs (by severity)

| ID | Sev | Title | Location | Status |
|----|-----|-------|----------|--------|
| B01 | HIGH | Booster pads never fire — `b.boostCd` uninitialized, so `undefined <= 0` is false (cannon/bouncer use `(x\|\|0)`) | pingolf.js:2054 | ⚠ REVERTED — see note |
| B02 | HIGH | Ghost mesh orphaned after any hole reload — `buildScene` replaces `R3.group`, `R3.ghostMesh` left on the removed group → rival/replay/leader ghost invisible | pingolf.js:1336 | ✅ FIXED+VERIFIED |
| B03 | HIGH | Daily streak never shown on revisit/stored card — `St.streak` only set in `dailyFinish`, undefined on reload | pingolf.js:showDailyCard | ✅ FIXED |
| B04 | HIGH | Champions top-3 rank cells render empty — medal emojis stripped, replaced with `''` not numbers | pingolf.js:4095 | ✅ FIXED+VERIFIED |
| B05 | MED | Highlight GIF picks tap-in not best shot for decoded/stored runs — shot `.i` indices not scaled to capped path | pingolf.js:highlightSubPath | ✅ FIXED |
| B06 | MED | Team create + explicit join double-counts creator | pingolf.js:3817 | ❌ NOT A BUG — `create_team` takes no player identity (`p_name` only), so the `joinTeam(code,who)` IS the creator's join, not a duplicate |
| B07 | MED | Leaderboard rank ("#R of N") from `net.standing` can disagree with rendered row order on ties | pingolf.js:renderLB | ✅ FIXED |
| B08 | MED | `__testHole` runs beatability under wrong physics — never calls `applyPhys` | pingolf.js:4332 | ✅ FIXED |
| B09 | MED | Bouncers (spring pads) uneditable/unerasable — not in `edItems()`, no draw case | pingolf.js:2655 | ✅ FIXED |
| B10 | MED | Owner unlock probe can reject a valid passcode if `save_bank` return shape differs | owner.html:119 | ✅ FIXED |
| B11 | MED | Dead empty char-class regex `/[]/g` in Team Ball share | pingolf.js:3968 | ✅ FIXED |
| B12 | MED | Team leaderboard rows use gold-tinted filled boxes — no-chrome + black/white rule violation | pingolf.js:3791 | ✅ FIXED |
| B13 | MED | Gold drop-shadow glow ring on daily-card name input — no-chrome (no shadows) + gold accent | pingolf.js:3730 | ✅ FIXED |
| B14 | LOW | Verdict strings trailing spaces ("BIRDIE ") → double space on cards | pingolf.js:3580,3951,4005 | ✅ FIXED+VERIFIED |
| B15 | LOW | Toast/button trailing spaces ("Copied ", "Posted ") | pingolf.js:3559,3765 | ✅ FIXED |
| B16 | LOW | Power-meter middle band + aim dots render white (global `COL.gold='#ffffff'`) — lost amber | pingolf.js:48 | ✅ FIXED+VERIFIED |
| B17 | LOW | Gold-tinted dividers/fills on player cards | pingolf.js:2256,3798,3908 | ✅ FIXED |
| B18 | LOW | "Watch Replay" (own) leaves ghost sphere frozen on screen — `St.ghost` not cleared | pingolf.js:3884 | ✅ FIXED |
| B19 | LOW | Gate & pendulum `phase` (+gate bounce `e`) dropped on editor serialize | pingolf.js:edSerialize/edDeserialize | ✅ FIXED |
| B20 | LOW | firering `period` dropped on editor round-trip | pingolf.js:edSerialize/edDeserialize | ✅ FIXED |
| B21 | LOW | `autoFill` publishes an untested hole after 3 failed regenerations | owner.html:243 | ✅ FIXED (skips day instead) |
| B22 | LOW | `?daily=N` shared link replays the specific built-in hole, not that day's published daily | pingolf.js:3476 | ⏸ BY DESIGN — challenge links intentionally replay the exact hole the sharer beat |
| B23 | LOW | `net.playerCount` HEAD wrapper would reject — dead code | net.js:41 | ⏸ WONTFIX — uncalled, no user impact |
| B24 | LOW | `applyShape` preset wipes current draft theme/phys/mood/_ov (reverts to grass) | pingolf.js:3204 | ✅ FIXED |
| B-H1 | LOW | Hardening: no NaN-position guard in `stepBall` — a non-finite ball never recovers | pingolf.js:stepBall | ✅ FIXED+VERIFIED |

### ⚠ B01 booster — needs an owner design decision
The booster guard bug is real (`undefined <= 0` is false → boosters never fire). **But enabling them regressed the beatability of 3 shipped holes** — CANYON SPLIT (#4), WINDMILL RUN (#13), LOOP-DE-LOOP CITY (#21) — which were balanced around dead boosters. Their boosters point straight at the cup at 2900–4200 speed, dead-center on the tee line: once live, the tee shot gets blasted out of control and the bot fails all 40 tries (these holes pass with boosters off). Reverted to protect the "all 36 beatable" invariant (the publish gate). To actually ship working boosters, those 3 holes' boosters need re-tuning (lower speed / offset from the tee line), then re-verify beatability. The fix + this note are in the code at pingolf.js booster block. Editor/genWacky boosters share the dead state — revisit together.

## Feature gaps (not regressions — noted, lower priority)
- **Multiball pad is cosmetic** — renders + `endShot` keeps closest-to-cup ball, but nothing spawns extra balls (pingolf.js:103). Documented behavior; not a regression.
- Dead `spinners` array (pingolf.js:64); `recentIdx` unused by procedural generator (owner.html:102); `multiball` has no editor params/tool (pingolf.js:2666).

## By design (do NOT change — prior owner-aligned decisions per ui-no-chrome memory)
- Cam-dock arrows ↺ ↻ ◎ and score-bar glyphs ● ◎ are monochrome UI glyphs, intentionally kept (not emojis).
</content>
