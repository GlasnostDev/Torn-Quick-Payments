// ==UserScript==
// @name         FFScouter - Profile Payment Pre-fill & Mail Pre-fill
// @namespace    https://ffscouter.com/
// @version      4.5
// @description  Pre-fills profile send-money (paymentamount, paymentref) and messages.php compose (mailsubject, mailbody). Added: FFScouter payment queue with a movable, resizable panel (two-step SEND by click or hotkey, delay between payments, VAULT shortfall button), item.php send pre-fill (e.g. Xanax), and a property ID / market price / happiness bar.
// @author       FFScouter / Glasnost [1844049] & Solenya [4053619]
// @match        https://www.torn.com/profiles.php*
// @match        https://www.torn.com/messages.php*
// @match        https://www.torn.com/properties.php*
// @match        https://www.torn.com/item.php*
// @match        https://ffscouter.com/supportpanel/payment-provider*
// @match        https://www.ffscouter.com/supportpanel/payment-provider*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @updateURL    https://github.com/GlasnostDev/Torn-Quick-Payments/raw/refs/heads/main/quickpayments.user.js
// @downloadURL  https://github.com/GlasnostDev/Torn-Quick-Payments/raw/refs/heads/main/quickpayments.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── 1. Parse query params ─────────────────────────────────────────────────
  // Mail compose: Torn expects XID / mailsubject / mailbody in the hash fragment
  // (e.g. #/p=compose&XID=2598132&mailsubject=…&mailbody=…). URLSearchParams already
  // percent-decodes; do not call decodeURIComponent again (bare % in e.g. "72%" throws).
  function parseHashQueryParams() {
    const hash = (window.location.hash || '').replace(/^#/, '');
    const amp = hash.indexOf('&');
    if (amp === -1) {
      return new URLSearchParams();
    }
    return new URLSearchParams(hash.substring(amp + 1));
  }

  const params     = new URLSearchParams(window.location.search);
  const mailParams = parseHashQueryParams();

  const rawAmount  = params.get('paymentamount');
  const rawRef     = params.get('paymentref');
  const rawSubject = mailParams.get('mailsubject') || params.get('mailsubject');
  const rawBody    = mailParams.get('mailbody') || params.get('mailbody');

  // ── 2. Helper: set value on a React-controlled <input> ───────────────────
  function setNativeInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── 3. Helper: flash a subtle outline so the user notices the pre-fill ───
  function flashOutline(el) {
    el.style.transition    = 'outline-color 0.15s ease-in-out';
    el.style.outline       = '2px solid rgba(180, 160, 60, 0.85)';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = '2px solid transparent';
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 300);
    }, 1200);
  }

  // ── 4. Helper: detect whether a string contains HTML markup ──────────────
  function looksLikeHtml(str) {
    return /<[a-z][\s\S]*>/i.test(str);
  }

  // ── 5. Helper: normalise line breaks ─────────────────────────────────────
  // Handles real CRLF/CR/LF as well as literal backslash-n that an AI agent
  // may have written into the URL instead of encoding a real newline as %0A.
  function normaliseLineBreaks(str) {
    return str
      .replace(/\r\n/g, '\n')  // CRLF → LF
      .replace(/\r/g, '\n')    // bare CR → LF
      .replace(/\\n/g, '\n')   // literal \n (backslash + n) → real newline
      .replace(/\\r/g, '');    // literal \r → drop
  }

  // ── 6. Helper: convert plain text to TinyMCE-safe HTML ───────────────────
  // Must be called AFTER normaliseLineBreaks so \n are real newline characters.
  // Escapes & < > so they are never misread as markup, then wraps each line
  // in <p>. Blank lines become <p>&nbsp;</p> to preserve visible spacing.
  function plainTextToHtml(str) {
    const escaped = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped
      .split('\n')
      .map(l => '<p>' + (l.trim() || '&nbsp;') + '</p>')
      .join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BRANCH A — profiles.php: Payment pre-fill
  // ══════════════════════════════════════════════════════════════════════════
  if (window.location.pathname === '/profiles.php' && rawAmount && rawRef) {

    const amount    = rawAmount.trim();
    const message   = rawRef.trim();
    const requested = parseFloat(amount.replace(/[^0-9.]/g, ''));

    // anonymous=1 in the query string pre-ticks the "Anonymous" checkbox
    const wantAnonymous = params.get('anonymous') === '1';

    function checkCashAndWarn() {
      const moneyEl = document.getElementById('user-money');
      if (!moneyEl) return false;

      const cashOnHand = parseFloat(moneyEl.dataset.money || '0');
      if (isNaN(cashOnHand) || cashOnHand >= requested) return false;

      const fmt = n => '$' + Math.floor(n).toLocaleString('en-US');

      const banner = document.createElement('div');
      banner.id = 'ffscouter-cash-warning';
      banner.style.cssText = [
        'position:fixed', (/TornPDA/i.test(navigator.userAgent) || typeof window.flutter_inappwebview !== 'undefined' ? 'bottom:84px' : 'bottom:24px'),
        'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'background:#7a1a1a', 'color:#f8d7da',
        'border:2px solid #e05555', 'border-radius:6px', 'padding:14px 20px',
        'font:bold 14px/1.5 Arial,sans-serif',
        'box-shadow:0 4px 18px rgba(0,0,0,0.55)', 'max-width:480px',
        'text-align:center', 'cursor:pointer',
      ].join(';');
      banner.innerHTML =
        '⚠️ <strong>FFScouter – Insufficient Cash</strong><br>' +
        'Requested: <strong>' + fmt(requested) + '</strong> &nbsp;|&nbsp; ' +
        'On hand: <strong>' + fmt(cashOnHand) + '</strong><br>' +
        '<span style="font-size:12px;opacity:0.85">The amount field may have been reduced. ' +
        'Do NOT send until you have enough cash.</span><br>' +
        '<span style="font-size:11px;opacity:0.65">(Click to dismiss)</span>';
      banner.addEventListener('click', () => banner.remove());
      setTimeout(() => { if (banner.parentNode) banner.remove(); }, 30000);
      document.body.appendChild(banner);

      console.warn('[FFScouter] Insufficient cash — requested:', requested, '| on hand:', cashOnHand);
      return true;
    }

    // Ticks the Anonymous checkbox if requested via anonymous=1. Safe to call
    // repeatedly — only clicks it if it isn't already checked.
    function tickAnonymousIfNeeded() {
      if (!wantAnonymous) return;
      const anonymousCheckbox = document.querySelector('.send-cash input#anonymous');
      if (anonymousCheckbox && !anonymousCheckbox.checked) {
        anonymousCheckbox.click();
        flashOutline(anonymousCheckbox);
      }
    }

    function fillPaymentForm() {
      const amountInput  = document.querySelector('.send-cash .input-money:not([type="hidden"])');
      const messageInput = document.querySelector('.send-cash .send-cash-message-input');
      if (!amountInput || !messageInput) return false;

      setNativeInputValue(amountInput,  amount);
      setNativeInputValue(messageInput, message);
      [amountInput, messageInput].forEach(flashOutline);

      return true;
    }

    function openSendMoneyForm() {
      const btn = document.querySelector('.profile-button-sendMoney');
      if (!btn) return false;
      if (!document.querySelector('.send-cash .input-money')) btn.click();
      return true;
    }

    let attempts = 0;
    const poller = setInterval(() => {
      if (++attempts > 60) {
        clearInterval(poller);
        console.warn('[FFScouter] Could not find send-money button after 6 s');
        return;
      }

      if (!openSendMoneyForm()) return;

      setTimeout(() => {
        tickAnonymousIfNeeded();

        // If there isn't enough cash on hand, warn but do NOT fill in the
        // amount/message fields — leave them blank to prevent accidents.
        if (checkCashAndWarn()) {
          clearInterval(poller);
          return;
        }

        if (fillPaymentForm()) {
          clearInterval(poller);
          console.info('[FFScouter] Payment form pre-filled — amount:', amount, '| ref:', message);
        }
      }, 120);
    }, 100);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BRANCH B — messages.php: Mail compose pre-fill
  // ══════════════════════════════════════════════════════════════════════════
  if (window.location.pathname === '/messages.php' && (rawSubject || rawBody)) {

    const subject = rawSubject ? rawSubject.trim() : null;
    const body = rawBody
      ? normaliseLineBreaks(rawBody.trim())
      : null;

    let attempts = 0;
    const poller = setInterval(() => {
      if (++attempts > 100) {
        clearInterval(poller);
        console.warn('[FFScouter] Could not find compose form after 10 s');
        return;
      }

      // Ensure we're on the Compose tab
      if (!window.location.hash.includes('p=compose')) {
        const tab = document.querySelector('a[href="#/p=compose"]');
        if (tab) tab.click();
        return;
      }

      const subjectInput = document.querySelector('input[name="subject"]');
      if (!subjectInput) return; // compose panel not rendered yet

      const editor = (typeof tinymce !== 'undefined') ? tinymce.activeEditor : null;
      if (body && !editor) return; // TinyMCE not initialised yet

      // ── All ready — fill in the fields ──────────────────────────────────
      clearInterval(poller);

      // Subject: plain text input — accepts all special chars raw, no escaping needed
      if (subject) {
        setNativeInputValue(subjectInput, subject);
        flashOutline(subjectInput);
      }

      if (body && editor) {
        // If the body contains HTML tags pass it straight to TinyMCE.
        // If it's plain text, escape & < > and convert real \n chars to <p> blocks.
        const htmlContent = looksLikeHtml(body) ? body : plainTextToHtml(body);
        editor.setContent(htmlContent);
        editor.focus();
        const editorEl = document.querySelector('[id^="mce_"]');
        if (editorEl) flashOutline(editorEl);
      }

      console.info('[FFScouter] Mail compose pre-filled — subject:', subject, '| body:', body);
    }, 100);
  }

})();

// ── Added features (the original script above is untouched) ──
(function () {
  'use strict';

  const q    = new URLSearchParams(location.search);
  const path = location.pathname;

  const VERSION    = '4.8';   // keep in sync with @version above
  const UPDATE_URL = 'https://github.com/GlasnostDev/Torn-Quick-Payments/raw/refs/heads/main/quickpayments.user.js';   // empty = update check off
  const isPDA      = typeof window.flutter_inappwebview !== 'undefined' || /TornPDA/i.test(navigator.userAgent);

  // ── update check: once every 30 min, shows a dismissible banner when UPDATE_URL has a newer @version ──
  function updateCheck() {
    if (!UPDATE_URL || /(^|\.)ffscouter\.com$/.test(location.hostname)) return;
    const KEY_UPD = 'ffscouter_update_v1';
    let st = {};
    try { st = JSON.parse(localStorage.getItem(KEY_UPD)) || {}; } catch (e) {}
    const newer = (a, b) => {
      const x = a.split('.').map(Number), y = b.split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
      return false;
    };
    function banner(v) {
      if (st.dismissed === v || document.getElementById('ffq-update')) return;
      const b = document.createElement('div');
      b.id = 'ffq-update';
      b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;max-width:94vw;background:#1e3a5f;color:#e0f2fe;border:1px solid #3b82f6;border-radius:8px;padding:8px 10px;font:bold 13px Arial,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.55)';
      const t = document.createElement('span');
      t.textContent = 'FFScouter ' + v + ' is available (you have ' + VERSION + ')';
      const a = document.createElement('a');
      a.textContent = 'Update';
      a.href = UPDATE_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.cssText = 'background:#15803d;color:#fff;text-decoration:none;border-radius:6px;padding:6px 12px';
      const x = document.createElement('span');
      x.textContent = '✕';
      x.style.cssText = 'cursor:pointer;padding:4px 6px;color:#9aa7b2';
      x.onclick = () => { st.dismissed = v; try { localStorage.setItem(KEY_UPD, JSON.stringify(st)); } catch (e) {} b.remove(); };
      b.append(t, a, x);
      document.body.appendChild(b);
    }
    const found = text => {
      const m = /@version\s+([\d.]+)/.exec(text || '');
      if (m && newer(m[1], VERSION)) { st.latest = m[1]; banner(m[1]); } else st.latest = null;
    };
    if (st.latest && newer(st.latest, VERSION)) banner(st.latest);
    if (Date.now() - (st.checked || 0) < 30 * 60 * 1000) return;
    st.checked = Date.now();
    try { localStorage.setItem(KEY_UPD, JSON.stringify(st)); } catch (e) {}
    const url = UPDATE_URL + (UPDATE_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
    const get = typeof window.PDA_httpGet === 'function'
      ? window.PDA_httpGet(url).then(r => r.responseText)
      : fetch(url, { cache: 'no-store' }).then(r => r.text());
    get.then(found).then(() => { try { localStorage.setItem(KEY_UPD, JSON.stringify(st)); } catch (e) {} }).catch(() => {});
  }
  updateCheck();

  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    ['input', 'keyup', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  }

  if (/(^|\.)ffscouter\.com$/.test(location.hostname)) return ffscouterSender();
  if (path === '/properties.php') { propertiesPage(); if (q.has('ffvault')) queuePanel(); return; }
  if (path === '/item.php')       return itemPrefill().catch(e => console.error('[FFScouter item]', e));
  if (path === '/profiles.php')   return queuePanel();

  // ── ffscouter.com: send pending payments to Torn as a queue ──
  function ffscouterSender() {
    const usable = () => [...document.querySelectorAll('#claimed-jobs .job-card[data-job-status="pending"] a[data-receiver-link]')]
      .filter(a => { const p = new URL(a.href).searchParams; return p.get('XID') && p.get('paymentamount') && p.get('paymentref'); });

    const jobId = a => {
      const card = a.closest('.job-card'), b = card && card.querySelector('[data-release]');
      return b && /^\d+$/.test(b.dataset.release) ? b.dataset.release : '';
    };

    // opened from the Torn queue panel: release that job here, where the session and CSRF token live
    const rel = q.get('ffrelease');
    if (/^\d+$/.test(rel || '')) {
      const meta = document.querySelector('meta[name="csrf-token"]');
      const xsrf = (document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1];
      const headers = { accept: 'application/json', 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
      if (meta) headers['x-csrf-token'] = meta.content;
      else if (xsrf) headers['x-xsrf-token'] = decodeURIComponent(xsrf);
      const say = (text, ok) => {
        const d = document.createElement('div');
        d.textContent = text;
        d.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;border-radius:6px;padding:10px 16px;font:bold 14px Arial,sans-serif;border:1px solid;' +
          (ok ? 'background:#14532d;color:#d1fae5;border-color:#22c55e' : 'background:#7a1a1a;color:#f8d7da;border-color:#e05555');
        document.body.appendChild(d);
      };
      fetch('/supportpanel/payment-provider/jobs/' + rel + '/release', { method: 'POST', headers: headers, body: '{}', credentials: 'include' })
        .then(r => r.json().catch(() => ({})).then(j => {
          const ok = r.ok && j.code === 0;   // panel answers {"code":0} on success
          say(ok ? 'Job ' + rel + ' released' : 'Release failed (' + r.status + (j.code ? ', code ' + j.code : '') + ') - release it from this page by hand', ok);
          if (ok) setTimeout(() => location.replace(location.pathname), 1500);
        }))
        .catch(() => say('Release failed - release it from this page by hand'));
    }

    function queueUrl() {
      const links = usable();
      const rows  = links.map(a => new URL(a.href).searchParams);
      const ref0  = rows[0].get('paymentref');
      const sfx   = ref0.indexOf(' ') < 0 ? '' : ref0.slice(ref0.indexOf(' '));
      const queue = rows.map(p => {
        const ref = p.get('paymentref');
        return [p.get('XID'), p.get('paymentamount'),
                sfx && ref.endsWith(sfx) ? ref.slice(0, -sfx.length) + '§' : ref,   // § = shared ending, kept once
                p.get('anonymous') === '1' ? 1 : 0, jobId(links[rows.indexOf(p)])];
      });
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ s: sfx, q: queue }))));
      return links[0].href + '&ffq=' + encodeURIComponent(b64);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#ea580c;color:#fff;border:0;border-radius:6px;padding:10px 14px;font:bold 14px Arial,sans-serif;cursor:pointer';
    document.body.appendChild(btn);

    const refresh = () => {
      const n = usable().length;
      btn.textContent   = n ? 'Send ' + n + ' to Torn queue' : 'No pending payments';
      btn.disabled      = !n;
      btn.style.opacity = n ? '1' : '0.5';
    };
    setInterval(refresh, 1000);
    refresh();

    btn.addEventListener('click', () => { if (usable().length) window.open(queueUrl(), '_blank'); });
  }

  // ── profiles.php: queue panel (hit 1 arm, hit 2 send, hit 3 next) ──
  function queuePanel() {
    const KEY = 'ffscouter_queue_v2', KEY_HK = 'ffscouter_hotkey_v1',
          KEY_UI = 'ffscouter_panel_ui_v1', KEY_LAST = 'ffscouter_lastsend_v1';
    const SEND_GAP = 2000;
    const ARM_MS   = 30000;

    const load = () => {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        return s && s.i < s.q.length && Date.now() - s.t < 6 * 3600 * 1000 ? s : null;
      } catch (e) { return null; }
    };
    const save = s => { s.t = Date.now(); localStorage.setItem(KEY, JSON.stringify(s)); };

    if (q.get('ffq')) {
      try {
        const p = JSON.parse(decodeURIComponent(escape(atob(q.get('ffq')))));
        save({ q: p.q.filter(r => /^\d+$/.test(r[0]) && /^\d+$/.test(r[1])), s: p.s || '', i: 0, d: [] });
        const u = new URL(location.href);
        u.searchParams.delete('ffq');
        history.replaceState(null, '', u);
      } catch (e) { console.warn('[FFScouter] Could not read queue from URL', e); }
    }

    let S = load();
    if (!S) return;

    const msg    = (s, k) => s.q[k][2].replace('§', () => s.s);
    const urlFor = (s, k) => '/profiles.php?XID=' + s.q[k][0] + '&paymentamount=' + s.q[k][1] +
                             '&paymentref=' + encodeURIComponent(msg(s, k)) + (s.q[k][3] ? '&anonymous=1' : '');
    const paid   = s => s.d.indexOf(s.i) !== -1;
    const onPage = s => q.get('XID') === s.q[s.i][0];
    const cash   = () => { const el = document.getElementById('user-money'); return el ? Number(el.dataset.money) : NaN; };
    const wait   = () => Math.max(0, Number(localStorage.getItem(KEY_LAST) || 0) + SEND_GAP - Date.now());
    const strip  = t => String(t || '').replace(/<[^>]*>/g, '').trim();

    function need(s) {
      if (paid(s)) return 0;   // sidebar cash may not be updated yet
      let sum = 0;
      for (let j = s.i; j < s.q.length; j++) if (s.d.indexOf(j) === -1) sum += Number(s.q[j][1]);
      return Math.max(0, sum - cash()) || 0;
    }

    function note(text, ok) {
      const old = document.getElementById('ffq-note');
      if (old) old.remove();
      const n = document.createElement('div');
      n.id = 'ffq-note';
      n.textContent = text;
      n.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:2147483647;border-radius:6px;padding:8px 12px;font:bold 13px Arial,sans-serif;max-width:92vw;text-align:center;border:1px solid;' +
        (ok ? 'background:#14532d;color:#d1fae5;border-color:#22c55e' : 'background:#7a1a1a;color:#f8d7da;border-color:#e05555');
      n.onclick = () => n.remove();
      document.body.appendChild(n);
      // the docked panel scrolls with the page, so pin the note to the bottom (above PDA's bottom bar)
      n.style.bottom = isPDA ? '84px' : '24px';
      setTimeout(() => n.remove(), 6000);
    }

    let armed = -1, armedAt = 0, sending = false;

    // vault page: hit 1 withdraw, hit 2 back to the queue
    const atVault = path === '/properties.php';
    let withdrew = false;
    const toVault = () => { location.href = 'https://www.torn.com/properties.php?ffvault=' + need(S) + '#/p=options&tab=vault'; };
    const withdrawBtn = () => [...document.querySelectorAll('input[type="submit"].torn-btn')]
      .find(b => /^withdraw$/i.test(b.value) && b.offsetParent !== null);
    if (atVault) document.addEventListener('click', e => { if (e.isTrusted && e.target === withdrawBtn()) withdrew = true; }, true);

    function vaultStep() {
      if (withdrew || need(S) === 0) return (location.href = urlFor(S, S.i));
      const b = withdrawBtn();
      if (!b) return note('WITHDRAW button not found - open the vault tab first.');
      if (b.disabled) return note('WITHDRAW is disabled - check the amount.');
      withdrew = true;
      b.click();
      show();
    }

    function next() {
      if (S.i >= S.q.length - 1) { localStorage.removeItem(KEY); S = null; panel.remove(); return; }
      S.i++; save(S);
      location.href = urlFor(S, S.i);
    }

    function step() {
      if (!S || sending) return;
      if (atVault) return vaultStep();
      if (paid(S)) return next();
      if (wait() > 0) return;
      const it = S.q[S.i];
      if (!onPage(S)) return note('Press Open first - this is not the queue player.');
      if (cash() < Number(it[1])) return toVault();
      const rfc = typeof window.getRFC === 'function' ? window.getRFC() : (document.cookie.match(/rfc_v=([^;]+)/) || [])[1];
      if (!rfc) return note("Could not find Torn's request token.");

      if (armed !== S.i || Date.now() - armedAt > ARM_MS) { armed = S.i; armedAt = Date.now(); return show(); }
      armed = -1; sending = true;
      localStorage.setItem(KEY_LAST, Date.now());
      show();

      fetch('/sendcash.php?rfcv=' + encodeURIComponent(rfc), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams({ step: 'cash1', ID: it[0], money: it[1], tag: msg(S, S.i), theanon: it[3] ? 'true' : 'false' }).toString()
      }).then(r => r.json()).then(j => {
        if (j.success === true) { S.d.push(S.i); save(S); note(strip(j.text) || 'Sent ✓', true); }
        else note(strip(j.text) || 'Torn did not confirm the payment - check your send log before retrying.');
      }).catch(() => note('Request failed - check your Torn send log before retrying.'))
        .then(() => { localStorage.setItem(KEY_LAST, Date.now()); sending = false; show(); });
    }

    const getKey  = () => localStorage.getItem(KEY_HK) || 'ArrowRight';
    const keyName = c => ({ ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓' }[c] || c.replace(/^(Key|Digit)/, ''));
    let held = false, capturing = false;

    document.addEventListener('keydown', e => {
      if (capturing || e.code !== getKey()) return;
      if (e.repeat || held) return;   // a held key never repeats
      held = true;
      const a = document.activeElement || {};
      if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) return;
      e.preventDefault();
      step();
    }, true);
    document.addEventListener('keyup', e => { if (e.code === getKey()) held = false; }, true);
    window.addEventListener('blur', () => { held = false; });

    function chooseKey() {
      capturing = true;
      show();
      document.addEventListener('keydown', function pick(e) {
        if (/^(Shift|Control|Alt|Meta)$/.test(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('keydown', pick, true);
        if (e.key !== 'Escape') localStorage.setItem(KEY_HK, e.code);
        held = e.key !== 'Escape';
        capturing = false;
        show();
      }, true);
    }

    const button = (bg, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = 'background:' + bg + ';color:#fff;border:0;border-radius:6px;padding:10px 14px;font:bold 14px Arial,sans-serif;cursor:pointer';
      b.addEventListener('click', e => { if (e.isTrusted) fn(); });
      return b;
    };
    const handle = (text, title, css) => {
      const s = document.createElement('span');
      s.textContent = text;
      s.title = title;
      s.style.cssText = 'color:#9aa7b2;user-select:none;-webkit-user-select:none;touch-action:none;' + css;
      return s;
    };

    const panel = document.createElement('div');
    panel.id = 'ffq-panel';
    // docked inside the page like a native Torn block (full width, scrolls with the page)
    panel.style.cssText = 'position:relative;box-sizing:border-box;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;width:auto;margin:8px 0;background:#1f2933;color:#e6e6e6;border:1px solid #4a4f57;border-radius:6px;padding:34px 10px 10px;font:bold 13px Arial,sans-serif';

    const grip     = handle('▼', '', 'position:absolute;top:4px;left:4px;cursor:pointer;font-size:16px;padding:4px 10px');
    const info     = document.createElement('span');
    info.style.cssText = 'flex:1 1 100%;text-align:center;font-size:14px';
    const btnRow   = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-wrap:nowrap;gap:8px;flex:1 1 100%;min-width:0';
    const sendBtn  = button('#15803d', step);
    const vaultBtn = button('#ea580c', toVault);
    const releaseBtn = button('#92400e', () => {
      const it = S.q[S.i];
      if (!it[4] || paid(S) || !confirm('Release [' + it[0] + '] from the support panel queue? This skips them without paying.')) return;
      window.open('https://ffscouter.com/supportpanel/payment-provider?ffrelease=' + it[4], '_blank');
      (S.r = S.r || []).push(S.i);
      S.d.push(S.i);
      save(S);
      show();
    });
    releaseBtn.textContent = 'Release';
    releaseBtn.title = 'Releases this job on the FFScouter support panel and skips it';
    const nextBtn  = button('#00ADB5', () => onPage(S) ? next() : (location.href = urlFor(S, S.i)));
    const keyBtn   = button('#374151', chooseKey);
    if (isPDA) keyBtn.style.display = 'none';   // no keyboard shortcuts on PDA
    keyBtn.title   = 'Click, then press the key you want for SEND / CONFIRM / NEXT';
    const stopBtn  = button('#7a1a1a', () => { localStorage.removeItem(KEY); S = null; panel.remove(); });
    stopBtn.textContent = '✕';
    stopBtn.style.cssText += ';position:absolute;top:4px;right:4px;padding:3px 10px;font-size:13px';
    // fixed proportions on one non-wrapping row: the label shrinks to fit instead of the button resizing
    [[sendBtn, '3 1 0'], [nextBtn, '1.3 1 0'], [releaseBtn, '1 1 0'], [vaultBtn, '1 1 100%']].forEach(([b, f]) => {
      b.style.cssText += ';box-sizing:border-box;flex:' + f + ';height:40px;padding:0 8px;white-space:nowrap;overflow:hidden;min-width:0;text-align:center';
    });
    function fit(b, max) {
      if (b._fitText === b.textContent && b._fitW === b.clientWidth) return;
      b._fitText = b.textContent;
      let size = max;
      b.style.fontSize = size + 'px';
      while (b.clientWidth && b.scrollWidth > b.clientWidth && size > 8) b.style.fontSize = --size + 'px';
      b._fitW = b.clientWidth;
    }
    btnRow.append(sendBtn, releaseBtn, nextBtn);
    panel.append(grip, info, btnRow, vaultBtn, keyBtn, stopBtn);

    // The ▼ / ▲ handle flips the panel between the top and bottom of the content; the choice is remembered.
    let dock = 'top';
    try { dock = (JSON.parse(localStorage.getItem(KEY_UI)) || {}).dock || 'top'; } catch (e) {}
    const dockHost = () => document.querySelector('.content-wrapper') || document.getElementById('mainContainer') || document.body;
    function dockPanel() {
      const host = dockHost();
      if (dock === 'top') { if (host.firstElementChild !== panel) host.prepend(panel); }
      else if (host.lastElementChild !== panel) host.append(panel);
    }
    const gripLabel = () => {
      grip.textContent = dock === 'top' ? '▼' : '▲';
      grip.title = 'Move to the ' + (dock === 'top' ? 'bottom' : 'top') + ' of the page';
    };
    gripLabel();
    grip.onclick = () => {
      dock = dock === 'top' ? 'bottom' : 'top';
      gripLabel();
      localStorage.setItem(KEY_UI, JSON.stringify({ dock: dock }));
      dockPanel();
    };
    dockPanel();
    setInterval(() => { if (S && !panel.isConnected) dockPanel(); }, 500);   // Torn re-renders the page

    function show() {
      if (!S) return;
      const it = S.q[S.i], here = onPage(S), n = need(S), amt = '$' + Number(it[1]).toLocaleString('en-US');
      info.textContent = '#' + (S.i + 1) + '/' + S.q.length + ' · [' + it[0] + '] · ' + amt + (atVault ? ' · VAULT' : here ? '' : ' · ⚠ not on this player');

      let text, bg;
      if (atVault)         { text = withdrew || !n ? 'BACK TO QUEUE ▶' : 'WITHDRAW $' + n.toLocaleString('en-US'); bg = withdrew || !n ? '#00ADB5' : '#ea580c'; }
      else if (paid(S))    { text = (S.r || []).indexOf(S.i) !== -1 ? 'RELEASED · NEXT ▶' : 'PAID ✓ · NEXT ▶'; bg = '#00ADB5'; }
      else if (sending)    { text = 'SENDING…';        bg = '#4a4f57'; }
      else if (wait() > 0) { text = 'WAIT ' + (Math.ceil(wait() / 100) / 10).toFixed(1) + 's'; bg = '#4a4f57'; }
      else if (armed === S.i && Date.now() - armedAt <= ARM_MS) { text = 'CONFIRM ' + amt + ' → [' + it[0] + ']'; bg = '#1d4ed8'; }
      else                 { text = 'SEND ' + amt + ' → [' + it[0] + ']'; bg = '#15803d'; }
      sendBtn.textContent = text;
      sendBtn.style.background = bg;
      sendBtn.style.display = here || atVault ? '' : 'none';

      releaseBtn.style.display = it[4] && !paid(S) && !atVault ? '' : 'none';
      vaultBtn.style.display = n > 0 && !atVault ? '' : 'none';
      vaultBtn.textContent = 'VAULT $' + n.toLocaleString('en-US');
      vaultBtn.title = 'Opens your vault with $' + n.toLocaleString('en-US') + ' pre-filled (cash the rest of the queue still needs)';

      nextBtn.textContent = !here ? 'Open ▶' : (S.i === S.q.length - 1 ? 'Finish' : 'Next ▶');
      keyBtn.textContent  = capturing ? 'Press a key…' : 'Key: ' + keyName(getKey());
      fit(sendBtn, 14); fit(nextBtn, 14); fit(vaultBtn, 14);
    }

    show();
    setInterval(show, 250);
  }

  // ── properties.php: vault pre-fill + ID / price / happiness bar ──
  function propertiesPage() {
    const want = parseInt(q.get('ffvault'), 10);
    if (want > 0) {
      let tries = 0;
      const t = setInterval(() => {
        const hidden = document.querySelector('input[name="withdraw"]');
        const group  = hidden && hidden.closest('.input-money-group');
        const box    = group && group.querySelector('input.input-money:not([type="hidden"])');
        if (box) { clearInterval(t); setValue(box, String(want)); }
        else if (++tries > 100) clearInterval(t);
      }, 100);
    }

    const chip = (text, href) => {
      const c = document.createElement(href ? 'a' : 'span');
      c.textContent = text;
      c.style.cssText = 'padding:3px 7px;border-radius:4px;border:1px solid rgba(255,255,255,.16);white-space:nowrap;color:#fff;text-decoration:none;' +
        (href ? 'background:#0b7285;pointer-events:auto;cursor:pointer' : 'background:rgba(15,20,25,.85)');
      if (href) {
        c.href = href;
        c.target = '_blank';
        c.rel = 'noopener noreferrer';
        c.addEventListener('click', e => e.stopPropagation());
      }
      return c;
    };

    const addBars = () => document.querySelectorAll('ul.properties-list > li .image-place[data-id]').forEach(holder => {
      if (holder.querySelector('.ffq-bar')) return;
      const id = holder.dataset.id, info = {};
      holder.querySelectorAll('ul.info li').forEach(li => {
        const label = li.querySelector('.wai');
        if (label) info[label.textContent.trim()] = li.textContent.replace(label.textContent, '').trim();
      });
      const bar = document.createElement('div');
      bar.className = 'ffq-bar';
      bar.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;z-index:6;display:flex;flex-wrap:wrap;gap:4px;pointer-events:none;font:bold 11px/1.2 Arial,sans-serif';
      bar.appendChild(id === '0' ? chip('ID 0')   // default shack has no real ID
                                 : chip('ID ' + id + ' ↗', 'https://ffscouter.com/supportpanel/mortgages/by-property/' + id));
      if (info['Market price']) bar.appendChild(chip('Market ' + info['Market price']));
      if (info['Happiness'])    bar.appendChild(chip('Max happy ' + Number(info['Happiness']).toLocaleString('en-US')));
      if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
      holder.appendChild(bar);
    });

    new MutationObserver(addBars).observe(document.body, { childList: true, subtree: true });
    addBars();
  }

  // ── item.php: item send pre-fill (ported from Dabs Den Quick Send); you click Send ──
  async function itemPrefill() {
    const userId = q.get('userid'), itemId = q.get('itemid'), qty = q.get('quantity') || '1', message = q.get('message') || '';
    if (!/^\d+$/.test(userId || '') || !/^\d+$/.test(itemId || '')) return;

    const sleep   = ms => new Promise(r => setTimeout(r, ms));
    const visible = el => !!el && el.offsetParent !== null;
    async function waitFor(fn, ms) {
      const end = Date.now() + (ms || 8000);
      while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
      return null;
    }
    const describe   = el => [el.name, el.className, el.placeholder, el.id, el.getAttribute('aria-label')].join(' ').toLowerCase();
    const textInputs = scope => [...scope.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea')].filter(visible);
    function toast(text) {
      const d = document.createElement('div');
      d.textContent = text;
      d.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:999999;max-width:90vw;padding:10px 16px;border-radius:8px;font:bold 13px Arial,sans-serif;color:#111;background:#d4a017;box-shadow:0 4px 16px rgba(0,0,0,.5)';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 7000);
    }

    const itemRow = () => [...document.querySelectorAll('li[data-item="' + itemId + '"]')]
      .find(li => visible(li) && !li.closest('[class*="quick" i], [id*="quick" i]') && li.querySelector('.option-send, button[class*="send"]'));

    let li = await waitFor(itemRow, 2500);
    if (!li) {
      toast('Open the inventory tab that has the item. The Send form fills in as soon as it shows up.');
      li = await waitFor(itemRow, 120000);
    }
    if (!li) return toast('Item ' + itemId + ' is not in your inventory');
    li.scrollIntoView({ block: 'center' });

    const openForm = () => {
      li.querySelector('.option-send, button[class*="send"]').click();
      return waitFor(() => {
        for (const s of [li, li.nextElementSibling].filter(Boolean)) {
          const inputs = textInputs(s);
          if (inputs.length >= 2) return { scope: s, inputs: inputs };
        }
        return null;
      }, 4000);
    };
    const form = (await openForm()) || (await openForm());
    if (!form) return toast('The Send form did not open. Click Send on the item yourself.');

    const pick   = re => form.inputs.find(el => re.test(describe(el)));
    const user   = pick(/user-id|userid|player|recipient|ac-search/) || form.inputs[0];
    const amount = pick(/amount|qty|quantity|count/);
    setValue(user, userId);
    if (amount) setValue(amount, qty);

    let box = null;
    if (message) {
      const find = () => [...form.scope.querySelectorAll('input[name="tag"], input.message, textarea')].find(visible);
      box = find();
      if (!box) {
        const add = form.scope.querySelector('a.action-message, [class*="action-message"]');
        if (add) { add.click(); box = await waitFor(find, 3000); }
      }
      if (box && box !== user && box !== amount) setValue(box, message);
    }

    const send = [...form.scope.querySelectorAll('button, input[type="submit"], input[type="button"], a')]
      .filter(visible).find(b => /^\s*send\b/i.test(b.value || b.textContent || ''));
    if (send) { send.style.outline = '3px solid #d4a017'; send.style.outlineOffset = '2px'; send.focus(); }

    toast(message && !box
      ? 'Filled in, but add the message yourself: "' + message + '". Then click Send.'
      : 'Ready: ' + qty + ' to ' + userId + (message ? ', message "' + message + '"' : '') + '. Check it, then click Send.');
  }

})();
