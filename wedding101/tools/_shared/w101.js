/* Wedding 101 shared module (TOOLS-SPEC.md section 5.2). ES module, no dependencies.
 *
 * Each tool loads it from its single trailing <script type="module">:
 *   import { store, plan, defaults, bind, time, sunset, ... } from '/wedding101/tools/_shared/w101.js';
 * The two JSON files beside it are imported as JSON modules, so every number the tools use
 * comes from defaults.json and every sunset from sunset-nb.json, and nowhere else.
 *
 * Storage. Every key starts with ee-w101- (BRIEF.md). ee-w101-<id> is a tool's own record.
 * ee-w101-plan is the one shared record every tool reads and writes. Read it through planFacts()
 * below, which knows every builder's key names, so a tool never has to. The unified key list,
 * with the tool that writes each in parentheses (all optional; a tool may not have written yet):
 *
 *   names (every tool; toasts, plan-b, and music also write name1 and name2), date YYYY-MM-DD (every tool)
 *   venue (run-of-show, team-sheet), venueAccess HH:MM (team-sheet)
 *   guests (run-of-show) and its alias guestCount (team-sheet, checklist; run-of-show writes both)
 *   ceremonyStart HH:MM, ceremonyLen, musicEnd, outBy, dinnerStyle, dinnerMinutes, tableRelease (run-of-show)
 *   firstLook, outdoor, sunsetPortraits, sunsetOverride HH:MM (run-of-show, sunset)
 *   runOfShow {ceremonyStart, toastsAt, cakeAt, danceStart, musicEnd, floor} (run-of-show)
 *   toastsStart HH:MM (run-of-show writes the clock time of the toast block; the toast planner reads it
 *     back for its speaker cards and writes it itself only when the couple types a start there)
 *   events [{id, label, pick, minutes, inside, detail, type}] (events), eventPicks {id: keep|skip|maybe}
 *     (events; the same picks as a map, which is the shape music reads), songs {id: text} (events)
 *   toastsMinutes (the whole block: speakers, applause, blessing, open mic), toastsCount, toastsPlacement
 *     before|between|after, toastsBlessing, toastsOpenMic (toasts)
 *   entranceMinutes, parentDances 0|1|2, parentDancesShared, lastSong {style, encore, circle,
 *     privateLastDance}, anniversaryDance (music)
 *   rainTrigger (percent), rainLowTemp (degrees), rainDeadline, rainCaller, rainFlip (text), planBDecided (plan-b)
 *   pointPerson {name, cell}, vendorMeals (count), roles {cards, envelopes, rain, sendoff, deliveries} (team-sheet);
 *     the vendor rows themselves stay in ee-w101-team-sheet as rows[] {role, company, contact, cell,
 *     email, arrive, depart, meals}, and planFacts() reads them from there as team[]
 *   great, missed, total (budget), seatingNotes (interviews)
 *   _w {writerId: timestamp} (run-of-show, sunset, events): who wrote last. plan.patch(partial, writerId)
 *     stamps it. Builders that do not stamp are still read: a tool takes their fact whenever it changes.
 */
import defaultsJson from './defaults.json' with { type: 'json' };
import sunsetJson from './sunset-nb.json' with { type: 'json' };
import * as text from './text.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const defaults = deepFreeze(defaultsJson);
export const sunsetTable = deepFreeze(sunsetJson);
export { text };
export const PREFIX = 'ee-w101-';

/* ---- storage ------------------------------------------------------------- */
export function store(id) {
  const key = PREFIX + id;
  let pending = null;
  let timer = null;
  let available = true;
  const listeners = [];
  try { localStorage.setItem(key + '~probe', '1'); localStorage.removeItem(key + '~probe'); } catch (e) { available = false; }
  function read() {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function write() {
    timer = null;
    const obj = pending;
    pending = null;
    if (obj === null) return;
    let ok = true;
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { ok = false; }
    available = ok;
    const when = new Date();
    for (const fn of listeners) { try { fn(ok, when); } catch (e) { /* a listener must never break a save */ } }
  }
  const api = {
    id,
    key,
    get available() { return available; },
    get() {
      if (pending) return pending;
      const v = read();
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    },
    set(obj) { pending = obj; if (timer) clearTimeout(timer); timer = setTimeout(write, 300); },
    patch(partial, writer) {
      const cur = Object.assign({}, api.get() || {}, partial);
      if (writer) { cur._w = Object.assign({}, cur._w || {}); cur._w[writer] = Date.now(); }
      api.set(cur);
      return cur;
    },
    flush() { if (timer) { clearTimeout(timer); timer = null; write(); } },
    clear() {
      pending = null;
      if (timer) { clearTimeout(timer); timer = null; }
      try { localStorage.removeItem(key); } catch (e) { /* storage is off; nothing to clear */ }
    },
    onSaved(fn) { listeners.push(fn); }
  };
  window.addEventListener('pagehide', api.flush);
  return api;
}

export const plan = store('plan');
export const progress = store('progress');

/* ---- two-way binding ----------------------------------------------------- */
/* bind(root, state, onChange): every input, select, and textarea with a name, every
 * [role=radiogroup][data-name] of [role=radio][data-value] buttons (data-type="bool" or
 * "number" converts), and every .w1-stepper (a named number input between [data-step]
 * buttons). Restores from state on load, writes state on input, calls onChange(state, name). */
export function bind(root, state, onChange) {
  const fields = () => Array.from(root.querySelectorAll('input[name],select[name],textarea[name]')).filter(el => el.type !== 'file');
  const groups = () => Array.from(root.querySelectorAll('[role="radiogroup"][data-name]'));

  function readEl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }
  function writeEl(el, v) {
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = (v === undefined || v === null) ? '' : String(v);
  }
  function groupValue(g, raw) {
    if (g.dataset.type === 'bool') return raw === 'true';
    if (g.dataset.type === 'number') return Number(raw);
    return raw;
  }
  function paintGroup(g) {
    const val = state[g.dataset.name];
    const btns = g.querySelectorAll('[role="radio"]');
    let any = false;
    btns.forEach(b => {
      const on = String(groupValue(g, b.dataset.value)) === String(val);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on) any = true;
    });
    if (!any && btns.length) btns[0].tabIndex = 0;
  }
  function paintStepper(s) {
    const inp = s.querySelector('input');
    if (!inp) return;
    const v = Number(inp.value);
    s.querySelectorAll('[data-step]').forEach(b => {
      const d = Number(b.dataset.step);
      const min = inp.min !== '' ? Number(inp.min) : -Infinity;
      const max = inp.max !== '' ? Number(inp.max) : Infinity;
      b.disabled = (d < 0 && v <= min) || (d > 0 && v >= max);
    });
  }
  function refresh() {
    for (const el of fields()) if (el.name in state) writeEl(el, state[el.name]);
    for (const g of groups()) paintGroup(g);
    root.querySelectorAll('.w1-stepper').forEach(paintStepper);
  }
  function changed(name) { onChange(state, name); }

  root.addEventListener('input', e => {
    const el = e.target;
    if (!el.name || el.type === 'file') return;
    state[el.name] = readEl(el);
    const s = el.closest('.w1-stepper');
    if (s) paintStepper(s);
    changed(el.name);
  });
  root.addEventListener('change', e => {
    const el = e.target;
    if (!el.name || el.type === 'file') return;
    const v = readEl(el);
    if (state[el.name] === v) return;
    state[el.name] = v;
    changed(el.name);
  });
  root.addEventListener('click', e => {
    const step = e.target.closest('[data-step]');
    if (step && root.contains(step)) {
      const s = step.closest('.w1-stepper');
      const inp = s && s.querySelector('input');
      if (!inp) return;
      e.preventDefault();
      const d = Number(step.dataset.step);
      const min = inp.min !== '' ? Number(inp.min) : -Infinity;
      const max = inp.max !== '' ? Number(inp.max) : Infinity;
      let v = Number(inp.value);
      if (isNaN(v) || inp.value === '') v = Number(inp.dataset.default || (min === -Infinity ? 0 : min));
      v = Math.min(max, Math.max(min, v + d));
      inp.value = String(v);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const btn = e.target.closest('[role="radio"]');
    if (btn && root.contains(btn)) {
      const g = btn.closest('[role="radiogroup"][data-name]');
      if (!g) return;
      e.preventDefault();
      state[g.dataset.name] = groupValue(g, btn.dataset.value);
      paintGroup(g);
      btn.focus();
      changed(g.dataset.name);
    }
  });
  root.addEventListener('keydown', e => {
    const btn = e.target.closest('[role="radio"]');
    if (!btn) return;
    const g = btn.closest('[role="radiogroup"][data-name]');
    if (!g) return;
    const btns = Array.from(g.querySelectorAll('[role="radio"]'));
    const i = btns.indexOf(btn);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = btns.length - 1;
    if (j < 0) return;
    e.preventDefault();
    btns[j].click();
  });
  refresh();
  return { state, refresh };
}

/* ---- time ---------------------------------------------------------------- */
export const time = {
  /* '16:00', '16:00:00', '4:00 PM', '4 pm' -> minutes since midnight; null when unreadable */
  parse(s) {
    if (typeof s === 'number') return isFinite(s) ? s : null;
    if (!s) return null;
    s = String(s).trim();
    let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]?\.?$/.exec(s);
    if (m) { let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + Number(m[2] || 0); }
    return null;
  },
  /* minutes -> '4:00 PM'; minutes past 1440 wrap to the next day's clock */
  format(min) {
    if (min === null || min === undefined || isNaN(min)) return '';
    let t = Math.round(min);
    t = ((t % 1440) + 1440) % 1440;
    const h = Math.floor(t / 60), mm = t % 60;
    return (h % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h < 12 ? 'AM' : 'PM');
  },
  /* minutes -> 'HH:MM' for a time input */
  hhmm(min) {
    let t = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(t / 60), mm = t % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  },
  add(t, minutes) { return t + minutes; },
  diff(a, b) { return b - a; },
  round5(n) { return Math.round(n / 5) * 5; },
  ceilTo(n, step) { return Math.ceil(n / step - 1e-9) * step; },
  /* 330 -> '5 h 30 m', 60 -> '1 h', 45 -> '45 m' */
  hm(n) {
    n = Math.max(0, Math.round(n));
    const h = Math.floor(n / 60), m = n % 60;
    if (!h) return m + ' m';
    return h + ' h' + (m ? ' ' + m + ' m' : '');
  }
};

/* ---- dates --------------------------------------------------------------- */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function dayOfYear(y, m, d) { let n = d; for (let q = 1; q < m; q++) n += MDAYS[q - 1] + (q === 2 && isLeap(y) ? 1 : 0); return n; }

/* 'YYYY-MM-DD' -> { y, m, d, weekday, isSaturday, label 'Saturday, October 16', long '..., 2027', monthName } or null */
export function dateInfo(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  const wd = dt.getDay();
  return {
    y, m: mo, d,
    weekday: DAYS[wd],
    isSaturday: wd === 6,
    monthName: MONTHS[mo - 1],
    label: DAYS[wd] + ', ' + MONTHS[mo - 1] + ' ' + d,
    long: DAYS[wd] + ', ' + MONTHS[mo - 1] + ' ' + d + ', ' + y
  };
}

/* ---- sunset (built-in table, no lookup) ---------------------------------- */
function nthSunday(y, m, n) { const dow = new Date(y, m - 1, 1).getDay(); return 1 + ((7 - dow) % 7) + 7 * (n - 1); }
function dstBounds(y) {
  const d = sunsetTable.dst[String(y)];
  if (d) return d.map(s => { const p = s.split('-').map(Number); return { m: p[0], d: p[1] }; });
  return [{ m: 3, d: nthSunday(y, 3, 2) }, { m: 11, d: nthSunday(y, 11, 1) }];
}
function inDst(y, m, d) {
  const b = dstBounds(y);
  const k = m * 100 + d;
  return k >= b[0].m * 100 + b[0].d && k < b[1].m * 100 + b[1].d;
}
function rowStd(r) {
  const off = r.zone === 'EDT' ? 60 : 0;
  return { s: time.parse(r.sunset) - off, k: time.parse(r.dusk) - off };
}

/* sunset(month, day, year, override) -> { sunset, dusk, golden (minutes since midnight), label 'EST'|'EDT',
 * dst, interpolated, overridden, dstNote (string or null), year, month, day, source }.
 * Interpolates linearly between the 1st and 15th rows in standard time, then applies the offset
 * for the date, so a date between March 1 and March 15 lands on the right side of the change. */
export function sunset(month, day, year, override) {
  const y = Number(year) || new Date().getFullYear();
  const rows = sunsetTable.rows;
  let s, k, interpolated = false;
  const exact = rows.find(r => r.m === month && r.d === day);
  if (exact) {
    const v = rowStd(exact);
    s = v.s; k = v.k;
  } else {
    let i = -1;
    for (let j = 0; j < rows.length; j++) if (rows[j].m < month || (rows[j].m === month && rows[j].d <= day)) i = j;
    const a = rows[i < 0 ? rows.length - 1 : i];
    const b = rows[(i + 1) % rows.length];
    const total = isLeap(y) ? 366 : 365;
    const da = dayOfYear(y, a.m, a.d);
    let db = dayOfYear(y, b.m, b.d);
    let dt = dayOfYear(y, month, day);
    if (db <= da) db += total;
    if (dt < da) dt += total;
    const f = (dt - da) / (db - da);
    const A = rowStd(a), B = rowStd(b);
    s = A.s + (B.s - A.s) * f;
    k = A.k + (B.k - A.k) * f;
    interpolated = true;
  }
  const dst = inDst(y, month, day);
  const off = dst ? 60 : 0;
  let sunsetMin = Math.round(s) + off;
  let dusk = Math.round(k) + off;
  let overridden = false;
  const ov = time.parse(override);
  if (ov !== null) { dusk += ov - sunsetMin; sunsetMin = ov; overridden = true; }
  const D = defaults.sunset;
  const bounds = dstBounds(y);
  let dstNote = null;
  for (let i = 0; i < 2; i++) {
    const delta = Math.abs(dayOfYear(y, month, day) - dayOfYear(y, bounds[i].m, bounds[i].d));
    if (delta <= D.dstNoteDays) {
      dstNote = 'The clocks ' + (i === 0 ? 'spring forward' : 'fall back') + ' on ' + MONTHS[bounds[i].m - 1] + ' ' + bounds[i].d + ', ' + y + '. Sunset jumps an hour that weekend; this card uses the ' + (dst ? 'EDT' : 'EST') + ' clock for your date.';
    }
  }
  return {
    month, day, year: y,
    sunset: sunsetMin,
    dusk,
    golden: sunsetMin - D.goldenHourBefore,
    label: dst ? 'EDT' : 'EST',
    dst, interpolated, overridden, dstNote,
    source: sunsetTable.source
  };
}

/* ---- clipboard, share, backup ------------------------------------------- */
export async function copyText(t) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; }
  } catch (e) { /* fall through to the selection copy */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

export async function share(title, t) {
  if (navigator.share) {
    try { await navigator.share({ title, text: t }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'canceled'; }
  }
  return (await copyText(t)) ? 'copied' : 'failed';
}

export function saveCopy(id, state) {
  const blob = new Blob([JSON.stringify({ tool: id, saved: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wedding101-' + id + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function loadCopy(id, file, cb) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const obj = JSON.parse(String(r.result));
      if (!obj || typeof obj !== 'object') return cb(null, 'That file is not a Wedding 101 copy.');
      if (obj.tool && obj.tool !== id) return cb(null, 'That copy is from the ' + obj.tool + ' tool, not this one.');
      const st = obj.state && typeof obj.state === 'object' ? obj.state : (obj.tool ? null : obj);
      if (!st) return cb(null, 'That file is not a Wedding 101 copy.');
      cb(st, null);
    } catch (e) { cb(null, 'Could not read that file.'); }
  };
  r.onerror = () => cb(null, 'Could not read that file.');
  r.readAsText(file);
}

/* ---- small UI helpers ---------------------------------------------------- */
let toastEl = null, toastTimer = null;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'w1-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
}

/* live(el) -> setter that updates the text without re-creating the node */
export function live(el) {
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  return (t) => { if (el.textContent !== t) el.textContent = t; };
}

/* warn(el, [{text, fix}]) renders the warnings list; the glyph is text, never color alone */
export function warn(el, list) {
  if (!list || !list.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = '<ul class="w1-warn">' + list.map(w =>
    '<li><span class="w1-glyph" aria-hidden="true">!</span><span><strong>' + esc(w.text) + '</strong>' + (w.fix ? ' ' + esc(w.fix) : '') + '</span></li>'
  ).join('') + '</ul>';
}

export function printPage(before) {
  if (before) before();
  plan.flush();
  window.print();
}

/* The build appends tools.css and print.css to site.css (spec 5.3). Until it does, link them
 * from here; tools.css sets --w101-css on :root, so this is a no-op once the build has them. */
export function ensureStyles() {
  try {
    if (getComputedStyle(document.documentElement).getPropertyValue('--w101-css').trim()) return false;
    const base = '/wedding101/tools/_shared/';
    for (const pair of [['tools.css', 'all'], ['print.css', 'print']]) {
      if (document.querySelector('link[href$="' + pair[0] + '"]')) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = base + pair[0];
      l.media = pair[1];
      document.head.appendChild(l);
    }
    return true;
  } catch (e) { return false; }
}

/* The "Saved on this phone" line under the title */
export function savedNote(el, st) {
  const paint = (ok, when) => {
    if (!st.available || ok === false) el.textContent = 'Saving is off in this browser. Print or save a copy before you leave.';
    else if (when) el.textContent = 'Saved on this phone at ' + time.format(when.getHours() * 60 + when.getMinutes()) + '. Nothing leaves it.';
    else el.textContent = 'Saved on this phone as you go. Nothing leaves it.';
  };
  paint(st.available ? undefined : false, null);
  st.onSaved(paint);
}

export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/* num(value, fallback): a number from an input, or the fallback when blank or unreadable */
export function num(v, d) {
  if (v === '' || v === null || v === undefined) return d;
  const n = Number(v);
  return isFinite(n) ? n : d;
}

/* peek(id): another tool's record, read once without creating a store for it */
export function peek(id) {
  try { const raw = localStorage.getItem(PREFIX + id); const v = raw ? JSON.parse(raw) : null; return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

const str = (v) => (v === undefined || v === null) ? '' : String(v).trim();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* the vendor rows live in the Team Sheet's own record; normalized to {role, name, cell, email, company} */
export function teamFromSheet() {
  const rec = peek('team-sheet');
  const rows = rec && Array.isArray(rec.rows) ? rec.rows : [];
  return rows.map(r => ({ role: str(r.role), name: str(r.contact) || str(r.name), cell: str(r.cell) || str(r.phone), email: str(r.email), company: str(r.company) }))
    .filter(t => t.role || t.name);
}

/* planFacts(raw): the plan read through one normalizer, so a tool never has to know which
 * builder wrote a fact or under what name (the key list is in the header). Every field is
 * present; a missing fact is null, '' or []. */
export function planFacts(raw) {
  const P = raw || plan.get() || {};
  const names = str(P.names) || [str(P.name1), str(P.name2)].filter(Boolean).join(' and ');
  let toasts = null;
  if (isObj(P.toasts)) {
    toasts = { count: num(P.toasts.count, null), minutes: num(P.toasts.minutes, null), total: num(P.toasts.total, null), placement: str(P.toasts.placement), blessing: !!P.toasts.blessing, openMic: num(P.toasts.openMic, 0), start: str(P.toasts.start) };
  } else if (P.toastsCount !== undefined || P.toastsMinutes !== undefined) {
    toasts = { count: num(P.toastsCount, null), minutes: null, total: num(P.toastsMinutes, null), placement: str(P.toastsPlacement), blessing: !!P.toastsBlessing, openMic: num(P.toastsOpenMic, 0), start: str(P.toastsStart) };
  }
  let parentDances = null;
  if (P.parentDances !== undefined && P.parentDances !== null && P.parentDances !== '') {
    const n = num(P.parentDances, null);
    if (n !== null) parentDances = { count: clamp(Math.round(n), 0, 2), shared: !!P.parentDancesShared };
    else if (typeof P.parentDances === 'string') parentDances = { count: P.parentDances === 'none' ? 0 : P.parentDances === 'one' ? 1 : 2, shared: P.parentDances === 'shared' };
  }
  const lastSong = isObj(P.lastSong) ? { style: str(P.lastSong.style), encore: !!P.lastSong.encore, circle: !!P.lastSong.circle, privateLastDance: !!P.lastSong.privateLastDance } : null;
  let planB = null;
  const pb = isObj(P.planB) ? P.planB : null;
  const hasRain = ['rainTrigger', 'rainLowTemp', 'rainDeadline', 'rainCaller', 'rainFlip', 'planBDecided'].some(k => P[k] !== undefined && P[k] !== '');
  if (pb || hasRain) {
    const trigger = num(pb && pb.trigger, num(P.rainTrigger, null));
    const lowTemp = num(P.rainLowTemp, null);
    const deadline = str(pb && pb.deadline) || str(P.rainDeadline);
    const caller = str(P.rainCaller);
    const flip = str(P.rainFlip) || str(pb && pb.flip);
    const lines = pb && Array.isArray(pb.lines) ? pb.lines.map(str).filter(Boolean) : [];
    if (!lines.length) {
      if (trigger !== null || lowTemp !== null) lines.push('The call: ' + (trigger !== null ? trigger + ' percent chance of rain' : '') + (trigger !== null && lowTemp !== null ? ', or ' : '') + (lowTemp !== null ? 'a forecast under ' + lowTemp + ' degrees' : '') + (caller ? '. ' + caller + ' decides' : '') + (deadline ? (caller ? ' by ' : '. Decided by ') + deadline : '') + '.');
      else if (caller || deadline) lines.push('The call: ' + [caller ? caller + ' decides' : '', deadline ? 'by ' + deadline : ''].filter(Boolean).join(' ') + '.');
      if (flip) lines.push('The flip: ' + flip);
    }
    planB = { trigger, lowTemp, deadline, caller, flip, decided: num(P.planBDecided, null), lines };
  }
  const point = isObj(P.pointPerson) && (str(P.pointPerson.name) || str(P.pointPerson.cell)) ? { name: str(P.pointPerson.name), cell: str(P.pointPerson.cell) } : null;
  const team = Array.isArray(P.team) && P.team.length
    ? P.team.map(t => ({ role: str(t && t.role), name: str(t && t.name), cell: str(t && t.cell), email: str(t && t.email), company: str(t && t.company) })).filter(t => t.role || t.name)
    : teamFromSheet();
  const events = Array.isArray(P.events) ? P.events.filter(e => e && e.id) : null;
  let eventPicks = isObj(P.eventPicks) ? Object.assign({}, P.eventPicks) : null;
  if (!eventPicks && events) { eventPicks = {}; for (const e of events) eventPicks[e.id] = e.pick; }
  if (!eventPicks && isObj(P.events)) eventPicks = Object.assign({}, P.events);
  return {
    names, date: str(P.date), venue: str(P.venue),
    guests: num(P.guests, num(P.guestCount, null)), guestCount: num(P.guestCount, null),
    ceremonyStart: str(P.ceremonyStart), ceremonyLen: num(P.ceremonyLen, null), musicEnd: str(P.musicEnd), outBy: str(P.outBy),
    dinnerStyle: str(P.dinnerStyle), dinnerMinutes: num(P.dinnerMinutes, null), tableRelease: str(P.tableRelease),
    firstLook: P.firstLook === undefined ? null : !!P.firstLook, outdoor: P.outdoor === undefined ? null : !!P.outdoor,
    sunsetPortraits: P.sunsetPortraits === undefined ? null : !!P.sunsetPortraits, sunsetOverride: str(P.sunsetOverride),
    runOfShow: isObj(P.runOfShow) ? P.runOfShow : null, toastsStart: str(P.toastsStart),
    toasts, entranceMinutes: num(P.entranceMinutes, null), parentDances, lastSong,
    anniversaryDance: P.anniversaryDance === undefined ? null : !!P.anniversaryDance,
    planB, pointPerson: point, vendorMeals: num(P.vendorMeals, null), venueAccess: str(P.venueAccess),
    dayRoles: isObj(P.roles) ? P.roles : null, team, events, eventPicks, songs: isObj(P.songs) ? P.songs : {},
    great: Array.isArray(P.great) ? P.great : null, stamps: isObj(P._w) ? P._w : {}
  };
}
