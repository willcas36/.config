// ==UserScript==
// @name         Tatoeba - Flashcards (Sentence Mining)
// @namespace    https://tatoeba.org/
// @version      4.20
// @description  Flashcards tipo Anki sobre la búsqueda filtrada de Tatoeba (mobile + teclado)
// @icon         https://tatoeba.org/img/tatoeba.svg?1781334885
// @match        https://tatoeba.org/*/sentences/search*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ============ CONFIGURACIÓN ============ */
  let LIST_ID = localStorage.getItem('sm-fc-listid') || '174916';   // lista objetivo (editable en el modal)

  const FETCH_DEFAULTS = {
    query: '', from: 'eng', word_min: '2', word_max: '',
    user: '', origin: 'original', orphans: 'no', unapproved: 'no', native: 'yes', has_audio: 'yes', tags: '', list: '',
    trans_to: 'spa', trans_link: 'direct', trans_user: '',
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
    list: '[',         // (modo ordenador) alterna abrir/cerrar Mi lista
    history: ']',      // (modo ordenador) alterna abrir/cerrar Historial
  };
  

  const TOP_ZONE_PERCENT = 45;
  const SIDE_ZONE_PERCENT = 30;
  const SWIPE_MIN = 55;
  const SWIPE_MAX_TIME = 600;
  const EDGE_GUARD = 30;

  const PREFETCH_AT = 4;
  const DARK_DEFAULT = false;
  let AUDIO_LANG = localStorage.getItem('sm-fc-audiolang') || 'eng';   // idioma del audio (editable en el modal)
  let DESKTOP_MODE = localStorage.getItem('sm-fc-desktop') === '1';   // PC: paneles laterales que empujan + atajos [ ]
  const API_BASE = 'https://api.tatoeba.org/v1';   // API oficial ESTABLE y versionada (no /unstable, que cambia)

  const LANGUAGES = [
    { code: 'spa', name: 'Español' }, { code: 'eng', name: 'Inglés' },
    { code: 'fra', name: 'Francés' }, { code: 'ita', name: 'Italiano' },
    { code: 'deu', name: 'Alemán' }, { code: 'por', name: 'Portugués' },
    { code: 'jpn', name: 'Japonés' }, { code: 'rus', name: 'Ruso' },
    { code: 'cmn', name: 'Chino mandarín' }, { code: 'kor', name: 'Coreano' },
  ];

  // Idiomas para "Mi lista" (amplio: la lista puede tener oraciones de cualquier idioma). Agregá códigos si te falta alguno.
  const LIST_LANGS = 'spa,eng,fra,ita,deu,por,jpn,rus,cmn,kor,epo,nld,tur,pol,ukr,heb,ara,fin,hun,ces,swe,ell,ron,lat,cat,ind,vie,dan,nob,lit';

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
  let listSort = localStorage.getItem('sm-fc-listsort') || '-created';   // orden de "Mi lista" (sort de la API)

  const langSeg = () => (location.pathname.match(/^\/([a-z]{2,3})\//) || [, 'es'])[1];

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

  // En la API nueva el dueño viene como string `owner` (no `user.username`) y las traducciones son un array PLANO.
  function getTextByLang(card, lang) {
    if (card.lang === lang) return { text: card.text, audios: card.audios || [], id: card.id, owner: card.owner };
    const t = (card.translations || []).find((x) => x.lang === lang);
    if (t) return { text: t.text, audios: t.audios || [], id: t.id, owner: t.owner };
    return null;
  }
  const frontOf = (c) => getTextByLang(c, DISPLAY.front) || { text: c.text, audios: c.audios || [], id: c.id, owner: c.owner };
  const backOf = (c) => getTextByLang(c, DISPLAY.back) || { text: '(sin traducción)', audios: [], id: null, owner: null };

  /* ============ API (api.tatoeba.org) ============ */

  function wordRange(min, max) {
    min = (min == null ? '' : String(min)).trim();
    max = (max == null ? '' : String(max)).trim();
    return (min || max) ? `${min}-${max}` : '';   // "2-15", "2-", "-15"
  }

  function buildQuery() {
    const f = filters;
    const p = new URLSearchParams();
    p.set('lang', f.from);                                   // from -> lang
    p.set('sort', (f.sort_reverse ? '-' : '') + (f.sort || 'random'));   // sort_reverse -> prefijo '-'
    p.set('showtrans', 'matching');                          // mostrar solo las traducciones que matchean trans:lang
    p.set('include', 'audios');                              // trae el audio en el mismo payload
    p.set('limit', '20');
    if (f.query) p.set('q', f.query);                        // query -> q
    if (f.user) p.set('owner', f.user);                      // user -> owner
    if (f.origin) p.set('origin', f.origin);                 // original/translation/known/unknown
    if (f.orphans) p.set('is_orphan', f.orphans);
    if (f.unapproved) p.set('is_unapproved', f.unapproved);
    if (f.native) p.set('is_native', f.native);
    if (f.has_audio) p.set('has_audio', f.has_audio);
    if (f.list) p.set('list', f.list);
    if (f.tags) f.tags.split(',').map((s) => s.trim()).filter(Boolean).forEach((t) => p.append('tag', t));
    const wc = wordRange(f.word_min, f.word_max); if (wc) p.set('word_count', wc);
    // --- Traducciones ---
    if (f.trans_to) p.set('trans:lang', f.trans_to);   // restringe a oraciones CON traducción en ese idioma
    if (f.trans_link === 'direct') p.set('trans:is_direct', 'yes');
    else if (f.trans_link === 'indirect') p.set('trans:is_direct', 'no');
    if (f.trans_user) p.set('trans:owner', f.trans_user);
    if (f.trans_orphan) p.set('trans:is_orphan', f.trans_orphan);
    if (f.trans_unapproved) p.set('trans:is_unapproved', f.trans_unapproved);
    if (f.trans_native) p.set('trans:is_native', f.trans_native);
    if (f.trans_has_audio) p.set('trans:has_audio', f.trans_has_audio);
    return p.toString();
  }

  // Acepta un query string (lo arma sobre API_BASE) o una URL completa (cursor `paging.next`).
  async function apiSearch(qsOrUrl) {
    const url = /^https?:/.test(qsOrUrl) ? qsOrUrl : `${API_BASE}/sentences?${qsOrUrl}`;
    const res = await fetch(url, { credentials: 'omit' });   // API pública -> sin cookies (evita líos de CORS)
    return res.json();
  }

  /* ============ MAZO + HISTORIAL ============ */

  let cards = [], index = -1, fetching = false, nextUrl = null;
  const seenIds = new Set();
  const currentCard = () => cards[index] || null;

  async function fetchBatch() {
    // Primera vez: arma el query (nueva búsqueda random). Después: sigue el cursor `paging.next`.
    const data = await apiSearch(nextUrl || buildQuery());
    nextUrl = (data.paging && data.paging.has_next) ? data.paging.next : null;
    let added = 0;
    for (const r of (data.data || [])) {
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
    const url = `${API_BASE}/audios/${en.audios[0].id}/file`;   // el download_url de la API viene roto (/audio/ singular -> 404); uso /audios/ (plural)

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
        display:flex; flex-direction:column; font-family:sans-serif; transition:padding-right .25s ease; }
      #fc-overlay.panel-push { padding-right:min(88vw,380px); }
      #fc-overlay.dark { --bg:#1c1c1e; --fg:#eaeaea; --muted:#888; --card:#2a2a2c; --line:#3a3a3c;
        --btn:#3a3a3c; --btnfg:#ddd; --back:#6bbf59; }
      #fc-overlay.hidden { display:none; }
      #fc-overlay .material-icons { line-height:1; font-size:inherit; color:inherit; display:block; }
      #fc-top { display:flex; align-items:center; gap:8px; padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px; }
      #fc-id { font-size:12px; color:var(--muted); font-weight:600; line-height:1.3; margin-right:auto; }
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
      #fc-owners { font-size:12px; color:var(--muted); min-height:1.3em; }
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
      .fc-panel-backdrop { position:fixed; inset:0; z-index:2147483499; background:rgba(0,0,0,.35);
        opacity:0; pointer-events:none; transition:opacity .25s ease; }
      .fc-panel-backdrop.open { opacity:1; pointer-events:auto; }
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
      #fc-modal { position:fixed; inset:0; z-index:2147483600; display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .2s ease; }
      #fc-modal.open { opacity:1; pointer-events:auto; }
      #fc-modal .box { background:var(--bg,#fff); color:var(--fg,#222); border:1px solid var(--line); border-radius:12px; width:min(92vw,400px);
        height:min(86vh,600px); overflow:hidden; display:flex; flex-direction:column; font-size:14px;
        transform:scale(.94); transition:transform .2s ease; }
      #fc-modal.open .box { transform:scale(1); }
      #fc-modal .fc-tabs { display:flex; gap:2px; padding:8px 8px 0; border-bottom:1px solid var(--line); }
      #fc-modal .fc-tabs button { flex:1; padding:9px 4px; border:none; background:transparent; color:var(--muted);
        font-size:13px; cursor:pointer; border-bottom:2px solid transparent; border-radius:6px 6px 0 0; }
      #fc-modal .fc-tabs button.active { color:var(--fg); border-bottom-color:var(--accent); font-weight:600; }
      #fc-modal .fc-pane { display:none; flex-direction:column; gap:10px; }
      #fc-modal .fc-pane.active { display:flex; }
      #fc-modal .box-scroll { overflow:auto; flex:1 1 auto; min-height:0; padding:18px; display:flex; flex-direction:column; gap:10px; scrollbar-width:none; -ms-overflow-style:none; }
      #fc-modal .box-scroll::-webkit-scrollbar { width:0; height:0; display:none; }
      #fc-modal h4 { margin:6px 0 0; border-bottom:1px solid var(--line,#eee); padding-bottom:4px; }
      #fc-modal label { display:flex; flex-direction:column; gap:3px; }
      #fc-modal .hint { font-size:11px; color:var(--muted); margin:-3px 0 4px; line-height:1.35; }
      #fc-modal .row { display:flex; align-items:center; gap:8px; }
      #fc-modal select, #fc-modal input { padding:8px; border:1px solid rgba(128,128,128,.4); border-radius:6px; font-size:15px;
        background:var(--card,#fff); color:var(--fg,#222); }
      #fc-modal .actions { display:flex; gap:8px; padding:10px 18px; border-top:1px solid var(--line); background:var(--bg,#fff); }
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
    ownersEl.textContent = '';   // los dueños aparecen recién AL revelar (junto con la traducción)
    ownersEl.style.transition = ''; ownersEl.style.transform = '';   // reset de la animación
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

    ownersEl.textContent = `Oración: ${frontOf(c).owner || '—'} · Traducción: ${backOf(c).owner || '—'}`;
    flipOwners(oldLeft);   // anima el corrimiento horizontal de la línea (aparece junto con la traducción)
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

  let historyPanel, listPanel, panelBackdrop, listPage = 1, listUrls = [];   // listUrls[page] = URL (cursor) de cada página
  function buildPanels() {
    historyPanel = makePanel('Historial'); listPanel = makePanel('Mi lista');
    panelBackdrop = document.createElement('div'); panelBackdrop.className = 'fc-panel-backdrop';
    panelBackdrop.addEventListener('click', closePanels);
    document.body.appendChild(panelBackdrop);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (historyPanel.classList.contains('open') || listPanel.classList.contains('open'))) closePanels();
    });
  }
  function makePanel(title) {
    const p = document.createElement('div'); p.className = 'fc-panel';
    const h = document.createElement('header');
    const t = document.createElement('div'); t.textContent = title;
    const s = document.createElement('div'); s.className = 'spacer';
    const c = iconBtn('x', 'close', 'Cerrar', 'fc-icon'); c.addEventListener('click', closePanels);
    h.append(t, s, c);
    const body = document.createElement('div'); body.className = 'body';
    p.append(h, body); document.body.appendChild(p); p._body = body; p._title = t; return p;
  }
  function closePanels() { historyPanel.classList.remove('open'); listPanel.classList.remove('open'); if (panelBackdrop) panelBackdrop.classList.remove('open'); overlay.classList.remove('panel-push'); uiBlocked = false; }
  function toggleList() { if (listPanel.classList.contains('open')) closePanels(); else openList(); }
  function toggleHistory() { if (historyPanel.classList.contains('open')) closePanels(); else openHistory(); }
  function showPanelChrome() {   // muestra backdrop (flotante) o empuje (PC), cierra el otro panel
    historyPanel.classList.remove('open'); listPanel.classList.remove('open');
    uiBlocked = !DESKTOP_MODE;
    if (DESKTOP_MODE) { panelBackdrop.classList.remove('open'); overlay.classList.add('panel-push'); }
    else { overlay.classList.remove('panel-push'); panelBackdrop.classList.add('open'); }
  }

  function openHistory() {
    const body = historyPanel._body; body.innerHTML = '';
    for (let i = index; i >= 0; i--) {
      const c = cards[i]; const f = frontOf(c);
      const row = document.createElement('div'); row.className = 'fc-row'; row.style.cursor = 'pointer';
      row.innerHTML = `<div class="es">#${c.id} — ${f.text}</div>`;
      row.addEventListener('click', () => jumpTo(i)); body.appendChild(row);
    }
    if (!body.children.length) body.textContent = 'Todavía no viste ninguna.';
    showPanelChrome(); historyPanel.classList.add('open');
  }

  function listControls() {
    const wrap = document.createElement('div'); wrap.className = 'fc-list-ctrls';
    const so = (v, t) => `<option value="${v}" ${listSort === v ? 'selected' : ''}>${t}</option>`;
    const sortOpts = so('-created', 'Creación: nuevas primero') + so('created', 'Creación: viejas primero')
      + so('-modified', 'Modificación: recientes primero') + so('modified', 'Modificación: antiguas primero')
      + so('-words', 'Palabras: más largas primero') + so('words', 'Palabras: más cortas primero')
      + so('random', 'Al azar');
    wrap.innerHTML = `<label>Oraciones en:<select id="ld-front">${langOpts(LIST_DISPLAY.front)}</select></label>` +
                     `<label>Mostrar traducciones en:<select id="ld-back">${langOpts(LIST_DISPLAY.back)}</select></label>` +
                     `<label>Ordenar por:<select id="ld-sort">${sortOpts}</select></label>`;
    wrap.querySelector('#ld-front').addEventListener('change', (e) => { LIST_DISPLAY.front = e.target.value; saveListDisplay(); listPage = 1; listUrls = []; loadListPage(); });
    wrap.querySelector('#ld-back').addEventListener('change', (e) => { LIST_DISPLAY.back = e.target.value; saveListDisplay(); listPage = 1; listUrls = []; loadListPage(); });
    wrap.querySelector('#ld-sort').addEventListener('change', (e) => { listSort = e.target.value; localStorage.setItem('sm-fc-listsort', listSort); listPage = 1; listUrls = []; loadListPage(); });
    return wrap;
  }

  function openList() {
    listPage = 1; listUrls = []; showPanelChrome(); listPanel.classList.add('open');
    currentListName().then((n) => { listPanel._title.textContent = n; });
    loadListPage();
  }

  function buildListQuery() {
    const p = new URLSearchParams();
    p.set('lang', LIST_LANGS);   // amplio -> la lista trae miembros de cualquier idioma (mixta)
    p.set('list', String(LIST_ID));
    p.set('sort', listSort);                   // orden de la API (selector en "Mi lista")
    p.set('showtrans', 'all');                 // todas las traducciones -> el display (LIST_DISPLAY) elige front/back
    p.set('include', 'audios');
    p.set('limit', '30');
    return p.toString();
  }

  async function loadListPage() {
    const body = listPanel._body; body.innerHTML = '';
    body.appendChild(listControls());
    const area = document.createElement('div'); area.id = 'fc-list-area';
    area.innerHTML = '<div class="fc-list-load"><div class="fc-load-dots"><span></span><span></span><span></span></div><div class="lbl">Cargando lista…</div></div>';
    body.appendChild(area);
    try {
      const url = listUrls[listPage] || `${API_BASE}/sentences?${buildListQuery()}`;
      const data = await apiSearch(url);
      listUrls[listPage] = url;
      const hasNext = !!(data.paging && data.paging.has_next);
      if (hasNext) listUrls[listPage + 1] = data.paging.next;   // cursor de la próxima página
      renderListPage(area, data.data || [], hasNext);
    } catch (e) { area.textContent = 'Error cargando la lista.'; }
  }

  function renderListPage(area, all, hasNext) {
    area.innerHTML = '';
    if (!all.length) area.textContent = listPage === 1 ? 'La lista está vacía.' : 'No hay más oraciones.';
    for (const c of all) {
      const ft = getTextByLang(c, LIST_DISPLAY.front) || { text: c.text, id: c.id, owner: c.owner };
      const bt = getTextByLang(c, LIST_DISPLAY.back) || { text: '', id: null };
      const row = document.createElement('div'); row.className = 'fc-row';
      row.innerHTML = `<div class="meta">Oración #${ft.id || '—'} · ${ft.owner || '—'}</div>
        <div class="es">${ft.text}</div>
        <div class="en">${bt.text}</div>
        <div class="meta">Traducción #${bt.id || '—'}</div>
        <div class="acts"><button class="go">Abrir</button><button class="rm">Quitar</button></div>`;
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

  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Trae las listas a las que el usuario puede agregar (propias + colaborativas), vía el sitio (con sesión).
  let myListsCache = null;
  async function fetchMyLists() {
    try {
      const r = await fetch(`/${langSeg()}/sentences_lists/choices`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!r.ok) return null;
      const d = await r.json();
      const lists = (d && d.lists) || null;
      if (lists) myListsCache = lists;
      return lists;
    } catch (e) { return null; }
  }
  async function currentListName() {
    const cur = String(LIST_ID);
    const find = () => (myListsCache || []).find((l) => String(l.id) === cur);
    if (!myListsCache) await fetchMyLists();
    const l = find();
    return l ? l.name : `Lista #${cur}`;
  }

  async function populateListSelect() {
    const sel = document.getElementById('f-listid'); if (!sel) return;
    const lists = (await fetchMyLists() || []).filter((l) => l.is_mine);   // SOLO las mías
    if (!lists.length) return;   // si falla, queda el fallback (lista actual)
    lists.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const cur = String(LIST_ID);
    let html = lists.map((l) => `<option value="${l.id}" ${String(l.id) === cur ? 'selected' : ''}>${escHtml(l.name)}</option>`).join('');
    if (!lists.some((l) => String(l.id) === cur)) html = `<option value="${cur}" selected>(actual #${cur})</option>` + html;   // no perder la actual si no está
    sel.innerHTML = html;
  }

  function buildModal() {
    const m = document.createElement('div'); m.id = 'fc-modal';
    const f = filters;
    const linkSel = (id, v) => { const o = (val, t) => `<option value="${val}" ${v === val ? 'selected' : ''}>${t}</option>`;
      return `<select id="${id}">${o('', 'Es indistinto')}${o('direct', 'Directo')}${o('indirect', 'Indirecto')}</select>`; };
    const originSel = (id, v) => { const o = (val, t) => `<option value="${val}" ${v === val ? 'selected' : ''}>${t}</option>`;
      return `<select id="${id}">${o('', 'Cualquiera')}${o('original', 'Original')}${o('translation', 'Traducción')}${o('known', 'Conocido')}${o('unknown', 'Desconocido')}</select>`; };
    m.innerHTML = `<div class="box">
      <div class="fc-tabs">
        <button type="button" class="active" data-pane="o">Oraciones</button>
        <button type="button" data-pane="t">Traducción</button>
        <button type="button" data-pane="e">Estudio</button>
      </div>
      <div class="box-scroll">
      <div class="fc-pane active" data-pane="o">
      <label>Palabras:<input type="text" id="f-query" value="${f.query || ''}" placeholder="palabra o frase"></label>
      <div class="hint">Texto a buscar (sintaxis ManticoreSearch). Vacío = todas.</div>
      <label>Idioma:<select id="f-from">${langOpts(f.from)}</select></label>
      <div class="hint">Idioma de las oraciones que se traen.</div>
      <div class="row"><span>Length:</span> mín <input type="number" id="f-wmin" value="${f.word_min}" style="width:60px"> máx <input type="number" id="f-wmax" value="${f.word_max}" style="width:60px"></div>
      <div class="hint">Cantidad de palabras (o de caracteres en idiomas sin espacios: japonés, chino…).</div>
      <label>Dueño:<input type="text" id="f-user" value="${f.user || ''}" placeholder="nombre de usuario"></label>
      <div class="hint">Usuario que creó la oración.</div>
      <label>Origen:${originSel('f-origin', f.origin)}</label>
      <div class="hint">Original: no es traducción de otra · Traducción: agregada como traducción · Conocido: original o traducción · Desconocido: no se sabe.</div>
      <label>Es huérfana: ${tri('f-orphans', f.orphans)}</label>
      <div class="hint">Sí: sin dueño (más prob. de errores) · No: con dueño.</div>
      <label>Está reprobada: ${tri('f-unapproved', f.unapproved)}</label>
      <div class="hint">Sí: reprobadas (más prob. de errores) · No: las excluye.</div>
      <label>Is owned by a native: ${tri('f-native', f.native)}</label>
      <div class="hint">Sí: dueño es hablante nativo autoidentificado.</div>
      <label>Tiene voz: ${tri('f-audio', f.has_audio)}</label>
      <div class="hint">Sí: tiene al menos una grabación de audio.</div>
      <label>Etiquetas:<input type="text" id="f-tags" value="${f.tags || ''}" placeholder="separadas por comas"></label>
      <div class="hint">Tags EXACTOS, separados por coma. Deben existir o la búsqueda da error.</div>
      <label>Pertenece a la lista (ID, opcional):<input type="text" id="f-list" value="${f.list || ''}" placeholder="Sin especificar"></label>
      <div class="hint">ID numérico de una lista de Tatoeba.</div>
      <h4>Ordenación</h4>
      <label>Orden:<select id="f-sort">
        <option value="random" ${f.sort === 'random' ? 'selected' : ''}>Al azar</option>
        <option value="relevance" ${f.sort === 'relevance' ? 'selected' : ''}>Relevancia (coincidencias exactas primero)</option>
        <option value="words" ${f.sort === 'words' ? 'selected' : ''}>Palabras (más cortas primero)</option>
        <option value="created" ${f.sort === 'created' ? 'selected' : ''}>Fecha de creación (más nuevas primero)</option>
        <option value="modified" ${f.sort === 'modified' ? 'selected' : ''}>Última modificación (modificadas primero)</option></select></label>
      <div class="hint">‘En orden inverso’ da vuelta el elegido (ej. más viejas / más largas primero).</div>
      <div class="row"><input type="checkbox" id="f-reverse" ${f.sort_reverse ? 'checked' : ''}><span>En orden inverso</span></div>
      </div>
      <div class="fc-pane" data-pane="t">
      <label>Idioma:<select id="f-tto">${langOpts(f.trans_to, 'Cualquier idioma')}</select></label>
      <div class="hint">Solo trae oraciones que TIENEN traducción en este idioma (será el reverso).</div>
      <label>Enlace: ${linkSel('f-tlink', f.trans_link)}</label>
      <div class="hint">Directo: traducción directa · Indirecto: vía otra oración puente.</div>
      <label>Dueño:<input type="text" id="f-tuser" value="${f.trans_user || ''}" placeholder="nombre de usuario"></label>
      <div class="hint">Usuario que creó la traducción.</div>
      <label>Es huérfana: ${tri('f-torphan', f.trans_orphan)}</label>
      <label>Está reprobada: ${tri('f-tunap', f.trans_unapproved)}</label>
      <label>Is owned by a native: ${tri('f-tnative', f.trans_native)}</label>
      <label>Tiene voz: ${tri('f-thas', f.trans_has_audio)}</label>
      <div class="hint">Mismos criterios (Sí/No/Indistinto), aplicados a la traducción.</div>
      </div>
      <div class="fc-pane" data-pane="e">
      <label>Lista objetivo:<select id="f-listid"><option value="${LIST_ID}" selected>Cargando tus listas…</option></select></label>
      <div class="hint">Elegí entre tus listas. Define dónde agregás/quitás y qué ves en "Mi lista".</div>
      <label>Idioma del audio:<select id="f-audiolang">${langOpts(AUDIO_LANG)}</select></label>
      <div class="hint">Qué idioma suena al tocar audio. Debe ser uno de los dos que se traen (frente o reverso); si no, no habrá audio.</div>
      <h4>Visualización (app y lista)</h4>
      <label>Mostrar primero (frente):<select id="d-front">${langOpts(DISPLAY.front)}</select></label>
      <div class="hint">Idioma que ves ANTES de revelar.</div>
      <label>Luego (reverso):<select id="d-back">${langOpts(DISPLAY.back)}</select></label>
      <div class="hint">Idioma que se revela (la "respuesta"). El audio siempre es inglés.</div>
      <h4>Interacción</h4>
      <div class="row"><input type="checkbox" id="f-desktop" ${DESKTOP_MODE ? 'checked' : ''}><span>Modo ordenador (paneles laterales)</span></div>
      <div class="hint">En PC: Historial y Mi lista se abren al costado y empujan el contenido en vez de flotar. Atajos: <b>[</b> alterna Mi lista, <b>]</b> alterna Historial.</div>
      </div>
      </div>
      <div class="actions"><button id="fc-cancel">Cancelar</button><button id="fc-apply">Aplicar</button></div>
    </div>`;
    document.body.appendChild(m);
    m.querySelectorAll('.fc-tabs button').forEach((b) => b.addEventListener('click', () => {
      m.querySelectorAll('.fc-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      m.querySelectorAll('.fc-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.pane));
      m.querySelector('.box-scroll').scrollTop = 0;
    }));
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.classList.contains('open')) closeModal(); });
    m.querySelector('#fc-cancel').addEventListener('click', closeModal);
    m.querySelector('#fc-apply').addEventListener('click', () => {
      const g = (id) => m.querySelector(id);
      filters = {
        query: g('#f-query').value.trim(), from: g('#f-from').value,
        word_min: g('#f-wmin').value, word_max: g('#f-wmax').value, user: g('#f-user').value.trim(),
        origin: g('#f-origin').value, orphans: g('#f-orphans').value, unapproved: g('#f-unapproved').value,
        native: g('#f-native').value, has_audio: g('#f-audio').value, tags: g('#f-tags').value.trim(), list: g('#f-list').value.trim(),
        trans_to: g('#f-tto').value, trans_link: g('#f-tlink').value, trans_user: g('#f-tuser').value.trim(),
        trans_orphan: g('#f-torphan').value, trans_unapproved: g('#f-tunap').value, trans_native: g('#f-tnative').value,
        trans_has_audio: g('#f-thas').value, sort: g('#f-sort').value, sort_reverse: g('#f-reverse').checked,
      };
      DISPLAY = { front: g('#d-front').value, back: g('#d-back').value };
      LIST_ID = g('#f-listid').value.trim() || '174916';
      AUDIO_LANG = g('#f-audiolang').value;
      DESKTOP_MODE = g('#f-desktop').checked;
      localStorage.setItem('sm-fc-listid', LIST_ID);
      localStorage.setItem('sm-fc-audiolang', AUDIO_LANG);
      localStorage.setItem('sm-fc-desktop', DESKTOP_MODE ? '1' : '0');
      closePanels();   // si cambió el modo, dejá los paneles en estado limpio
      listUrls = [];   // cambió la lista objetivo -> invalida los cursores de "Mi lista"
      saveFilters(); saveDisplay(); closeModal(); resetDeck();
    });
  }
  const openModal = () => { uiBlocked = true; document.getElementById('fc-modal').classList.add('open'); populateListSelect(); };
  const closeModal = () => { uiBlocked = false; document.getElementById('fc-modal').classList.remove('open'); };

  async function resetDeck() {
    cards = []; index = -1; nextUrl = null; seenIds.clear();
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

    // Atajos de panel (modo ordenador): viven aparte porque deben funcionar AUN con el panel abierto, para alternar/cerrar.
    document.addEventListener('keydown', (e) => {
      if (!DESKTOP_MODE || !isOpen()) return;
      const modal = document.getElementById('fc-modal');
      if (modal && modal.classList.contains('open')) return;
      const el = document.activeElement;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === KEYS.list) { e.preventDefault(); toggleList(); }
      else if (e.key === KEYS.history) { e.preventDefault(); toggleHistory(); }
    });
  }

  /* ============ ARRANQUE ============ */
  injectStyles();
  buildUI();
  setOpen(isOpen());
  resetDeck();
}());
