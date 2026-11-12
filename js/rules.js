/**
 * Pirate Bridge Battle — pure game rules (browser + Node).
 *
 * Board: 3 lanes × 12 cells. Left owns 0–5, right owns 6–11.
 * Midline sits between cells 5 and 6.
 *
 * Unit stats (kept small so a game ends in several Advances, not dozens):
 *   melee   3g  HP 7   ATK 4   ship 8   moves 1/turn
 *   defense 2g  HP 12  ATK 2   ship 5   moves 1/turn
 *   ranged  4g  HP 5   ATK 4   no ship  walks on own half up to the midline; shots only on own half
 *   cannon  3g  instant 5 dmg to an enemy unit (MAY reach enemy half)
 *   trap    2g  4 dmg + halt when an enemy is on / steps onto the cell
 *
 * Counters (1.5× dmg, rounded up): melee>ranged, ranged>defense, defense>melee.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PirateRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LANES = 3;
  var CELLS = 12;
  var MID_LEFT = 5;
  var MID_RIGHT = 6;
  var SHIP_HP = 40;
  var GOLD_START = 6;
  var GOLD_INCOME = 2;
  var GOLD_CAP = 12;
  var CARD_TYPES = ["melee", "defense", "ranged", "cannon", "trap"];

  var CARDS = {
    melee: {
      id: "melee",
      cost: 3,
      hp: 7,
      atk: 4,
      shipAtk: 8,
      label: "MELEE",
      sub: "beats Ranged",
    },
    defense: {
      id: "defense",
      cost: 2,
      hp: 12,
      atk: 2,
      shipAtk: 5,
      label: "DEFENSE",
      sub: "beats Melee",
    },
    ranged: {
      id: "ranged",
      cost: 4,
      hp: 5,
      atk: 4,
      shipAtk: 0,
      label: "RANGED",
      sub: "to mid · no cross",
    },
    cannon: {
      id: "cannon",
      cost: 3,
      damage: 5,
      label: "CANNON",
      sub: "interference",
    },
    trap: {
      id: "trap",
      cost: 2,
      damage: 4,
      label: "TRAP",
      sub: "interference",
    },
  };

  var COUNTER = { melee: "ranged", ranged: "defense", defense: "melee" };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function other(player) {
    return player === "left" ? "right" : "left";
  }

  function dirOf(player) {
    return player === "left" ? 1 : -1;
  }

  function ownHalfCells(player) {
    return player === "left" ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
  }

  function isOwnHalf(player, cell) {
    return player === "left" ? cell >= 0 && cell <= MID_LEFT : cell >= MID_RIGHT && cell <= 11;
  }

  function isEnemyHalf(player, cell) {
    return cell >= 0 && cell <= 11 && !isOwnHalf(player, cell);
  }

  function effectiveDamage(atk, attackerType, defenderType) {
    if (COUNTER[attackerType] === defenderType) return Math.ceil(atk * 1.5);
    return atk;
  }

  function isEffective(attackerType, defenderType) {
    return COUNTER[attackerType] === defenderType;
  }

  function emptyCooldowns() {
    return { melee: 0, defense: 0, ranged: 0, cannon: 0, trap: 0 };
  }

  function createState() {
    return {
      turn: 1,
      phase: "left-place", // left-place | right-place | resolve | gameover
      gold: { left: GOLD_START, right: GOLD_START },
      hp: { left: SHIP_HP, right: SHIP_HP },
      cooldown: { left: emptyCooldowns(), right: emptyCooldowns() },
      units: [],
      traps: [],
      nextId: 1,
      winner: null, // "left" | "right" | "draw"
    };
  }

  function unitAt(state, lane, cell) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.lane === lane && u.cell === cell && u.hp > 0) return u;
    }
    return null;
  }

  function trapAt(state, lane, cell) {
    for (var i = 0; i < state.traps.length; i++) {
      var t = state.traps[i];
      if (t.lane === lane && t.cell === cell) return t;
    }
    return null;
  }

  function findUnit(state, id) {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id === id) return state.units[i];
    }
    return null;
  }

  /**
   * Legal shot cells for a ranged unit: same lane, own half only,
   * not past the midline, any own-half cell except its own.
   */
  function legalRangedShotCells(player, cell) {
    var cells = ownHalfCells(player);
    var out = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] !== cell) out.push(cells[i]);
    }
    return out;
  }

  function canRangedHit(shooter, target) {
    if (!shooter || !target) return false;
    if (shooter.type !== "ranged") return false;
    if (shooter.lane !== target.lane) return false;
    if (shooter.player === target.player) return false;
    if (!isOwnHalf(shooter.player, target.cell)) return false;
    if (shooter.cell === target.cell) return false;
    return true;
  }

  function canAfford(state, player, card) {
    var def = CARDS[card];
    return def && state.gold[player] >= def.cost;
  }

  function onCooldown(state, player, card) {
    return state.cooldown[player][card] > 0;
  }

  function isPlacePhase(state, player) {
    return (
      (player === "left" && state.phase === "left-place") ||
      (player === "right" && state.phase === "right-place")
    );
  }

  function cellEmptyForPlace(state, lane, cell) {
    return !unitAt(state, lane, cell) && !trapAt(state, lane, cell);
  }

  /**
   * Legal cells to click for a selected card.
   * Cannon: any cell that has an enemy unit (both halves).
   * Others: empty cells on the current player's own half.
   */
  function legalCells(state, player, card) {
    var cells = [];
    var lane, cell, u;
    if (card === "cannon") {
      for (lane = 0; lane < LANES; lane++) {
        for (cell = 0; cell < CELLS; cell++) {
          u = unitAt(state, lane, cell);
          if (u && u.player !== player) cells.push({ lane: lane, cell: cell });
        }
      }
      return cells;
    }
    for (lane = 0; lane < LANES; lane++) {
      for (cell = 0; cell < CELLS; cell++) {
        if (isOwnHalf(player, cell) && cellEmptyForPlace(state, lane, cell)) {
          cells.push({ lane: lane, cell: cell });
        }
      }
    }
    return cells;
  }

  function isLegalCell(state, player, card, lane, cell) {
    var list = legalCells(state, player, card);
    for (var i = 0; i < list.length; i++) {
      if (list[i].lane === lane && list[i].cell === cell) return true;
    }
    return false;
  }

  function canPlay(state, player, card) {
    if (state.winner) return false;
    if (!isPlacePhase(state, player)) return false;
    if (CARD_TYPES.indexOf(card) < 0) return false;
    if (!canAfford(state, player, card)) return false;
    if (onCooldown(state, player, card)) return false;
    return legalCells(state, player, card).length > 0;
  }

  function playCard(state, player, card, lane, cell) {
    var s = clone(state);
    if (!canPlay(s, player, card)) {
      return { ok: false, error: "cannot play", state: s, events: [] };
    }
    if (!isLegalCell(s, player, card, lane, cell)) {
      return { ok: false, error: "illegal cell", state: s, events: [] };
    }

    var def = CARDS[card];
    s.gold[player] -= def.cost;
    s.cooldown[player][card] = 1;
    var events = [];

    if (card === "cannon") {
      var target = unitAt(s, lane, cell);
      var dmg = 0;
      var killed = false;
      if (target && target.player !== player) {
        dmg = def.damage;
        target.hp -= dmg;
        killed = target.hp <= 0;
        events.push({
          type: "cannon",
          player: player,
          lane: lane,
          cell: cell,
          targetId: target.id,
          damage: dmg,
          killed: killed,
        });
        if (killed) removeUnit(s, target.id);
      } else {
        events.push({
          type: "cannon",
          player: player,
          lane: lane,
          cell: cell,
          targetId: null,
          damage: 0,
          killed: false,
        });
      }
      checkWinner(s);
      return { ok: true, state: s, events: events };
    }

    if (card === "trap") {
      var trap = { id: s.nextId++, player: player, lane: lane, cell: cell };
      s.traps.push(trap);
      events.push({ type: "place-trap", trap: clone(trap) });
      return { ok: true, state: s, events: events };
    }

    // Permanent walker (melee / defense / ranged). Ranged may only be
    // placed on own half — already enforced by isLegalCell / isOwnHalf.
    if (card === "ranged" && isEnemyHalf(player, cell)) {
      return { ok: false, error: "ranged cannot enter enemy half", state: state, events: [] };
    }

    var unit = {
      id: s.nextId++,
      type: card,
      player: player,
      lane: lane,
      cell: cell,
      hp: def.hp,
      maxHp: def.hp,
      halted: false,
      moveCharge: 0,
    };
    s.units.push(unit);
    events.push({ type: "place-unit", unit: clone(unit) });
    return { ok: true, state: s, events: events };
  }

  function removeUnit(state, id) {
    state.units = state.units.filter(function (u) {
      return u.id !== id && u.hp > 0;
    });
  }

  function removeDead(state, events) {
    var dead = state.units.filter(function (u) {
      return u.hp <= 0;
    });
    dead.forEach(function (u) {
      events.push({ type: "death", unitId: u.id, player: u.player, typeName: u.type, lane: u.lane, cell: u.cell });
    });
    state.units = state.units.filter(function (u) {
      return u.hp > 0;
    });
  }

  function removeTrap(state, id) {
    state.traps = state.traps.filter(function (t) {
      return t.id !== id;
    });
  }

  function triggerTrap(state, trap, unit, events, reason) {
    if (!trap || !unit || unit.player === trap.player) return;
    var dmg = CARDS.trap.damage;
    unit.hp -= dmg;
    unit.halted = true;
    events.push({
      type: "trap",
      trapId: trap.id,
      player: trap.player,
      lane: trap.lane,
      cell: trap.cell,
      unitId: unit.id,
      damage: dmg,
      killed: unit.hp <= 0,
      reason: reason || "on-cell",
    });
    removeTrap(state, trap.id);
  }

  /**
   * Closest enemy in the shooter's legal own-half shot cells (same lane).
   */
  function rangedTarget(state, shooter) {
    var cells = legalRangedShotCells(shooter.player, shooter.cell);
    var best = null;
    var bestDist = 99;
    for (var i = 0; i < state.units.length; i++) {
      var t = state.units[i];
      if (t.hp <= 0) continue;
      if (!canRangedHit(shooter, t)) continue;
      if (cells.indexOf(t.cell) < 0) continue;
      var dist = Math.abs(t.cell - shooter.cell);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    return best;
  }

  function frontCell(unit) {
    return unit.cell + dirOf(unit.player);
  }

  function adjacentEnemy(state, unit) {
    var front = frontCell(unit);
    if (front < 0 || front > 11) return unitAt(state, unit.lane, unit.cell) !== unit
      ? null
      : null;
    var t = unitAt(state, unit.lane, front);
    if (t && t.player !== unit.player) return t;
    // Same-cell clash (should be rare)
    var same = state.units.filter(function (u) {
      return u.id !== unit.id && u.lane === unit.lane && u.cell === unit.cell && u.player !== unit.player && u.hp > 0;
    });
    return same[0] || null;
  }

  function checkWinner(state) {
    var l = state.hp.left <= 0;
    var r = state.hp.right <= 0;
    if (l && r) {
      state.winner = "draw";
      state.phase = "gameover";
    } else if (l) {
      state.winner = "right";
      state.phase = "gameover";
    } else if (r) {
      state.winner = "left";
      state.phase = "gameover";
    }
  }

  /**
   * End the current side's placement.
   * Left done -> right-place (bot then deploys). Right done -> resolve.
   */
  function endPlacement(state) {
    var s = clone(state);
    if (s.phase === "left-place") {
      s.phase = "right-place";
      return { ok: true, state: s, shouldResolve: false };
    }
    if (s.phase === "right-place") {
      s.phase = "resolve";
      return { ok: true, state: s, shouldResolve: true };
    }
    return { ok: false, state: s, shouldResolve: false };
  }

  /**
   * Resolve one Advance. Returns a new state plus a readable event list.
   * Order: traps → ranged shots → melee/defense swings → movement → ship hits → income.
   */
  function resolveTurn(state) {
    var s = clone(state);
    var events = [];
    if (s.winner) return { state: s, events: events };

    // a. Traps already under an enemy
    events.push({ type: "phase", name: "traps" });
    s.traps.slice().forEach(function (trap) {
      var u = unitAt(s, trap.lane, trap.cell);
      if (u && u.player !== trap.player) triggerTrap(s, trap, u, events, "on-cell");
    });
    removeDead(s, events);
    if (s.winner) return { state: s, events: events };

    // b1. Ranged shots (simultaneous: snapshot targets, then apply)
    events.push({ type: "phase", name: "ranged" });
    var shots = [];
    s.units.forEach(function (u) {
      if (u.type !== "ranged" || u.hp <= 0) return;
      var t = rangedTarget(s, u);
      if (t) shots.push({ shooter: u, target: t });
    });
    shots.forEach(function (sh) {
      var t = findUnit(s, sh.target.id);
      var shooter = findUnit(s, sh.shooter.id);
      if (!t || t.hp <= 0 || !shooter) return;
      // Re-validate: never allow a shot onto the enemy half.
      if (!canRangedHit(shooter, t)) return;
      var eff = isEffective(shooter.type, t.type);
      var dmg = effectiveDamage(CARDS.ranged.atk, shooter.type, t.type);
      t.hp -= dmg;
      events.push({
        type: "shot",
        shooterId: shooter.id,
        targetId: t.id,
        lane: shooter.lane,
        from: shooter.cell,
        to: t.cell,
        damage: dmg,
        effective: eff,
        killed: t.hp <= 0,
      });
    });
    removeDead(s, events);

    // b2. Melee / defense adjacent swings (simultaneous)
    events.push({ type: "phase", name: "melee" });
    var swings = [];
    s.units.forEach(function (u) {
      if (u.type === "ranged" || u.hp <= 0) return;
      var t = adjacentEnemy(s, u);
      if (t) swings.push({ attacker: u, target: t });
    });
    swings.forEach(function (sw) {
      var a = findUnit(s, sw.attacker.id);
      var t = findUnit(s, sw.target.id);
      if (!a || !t || a.hp <= 0 || t.hp <= 0) return;
      var eff = isEffective(a.type, t.type);
      var dmg = effectiveDamage(CARDS[a.type].atk, a.type, t.type);
      t.hp -= dmg;
      events.push({
        type: "attack",
        attackerId: a.id,
        targetId: t.id,
        lane: a.lane,
        from: a.cell,
        to: t.cell,
        damage: dmg,
        effective: eff,
        killed: t.hp <= 0,
      });
    });
    removeDead(s, events);

    // c. Movement (melee and defense every turn; ranged walks only on own half)
    events.push({ type: "phase", name: "move" });
    // Process from front to back so blockers are consistent: left units
    // in descending cell, right units in ascending cell (closest to enemy first).
    var movers = s.units.filter(function (u) {
      return u.hp > 0;
    });
    movers.sort(function (a, b) {
      if (a.player !== b.player) return a.player === "left" ? -1 : 1;
      return a.player === "left" ? b.cell - a.cell : a.cell - b.cell;
    });

    movers.forEach(function (u) {
      u = findUnit(s, u.id);
      if (!u || u.hp <= 0) return;

      if (isEnemyHalf(u.player, u.cell) && u.type === "ranged") {
        // Safety snap (should never happen): ranged never ends on the enemy half.
        u.cell = u.player === "left" ? MID_LEFT : MID_RIGHT;
      }

      if (u.halted) {
        u.halted = false;
        return;
      }

      var dest = u.cell + dirOf(u.player);
      if (dest < 0 || dest > 11) return;
      // Hard rule: ranged may walk forward on their own half, but cannot
      // cross the midline. They hold on the last own-half cell and shoot.
      if (u.type === "ranged" && !isOwnHalf(u.player, dest)) return;
      var blocker = unitAt(s, u.lane, dest);
      if (blocker) {
        // Fight instead of stacking (they already swung if adjacent).
        events.push({
          type: "blocked",
          unitId: u.id,
          lane: u.lane,
          from: u.cell,
          to: dest,
          blockerId: blocker.id,
        });
        return;
      }
      var from = u.cell;
      u.cell = dest;
      events.push({ type: "move", unitId: u.id, lane: u.lane, from: from, to: dest });

      var stepped = trapAt(s, u.lane, dest);
      if (stepped && stepped.player !== u.player) {
        triggerTrap(s, stepped, u, events, "step-on");
      }
    });
    removeDead(s, events);

    // d. Ship damage: left unit on cell 11, right unit on cell 0
    events.push({ type: "phase", name: "ships" });
    s.units.forEach(function (u) {
      if (u.hp <= 0) return;
      var shipHit = (u.player === "left" && u.cell === 11) || (u.player === "right" && u.cell === 0);
      if (!shipHit) return;
      var dmg = CARDS[u.type].shipAtk || 0;
      if (dmg <= 0) return;
      var victim = other(u.player);
      s.hp[victim] -= dmg;
      if (s.hp[victim] < 0) s.hp[victim] = 0;
      events.push({
        type: "ship",
        unitId: u.id,
        player: u.player,
        target: victim,
        damage: dmg,
        hpLeft: s.hp[victim],
        lane: u.lane,
        cell: u.cell,
      });
    });
    checkWinner(s);

    // e. Income + cooldown tick, next placement (unless game over)
    events.push({ type: "phase", name: "income" });
    ["left", "right"].forEach(function (p) {
      s.gold[p] = Math.min(GOLD_CAP, s.gold[p] + GOLD_INCOME);
      CARD_TYPES.forEach(function (c) {
        if (s.cooldown[p][c] > 0) s.cooldown[p][c] -= 1;
      });
    });
    if (!s.winner) {
      s.turn += 1;
      s.phase = "left-place";
    }
    return { state: s, events: events };
  }


  function midEdge(player) {
    return player === "left" ? MID_LEFT : MID_RIGHT;
  }

  function rightmostEmpty(state, lane) {
    var cells = ownHalfCells("right");
    for (var i = cells.length - 1; i >= 0; i--) {
      if (cellEmptyForPlace(state, lane, cells[i])) return cells[i];
    }
    return null;
  }

  function lanePlayerDefense(state, lane) {
    var score = 0;
    var i, u, t;
    for (i = 0; i < state.units.length; i++) {
      u = state.units[i];
      if (u.lane !== lane || u.hp <= 0) continue;
      if (u.player === "left") {
        if (u.type === "defense") score += 4;
        else if (u.type === "melee") score += 3;
        else score += 2;
      } else {
        score -= 1;
      }
    }
    for (i = 0; i < state.traps.length; i++) {
      t = state.traps[i];
      if (t.lane === lane && t.player === "left") score += 2;
    }
    return score;
  }

  function leftThreatInLane(state, lane) {
    var best = null;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.lane !== lane || u.hp <= 0 || u.player !== "left") continue;
      if (!best || u.cell > best.cell) best = u;
    }
    return best;
  }

  function pickCannonTarget(state) {
    var list = legalCells(state, "right", "cannon");
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var u = unitAt(state, c.lane, c.cell);
      if (!u || u.player !== "left") continue;
      var kill = u.hp <= CARDS.cannon.damage;
      var nearShip = u.cell >= 8;
      if (!kill && !nearShip) continue;
      var score = (kill ? 20 : 0) + u.cell + (u.type === "melee" ? 3 : u.type === "defense" ? 2 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function pickTrapCell(state) {
    var best = null;
    var bestCell = -1;
    for (var lane = 0; lane < LANES; lane++) {
      var threat = leftThreatInLane(state, lane);
      if (!threat) continue;
      var dest = threat.cell + 1; // left units walk toward 11
      if (!isOwnHalf("right", dest)) continue;
      if (!cellEmptyForPlace(state, lane, dest)) continue;
      if (dest > bestCell) {
        bestCell = dest;
        best = { lane: lane, cell: dest };
      }
    }
    return best;
  }

  function pickReactiveDefense(state) {
    var best = null;
    var bestScore = -1;
    for (var lane = 0; lane < LANES; lane++) {
      var threat = leftThreatInLane(state, lane);
      if (!threat) continue;
      var incoming = threat.type === "melee" || threat.cell >= MID_LEFT;
      if (!incoming) continue;
      var hasDef = state.units.some(function (u) {
        return u.player === "right" && u.lane === lane && u.type === "defense" && u.hp > 0;
      });
      if (hasDef) continue;
      var cell = rightmostEmpty(state, lane);
      if (cell == null) continue;
      var score = threat.cell + (threat.type === "melee" ? 5 : 2);
      if (score > bestScore) {
        bestScore = score;
        best = { lane: lane, cell: cell };
      }
    }
    return best;
  }

  function pickReactiveRanged(state) {
    var need = state.units.some(function (u) {
      return u.player === "left" && u.hp > 0 && u.cell >= MID_LEFT;
    });
    if (!need) return null;
    var best = null;
    var bestScore = -1;
    for (var lane = 0; lane < LANES; lane++) {
      var threat = leftThreatInLane(state, lane);
      if (!threat || threat.cell < MID_LEFT) continue;
      var hasRanged = state.units.some(function (u) {
        return u.player === "right" && u.lane === lane && u.type === "ranged" && u.hp > 0;
      });
      if (hasRanged) continue;
      var cell = rightmostEmpty(state, lane);
      if (cell == null) continue;
      if (scoreLaneForRanged(threat) > bestScore) {
        bestScore = scoreLaneForRanged(threat);
        best = { lane: lane, cell: cell };
      }
    }
    return best;
  }

  function scoreLaneForRanged(threat) {
    return threat ? threat.cell : -1;
  }

  function pickAttackLane(state) {
    var bestLane = 0;
    var bestScore = Infinity;
    for (var lane = 0; lane < LANES; lane++) {
      if (rightmostEmpty(state, lane) == null) continue;
      var score = lanePlayerDefense(state, lane);
      if (score < bestScore || (score === bestScore && lane < bestLane)) {
        bestScore = score;
        bestLane = lane;
      }
    }
    if (rightmostEmpty(state, bestLane) == null) return null;
    return bestLane;
  }

  function pickMeleePlace(state) {
    var lane = pickAttackLane(state);
    if (lane == null) return null;
    var cell = rightmostEmpty(state, lane);
    if (cell == null) return null;
    return { lane: lane, cell: cell };
  }

  function pickProactiveDefense(state) {
    var lane = pickAttackLane(state);
    if (lane == null) return null;
    var cell = rightmostEmpty(state, lane);
    if (cell == null) return null;
    return { lane: lane, cell: cell };
  }

  function chooseNextAiPlay(state) {
    if (state.winner || state.phase !== "right-place") return null;

    if (canPlay(state, "right", "cannon")) {
      var cannon = pickCannonTarget(state);
      if (cannon) return { card: "cannon", lane: cannon.lane, cell: cannon.cell };
    }

    if (canPlay(state, "right", "trap")) {
      var trap = pickTrapCell(state);
      if (trap) return { card: "trap", lane: trap.lane, cell: trap.cell };
    }

    if (canPlay(state, "right", "defense")) {
      var def = pickReactiveDefense(state);
      if (def) return { card: "defense", lane: def.lane, cell: def.cell };
    }

    if (canPlay(state, "right", "ranged")) {
      var ranged = pickReactiveRanged(state);
      if (ranged) return { card: "ranged", lane: ranged.lane, cell: ranged.cell };
    }

    if (canPlay(state, "right", "melee")) {
      var melee = pickMeleePlace(state);
      if (melee) return { card: "melee", lane: melee.lane, cell: melee.cell };
    }

    // Melee is on cooldown or unaffordable: send a walking defense down a weak lane.
    if (canPlay(state, "right", "defense")) {
      var extra = pickProactiveDefense(state);
      if (extra) return { card: "defense", lane: extra.lane, cell: extra.cell };
    }

    return null;
  }

  /**
   * Planned bot placements for the current right-place phase.
   * Deterministic, own-half only (cannon may target the player's half).
   */
  function planAiPlays(state) {
    var s = clone(state);
    var plays = [];
    if (s.phase !== "right-place" || s.winner) return plays;
    for (var n = 0; n < 8; n++) {
      var play = chooseNextAiPlay(s);
      if (!play) break;
      var r = playCard(s, "right", play.card, play.lane, play.cell);
      if (!r.ok) break;
      s = r.state;
      plays.push({ card: play.card, lane: play.lane, cell: play.cell });
    }
    return plays;
  }

  function applyAiPlacement(state) {
    var s = clone(state);
    var plays = [];
    var events = [];
    if (s.phase !== "right-place" || s.winner) {
      return { state: s, plays: plays, events: events };
    }
    var planned = planAiPlays(s);
    for (var i = 0; i < planned.length; i++) {
      var play = planned[i];
      var r = playCard(s, "right", play.card, play.lane, play.cell);
      if (!r.ok) break;
      s = r.state;
      plays.push(play);
      for (var j = 0; j < r.events.length; j++) events.push(r.events[j]);
    }
    return { state: s, plays: plays, events: events };
  }

  /**
   * Player-vs-bot advance: finish the human (left) placement, let the bot
   * deploy on the right, then mark the turn ready to resolve.
   */
  function playerAdvance(state) {
    var s = clone(state);
    if (s.phase !== "left-place" || s.winner) {
      return { ok: false, state: s, shouldResolve: false, plays: [], events: [] };
    }
    var a = endPlacement(s);
    s = a.state;
    var ai = applyAiPlacement(s);
    s = ai.state;
    var b = endPlacement(s);
    s = b.state;
    return {
      ok: true,
      state: s,
      shouldResolve: b.shouldResolve,
      plays: ai.plays,
      events: ai.events,
    };
  }

  return {
    LANES: LANES,
    HUMAN: "left",
    AI: "right",
    CELLS: CELLS,
    MID_LEFT: MID_LEFT,
    MID_RIGHT: MID_RIGHT,
    SHIP_HP: SHIP_HP,
    GOLD_START: GOLD_START,
    GOLD_INCOME: GOLD_INCOME,
    GOLD_CAP: GOLD_CAP,
    CARD_TYPES: CARD_TYPES,
    CARDS: CARDS,
    COUNTER: COUNTER,
    createState: createState,
    clone: clone,
    other: other,
    dirOf: dirOf,
    ownHalfCells: ownHalfCells,
    isOwnHalf: isOwnHalf,
    isEnemyHalf: isEnemyHalf,
    effectiveDamage: effectiveDamage,
    isEffective: isEffective,
    unitAt: unitAt,
    trapAt: trapAt,
    legalRangedShotCells: legalRangedShotCells,
    canRangedHit: canRangedHit,
    legalCells: legalCells,
    canPlay: canPlay,
    canAfford: canAfford,
    onCooldown: onCooldown,
    playCard: playCard,
    endPlacement: endPlacement,
    resolveTurn: resolveTurn,
    planAiPlays: planAiPlays,
    applyAiPlacement: applyAiPlacement,
    playerAdvance: playerAdvance,
    midEdge: midEdge,
  };
});
