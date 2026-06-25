// ==UserScript==
// @name         Tatoeba - Flashcards (Sentence Mining)
// @namespace    https://tatoeba.org/
// @version      3.21
// @description  Flashcards tipo Anki sobre la búsqueda filtrada de Tatoeba (mobile + teclado)
// @icon         https://tatoeba.org/img/tatoeba.svg?1781334885
// @match        https://tatoeba.org/*/sentences/search*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ============ CONFIGURACIÓN ============ */
  const LIST_ID = 174916;

  const FETCH_DEFAULTS = {
    query: '', from: 'eng', to: 'spa', word_min: '2', word_max: '',
    user: '', original: true, orphans: 'no', unapproved: 'no', native: 'yes', has_audio: 'yes', tags: '', list: '',
    trans_filter: 'limit', trans_to: 'spa', trans_link: 'direct', trans_user: '',
    trans_orphan: '', trans_unapproved: 'no', trans_native: '', trans_has_audio: '',
    sort: 'random', sort_reverse: false,
  };
  const DISPLAY_DEFAULT = { front: 'spa', back: 'eng' };

  // Teclado (valor de event.key): Enter, ' ' (espacio), ';', '/', '.', ',', etc.
  const KEYS = {
    reveal: 'Enter',   // Enter: revela; y si ya está revelada, va a la siguiente
    next: "'",         // Siguiente oración
    prev: ';',         // Anterior oración
    audio: '/',        // Reproducir audio
    addList: '.',      // Agregar a la lista
    removeList: ',',   // Quitar de la lista
  };
  

  const TOP_ZONE_PERCENT = 45;
  const SIDE_ZONE_PERCENT = 30;
  const SWIPE_MIN = 55;
  const SWIPE_MAX_TIME = 600;
  const EDGE_GUARD = 30;

  const PREFETCH_AT = 4;
  const DARK_DEFAULT = false;
  const LIST_FETCHES_PER_PAGE = 3;
  const AUDIO_LANG = 'eng';   // el audio SIEMPRE se reproduce en este idioma, sin importar la config de display

  const LANGUAGES = [
    { code: 'spa', name: 'Español' }, { code: 'eng', name: 'Inglés' },
    { code: 'fra', name: 'Francés' }, { code: 'ita', name: 'Italiano' },
    { code: 'deu', name: 'Alemán' }, { code: 'por', name: 'Portugués' },
    { code: 'jpn', name: 'Japonés' }, { code: 'rus', name: 'Ruso' },
    { code: 'cmn', name: 'Chino mandarín' }, { code: 'kor', name: 'Coreano' },
  ];

  const LIST_DISPLAY_DEFAULT = { front: 'spa', back: 'eng' };

  const K = { filters: 'sm-fc-filters', display: 'sm-fc-display', listDisplay: 'sm-fc-list-display', open: 'sm-fc-open', dark: 'sm-fc-dark' };
  /* ====================================== */

  let filters = (() => {
    try { return Object.assign({}, FETCH_DEFAULTS, JSON.parse(localStorage.getItem(K.filters) || '{}')); }
    catch (e) { return Object.assign({}, FETCH_DEFAULTS); }
  })();
  const saveFilters = () => localStorage.setItem(K.filters, JSON.stringify(filters));

  let DISPLAY = (() => {
    try { return Object.assign({}, DISPLAY_DEFAULT, JSON.parse(localStorage.getItem(K.display) || '{}')); }
    catch (e) { return Object.assign({}, DISPLAY_DEFAULT); }
  })();
  const saveDisplay = () => localStorage.setItem(K.display, JSON.stringify(DISPLAY));

  let LIST_DISPLAY = (() => {
    try { return Object.assign({}, LIST_DISPLAY_DEFAULT, JSON.parse(localStorage.getItem(K.listDisplay) || '{}')); }
    catch (e) { return Object.assign({}, LIST_DISPLAY_DEFAULT); }
  })();
  const saveListDisplay = () => localStorage.setItem(K.listDisplay, JSON.stringify(LIST_DISPLAY));

  const langSeg = () => (location.pathname.match(/^\/([a-z]{2,3})\//) || [, 'es'])[1];
  const randomSeed = () => Math.random().toString(36).slice(2, 8);

  function makeIcon(name) {
    const i = document.createElement('span');
    i.className = 'material-icons'; i.textContent = name; i.setAttribute('aria-hidden', 'true'); return i;
  }

  // Toast INTEGRADO (no depende del script de notificaciones), animado y con tema.
  let toastEl, toastTimer;
  function toast(message, ok) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = ok ? 'show ok' : 'show err';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function getTextByLang(card, lang) {
    if (card.lang === lang) return { text: card.text, audios: card.audios || [], id: card.id, user: card.user && card.user.username };
    const all = [...((card.translations && card.translations[0]) || []), ...((card.translations && card.translations[1]) || [])];
    const t = all.find((x) => x.lang === lang);
    if (t) return { text: t.text, audios: t.audios || [], id: t.id, user: null };
    return null;
  }
  const frontOf = (c) => getTextByLang(c, DISPLAY.front) || { text: c.text, audios: c.audios || [], id: c.id, user: c.user && c.user.username };
  const backOf = (c) => getTextByLang(c, DISPLAY.back) || { text: '(sin traducción)', audios: [], id: null };

  /* ============ API ============ */

  function buildQuery() {
    const f = filters;
    const p = new URLSearchParams({ query: f.query || '', from: f.from, to: f.to, sort: f.sort || 'random', rand_seed: randomSeed() });
    if (f.word_min) p.set('word_count_min', f.word_min);
    if (f.word_max) p.set('word_count_max', f.word_max);
    if (f.user) p.set('user', f.user);
    if (f.original) p.set('original', 'yes');
    if (f.orphans) p.set('orphans', f.orphans);
    if (f.unapproved) p.set('unapproved', f.unapproved);
    if (f.native) p.set('native', f.native);
    if (f.has_audio) p.set('has_audio', f.has_audio);
    if (f.tags) p.set('tags', f.tags);
    if (f.list) p.set('list', f.list);
    if (f.trans_filter) p.set('trans_filter', f.trans_filter);
    if (f.trans_to) p.set('trans_to', f.trans_to);
    if (f.trans_link) p.set('trans_link', f.trans_link);
    if (f.trans_user) p.set('trans_user', f.trans_user);
    if (f.trans_orphan) p.set('trans_orphan', f.trans_orphan);
    if (f.trans_unapproved) p.set('trans_unapproved', f.trans_unapproved);
    if (f.trans_native) p.set('trans_native', f.trans_native);
    if (f.trans_has_audio) p.set('trans_has_audio', f.trans_has_audio);
    if (f.sort_reverse) p.set('sort_reverse', 'yes');
    return p.toString();
  }

  async function apiSearch(qs) {
    const res = await fetch(`/${langSeg()}/api_v0/search?${qs}`, { credentials: 'same-origin' });
    return res.json();
  }
  async function fetchOwner(id) {
    try { const r = await fetch(`/${langSeg()}/api_v0/sentence/${id}`, { credentials: 'same-origin' }); if (!r.ok) return null; const d = await r.json(); return (d && d.user && d.user.username) || null; }
    catch (e) { return null; }
  }

  // Rellena un <span> con el dueño de un texto. Usa el dato del payload si está; si no, lo trae (cache por id).
  const ownerCache = new Map();
  function fillOwner(span, t) {
    if (!span || !t) return;
    if (t.user) { span.textContent = t.user; return; }
    if (!t.id) { span.textContent = '—'; return; }
    if (ownerCache.has(t.id)) { span.textContent = ownerCache.get(t.id) || '—'; return; }
    span.innerHTML = '<span class="fc-dot-load"><i></i><i></i><i></i></span>';
    fetchOwner(t.id).then((o) => { ownerCache.set(t.id, o || ''); if (span.isConnected) span.textContent = o || '—'; });
  }

  // Resuelve el dueño como promesa (payload, cache o fetch) — para animar recién con el dato final.
  function resolveOwner(t) {
    if (!t) return Promise.resolve('');
    if (t.user) return Promise.resolve(t.user);
    if (!t.id) return Promise.resolve('');
    if (ownerCache.has(t.id)) return Promise.resolve(ownerCache.get(t.id));
    return fetchOwner(t.id).then((o) => { ownerCache.set(t.id, o || ''); return o || ''; });
  }

  /* ============ MAZO + HISTORIAL ============ */

  let cards = [], index = -1, fetching = false;
  const seenIds = new Set();
  const currentCard = () => cards[index] || null;

  async function fetchBatch() {
    const data = await apiSearch(buildQuery());
    let added = 0;
    for (const r of (data.results || [])) {
      if (!seenIds.has(r.id)) { seenIds.add(r.id); cards.push(r); added++; }
    }
    return added;
  }
  async function ensureBuffer(force) {
    if (!force && cards.length - 1 - index > PREFETCH_AT) return;
    if (fetching) return;
    fetching = true;
    try { let n = 0; while (await fetchBatch() === 0 && n++ < 3) {} }
    catch (e) { toast('Error trayendo oraciones', false); }
    finally { fetching = false; updateId(); }
  }
  async function next() {
    if (index >= cards.length - 1) await ensureBuffer(true);
    if (index < cards.length - 1) { index++; render(); ensureBuffer(); } else toast('Sin más oraciones', false);
  }
  const prev = () => { if (index > 0) { index--; render(); } else toast('Estás en la primera', false); };
  const jumpTo = (i) => { if (i >= 0 && i < cards.length) { index = i; render(); closePanels(); } };

  /* ============ ACCIONES ============ */

  // El audio (inglés) es spoiler si NO está en el frente -> se gatea hasta revelar.
  const audioGated = () => DISPLAY.front !== AUDIO_LANG && !revealed;

  let currentAudio = null, currentAudioUrl = null;   // reusa el audio para no re-bajarlo ni superponer

  function setAudioLoading(on) {
    const btn = barEl && barEl.querySelector('[data-act="audio"]');
    if (!btn) return;
    if (on) { btn.innerHTML = '<span class="fc-spin"></span>'; }
    else { btn.innerHTML = ''; btn.appendChild(makeIcon('volume_up')); }
  }

  function playAudio() {
    if (audioGated()) return;   // inglés en el dorso y sin revelar -> bloqueado (click, teclado y zona)
    const c = currentCard(); if (!c) return;
    const en = getTextByLang(c, AUDIO_LANG);   // SIEMPRE el audio en inglés, sin importar el display
    if (!en || !en.audios || !en.audios.length) {
      const name = (LANGUAGES.find((l) => l.code === AUDIO_LANG) || {}).name || AUDIO_LANG;
      toast(`No hay audio en ${name.toLowerCase()}`, false);
      return;
    }
    const url = en.audios[0].download_url;

    // Mismo audio ya cargado -> sólo reiniciar (sin re-fetch ni superponer).
    if (currentAudio && currentAudioUrl === url) {
      currentAudio.currentTime = 0;
      currentAudio.play().catch(() => {});
      return;
    }

    // Audio distinto -> cortamos el anterior y cargamos el nuevo.
    if (currentAudio) currentAudio.pause();
    const a = new Audio(url);
    currentAudio = a; currentAudioUrl = url;

    setAudioLoading(true);
    let done = false;
    const stop = (err) => { if (done) return; done = true; clearTimeout(timer); setAudioLoading(false); if (err) toast('No se pudo reproducir', false); };
    const timer = setTimeout(() => stop(false), 8000);   // red colgada -> liberamos el loader igual
    a.addEventListener('playing', () => stop(false), { once: true });
    a.addEventListener('error', () => stop(true), { once: true });
    a.play().catch(() => stop(true));
  }
  async function listById(endpoint, id, msg, err) {
    try { const r = await fetch(`/${langSeg()}/sentences_lists/${endpoint}/${id}/${LIST_ID}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      toast(r.ok ? `✓ Oración ${id} ${msg}` : 'No se pudo (¿logueado?)', r.ok); return r.ok;
    } catch (e) { toast(err, false); return false; }
  }
  const addCurrent = () => { const c = currentCard(); if (c) listById('add_sentence_to_list', c.id, 'agregada', 'Error al agregar'); };
  const removeCurrent = () => { const c = currentCard(); if (c) listById('remove_sentence_from_list', c.id, 'quitada', 'Error al quitar'); };

  /* ============ ESTILOS ============ */

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #fc-overlay { --bg:#fafafa; --fg:#222; --muted:#999; --card:#fff; --line:#eee;
        --btn:#ececec; --btnfg:#444; --accent:#4b8b3b; --back:#2e7d32;
        position:fixed; inset:0; z-index:2147483000; background:var(--bg); color:var(--fg);
        display:flex; flex-direction:column; font-family:sans-serif; }
      #fc-overlay.dark { --bg:#1c1c1e; --fg:#eaeaea; --muted:#888; --card:#2a2a2c; --line:#3a3a3c;
        --btn:#3a3a3c; --btnfg:#ddd; --back:#6bbf59; }
      #fc-overlay.hidden { display:none; }
      #fc-overlay .material-icons { line-height:1; font-size:inherit; color:inherit; display:block; }
      #fc-top { display:flex; align-items:center; gap:8px; padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px; }
      #fc-id { font-size:12px; color:var(--muted); font-weight:600; line-height:1.3; }
      .fc-dot-load { display:inline-flex; gap:3px; vertical-align:middle; }
      .fc-dot-load i { width:4px; height:4px; border-radius:50%; background:currentColor; opacity:.4; animation:fc-bounce 1s ease-in-out infinite; }
      .fc-dot-load i:nth-child(2) { animation-delay:.16s; }
      .fc-dot-load i:nth-child(3) { animation-delay:.32s; }
      .fc-spin { width:22px; height:22px; border:2.5px solid currentColor; border-top-color:transparent; border-radius:50%; opacity:.7; animation:fc-spin-rot .7s linear infinite; }
      @keyframes fc-spin-rot { to { transform:rotate(360deg); } }
      #fc-top .spacer { flex:1; }
      .fc-icon { width:42px; height:42px; border:none; border-radius:50%; background:var(--btn); color:var(--btnfg);
        cursor:pointer; display:inline-flex; align-items:center; justify-content:center; padding:0; flex:0 0 auto; }
      .fc-icon .material-icons { font-size:23px; }
      #fc-stage { position:relative; flex:1; }
      #fc-card { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
        justify-content:center; text-align:center; padding:22px; gap:16px; }
      #fc-front { font-size:26px; line-height:1.35; font-weight:600; }
      #fc-back { font-size:21px; line-height:1.35; color:var(--back); border-top:1px solid rgba(128,128,128,.35); padding-top:16px; }
      #fc-owners { font-size:12px; color:var(--muted); }
      #fc-hint { font-size:13px; color:var(--muted); opacity:.7; }
      .fc-dots::after { content:'•••'; letter-spacing:2px; animation:fc-blink 1.1s ease-in-out infinite; }
      @keyframes fc-blink { 0%,100%{opacity:.25} 50%{opacity:1} }
      #fc-loading { position:absolute; inset:0; display:none; flex-direction:column; align-items:center; justify-content:center; gap:18px; background:var(--bg); }
      #fc-loading.on { display:flex; }
      .fc-load-dots { display:flex; gap:12px; }
      .fc-load-dots span { width:13px; height:13px; border-radius:50%; background:var(--accent); animation:fc-bounce 1s ease-in-out infinite; }
      .fc-load-dots span:nth-child(2) { animation-delay:.16s; }
      .fc-load-dots span:nth-child(3) { animation-delay:.32s; }
      @keyframes fc-bounce { 0%,80%,100% { transform:scale(.5); opacity:.4 } 40% { transform:scale(1); opacity:1 } }
      #fc-loading .lbl { font-size:13px; color:var(--muted); animation:fc-blink 1.4s ease-in-out infinite; }
      #fc-zones { position:absolute; inset:0; display:none; flex-direction:column; }
      #fc-zones.on { display:flex; }
      .fc-zone { border:none; background:transparent; padding:0; cursor:pointer; -webkit-tap-highlight-color:transparent; }
      .fc-zrow { display:flex; flex:1; }
      #fc-bar { display:flex; gap:8px; padding:10px; padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px);
        background:var(--card); border-top:1px solid var(--line); }
      .fc-btn { flex:1; height:46px; border:none; border-radius:10px; background:var(--btn); color:var(--btnfg);
        cursor:pointer; display:flex; align-items:center; justify-content:center; }
      .fc-btn .material-icons { font-size:26px; }
      .fc-btn:disabled { opacity:.3; }
      .fc-btn.fc-primary { background:var(--accent); color:#fff; }
      #fc-toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 78px);
        transform:translateX(-50%) translateY(16px); z-index:2147483700; padding:10px 18px; border-radius:22px;
        font-size:14px; color:#fff; box-shadow:0 4px 16px rgba(0,0,0,.35); opacity:0; pointer-events:none;
        max-width:86vw; text-align:center; transition:opacity .25s ease, transform .25s ease; }
      #fc-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
      #fc-toast.ok { background:var(--accent,#4b8b3b); }
      #fc-toast.err { background:#c62828; }
      #fc-launcher { position:fixed; right:16px; bottom:calc(env(safe-area-inset-bottom,0px) + 16px); z-index:2147483000;
        width:52px; height:52px; border:none; border-radius:50%; background:#4b8b3b; color:#fff;
        box-shadow:0 3px 10px rgba(0,0,0,.3); cursor:pointer; display:none; align-items:center; justify-content:center; }
      #fc-launcher.show { display:flex; }
      .fc-panel { position:fixed; top:0; right:0; height:100%; width:min(88vw,380px); z-index:2147483500;
        background:var(--bg,#fff); color:var(--fg,#222); transform:translateX(100%); transition:transform .25s ease;
        display:flex; flex-direction:column; box-shadow:-2px 0 12px rgba(0,0,0,.2); }
      .fc-panel.open { transform:translateX(0); }
      .fc-panel header { display:flex; align-items:center; gap:8px; padding:calc(env(safe-area-inset-top,0px) + 14px) 14px 14px;
        border-bottom:1px solid var(--line,#eee); font-weight:600; }
      .fc-panel header .spacer { flex:1; }
      .fc-panel .body { flex:1; overflow:auto; padding:8px 12px; }
      .fc-row { padding:12px 6px; border-bottom:1px solid var(--line,#f0f0f0); font-size:14px; }
      .fc-row .es { font-weight:600; } .fc-row .en { color:var(--back,#2e7d32); font-size:13px; }
      .fc-row .meta { color:var(--muted,#999); font-size:12px; margin-top:2px; }
      .fc-row .acts { display:flex; gap:8px; margin-top:6px; }
      .fc-row .acts button { border:none; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }
      .fc-row .acts .rm { background:#fde7e7; color:#c62828; } .fc-row .acts .go { background:#e8f0e6; color:#2e7d32; }
      .fc-list-ctrls { display:flex; flex-direction:column; gap:8px; padding:4px 4px 12px; border-bottom:1px solid var(--line); margin-bottom:6px; }
      .fc-list-ctrls label { font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:3px; }
      .fc-list-ctrls select { padding:7px; border:1px solid #bbb; border-radius:6px; font-size:14px; background:var(--card); color:var(--fg); }
      .fc-list-load { display:flex; flex-direction:column; align-items:center; gap:14px; padding:44px 0; }
      .fc-list-load .lbl { font-size:13px; color:var(--muted); animation:fc-blink 1.4s ease-in-out infinite; }
      .fc-pager { display:flex; align-items:center; justify-content:center; gap:16px; padding:14px; color:var(--muted); font-size:13px; }
      .fc-pager .pg { width:40px; height:40px; border:none; border-radius:50%; background:var(--btn); color:var(--btnfg);
        cursor:pointer; display:flex; align-items:center; justify-content:center; }
      .fc-pager .pg:disabled { opacity:.3; }
      #fc-modal { position:fixed; inset:0; z-index:2147483600; display:none; background:rgba(0,0,0,.5); align-items:center; justify-content:center; }
      #fc-modal.open { display:flex; }
      #fc-modal .box { background:var(--bg,#fff); color:var(--fg,#222); border-radius:12px; padding:18px; width:min(92vw,400px);
        max-height:88vh; overflow:auto; display:flex; flex-direction:column; gap:10px; font-size:14px; }
      #fc-modal h4 { margin:6px 0 0; border-bottom:1px solid var(--line,#eee); padding-bottom:4px; }
      #fc-modal label { display:flex; flex-direction:column; gap:3px; }
      #fc-modal .row { display:flex; align-items:center; gap:8px; }
      #fc-modal select, #fc-modal input { padding:8px; border:1px solid #bbb; border-radius:6px; font-size:15px;
        background:var(--card,#fff); color:var(--fg,#222); }
      #fc-modal .actions { display:flex; gap:8px; margin-top:8px; position:sticky; bottom:0; background:var(--bg,#fff); padding-top:8px; }
      #fc-modal .actions button { flex:1; height:42px; border:none; border-radius:8px; cursor:pointer; font-size:15px; }
      #fc-apply { background:var(--accent,#4b8b3b); color:#fff; } #fc-cancel { background:#ddd; color:#333; }
    `;
    document.head.appendChild(s);
  }

  /* ============ UI PRINCIPAL ============ */

  let overlay, frontEl, backEl, ownersEl, hintEl, idEl, barEl, zonesEl, launcher;
  let revealed = false, lastTouch = 0, uiBlocked = false;

  function iconBtn(act, icon, title, cls) {
    const b = document.createElement('button'); b.className = cls || 'fc-btn';
    b.dataset.act = act; b.title = title; b.setAttribute('aria-label', title); b.appendChild(makeIcon(icon)); return b;
  }

  function buildUI() {
    overlay = document.createElement('div'); overlay.id = 'fc-overlay';
    const darkSaved = localStorage.getItem(K.dark);
    if (darkSaved === '1' || (darkSaved === null && DARK_DEFAULT)) overlay.classList.add('dark');

    const top = document.createElement('div'); top.id = 'fc-top';
    idEl = document.createElement('div'); idEl.id = 'fc-id'; idEl.textContent = '…';
    const sp = document.createElement('div'); sp.className = 'spacer';
    top.append(idEl, sp,
      iconBtn('dark', 'brightness_2', 'Modo oscuro', 'fc-icon'),
      iconBtn('history', 'history', 'Historial', 'fc-icon'),
      iconBtn('list', 'list', 'Mi lista', 'fc-icon'),
      iconBtn('filters', 'tune', 'Filtros', 'fc-icon'),
      iconBtn('exit', 'close', 'Salir', 'fc-icon'));

    const stage = document.createElement('div'); stage.id = 'fc-stage';
    const card = document.createElement('div'); card.id = 'fc-card';
    frontEl = document.createElement('div'); frontEl.id = 'fc-front'; frontEl.textContent = '';
    backEl = document.createElement('div'); backEl.id = 'fc-back';
    ownersEl = document.createElement('div'); ownersEl.id = 'fc-owners';
    hintEl = document.createElement('div'); hintEl.id = 'fc-hint'; hintEl.textContent = 'Tocá para revelar';
    card.append(frontEl, backEl, ownersEl, hintEl);

    zonesEl = document.createElement('div'); zonesEl.id = 'fc-zones';
    const ztop = document.createElement('button'); ztop.className = 'fc-zone'; ztop.dataset.act = 'audio';
    ztop.style.height = TOP_ZONE_PERCENT + '%'; ztop.title = 'Audio';
    const zrow = document.createElement('div'); zrow.className = 'fc-zrow';
    const zl = document.createElement('button'); zl.className = 'fc-zone'; zl.dataset.act = 'next'; zl.style.flex = `0 0 ${SIDE_ZONE_PERCENT}%`;
    const zm = document.createElement('button'); zm.className = 'fc-zone'; zm.dataset.act = 'add'; zm.style.flex = '1';
    const zr = document.createElement('button'); zr.className = 'fc-zone'; zr.dataset.act = 'next'; zr.style.flex = `0 0 ${SIDE_ZONE_PERCENT}%`;
    zrow.append(zl, zm, zr); zonesEl.append(ztop, zrow);

    const loading = document.createElement('div'); loading.id = 'fc-loading';
    loading.innerHTML = '<div class="fc-load-dots"><span></span><span></span><span></span></div><div class="lbl">Cargando oraciones…</div>';
    stage.append(card, zonesEl, loading);

    barEl = document.createElement('div'); barEl.id = 'fc-bar';
    barEl.append(iconBtn('prev', 'chevron_left', 'Anterior'), iconBtn('audio', 'volume_up', 'Audio'),
      iconBtn('add', 'playlist_add', 'Agregar'), iconBtn('remove', 'remove_circle_outline', 'Quitar'),
      iconBtn('next', 'chevron_right', 'Siguiente', 'fc-btn fc-primary'));

    toastEl = document.createElement('div'); toastEl.id = 'fc-toast';

    overlay.append(top, stage, barEl, toastEl);
    document.body.appendChild(overlay);

    if (overlay.classList.contains('dark')) overlay.querySelector('[data-act="dark"] .material-icons').textContent = 'wb_sunny';

    launcher = document.createElement('button'); launcher.id = 'fc-launcher'; launcher.title = 'Estudiar';
    launcher.appendChild(makeIcon('style')); launcher.addEventListener('click', () => setOpen(true));
    document.body.appendChild(launcher);

    overlay.addEventListener('click', (e) => {
      // Si fue un toque reciente sobre la carta/zonas, ya lo resolvió touchend -> no duplicar.
      if (e.target.closest('#fc-stage') && Date.now() - lastTouch < 600) return;
      const b = e.target.closest('button[data-act]');
      if (b) { handleAction(b.dataset.act); return; }
      if (e.target.closest('#fc-card') && !revealed) reveal();
    });

    buildModal(); buildPanels(); setupGestures(); setupKeyboard();
  }

  function handleAction(act) {
    ({ prev, next, audio: playAudio, add: addCurrent, remove: removeCurrent,
       filters: openModal, history: openHistory, list: openList, exit: () => setOpen(false),
       dark: toggleDark }[act] || (() => {}))();
  }

  // Resuelve un tap (zona transparente o carta) sin depender del click sintético, que iOS cancela.
  function handleTap(target) {
    const b = target.closest && target.closest('button[data-act]');
    if (b) { handleAction(b.dataset.act); return; }
    if (target.closest && target.closest('#fc-card') && !revealed) reveal();
  }

  function updateId() {
    const c = currentCard(); if (!idEl) return;
    if (!c) { idEl.innerHTML = '…'; return; }
    const f = frontOf(c), b = backOf(c);
    idEl.innerHTML = `<div>Oración #${f.id || '—'}</div><div>Traducción #${b.id || '—'}${fetching ? ' …' : ''}</div>`;
  }

  function showLoading(on) {
    const el = document.getElementById('fc-loading');
    if (el) el.classList.toggle('on', on);
  }

  function render() {
    const c = currentCard();
    if (!c) { showLoading(true); frontEl.textContent = ''; backEl.textContent = ''; ownersEl.textContent = ''; return; }
    showLoading(false);
    revealed = false; zonesEl.classList.remove('on');
    const f = frontOf(c), b = backOf(c);
    frontEl.textContent = f.text;
    backEl.textContent = b.text;
    backEl.style.visibility = 'hidden';            // reservado: el reverso no mueve nada al revelar
    ownersEl.innerHTML = `Oración: <span id="fc-fo"></span><span id="fc-tw"></span>`;
    ownersEl.style.transition = ''; ownersEl.style.transform = '';   // reset de la animación
    fillOwner(ownersEl.querySelector('#fc-fo'), f);   // dueño del frente
    hintEl.style.visibility = 'visible';
    updateId(); updateBar();
  }

  // FLIP horizontal de la línea de dueños: animar su corrimiento desde 'fromLeft' hasta su lugar actual.
  function flipOwners(fromLeft) {
    const dx = fromLeft - ownersEl.getBoundingClientRect().left;
    if (!dx) return;
    ownersEl.style.transition = 'none';
    ownersEl.style.transform = `translateX(${dx}px)`;
    void ownersEl.offsetWidth;   // reflow forzado: fija el estado inicial antes de animar
    ownersEl.style.transition = 'transform .28s ease';
    ownersEl.style.transform = 'translateX(0)';
  }

  function reveal() {
    const c = currentCard(); if (!c || revealed) return;
    const oldLeft = ownersEl.getBoundingClientRect().left;
    revealed = true;
    backEl.style.visibility = 'visible';
    hintEl.style.visibility = 'hidden';
    zonesEl.classList.add('on');
    updateBar();

    const tw = ownersEl.querySelector('#fc-tw'); if (!tw) return;
    const back = backOf(c);
    const cached = back && back.user ? back.user
      : (back && back.id && ownerCache.has(back.id)) ? (ownerCache.get(back.id) || '—') : null;

    if (cached !== null) {
      // Ya tenemos el dueño -> una sola animación con el nombre final.
      tw.textContent = ` · Traducción: ${cached}`;
      flipOwners(oldLeft);
    } else {
      // No está -> mostramos puntitos y animamos YA (al tap); al llegar el nombre, segundo FLIP suave.
      tw.innerHTML = ' · Traducción: <span id="fc-to"><span class="fc-dot-load"><i></i><i></i><i></i></span></span>';
      flipOwners(oldLeft);
      resolveOwner(back).then((owner) => {
        if (!revealed || currentCard() !== c) return;   // cambió de carta mientras cargaba
        const to = ownersEl.querySelector('#fc-to'); if (!to) return;
        const before = ownersEl.getBoundingClientRect().left;
        to.textContent = owner || '—';
        flipOwners(before);   // ajusta el ancho (puntitos -> nombre) suavemente
      });
    }
  }

  function updateBar() {
    barEl.querySelectorAll('.fc-btn').forEach((x) => {
      // El audio se desactiva sólo si es spoiler (inglés en el dorso sin revelar); el resto siempre activo.
      x.disabled = x.dataset.act === 'audio' && audioGated();
    });
  }

  function toggleDark() {
    const on = !overlay.classList.contains('dark');
    overlay.classList.toggle('dark', on);
    localStorage.setItem(K.dark, on ? '1' : '0');
    const ic = overlay.querySelector('[data-act="dark"] .material-icons');
    if (ic) ic.textContent = on ? 'wb_sunny' : 'brightness_2';
  }

  /* ============ PANELES ============ */

  let historyPanel, listPanel, listPage = 1;
  function buildPanels() { historyPanel = makePanel('Historial'); listPanel = makePanel('Mi lista'); }
  function makePanel(title) {
    const p = document.createElement('div'); p.className = 'fc-panel';
    const h = document.createElement('header');
    const t = document.createElement('div'); t.textContent = title;
    const s = document.createElement('div'); s.className = 'spacer';
    const c = iconBtn('x', 'close', 'Cerrar', 'fc-icon'); c.addEventListener('click', () => { p.classList.remove('open'); uiBlocked = false; });
    h.append(t, s, c);
    const body = document.createElement('div'); body.className = 'body';
    p.append(h, body); document.body.appendChild(p); p._body = body; return p;
  }
  function closePanels() { historyPanel.classList.remove('open'); listPanel.classList.remove('open'); uiBlocked = false; }

  function openHistory() {
    const body = historyPanel._body; body.innerHTML = '';
    for (let i = index; i >= 0; i--) {
      const c = cards[i]; const f = frontOf(c);
      const row = document.createElement('div'); row.className = 'fc-row'; row.style.cursor = 'pointer';
      row.innerHTML = `<div class="es">#${c.id} — ${f.text}</div>`;
      row.addEventListener('click', () => jumpTo(i)); body.appendChild(row);
    }
    if (!body.children.length) body.textContent = 'Todavía no viste ninguna.';
    uiBlocked = true; historyPanel.classList.add('open');
  }

  function listControls() {
    const wrap = document.createElement('div'); wrap.className = 'fc-list-ctrls';
    wrap.innerHTML = `<label>Oraciones en:<select id="ld-front">${langOpts(LIST_DISPLAY.front)}</select></label>` +
                     `<label>Mostrar traducciones en:<select id="ld-back">${langOpts(LIST_DISPLAY.back)}</select></label>`;
    wrap.querySelector('#ld-front').addEventListener('change', (e) => { LIST_DISPLAY.front = e.target.value; saveListDisplay(); listPage = 1; loadListPage(); });
    wrap.querySelector('#ld-back').addEventListener('change', (e) => { LIST_DISPLAY.back = e.target.value; saveListDisplay(); listPage = 1; loadListPage(); });
    return wrap;
  }

  function openList() { listPage = 1; uiBlocked = true; listPanel.classList.add('open'); loadListPage(); }

  async function loadListPage() {
    const body = listPanel._body; body.innerHTML = '';
    body.appendChild(listControls());
    const area = document.createElement('div'); area.id = 'fc-list-area';
    area.innerHTML = '<div class="fc-list-load"><div class="fc-load-dots"><span></span><span></span><span></span></div><div class="lbl">Cargando lista…</div></div>';
    body.appendChild(area);
    try {
      const startApi = (listPage - 1) * LIST_FETCHES_PER_PAGE + 1;
      const all = []; let hasNext = false;
      for (let i = 0; i < LIST_FETCHES_PER_PAGE; i++) {
        const p = new URLSearchParams({ list: String(LIST_ID), to: LIST_DISPLAY.back, trans_to: LIST_DISPLAY.back, trans_filter: 'limit', page: String(startApi + i), sort: 'id', direction: 'desc' });
        const data = await apiSearch(p.toString());
        all.push(...(data.results || []));
        hasNext = !!(data.paging && data.paging.Sentences && data.paging.Sentences.nextPage);
        if (!hasNext) break;
      }
      renderListPage(area, all, hasNext);
    } catch (e) { area.textContent = 'Error cargando la lista.'; }
  }

  function renderListPage(area, all, hasNext) {
    area.innerHTML = '';
    if (!all.length) area.textContent = listPage === 1 ? 'La lista está vacía.' : 'No hay más oraciones.';
    for (const c of all) {
      const ft = getTextByLang(c, LIST_DISPLAY.front) || { text: c.text, id: c.id, user: c.user && c.user.username };
      const bt = getTextByLang(c, LIST_DISPLAY.back) || { text: '', id: null };
      const row = document.createElement('div'); row.className = 'fc-row';
      row.innerHTML = `<div class="meta">Oración #${ft.id || '—'} · <span class="fo"></span></div>
        <div class="es">${ft.text}</div>
        <div class="en">${bt.text}</div>
        <div class="meta">Traducción #${bt.id || '—'}</div>
        <div class="acts"><button class="go">Abrir</button><button class="rm">Quitar</button></div>`;
      fillOwner(row.querySelector('.fo'), ft);
      row.querySelector('.go').addEventListener('click', () => window.open(`/${langSeg()}/sentences/show/${c.id}`, '_blank'));
      row.querySelector('.rm').addEventListener('click', async () => { if (await listById('remove_sentence_from_list', c.id, 'quitada', 'Error')) row.remove(); });
      area.appendChild(row);
    }
    const pager = document.createElement('div'); pager.className = 'fc-pager';
    const pb = iconBtn('p-prev', 'chevron_left', 'Anterior', 'pg'); pb.disabled = listPage <= 1;
    const nb = iconBtn('p-next', 'chevron_right', 'Siguiente', 'pg'); nb.disabled = !hasNext;
    const from = (listPage - 1) * 30 + 1, to = (listPage - 1) * 30 + all.length;
    const info = document.createElement('span'); info.textContent = all.length ? `${from}–${to}` : `Pág. ${listPage}`;
    pb.addEventListener('click', () => { if (listPage > 1) { listPage--; loadListPage(); } });
    nb.addEventListener('click', () => { if (hasNext) { listPage++; loadListPage(); } });
    pager.append(pb, info, nb); area.appendChild(pager); listPanel._body.scrollTop = 0;
  }

  /* ============ MODAL DE FILTROS ============ */

  const langOpts = (sel, anyLabel) => (anyLabel ? `<option value="">${anyLabel}</option>` : '') +
    LANGUAGES.map((l) => `<option value="${l.code}" ${l.code === sel ? 'selected' : ''}>${l.name}</option>`).join('');
  const tri = (id, val) => { const o = (v, t) => `<option value="${v}" ${val === v ? 'selected' : ''}>${t}</option>`;
    return `<select id="${id}">${o('', 'Es indistinto')}${o('yes', 'Sí')}${o('no', 'No')}</select>`; };

  function buildModal() {
    const m = document.createElement('div'); m.id = 'fc-modal';
    const f = filters;
    const linkSel = (id, v) => { const o = (val, t) => `<option value="${val}" ${v === val ? 'selected' : ''}>${t}</option>`;
      return `<select id="${id}">${o('', 'Es indistinto')}${o('direct', 'Directo')}${o('indirect', 'Indirecto')}</select>`; };
    m.innerHTML = `<div class="box">
      <strong>Filtros</strong>
      <h4>Oraciones</h4>
      <label>Palabras:<input type="text" id="f-query" value="${f.query || ''}" placeholder="Escriba una palabra o una frase"></label>
      <label>Idioma:<select id="f-from">${langOpts(f.from)}</select></label>
      <label>Mostrar traducciones en:<select id="f-to">${langOpts(f.to)}</select></label>
      <div class="row"><span>Length:</span> At least <input type="number" id="f-wmin" value="${f.word_min}" style="width:60px"> At most <input type="number" id="f-wmax" value="${f.word_max}" style="width:60px"></div>
      <label>Dueño:<input type="text" id="f-user" value="${f.user || ''}" placeholder="nombre de usuario"></label>
      <div class="row"><input type="checkbox" id="f-original" ${f.original ? 'checked' : ''}><span>Is original</span></div>
      <label>Es huérfana: ${tri('f-orphans', f.orphans)}</label>
      <label>Está reprobada: ${tri('f-unapproved', f.unapproved)}</label>
      <label>Is owned by a native: ${tri('f-native', f.native)}</label>
      <label>Tiene voz: ${tri('f-audio', f.has_audio)}</label>
      <label>Etiquetas:<input type="text" id="f-tags" value="${f.tags || ''}" placeholder="separadas por comas"></label>
      <label>Pertenece a la lista (ID, opcional):<input type="text" id="f-list" value="${f.list || ''}" placeholder="Sin especificar"></label>
      <h4>Traducciones</h4>
      <label>Restringir a:<select id="f-tfilter"><option value="limit" ${f.trans_filter === 'limit' ? 'selected' : ''}>Restringir a</option><option value="exclude" ${f.trans_filter === 'exclude' ? 'selected' : ''}>Excluir</option><option value="" ${!f.trans_filter ? 'selected' : ''}>No filtrar</option></select></label>
      <label>Idioma:<select id="f-tto">${langOpts(f.trans_to, 'Cualquier idioma')}</select></label>
      <label>Enlace: ${linkSel('f-tlink', f.trans_link)}</label>
      <label>Dueño:<input type="text" id="f-tuser" value="${f.trans_user || ''}" placeholder="nombre de usuario"></label>
      <label>Es huérfana: ${tri('f-torphan', f.trans_orphan)}</label>
      <label>Está reprobada: ${tri('f-tunap', f.trans_unapproved)}</label>
      <label>Is owned by a native: ${tri('f-tnative', f.trans_native)}</label>
      <label>Tiene voz: ${tri('f-thas', f.trans_has_audio)}</label>
      <h4>Ordenación</h4>
      <label>Orden:<select id="f-sort">
        <option value="random" ${f.sort === 'random' ? 'selected' : ''}>Al azar</option>
        <option value="relevance" ${f.sort === 'relevance' ? 'selected' : ''}>Relevancia</option>
        <option value="words" ${f.sort === 'words' ? 'selected' : ''}>Palabras</option>
        <option value="created" ${f.sort === 'created' ? 'selected' : ''}>Fecha de creación</option></select></label>
      <div class="row"><input type="checkbox" id="f-reverse" ${f.sort_reverse ? 'checked' : ''}><span>En orden inverso</span></div>
      <h4>Visualización (app y lista)</h4>
      <label>Mostrar primero (frente):<select id="d-front">${langOpts(DISPLAY.front)}</select></label>
      <label>Luego (reverso):<select id="d-back">${langOpts(DISPLAY.back)}</select></label>
      <div class="actions"><button id="fc-cancel">Cancelar</button><button id="fc-apply">Aplicar</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    m.querySelector('#fc-cancel').addEventListener('click', closeModal);
    m.querySelector('#fc-apply').addEventListener('click', () => {
      const g = (id) => m.querySelector(id);
      filters = {
        query: g('#f-query').value.trim(), from: g('#f-from').value, to: g('#f-to').value,
        word_min: g('#f-wmin').value, word_max: g('#f-wmax').value, user: g('#f-user').value.trim(),
        original: g('#f-original').checked, orphans: g('#f-orphans').value, unapproved: g('#f-unapproved').value,
        native: g('#f-native').value, has_audio: g('#f-audio').value, tags: g('#f-tags').value.trim(), list: g('#f-list').value.trim(),
        trans_filter: g('#f-tfilter').value, trans_to: g('#f-tto').value, trans_link: g('#f-tlink').value, trans_user: g('#f-tuser').value.trim(),
        trans_orphan: g('#f-torphan').value, trans_unapproved: g('#f-tunap').value, trans_native: g('#f-tnative').value,
        trans_has_audio: g('#f-thas').value, sort: g('#f-sort').value, sort_reverse: g('#f-reverse').checked,
      };
      DISPLAY = { front: g('#d-front').value, back: g('#d-back').value };
      saveFilters(); saveDisplay(); closeModal(); resetDeck();
    });
  }
  const openModal = () => { uiBlocked = true; document.getElementById('fc-modal').classList.add('open'); };
  const closeModal = () => { uiBlocked = false; document.getElementById('fc-modal').classList.remove('open'); };

  async function resetDeck() {
    cards = []; index = -1; seenIds.clear();
    showLoading(true);
    frontEl.textContent = ''; backEl.textContent = ''; ownersEl.textContent = '';
    await ensureBuffer(true);
    if (cards.length) { index = 0; render(); ensureBuffer(); }
    else { showLoading(false); toast('Sin resultados con esos filtros', false); }
  }

  /* ============ SALIR / ENTRAR ============ */
  const isOpen = () => localStorage.getItem(K.open) !== '0';
  function setOpen(v) { localStorage.setItem(K.open, v ? '1' : '0'); overlay.classList.toggle('hidden', !v); launcher.classList.toggle('show', !v); }

  /* ============ GESTOS ============ */
  function setupGestures() {
    let sx = 0, sy = 0, st = 0, tracking = false;
    window.addEventListener('touchstart', (e) => {
      if (uiBlocked || !isOpen() || e.touches.length !== 1) { tracking = false; return; }
      if (!e.target.closest('#fc-stage')) { tracking = false; return; }
      const t = e.touches[0];
      if (t.clientX <= EDGE_GUARD || t.clientX >= window.innerWidth - EDGE_GUARD) { tracking = false; return; }
      sx = t.clientX; sy = t.clientY; st = Date.now(); tracking = true;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx < 10 && ady < 10) return;          // todavía no es gesto
      if (ady > adx && dy > 0) return;           // deslizá hacia ABAJO -> lo deja para el pull-to-refresh nativo de iOS
      if (e.cancelable) e.preventDefault();       // bloquea horizontal y hacia ARRIBA -> página fija
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      lastTouch = Date.now();
      if (!tracking) return; tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > SWIPE_MAX_TIME) return;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx < SWIPE_MIN && ady < SWIPE_MIN) { handleTap(e.target); return; } // tap -> resuelto acá (iOS)
      if (adx > ady) { if (dx < 0) next(); else prev(); }                      // ← siguiente · → anterior
      else if (dy < 0) removeCurrent();                                         // ↑ quitar  (↓ = recarga nativa, no la tocamos)
    }, { passive: true });
  }

  /* ============ TECLADO ============ */
  function setupKeyboard() {
    const actions = {
      [KEYS.reveal]: () => { if (!revealed) reveal(); else next(); },
      [KEYS.next]: next,
      [KEYS.prev]: prev,
      [KEYS.audio]: playAudio,
      [KEYS.addList]: addCurrent,
      [KEYS.removeList]: removeCurrent,
    };
    document.addEventListener('keydown', (e) => {
      if (!isOpen() || uiBlocked) return;
      const el = document.activeElement;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = actions[e.key];
      if (!a) return;
      e.preventDefault();
      a();
    });
  }

  /* ============ ARRANQUE ============ */
  injectStyles();
  buildUI();
  setOpen(isOpen());
  resetDeck();
}());
