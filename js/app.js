/* Wealth inequality explorer. No dependencies; hand-rolled SVG. */
(() => {
  'use strict';

  // ---------- constants ----------
  const BUCKET_OPTIONS = [5, 10, 20, 100, 1000, 10000, 100000];
  const BUCKET_INDEX_SERIES = [0, 1, 2, 3, 4]; // N values with distinct time trends (finer ones follow N=1000)
  // Survey of Consumer Finances net-worth thresholds, percentiles 1..99, 2023 dollars (via DQYDJ).
  // Used only as a within-group *shape*; group totals always come from the Fed.
  const SCF = [
    -76472, -45428, -26450, -14983, -9878, -4381, -831.8, 1, 182.2, 440.2,
    990.2, 2552, 4056, 5208, 6532.2, 7726, 9256, 10370.4, 11810, 13528,
    15600.2, 18022.2, 20716, 23310, 27016, 30316.2, 34242, 39436, 44734, 51366,
    57040, 62600.2, 67500, 73120.2, 79054, 84256, 89534, 96524, 101964, 110314,
    117810, 125686, 132632, 141164, 147316, 155908, 164132, 172168, 181562, 192084,
    202106.2, 212562, 223554, 238034, 250380, 261644, 274944, 288614, 298884, 312622,
    327622, 347520, 366448, 384910, 402800, 415460, 429190, 447958, 468284.2, 493068,
    521000.2, 551988, 587968, 622546, 658340, 697576, 743564, 785484, 836944, 891750,
    947453, 1009860, 1078294, 1154634, 1234848, 1308426, 1399334, 1510942, 1693542, 1920758,
    2157988, 2382960, 2692160, 3088722, 3779600, 4699180.2, 6150980, 8464740.2, 13666778,
  ];
  const ASSET_FLOOR = 5000;   // every household is assumed to own at least this much stuff (shape only)
  const BETA = 0.7;           // Pareto shape inside the top 1%
  const WID_TOP01_IN_TOP1 = 0.527173913;   // top 0.01% share of the top 0.1%'s wealth (WID, USA 2024)
  const WID_TOP001_IN_TOP01 = 0.5257731959; // top 0.001% share of the top 0.01%'s wealth

  // group intervals in population rank
  const G = [[0, 0.5], [0.5, 0.9], [0.9, 0.99], [0.99, 0.999], [0.999, 1]];

  // ---------- within-group shape ----------
  // cumulative asset shape over SCF percentiles (1..99); cumA[k] = mass of percentiles 1..k
  const aDens = SCF.map(v => Math.max(v, 0) + ASSET_FLOOR);
  const cumA = [0], cumN = [0];
  for (let k = 0; k < 99; k++) { cumA.push(cumA[k] + aDens[k]); cumN.push(cumN[k] + SCF[k]); }
  function massOf(cum, dens, p) { // mass from rank 0 to p, p in [0, 0.99]
    const x = p * 100;
    const k = Math.min(98, Math.floor(x + 1e-9));
    return cum[k] + (x - k) * dens[k];
  }
  const scfMass = p => massOf(cumA, aDens, p);
  const nwMass = p => massOf(cumN, SCF, p);
  function powerCum(a, b, p) { // fraction of segment [a,b] mass below p, density ∝ (1-p)^-BETA
    const e = 1 - BETA;
    const top = Math.pow(1 - a, e) - Math.pow(1 - p, e);
    const all = Math.pow(1 - a, e) - Math.pow(1 - b, e);
    return top / all;
  }
  // fraction of group g's assets held by households ranked below p (p within the group)
  function FA(g, p) {
    const [g0, g1] = G[g];
    if (p <= g0) return 0;
    if (p >= g1) return 1;
    if (g <= 2) return (scfMass(p) - scfMass(g0)) / (scfMass(g1) - scfMass(g0));
    if (g === 3) return powerCum(0.99, 0.999, p);
    // top 0.1%: sub-knots from WID, Pareto inside each
    const s1 = 1 - WID_TOP01_IN_TOP1;                 // 99.9–99.99
    const s2 = WID_TOP01_IN_TOP1 * (1 - WID_TOP001_IN_TOP01); // 99.99–99.999
    const s3 = WID_TOP01_IN_TOP1 * WID_TOP001_IN_TOP01;       // top 0.001%
    if (p < 0.9999) return s1 * powerCum(0.999, 0.9999, p);
    if (p < 0.99999) return s1 + s2 * powerCum(0.9999, 0.99999, p);
    return s1 + s2 + s3 * powerCum(0.99999, 1, p);
  }
  // fraction of group g's *net worth* held below p: the SCF net-worth shape (negatives included)
  function FN(g, p) {
    const [g0, g1] = G[g];
    if (p <= g0) return 0;
    if (p >= g1) return 1;
    if (g <= 2) return (nwMass(p) - nwMass(g0)) / (nwMass(g1) - nwMass(g0));
    return FA(g, p);
  }
  // fraction of group g's debts held below p, calibrated so that assets minus debts follows
  // the survey's net-worth shape: L·FL = A·FA − (A−L)·FN. Falls back to "in proportion to
  // assets" when the group's net worth is not positive.
  function FL(g, p, A, L) {
    const [g0, g1] = G[g];
    if (p <= g0) return 0;
    if (p >= g1) return 1;
    if (!(L > 0) || !(A - L > 0)) return FA(g, p);
    return (A * FA(g, p) - (A - L) * FN(g, p)) / L;
  }

  // ---------- state ----------
  let D = null; // data
  const PAGES = ['overview', 'distribution', 'top-bucket', 'composition', 'faq'];
  const PAGE_TITLES = { overview: 'Overview', distribution: 'Percentile Distribution', 'top-bucket': 'Top Bucket', composition: 'Composition', faq: 'FAQ' };
  // each page has its own independent controls and settings
  const PAGE_CONTROLS = { overview: ['n', 'q'], distribution: ['n', 't', 'q'], 'top-bucket': ['n', 't', 'q'], composition: ['q'], faq: [] };
  const states = {};
  let page = 'overview';
  let state = null;      // alias for states[page]
  let playing = null;    // { page, timer }

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const fmtInt = x => Math.round(x).toLocaleString('en-US');
  function fmtMoney(v, digits) {
    const s = v < 0 ? '−' : '';
    const a = Math.abs(v);
    const f = (x, u) => s + '$' + x.toLocaleString('en-US', { maximumFractionDigits: digits ?? (x < 10 ? 2 : x < 100 ? 1 : 0) }) + u;
    if (a >= 1e12) return f(a / 1e12, 'T');
    if (a >= 1e9) return f(a / 1e9, 'B');
    if (a >= 1e6) return f(a / 1e6, 'M');
    if (a >= 1e3) return f(a / 1e3, 'K');
    return s + '$' + Math.round(a).toLocaleString('en-US');
  }
  const fmtPct = (x, d = 1) => (x * 100).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%';
  function fmtRank(p) { // rank as percentile string
    const x = p * 100;
    const d = x >= 99.9 ? 3 : x >= 99 ? 2 : x >= 90 ? 1 : 0;
    return x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }
  const qLabel = q => D.quarters[q].replace(':', ' ');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function bucketName(N) {
    const w = 1 / N;
    if (N <= 100) return `Top ${fmtRank(w)}%`;
    return `Top ${(w * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`;
  }
  function dollars(q) { return state.real ? D.cpi[D.quarters.length - 1] / D.cpi[q] : 1; }

  // ---------- core computation ----------
  function groupAssets(q, g, t) {
    const row = D.data[q][g];
    let s = 0;
    for (let i = 0; i <= t; i++) s += row[i];
    return s; // millions
  }
  function totalHouseholds(q) { return D.data[q].reduce((s, r) => s + r[6], 0); }
  function totalValue(q, t, debt) {
    let s = 0;
    for (let g = 0; g < 5; g++) s += groupAssets(q, g, t) - (debt ? D.data[q][g][5] : 0);
    return s;
  }
  // wealth (millions) held by households ranked in [a, b)
  function rangeValue(q, t, debt, a, b) {
    let v = 0;
    for (let g = 0; g < 5; g++) {
      const lo = Math.max(a, G[g][0]), hi = Math.min(b, G[g][1]);
      if (hi - lo <= 1e-12) continue;
      v += groupAssets(q, g, t) * (FA(g, hi) - FA(g, lo));
      if (debt) {
        const A = groupAssets(q, g, 4), L = D.data[q][g][5];
        v -= L * (FL(g, hi, A, L) - FL(g, lo, A, L));
      }
    }
    return v;
  }
  function buckets(q, t, debt, N) {
    const hh = totalHouseholds(q) / N;
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      const a = i / N, b = (i + 1) / N;
      const v = rangeValue(q, t, debt, a, b);
      out[i] = { a, b, value: v, avg: v * 1e6 / hh };
    }
    return out;
  }
  // share of total held by the top bucket for every quarter (null where undefined)
  function topShareSeries(t, debt, N) {
    return D.quarters.map((_, q) => {
      const tot = totalValue(q, t, debt);
      if (tot <= 0) return null;
      const v = rangeValue(q, t, debt, 1 - 1 / N, 1);
      return v < 0 ? null : v / tot;
    });
  }

  // ---------- controls (one set per page) ----------
  const el = name => document.getElementById(`${name}-${page}`);
  function buildControls() {
    const last = D.quarters.length - 1, base = qLabel(last);
    for (const pg of PAGES) {
      const box = document.querySelector(`[data-controls][data-page="${pg}"]`);
      if (!box) continue;
      const has = PAGE_CONTROLS[pg];
      let h = '';
      if (has.includes('n')) h += pg === 'overview'
        ? `<div class="control">
        <label for="n-select-${pg}">Number of buckets</label>
        <select id="n-select-${pg}">${BUCKET_OPTIONS.map((N, i) => `<option value="${i}">${fmtInt(N)} · ${fmtPct(1 / N, N >= 1000 ? 3 : 0)} of households each</option>`).join('')}</select>
        <div class="readout" id="n-readout-${pg}"></div></div>`
        : `<div class="control">
        <label for="n-slider-${pg}">Number of buckets</label>
        <input id="n-slider-${pg}" type="range" min="0" max="${BUCKET_OPTIONS.length - 1}" step="1" value="4">
        <div class="readout" id="n-readout-${pg}"></div></div>`;
      if (has.includes('t')) h += `<div class="control">
        <label for="t-slider-${pg}">What counts as wealth</label>
        <input id="t-slider-${pg}" type="range" min="0" max="4" step="1" value="4">
        <div class="readout" id="t-readout-${pg}"></div>
        <label class="check"><input id="debt-check-${pg}" type="checkbox" checked> Subtract debts</label></div>`;
      if (has.includes('q')) {
        const years = [...new Set(D.quarters.map(q => q.slice(0, 4)))];
        h += `<div class="control">
        <label for="q-year-${pg}">Quarter</label>
        <div class="row">
          <select id="q-quarter-${pg}" aria-label="Quarter">${[1, 2, 3, 4].map(n => `<option value="${n}">Q${n}</option>`).join('')}</select>
          <select id="q-year-${pg}" aria-label="Year">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select>
          <button id="play-${pg}" class="btn" type="button" aria-label="Play through time">▶</button>
        </div>
        <div class="readout" id="q-readout-${pg}"></div>
        <label class="check"><input id="real-check-${pg}" type="checkbox" checked> Inflation-adjust to ${base} dollars</label></div>`;
      }
      box.innerHTML = h;
      const st = states[pg];
      const on = (id, ev, fn) => { const x = document.getElementById(`${id}-${pg}`); if (x) x.addEventListener(ev, fn); };
      on('n-select', 'change', e => setPageState(pg, { n: +e.target.value }));
      on('n-slider', 'input', e => setPageState(pg, { n: +e.target.value }));
      on('t-slider', 'input', e => setPageState(pg, { t: +e.target.value }));
      const pickQuarter = () => {
        const y = document.getElementById(`q-year-${pg}`).value, n = document.getElementById(`q-quarter-${pg}`).value;
        let i = D.quarters.indexOf(`${y}:Q${n}`);
        if (i < 0) { // combination outside the data: snap to the nearest real quarter
          const want = +y * 4 + (+n - 1);
          let best = 0, bd = Infinity;
          D.quarters.forEach((q, k) => { const d = Math.abs(+q.slice(0, 4) * 4 + (+q.slice(-1) - 1) - want); if (d < bd) { bd = d; best = k; } });
          i = best;
        }
        setPageState(pg, { q: i });
      };
      on('q-year', 'change', pickQuarter);
      on('q-quarter', 'change', pickQuarter);
      on('debt-check', 'change', e => setPageState(pg, { debt: e.target.checked }));
      on('real-check', 'change', e => setPageState(pg, { real: e.target.checked }));
      on('play', 'click', () => togglePlay(pg));
      void st;
    }
  }
  function syncControls() {
    const set = (name, prop, v) => { const x = el(name); if (x) x[prop] = v; };
    set('n-select', 'value', state.n); set('n-slider', 'value', state.n); set('t-slider', 'value', state.t);
    set('q-year', 'value', D.quarters[state.q].slice(0, 4)); set('q-quarter', 'value', D.quarters[state.q].slice(-1));
    set('debt-check', 'checked', state.debt); set('real-check', 'checked', state.real);
    $('y-mode').value = states.distribution.y;
  }
  function updateReadouts() {
    const N = BUCKET_OPTIONS[state.n];
    const hh = totalHouseholds(state.q);
    if (el('n-readout')) el('n-readout').innerHTML = el('n-slider')
      ? `<b>${fmtInt(N)}</b> buckets · ${fmtPct(1 / N, N >= 1000 ? 3 : 0)} of households each (≈${fmtInt(hh / N)} households)`
      : `≈${fmtInt(hh / N)} households per bucket`;
    if (el('t-readout')) {
      const tierNames = D.tiers.map(x => x.label);
      const tl = state.t === 0 ? 'Cash & deposits only' : state.t === 4 ? 'Everything: all assets' : 'Cash + ' + tierNames.slice(1, state.t + 1).map(s => s.toLowerCase()).join(' + ');
      el('t-readout').innerHTML = `<b>${esc(tl)}</b>${state.debt ? ' minus debts' : ''}`;
    }
    if (el('q-readout')) el('q-readout').innerHTML = `${fmtInt(hh)} households`;
  }

  // ---------- tiles ----------
  function renderTiles(B) {
    const N = BUCKET_OPTIONS[state.n];
    const q = state.q, t = state.t, debt = state.debt, k = dollars(q);
    const tot = totalValue(q, t, debt);
    const top = B[N - 1];
    const bottomHalf = rangeValue(q, t, debt, 0, 0.5);
    const medianAvg = B[Math.floor(N / 2)].avg;
    const shareOK = tot > 0;
    const topShare = shareOK && top.value >= 0 ? top.value / tot : null;
    const botShare = shareOK ? bottomHalf / tot : null;
    const first = topShareSeries(t, debt, N)[0];
    const tiles = [
      { k: `${bucketName(N)} bucket, per household`, v: fmtMoney(top.avg * k), neg: top.avg < 0,
        d: medianAvg > 0 ? `${(top.avg / medianAvg).toLocaleString('en-US', { maximumFractionDigits: 0 })}× the median bucket` : 'median bucket is underwater' },
      { k: `${bucketName(N)} share of the total`, v: topShare == null ? '—' : fmtPct(topShare),
        d: topShare == null ? 'undefined: the total is negative' : first != null ? `was ${fmtPct(first)} in 1989 Q3` : '' },
      { k: 'Bottom half share', v: botShare == null ? '—' : fmtPct(botShare, 2), neg: botShare != null && botShare < 0,
        d: botShare == null ? 'undefined: the total is negative' : `${fmtMoney(bottomHalf * 1e6 * k)} across ${fmtInt(totalHouseholds(q) / 2)} households` },
      { k: 'Total pool', v: fmtMoney(tot * 1e6 * k), neg: tot < 0,
        d: `${state.real ? 'in ' + qLabel(D.quarters.length - 1) + ' dollars' : 'nominal'} · ${fmtMoney(tot * 1e6 * k / totalHouseholds(q))} per household` },
    ];
    $('tiles').innerHTML = tiles.map(x => `<div class="tile"><div class="k">${esc(x.k)}</div><div class="v${x.neg ? ' neg' : ''}">${esc(x.v)}</div><div class="d">${esc(x.d)}</div></div>`).join('');
  }

  // ---------- axis helpers ----------
  function niceTicks(lo, hi, count) {
    const span = hi - lo;
    if (span <= 0) return [lo];
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
    return out;
  }
  function logTicks(lo, hi) {
    const out = [];
    for (let e = Math.ceil(Math.log10(lo)); Math.pow(10, e) <= hi * 1.0001; e++) out.push(Math.pow(10, e));
    return out;
  }

  // ---------- tooltip ----------
  const tip = $('tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function hideTip() { tip.hidden = true; }

  // ---------- chart 1: distribution ----------
  function renderDist(B) {
    const el = $('chart-dist');
    const W = Math.max(320, el.clientWidth), H = W < 600 ? 300 : 380;
    const m = { l: 68, r: 18, t: W < 700 ? 46 : 30, b: 42 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const N = B.length, k = dollars(state.q);
    const vals = B.map(b => b.avg * k);
    const mode = state.y;
    const top = vals[N - 1];

    // y scale
    let yMin, yMax, yOf, ticks, clipAt = null;
    if (mode === 'log') {
      const pos = vals.filter(v => v > 0);
      yMin = 1000; yMax = Math.max(...pos, yMin * 10);
      const lo = Math.log10(yMin), hi = Math.log10(yMax);
      yOf = v => v <= yMin ? m.t + ph : m.t + ph - (Math.log10(v) - lo) / (hi - lo) * ph;
      ticks = logTicks(yMin, yMax);
    } else {
      const ref = mode === 'fit99' ? B.filter(b => b.b <= 0.99 + 1e-12).map((_, i) => vals[i]) : vals;
      yMax = Math.max(...ref, 1) * 1.05;
      yMin = Math.min(0, ...vals);
      if (yMin < 0) yMin *= 1.05;
      if (mode === 'fit99' && top > yMax) clipAt = yMax;
      yOf = v => m.t + ph - (Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin) * ph;
      ticks = niceTicks(yMin, yMax, 5);
    }
    const y0 = yOf(0);
    const xOf = p => m.l + p * pw;

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Average wealth per household by rank bucket">`;
    // grid + y ticks
    for (const tv of ticks) {
      const y = yOf(tv);
      s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      s += `<text class="tick" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${fmtMoney(tv)}</text>`;
    }
    // x ticks
    for (let p = 0; p <= 100; p += W < 600 ? 25 : 10) {
      const x = xOf(p / 100);
      s += `<text class="tick" x="${x}" y="${H - m.b + 18}" text-anchor="middle">${p}%</text>`;
    }
    s += `<text class="tick" x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle">households ranked by wealth, poorest → richest (${fmtInt(N)} buckets)</text>`;

    // marks
    const gap = 2;
    if (N <= 100) {
      const bw = pw / N;
      for (let i = 0; i < N; i++) {
        const v = vals[i];
        const x = xOf(i / N) + gap / 2, w = Math.max(1, bw - gap);
        let y1 = yOf(v), y2 = y0;
        if (v < 0) { y1 = y0; y2 = yOf(v); }
        const h = Math.max(0, Math.abs(y2 - y1));
        const cls = 'bar' + (i === N - 1 ? ' top' : '') + (v < 0 ? ' neg' : '');
        s += `<rect class="${cls}" x="${x.toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, w / 2)}"/>`;
        if (clipAt != null && v > clipAt) s += `<rect class="annot-bg" x="${x.toFixed(1)}" y="${(m.t + 8).toFixed(1)}" width="${w.toFixed(1)}" height="3" opacity="1"/>`;
      }
    } else {
      // area: one sample per pixel column; the last column is the top bucket, drawn as its own bar
      const cols = Math.floor(pw);
      let path = `M${xOf(0).toFixed(1)},${y0.toFixed(1)}`;
      for (let c = 0; c < cols - 3; c++) {
        const i = Math.min(N - 2, Math.floor((c + 0.5) / pw * N));
        const y = yOf(vals[i]);
        path += `L${(m.l + c).toFixed(1)},${y.toFixed(1)}L${(m.l + c + 1).toFixed(1)},${y.toFixed(1)}`;
      }
      path += `L${(m.l + cols - 3).toFixed(1)},${y0.toFixed(1)}Z`;
      s += `<path class="area" d="${path}"/>`;
      const v = top, x = m.l + cols - 3 + gap / 2, w = 3;
      const y1 = yOf(Math.max(v, 0)), y2 = v < 0 ? yOf(v) : y0;
      s += `<rect class="bar top${v < 0 ? ' neg' : ''}" x="${x}" y="${Math.min(y1, y2).toFixed(1)}" width="${w}" height="${Math.abs(y2 - y1).toFixed(1)}"/>`;
      if (clipAt != null && v > clipAt) s += `<rect class="annot-bg" x="${x - 2}" y="${m.t + 8}" width="${w + 4}" height="3" opacity="1"/>`;
    }
    s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>`;

    // annotation for the top bucket
    const times = clipAt != null ? top / (yMax / 1.05) : null;
    const l1 = `${bucketName(N)}: ${fmtMoney(top)} per household`;
    const l2 = times ? `${times.toLocaleString('en-US', { maximumFractionDigits: 0 })}× the height of this chart` : '';
    const oneLine = !l2 || (l1.length + l2.length + 3) * 6.6 + 16 < pw - 8;
    const lines = oneLine ? [l2 ? `${l1} — ${l2}` : l1] : [l1, l2];
    const tw = Math.max(...lines.map(t => t.length)) * 6.6 + 16, th = lines.length * 16 + 4;
    s += `<rect class="annot-bg" x="${W - m.r - tw}" y="${m.t - 6 - th}" width="${tw}" height="${th}" rx="4"/>`;
    lines.forEach((t, i) => { s += `<text class="annot" x="${W - m.r - 8}" y="${m.t - 6 - th + 14 + i * 16}" text-anchor="end">${esc(t)}</text>`; });
    s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/>`;
    s += '</svg>';
    el.innerHTML = s;

    // hover
    const svg = el.querySelector('svg');
    const hit = el.querySelector('.hit');
    const tot = totalValue(state.q, state.t, state.debt);
    const hhPer = totalHouseholds(state.q) / N;
    const onMove = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * W / r.width;
      let i = Math.floor((px - m.l) / pw * N);
      if (N > 100 && px >= m.l + Math.floor(pw) - 3) i = N - 1;
      i = Math.max(0, Math.min(N - 1, i));
      const b = B[i];
      const share = tot > 0 ? b.value / tot : null;
      showTip(`<b>Percentile ${fmtRank(b.a)}–${fmtRank(b.b)}</b><br>${fmtMoney(b.avg * k)} per household<br>` +
        `<span class="m">${share == null ? 'share undefined' : fmtPct(share, N >= 1000 ? 2 : 1) + ' of all wealth'} · ${fmtInt(hhPer)} households</span>`, ev.clientX, ev.clientY);
    };
    hit.addEventListener('mousemove', onMove);
    hit.addEventListener('mouseleave', hideTip);

    $('dist-sub').textContent = `Average ${state.debt ? 'net ' : ''}${state.t === 4 ? 'wealth' : 'holdings'} per household in each of ${fmtInt(N)} equal buckets, ${qLabel(state.q)}` +
      (state.real ? `, in ${qLabel(D.quarters.length - 1)} dollars.` : ', nominal dollars.') +
      (clipAt != null ? ' The richest bucket does not fit; its bar is clipped.' : '');
    renderTable(B, k, tot, hhPer);
  }

  function renderTable(B, k, tot, hhPer) {
    const wrap = $('dist-table');
    if (!state.table) { wrap.innerHTML = ''; return; }
    const N = B.length;
    let idx = [];
    if (N <= 100) idx = B.map((_, i) => i);
    else { const step = N / 100; for (let i = 0; i < N - 10; i += step) idx.push(Math.round(i)); for (let i = N - 10; i < N; i++) idx.push(i); }
    let h = '<table><thead><tr><th>Percentile range</th><th>Households</th><th>Per household</th><th>Total</th><th>Share</th></tr></thead><tbody>';
    for (const i of idx) {
      const b = B[i];
      h += `<tr><td>${fmtRank(b.a)}–${fmtRank(b.b)}</td><td>${fmtInt(hhPer)}</td><td>${fmtMoney(b.avg * k)}</td><td>${fmtMoney(b.value * 1e6 * k)}</td><td>${tot > 0 ? fmtPct(b.value / tot, 2) : '—'}</td></tr>`;
    }
    wrap.innerHTML = h + '</tbody></table>';
  }

  // ---------- chart 2: top share over time (indexed) ----------
  function renderShare() {
    const el = $('chart-share');
    const W = Math.max(320, el.clientWidth), H = W < 600 ? 260 : 320;
    const m = { l: 44, r: W < 600 ? 92 : 112, t: 16, b: 34 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const Q = D.quarters.length;
    const hiIdx = Math.min(state.n, 4);
    const undefinedMsg = 'Shares are undefined here: with this definition of wealth and debts subtracted, American households collectively owe more than they hold in some quarters, so a share of the total has no meaning.';
    const allSeries = BUCKET_INDEX_SERIES.map(ni => {
      const N = BUCKET_OPTIONS[ni];
      const raw = topShareSeries(state.t, state.debt, N);
      const ok = raw.every(v => v != null);
      const base = raw[0];
      return { ni, N, raw, ok, idx: raw.map(v => ok ? v / base * 100 : null), name: bucketName(N) };
    });
    const series = allSeries.filter(x => x.ok);
    if (!allSeries[hiIdx].ok) {
      el.innerHTML = `<p class="note" style="padding:24px 0">${esc(undefinedMsg)}</p>`;
      $('share-note').textContent = '';
      return;
    }
    const all = series.flatMap(s => s.idx).filter(v => v != null);
    const lo = Math.min(60, ...all), hi = Math.max(140, ...all);
    const yOf = v => m.t + ph - (v - lo) / (hi - lo) * ph;
    const xOf = q => m.l + q / (Q - 1) * pw;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Top bucket's share of wealth over time, indexed">`;
    for (const tv of niceTicks(lo, hi, 5)) {
      const y = yOf(tv);
      s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="tick" x="${m.l - 8}" y="${y + 4}" text-anchor="end">${tv}</text>`;
    }
    for (let yr = 1990; yr <= 2026; yr += W < 600 ? 10 : 5) {
      const q = D.quarters.findIndex(d => d.startsWith(String(yr)));
      if (q >= 0) s += `<text class="tick" x="${xOf(q)}" y="${H - m.b + 18}" text-anchor="middle">${yr}</text>`;
    }
    s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${yOf(100)}" y2="${yOf(100)}"/>`;
    const ordered = series.filter(x => x.ni !== hiIdx).concat(series.filter(x => x.ni === hiIdx));
    const labels = [];
    for (const sr of ordered) {
      let d = '', pen = false;
      sr.idx.forEach((v, q) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + xOf(q).toFixed(1) + ',' + yOf(v).toFixed(1); pen = true; });
      const isHi = sr.ni === hiIdx;
      s += `<path class="line${isHi ? ' hi' : ''}" d="${d}"/>`;
      const last = [...sr.idx].reverse().find(v => v != null);
      if (last != null) labels.push({ y: yOf(last), text: sr.name + (isHi && state.n > 4 ? ' & finer' : ''), hi: isHi });
    }
    // de-collide end labels
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const l of labels) s += `<text class="endlabel${l.hi ? ' hi' : ''}" x="${W - m.r + 6}" y="${l.y + 4}">${esc(l.text)}</text>`;
    const cx = xOf(state.q);
    s += `<line class="cursor" x1="${cx}" x2="${cx}" y1="${m.t}" y2="${m.t + ph}"/>`;
    s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></svg>`;
    el.innerHTML = s;

    const svg = el.querySelector('svg'), hit = el.querySelector('.hit');
    const qAt = ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * W / r.width; return Math.max(0, Math.min(Q - 1, Math.round((px - m.l) / pw * (Q - 1)))); };
    hit.addEventListener('mousemove', ev => {
      const q = qAt(ev);
      let h = `<b>${qLabel(q)}</b><br>`;
      for (const sr of series) h += `${sr.idx[q] == null ? '—' : Math.round(sr.idx[q])} · ${sr.raw[q] == null ? '—' : fmtPct(sr.raw[q])} <span class="m">${esc(sr.name)}</span><br>`;
      showTip(h, ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('click', ev => { setState({ q: qAt(ev) }); });

    const hs = series.find(x => x.ni === hiIdx);
    const now = hs.raw[state.q], first = hs.raw[0];
    $('share-note').textContent = `${hs.name}${state.n > 4 ? ' (and the finer buckets, which follow it by construction)' : ''}: ${fmtPct(first)} of the total in 1989 Q3 → ${fmtPct(now)} in ${qLabel(state.q)}.` +
        (state.n >= 4 ? ' Buckets finer than 0.1% use a fixed split of the Fed\'s top-0.1% total, so their trend is the top 0.1%\'s trend.' : '') +
        (series.length < allSeries.length ? ' Lines whose share is undefined in some quarter are omitted.' : '');
  }

  // ---------- chart 3: composition ----------
  function renderMix() {
    const el = $('chart-mix');
    const W = Math.max(320, el.clientWidth);
    const rowH = 34, m = { l: W < 600 ? 96 : 130, r: W < 600 ? 74 : 150, t: 6, b: 6 };
    const H = m.t + m.b + 5 * rowH;
    const pw = W - m.l - m.r;
    const q = state.q;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Asset composition by wealth group">`;
    const segs = [];
    for (let g = 4; g >= 0; g--) {
      const row = D.data[q][g];
      const assets = row.slice(0, 5).reduce((a, b) => a + b, 0);
      const y = m.t + (4 - g) * rowH;
      s += `<text class="rowlabel" x="${m.l - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(D.groupLabels[g])}</text>`;
      let x = m.l;
      for (let t = 0; t < 5; t++) {
        const w = row[t] / assets * pw;
        s += `<rect class="seg" data-g="${g}" data-t="${t}" x="${x.toFixed(1)}" y="${y + 4}" width="${w.toFixed(1)}" height="${rowH - 8}" fill="var(--tier-${t + 1})"/>`;
        if (w > 44) s += `<text class="seglabel" x="${(x + w / 2).toFixed(1)}" y="${y + rowH / 2 + 4}" text-anchor="middle">${fmtPct(row[t] / assets, 0)}</text>`;
        segs.push({ g, t, x, w, y });
        x += w;
      }
      s += `<text class="rowmeta" x="${W - m.r + 8}" y="${y + rowH / 2 + 4}">debts ${fmtPct(row[5] / assets, 0)}${W < 600 ? '' : ' of assets'}</text>`;
    }
    s += '</svg>';
    el.innerHTML = s;
    const k = dollars(q);
    el.querySelectorAll('.seg').forEach(r => {
      r.addEventListener('mousemove', ev => {
        const g = +r.dataset.g, t = +r.dataset.t, row = D.data[q][g];
        const assets = row.slice(0, 5).reduce((a, b) => a + b, 0);
        showTip(`<b>${esc(D.groupLabels[g])}</b> · ${esc(D.tiers[t].label)}<br>${fmtMoney(row[t] * 1e6 * k)} · ${fmtPct(row[t] / assets)} of this group's assets<br><span class="m">${fmtMoney(row[t] * 1e6 * k / row[6])} per household</span>`, ev.clientX, ev.clientY);
      });
      r.addEventListener('mouseleave', hideTip);
    });
    $('mix-title').textContent = `What each group's wealth is made of, ${qLabel(q)}`;
    $('mix-legend').innerHTML = D.tiers.map((t, i) => `<span style="--sw: var(--tier-${i + 1})">${esc(t.label)}</span>`).join('');
  }

  // ---------- orchestration ----------
  function showPage() {
    document.querySelectorAll('.page').forEach(x => { x.hidden = x.dataset.page !== page; });
    document.querySelectorAll('.nav a[data-nav]').forEach(a => {
      if (a.classList.contains('brand')) return;
      if (a.dataset.nav === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = page === 'overview' ? 'Wealth Distribution' : `${PAGE_TITLES[page]} · Wealth Distribution`;
  }
  function render() {
    state = states[page];
    showPage();
    syncControls();
    updateReadouts();
    if (page === 'overview' || page === 'distribution') {
      const B = buckets(state.q, state.t, state.debt, BUCKET_OPTIONS[state.n]);
      if (page === 'overview') renderTiles(B); else renderDist(B);
    } else if (page === 'top-bucket') renderShare();
    else if (page === 'composition') renderMix();
    writeHash();
  }
  function setPageState(pg, patch) {
    Object.assign(states[pg], patch);
    if (pg === page) render();
  }
  function setState(patch) { setPageState(page, patch); }
  function goToPage(pg, push) {
    if (!PAGES.includes(pg)) pg = 'overview';
    if (playing) togglePlay(playing.page);
    page = pg; state = states[page];
    if (push) history.pushState(null, '', '#' + hashString());
    window.scrollTo({ top: 0 });
    render();
  }
  function hashString() {
    if (PAGE_CONTROLS[page].length === 0) return page;
    const s = states[page];
    return `${page}?n=${BUCKET_OPTIONS[s.n]}&t=${s.t}&d=${s.debt ? 1 : 0}&q=${D.quarters[s.q]}&r=${s.real ? 1 : 0}&y=${states.distribution.y}`;
  }
  function writeHash() { history.replaceState(null, '', '#' + hashString()); }
  function readHash() {
    const raw = location.hash.slice(1);
    const qi = raw.indexOf('?');
    let pg = qi >= 0 ? raw.slice(0, qi) : raw, params = qi >= 0 ? raw.slice(qi + 1) : '';
    if (pg.includes('=')) { params = pg; pg = 'overview'; } // legacy hash with state only
    page = PAGES.includes(pg) ? pg : 'overview';
    const s = states[page];
    const p = new URLSearchParams(params);
    if (p.has('n')) { const i = BUCKET_OPTIONS.indexOf(+p.get('n')); if (i >= 0) s.n = i; }
    if (p.has('t')) s.t = Math.max(0, Math.min(4, +p.get('t') | 0));
    if (p.has('d')) s.debt = p.get('d') === '1';
    if (p.has('q')) { const i = D.quarters.indexOf(p.get('q')); if (i >= 0) s.q = i; }
    if (p.has('r')) s.real = p.get('r') === '1';
    if (p.has('y') && ['fit99', 'all', 'log'].includes(p.get('y'))) states.distribution.y = p.get('y');
  }
  function togglePlay(pg) {
    const btn = document.getElementById(`play-${pg}`);
    if (playing) {
      clearInterval(playing.timer);
      const b = document.getElementById(`play-${playing.page}`);
      b.textContent = '▶'; b.setAttribute('aria-pressed', 'false');
      const was = playing.page; playing = null;
      if (was === pg) return;
    }
    const st = states[pg];
    if (st.q >= D.quarters.length - 1) st.q = 0;
    btn.textContent = '❚❚'; btn.setAttribute('aria-pressed', 'true');
    playing = { page: pg, timer: setInterval(() => {
      if (st.q >= D.quarters.length - 1) { togglePlay(pg); return; }
      setPageState(pg, { q: st.q + 1 });
    }, 120) };
  }

  function wire() {
    buildControls();
    $('y-mode').addEventListener('change', e => setPageState('distribution', { y: e.target.value }));
    $('table-toggle').addEventListener('click', () => {
      const s = states.distribution;
      s.table = !s.table;
      $('dist-table').hidden = !s.table;
      $('table-toggle').setAttribute('aria-expanded', String(s.table));
      $('table-toggle').setAttribute('aria-pressed', String(s.table));
      if (page === 'distribution') render();
    });
    document.querySelectorAll('[data-set-n]').forEach(b => b.addEventListener('click', () => { states.distribution.n = BUCKET_OPTIONS.indexOf(+b.dataset.setN); goToPage('distribution', true); }));
    document.querySelectorAll('[data-set-t]').forEach(b => b.addEventListener('click', () => { states.distribution.t = +b.dataset.setT; goToPage('distribution', true); }));
    let raf = null;
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); });
    document.querySelectorAll('.nav a[data-nav]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      if (a.dataset.nav !== page) goToPage(a.dataset.nav, true);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    window.addEventListener('popstate', () => { readHash(); goToPage(page, false); });
  }

  fetch('data/dfa.json').then(r => r.json()).then(d => {
    D = d;
    const last = D.quarters.length - 1;
    for (const pg of PAGES) states[pg] = { n: 4, t: 4, debt: true, q: last, real: true, y: 'fit99', table: false };
    state = states[page];
    readHash();
    wire();
    goToPage(page, false);
  }).catch(err => {
    $('tiles').innerHTML = `<div class="tile"><div class="k">Could not load data</div><div class="d">${esc(err.message)}</div></div>`;
  });
})();
