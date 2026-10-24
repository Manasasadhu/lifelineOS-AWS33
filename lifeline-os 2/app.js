(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  var gauges = $$(".gauge").map(function (el) {
    var secs = parseInt(el.getAttribute("data-secs"), 10), total = parseInt(el.getAttribute("data-total"), 10) || secs;
    el.innerHTML = '<svg viewBox="0 0 58 58"><circle class="gtrack" cx="29" cy="29" r="' + R + '" fill="none" stroke-width="5"/><circle class="gprog" cx="29" cy="29" r="' + R + '" fill="none" stroke-width="5" stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg><div class="gt"></div>';
    return { prog: el.querySelector(".gprog"), txt: el.querySelector(".gt"), secs: secs, total: total };
  });
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
  var simRun = false;
  $("#simBtn").addEventListener("click", function () {
    if (simRun) return; simRun = true; var btn = this; btn.setAttribute("disabled", "");
    $("#app").classList.add("shake"); setTimeout(function () { $("#app").classList.remove("shake"); }, 520);
    $("#flash").classList.remove("on"); void $("#flash").offsetWidth; $("#flash").classList.add("on");
    if (window.__quake) window.__quake();
    beep(140, .5, "sawtooth", .06); setTimeout(function () { beep(110, .4, "sawtooth", .05); }, 160);
    var steps = [
      ["crit", "EVENT 01 · Power Outage", "Pharmacy A refrigeration now failing — survival clock engaged"],
      ["warn", "EVENT 02 · Spoilage Risk", "Food Bank B: 243 meals at risk → Shelter C transfer proposed"],
      ["", "EVENT 03 · Citizen Request", "“Grandmother needs insulin, power out” — Bedrock parsed as Critical"],
      ["warn", "EVENT 04 · Road Closed", "7th St blocked — Volunteer #04 rerouted, +2 min ETA"],
      ["good", "AUTOPILOT", "Highest-impact intervention queued — awaiting operator approval"]
    ];
    steps.forEach(function (s, i) { setTimeout(function () { toast(s[0], s[1], s[2]);
      if (i === 0) { var c = $("#tCrit"); c.textContent = parseInt(c.textContent, 10) + 1; }
      if (i === steps.length - 1) { btn.removeAttribute("disabled"); simRun = false; $("#navBadge").classList.remove("hide"); } }, 1100 * (i + 1)); });
  });

  /* ---------- Approve ---------- */
  function inc(id, n) { var el = $(id); if (!el) return; el.dataset.done = ""; el.setAttribute("data-count", parseInt(el.getAttribute("data-count"), 10) + n); var sc = el.closest(".impact"); if (sc && sc.classList.contains("show")) countTo(el); }
  $("#approveBtn").addEventListener("click", function () {
    $("#action").classList.add("done");
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
  $("#reqBtn").addEventListener("click", function () {
    var txt = ($("#reqText").value || "").toLowerCase(), interp = $("#interp"), src = $("#interpSrc");
    interp.classList.add("load"); src.innerHTML = '<span class="thinking">Bedrock analyzing…</span>'; beep(500, .08, "sine", .04);
    setTimeout(function () {
      var need = "General assistance", pri = "Moderate", priC = "var(--warn)", pow = "Unknown", powC = "var(--muted)", ppl = "1", match = "Routing to nearest available resource";
      var m = txt.match(/(\d+)\s*(people|persons|residents|meals|ppl)/);
      if (/insulin|medic|diabet|prescription|refriger/.test(txt)) { need = "Insulin / Medication"; pri = "Critical"; priC = "var(--crit)"; match = "Matched to Community Center D cold storage"; }
      else if (/food|meal|hungry|eat/.test(txt)) { need = "Food Supply"; pri = "High"; priC = "var(--risk)"; match = "Matched to Grocery Store E surplus"; }
      else if (/water|thirst/.test(txt)) { need = "Water"; pri = "High"; priC = "var(--risk)"; }
      else if (/shelter|cold|roof|house/.test(txt)) { need = "Shelter"; pri = "High"; priC = "var(--risk)"; match = "Matched to Shelter C"; }
      if (/power (?:is |went |'s )?(?:out|off|down|gone)|no power|no electric|outage|blackout/.test(txt)) { pow = "No"; powC = "var(--crit)"; } else if (/power|electric/.test(txt)) { pow = "Yes"; powC = "var(--good)"; }
      if (m) ppl = m[1];
      $("#iNeed").textContent = need; $("#iPri").textContent = pri; $("#iPri").style.color = priC; $("#iPpl").textContent = ppl; $("#iPow").textContent = pow; $("#iPow").style.color = powC;
      $("#iOk").textContent = match + " — added to emergency network"; interp.classList.remove("load"); src.textContent = "Amazon Bedrock";
      var r = $("#tReq"); r.textContent = parseInt(r.textContent, 10) + 1; toast("good", "Request parsed by Bedrock", need + " · priority " + pri);
    }, 1200);
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
  var prioData = [
    { rank: 1, cls: "r1", text: "“Grandmother needs insulin, power out” — Downtown", chips: ["Medical · Urgency 5", "1 person", "Fails in 42m", "1.2 mi"], score: 94, rat: "Medical-critical with a 42-min failure window — handled first." },
    { rank: 2, cls: "r2", text: "“Shelter has 40 people, food until tonight” — East Side", chips: ["Food · Urgency 3", "40 people", "Fails in 5h", "2.0 mi"], score: 71, rat: "Larger group, but a 5-hour window — queued second." }
  ];
  var prioBtn = $("#prioBtn");
  if (prioBtn) prioBtn.addEventListener("click", function () {
    var q = $("#prioq"); if (!q) return; q.innerHTML = "";
    prioData.forEach(function (d, i) {
      setTimeout(function () {
        var r = document.createElement("div"); r.className = "prow " + d.cls;
        r.innerHTML = '<div class="rank">#' + d.rank + '</div><div class="pbody"><div class="ptext"></div><div class="pchips">' + d.chips.map(function () { return "<span></span>"; }).join("") + '</div><div class="prat"></div></div><div class="pscore">' + d.score + '<small>score</small></div>';
        r.querySelector(".ptext").textContent = d.text; r.querySelector(".prat").textContent = d.rat;
        var cs = r.querySelectorAll(".pchips span"); d.chips.forEach(function (c, k) { cs[k].textContent = c; });
        q.appendChild(r);
      }, i * 450);
    });
    toast("", "2 requests received simultaneously", "Priority engine ranking by urgency × people × time-to-failure");
    beep(520, .08, "sine", .04);
  });

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

  var rSubmit = $("#rSubmit");
  if (rSubmit) rSubmit.addEventListener("click", function () {
    var txt = ($("#rText").value || "").toLowerCase();
    var need = "General assistance", urg = "Moderate", urgC = "", pow = "Unknown", powC = "", ppl = "1", dest = "the nearest open resource", dist = "";
    var m = txt.match(/(\d+)\s*(people|persons|residents|meals|ppl)/);
    if (/insulin|medic|diabet|prescription|refriger/.test(txt)) { need = "Insulin / Medication"; urg = "Critical"; urgC = "crit"; dest = "Community Center D"; dist = "1.2 mi"; }
    else if (/food|meal|hungry|eat/.test(txt)) { need = "Food"; urg = "High"; urgC = "crit"; dest = "Grocery Store E"; dist = "0.9 mi"; }
    else if (/water|thirst/.test(txt)) { need = "Water"; urg = "High"; urgC = "crit"; dest = "Shelter C"; dist = "2.0 mi"; }
    else if (/shelter|cold|roof|house/.test(txt)) { need = "Shelter"; urg = "High"; urgC = "crit"; dest = "Shelter C"; dist = "2.0 mi"; }
    if (/power (?:is |went |'s )?(?:out|off|down|gone)|no power|no electric|outage|blackout/.test(txt)) { pow = "Unavailable"; powC = "crit"; } else if (/power|electric/.test(txt)) { pow = "Available"; powC = ""; }
    if (m) ppl = m[1];
    $("#rNeed").textContent = need; $("#rUrg").textContent = urg; $("#rUrg").className = urgC;
    $("#rPpl").textContent = ppl; $("#rPow").textContent = pow; $("#rPow").className = powC;
    $("#rMatch").textContent = "Matched to " + dest + (dist ? " · " + dist : "");
    $("#rStatus").hidden = false; beep(600, .1, "sine", .05);
    try { $("#rStatus").scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
  });
})();
