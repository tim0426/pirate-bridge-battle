/* global p5, PirateRules */
(function () {
  "use strict";

  var R = PirateRules;
  var SPRITE_DIRS = {
    melee: { folder: "assets/melee", count: 6 },
    defense: { folder: "assets/defense", count: 6 },
    "ranged-walk": { folder: "assets/ranged-walk", count: 6 },
    "ranged-shoot": { folder: "assets/ranged-shoot", count: 6 },
    cannon: { folder: "assets/cannon", count: 4 },
    trap: { folder: "assets/trap", count: 5 },
  };

  var sprites = {};
  var shipLeft, shipRight;
  var state;
  var display; // visual state; lags behind during resolve animations
  var selectedCard = null;
  var inspectUnitId = null;
  var anim = null;
  var floats = [];
  var flashes = [];
  var cnv;
  var lastPointer = 0;
  var tick = 0;
  var currentPlayer = "left";

  function preload() {
    Object.keys(SPRITE_DIRS).forEach(function (key) {
      var spec = SPRITE_DIRS[key];
      sprites[key] = [];
      for (var i = 0; i < spec.count; i++) {
        var n = i < 10 ? "0" + i : String(i);
        sprites[key][i] = loadImage(spec.folder + "/frame_" + n + ".png");
      }
    });
    shipLeft = loadImage("assets/ships/left.png");
    shipRight = loadImage("assets/ships/right.png");
  }

  function setup() {
    var host = document.getElementById("board");
    cnv = createCanvas(Math.max(100, host.clientWidth), Math.max(100, host.clientHeight));
    cnv.parent(host);
    cnv.elt.addEventListener(
      "pointerup",
      function (ev) {
        ev.preventDefault();
        onBoardPointer(ev);
      },
      { passive: false }
    );
    disablePixelSmoothing();
    buildCards();
    bindDom();
    // Don't start the match until START is pressed.
  }

  function disablePixelSmoothing() {
    drawingContext.imageSmoothingEnabled = false;
    if (drawingContext.imageSmoothingEnabled !== undefined) {
      drawingContext.mozImageSmoothingEnabled = false;
      drawingContext.webkitImageSmoothingEnabled = false;
      drawingContext.msImageSmoothingEnabled = false;
    }
  }

  function windowResized() {
    var host = document.getElementById("board");
    if (!host) return;
    resizeCanvas(Math.max(100, host.clientWidth), Math.max(100, host.clientHeight));
    disablePixelSmoothing();
  }

  function startMatch() {
    state = R.createState();
    display = R.clone(state);
    selectedCard = null;
    inspectUnitId = null;
    anim = null;
    floats = [];
    flashes = [];
    currentPlayer = "left";
    document.getElementById("overlay-start").classList.remove("show");
    document.getElementById("overlay-end").classList.remove("show");
    windowResized();
    syncDom();
  }

  function bindDom() {
    document.getElementById("start-btn").addEventListener("click", startMatch);
    document.getElementById("again-btn").addEventListener("click", startMatch);
    document.getElementById("advance-btn").addEventListener("click", onAdvance);
    document.getElementById("cards").addEventListener("click", function (ev) {
      var card = ev.target.closest(".card");
      if (!card) return;
      onCardTap(card.getAttribute("data-card"));
    });
  }

  function buildCards() {
    var host = document.getElementById("cards");
    host.innerHTML = "";
    R.CARD_TYPES.forEach(function (id) {
      var def = R.CARDS[id];
      var el = document.createElement("button");
      el.type = "button";
      el.className = "card";
      el.setAttribute("data-card", id);
      var imgSrc =
        id === "ranged"
          ? "assets/ranged-walk/frame_00.png"
          : id === "trap"
          ? "assets/trap/frame_03.png"
          : id === "cannon"
          ? "assets/cannon/frame_00.png"
          : "assets/" + id + "/frame_00.png";
      el.innerHTML =
        '<span class="cost">' +
        def.cost +
        "</span>" +
        '<span class="cd" hidden>CD 1</span>' +
        '<img alt="" src="' +
        imgSrc +
        '" />' +
        '<div class="name">' +
        def.label +
        "</div>" +
        '<div class="sub">' +
        def.sub +
        "</div>";
      host.appendChild(el);
    });
  }

  function activePlayer() {
    // PvE: the human always plays the left side.
    return "left";
  }

  function onCardTap(id) {
    if (!state || anim || state.winner) return;
    if (state.phase !== "left-place") return;
    var p = activePlayer();
    if (!R.canPlay(state, p, id) && selectedCard !== id) return;
    if (selectedCard === id) {
      selectedCard = null;
    } else {
      selectedCard = id;
      inspectUnitId = null;
    }
    syncDom();
  }

  function onAdvance() {
    if (!state || anim || state.winner) return;
    if (state.phase !== "left-place") return;
    selectedCard = null;
    inspectUnitId = null;
    currentPlayer = "left";
    var result = R.playerAdvance(state);
    if (!result.ok) return;
    state = result.state;
    display = R.clone(state);
    (result.events || []).forEach(function (ev) {
      if (ev.type === "cannon") playCannonFx(ev, "right");
    });
    if (result.shouldResolve) beginResolve(result.plays, result.events);
    else syncDom();
  }

  function beginResolve(aiPlays, aiEvents) {
    var result = R.resolveTurn(state);
    var events = result.events.slice();
    if (aiPlays && aiPlays.length) {
      events.unshift({ type: "phase", name: "deploy" });
    }
    anim = {
      events: events,
      final: result.state,
      pre: R.clone(display),
      i: 0,
      wait: 0,
      move: null,
      shot: null,
      trap: null,
      cannonFx: null,
      attack: null,
      ship: null,
    };
    // Apply income only at the end; we replay events onto `display` starting from pre.
    display = R.clone(anim.pre);
    display.phase = "resolve";
    syncDom();
    stepAnim(true);
  }

  function findDisp(id) {
    for (var i = 0; i < display.units.length; i++) {
      if (display.units[i].id === id) return display.units[i];
    }
    return null;
  }

  function stepAnim(immediate) {
    if (!anim) return;
    if (anim.wait > 0 && !immediate) return;
    if (anim.i >= anim.events.length) {
      finishResolve();
      return;
    }
    var ev = anim.events[anim.i++];
    if (ev.type === "phase") {
      if (ev.name === "income" && anim.final) {
        display.gold = R.clone(anim.final.gold);
        display.cooldown = R.clone(anim.final.cooldown);
        display.turn = anim.final.turn;
        display.hp = R.clone(anim.final.hp);
      }
      anim.wait = ev.name === "income" ? 6 : 18;
      syncDom();
      return;
    }
    if (ev.type === "shot") {
      anim.shot = { ev: ev, t: 0, dur: 28 };
      anim.wait = 28;
      return;
    }
    if (ev.type === "attack") {
      anim.attack = { ev: ev, t: 0, dur: 20 };
      anim.wait = 20;
      applyDamageEvent(ev, ev.attackerId);
      return;
    }
    if (ev.type === "move") {
      anim.move = { ev: ev, t: 0, dur: 22 };
      anim.wait = 22;
      return;
    }
    if (ev.type === "trap") {
      anim.trap = { ev: ev, t: 0, dur: 24 };
      anim.wait = 24;
      var victim = findDisp(ev.unitId);
      if (victim) {
        victim.hp -= ev.damage;
        spawnFloat(ev.lane, ev.cell, "-" + ev.damage, "#ff6b5a");
        if (ev.killed) removeDispUnit(ev.unitId);
      }
      display.traps = display.traps.filter(function (t) {
        return t.id !== ev.trapId;
      });
      return;
    }
    if (ev.type === "ship") {
      anim.ship = { ev: ev, t: 0, dur: 22 };
      anim.wait = 22;
      display.hp[ev.target] = ev.hpLeft;
      spawnFloatShip(ev.target, "-" + ev.damage);
      return;
    }
    if (ev.type === "death") {
      removeDispUnit(ev.unitId);
      anim.wait = 8;
      return;
    }
    if (ev.type === "blocked") {
      anim.wait = 6;
      return;
    }
    anim.wait = 4;
  }

  function applyDamageEvent(ev, _src) {
    var t = findDisp(ev.targetId);
    if (!t) return;
    t.hp -= ev.damage;
    spawnFloat(t.lane, t.cell, "-" + ev.damage + (ev.effective ? "!" : ""), ev.effective ? "#ffe27a" : "#ff6b5a");
    if (ev.effective) spawnFloat(t.lane, t.cell, "EFFECTIVE", "#ffe27a", -18);
    if (ev.killed) removeDispUnit(ev.targetId);
  }

  function removeDispUnit(id) {
    display.units = display.units.filter(function (u) {
      return u.id !== id && u.hp > 0;
    });
  }

  function finishResolve() {
    state = anim.final;
    display = R.clone(state);
    anim = null;
    currentPlayer = "left";
    selectedCard = null;
    inspectUnitId = null;
    syncDom();
    if (state.winner) showGameOver();
  }

  function showGameOver() {
    var title = document.getElementById("end-title");
    var sub = document.getElementById("end-sub");
    if (state.winner === "draw") {
      title.textContent = "Draw!";
      sub.textContent = "Both ships went down.";
    } else if (state.winner === "left") {
      title.textContent = "You win!";
      sub.textContent = "The navy ship is sunk.";
    } else {
      title.textContent = "The navy wins";
      sub.textContent = "Your ship is sunk.";
    }
    document.getElementById("overlay-end").classList.add("show");
  }

  function spawnFloat(lane, cell, text, color, dy) {
    floats.push({
      kind: "cell",
      lane: lane,
      cell: cell,
      text: text,
      color: color || "#fff",
      t: 0,
      life: 40,
      dy: dy || 0,
    });
  }
  function spawnFloatShip(side, text) {
    floats.push({ kind: "ship", side: side, text: text, color: "#ff6b5a", t: 0, life: 40, dy: 0 });
  }

  /* ---------------- layout & input ---------------- */

  function boardLayout() {
    var pad = Math.max(4, width * 0.012);
    var shipW = Math.min(width * 0.2, height * 0.62);
    var gridW = Math.max(120, width - shipW * 2 - pad * 2);
    var cellW = gridW / 12;
    var gap = Math.max(3, cellW * 0.1);
    var cellH = Math.min(cellW * 0.92, (height - pad * 2 - gap * 2) / 3);
    var gridH = cellH * 3 + gap * 2;
    var gridX = (width - gridW) / 2;
    var gridY = (height - gridH) / 2;
    return {
      pad: pad,
      shipW: shipW,
      shipH: Math.min(height - pad * 2, shipW * 1.65),
      gridX: gridX,
      gridY: gridY,
      gridW: gridW,
      gridH: gridH,
      cellW: cellW,
      cellH: cellH,
      gap: gap,
    };
  }

  function cellRect(L, lane, cell) {
    return {
      x: L.gridX + cell * L.cellW,
      y: L.gridY + lane * (L.cellH + L.gap),
      w: L.cellW,
      h: L.cellH,
    };
  }

  function cellCenter(L, lane, cell) {
    var r = cellRect(L, lane, cell);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  function hitCell(L, x, y) {
    for (var lane = 0; lane < 3; lane++) {
      for (var cell = 0; cell < 12; cell++) {
        var r = cellRect(L, lane, cell);
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
          return { lane: lane, cell: cell };
        }
      }
    }
    return null;
  }

  function onBoardPointer(ev) {
    var now = Date.now();
    if (now - lastPointer < 250) return;
    lastPointer = now;
    if (!state || anim || state.winner) return;
    if (state.phase !== "left-place") return;
    var rect = cnv.elt.getBoundingClientRect();
    var x = ((ev.clientX - rect.left) * width) / Math.max(1, rect.width);
    var y = ((ev.clientY - rect.top) * height) / Math.max(1, rect.height);
    var L = boardLayout();
    var hit = hitCell(L, x, y);
    if (!hit) {
      selectedCard = null;
      inspectUnitId = null;
      syncDom();
      return;
    }
    var p = activePlayer();
    if (selectedCard) {
      var res = R.playCard(state, p, selectedCard, hit.lane, hit.cell);
      if (res.ok) {
        state = res.state;
        display = R.clone(state);
        if (selectedCard === "cannon") {
          playCannonFx(res.events[0], p);
        }
        selectedCard = null;
        inspectUnitId = null;
        if (state.winner) showGameOver();
      }
      syncDom();
      return;
    }
    var u = R.unitAt(display, hit.lane, hit.cell);
    if (u && u.type === "ranged") {
      inspectUnitId = inspectUnitId === u.id ? null : u.id;
    } else {
      inspectUnitId = null;
    }
    syncDom();
  }

  function playCannonFx(ev, player) {
    if (!ev) return;
    flashes.push({ kind: "cannon", ev: ev, player: player, t: 0, life: 28 });
    if (ev.damage) {
      spawnFloat(ev.lane, ev.cell, "-" + ev.damage, "#ffb347");
    }
  }

  /* ---------------- drawing ---------------- */

  function draw() {
    tick++;
    disablePixelSmoothing();
    if (anim) {
      anim.wait -= 1;
      advanceAnimVisuals();
      if (anim.wait <= 0) stepAnim(false);
    }
    updateFloats();
    if (!display) {
      background(11, 28, 51);
      return;
    }
    var L = boardLayout();
    drawOcean(L);
    drawShips(L);
    drawGrid(L);
    drawHighlights(L);
    drawTraps(L);
    drawUnits(L);
    drawFx(L);
    drawFloats(L);
  }

  function advanceAnimVisuals() {
    if (!anim) return;
    if (anim.shot) {
      anim.shot.t++;
      if (anim.shot.t === 1) {
        // apply damage at the start of the shot so the HP bar drops with the volley
        applyDamageEvent(anim.shot.ev, anim.shot.ev.shooterId);
      }
      if (anim.shot.t >= anim.shot.dur) anim.shot = null;
    }
    if (anim.attack) {
      anim.attack.t++;
      if (anim.attack.t >= anim.attack.dur) anim.attack = null;
    }
    if (anim.move) {
      anim.move.t++;
      if (anim.move.t >= anim.move.dur) {
        var ev = anim.move.ev;
        var u = findDisp(ev.unitId);
        if (u) u.cell = ev.to;
        anim.move = null;
      }
    }
    if (anim.trap) {
      anim.trap.t++;
      if (anim.trap.t >= anim.trap.dur) anim.trap = null;
    }
    if (anim.ship) {
      anim.ship.t++;
      if (anim.ship.t >= anim.ship.dur) anim.ship = null;
    }
  }

  function updateFloats() {
    floats = floats.filter(function (f) {
      f.t++;
      return f.t < f.life;
    });
    flashes = flashes.filter(function (f) {
      f.t++;
      return f.t < f.life;
    });
  }

  function drawOcean(L) {
    noStroke();
    for (var y = 0; y < height; y++) {
      var t = y / Math.max(1, height);
      var r = lerp(24, 18, t);
      var g = lerp(70, 90, t);
      var b = lerp(140, 175, t);
      stroke(r, g, b);
      line(0, y, width, y);
    }
    noStroke();
    // gentle wave lines
    stroke(255, 255, 255, 28);
    strokeWeight(1);
    noFill();
    for (var i = 0; i < 5; i++) {
      var yy = height * (0.15 + i * 0.18);
      beginShape();
      for (var x = 0; x <= width; x += 8) {
        vertex(x, yy + Math.sin((x + tick * 1.2 + i * 40) * 0.03) * 3);
      }
      endShape();
    }
  }

  function drawShips(L) {
    var y = (height - L.shipH) / 2;
    var bob = Math.sin(tick * 0.05) * 2;
    var flashL = anim && anim.ship && anim.ship.ev.target === "left" && anim.ship.t < 12;
    var flashR = anim && anim.ship && anim.ship.ev.target === "right" && anim.ship.t < 12;
    if (flashL) {
      noStroke();
      fill(255, 80, 60, 70);
      rect(0, 0, L.gridX, height);
    }
    if (flashR) {
      noStroke();
      fill(255, 80, 60, 70);
      rect(L.gridX + L.gridW, 0, width - (L.gridX + L.gridW), height);
    }
    if (shipLeft) {
      imageMode(CORNER);
      image(shipLeft, L.pad * 0.2, y + bob, L.shipW, L.shipH);
    }
    if (shipRight) {
      imageMode(CORNER);
      image(shipRight, width - L.shipW - L.pad * 0.2, y - bob, L.shipW, L.shipH);
    }
  }

  function drawGrid(L) {
    var p = activePlayer();
    for (var lane = 0; lane < 3; lane++) {
      for (var cell = 0; cell < 12; cell++) {
        var r = cellRect(L, lane, cell);
        var own = R.isOwnHalf(p, cell);
        var base = own ? color(92, 74, 42) : color(78, 58, 36);
        fill(base);
        stroke(40, 26, 14);
        strokeWeight(1.5);
        rect(r.x, r.y, r.w, r.h, 2);
        // plank lines
        stroke(60, 40, 22, 80);
        strokeWeight(1);
        line(r.x + 3, r.y + r.h * 0.33, r.x + r.w - 3, r.y + r.h * 0.33);
        line(r.x + 3, r.y + r.h * 0.66, r.x + r.w - 3, r.y + r.h * 0.66);
      }
    }
    // midline
    var midX = L.gridX + 6 * L.cellW;
    stroke(243, 230, 192);
    strokeWeight(Math.max(3, L.cellW * 0.08));
    line(midX, L.gridY - 2, midX, L.gridY + L.gridH + 2);
    // labels
    noStroke();
    fill(230, 240, 255, 180);
    textAlign(CENTER, TOP);
    textSize(Math.max(9, L.cellW * 0.22));
    textStyle(BOLD);
    var labY = L.gridY + L.gridH + 4;
    if (labY + 12 < height) {
      var placing = state && !anim && state.phase === "left-place";
      var leftLab = placing ? "YOUR HALF · place here" : "YOUR HALF";
      var rightLab = "BOT HALF";
      text(leftLab, L.gridX + L.cellW * 3, labY);
      text(rightLab, L.gridX + L.cellW * 9, labY);
    }
  }

  function legalSet() {
    if (!state || !selectedCard) return {};
    if (state.phase !== "left-place") return {};
    var list = R.legalCells(state, activePlayer(), selectedCard);
    var map = {};
    list.forEach(function (c) {
      map[c.lane + "," + c.cell] = true;
    });
    return map;
  }

  function shotCellsToShow() {
    var cells = null;
    var lane = null;
    if (selectedCard === "ranged" && state.phase === "left-place") {
      // Show the whole own-half as the legal shot area while the card is selected.
      cells = R.ownHalfCells(activePlayer());
      return { cells: cells, lane: "all" };
    }
    if (inspectUnitId != null) {
      var u = findDisp(inspectUnitId);
      if (u && u.type === "ranged") {
        return { cells: R.legalRangedShotCells(u.player, u.cell), lane: u.lane, unit: u };
      }
    }
    return null;
  }

  function drawHighlights(L) {
    var legal = legalSet();
    noStroke();
    if (selectedCard && selectedCard !== "cannon") {
      for (var lane = 0; lane < 3; lane++) {
        for (var cell = 0; cell < 12; cell++) {
          if (!legal[lane + "," + cell]) continue;
          var r = cellRect(L, lane, cell);
          fill(90, 170, 60, 110);
          rect(r.x, r.y, r.w, r.h, 2);
        }
      }
    }
    if (selectedCard === "cannon") {
      Object.keys(legal).forEach(function (k) {
        var parts = k.split(",");
        var r = cellRect(L, +parts[0], +parts[1]);
        fill(220, 80, 50, 110);
        rect(r.x, r.y, r.w, r.h, 2);
        stroke(255, 80, 60);
        strokeWeight(2);
        var cx = r.x + r.w / 2,
          cy = r.y + r.h / 2,
          s = Math.min(r.w, r.h) * 0.22;
        line(cx - s, cy - s, cx + s, cy + s);
        line(cx + s, cy - s, cx - s, cy + s);
        noStroke();
      });
    }
    var shots = shotCellsToShow();
    if (shots) {
      var lanes = shots.lane === "all" ? [0, 1, 2] : [shots.lane];
      lanes.forEach(function (ln) {
        shots.cells.forEach(function (cell) {
          var r = cellRect(L, ln, cell);
          fill(240, 196, 76, shots.lane === "all" ? 50 : 120);
          rect(r.x, r.y, r.w, r.h, 2);
        });
      });
    }
  }

  function trapFrameIndex(trap) {
    if (anim && anim.trap && anim.trap.ev.trapId === trap.id) {
      var t = anim.trap.t;
      if (t < 6) return 1;
      if (t < 12) return 2;
      if (t < 20) return 3;
      return 4;
    }
    return 1; // slightly raised, visible when idle
  }

  function drawTraps(L) {
    if (!display.traps) return;
    display.traps.forEach(function (trap) {
      var r = cellRect(L, trap.lane, trap.cell);
      var frames = sprites.trap;
      if (!frames || !frames.length) return;
      var img = frames[trapFrameIndex(trap)];
      var h = r.h * 0.7;
      var w = h * (img.width / Math.max(1, img.height));
      imageMode(CENTER);
      image(img, r.x + r.w / 2, r.y + r.h * 0.72, w, h);
    });
    if (anim && anim.trap) {
      // If the trap was already removed from display, still show the spike burst
      var ev = anim.trap.ev;
      var still = display.traps.some(function (t) {
        return t.id === ev.trapId;
      });
      if (!still) {
        var r = cellRect(L, ev.lane, ev.cell);
        var frames = sprites.trap;
        var fi = trapFrameIndex({ id: ev.trapId });
        var img = frames[fi];
        var h = r.h * 0.85;
        var w = h * (img.width / Math.max(1, img.height));
        imageMode(CENTER);
        image(img, r.x + r.w / 2, r.y + r.h * 0.7, w, h);
      }
    }
  }

  function unitDrawCell(u) {
    if (anim && anim.move && anim.move.ev.unitId === u.id) {
      var ev = anim.move.ev;
      var k = anim.move.t / anim.move.dur;
      k = k * k * (3 - 2 * k);
      return ev.from + (ev.to - ev.from) * k;
    }
    return u.cell;
  }

  function unitSprite(u) {
    var shooting =
      anim &&
      anim.shot &&
      anim.shot.ev.shooterId === u.id;
    var moving = anim && anim.move && anim.move.ev.unitId === u.id;
    if (u.type === "ranged") {
      if (shooting) {
        var fi = Math.min(5, Math.floor((anim.shot.t / anim.shot.dur) * 6));
        return { img: sprites["ranged-shoot"][fi], shoot: true };
      }
      var ridx = moving ? Math.floor(tick / 5) % 6 : Math.floor(tick / 8) % 6;
      return { img: sprites["ranged-walk"][ridx], shoot: false };
    }
    if (u.type === "melee") {
      var idx = moving ? Math.floor(tick / 5) % 6 : Math.floor(tick / 10) % 6;
      return { img: sprites.melee[idx], shoot: false };
    }
    if (u.type === "defense") {
      var didx = moving ? Math.floor(tick / 5) % 6 : Math.floor(tick / 10) % 6;
      return { img: sprites.defense[didx], shoot: false };
    }
    return { img: null, shoot: false };
  }

  function drawUnits(L) {
    if (!display.units) return;
    // Draw back-to-front by lane then cell
    var units = display.units.slice().sort(function (a, b) {
      return a.lane - b.lane || a.cell - b.cell;
    });
    units.forEach(function (u) {
      var cell = unitDrawCell(u);
      var r = cellRect(L, u.lane, Math.floor(cell));
      // interpolate x if mid-move between cells
      var x = L.gridX + (cell + 0.5) * L.cellW;
      var y = r.y + r.h * 0.78;
      var lunge = 0;
      if (anim && anim.attack && anim.attack.ev.attackerId === u.id) {
        var dir = R.dirOf(u.player);
        lunge = Math.sin((anim.attack.t / anim.attack.dur) * Math.PI) * L.cellW * 0.28 * dir;
      }
      var spr = unitSprite(u);
      if (spr.img) {
        var maxH = r.h * (spr.shoot ? 0.85 : 0.95);
        var maxW = r.w * (spr.shoot ? 1.35 : 0.95);
        var scale = Math.min(maxW / spr.img.width, maxH / spr.img.height);
        var dw = spr.img.width * scale;
        var dh = spr.img.height * scale;
        push();
        translate(x + lunge, y);
        if (u.player === "right") scale(-1, 1);
        imageMode(CENTER);
        image(spr.img, 0, -dh * 0.08, dw, dh);
        pop();
      }
      // HP bar
      var bw = r.w * 0.7;
      var bh = Math.max(3, r.h * 0.08);
      var bx = x - bw / 2;
      var by = r.y + 3;
      noStroke();
      fill(20, 10, 10, 180);
      rect(bx, by, bw, bh, 1);
      var pct = Math.max(0, u.hp / u.maxHp);
      fill(u.player === "left" ? color(220, 70, 60) : color(70, 140, 230));
      rect(bx, by, bw * pct, bh, 1);
      if (inspectUnitId === u.id) {
        noFill();
        stroke(240, 196, 76);
        strokeWeight(2);
        rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 3);
      }
    });
  }

  function drawFx(L) {
    // ranged shot line
    if (anim && anim.shot) {
      var ev = anim.shot.ev;
      var a = findDisp(ev.shooterId);
      var from = ev.from;
      var to = ev.to;
      var c1 = cellCenter(L, ev.lane, from);
      var c2 = cellCenter(L, ev.lane, to);
      var k = Math.min(1, anim.shot.t / (anim.shot.dur * 0.6));
      stroke(255, 230, 140);
      strokeWeight(2);
      line(c1.x, c1.y - 6, lerp(c1.x, c2.x, k), lerp(c1.y, c2.y, k) - 6);
      noStroke();
      fill(255, 240, 180);
      ellipse(lerp(c1.x, c2.x, k), lerp(c1.y, c2.y, k) - 6, 6, 6);
    }
    flashes.forEach(function (f) {
      if (f.kind !== "cannon") return;
      var r = cellRect(L, f.ev.lane, f.ev.cell);
      var frames = sprites.cannon;
      var fi = Math.min(3, Math.floor((f.t / f.life) * 4));
      var img = frames[fi];
      var w = r.w * 1.5;
      var h = w * (img.height / Math.max(1, img.width));
      push();
      translate(r.x + r.w / 2, r.y + r.h * 0.7);
      if (f.player === "right") scale(-1, 1);
      imageMode(CENTER);
      image(img, 0, 0, w, h);
      pop();
      // muzzle flash
      if (f.t < 12) {
        noStroke();
        fill(255, 180, 60, 200 - f.t * 10);
        var dir = f.player === "left" ? 1 : -1;
        ellipse(r.x + r.w / 2 + dir * w * 0.35, r.y + r.h * 0.62, 16, 10);
        fill(255, 80, 40, 180);
        ellipse(r.x + r.w / 2 + dir * w * 0.42, r.y + r.h * 0.6, 8, 8);
      }
    });
  }

  function drawFloats(L) {
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    floats.forEach(function (f) {
      var k = f.t / f.life;
      var rise = -22 * k + (f.dy || 0);
      var alpha = k < 0.7 ? 255 : 255 * (1 - (k - 0.7) / 0.3);
      var x, y;
      if (f.kind === "ship") {
        x = f.side === "left" ? L.pad + L.shipW * 0.5 : width - L.pad - L.shipW * 0.5;
        y = height * 0.28 + rise;
      } else {
        var c = cellCenter(L, f.lane, f.cell);
        x = c.x;
        y = c.y - 10 + rise;
      }
      noStroke();
      fill(red(color(f.color)), green(color(f.color)), blue(color(f.color)), alpha);
      textSize(f.text === "EFFECTIVE" ? 11 : 16);
      text(f.text, x, y);
    });
  }

  /* ---------------- HUD ---------------- */

  function syncDom() {
    if (!state) return;
    var hpL = display ? display.hp.left : state.hp.left;
    var hpR = display ? display.hp.right : state.hp.right;
    document.getElementById("hp-left-text").textContent = hpL + "/" + R.SHIP_HP;
    document.getElementById("hp-right-text").textContent = hpR + "/" + R.SHIP_HP;
    document.getElementById("hp-left-bar").style.width = Math.max(0, (100 * hpL) / R.SHIP_HP) + "%";
    document.getElementById("hp-right-bar").style.width = Math.max(0, (100 * hpR) / R.SHIP_HP) + "%";
    var gL = (display || state).gold.left;
    var gR = (display || state).gold.right;
    document.getElementById("gold-left").textContent = gL + "/" + R.GOLD_CAP;
    document.getElementById("gold-right").textContent = gR + "/" + R.GOLD_CAP;
    var p = activePlayer();
    document.getElementById("gold-left").parentElement.classList.toggle("active", !anim && !state.winner && state.phase === "left-place");
    document.getElementById("gold-right").parentElement.classList.remove("active");
    document.getElementById("turn-label").textContent = "TURN " + state.turn;

    var btn = document.getElementById("advance-btn");
    if (anim) {
      btn.disabled = true;
      btn.textContent = "RESOLVING";
      btn.classList.remove("resolve-ready");
    } else if (state.winner) {
      btn.disabled = true;
      btn.textContent = "OVER";
      btn.classList.remove("resolve-ready");
    } else if (state.phase === "left-place") {
      btn.disabled = false;
      btn.textContent = "ADVANCE";
      btn.classList.add("resolve-ready");
    } else {
      btn.disabled = true;
      btn.textContent = "ADVANCE";
      btn.classList.remove("resolve-ready");
    }

    var phase = document.getElementById("phase-line");
    if (anim) {
      var lastPhase = "Resolving…";
      for (var i = 0; i < anim.i; i++) {
        if (anim.events[i].type === "phase") lastPhase = phaseName(anim.events[i].name);
      }
      phase.textContent = lastPhase;
    } else if (state.phase === "left-place") {
      phase.textContent = "Your turn — select a card, then a green cell on your half. Tap ADVANCE when ready.";
    } else if (state.winner) {
      phase.textContent = "Battle over.";
    } else {
      phase.textContent = "";
    }

    var cards = document.querySelectorAll(".card");
    cards.forEach(function (el) {
      var id = el.getAttribute("data-card");
      var can = state && !anim && !state.winner && R.canPlay(state, p, id);
      el.classList.toggle("selected", selectedCard === id);
      el.classList.toggle("disabled", !can && selectedCard !== id);
      var cd = state.cooldown[p][id];
      var badge = el.querySelector(".cd");
      if (cd > 0) {
        badge.hidden = false;
        badge.textContent = "CD " + cd;
      } else {
        badge.hidden = true;
      }
    });
  }

  function phaseName(name) {
    if (name === "deploy") return "The navy deploys!";
    if (name === "traps") return "Traps spring!";
    if (name === "ranged") return "Muskets fire — only up to the midline.";
    if (name === "melee") return "Close combat!";
    if (name === "move") return "Units walk forward.";
    if (name === "ships") return "Ships take fire!";
    if (name === "income") return "Gold +2 (max 12).";
    return "Resolving…";
  }

  // p5 looks up these as globals when not in instance mode.
  window.preload = preload;
  window.setup = setup;
  window.draw = draw;
  window.windowResized = windowResized;
})();
