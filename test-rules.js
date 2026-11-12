#!/usr/bin/env node
/** Unit tests for ranged midline rules, movement, cannon, economy, combat. */
var R = require("./js/rules.js");
var fails = 0;

function assert(cond, msg) {
  if (!cond) {
    fails++;
    console.error("FAIL:", msg);
  } else {
    console.log("  ok:", msg);
  }
}

function eq(a, b, msg) {
  assert(a === b, msg + " (got " + a + ", expected " + b + ")");
}

function place(state, player, card, lane, cell) {
  var r = R.playCard(state, player, card, lane, cell);
  assert(r.ok, "place " + player + " " + card + " at " + lane + "/" + cell + (r.ok ? "" : " — " + r.error));
  return r.state;
}

console.log("=== ranged placement & shots ===");
(function () {
  var s = R.createState();
  // Left ranged cannot be placed on enemy half (cell 6+)
  var bad = R.playCard(s, "left", "ranged", 0, 7);
  assert(!bad.ok, "left ranged cannot place on cell 7 (enemy half)");
  var bad2 = R.playCard(s, "left", "ranged", 0, 11);
  assert(!bad2.ok, "left ranged cannot place on cell 11");
  s = place(s, "left", "ranged", 0, 2);
  var u = s.units[0];
  eq(u.cell, 2, "left ranged placed on cell 2");
  var shots = R.legalRangedShotCells("left", 2);
  assert(shots.indexOf(0) >= 0 && shots.indexOf(5) >= 0 && shots.indexOf(2) < 0, "left shots are own-half except 2");
  assert(shots.every(function (c) { return c <= 5; }), "no left shot past mid (cell 5)");
  assert(shots.indexOf(6) < 0 && shots.indexOf(11) < 0, "left cannot target 6–11");

  // Mirror for right
  var s2 = R.createState();
  assert(!R.playCard(s2, "right", "ranged", 1, 4).ok, "right ranged cannot place on cell 4 during left phase? or wrong phase");
  s2.phase = "right-place";
  assert(!R.playCard(s2, "right", "ranged", 1, 4).ok, "right ranged cannot place on cell 4 (enemy half for right)");
  s2 = place(s2, "right", "ranged", 1, 9);
  var rshots = R.legalRangedShotCells("right", 9);
  assert(rshots.every(function (c) { return c >= 6; }), "right shots only 6–11");
  assert(rshots.indexOf(5) < 0 && rshots.indexOf(0) < 0, "right cannot target 0–5");
})();

console.log("=== ranged walks on own half, holds at mid, never hits enemy half ===");
(function () {
  var s = R.createState();
  s = place(s, "left", "ranged", 0, 2);
  var res = R.resolveTurn(s);
  var ranged = res.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(ranged.cell, 3, "left ranged stepped 2→3");
  res = R.resolveTurn(res.state);
  ranged = res.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(ranged.cell, 4, "left ranged stepped 3→4");
  res = R.resolveTurn(res.state);
  ranged = res.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(ranged.cell, 5, "left ranged stepped 4→5 (mid edge)");
  res = R.resolveTurn(res.state);
  ranged = res.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(ranged.cell, 5, "left ranged holds at cell 5 and does not cross");
  assert(R.isOwnHalf("left", ranged.cell), "ranged still on own half");
  assert(ranged.cell <= 5, "ranged never entered enemy half");

  // Mirror: right ranged walks toward mid (cell 6) and holds
  var sR = R.createState();
  sR.phase = "right-place";
  sR = place(sR, "right", "ranged", 1, 9);
  res = R.resolveTurn(sR);
  var rr = res.state.units[0];
  eq(rr.cell, 8, "right ranged stepped 9→8");
  res = R.resolveTurn(res.state);
  rr = res.state.units[0];
  eq(rr.cell, 7, "right ranged stepped 8→7");
  res = R.resolveTurn(res.state);
  rr = res.state.units[0];
  eq(rr.cell, 6, "right ranged stepped 7→6 (mid edge)");
  res = R.resolveTurn(res.state);
  rr = res.state.units[0];
  eq(rr.cell, 6, "right ranged holds at cell 6 and does not cross");
  assert(R.isOwnHalf("right", rr.cell), "right ranged still on own half");

  // Shots still cannot reach past the midline, even from the mid edge
  s = R.createState();
  s = place(s, "left", "ranged", 0, 5); // mid-edge
  s.phase = "right-place";
  // Enemy melee on cell 8 (enemy half for left) and also one that crossed to cell 4
  s = place(s, "right", "melee", 0, 8);
  // Manually put a right melee onto left half to be a legal target
  s.units.push({
    id: s.nextId++,
    type: "melee",
    player: "right",
    lane: 0,
    cell: 4,
    hp: 7,
    maxHp: 7,
    halted: false,
    moveCharge: 0,
  });
  res = R.resolveTurn(s);
  s = res.state;
  ranged = s.units.filter(function (u) { return u.type === "ranged"; })[0];
  assert(ranged, "ranged still on board");
  eq(ranged.cell, 5, "ranged already at mid edge stays on 5");
  assert(R.isOwnHalf("left", ranged.cell), "ranged still on own half");

  var shots = res.events.filter(function (e) { return e.type === "shot"; });
  eq(shots.length, 1, "exactly one ranged shot");
  assert(shots[0].to === 4, "shot landed on cell 4 (own half)");
  assert(!shots.some(function (e) { return e.to >= 6; }), "no ranged shot targeted the enemy half");
  // The melee that started on 8 walks 8→7 and must still be at full HP.
  var walked = s.units.filter(function (u) { return u.player === "right" && u.type === "melee" && (u.cell === 7 || u.cell === 8); })[0];
  assert(walked && walked.hp === 7, "melee that started on cell 8 was not damaged by ranged");
  // 4 dmg (no melee counter from ranged): melee hp 7-4=3, unless it died from something else
  // Ranged vs melee is not a counter (melee beats ranged). Damage = 4.
  // The melee on 4 is adjacent in front of left ranged on 5? Left ranged is on 5, doesn't melee.
  // Right melee on 4 faces left (dir -1), front is cell 3, not 5. So no melee swing at the ranged.
  // After movement, right melee on 4 would try to step to 3.
  assert(shots[0].damage === 4, "ranged damage 4 (no counter vs melee)");
})();

console.log("=== ranged cannot shoot past mid even if we tamper ===");
(function () {
  var shooter = { type: "ranged", player: "left", lane: 0, cell: 3 };
  var far = { type: "melee", player: "right", lane: 0, cell: 7 };
  assert(!R.canRangedHit(shooter, far), "canRangedHit rejects cell 7");
  var midEnemy = { type: "melee", player: "right", lane: 0, cell: 5 };
  assert(R.canRangedHit(shooter, midEnemy), "canRangedHit allows enemy on cell 5 (own mid edge)");
  var otherLane = { type: "melee", player: "right", lane: 1, cell: 5 };
  assert(!R.canRangedHit(shooter, otherLane), "cannot shoot a different lane");
  var friend = { type: "melee", player: "left", lane: 0, cell: 4 };
  assert(!R.canRangedHit(shooter, friend), "cannot shoot a friend");
})();

console.log("=== cannon may hit the enemy half ===");
(function () {
  var s = R.createState();
  s.phase = "right-place";
  s = place(s, "right", "melee", 2, 9);
  s.phase = "left-place";
  var before = s.units[0].hp;
  var r = R.playCard(s, "left", "cannon", 2, 9);
  assert(r.ok, "cannon can target cell 9 on enemy half");
  eq(r.events[0].damage, 5, "cannon deals 5");
  var u = r.state.units[0];
  eq(u.hp, before - 5, "enemy on cell 9 took cannon damage");
})();

console.log("=== melee walks 1, stops at enemy, hits ship on cell 11 ===");
(function () {
  var s = R.createState();
  s = place(s, "left", "melee", 1, 5);
  var res = R.resolveTurn(s); // only left placed; resolve still works
  // After resolve, melee should be on cell 6
  var u = res.state.units[0];
  eq(u.cell, 6, "melee stepped 5→6");
  // Fast-forward to cell 11
  s = res.state;
  s.units[0].cell = 10;
  s.phase = "resolve";
  res = R.resolveTurn(s);
  eq(res.state.units[0].cell, 11, "melee stepped 10→11");
  var shipHits = res.events.filter(function (e) { return e.type === "ship"; });
  eq(shipHits.length, 1, "ship was hit when melee reached 11");
  eq(res.state.hp.right, 40 - 8, "right ship took 8");
})();

console.log("=== defense walks every Advance; ranged walks but not across mid ===");
(function () {
  var s = R.createState();
  s = place(s, "left", "defense", 0, 3);
  s.phase = "right-place";
  // Need gold for ranged on right — start is 6, ranged is 4
  s = place(s, "right", "ranged", 0, 8);
  var r1 = R.resolveTurn(s);
  var d = r1.state.units.filter(function (u) { return u.type === "defense"; })[0];
  var rg = r1.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(d.cell, 4, "defense stepped 3→4 on first resolve");
  eq(rg.cell, 7, "right ranged stepped 8→7 on first resolve");
  var r2 = R.resolveTurn(r1.state);
  d = r2.state.units.filter(function (u) { return u.type === "defense"; })[0];
  rg = r2.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(d.cell, 5, "defense stepped 4→5 on second resolve");
  eq(rg.cell, 6, "right ranged stepped 7→6 (mid edge)");
  var r3 = R.resolveTurn(r2.state);
  rg = r3.state.units.filter(function (u) { return u.type === "ranged"; })[0];
  eq(rg.cell, 6, "right ranged holds at 6 and does not enter the player half");
})();

console.log("=== trap triggers on step and is consumed ===");
(function () {
  var s = R.createState();
  s = place(s, "left", "trap", 1, 4);
  s.phase = "right-place";
  // Put a right melee on cell 5 so it walks onto 4 (dir -1)
  s.units.push({
    id: s.nextId++,
    type: "melee",
    player: "right",
    lane: 1,
    cell: 5,
    hp: 7,
    maxHp: 7,
    halted: false,
    moveCharge: 0,
  });
  var res = R.resolveTurn(s);
  var traps = res.events.filter(function (e) { return e.type === "trap"; });
  eq(traps.length, 1, "trap triggered once");
  eq(traps[0].damage, 4, "trap deals 4");
  eq(res.state.traps.length, 0, "trap consumed");
  var u = res.state.units[0];
  eq(u.hp, 3, "melee 7-4=3");
  eq(u.cell, 4, "melee stepped onto the trap cell");
  // Halted: next resolve should not move
  var res2 = R.resolveTurn(res.state);
  u = res2.state.units[0];
  eq(u.cell, 4, "halted melee skipped the next step");
})();

console.log("=== counters: melee>ranged is 1.5× ===");
(function () {
  eq(R.effectiveDamage(4, "melee", "ranged"), 6, "melee vs ranged = 6");
  eq(R.effectiveDamage(4, "ranged", "defense"), 6, "ranged vs defense = 6");
  eq(R.effectiveDamage(2, "defense", "melee"), 3, "defense vs melee = 3");
  eq(R.effectiveDamage(4, "melee", "defense"), 4, "melee vs defense = 4 (no bonus)");
  eq(R.effectiveDamage(4, "ranged", "melee"), 4, "ranged vs melee = 4 (no bonus)");
})();

console.log("=== economy, cap, cooldown ===");
(function () {
  var s = R.createState();
  eq(s.gold.left, 6, "start gold 6");
  s = place(s, "left", "melee", 0, 1);
  eq(s.gold.left, 3, "spent 3 on melee");
  eq(s.cooldown.left.melee, 1, "melee on CD");
  var again = R.playCard(s, "left", "melee", 0, 2);
  assert(!again.ok, "cannot spam melee while on cooldown");
  var res = R.resolveTurn(s);
  eq(res.state.gold.left, 5, "income +2 after resolve (3+2)");
  eq(res.state.gold.right, 8, "right income 6+2=8");
  eq(res.state.cooldown.left.melee, 0, "cooldown ticked to 0");
  // cap
  res.state.gold.left = 11;
  res = R.resolveTurn(res.state);
  eq(res.state.gold.left, 12, "gold capped at 12");
})();

console.log("=== fight instead of stacking ===");
(function () {
  var s = R.createState();
  s.units = [
    { id: 1, type: "melee", player: "left", lane: 0, cell: 5, hp: 7, maxHp: 7, halted: false, moveCharge: 0 },
    { id: 2, type: "defense", player: "right", lane: 0, cell: 6, hp: 12, maxHp: 12, halted: false, moveCharge: 0 },
  ];
  s.nextId = 3;
  var res = R.resolveTurn(s);
  var left = res.state.units.filter(function (u) { return u.player === "left"; })[0];
  var right = res.state.units.filter(function (u) { return u.player === "right"; })[0];
  eq(left.cell, 5, "melee did not stack onto the defense");
  eq(right.cell, 6, "defense stayed (blocked by adjacent melee)");
  // melee 4 vs defense (no bonus) -> def hp 8; defense 3 vs melee (counter) -> melee hp 4
  eq(right.hp, 8, "defense took 4");
  eq(left.hp, 4, "melee took 3 (defense effective)");
  var attacks = res.events.filter(function (e) { return e.type === "attack"; });
  assert(attacks.some(function (e) { return e.effective && e.attackerId === 2; }), "defense swing marked effective");
})();

console.log("=== game ends when ship HP hits 0 ===");
(function () {
  var s = R.createState();
  s.hp.right = 5;
  s.units.push({
    id: 1, type: "melee", player: "left", lane: 0, cell: 11,
    hp: 7, maxHp: 7, halted: false, moveCharge: 0,
  });
  var res = R.resolveTurn(s);
  eq(res.state.hp.right, 0, "ship hp floored at 0");
  eq(res.state.winner, "left", "left wins");
  eq(res.state.phase, "gameover", "phase is gameover");
})();

console.log("=== endPlacement loop ===");
(function () {
  var s = R.createState();
  var a = R.endPlacement(s);
  eq(a.state.phase, "right-place", "left done -> right-place");
  assert(!a.shouldResolve, "left done does not resolve");
  var b = R.endPlacement(a.state);
  eq(b.state.phase, "resolve", "right done -> resolve");
  assert(b.shouldResolve, "right done should resolve");
})();

console.log("=== playerAdvance is PvE: bot deploys, then resolve ===");
(function () {
  var s = R.createState();
  var a = R.playerAdvance(s);
  assert(a.ok, "playerAdvance from left-place is ok");
  eq(a.state.phase, "resolve", "playerAdvance ends in resolve (no human right-place)");
  assert(a.shouldResolve, "playerAdvance should resolve");
  assert(a.plays.length >= 1, "bot made at least one play with starting gold");
  a.plays.forEach(function (play) {
    if (play.card === "cannon") return;
    assert(play.cell >= 6, "bot " + play.card + " was placed on its own half (cell " + play.cell + ")");
  });
  a.state.units.filter(function (u) { return u.player === "right"; }).forEach(function (u) {
    assert(u.cell >= 6, "bot unit " + u.type + " is on the right half after deploy");
  });
  a.state.traps.filter(function (t) { return t.player === "right"; }).forEach(function (t) {
    assert(t.cell >= 6, "bot trap is on the right half");
  });
})();

console.log("=== AI never places walkers or traps on the player half ===");
(function () {
  var s = R.createState();
  // Give the bot something to react to on both halves
  s = place(s, "left", "melee", 0, 5);
  s = place(s, "left", "defense", 1, 4);
  s.phase = "right-place";
  // A left melee that has already crossed into the bot half (valid threat)
  s.units.push({
    id: s.nextId++,
    type: "melee",
    player: "left",
    lane: 2,
    cell: 8,
    hp: 7,
    maxHp: 7,
    halted: false,
    moveCharge: 0,
  });
  s.gold.right = 12;
  var ai = R.applyAiPlacement(s);
  assert(ai.plays.length >= 1, "bot spends some of its 12 gold");
  ai.plays.forEach(function (play) {
    if (play.card === "cannon") {
      var target = R.unitAt(s, play.lane, play.cell) || R.unitAt(ai.state, play.lane, play.cell);
      // Cannon may target the player's half; it must still hit an enemy (left) cell
      assert(play.lane >= 0 && play.cell >= 0 && play.cell <= 11, "cannon target is on the board");
      return;
    }
    assert(play.cell >= 6 && play.cell <= 11, "bot " + play.card + " not placed on player half (cell " + play.cell + ")");
  });
  ai.state.units.filter(function (u) { return u.player === "right"; }).forEach(function (u) {
    assert(R.isOwnHalf("right", u.cell), "bot unit stayed on its half at deploy");
  });
  ai.state.traps.filter(function (t) { return t.player === "right"; }).forEach(function (t) {
    assert(R.isOwnHalf("right", t.cell), "bot trap stayed on its half");
  });
  // Bot respects cooldowns: no duplicate of the same card in one deploy
  var counts = {};
  ai.plays.forEach(function (play) {
    counts[play.card] = (counts[play.card] || 0) + 1;
  });
  Object.keys(counts).forEach(function (card) {
    eq(counts[card], 1, "bot played " + card + " at most once (cooldown)");
  });
  var spent = 12 - ai.state.gold.right;
  assert(spent >= 0 && ai.state.gold.right >= 0, "bot gold never went negative");
  assert(spent <= 12, "bot did not spend more than it had");
})();

console.log("=== AI prefers melee on an under-defended lane ===");
(function () {
  var s = R.createState();
  // Lane 0 well defended, lanes 1 and 2 empty — bot should send melee at 11 of a weak lane
  s = place(s, "left", "defense", 0, 3);
  s = place(s, "left", "melee", 0, 2);
  var adv = R.playerAdvance(s);
  var melees = adv.plays.filter(function (p) { return p.card === "melee"; });
  assert(melees.length === 1, "bot sent one melee with starting gold / cooldown");
  assert(melees[0].lane !== 0, "bot melee avoided the well-defended lane 0 (lane " + melees[0].lane + ")");
  assert(melees[0].cell >= 6, "bot melee spawned on its own half");
})();

if (fails) {
  console.error("\n" + fails + " test(s) failed");
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
