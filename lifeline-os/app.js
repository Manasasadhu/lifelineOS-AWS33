(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================= API LAYER ================= *
   * Connects the UI to the Lifeline backend. If the backend is unreachable,
   * the UI silently keeps its built-in mock behavior (graceful degradation).
   * Override the base URL with ?api=http://host:port in the address bar. */
  var API_BASE = (function () {
    try {
      var q = new URLSearchParams(location.search).get("api");
      if (q) return q.replace(/\/$/, "");
      // Local dev convenience: use localhost when served from localhost.
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        return "http://localhost:3001";
      }
    } catch (e) {}
    // Default for hosted builds: the deployed AWS API.
    return "https://1ojsa0r13d.execute-api.us-west-2.amazonaws.com";
  })();
  var API = { live: false, lastState: null };

  function apiFetch(path, opts) {
    return fetch(API_BASE + path, Object.assign({
      headers: { "content-type": "application/json" },
    }, opts || {})).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + path);
      return r.json();
    });
  }

  function setApiStatus(live) {
    API.live = live;
    var el = document.getElementById("apiDot");
    if (!el) return;
    el.className = "apiDot " + (live ? "on" : "off");
    el.title = live ? "Backend connected · " + API_BASE : "Backend offline · using local mock";
  }
  /* ============================================= */

  /* ---------- Theme ---------- */
  var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  function effTheme() { var t = document.documentElement.getAttribute("data-theme"); if (t) return t; return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; }
  var PAL = { line: "#41B9F4", dot: "#3a7bbf", a: .22 };
  function setPalette() { var d = effTheme() === "dark"; PAL.line = d ? "#41B9F4" : "#7FB4E4"; PAL.dot = d ? "#3a7bbf" : "#9fc3e8"; PAL.a = d ? .22 : .16; }
  function updThemeIcon() { $("#thIco").innerHTML = effTheme() === "dark" ? SUN : MOON; }
  function setTheme(mode) {
    if (mode) document.documentElement.setAttribute("data-theme", mode); else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("lifeline-theme", mode || "system"); } catch (e) {}
    updThemeIcon(); setPalette();
  }
  (function initTheme() { var m = null; try { m = localStorage.getItem("lifeline-theme"); } catch (e) {} if (m === "light" || m === "dark") setTheme(m); else { updThemeIcon(); setPalette(); } })();
  $("#themeBtn").addEventListener("click", function () { setTheme(effTheme() === "dark" ? "light" : "dark"); });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (!document.documentElement.getAttribute("data-theme")) { updThemeIcon(); setPalette(); } });

  /* ---------- Boot ---------- */
  var bstats = ["Linking 46 resource nodes…", "Amazon Bedrock online", "Survival clocks engaged", "Command center ready"], bi = 0;
  var bint = setInterval(function () { bi = (bi + 1) % bstats.length; var el = $("#bstat"); if (el) el.textContent = bstats[bi]; }, 420);
  function endBoot() { clearInterval(bint); var b = $("#boot"); if (b) { b.classList.add("gone"); setTimeout(function () { b.remove(); }, 650); } }
  $("#boot").addEventListener("click", endBoot); setTimeout(endBoot, reduce ? 200 : 1850);

  /* ---------- Particle field ---------- */
  (function () {
    var c = $("#field"), x = c.getContext("2d"), W, H, pts = [];
    function size() { W = c.width = innerWidth; H = c.height = innerHeight; }
    size(); window.addEventListener("resize", size);
    var N = reduce ? 0 : Math.min(70, Math.floor(innerWidth / 24));
    for (var i = 0; i < N; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25 });
    function draw() {
      x.clearRect(0, 0, W, H);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
        for (var j = i + 1; j < pts.length; j++) { var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
          if (d < 15000) { x.globalAlpha = (1 - d / 15000) * PAL.a; x.strokeStyle = PAL.line; x.lineWidth = 1; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); } }
        x.globalAlpha = .55; x.fillStyle = PAL.dot; x.beginPath(); x.arc(p.x, p.y, 1.3, 0, 7); x.fill();
      }
      x.globalAlpha = 1; requestAnimationFrame(draw);
    }
    if (N > 0) draw();
  })();

  /* ---------- Sound ---------- */
  var ac = null, muted = false;
  function actx() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } } return ac; }
  function beep(freq, dur, type, vol) { if (muted) return; var a = actx(); if (!a) return;
    try { var o = a.createOscillator(), g = a.createGain(); o.type = type || "sine"; o.frequency.value = freq; g.gain.value = vol || .05; o.connect(g); g.connect(a.destination);
      var t = a.currentTime; o.start(t); g.gain.exponentialRampToValueAtTime(.0001, t + (dur || .12)); o.stop(t + (dur || .12) + .02); } catch (e) {} }
  function chord(fs) { fs.forEach(function (f, i) { setTimeout(function () { beep(f, .22, "triangle", .06); }, i * 70); }); }
  $("#soundBtn").addEventListener("click", function () {
    muted = !muted;
    $("#sndIco").innerHTML = muted ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>' : '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>';
    if (!muted) beep(660, .1, "sine", .05);
  });

  /* ---------- Nav ---------- */
  var TITLES = { overview: "Community Resilience Command Center", network: "Community Resource Network", requests: "Emergency Request Intake", actions: "Autopilot Action Queue", impact: "Simulation Impact Report" };
  var navBtns = $$("#nav button");
  function moveGlider(btn) { var g = $("#glider"); if (g) g.style.transform = "translateY(" + btn.offsetTop + "px)"; }
  function go(id) {
    var btn = navBtns.filter(function (b) { return b.getAttribute("data-nav") === id; })[0];
    navBtns.forEach(function (x) { x.classList.toggle("active", x === btn); }); moveGlider(btn);
    $$(".screen").forEach(function (s) { var on = s.getAttribute("data-screen") === id; s.hidden = !on; if (on) { s.classList.remove("enter"); void s.offsetWidth; s.classList.add("enter"); } });
    $("#scrTitle").textContent = TITLES[id];
    if (id === "impact") showImpact();
    beep(520, .07, "sine", .04);
  }
  navBtns.forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-nav")); }); });
  setTimeout(function () { moveGlider(navBtns[0]); }, 60);
  window.addEventListener("resize", function () { var a = $("#nav button.active"); if (a) moveGlider(a); });

  /* ---------- Count-up ---------- */
  function countTo(el) { if (el.dataset.done) return; el.dataset.done = "1";
    var to = parseInt(el.getAttribute("data-count"), 10), suf = el.getAttribute("data-suffix") || "", t0 = performance.now(), dur = 1100;
    function step(t) { var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e).toLocaleString() + suf; if (k < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  function countAll(root) { $$("[data-count]", root).forEach(countTo); }
  countAll($("[data-screen='overview']"));

  /* ---------- Impact graphics ---------- */
  var DR = 72, DC = 2 * Math.PI * DR, dprog = $("#dprog"); if (dprog) { dprog.setAttribute("stroke-dasharray", DC); dprog.style.strokeDashoffset = DC; }
  function showImpact() {
    var imp = $(".impact"); imp.classList.add("show"); countAll(imp);
    if (dprog) { dprog.style.strokeDashoffset = (DC * (1 - .91)).toFixed(1);
      var n = $("#donutN"), t0 = performance.now(); (function s(t) { var k = Math.min(1, (t - t0) / 1100); n.textContent = Math.round(91 * k) + "%"; if (k < 1) requestAnimationFrame(s); })(performance.now()); }
  }

  /* ---------- Sparklines ---------- */
  $$(".spark").forEach(function (cv) {
    var g = cv.getContext("2d"), w = cv.width = 116, h = cv.height = 44, seed = cv.getAttribute("data-spark").charCodeAt(0);
    var grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, "rgba(65,185,244,.2)"); grd.addColorStop(1, "#41B9F4");
    g.strokeStyle = grd; g.lineWidth = 2; g.beginPath();
    for (var i = 0; i <= 20; i++) { var y = h / 2 + Math.sin(i * .6 + seed) * (h / 3) * (.5 + Math.random() * .5); if (i === 0) g.moveTo(0, y); else g.lineTo(i / 20 * w, y); }
    g.stroke();
  });

  /* ---------- Clocks ---------- */
  function fmt(s) { if (s < 0) s = 0; var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = function (n) { return (n < 10 ? "0" : "") + n; }; return p(h) + ":" + p(m) + ":" + p(x); }
  function colorFor(s) { return s < 3600 ? "var(--crit)" : s < 10800 ? "var(--risk)" : s < 21600 ? "var(--warn)" : "var(--good)"; }
  var R = 24, C = 2 * Math.PI * R;
  var gauges = [];
  function buildGauges() {
    gauges = $$(".gauge").map(function (el) {
      var secs = parseInt(el.getAttribute("data-secs"), 10), total = parseInt(el.getAttribute("data-total"), 10) || secs;
      if (!el.querySelector("svg")) el.innerHTML = '<svg viewBox="0 0 58 58"><circle class="gtrack" cx="29" cy="29" r="' + R + '" fill="none" stroke-width="5"/><circle class="gprog" cx="29" cy="29" r="' + R + '" fill="none" stroke-width="5" stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg><div class="gt"></div>';
      return { prog: el.querySelector(".gprog"), txt: el.querySelector(".gt"), secs: secs, total: total };
    });
  }
  buildGauges();
  var BR = 74, BC = 2 * Math.PI * BR;
  $$(".bp").forEach(function (b) { b.setAttribute("stroke-dasharray", BC); });
  var simpleClocks = $$(".clock").filter(function (c) { return !c.closest(".gauge"); }).map(function (el) {
    var box = el.closest(".bigring");
    return { el: el, secs: parseInt(el.getAttribute("data-secs"), 10) || 0, total: parseInt(el.getAttribute("data-total"), 10) || parseInt(el.getAttribute("data-secs"), 10) || 1, ring: box ? box.querySelector(".bp") : null };
  });
  function tick() {
    gauges.forEach(function (g) { if (g.secs > 0) g.secs--; g.txt.textContent = Math.floor(g.secs / 60) + "m"; g.prog.style.strokeDashoffset = (C * (1 - g.secs / g.total)).toFixed(1); });
    simpleClocks.forEach(function (c) { if (c.secs > 0) c.secs--; c.el.textContent = fmt(c.secs); c.el.style.color = colorFor(c.secs); if (c.ring) c.ring.style.strokeDashoffset = (BC * (1 - c.secs / c.total)).toFixed(1); });
  }
  tick(); setInterval(tick, 1000);

  var mc = 3600 + 47 * 60 + 23; setInterval(function () { mc++; $("#missionClock").textContent = fmt(mc); }, 1000);

  var ticks = ["46 nodes monitored", "Volunteer #04 en route", "Bedrock latency 240ms", "6 districts online", "Cold storage reserve 62%", "3 critical alerts"];
  var row = ticks.map(function (t) { return "<span>● <b>" + t + "</b></span>"; }).join(""); $("#tickTrack").innerHTML = row + row;
  var _upd = 4; setInterval(function () { _upd++; $$("[data-updated]").forEach(function (e) { e.textContent = "Updated " + _upd + "s ago"; }); }, 1000);

  /* ---------- Map tooltip ---------- */
  var tip = $("#maptip"), wrap = $("#mapWrap");
  $$(".node").forEach(function (n) {
    function show() { tip.innerHTML = '<div class="mn">' + n.getAttribute("data-name") + '</div><div class="md">' + n.getAttribute("data-info") + ' · <b>' + n.getAttribute("data-time") + '</b></div>'; tip.classList.add("on");
      var r = wrap.getBoundingClientRect(), b = n.getBoundingClientRect(), lx = b.left - r.left + b.width / 2, ly = b.top - r.top;
      tip.style.left = Math.max(6, Math.min(lx - tip.offsetWidth / 2, r.width - tip.offsetWidth - 6)) + "px"; tip.style.top = Math.max(6, ly - tip.offsetHeight - 8) + "px"; }
    n.addEventListener("mouseenter", show); n.addEventListener("focus", show);
    n.addEventListener("mouseleave", function () { tip.classList.remove("on"); }); n.addEventListener("blur", function () { tip.classList.remove("on"); });
    n.addEventListener("click", function () { $$(".node").forEach(function (m) { m.classList.toggle("sel", m === n); }); beep(600, .06, "sine", .04); });
  });

  /* ---------- Toasts ---------- */
  function toast(kind, title, sub) {
    var t = document.createElement("div"); t.className = "toast " + (kind || ""); t.innerHTML = '<div class="tt"></div><div class="ts"></div>';
    t.querySelector(".tt").textContent = title; t.querySelector(".ts").textContent = sub || ""; $("#toasts").appendChild(t);
    beep(kind === "crit" ? 320 : kind === "good" ? 720 : 480, .08, "sine", .035);
    setTimeout(function () { t.style.transition = "opacity .4s, transform .4s"; t.style.opacity = "0"; t.style.transform = "translateX(18px)"; setTimeout(function () { t.remove(); }, 420); }, 5200);
  }

  /* ---------- Seismograph ---------- */
  (function () {
    var cv = $("#seismo"), g = cv.getContext("2d"), w = cv.width, h = cv.height, data = [], spike = 0;
    for (var i = 0; i < w; i++) data.push(h / 2);
    window.__quake = function () { spike = 60; };
    function draw() { data.shift(); var amp = 2 + spike * .5; spike *= .92; if (spike < .5) spike = 0; data.push(h / 2 + (Math.random() - .5) * amp);
      g.clearRect(0, 0, w, h); g.strokeStyle = spike > 2 ? (getComputedStyle(document.documentElement).getPropertyValue("--crit") || "#FF4D64") : PAL.line; g.lineWidth = 1.6; g.globalAlpha = .9; g.beginPath();
      for (var i = 0; i < data.length; i++) { if (i === 0) g.moveTo(i, data[i]); else g.lineTo(i, data[i]); } g.stroke(); requestAnimationFrame(draw); }
    if (!reduce) draw(); else { g.strokeStyle = PAL.line; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); }
  })();

  /* ---------- Burst ---------- */
  function burst() {
    var cv = $("#burst"), g = cv.getContext("2d"); cv.width = innerWidth; cv.height = innerHeight;
    var cx = innerWidth / 2, cy = innerHeight / 2, parts = [], cols = ["#2FD98A", "#41B9F4", "#F5CB45", "#7C6CF5", "#FF6B82"];
    for (var i = 0; i < 80; i++) { var a = Math.random() * 7, sp = 2 + Math.random() * 6; parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, c: cols[i % 5], life: 1 }); }
    var t0 = performance.now();
    function frame(t) { var dt = t - t0; g.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.vy += .12; p.life -= .016; if (p.life > 0) { g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, 3, 0, 7); g.fill(); } });
      if (dt < 1400) requestAnimationFrame(frame); else g.clearRect(0, 0, cv.width, cv.height); }
    if (!reduce) requestAnimationFrame(frame);
  }

  /* ---------- Simulate ---------- */
  /* Toast scripts mirror the engine timelines in src/engine/scenario.ts and scenarios.ts. */
  var SCENARIOS = {
    earthquake: {
      title: "EARTHQUAKE RESPONSE ACTIVE", ctx: "7.0 Earthquake Response",
      sub: "M7.0 earthquake — downtown San José",
      steps: [
        ["crit", "EVENT 01 · Power Outage", "Pharmacy A refrigeration now failing — survival clock engaged"],
        ["warn", "EVENT 02 · Spoilage Risk", "Food Bank B cooler failed: 243 meals at risk · Shelter C +25 evacuees"],
        ["", "EVENT 03 · Citizen Request", "“Grandmother needs insulin, no electricity” — parsed as Critical"],
        ["warn", "EVENT 04 · Road Closed", "Debris on E San Carlos St — affected trips rerouted"]
      ]
    },
    wildfire: {
      title: "WILDFIRE RESPONSE ACTIVE", ctx: "Wildfire · AQI 285 · Evacuations",
      sub: "Wildfire in the east foothills — AQI 285, evacuations under way",
      steps: [
        ["crit", "EVENT 01 · Safety Power Shutoff", "Pharmacy A cut from the grid — insulin cold storage failing"],
        ["warn", "EVENT 02 · Evacuees Arriving", "Shelter C +60 evacuees — meals and water running low"],
        ["", "EVENT 03 · Citizen Request", "“Evacuated with two kids, no food” — parsed as Critical"],
        ["warn", "EVENT 04 · Road Closed", "Fire engines staging on W San Carlos St — resupply rerouted"]
      ]
    },
    flood: {
      title: "FLOOD RESPONSE ACTIVE", ctx: "Guadalupe River Flooding",
      sub: "Guadalupe River flooding — 4.2 in of rain in 6 hours",
      steps: [
        ["crit", "EVENT 01 · River Overflow", "W San Carlos St crossing closed · Grocery E loses power and 350 bottles of water"],
        ["warn", "EVENT 02 · Cooler Failure", "Floodwater shorts Food Bank B's compressor — 243 meals at risk"],
        ["", "EVENT 03 · Citizen Request", "“Two kids and elderly mother need drinking water” — parsed as Critical"],
        ["warn", "EVENT 04 · Road Closed", "Flooded underpass on Almaden Blvd — deliveries rerouted"]
      ]
    },
    heatwave: {
      title: "HEATWAVE RESPONSE ACTIVE", ctx: "Extreme Heat · 112 °F",
      sub: "Extreme heat — 112 °F with rolling blackouts",
      steps: [
        ["crit", "EVENT 01 · Rolling Blackout", "Pharmacy A loses power — insulin cold storage failing"],
        ["warn", "EVENT 02 · Compressor Overheat", "Food Bank B cooler down: 243 meals at risk · Shelter C opens as cooling centre"],
        ["", "EVENT 03 · Citizen Request", "“Elderly neighbor, no AC, dizzy, needs water” — parsed as Critical"],
        ["warn", "EVENT 04 · Road Closed", "Buckled pavement on E San Fernando St — trips rerouted"]
      ]
    },
    grid_failure: {
      title: "GRID BLACKOUT RESPONSE ACTIVE", ctx: "Regional Grid Failure",
      sub: "Regional grid failure — substation fire, 92% of customers without power",
      steps: [
        ["crit", "EVENT 01 · Grid Down", "All 5 sites lose power — only generator sites keep cooling"],
        ["warn", "EVENT 02 · Shelter Surge", "Shelter C +40 residents leaving dark homes — meals running low"],
        ["", "EVENT 03 · Citizen Request", "“Elderly dad freezing, needs blankets” — parsed and matched"],
        ["warn", "EVENT 04 · Road Closed", "Traffic signals out at E Santa Clara St & 7th St — trips rerouted"]
      ]
    }
  };
  function selectedScenario() { var s = $("#simScenario"); return s && SCENARIOS[s.value] ? s.value : "earthquake"; }
  function showIncident(title, sub, ctx) {
    if ($("#incidentTitle")) $("#incidentTitle").textContent = title;
    if (sub && $("#incidentSub")) $("#incidentSub").textContent = sub;
    if (ctx && $("#scrCtx")) $("#scrCtx").textContent = "San José · Simulation Day 01 · " + ctx;
  }

  var CRISIS_QUEUE = '<div class="qitem sev crit"><div class="qt"><div class="n">Insulin · Pharmacy A</div><div class="d">Refrigeration failing — 25 doses</div></div><div class="gauge" data-secs="2598" data-total="3600"></div></div>'
    + '<div class="qitem sev risk"><div class="qt"><div class="n">Food Bank B</div><div class="d">243 meals at spoilage risk</div></div><div class="gauge" data-secs="5040" data-total="7200"></div></div>'
    + '<div class="qitem sev risk"><div class="qt"><div class="n">Water Depot G</div><div class="d">1,200 residents on supply</div></div><div class="gauge" data-secs="8100" data-total="12000"></div></div>'
    + '<div class="qitem sev warn"><div class="qt"><div class="n">Shelter C Food Supply</div><div class="d">Serving 40 residents</div></div><div class="gauge" data-secs="18000" data-total="21600"></div></div>';
  var crisisOn = false;
  function enterCrisis() {
    if (crisisOn) return; crisisOn = true;
    $("#app").classList.add("crisis");
    $$("#app [data-crisis]").forEach(function (el) { el.dataset.done = ""; el.setAttribute("data-count", el.getAttribute("data-crisis")); countTo(el); });
    var q = $("#queue"); if (q) { q.innerHTML = CRISIS_QUEUE; buildGauges(); }
  }
  var simRun = false;
  $("#simBtn").addEventListener("click", function () {
    if (simRun) return; simRun = true; var btn = this; btn.setAttribute("disabled", "");
    var sc = SCENARIOS[selectedScenario()];
    showIncident(sc.title, sc.sub, sc.ctx);
    $("#app").classList.add("shake"); setTimeout(function () { $("#app").classList.remove("shake"); }, 520);
    $("#flash").classList.remove("on"); void $("#flash").offsetWidth; $("#flash").classList.add("on");
    enterCrisis();
    if (window.__quake) window.__quake();
    beep(140, .5, "sawtooth", .06); setTimeout(function () { beep(110, .4, "sawtooth", .05); }, 160);
    var steps = sc.steps.concat([["good", "AUTOPILOT", "Highest-impact intervention queued — awaiting operator approval"]]);
    steps.forEach(function (s, i) { setTimeout(function () { toast(s[0], s[1], s[2]);
      if (i === steps.length - 1) { btn.removeAttribute("disabled"); simRun = false; $("#navBadge").classList.remove("hide"); } }, 950 * (i + 1)); });
  });

  /* ---------- Approve ---------- */
  function inc(id, n) { var el = $(id); if (!el) return; el.dataset.done = ""; el.setAttribute("data-count", parseInt(el.getAttribute("data-count"), 10) + n); var sc = el.closest(".impact"); if (sc && sc.classList.contains("show")) countTo(el); }
  $("#approveBtn").addEventListener("click", function () {
    $("#action").classList.add("done");
    $("#app").classList.add("pharma-ok");
    inc("#mDoses", 25); inc("#mPeople", 1); inc("#mReq", 1);
    addLog("Insulin transfer · Pharmacy A → Community Center D", "25 doses protected · Volunteer #04");
    burst(); chord([523, 659, 784]); toast("good", "Action Dispatched", "Volunteer #04 en route · 25 doses protected");
    setTimeout(function () { var f = $("#action2"); if (f) { f.hidden = false; try { f.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {} } $("#navBadge").classList.remove("hide"); toast("warn", "New Intervention Queued", "Food Bank B: 243 meals at risk — review recommended"); }, 1400);
  });
  var a2 = $("#approve2Btn");
  if (a2) a2.addEventListener("click", function () {
    $("#action2").classList.add("done"); $("#navBadge").classList.add("hide");
    inc("#mPeople", 40); inc("#mReq", 1);
    addLog("Food redistribution · Food Bank B → Shelter C", "243 meals rescued · 40 residents fed · Volunteer #07");
    burst(); chord([523, 659, 784]); toast("good", "Meals Redistributed", "243 meals en route to Shelter C · 40 residents fed");
  });
  $$(".abtn.alt").forEach(function (b) { b.addEventListener("click", function () { toast("", "Searching alternatives", "Scanning nearby nodes…"); }); });
  $$(".abtn.decline").forEach(function (b) { b.addEventListener("click", function () { toast("warn", "Action declined", "Escalated to human coordinator"); }); });

  /* ---------- Request parse ---------- */
  var NEED_LABEL = { insulin: "Insulin / Medication", medication: "Insulin / Medication", meals: "Food Supply", food: "Food Supply", water: "Water", power: "Power / Electricity", transport: "Transportation", unknown: "General assistance" };
  var PRI_LABEL = { critical: "Critical", high: "High", medium: "Moderate", low: "Low" };
  var PRI_COLOR = { critical: "var(--crit)", high: "var(--risk)", medium: "var(--warn)", low: "var(--good)" };

  /* Render the interpretation panel from a backend `parsed` object. */
  function renderParsed(parsed, matchedAction, outcome) {
    var interp = $("#interp");
    var need = NEED_LABEL[(parsed.need || "unknown").toLowerCase()] || parsed.need;
    var pri = PRI_LABEL[parsed.urgency] || parsed.urgency;
    var priC = PRI_COLOR[parsed.urgency] || "var(--warn)";
    var pow = parsed.powerAvailable === false ? "No" : parsed.powerAvailable === true ? "Yes" : "Unknown";
    var powC = parsed.powerAvailable === false ? "var(--crit)" : parsed.powerAvailable === true ? "var(--good)" : "var(--muted)";
    $("#iNeed").textContent = need;
    $("#iPri").textContent = pri; $("#iPri").style.color = priC;
    $("#iPpl").textContent = parsed.people != null ? parsed.people : 1;
    $("#iPow").textContent = pow; $("#iPow").style.color = powC;
    if ($("#iLoc")) $("#iLoc").textContent = parsed.location || "—";
    var matchMsg = outcome && outcome.message ? outcome.message
      : matchedAction
        ? "Matched → " + matchedAction.toFacilityId + " · " + matchedAction.item + " ×" + matchedAction.quantity
        : "Request added to emergency network";
    $("#iOk").textContent = matchMsg;
    interp.classList.remove("load");
    // Honestly reflect whether Bedrock or the rules parser produced this.
    $("#interpSrc").textContent = parsed.source === "bedrock" ? "Amazon Bedrock" : "Local rules parser";
    toast(parsed.urgency === "critical" ? "crit" : "good",
      parsed.source === "bedrock" ? "Parsed by Amazon Bedrock" : "Parsed by local rules",
      need + " · priority " + pri);
  }

  /* Mock fallback used only when the backend is offline. */
  function mockParse(txt) {
    var lower = txt.toLowerCase();
    var out = { need: "unknown", urgency: "medium", people: 1, powerAvailable: null, location: "Downtown San José", source: "rules" };
    var m = lower.match(/(\d+)\s*(people|persons|residents|meals|ppl)/);
    if (/insulin|medic|diabet|prescription|refriger/.test(lower)) { out.need = "insulin"; out.urgency = "critical"; }
    else if (/food|meal|hungry|eat/.test(lower)) { out.need = "meals"; out.urgency = "high"; }
    else if (/water|thirst/.test(lower)) { out.need = "water"; out.urgency = "high"; }
    if (/power (?:is |went |'s )?(?:out|off|down|gone)|no power|no electric|outage|blackout/.test(lower)) out.powerAvailable = false;
    else if (/power|electric/.test(lower)) out.powerAvailable = true;
    if (m) out.people = parseInt(m[1], 10);
    return out;
  }

  /* What happened to a submitted request: matched to an action, waiting for a volunteer, or not understood. */
  function requestOutcome(st, requestId) {
    if (!requestId) {
      return { kind: "unknown", message: "Couldn't tell what's needed — mention insulin, medication, water, food or blankets" };
    }
    var action = (st.actions || []).find(function (a) {
      return a.toFacilityId === requestId && (a.status === "pending" || a.status === "approved");
    });
    if (action) {
      var driver = action.driverId ? facilityNameOf(st, action.driverId) : "a volunteer";
      return { kind: "matched", action: action, message: "Matched → " + driver + " brings " + action.quantity + " " + action.item + " from " + facilityNameOf(st, action.fromFacilityId) + " · ETA " + action.etaMinutes + " min" };
    }
    var req = (st.requests || []).find(function (r) { return r.id === requestId; });
    var why = (req && req.waitingReason) || "waiting for a free volunteer";
    return { kind: "waiting", message: /^Declined/.test(why) ? why : "Queued — " + why };
  }

  $("#reqBtn").addEventListener("click", function () {
    var txt = $("#reqText").value || "";
    var interp = $("#interp");
    interp.classList.add("load");
    $("#interpSrc").innerHTML = '<span class="thinking">Analyzing…</span>';
    beep(500, .08, "sine", .04);

    if (!API.live) {
      // Backend offline → keep the original mock behavior, same 1.2s feel.
      setTimeout(function () { renderParsed(mockParse(txt)); }, 1200);
      return;
    }

    apiFetch("/requests", { method: "POST", body: JSON.stringify({ text: txt }) })
      .then(function (res) {
        var st = res.state;
        if (res.requestId || res.parsed.need === "unknown") {
          var outcome = requestOutcome(st, res.requestId);
          renderParsed(res.parsed, outcome.action, outcome);
          if (outcome.kind === "waiting") toast("warn", "Request queued", outcome.message);
          else if (outcome.kind === "matched") toast("good", "Volunteer matched", outcome.message);
        } else {
          var matched = (st.actions || []).slice(-1)[0];
          // Only treat the newest action as "matched" if it references this request.
          var isMatch = matched && /citizen request/i.test(matched.reason || "");
          renderParsed(res.parsed, isMatch ? matched : null);
        }
        renderState(st); // refresh tiles / queue / network from new state
      })
      .catch(function (err) {
        interp.classList.remove("load");
        toast("crit", "Request failed", err.message);
      });
  });

  /* ---------- Cloud / Edge ---------- */
  var edge = false;
  $("#connBtn").addEventListener("click", function () {
    edge = !edge; $("#app").classList.toggle("edge", edge);
    if (edge) { $("#connState").textContent = "Edge Mode"; $("#connSub").textContent = "Local rules active · cloud AI paused"; $("#pillTxt").textContent = "Edge Mode"; $("#connBtn").textContent = "Restore Connection"; $("#interpSrc").textContent = "Local cache";
      beep(240, .3, "sawtooth", .05); toast("warn", "Internet connection lost", "Lifeline running on cached resource database"); }
    else { $("#connState").textContent = "Cloud Online"; $("#connSub").textContent = "Bedrock · all services live"; $("#pillTxt").textContent = "Cloud Online"; $("#connBtn").textContent = "Disconnect Cloud"; $("#interpSrc").textContent = "Amazon Bedrock"; $("#syncTxt").textContent = "Synchronizing 7 events…";
      chord([440, 587]); toast("", "Reconnecting to cloud", "Syncing locally-stored events…"); setTimeout(function () { toast("good", "Synchronization complete", "7 offline events merged to network"); }, 1800); }
  });

  /* ================= LIVE RENDER (backend-driven) ================= *
   * Approach A: render whatever /state returns. Clocks/tiles/queue/table
   * are overwritten from real data when the backend is reachable. */

  var SEV_LABEL = { critical: "Critical", at_risk: "At Risk", warning: "Limited", healthy: "Stable" };
  var SEV_CLASS = { critical: "crit", at_risk: "risk", warning: "warn", healthy: "good" };

  function fmtClock(s) { if (s == null) return "—"; if (s < 0) s = 0; var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? h + "h " + m + "m" : m + "m"; }

  function setTile(sel, val) { var el = $(sel); if (!el) return; el.dataset.done = ""; el.setAttribute("data-count", val); el.textContent = Number(val).toLocaleString(); }

  function renderTiles(st) {
    var m = st.metrics || {};
    setTile(".tile.t-people .v", m.peopleAffected != null ? m.peopleAffected : 0);
    setTile("#tReq", m.requestsActive != null ? m.requestsActive : 0);
    setTile(".tile.t-res .v", m.resourcesAvailable != null ? m.resourcesAvailable : 0);
    setTile("#tCrit", m.criticalAlerts != null ? m.criticalAlerts : 0);
  }

  function renderQueue(st) {
    var q = $("#queue"); if (!q) return;
    var items = (st.priorityQueue || []);
    if (!items.length) { q.innerHTML = '<div class="qitem"><div class="qt"><div class="n">All clear</div><div class="d">No active survival clocks</div></div></div>'; return; }
    q.innerHTML = items.map(function (a) {
      var cls = SEV_CLASS[a.severity] || "warn";
      var secs = a.remainingSeconds != null ? a.remainingSeconds : 0;
      var total = Math.max(secs, 3600);
      return '<div class="qitem sev ' + cls + '"><div class="qt"><div class="n">' + a.title + '</div><div class="d">' + (a.subtitle || "") + '</div></div><div class="gauge" data-secs="' + secs + '" data-total="' + total + '"></div></div>';
    }).join("");
    initGauges(q);
  }

  var VOL_BADGE = {
    available: { label: "Available", c: "var(--accent)" },
    assigned: { label: "Assigned", c: "var(--warn)" },
    busy: { label: "Busy · En route", c: "var(--crit)" }
  };

  function renderNetwork(st) {
    var tb = $("table.net:not(.hist) tbody"); if (!tb) return;
    tb.innerHTML = (st.facilities || []).map(function (f) {
      var isVol = f.type === "volunteer";
      var cls = SEV_CLASS[f.status] || "good";
      var resource = f.inventory && f.inventory.length ? (Math.round(f.inventory[0].quantity) + " " + f.inventory[0].unit) : (isVol ? (f.notes || "Vehicle") : (f.notes || "—"));
      var power = isVol ? "—" : (f.power ? "Grid" : "Battery");
      var secs = f.failureAt ? Math.max(0, Math.round((Date.parse(f.failureAt) - Date.now()) / 1000)) : (f.refrigerationHoursRemaining != null ? Math.round(f.refrigerationHoursRemaining * 3600) : null);
      // For a busy volunteer failureAt is their arrival time.
      var time = isVol ? (f.volunteerStatus === "busy" && f.failureAt ? "arrives " + fmtClock(secs) : "—") : fmtClock(secs);
      var vb = VOL_BADGE[f.volunteerStatus || (f.available === false ? "busy" : "available")];
      var badge = isVol
        ? '<span class="badge" style="--c:' + vb.c + ';--cb:color-mix(in srgb,' + vb.c + ' 14%,transparent)"><span class="bd"></span>' + vb.label + '</span>'
        : '<span class="badge sev ' + cls + '"><span class="bd"></span>' + (SEV_LABEL[f.status] || "Stable") + '</span>';
      var name = esc(f.name) + (isVol && f.task ? '<span class="vtask">' + esc(f.task) + '</span>' : "");
      return '<tr><td>' + name + '</td><td>' + badge + '</td><td>' + esc(resource) + '</td><td>' + power + '</td><td class="tleft">' + time + '</td></tr>';
    }).join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  /* Top-right stamp on an action card: when the resident asked, or when Lifeline proposed it. */
  function stampHtml(a) {
    var at = a.requestedAt || a.createdAt;
    if (!at) return "";
    return '<span class="astamp" title="' + esc(new Date(at).toString()) + '">' + (a.requestedAt ? "Requested " : "Proposed ") + esc(fmtWhen(at)) + '</span>';
  }

  var HIST_COLOR = { "Approved": "var(--good)", "Completed": "var(--accent)", "Declined": "var(--crit)", "Alternative requested": "var(--warn)" };

  /* Action History table (Name · Action taken · Volunteer · Date) from /state.history. */
  function renderHistory(st) {
    var wrap = $("#historyWrap"), tb = $("#historyBody"), log = $("#logBody");
    if (!wrap || !tb) return;
    wrap.hidden = false;
    if (log) log.hidden = true;
    var rows = st.history || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center">No actions taken yet. Approve or decline a proposal to see it here.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (h) {
      var c = HIST_COLOR[h.decision] || "var(--muted)";
      var when = new Date(h.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return '<tr title="' + esc(h.detail) + '"><td>' + esc(h.name) + '</td>' +
        '<td><span class="badge" style="--c:' + c + ';--cb:color-mix(in srgb,' + c + ' 14%,transparent)"><span class="bd"></span>' + esc(h.decision) + '</span></td>' +
        '<td>' + esc(h.volunteer || "—") + '</td><td class="tleft">' + esc(when) + '</td></tr>';
    }).join("");
  }

  /* rebuild gauge rings for any .gauge inside root that has no svg yet */
  function initGauges(root) {
    var R = 24, C = 2 * Math.PI * R;
    $$(".gauge", root).forEach(function (el) {
      if (el.querySelector("svg")) return;
      var secs = parseInt(el.getAttribute("data-secs"), 10) || 0, total = parseInt(el.getAttribute("data-total"), 10) || secs || 1;
      el.innerHTML = '<svg viewBox="0 0 58 58"><circle class="gtrack" cx="29" cy="29" r="' + R + '" fill="none" stroke-width="5"/><circle class="gprog" cx="29" cy="29" r="' + R + '" fill="none" stroke-width="5" stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg><div class="gt"></div>';
      el._live = { prog: el.querySelector(".gprog"), txt: el.querySelector(".gt"), secs: secs, total: total, C: C };
      el._live.txt.textContent = Math.floor(secs / 60) + "m";
    });
  }

  /* tick the live gauges created above */
  setInterval(function () {
    $$(".gauge").forEach(function (el) {
      if (!el._live) return;
      var g = el._live;
      if (g.secs > 0) g.secs--;
      g.txt.textContent = Math.floor(g.secs / 60) + "m";
      g.prog.style.strokeDashoffset = (g.C * (1 - g.secs / g.total)).toFixed(1);
    });
  }, 1000);

  var ACT_SEV_CLASS = { critical: "crit", at_risk: "risk", warning: "warn" };
  var ACT_SEV_LABEL = { critical: "Critical Action", at_risk: "At-Risk Action", warning: "Action" };

  function facilityNameOf(st, id) {
    var f = (st.facilities || []).find(function (x) { return x.id === id; });
    if (f) return f.name;
    var r = (st.requests || []).find(function (x) { return x.id === id; });
    return r ? "Resident · " + r.location : id;
  }

  /* Render the Actions screen from real backend actions, binding real IDs. */
  function renderActions(st) {
    var wrap = $(".actionwrap"); if (!wrap) return;
    renderHistory(st);
    // Only proposals awaiting a decision; approved / declined / completed ones move to Action History.
    var actions = (st.actions || []).filter(function (a) { return a.status === "pending"; });

    var badge = $("#navBadge");
    if (badge) {
      if (actions.length > 0) { badge.textContent = actions.length; badge.classList.remove("hide"); }
      else badge.classList.add("hide");
    }

    // Open requests with no proposal yet (e.g. every volunteer is busy) — show them so they aren't invisible.
    var proposedFor = {};
    actions.forEach(function (a) { proposedFor[a.toFacilityId] = true; });
    var waiting = (st.requests || []).filter(function (r) { return r.status === "open" && !proposedFor[r.id]; });

    var sig = actions.map(function (a) { return a.id; }).concat(waiting.map(function (r) { return r.id + ":" + (r.waitingReason || ""); })).join("|");
    if (sig === renderActions.sig && wrap.querySelector("[data-live]")) return;
    renderActions.sig = sig;

    var waitingHtml = waiting.length ? '<div class="panel waitlist" data-live>' +
      '<div class="head"><h3>Waiting Requests</h3><div class="meta">' + waiting.length + ' not yet matched</div></div>' +
      waiting.slice().reverse().map(function (r) {
        var urg = r.urgency === "critical" || r.urgency === "high" ? "crit" : "warn";
        return '<div class="wrow"><span class="badge sev ' + urg + '"><span class="bd"></span>' + esc(r.urgency) + '</span>' +
          '<div class="wdet"><div class="wt">\u201c' + esc(r.rawText) + '\u201d</div>' +
          '<div class="wm">' + esc(r.id) + ' · ' + esc(r.need) + ' · ' + esc(r.people) + ' people · ' + esc(r.location) + ' · ' + esc(fmtWhen(r.createdAt)) + '</div>' +
          '<div class="wr">' + esc(r.waitingReason || "Looking for a volunteer") + '</div></div></div>';
      }).join("") + '</div>' : "";

    if (!actions.length) {
      wrap.innerHTML = waitingHtml + '<div class="action" data-live><div class="body" style="padding:28px;text-align:center;color:var(--muted)">No proposals waiting for approval.' +
        (waiting.length ? " The requests above get a proposal as soon as a volunteer is free (see the Network tab)." : " Past decisions are in Action History.") + '</div></div>';
      return;
    }

    wrap.innerHTML = waitingHtml + actions.map(function (a) {
      var cls = ACT_SEV_CLASS[a.severity] || "warn";
      var done = a.status !== "pending";
      var fromName = facilityNameOf(st, a.fromFacilityId);
      var toName = facilityNameOf(st, a.toFacilityId);
      var driver = a.driverId ? facilityNameOf(st, a.driverId) : "unassigned";
      var cold = a.coldStorageHoursRemaining != null ? Math.round(a.coldStorageHoursRemaining) + " hrs" : "\u2014";
      return '' +
        '<div class="action' + (done ? " done" : "") + '" data-live data-action-id="' + a.id + '">' +
          '<div class="ah"><svg class="bolt" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--' + cls + ')" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span class="lab">' + (ACT_SEV_LABEL[a.severity] || "Action") + " \u00b7 " + a.item + '</span>' + stampHtml(a) + '</div>' +
          '<div class="body">' +
            '<div class="rec">' +
              '<div class="rl"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg> Lifeline Recommendation</div>' +
              '<div class="move">' + a.title + " \u2014 move " + Math.round(a.quantity) + " " + a.item + '</div>' +
              '<div class="flow"><span class="node2">' + fromName + '</span><span class="arr">\u2192</span><span class="node2">' + toName + '</span></div>' +
              '<div class="specs"><div class="sp"><span class="spk">Driver</span><span class="spv">' + driver + '</span></div><div class="sp"><span class="spk">Distance</span><span class="spv">' + (Math.round(a.distanceMiles * 10) / 10) + ' mi</span></div><div class="sp"><span class="spk">ETA</span><span class="spv">' + a.etaMinutes + ' min</span></div><div class="sp"><span class="spk">Cold storage</span><span class="spv">' + cold + '</span></div></div>' +
            '</div>' +
            '<div class="whybox"><div class="wh">Why this action?</div><ul class="why"><li>' + (a.reason || "") + '</li><li>Estimated impact: ' + a.estimatedImpact + '</li></ul><div class="trustrow"><span class="vf">\u2713 Verified resources</span><span class="vf">\u2713 Human approval required</span></div></div>' +
            '<div class="impactline"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg> Estimated impact: ' + a.estimatedImpact + '</div>' +
            (done ? "" : '<div class="abtns"><button class="abtn approve" data-op="approve">Approve Action</button><button class="abtn alt" data-op="alternative">Find Alternative</button><button class="abtn decline" data-op="decline">Decline</button></div>') +
          '</div>' +
          '<div class="approved-state"><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg><div class="big2">Action ' + (a.status === "completed" ? "Completed" : "Approved & Dispatched") + '</div><div class="sm">' + a.estimatedImpact + '</div></div>' +
        '</div>';
    }).join("");
  }

  var URG_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  var REQ_STATUS = { open: ["Waiting", "warn"], matched: ["Volunteer assigned", "good"], resolved: ["Resolved", "good"] };

  /* Requests tab: every live request, most urgent first, with where it stands. */
  function renderRequestList(st) {
    var q = $("#prioq"); if (!q) return;
    var reqs = (st.requests || []).slice().sort(function (a, b) {
      return (URG_RANK[a.urgency] - URG_RANK[b.urgency]) || (a.id < b.id ? 1 : -1);
    });
    if (!reqs.length) { q.innerHTML = '<div class="prioEmpty">No requests yet. Submit one above or from the Resident view.</div>'; return; }
    var pending = {};
    (st.actions || []).forEach(function (a) { if (a.status === "pending") pending[a.toFacilityId] = true; });
    q.innerHTML = reqs.map(function (r, i) {
      var s = r.status === "open" && pending[r.id] ? ["Awaiting approval", "warn"] : (REQ_STATUS[r.status] || REQ_STATUS.open);
      var note = r.status === "open" && !pending[r.id] ? (r.waitingReason || "Looking for a volunteer") : "";
      return '<div class="prow ' + (i === 0 ? "r1" : "r2") + '"><div class="rank">#' + (i + 1) + '</div><div class="pbody">' +
        '<div class="ptext">\u201c' + esc(r.rawText) + '\u201d</div>' +
        '<div class="pchips"><span>' + esc(r.need) + ' · ' + esc(r.urgency) + '</span><span>' + esc(r.people) + ' people</span><span>' + esc(r.id) + '</span><span>' + esc(fmtWhen(r.createdAt)) + '</span></div>' +
        (note ? '<div class="prat">' + esc(note) + '</div>' : "") + '</div>' +
        '<span class="badge sev ' + s[1] + '"><span class="bd"></span>' + s[0] + '</span></div>';
    }).join("");
  }

  function renderState(st) {
    if (!st) return;
    API.lastState = st;
    if (API.live) renderRequestList(st);
    if (st.incident && st.incident.active) showIncident(st.incident.label, st.incident.description);
    renderTiles(st);
    renderQueue(st);
    renderNetwork(st);
    if (API.live) renderActions(st);
  }

  /* Delegated handler: Approve / Decline / Alternative on dynamic cards. */
  (function wireActionButtons() {
    var wrap = $(".actionwrap"); if (!wrap) return;
    wrap.addEventListener("click", function (e) {
      if (!API.live) return; // offline -> original mock handlers win
      var btn = e.target.closest ? e.target.closest(".abtn[data-op]") : null;
      if (!btn) return;
      var card = btn.closest("[data-action-id]");
      if (!card) return;
      var id = card.getAttribute("data-action-id");
      var op = btn.getAttribute("data-op");
      $$(".abtn", card).forEach(function (b) { b.setAttribute("disabled", ""); });
      var before = API.lastState;
      var act = before && (before.actions || []).find(function (a) { return a.id === id; });
      apiFetch("/actions/" + encodeURIComponent(id) + "/" + op, { method: "POST" })
        .then(function (st) {
          renderState(st);
          var driver = act && act.driverId ? facilityNameOf(before, act.driverId) : "Volunteer";
          if (op === "approve") {
            burst(); chord([523, 659, 784]);
            toast("good", "Action approved & dispatched", driver + " is now busy · see Action History");
          }
          else if (op === "decline") toast("warn", "Action declined", "Request removed from the queue and logged in Action History");
          else {
            var next = (st.actions || []).filter(function (a) { return a.status === "pending"; }).length;
            toast("", "Alternative requested", next ? "Next-best option proposed" : "No other option available right now");
          }
        })
        .catch(function (err) {
          $$(".abtn", card).forEach(function (b) { b.removeAttribute("disabled"); });
          toast("crit", "Action failed", err.message);
        });
    });
  })();

  function loadState() {
    return apiFetch("/state").then(function (st) {
      setApiStatus(true);
      renderState(st);
      return st;
    }).catch(function (err) {
      console.warn("[lifeline] backend unreachable, keeping mock UI:", err.message);
      setApiStatus(false);
    });
  }

  /* On boot: try to attach to the backend, then poll so volunteer status,
   * trip completions and the history table update without a reload. */
  loadState();
  setInterval(function () { if (API.live && !document.hidden) loadState(); }, 5000);

  /* Make the Simulate button call the real endpoint (in addition to the
   * existing cosmetic shake/flash/toast flourish already bound above). */
  (function wireSimulate() {
    var btn = $("#simBtn"); if (!btn) return;
    btn.addEventListener("click", function () {
      if (!API.live) return; // backend offline → leave mock flow alone
      apiFetch("/simulate", { method: "POST", body: JSON.stringify({ scenario: selectedScenario() }) }).then(function (st) {
        renderState(st);
        toast("good", "Backend simulation applied", (st.actions ? st.actions.length : 0) + " interventions generated");
      }).catch(function (err) {
        toast("crit", "Simulate failed", err.message);
      });
    });
  })();
  /* ================================================================ */
  /* ---------- Approval log + prioritization ---------- */
  function addLog(title, meta) {
    var body = $("#logBody"); if (!body) return;
    var empty = body.querySelector(".logEmpty"); if (empty) empty.remove();
    var t = $("#missionClock") ? $("#missionClock").textContent : "";
    var row = document.createElement("div"); row.className = "logrow";
    row.innerHTML = '<span class="lchk">✓</span><div class="ldet"><div class="lt"></div><div class="lm"></div></div><div class="ltime"></div>';
    row.querySelector(".lt").textContent = title; row.querySelector(".lm").textContent = meta; row.querySelector(".ltime").textContent = t;
    body.insertBefore(row, body.firstChild);
  }
  /* ---------- Role select + resident view ---------- */
  function showRole(role) {
    $("#entry").hidden = true;
    $("#app").hidden = role !== "coordinator";
    $("#resident").hidden = role !== "resident";
    if (role === "coordinator") { var a = $("#nav button.active"); if (a) setTimeout(function () { moveGlider(a); }, 30); }
  }
  function toEntry() { $("#entry").hidden = false; $("#app").hidden = true; $("#resident").hidden = true; }
  $$("#entry .ecard").forEach(function (c) { c.addEventListener("click", function () { showRole(c.getAttribute("data-role")); beep(560, .09, "sine", .045); }); });
  var sw = $("#switchBtn"); if (sw) sw.addEventListener("click", toEntry);
  $$("[data-switch]").forEach(function (b) { b.addEventListener("click", toEntry); });
  $$("[data-goto]").forEach(function (b) {
    b.addEventListener("click", function () { showRole(b.getAttribute("data-goto")); window.scrollTo(0, 0); beep(560, .09, "sine", .045); });
  });

  var rSubmit = $("#rSubmit");
  function showResidentStatus(need, urg, urgC, ppl, pow, powC, matchText) {
    $("#rNeed").textContent = need; $("#rUrg").textContent = urg; $("#rUrg").className = urgC;
    $("#rPpl").textContent = ppl; $("#rPow").textContent = pow; $("#rPow").className = powC;
    $("#rMatch").textContent = matchText;
    $("#rStatus").hidden = false; beep(600, .1, "sine", .05);
    try { $("#rStatus").scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
  }
  function submitResidentLive(text) {
    apiFetch("/requests", { method: "POST", body: JSON.stringify({ text: text }) }).then(function (res) {
      var p = res.parsed, outcome = requestOutcome(res.state, res.requestId);
      showResidentStatus(
        NEED_LABEL[(p.need || "unknown").toLowerCase()] || p.need,
        PRI_LABEL[p.urgency] || p.urgency,
        p.urgency === "critical" || p.urgency === "high" ? "crit" : "",
        String(p.people != null ? p.people : 1),
        p.powerAvailable === false ? "Unavailable" : p.powerAvailable === true ? "Available" : "Unknown",
        p.powerAvailable === false ? "crit" : "",
        outcome.message);
      renderState(res.state);
    }).catch(function (err) { toast("crit", "Request failed", err.message); });
  }

  if (rSubmit) rSubmit.addEventListener("click", function () {
    if (API.live) { submitResidentLive($("#rText").value || ""); return; }
    var txt = ($("#rText").value || "").toLowerCase();
    var need = "General assistance", urg = "Moderate", urgC = "", pow = "Unknown", powC = "", ppl = "1", dest = "the nearest open resource", dist = "";
    var m = txt.match(/(\d+)\s*(people|persons|residents|meals|ppl)/);
    if (/insulin|medic|diabet|prescription|refriger/.test(txt)) { need = "Insulin / Medication"; urg = "Critical"; urgC = "crit"; dest = "Community Center D"; dist = "1.2 mi"; }
    else if (/food|meal|hungry|eat/.test(txt)) { need = "Food"; urg = "High"; urgC = "crit"; dest = "Grocery Store E"; dist = "0.9 mi"; }
    else if (/water|thirst/.test(txt)) { need = "Water"; urg = "High"; urgC = "crit"; dest = "Shelter C"; dist = "2.0 mi"; }
    else if (/shelter|cold|roof|house/.test(txt)) { need = "Shelter"; urg = "High"; urgC = "crit"; dest = "Shelter C"; dist = "2.0 mi"; }
    if (/power (?:is |went |'s )?(?:out|off|down|gone)|no power|no electric|outage|blackout/.test(txt)) { pow = "Unavailable"; powC = "crit"; } else if (/power|electric/.test(txt)) { pow = "Available"; powC = ""; }
    if (m) ppl = m[1];
    showResidentStatus(need, urg, urgC, ppl, pow, powC, "Matched to " + dest + (dist ? " · " + dist : ""));
  });
})();
