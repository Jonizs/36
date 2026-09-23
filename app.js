(() => {
  "use strict";

  // ───────── Date helpers (whole days since epoch, UTC — no DST surprises) ─────────
  const DAY_MS = 86400000;
  const toDay = (s) => { const [y, m, d] = String(s).split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };
  const isoOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const todayDay = () => { const d = new Date(); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS); };
  const dateOf = (n) => new Date(n * DAY_MS);
  const fmt = (n, opts) => dateOf(n).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
  const fmtShort = (n) => fmt(n, { day: "numeric", month: "short" });
  const fmtLong = (n) => fmt(n, { weekday: "short", day: "numeric", month: "short" });
  const fmtRange = (a, b) => `${fmtShort(a)} – ${fmtShort(b)}`;

  // ───────── Number helpers ─────────
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
  const fmtNum = (v, d = 0) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtKm = (v) => fmtNum(v, v >= 100 ? 0 : 1);

  function parseTime(t) {
    if (t == null || t === "") return null;
    if (typeof t === "number") return t * 60;
    const parts = String(t).trim().replace(/[.,]/g, ":").split(":").map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return null;
    if (parts.length === 1) return parts[0] * 60;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  function fmtDur(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  const fmtPace = (secPerKm) => (secPerKm ? fmtDur(secPerKm) : "–");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const parseSets = (s) => String(s || "").split(/[,\s+x]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);

  // ───────── Storage (entries logged from this browser) ─────────
  const LS_KEY = "journey36.local";
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const emptyLocal = () => ({ runs: [], pushups: [], weights: [], dels: { runs: [], pushups: [], weights: [] } });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const isDemo = new URLSearchParams(location.search).has("demo");
  let baseConfig = isDemo ? makeDemo() : (window.JOURNEY || {});
  // `local` = changes made in this browser not yet in data.js: added entries + deleted file entries
  let local = isDemo ? emptyLocal() : { ...emptyLocal(), ...store.get(LS_KEY, {}) };
  local.dels = { ...emptyLocal().dels, ...(local.dels || {}) };

  // ───────── Build the model ─────────
  let M; // current model
  function build() {
    const cfg = baseConfig;
    const weeks = Number(cfg.weeks) || 36;
    const start = toDay(cfg.startDate || isoOf(todayDay()));
    const end = start + weeks * 7 - 1;
    const today = todayDay();
    const weekOf = (d) => Math.floor((d - start) / 7);

    const tag = (arr, src, key) => (arr || [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e && e.date && !(src === "file" && local.dels[key].some((d) => same(d, e))))
      .map(({ e, i }) => ({ ...e, src, idx: i, day: toDay(e.date) }));

    let runs = [...tag(cfg.runs, "file", "runs"), ...tag(local.runs, "local", "runs")]
      .map((r) => ({ ...r, km: Number(r.km) || 0, sec: parseTime(r.time) }))
      .filter((r) => r.km > 0)
      .sort((a, b) => a.day - b.day);

    let pushups = [...tag(cfg.pushups, "file", "pushups"), ...tag(local.pushups, "local", "pushups")]
      .map((p) => {
        const sets = Array.isArray(p.sets) ? p.sets.map(Number).filter((n) => n > 0) : parseSets(p.sets);
        return { ...p, sets, reps: Number(p.reps) || sum(sets), knee: p.type === "knee" };
      })
      .filter((p) => p.reps > 0)
      .sort((a, b) => a.day - b.day);

    // weights: one per day, browser entries override the file
    const wmap = new Map();
    for (const w of [...tag(cfg.weights, "file", "weights"), ...tag(local.weights, "local", "weights")]) {
      const kg = Number(w.kg);
      if (kg > 0) wmap.set(w.day, { ...w, kg });
    }
    const weights = [...wmap.values()].sort((a, b) => a.day - b.day);
    weights.forEach((w, i) => {
      const win = weights.slice(0, i + 1).filter((x) => x.day > w.day - 7);
      w.avg7 = sum(win, (x) => x.kg) / win.length;
    });

    // weekly buckets
    const W = Array.from({ length: weeks }, (_, i) => ({
      i, start: start + i * 7, end: start + i * 7 + 6, km: 0, runs: 0, sec: 0, timedKm: 0, reps: 0, knee: 0, pushDays: new Set(), kgs: [],
    }));
    for (const r of runs) {
      const w = W[weekOf(r.day)]; if (!w) continue;
      w.km += r.km; w.runs++; if (r.sec) { w.sec += r.sec; w.timedKm += r.km; }
    }
    for (const p of pushups) { const w = W[weekOf(p.day)]; if (!w) continue; w.reps += p.reps; if (p.knee) w.knee += p.reps; w.pushDays.add(p.day); }
    for (const x of weights) { const w = W[weekOf(x.day)]; if (w) w.kgs.push(x.kg); }

    const status = today < start ? "pre" : today > end ? "done" : "active";
    const curIdx = status === "pre" ? -1 : status === "done" ? weeks : weekOf(today);

    // push-ups per day
    // stats only count what happened inside the journey; the log still shows everything
    const inJourney = (e) => e.day >= start && e.day <= end;
    const allRuns = runs, allPushups = pushups;
    runs = runs.filter(inJourney); pushups = pushups.filter(inJourney);

    const pushByDay = new Map();
    const kneeByDay = new Map();
    for (const p of pushups) {
      pushByDay.set(p.day, (pushByDay.get(p.day) || 0) + p.reps);
      if (p.knee) kneeByDay.set(p.day, (kneeByDay.get(p.day) || 0) + p.reps);
    }

    return { cfg, weeks, start, end, today, status, curIdx, weekOf, runs, pushups, allRuns, allPushups, weights, W, pushByDay, kneeByDay };
  }

  // ───────── Render: hero ─────────
  function renderHero() {
    const { weeks, start, end, today, status, curIdx } = M;
    const $ = (id) => document.getElementById(id);
    document.getElementById("title").textContent = M.cfg.title || `${weeks} Weeks`;
    document.title = M.cfg.title || `${weeks} Weeks`;
    $("hero-of").textContent = `/ ${weeks}`;
    const totalDays = weeks * 7;
    if (status === "pre") {
      $("hero-eyebrow").textContent = "Starts in";
      $("hero-week").textContent = start - today;
      $("hero-of").textContent = start - today === 1 ? "day" : "days";
      $("hero-day").textContent = "0";
      $("hero-left").textContent = totalDays;
      $("hero-pct").textContent = "0%";
    } else if (status === "done") {
      $("hero-eyebrow").textContent = "Journey complete";
      $("hero-week").textContent = weeks;
      $("hero-day").textContent = totalDays;
      $("hero-left").textContent = "0";
      $("hero-pct").textContent = "100%";
    } else {
      const day = today - start + 1;
      $("hero-eyebrow").textContent = "Current week";
      $("hero-week").textContent = curIdx + 1;
      $("hero-day").textContent = day;
      $("hero-left").textContent = end - today;
      $("hero-pct").textContent = `${Math.floor((day / totalDays) * 100)}%`;
    }
    const cw = M.W[clamp(curIdx, 0, weeks - 1)];
    $("hero-dates").innerHTML = status === "active"
      ? `This week: <strong>${fmtRange(cw.start, cw.end)}</strong> · Finish line ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`
      : `${fmt(start, { day: "numeric", month: "short", year: "numeric" })} → ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
    $("weeks-bar").style.gridTemplateColumns = `repeat(${weeks}, 1fr)`;
    $("weeks-bar").innerHTML = M.W.map((w) => `<i class="${w.i < curIdx ? "done" : w.i === curIdx ? "now" : ""}"></i>`).join("");
  }

  // ───────── Render: KPIs ─────────
  function renderKpis() {
    const { runs, pushups, weights, W, curIdx, pushByDay, today } = M;
    const totalKm = sum(runs, (r) => r.km);
    const timed = runs.filter((r) => r.sec);
    const avgPace = timed.length ? sum(timed, (r) => r.sec) / sum(timed, (r) => r.km) : null;
    const totalReps = sum(pushups, (p) => p.reps);
    const kneeReps = sum(pushups.filter((p) => p.knee), (p) => p.reps);
    const elapsedWeeks = clamp(curIdx + 1, 1, M.weeks);
    const cur = W[curIdx], prev = W[curIdx - 1];

    // push-up day streak (ending today or yesterday)
    let streak = 0;
    for (let d = pushByDay.has(today) ? today : today - 1; pushByDay.has(d); d--) streak++;

    const delta = (a, b, unit, d = 1, invert = false) => {
      if (b == null || a == null) return "";
      const diff = a - b; if (Math.abs(diff) < 1e-9) return `<span>±0${unit}</span>`;
      const good = invert ? diff < 0 : diff > 0;
      return `<span class="${good ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${fmtNum(Math.abs(diff), d)}${unit}</span>`;
    };

    const wFirst = weights[0], wLast = weights[weights.length - 1];
    const goal = Number(M.cfg.goalWeight) || null;

    const tiles = [
      { label: "🏃 Distance", value: `${fmtKm(totalKm)}<small>km</small>`,
        note: cur ? `${delta(cur.km, prev ? prev.km : null, " km")} ${prev ? "vs last wk" : `${fmtKm(cur.km)} km this week`}` : `${fmtKm(totalKm / elapsedWeeks)} km / week avg` },
      { label: "🏃 Runs", value: `${runs.length}`, note: `${fmtNum(runs.length / elapsedWeeks, 1)} per week avg` },
      { label: "⏱ Avg pace", value: avgPace ? `${fmtPace(avgPace)}<small>/km</small>` : "–", note: timed.length ? `${fmtDur(sum(timed, (r) => r.sec))} total time` : "Add a time to see pace" },
      { label: "💪 Push-ups", value: fmtNum(totalReps), note: kneeReps ? `${fmtNum(totalReps - kneeReps)} full · ${fmtNum(kneeReps)} knee` : cur ? `${delta(cur.reps, prev ? prev.reps : null, "", 0)} ${prev ? "vs last wk" : `${fmtNum(cur.reps)} this week`}` : "" },
      { label: "🔥 Push-up streak", value: `${streak}<small>${streak === 1 ? "day" : "days"}</small>`, note: pushByDay.size ? `${pushByDay.size} active days total` : "Log a set to start" },
      { label: "⚖️ Weight", value: wLast ? `${fmtNum(wLast.kg, 1)}<small>kg</small>` : "–",
        note: wLast ? (weights.length > 1 ? `${delta(wLast.kg, wFirst.kg, " kg", 1, true)} overall` : "First weigh-in") + (goal ? ` · ${fmtNum(Math.abs(wLast.kg - goal), 1)} to go` : "") : "Log your weight" },
    ];
    document.getElementById("kpis").innerHTML = tiles.map((t) =>
      `<div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="foot-note">${t.note || "&nbsp;"}</div></div>`).join("");
  }

  // ───────── Render: this week ─────────
  function renderWeek() {
    const { W, curIdx, weeks, today, runs, weights, pushByDay, kneeByDay } = M;
    const idx = clamp(curIdx, 0, weeks - 1);
    const w = W[idx], prev = W[idx - 1];
    const days = [];
    for (let d = w.start; d <= w.end; d++) {
      const dr = runs.filter((r) => r.day === d);
      const knee = kneeByDay.get(d) || 0;
      const reps = (pushByDay.get(d) || 0) - knee;
      const kg = weights.find((x) => x.day === d);
      const cls = ["day", d === today ? "today" : "", d > today ? "future" : ""].join(" ");
      days.push(`<div class="${cls}">
        <span class="dn">${fmt(d, { weekday: "short" })}</span>
        <span class="dd">${fmt(d, { day: "numeric" })}</span>
        ${dr.map((r) => `<span class="chip run" title="${esc(r.note || "")}">${fmtKm(r.km)}<span class="u"> km</span></span>`).join("")}
        ${reps ? `<span class="chip push">${fmtNum(reps)}<span class="u"> reps</span></span>` : ""}
        ${knee ? `<span class="chip knee" title="Knee push-ups">${fmtNum(knee)}<span class="u"> knee</span></span>` : ""}
        ${kg ? `<span class="chip weight">${fmtNum(kg.kg, 1)}<span class="u"> kg</span></span>` : ""}
      </div>`);
    }
    document.getElementById("week-days").innerHTML = days.join("");
    const avgKg = w.kgs.length ? sum(w.kgs) / w.kgs.length : null;
    const prevKg = prev && prev.kgs.length ? sum(prev.kgs) / prev.kgs.length : null;
    const cmp = (a, b, d = 0) => (b == null ? "" : ` <span class="${a >= b ? "up" : "down"}">${a >= b ? "▲" : "▼"}${fmtNum(Math.abs(a - b), d)}</span>`);
    document.getElementById("week-totals").innerHTML = [
      `<span><i class="dot run"></i> <b>${fmtKm(w.km)}</b> km${prev ? cmp(w.km, prev.km, 1) : ""}</span>`,
      `<span><b>${w.runs}</b> ${w.runs === 1 ? "run" : "runs"}</span>`,
      `<span><i class="dot push"></i> <b>${fmtNum(w.reps)}</b> push-ups${w.knee ? ` <span class="muted">(<i class="dot knee"></i> ${fmtNum(w.knee)} knee)</span>` : ""}${prev ? cmp(w.reps, prev.reps) : ""}</span>`,
      avgKg ? `<span><i class="dot weight"></i> <b>${fmtNum(avgKg, 1)}</b> kg avg${prevKg ? ` <span class="${avgKg <= prevKg ? "up" : "down"}">${avgKg <= prevKg ? "▼" : "▲"}${fmtNum(Math.abs(avgKg - prevKg), 1)}</span>` : ""}</span>` : "",
    ].join("");
  }

  // ───────── Tooltip ─────────
  const tip = document.getElementById("tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 16;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".chart, .map")) hideTip(); });

  // ───────── Chart utilities ─────────
  function niceMax(v, ticks = 4) {
    if (v <= 0) return { max: ticks, step: 1 };
    const raw = v / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return { max: Math.ceil(v / step) * step, step };
  }
  const svgEl = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${inner}</svg>`;
  const barPath = (x, y, w, h, r = 4) => {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };

  // Weekly bar chart (distance or push-ups)
  function barChart(el, { value, color, top, topColor, target, unit, fmtV, tipExtra, emptyMsg }) {
    const { W, curIdx } = M;
    const hasData = W.some((w) => value(w) > 0);
    if (!hasData) { el.innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
    const width = el.clientWidth || 600, height = width < 500 ? 200 : 240;
    const m = { t: 16, r: 8, b: 26, l: 36 };
    const iw = width - m.l - m.r, ih = height - m.t - m.b;
    const maxV = Math.max(...W.map(value), target || 0);
    const { max, step } = niceMax(maxV);
    const y = (v) => m.t + ih - (v / max) * ih;
    const band = iw / W.length, gap = Math.max(2, band * 0.22), bw = band - gap;

    let g = "";
    for (let v = 0; v <= max + 1e-9; v += step) {
      g += `<line class="gridline" x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text class="axis-t" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v, step < 1 ? 1 : 0)}</text>`;
    }
    const labelEvery = width < 420 ? 6 : width < 700 ? 3 : 2;
    let bars = "", labels = "", hits = "";
    W.forEach((w, i) => {
      const v = value(w), x = m.l + i * band + gap / 2;
      if (v > 0) {
        const op = i === curIdx ? 1 : i > curIdx ? 0.35 : 0.72;
        const t = top ? top(w) : 0, base = v - t;
        if (!t) bars += `<path d="${barPath(x, y(v), bw, y(0) - y(v))}" fill="${color}" opacity="${op}"/>`;
        else {
          // stacked: base segment square-topped, top segment rounded, 2px surface gap between
          const gapPx = base > 0 ? 2 : 0, th = y(base) - y(v) - gapPx;
          if (base > 0) bars += `<rect x="${x}" y="${y(base)}" width="${bw}" height="${y(0) - y(base)}" fill="${color}" opacity="${op}"/>`;
          if (th > 0.5) bars += `<path d="${barPath(x, y(v), bw, th, base > 0 ? 3 : 4)}" fill="${topColor}" opacity="${op}"/>`;
        }
      }
      if (i === curIdx) bars += `<circle cx="${x + bw / 2}" cy="${y(0) + 8}" r="2.5" fill="var(--text)"/>`;
      if ((i + 1) % labelEvery === 0 || i === 0) labels += `<text x="${x + bw / 2}" y="${height - 6}" text-anchor="middle">${i + 1}</text>`;
      hits += `<rect class="hit" data-i="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ih + m.b}"/>`;
    });
    let tgt = "";
    if (target) {
      tgt = `<line class="target" x1="${m.l}" x2="${width - m.r}" y1="${y(target)}" y2="${y(target)}"/>
             <text class="target-label" x="${width - m.r}" y="${y(target) - 5}" text-anchor="end">Goal ${fmtV(target)}</text>`;
    }
    el.innerHTML = svgEl(width, height, `<g class="axis">${g}${labels}</g><line class="baseline" x1="${m.l}" x2="${width - m.r}" y1="${y(0)}" y2="${y(0)}"/>${bars}${tgt}<g>${hits}</g>`);

    const svg = el.querySelector("svg");
    const onMove = (e) => {
      const t = e.target.closest(".hit"); if (!t) return hideTip();
      const w = W[+t.dataset.i];
      showTip(`<b>Week ${w.i + 1}</b>${w.i === curIdx ? " · this week" : ""}<br>${fmtRange(w.start, w.end)}<br>${fmtV(value(w))} ${unit}${tipExtra ? tipExtra(w) : ""}`, e.clientX, e.clientY);
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerdown", onMove);
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
  }

  function renderRunning() {
    const { runs, W, curIdx } = M;
    const target = Number(M.cfg.weeklyGoalKm) || null;
    barChart(document.getElementById("run-chart"), {
      value: (w) => w.km, color: "var(--run)", target, unit: "km", fmtV: (v) => fmtKm(v),
      tipExtra: (w) => ` · ${w.runs} ${w.runs === 1 ? "run" : "runs"}${w.timedKm ? `<br>Avg pace ${fmtPace(w.sec / w.timedKm)}/km` : ""}`,
      emptyMsg: "No runs yet. Tap <b>+</b> to log your first one.",
    });
    const elapsed = W.slice(0, clamp(curIdx + 1, 1, M.weeks));
    document.getElementById("run-caption").textContent = runs.length ? `Avg ${fmtKm(sum(elapsed, (w) => w.km) / elapsed.length)} km / week` : "";

    const longest = runs.reduce((a, r) => (!a || r.km > a.km ? r : a), null);
    const paced = runs.filter((r) => r.sec && r.km >= 1);
    const fastest = paced.reduce((a, r) => (!a || r.sec / r.km < a.sec / a.km ? r : a), null);
    const bestWeek = W.reduce((a, w) => (w.km > (a ? a.km : 0) ? w : a), null);
    const fastest5 = runs.filter((r) => r.sec && r.km >= 5).reduce((a, r) => (!a || r.sec / r.km < a.sec / a.km ? r : a), null);
    recs("run-records", [
      ["Longest run", longest ? `${fmtKm(longest.km)} km` : "–", longest ? fmtLong(longest.day) : ""],
      ["Fastest pace", fastest ? `${fmtPace(fastest.sec / fastest.km)}/km` : "–", fastest ? `${fmtKm(fastest.km)} km · ${fmtShort(fastest.day)}` : ""],
      ["Best 5k+ pace", fastest5 ? `${fmtPace(fastest5.sec / fastest5.km)}/km` : "–", fastest5 ? `${fmtKm(fastest5.km)} km · ${fmtShort(fastest5.day)}` : "Run 5 km to unlock"],
      ["Biggest week", bestWeek ? `${fmtKm(bestWeek.km)} km` : "–", bestWeek ? `Week ${bestWeek.i + 1}` : ""],
    ]);
  }

  function renderPushups() {
    const { pushups, W, curIdx, pushByDay } = M;
    const target = Number(M.cfg.weeklyGoalPushups) || null;
    barChart(document.getElementById("push-chart"), {
      value: (w) => w.reps, color: "var(--push)", top: (w) => w.knee, topColor: "var(--knee)",
      target, unit: "push-ups", fmtV: (v) => fmtNum(v),
      tipExtra: (w) => ` · ${w.pushDays.size} ${w.pushDays.size === 1 ? "day" : "days"}${w.knee ? `<br>${fmtNum(w.reps - w.knee)} full · ${fmtNum(w.knee)} knee` : ""}`,
      emptyMsg: "No push-ups yet. Tap <b>+</b> → Push-ups to log a set.",
    });
    const elapsed = W.slice(0, clamp(curIdx + 1, 1, M.weeks));
    document.getElementById("push-legend").hidden = !pushups.some((p) => p.knee);
    document.getElementById("push-caption").textContent = pushups.length ? `Avg ${fmtNum(sum(elapsed, (w) => w.reps) / elapsed.length)} / week` : "";

    let bestDay = null;
    for (const [d, r] of pushByDay) if (!bestDay || r > bestDay.r) bestDay = { d, r };
    let bestSet = null;
    const hasFull = pushups.some((p) => !p.knee && p.sets.length);
    for (const p of pushups) if (p.knee !== hasFull) for (const s of p.sets) if (!bestSet || s > bestSet.s) bestSet = { s, d: p.day, knee: p.knee };
    const bestWeek = W.reduce((a, w) => (w.reps > (a ? a.reps : 0) ? w : a), null);
    // longest day streak ever
    const days = [...pushByDay.keys()].sort((a, b) => a - b);
    let longest = 0, run = 0;
    days.forEach((d, i) => { run = i && d === days[i - 1] + 1 ? run + 1 : 1; longest = Math.max(longest, run); });
    recs("push-records", [
      ["Best day", bestDay ? fmtNum(bestDay.r) : "–", bestDay ? fmtLong(bestDay.d) : ""],
      ["Biggest set", bestSet ? `${fmtNum(bestSet.s)}${bestSet.knee ? " knee" : ""}` : "–", bestSet ? fmtLong(bestSet.d) : "Log sets to track"],
      ["Longest streak", longest ? `${longest} ${longest === 1 ? "day" : "days"}` : "–", ""],
      ["Biggest week", bestWeek ? fmtNum(bestWeek.reps) : "–", bestWeek ? `Week ${bestWeek.i + 1}` : ""],
    ]);
  }

  function recs(id, items) {
    document.getElementById(id).innerHTML = items.map(([k, v, d]) =>
      `<div class="rec"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d || "&nbsp;"}</div></div>`).join("");
  }

  // ───────── Weight line chart ─────────
  function renderWeight() {
    const el = document.getElementById("weight-chart");
    const { weights, start, end, today } = M;
    const goal = Number(M.cfg.goalWeight) || null;
    document.getElementById("lg-goal").hidden = !goal;
    if (!weights.length) { el.innerHTML = `<div class="empty">No weigh-ins yet. Tap <b>+</b> → Weight to add today's.</div>`; return; }

    const width = el.clientWidth || 600, height = width < 500 ? 220 : 260;
    const m = { t: 16, r: 12, b: 26, l: 40 };
    const iw = width - m.l - m.r, ih = height - m.t - m.b;
    const x0 = Math.min(start, weights[0].day);
    let x1 = clamp(Math.max(today, weights[weights.length - 1].day), x0 + 13, Math.max(end, weights[weights.length - 1].day));
    const x = (d) => m.l + ((d - x0) / (x1 - x0)) * iw;

    const vals = weights.map((w) => w.kg).concat(goal ? [goal] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(0.5, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const step = niceMax(hi - lo, 4).step;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

    let g = "";
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += `<line class="gridline" x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v, step < 1 ? 1 : 0)}</text>`;
    }
    // x ticks: week boundaries
    const span = x1 - x0, everyW = span > 180 ? 6 : span > 90 ? 4 : span > 40 ? 2 : 1;
    for (let wk = 0; start + wk * 7 <= x1; wk += everyW) {
      const d = start + wk * 7; if (d < x0) continue;
      g += `<text x="${x(d)}" y="${height - 6}" text-anchor="middle">${fmtShort(d)}</text>`;
    }
    const dots = weights.map((w) => `<circle cx="${x(w.day)}" cy="${y(w.kg)}" r="${weights.length > 120 ? 2.5 : 3.5}" fill="var(--weight)" opacity=".38"/>`).join("");
    const line = weights.length > 1 ? `<path d="${weights.map((w, i) => `${i ? "L" : "M"}${x(w.day).toFixed(1)},${y(w.avg7).toFixed(1)}`).join("")}" fill="none" stroke="var(--weight)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>` : "";
    const last = weights[weights.length - 1];
    const lastMark = `<circle cx="${x(last.day)}" cy="${y(weights.length > 1 ? last.avg7 : last.kg)}" r="5" fill="var(--weight)" stroke="var(--surface)" stroke-width="2"/>`;
    const goalLine = goal ? `<line class="target" x1="${m.l}" x2="${width - m.r}" y1="${y(goal)}" y2="${y(goal)}"/><text class="target-label" x="${width - m.r}" y="${y(goal) - 5}" text-anchor="end">Goal ${fmtNum(goal, 1)} kg</text>` : "";
    const todayLine = today >= x0 && today <= x1 ? `<line x1="${x(today)}" x2="${x(today)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--text-3)" stroke-dasharray="2 3" opacity=".6"/>` : "";

    el.innerHTML = svgEl(width, height, `<g class="axis">${g}</g>${todayLine}${goalLine}${dots}${line}${lastMark}
      <g class="hover" visibility="hidden"><line class="cross" y1="${m.t}" y2="${m.t + ih}"/><circle r="5" fill="var(--weight)" stroke="var(--surface)" stroke-width="2"/></g>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`);

    const svg = el.querySelector("svg"), hov = svg.querySelector(".hover");
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * width;
      const d = x0 + ((px - m.l) / iw) * (x1 - x0);
      let best = weights[0];
      for (const w of weights) if (Math.abs(w.day - d) < Math.abs(best.day - d)) best = w;
      hov.setAttribute("visibility", "visible");
      hov.querySelector("line").setAttribute("x1", x(best.day)); hov.querySelector("line").setAttribute("x2", x(best.day));
      hov.querySelector("circle").setAttribute("cx", x(best.day)); hov.querySelector("circle").setAttribute("cy", y(best.kg));
      const wk = M.weekOf(best.day);
      showTip(`<b>${fmtNum(best.kg, 1)} kg</b><br>${fmtLong(best.day)}${wk >= 0 && wk < M.weeks ? ` · Week ${wk + 1}` : ""}<br>7-day avg ${fmtNum(best.avg7, 1)} kg${best.note ? `<br>${esc(best.note)}` : ""}`, e.clientX, e.clientY);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hov.setAttribute("visibility", "hidden"); hideTip(); } });
  }

  // ───────── Journey map (36-week heat grid) ─────────
  let mapKind = store.get("journey36.map", "run");
  function renderMap() {
    const el = document.getElementById("map");
    const { W, curIdx } = M;
    const val = mapKind === "run" ? (w) => w.km : (w) => w.reps;
    const max = Math.max(0, ...W.map(val));
    const level = (v) => (v <= 0 || !max ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
    el.className = `map ${mapKind}`;
    el.innerHTML = W.map((w) => {
      const v = val(w), l = level(v);
      const cls = ["cell", w.i > curIdx ? "future" : "", w.i === curIdx ? "now" : "", l ? `l${l}` : ""].join(" ");
      const n = v > 0 ? (mapKind === "run" ? `${fmtKm(v)}` : fmtNum(v)) : "";
      return `<div class="${cls}" data-i="${w.i}"><span class="w">W${w.i + 1}</span><span class="n">${n}</span></div>`;
    }).join("");
    const unit = mapKind === "run" ? "km" : "reps";
    document.getElementById("map-scale").innerHTML = `Less <i style="background:var(--surface-2)"></i>${[1, 2, 3, 4].map((i) => `<i style="background:var(--${mapKind}-${i})"></i>`).join("")} More <span style="margin-left:6px">(${unit} / week)</span>`;
    document.querySelectorAll("#map-toggle button").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === mapKind));
  }
  const mapEl = document.getElementById("map");
  const mapTip = (e) => {
    const c = e.target.closest(".cell"); if (!c) return hideTip();
    const w = M.W[+c.dataset.i];
    const kg = w.kgs.length ? `<br>Avg weight ${fmtNum(sum(w.kgs) / w.kgs.length, 1)} kg` : "";
    showTip(`<b>Week ${w.i + 1}</b>${w.i === M.curIdx ? " · this week" : ""}<br>${fmtRange(w.start, w.end)}<br>🏃 ${fmtKm(w.km)} km · ${w.runs} ${w.runs === 1 ? "run" : "runs"}<br>💪 ${fmtNum(w.reps)} push-ups${w.knee ? ` (${fmtNum(w.knee)} knee)` : ""}${kg}`, e.clientX, e.clientY);
  };
  mapEl.addEventListener("pointermove", mapTip);
  mapEl.addEventListener("pointerdown", mapTip);
  mapEl.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
  document.getElementById("map-toggle").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    mapKind = b.dataset.k; store.set("journey36.map", mapKind); renderMap();
  });

  // ───────── Activity log ─────────
  let logFilter = "all", logLimit = 25;
  function renderLog() {
    const items = [
      ...M.allRuns.map((r) => ({ kind: "run", e: r, day: r.day, title: `${fmtKm(r.km)} km run`, sub: [r.sec ? `${fmtDur(r.sec)} · ${fmtPace(r.sec / r.km)}/km` : "", r.note].filter(Boolean).join(" · ") })),
      ...M.allPushups.map((p) => ({ kind: "push", e: p, day: p.day, title: `${fmtNum(p.reps)} ${p.knee ? "knee " : ""}push-ups`, sub: [p.sets.length ? `Sets ${p.sets.join(" · ")}` : "", p.note].filter(Boolean).join(" · ") })),
      ...M.weights.map((w) => ({ kind: "weight", e: w, day: w.day, title: `${fmtNum(w.kg, 1)} kg`, sub: w.note || "" })),
    ].filter((i) => logFilter === "all" || i.kind === logFilter)
      .sort((a, b) => b.day - a.day || (a.e.src === "local" ? -1 : 1));
    const ico = { run: "🏃", push: "💪", weight: "⚖️" };
    const el = document.getElementById("log");
    if (!items.length) { el.innerHTML = `<div class="empty">Nothing logged yet. Tap <b>+</b> to add your first entry.</div>`; return; }
    el.innerHTML = items.slice(0, logLimit).map((i) => {
      const wk = M.weekOf(i.day);
      return `<div class="log-row">
        <div class="log-ico ${i.kind}">${ico[i.kind]}</div>
        <div class="log-main"><div class="log-title">${i.title}</div><div class="log-sub">${fmtLong(i.day)}${wk >= 0 && wk < M.weeks ? ` · W${wk + 1}` : i.kind === "weight" ? "" : wk < 0 ? " · before week 1" : " · after week " + M.weeks}${i.sub ? ` · ${esc(i.sub)}` : ""}</div></div>
        <div class="log-side">${i.e.src === "local" ? `<span class="pill local">${gh ? "not saved yet" : "this browser"}</span>` : ""}${isDemo ? "" : `<button class="del" type="button" aria-label="Delete entry" data-kind="${i.kind}" data-src="${i.e.src}" data-idx="${i.e.idx}">✕</button>`}</div>
      </div>`;
    }).join("") + (items.length > logLimit ? `<button class="btn log-more" type="button" id="log-more">Show more (${items.length - logLimit})</button>` : "");
  }
  document.getElementById("log").addEventListener("click", (e) => {
    if (e.target.id === "log-more") { logLimit += 50; renderLog(); return; }
    const b = e.target.closest(".del"); if (!b) return;
    const key = { run: "runs", push: "pushups", weight: "weights" }[b.dataset.kind];
    if (!confirm("Delete this entry?")) return;
    if (b.dataset.src === "local") local[key].splice(+b.dataset.idx, 1);
    else local.dels[key].push(baseConfig[key][+b.dataset.idx]);
    saveLocal(); render(); toast("Entry deleted"); queueSync();
  });
  document.getElementById("log-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    logFilter = b.dataset.k; logLimit = 25;
    document.querySelectorAll("#log-filter button").forEach((x) => x.setAttribute("aria-selected", x === b));
    renderLog();
  });

  // ───────── Add dialog ─────────
  const dlg = document.getElementById("add-dialog");
  const form = document.getElementById("add-form");
  const errEl = document.getElementById("form-error");
  let addKind = store.get("journey36.addKind", "run");
  function setAddKind(k) {
    addKind = k; store.set("journey36.addKind", k);
    document.querySelectorAll("#add-tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === k));
    form.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== k));
    errEl.textContent = "";
    dateHint();
  }
  document.getElementById("add-tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setAddKind(b.dataset.k); });
  document.getElementById("fab").addEventListener("click", () => {
    if (isDemo) { toast("Demo mode: open your own journey to log entries"); return; }
    form.reset(); form.date.value = isoOf(todayDay()); errEl.textContent = ""; paceHint();
    setAddKind(addKind);
    dlg.showModal();
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });
  const paceHint = () => {
    const km = Number(form.km.value), s = parseTime(form.time.value);
    document.getElementById("pace-hint").textContent = km > 0 && s ? `Pace ${fmtPace(s / km)} /km` : "";
  };
  form.km.addEventListener("input", paceHint);
  const dateHint = () => {
    const el = document.getElementById("date-hint"), d = form.date.value ? toDay(form.date.value) : null;
    if (d == null || addKind === "weight") { el.textContent = ""; return; }
    el.textContent = d < M.start ? `Before week 1 (starts ${fmtShort(M.start)}), so it won't count toward your stats.`
      : d > M.end ? `After week ${M.weeks}, so it won't count toward your stats.` : `Week ${M.weekOf(d) + 1}`;
  };
  form.date.addEventListener("input", dateHint);
  form.date.addEventListener("change", dateHint);
  form.time.addEventListener("input", paceHint);
  let pushType = store.get("journey36.pushType", "full");
  const setPushType = (t) => {
    pushType = t; store.set("journey36.pushType", t);
    document.querySelectorAll("#push-type button").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === t));
  };
  document.getElementById("push-type").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setPushType(b.dataset.k); });
  setPushType(pushType);
  form.sets.addEventListener("input", () => { const s = parseSets(form.sets.value); if (s.length) form.reps.value = sum(s); });

  form.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    if (!submitter || submitter.value !== "save") return; // cancel / close
    e.preventDefault();
    const date = form.date.value;
    if (!date) return (errEl.textContent = "Pick a date.");
    const note = form.note.value.trim();
    if (addKind === "run") {
      const km = Number(form.km.value);
      if (!(km > 0)) return (errEl.textContent = "Enter a distance in km.");
      const time = form.time.value.trim();
      if (time && !parseTime(time)) return (errEl.textContent = "Time should look like 28:30 or 1:05:00.");
      local.runs.push(clean({ date, km: Math.round(km * 100) / 100, time: time ? fmtDur(parseTime(time)) : undefined, note }));
    } else if (addKind === "push") {
      const sets = parseSets(form.sets.value);
      const reps = Number(form.reps.value) || sum(sets);
      if (!(reps > 0)) return (errEl.textContent = "Enter how many push-ups.");
      local.pushups.push(clean({ date, reps: Math.round(reps), type: pushType === "knee" ? "knee" : undefined, sets: sets.length ? sets : undefined, note }));
    } else {
      const kg = Number(form.kg.value);
      if (!(kg > 0)) return (errEl.textContent = "Enter your weight in kg.");
      local.weights = local.weights.filter((w) => w.date !== date);
      local.weights.push(clean({ date, kg: Math.round(kg * 10) / 10, note }));
    }
    if (!saveLocal()) { errEl.textContent = "Couldn't save — is private browsing on?"; return; }
    dlg.close("save");
    render(); queueSync();
    toast({ run: "Run saved 🏃", push: pushType === "knee" ? "Knee push-ups saved 💪" : "Push-ups saved 💪", weight: "Weight saved ⚖️" }[addKind]);
  });
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
  const saveLocal = () => store.set(LS_KEY, local);

  // ───────── data.js: merge + write ─────────
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const pendingCount = (l = local) => l.runs.length + l.pushups.length + l.weights.length + l.dels.runs.length + l.dels.pushups.length + l.dels.weights.length;

  // apply this browser's changes (adds + deletes) to a data.js config
  function mergeInto(cfg, l) {
    const keep = (k) => (cfg[k] || []).filter((e) => e && !l.dels[k].some((d) => same(d, e)));
    const wmap = new Map();
    for (const w of [...keep("weights"), ...l.weights]) wmap.set(w.date, w);
    return {
      ...cfg,
      runs: [...keep("runs"), ...l.runs].sort(byDate),
      pushups: [...keep("pushups"), ...l.pushups].sort(byDate),
      weights: [...wmap.values()].sort(byDate),
    };
  }
  // after a successful save, drop exactly what was saved (keeps anything added meanwhile)
  function subtractLocal(saved) {
    const minus = (arr, gone) => { const g = [...gone]; return arr.filter((e) => { const i = g.findIndex((x) => same(x, e)); if (i < 0) return true; g.splice(i, 1); return false; }); };
    for (const k of ["runs", "pushups", "weights"]) {
      local[k] = minus(local[k], saved[k]);
      local.dels[k] = minus(local.dels[k], saved.dels[k]);
    }
  }

  function serialize(cfg) {
    const opt = (k, v, c) => `  ${k}: ${JSON.stringify(v ?? null)},${c ? " " + c : ""}`;
    const list = (arr) => (arr || []).map((o) => `    ${JSON.stringify(o)},`).join("\n");
    return `// Your 36-week journey data. Edit by hand, or log from the site (it saves here automatically).
// runs: time is "mm:ss" or "h:mm:ss" · pushups: sets optional, "type": "knee" for knee push-ups
// weights in kg · dates YYYY-MM-DD

window.JOURNEY = {
${opt("title", cfg.title || "36 Weeks")}
${opt("startDate", cfg.startDate, "// first day of week 1")}
${opt("weeks", cfg.weeks || 36)}
${opt("goalWeight", cfg.goalWeight, "// kg")}
${opt("weeklyGoalKm", cfg.weeklyGoalKm)}
${opt("weeklyGoalPushups", cfg.weeklyGoalPushups)}

  runs: [
${list(cfg.runs)}
  ],

  pushups: [
${list(cfg.pushups)}
  ],

  weights: [
${list(cfg.weights)}
  ],
};
`;
  }
  function parseDataJs(text) {
    const sandbox = {};
    new Function("window", text)(sandbox);
    if (!sandbox.JOURNEY) throw new Error("data.js doesn't define window.JOURNEY");
    return sandbox.JOURNEY;
  }

  // ───────── Autosave to GitHub ─────────
  const GH_KEY = "journey36.github";
  let gh = isDemo ? null : store.get(GH_KEY, null); // { repo: "owner/name", branch, token }
  const syncBtn = document.getElementById("sync-btn");
  let syncState = "off", syncMsg = "";
  function setSync(state, msg = "") {
    syncState = state; syncMsg = msg;
    const n = pendingCount();
    const label = { off: n ? `${n} unsaved` : "Autosave", saving: "Saving…", saved: "Saved", error: "Not saved", offline: "Offline" }[state];
    syncBtn.dataset.state = state;
    syncBtn.querySelector(".lbl").textContent = label;
    syncBtn.title = { off: "Set up autosave to GitHub", saving: "Saving to GitHub…", saved: "Everything is saved to GitHub", error: `Couldn't save: ${msg}. Tap to retry or check settings.`, offline: "Offline. Will save when you're back online." }[state];
    const st = document.getElementById("gh-status");
    if (st) st.textContent = state === "error" ? `⚠ ${msg}` : state === "saved" ? "✓ Connected. Everything is saved." : state === "saving" ? "Saving…" : "";
  }

  const b64dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const b64enc = (str) => { let bin = ""; new TextEncoder().encode(str).forEach((x) => (bin += String.fromCharCode(x))); return btoa(bin); };
  const api = (cfg, path, opts = {}) => fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    ...opts, cache: "no-store",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  async function fetchRemote(cfg = gh) {
    const r = await api(cfg, `contents/data.js?ref=${encodeURIComponent(cfg.branch)}`);
    if (!r.ok) throw new Error(r.status === 401 ? "GitHub rejected the token" : r.status === 404 ? `Can't see data.js in ${cfg.repo} (${cfg.branch}). Check the repo name and that the token has access` : `GitHub error ${r.status}`);
    const j = await r.json();
    return { sha: j.sha, cfg: parseDataJs(b64dec(j.content)) };
  }
  function commitMessage(l) {
    const parts = [];
    const n = (k, one, many) => { if (l[k].length) parts.push(`${l[k].length} ${l[k].length === 1 ? one : many}`); };
    n("runs", "run", "runs"); n("pushups", "push-up session", "push-up sessions"); n("weights", "weigh-in", "weigh-ins");
    const dels = l.dels.runs.length + l.dels.pushups.length + l.dels.weights.length;
    const msg = parts.length ? `Log ${parts.join(", ")}` : "";
    return [msg, dels ? `remove ${dels} ${dels === 1 ? "entry" : "entries"}` : ""].filter(Boolean).join("; ").replace(/^r/, "R") || "Update data";
  }

  let syncing = null, syncAgain = false, syncTimer;
  const queueSync = () => { if (!gh) return setSync("off"); clearTimeout(syncTimer); setSync("saving"); syncTimer = setTimeout(sync, 700); };
  async function sync() {
    if (!gh) return setSync("off");
    if (syncing) { syncAgain = true; return syncing; }
    syncing = (async () => {
      try {
        setSync("saving");
        for (let attempt = 0; attempt < 3; attempt++) {
          const { sha, cfg } = await fetchRemote();
          const snap = JSON.parse(JSON.stringify(local));
          if (!pendingCount(snap)) { baseConfig = cfg; render(); setSync("saved"); return; }
          const next = mergeInto(cfg, snap);
          const r = await api(gh, "contents/data.js", {
            method: "PUT",
            body: JSON.stringify({ message: commitMessage(snap), content: b64enc(serialize(next)), sha, branch: gh.branch }),
          });
          if (r.status === 409 || r.status === 422) continue; // data.js changed underneath us: refetch and retry
          if (r.status === 403 || r.status === 404) throw new Error("The token can't write to this repo. Give it Contents: Read and write");
          if (!r.ok) throw new Error(`GitHub error ${r.status}`);
          subtractLocal(snap); saveLocal();
          baseConfig = next; render(); setSync("saved");
          return;
        }
        throw new Error("data.js kept changing. Try again");
      } catch (err) {
        setSync(navigator.onLine === false || err instanceof TypeError ? "offline" : "error", err.message);
      } finally {
        syncing = null;
        if (syncAgain) { syncAgain = false; sync(); }
      }
    })();
    return syncing;
  }
  addEventListener("online", () => gh && sync());
  document.addEventListener("visibilitychange", () => { if (!document.hidden && gh && syncState !== "saving") sync(); });

  // settings dialog
  const ghDlg = document.getElementById("gh-dialog"), ghForm = document.getElementById("gh-form");
  const guessRepo = () => {
    const h = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!h) return "";
    const first = location.pathname.split("/").filter(Boolean)[0];
    return `${h[1]}/${first && !first.includes(".") ? first : `${h[1]}.github.io`}`;
  };
  syncBtn.addEventListener("click", () => {
    if (isDemo) return toast("Demo mode: open your own journey to set up autosave");
    ghForm.repo.value = gh ? gh.repo : guessRepo();
    ghForm.branch.value = gh ? gh.branch : "main";
    ghForm.token.value = gh ? gh.token : "";
    document.getElementById("gh-disconnect").hidden = !gh;
    setSync(syncState, syncMsg);
    ghDlg.showModal();
  });
  ghDlg.addEventListener("click", (e) => { if (e.target === ghDlg) ghDlg.close(); });
  document.getElementById("gh-disconnect").addEventListener("click", () => {
    if (!confirm("Stop autosaving from this browser? Your token is removed from this device.")) return;
    gh = null; try { localStorage.removeItem(GH_KEY); } catch (e) {}
    baseConfig = window.JOURNEY || {}; render(); setSync("off"); ghDlg.close();
  });
  ghForm.addEventListener("submit", async (e) => {
    if (!e.submitter || e.submitter.value !== "connect") return;
    e.preventDefault();
    const cfg = {
      repo: ghForm.repo.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, ""),
      branch: ghForm.branch.value.trim() || "main",
      token: ghForm.token.value.trim(),
    };
    const st = document.getElementById("gh-status");
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) return (st.textContent = "⚠ Repo should look like username/36");
    if (!cfg.token) return (st.textContent = "⚠ Paste your GitHub token");
    st.textContent = "Checking…";
    try {
      await fetchRemote(cfg);
      gh = cfg; store.set(GH_KEY, gh);
      ghDlg.close(); toast("Autosave is on ☁️");
      render(); sync();
    } catch (err) { st.textContent = `⚠ ${err instanceof TypeError ? "Couldn't reach GitHub" : err.message}`; }
  });

  // manual fallback: download data.js with this browser's changes applied
  document.getElementById("export-btn").addEventListener("click", () => {
    const text = serialize(mergeInto(baseConfig, local));
    const blob = new Blob([text], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "data.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    const n = pendingCount();
    if (!gh) setTimeout(() => {
      if (n && confirm(`Downloaded data.js with ${n} ${n === 1 ? "change" : "changes"}.\n\nOnce you've replaced data.js in your repo, clear them from this browser?`)) {
        local = emptyLocal(); saveLocal(); render(); setSync("off");
      }
    }, 600);
  });

  // ───────── Theme ─────────
  document.getElementById("theme-btn").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("journey36.theme", root.dataset.theme); } catch (e) {}
    const meta = document.querySelectorAll('meta[name="theme-color"]');
    meta.forEach((m) => { m.removeAttribute("media"); m.content = dark ? "#f6f5f1" : "#0e0f12"; });
  });

  // ───────── Toast ─────────
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ───────── Demo data ─────────
  function makeDemo() {
    let seed = 36;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const t = todayDay(), start = t - 7 * 11 - 2;
    const runs = [], pushups = [], weights = [];
    let kg = 88.4, base = 20;
    for (let d = start; d <= t; d++) {
      const i = d - start, wd = i % 7, wk = Math.floor(i / 7);
      if ([0, 2, 4, 6].includes(wd) && rnd() > 0.12) {
        const km = wd === 6 ? 7 + wk * 0.6 + rnd() * 2 : 3.5 + wk * 0.2 + rnd() * 2.5;
        const pace = 380 - wk * 3 - rnd() * 20 + (wd === 6 ? 20 : 0);
        runs.push({ date: isoOf(d), km: Math.round(km * 10) / 10, time: fmtDur(km * pace) });
      }
      if (rnd() > 0.15) {
        const s = Math.round(base + wk * 1.6 + rnd() * 5);
        const sets = [s, Math.round(s * 0.9), Math.round(s * 0.8)];
        pushups.push({ date: isoOf(d), reps: sum(sets), sets });
        if (wk < 6 && rnd() > 0.4) { const k = [15, 12].map((n) => n + Math.round(rnd() * 4)); pushups.push({ date: isoOf(d), reps: sum(k), type: "knee", sets: k }); }
      }
      kg += -0.045 + (rnd() - 0.5) * 0.5;
      if (rnd() > 0.1) weights.push({ date: isoOf(d), kg: Math.round(kg * 10) / 10 });
    }
    return { title: "36 Weeks", startDate: isoOf(start), weeks: 36, goalWeight: 80, weeklyGoalKm: 30, weeklyGoalPushups: 500, runs, pushups, weights };
  }

  // ───────── Boot ─────────
  function render() {
    M = build();
    if (syncBtn && !gh) setSync("off");
    renderHero(); renderKpis(); renderWeek(); renderRunning(); renderPushups(); renderWeight(); renderMap(); renderLog();
  }
  if (isDemo) document.getElementById("demo-banner").hidden = false;
  render();
  if (gh) sync(); else setSync("off");

  let rw, lastW = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return; // iOS fires resize on scroll (toolbar show/hide)
    lastW = innerWidth; clearTimeout(rw);
    rw = setTimeout(() => { renderRunning(); renderPushups(); renderWeight(); }, 120);
  });
  // roll over to a new day if the tab stays open
  document.addEventListener("visibilitychange", () => { if (!document.hidden && todayDay() !== M.today) render(); });
})();
