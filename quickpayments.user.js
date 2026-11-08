// ==UserScript==
// @name         FFScouter - Profile Payment Pre-fill & Mail Pre-fill
// @namespace    https://ffscouter.com/
// @version      5.1
// @description  Pre-fills profile send-money (paymentamount, paymentref) and messages.php compose (mailsubject, mailbody). Added: FFScouter payment queue with a movable, resizable panel (two-step SEND by click or hotkey, delay between payments, VAULT or ghost-trade shortfall button), item.php send pre-fill (e.g. Xanax), a property ID / market price / happiness bar, and an outreach mail queue (loss-buy-marketing to Torn compose, 10 s gap between mails).
// @author       FFScouter / Glasnost [1844049] & Solenya [4053619]
// @match        https://www.torn.com/profiles.php*
// @match        https://www.torn.com/messages.php*
// @match        https://www.torn.com/properties.php*
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/trade.php*
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

// SOLENYA ADDITIONS // 
(function () {
  'use strict';

  const q    = new URLSearchParams(location.search);
  const path = location.pathname;

  const VERSION    = '5.1';   // keep in sync with @version above
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

  // ── shared by the payment and mail queue panels ──
  const keyName = c => ({ ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓' }[c] || c.replace(/^(Key|Digit)/, ''));
  const strip   = t => String(t || '').replace(/<[^>]*>/g, '').trim();
  const button = (bg, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'background:' + bg + ';color:#fff;border:0;border-radius:6px;padding:10px 14px;font:bold 14px Arial,sans-serif;cursor:pointer';
    b.addEventListener('click', e => { if (e.isTrusted) fn(); });
    return b;
  };
  // fixed proportions on one non-wrapping row: the label shrinks to fit instead of the button resizing
  const flexBtn = (b, f) => { b.style.cssText += ';box-sizing:border-box;flex:' + f + ';height:40px;padding:0 8px;white-space:nowrap;overflow:hidden;min-width:0;text-align:center'; };
  const flexRow = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex;flex-wrap:nowrap;gap:8px;flex:1 1 100%;min-width:0'; return r; };
  function fit(b, max) {
    if (b._fitText === b.textContent && b._fitW === b.clientWidth) return;
    b._fitText = b.textContent;
    let size = max;
    b.style.fontSize = size + 'px';
    while (b.clientWidth && b.scrollWidth > b.clientWidth && size > 8) b.style.fontSize = --size + 'px';
    b._fitW = b.clientWidth;
  }

  // one note at a time, pinned to the bottom (above PDA's bottom bar). ok: true green, false red, 'warn' yellow
  function note(text, ok) {
    const old = document.getElementById('ffq-note');
    if (old) old.remove();
    const n = document.createElement('div');
    n.id = 'ffq-note';
    n.textContent = text;
    n.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:2147483647;border-radius:6px;padding:8px 12px;font:bold 13px Arial,sans-serif;max-width:92vw;text-align:center;border:1px solid;bottom:' + (isPDA ? '84px' : '24px') + ';' +
      (ok === 'warn' ? 'background:#4a3a0a;color:#fde68a;border-color:#d4a017' : ok ? 'background:#14532d;color:#d1fae5;border-color:#22c55e' : 'background:#7a1a1a;color:#f8d7da;border-color:#e05555');
    n.onclick = () => n.remove();
    document.body.appendChild(n);
    setTimeout(() => n.remove(), ok === 'warn' ? 10000 : 6000);
  }

  // ledger of ids already done ({id: time}), each kept for ttl ms; one per site, since Torn and ffscouter storage are apart
  function ledger(key, ttl) {
    let l = {};
    try { l = JSON.parse(localStorage.getItem(key)) || {}; } catch (e) {}
    Object.keys(l).forEach(k => { if (Date.now() - l[k] > ttl) delete l[k]; });
    return l;
  }
  function remember(key, ttl, pairs) {
    const l = ledger(key, ttl);
    pairs.forEach(([k, t]) => { if (k && t > 0) l[k] = Math.min(t, Date.now()); });
    try { localStorage.setItem(key, JSON.stringify(l)); } catch (e) {}
    return l;
  }
  // Torn side: tell the ffscouter page that opened this queue (if it is still open) which ids are done
  function tellPanel(field, l) {
    const data = { [field]: Object.keys(l).map(k => [k, l[k]]) };
    if (!data[field].length || !window.opener) return;
    ['https://ffscouter.com', 'https://www.ffscouter.com'].forEach(o => { try { window.opener.postMessage(data, o); } catch (e) {} });
  }
  // ffscouter side: the done ids come back by postMessage, or on PDA (tabs cannot message each other) in the #hash
  // of the Torn panel's "Panel ↩" link
  function inbox(field, add) {
    window.addEventListener('message', e => {
      if (e.origin === 'https://www.torn.com' && e.data && Array.isArray(e.data[field])) add(e.data[field].map(r => [String(r[0]), Number(r[1])]));
    });
    const m = new RegExp('(?:^#|&)' + field.toLowerCase() + '=([^&]*)').exec(location.hash);
    if (m) {
      add(decodeURIComponent(m[1]).split(',').filter(Boolean).map(id => [id, Date.now()]));
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // ffscouter: the orange "send to Torn" button (refreshed every second); extra() runs on each refresh
  const floatBtn = (bottom, bg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'position:fixed;right:16px;bottom:' + bottom + 'px;z-index:2147483647;background:' + bg + ';color:#fff;border:0;border-radius:6px;padding:10px 14px;font:bold 14px Arial,sans-serif;cursor:pointer';
    document.body.appendChild(b);
    return b;
  };
  function queueLauncher(usable, label, url, extra) {
    const btn = floatBtn(16, '#ea580c');
    const refresh = () => {
      const n = usable().length;
      btn.textContent   = label(n);
      btn.disabled      = !n;
      btn.style.opacity = n ? '1' : '0.5';
      if (extra) extra();
    };
    setInterval(refresh, 1000);
    refresh();
    btn.addEventListener('click', () => { if (usable().length) window.open(url(), '_blank'); });
    return refresh;
  }

  // watch Torn's own XHR / fetch replies: fn(url, request body, reply text)
  function hookCalls(fn) {
    const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this._ffUrl = String(u); return xhrOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
      this.addEventListener('load', () => fn(this._ffUrl, body, this.responseText));
      return xhrSend.apply(this, arguments);
    };
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url, body = init && init.body;
      return nativeFetch.apply(this, arguments).then(r => { r.clone().text().then(t => fn(url, body, t)).catch(() => {}); return r; });
    };
  }

  // a queue panel docked inside the page like a native Torn block: grip, info line, button row, hotkey picker, ✕.
  // The hotkey runs step(); typing in a field never triggers it (typeKeysOnly: only keys that type a character are
  // left alone there, so an arrow key still works while Torn's To field has focus)
  function makePanel(step, stop, typeKeysOnly) {
    const KEY_HK = 'ffscouter_hotkey_v1';
    const getKey = () => localStorage.getItem(KEY_HK) || 'ArrowRight';
    let held = false, capturing = false;

    const panel = document.createElement('div');
    panel.id = 'ffq-panel';
    panel.style.cssText = 'position:relative;box-sizing:border-box;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;width:auto;margin:8px 0;background:#1f2933;color:#e6e6e6;border:1px solid #4a4f57;border-radius:6px;padding:34px 10px 10px;font:bold 13px Arial,sans-serif';
    const grip = document.createElement('span');
    grip.style.cssText = 'color:#9aa7b2;user-select:none;-webkit-user-select:none;touch-action:none;position:absolute;top:4px;left:4px;cursor:pointer;font-size:16px;padding:4px 10px';
    const info = document.createElement('span');
    info.style.cssText = 'flex:1 1 100%;text-align:center;font-size:14px';
    const btnRow = flexRow();
    const keyLabel = () => { keyBtn.textContent = capturing ? 'Press a key…' : 'Key: ' + keyName(getKey()); };
    const keyBtn = button('#374151', () => {
      capturing = true;
      keyLabel();
      document.addEventListener('keydown', function pick(e) {
        if (/^(Shift|Control|Alt|Meta)$/.test(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('keydown', pick, true);
        if (e.key !== 'Escape') localStorage.setItem(KEY_HK, e.code);
        held = e.key !== 'Escape';
        capturing = false;
        keyLabel();
      }, true);
    });
    if (isPDA) keyBtn.style.display = 'none';   // no keyboard shortcuts on PDA
    keyBtn.title = 'Click, then press the key you want for the queue button';
    keyLabel();
    const stopBtn = button('#7a1a1a', () => { stop(); panel.remove(); });
    stopBtn.textContent = '✕';
    stopBtn.style.cssText += ';position:absolute;top:4px;right:4px;padding:3px 10px;font-size:13px';
    grip.className = info.className = stopBtn.className = 'ffq-keep';
    panel.append(grip, info, btnRow, keyBtn, stopBtn);

    function onKey(e) {
      if (capturing || e.code !== getKey()) return;
      if (e.repeat || held) return;   // a held key never repeats
      held = true;
      const a = (e.target.ownerDocument || document).activeElement || {};
      if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if ((!typeKeysOnly || e.key.length === 1) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      e.preventDefault();
      step();
    }
    const listen = doc => {
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('keyup', e => { if (e.code === getKey()) held = false; }, true);
    };
    listen(document);
    window.addEventListener('blur', () => { held = false; });
    return { panel, grip, info, btnRow, keyBtn, listen };
  }

  // the way back to the ffscouter page: a queue tab it opened closes itself; on PDA the panel tab is reloaded with
  // the done ids in its #hash. Adds the PDA "Panel ↩" link and returns finished(), run when the queue ends.
  function backTools(panel, panelUrl, title, doneText) {
    const backLink = (text, css) => {
      const a = document.createElement('a');
      a.textContent = text;
      a.title = title;
      a.style.cssText = 'color:#fff;background:#374151;border-radius:6px;text-decoration:none;font:bold 13px Arial,sans-serif;padding:4px 10px;' + css;
      a.addEventListener('click', e => {
        a.href = panelUrl();
        if (window.opener && !window.opener.closed) { e.preventDefault(); closeTab(panelUrl(), () => { location.href = panelUrl(); }); }
      });
      a.href = panelUrl();
      return a;
    };
    if (isPDA) { const pl = backLink('Panel ↩', 'position:absolute;top:4px;left:44px'); pl.className = 'ffq-keep'; panel.append(pl); }
    return () => {
      setTimeout(() => closeTab(panelUrl()), 1500);   // long enough to read the "finished" note
      if (!isPDA) return;
      const b = document.createElement('div');
      b.style.cssText = 'margin:8px 0;padding:10px;text-align:center;background:#14532d;color:#d1fae5;border:1px solid #22c55e;border-radius:6px;font:bold 14px Arial,sans-serif';
      b.append(doneText, backLink('Back to panel ↩', 'margin-left:8px'));
      dockHost().prepend(b);
    };
  }

  // a queue tab was opened by the panel's button, so it may close itself. On PDA the panel tab is first reloaded
  // with the sent list in its #hash (PDA tabs cannot message each other). If the tab cannot close, fallback runs.
  function closeTab(panelUrl, fallback) {
    try {
      if (window.opener && !window.opener.closed) {
        if (isPDA) window.opener.location.href = panelUrl;
        window.close();
      }
    } catch (e) {}
    if (fallback) setTimeout(() => { if (!window.closed) fallback(); }, 500);
  }

  // queue panels sit at the top of the page like a native Torn block. The ▲ / ▼ handle minimises a panel to its
  // info line (the hotkey still works); the choice is remembered. Parts marked .ffq-keep stay visible when minimised.
  const dockHost = () => document.querySelector('.content-wrapper') || document.getElementById('mainContainer') || document.body;
  function dockPanel(panel, grip, alive) {
    const KEY_UI = 'ffscouter_panel_ui_v1';
    if (!document.getElementById('ffq-style')) {
      const st = document.createElement('style');
      st.id = 'ffq-style';
      st.textContent = '#ffq-panel[data-min="1"]>:not(.ffq-keep){display:none!important}#ffq-panel[data-min="1"]{padding-bottom:8px!important}';
      document.head.appendChild(st);
    }
    let min = false;
    try { min = !!(JSON.parse(localStorage.getItem(KEY_UI)) || {}).min; } catch (e) {}
    const label = () => {
      panel.dataset.min = min ? '1' : '';
      grip.textContent = min ? '▼' : '▲';
      grip.title = min ? 'Show the queue buttons' : 'Minimise the panel (the hotkey still works)';
    };
    label();
    grip.onclick = () => {
      min = !min;
      label();
      localStorage.setItem(KEY_UI, JSON.stringify({ min: min }));
    };
    const put = () => { const host = dockHost(); if (host.firstElementChild !== panel) host.prepend(panel); };
    put();
    setInterval(() => { if (alive() && !panel.isConnected) put(); }, 500);   // Torn re-renders the page
  }

  if (/(^|\.)ffscouter\.com$/.test(location.hostname)) return /\/loss-buy-marketing\/?$/.test(path) ? outreachSender() : ffscouterSender();
  if (path === '/properties.php') { propertiesPage(); if (q.has('ffvault')) queuePanel(); return; }
  if (path === '/trade.php')      { if (q.has('fftrade')) queuePanel(); return; }
  if (path === '/item.php')       return itemPrefill().catch(e => console.error('[FFScouter item]', e));
  if (path === '/profiles.php')   return queuePanel();
  if (path === '/messages.php')   return mailPanel();

  // ── ffscouter.com: send pending payments to Torn as a queue ──
  function ffscouterSender() {
    // payments the Torn queue tab reported as sent, keyed by the payment's code (the LP-… first word of its message,
    // unique per job); left out of the next queue so a job the panel has not confirmed yet is never paid again
    const KEY_SENT = 'ffscouter_sent_v1', SENT_TTL = 30 * 60 * 1000;
    const code = ref => String(ref).trim().split(/\s+/)[0];
    inbox('ffSent', p => remember(KEY_SENT, SENT_TTL, p.map(([c, t]) => [code(c), t]).filter(([c]) => /^[\w-]+$/.test(c))));

    const usable = () => { const l = ledger(KEY_SENT, SENT_TTL); return [...document.querySelectorAll('#claimed-jobs .job-card[data-job-status="pending"] a[data-receiver-link]')]
      .filter(a => { const u = new URL(a.href), p = u.searchParams; return u.pathname === '/profiles.php' && p.get('XID') && p.get('paymentamount') && p.get('paymentref') && !l[code(p.get('paymentref'))]; }); };   // profile pay links only, never a mail Compose link

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

    // where the Torn queue takes you when cash runs short: the vault or your ghost trade. Saved here and sent with
    // every queue, so it is the default until it is clicked again
    const KEY_SRC = 'ffscouter_cashsrc_v1';
    const cashSrc = () => localStorage.getItem(KEY_SRC) === 'trade' ? 'trade' : 'vault';
    const srcBtn = floatBtn(62, '#374151');
    srcBtn.title = 'Where the Torn queue gets cash when you run short. Click to switch.';
    srcBtn.addEventListener('click', () => { localStorage.setItem(KEY_SRC, cashSrc() === 'trade' ? 'vault' : 'trade'); refresh(); });

    function queueUrl() {
      const links = usable();
      const rows  = links.map(a => new URL(a.href).searchParams);
      const ref0  = rows[0].get('paymentref');
      const sfx   = ref0.indexOf(' ') < 0 ? '' : ref0.slice(ref0.indexOf(' '));
      const queue = rows.map((p, i) => {
        const ref = p.get('paymentref');
        return [p.get('XID'), p.get('paymentamount'),
                sfx && ref.endsWith(sfx) ? ref.slice(0, -sfx.length) + '§' : ref,   // § = shared ending, kept once
                p.get('anonymous') === '1' ? 1 : 0, jobId(links[i])];
      });
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ s: sfx, q: queue, c: cashSrc() }))));
      // first player's profile without the pay pre-fill: if Torn knows that job is already paid, it moves on to the
      // first unpaid player itself, and an empty form there can never pay them twice
      return 'https://www.torn.com/profiles.php?XID=' + rows[0].get('XID') + '&ffq=' + encodeURIComponent(b64);
    }

    const refresh = queueLauncher(usable, n => n ? 'Send ' + n + ' to Torn queue' : 'No pending payments', queueUrl,
      () => { srcBtn.textContent = 'Cash from: ' + (cashSrc() === 'trade' ? 'Ghost trade' : 'Vault') + ' ⇄'; });
  }

  // ── ffscouter.com loss-buy-marketing: send the claimed outreach mails to Torn as a queue ──
  function outreachSender() {
    // mails the Torn queue tab reported as done (sent, failed or skipped), by the row's data-compose-assign id;
    // left out of the next queue
    const KEY_MAILED = 'ffscouter_mailed_v1', MAILED_TTL = 7 * 24 * 3600 * 1000;
    const mailed = () => ledger(KEY_MAILED, MAILED_TTL);
    inbox('ffMailed', p => remember(KEY_MAILED, MAILED_TTL, p.filter(([id]) => /^\d+$/.test(id))));

    // [XID, name, subject, html body, assign id] from a row's pre-filled Torn compose link
    const row = a => {
      try {
        const u = new URL(a.href);
        if (u.hostname !== 'www.torn.com' || u.pathname !== '/messages.php') return null;
        const p = new URLSearchParams(u.hash.slice(u.hash.indexOf('&') + 1));
        const x = p.get('XID'), s = p.get('mailsubject'), b = p.get('mailbody');
        return /^\d+$/.test(x || '') && s && b ? [x, a.textContent.replace(/\s*\[\d+\]\s*$/, '').trim(), s, b, a.dataset.composeAssign] : null;
      } catch (e) { return null; }
    };
    // claimed rows only: the "Clicked" list below has no data-compose-assign and is never queued
    const links  = () => [...document.querySelectorAll('#outreach-rows a[data-compose-assign]')]
      .filter(a => !a.closest('#outreach-clicked-wrap') && /^\d+$/.test(a.dataset.composeAssign));
    // every listed batch is queued, minus the mails already done from this browser
    const boxOf   = a => a.closest('.border') || a.parentElement;
    const usable  = () => { const l = mailed(); return links().filter(a => !l[a.dataset.composeAssign]).map(row).filter(Boolean); };

    function queueUrl() {
      const queue = usable();
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ q: queue }))));
      // the queue rides in the #hash, which never reaches a server; the first mail's compose page opens with its recipient
      return 'https://www.torn.com/messages.php?ffmail=0#/p=compose&XID=' + queue[0][0] + '&ffm=' + encodeURIComponent(b64);
    }

    queueLauncher(usable, n => n ? 'Send ' + n + ' mail' + (n > 1 ? 's' : '') + ' to Torn queue' : 'No mails to send', queueUrl, () => {
      // dim the rows already done from this browser (the panel counts them once Torn's logs confirm)
      const l = mailed();
      links().forEach(a => {
        const box = boxOf(a);
        if (!l[a.dataset.composeAssign] || box.dataset.ffMailed) return;
        box.dataset.ffMailed = '1';
        box.style.opacity = '0.45';
        const tag = document.createElement('span');
        tag.textContent = 'Done ✓ (mailed or skipped)';
        tag.style.cssText = 'margin-left:8px;color:#22c55e;font-size:12px';
        a.after(tag);
      });
    });
  }

  // ── profiles.php: queue panel (hit 1 arm, hit 2 send, hit 3 next) ──
  function queuePanel() {
    const KEY = 'ffscouter_queue_v2', KEY_LAST = 'ffscouter_lastsend_v1';
    const KEY_SRC = 'ffscouter_cashsrc_v1', KEY_GHOST = 'ffscouter_ghosttrade_v1';
    const SEND_GAP = 2000;
    const ARM_MS   = 30000;

    const load = () => {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        return s && s.i < s.q.length && Date.now() - s.t < 6 * 3600 * 1000 ? s : null;
      } catch (e) { return null; }
    };
    const save = s => { s.t = Date.now(); localStorage.setItem(KEY, JSON.stringify(s)); };

    // ledger of payments already sent (by their unique payment reference), so a job the panel still shows
    // as pending is not paid twice when it comes back in a later queue
    const KEY_SENT = 'ffscouter_sent_v1', SENT_TTL = 30 * 60 * 1000;
    const markSent = ref => tellPanel('ffSent', remember(KEY_SENT, SENT_TTL, [[String(ref).trim(), Date.now()]]));
    tellPanel('ffSent', ledger(KEY_SENT, SENT_TTL));

    // also remember payments sent with Torn's own SEND button (the pre-filled form), not just the queue's:
    // watch Torn's sendcash.php calls and record the message of every one Torn confirms
    hookCalls((url, body, text) => {
      if (!/sendcash\.php/.test(url || '')) return;
      try {
        const p = body instanceof FormData ? body : new URLSearchParams(typeof body === 'string' ? body : '');
        if (/cash1/.test(p.get('step') || '') && p.get('tag') && JSON.parse(text).success === true) markSent(p.get('tag'));
      } catch (e) {}
    });

    if (q.get('ffq')) {
      try {
        const p = JSON.parse(decodeURIComponent(escape(atob(q.get('ffq')))));
        const l = ledger(KEY_SENT, SENT_TTL);
        const rows = p.q.filter(r => /^\d+$/.test(r[0]) && /^\d+$/.test(r[1]));
        const fresh = rows.filter(r => !l[String(r[2]).replace('§', () => p.s || '').trim()]);
        if (fresh.length) save({ q: fresh, s: p.s || '', i: 0, d: [] });
        else localStorage.removeItem(KEY);
        if (p.c === 'trade' || p.c === 'vault') localStorage.setItem(KEY_SRC, p.c);   // the support panel's choice
        const skipped = rows.length - fresh.length;
        if (skipped) note(skipped + ' payment' + (skipped > 1 ? 's' : '') + ' already sent from this browser - left out of the queue. Wait for the panel to confirm them.', 'warn');
        // the queue link lands on the panel's first job with no pre-fill. If Torn knows that one is already paid,
        // the panel shows "not on this player" and its Open button takes you to the first unpaid player: one click,
        // one page load - nothing is loaded on Torn without your input
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

    function need(s) {
      if (paid(s)) return 0;   // sidebar cash may not be updated yet
      let sum = 0;
      for (let j = s.i; j < s.q.length; j++) if (s.d.indexOf(j) === -1) sum += Number(s.q[j][1]);
      return Math.max(0, sum - cash()) || 0;
    }

    let armed = -1, armedAt = 0, sending = false;

    // vault page: hit 1 withdraw, hit 2 back to the queue
    const atVault = path === '/properties.php';
    let withdrew = false;
    const toVault = () => { location.href = 'https://www.torn.com/properties.php?ffvault=' + need(S) + '#/p=options&tab=vault'; };
    const withdrawBtn = () => [...document.querySelectorAll('input[type="submit"].torn-btn')]
      .find(b => /^withdraw$/i.test(b.value) && b.offsetParent !== null);
    if (atVault) document.addEventListener('click', e => { if (e.isTrusted && e.target === withdrawBtn()) withdrew = true; }, true);

    // where short cash comes from: the vault (amount pre-filled) or a ghost trade (take the money out by hand).
    // The choice is remembered for every queue until it is flipped again.
    const src = () => localStorage.getItem(KEY_SRC) === 'trade' ? 'trade' : 'vault';
    const atTrade = path === '/trade.php';
    // the last trade opened from the queue is taken to be the ghost trade, so the next trip goes straight to it
    const ghostId = () => (/^\d+$/.test(localStorage.getItem(KEY_GHOST) || '') ? localStorage.getItem(KEY_GHOST) : '');
    const toTrade = () => { location.href = 'https://www.torn.com/trade.php?fftrade=' + need(S) + (ghostId() ? '#step=view&ID=' + ghostId() : '#'); };
    const toCash  = () => src() === 'trade' ? toTrade() : toVault();
    if (atTrade) setInterval(() => {
      const m = /[#&]step=view&ID=(\d+)/.exec(location.hash);
      if (m && m[1] !== ghostId()) localStorage.setItem(KEY_GHOST, m[1]);
    }, 500);

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
      if (S.i >= S.q.length - 1) { localStorage.removeItem(KEY); S = null; P.panel.remove(); finished(); return; }
      S.i++; save(S);
      location.href = urlFor(S, S.i);
    }

    function step() {
      if (!S || sending) return;
      if (atVault) return vaultStep();
      if (atTrade) return (location.href = urlFor(S, S.i));
      if (paid(S)) return next();
      if (wait() > 0) return;
      const it = S.q[S.i];
      if (!onPage(S)) return note('Press Open first - this is not the queue player.');
      if (cash() < Number(it[1])) return toCash();
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
        if (j.success === true) {
          S.d.push(S.i); markSent(msg(S, S.i)); save(S);
          const last = S.i === S.q.length - 1;
          note((strip(j.text) || 'Sent ✓') + (last ? ' · Queue finished ✓' : ''), true);
          if (last) next();   // last player paid: close the queue
        }
        else note(strip(j.text) || 'Torn did not confirm the payment - check your send log before retrying.');
      }).catch(() => note('Request failed - check your Torn send log before retrying.'))
        .then(() => { localStorage.setItem(KEY_LAST, Date.now()); sending = false; show(); });
    }

    const P = makePanel(step, () => { localStorage.removeItem(KEY); S = null; }, false);
    P.keyBtn.title = 'Click, then press the key you want for SEND / CONFIRM / NEXT';
    const sendBtn  = button('#15803d', step);
    const vaultBtn = button('#ea580c', toCash);
    const srcBtn   = button('#374151', () => { localStorage.setItem(KEY_SRC, src() === 'trade' ? 'vault' : 'trade'); show(); });
    const releaseBtn = button('#92400e', () => {
      const it = S.q[S.i];
      if (!it[4] || paid(S) || !confirm('Release [' + it[0] + '] from the support panel queue? This skips them without paying.')) return;
      window.open('https://ffscouter.com/supportpanel/payment-provider?ffrelease=' + it[4], '_blank');
      (S.r = S.r || []).push(S.i);
      S.d.push(S.i);
      save(S);
      if (S.i === S.q.length - 1) { note('Released · Queue finished ✓', true); return next(); }   // last player released: close the queue
      show();
    });
    releaseBtn.textContent = 'Release';
    releaseBtn.title = 'Releases this job on the FFScouter support panel and skips it';
    const nextBtn  = button('#00ADB5', () => onPage(S) ? next() : (location.href = urlFor(S, S.i)));
    [[sendBtn, '3 1 0'], [nextBtn, '1.3 1 0'], [releaseBtn, '1 1 0'], [vaultBtn, '3 1 0'], [srcBtn, '1.3 1 0']].forEach(([b, f]) => flexBtn(b, f));
    const cashRow  = flexRow();
    P.btnRow.append(sendBtn, releaseBtn, nextBtn);
    cashRow.append(vaultBtn, srcBtn);
    P.btnRow.after(cashRow);

    // payments sent here go back to the support panel, which leaves them out of the next queue
    const panelUrl = () => 'https://ffscouter.com/supportpanel/payment-provider#ffsent=' +
      encodeURIComponent(Object.keys(ledger(KEY_SENT, SENT_TTL)).map(k => k.split(/\s+/)[0]).join(','));
    const finished = backTools(P.panel, panelUrl, 'Back to the support panel; payments sent here are left out of the next queue', 'Queue finished ✓ ');
    dockPanel(P.panel, P.grip, () => S);

    function show() {
      if (!S) return;
      const it = S.q[S.i], here = onPage(S), n = need(S), amt = '$' + Number(it[1]).toLocaleString('en-US');
      P.info.textContent = '#' + (S.i + 1) + '/' + S.q.length + ' · [' + it[0] + '] · ' + amt +
        (atVault ? ' · VAULT' : atTrade ? ' · TRADE' + (n ? ' · take out $' + n.toLocaleString('en-US') : '') : here ? '' : ' · ⚠ not on this player');

      let text, bg;
      if (atVault)         { text = withdrew || !n ? 'BACK TO QUEUE ▶' : 'WITHDRAW $' + n.toLocaleString('en-US'); bg = withdrew || !n ? '#00ADB5' : '#ea580c'; }
      else if (atTrade)    { text = n ? 'BACK TO QUEUE ▶ · still short $' + n.toLocaleString('en-US') : 'BACK TO QUEUE ▶'; bg = n ? '#4a4f57' : '#00ADB5'; }
      else if (paid(S))    { text = (S.r || []).indexOf(S.i) !== -1 ? 'RELEASED · NEXT ▶' : 'PAID ✓ · NEXT ▶'; bg = '#00ADB5'; }
      else if (sending)    { text = 'SENDING…';        bg = '#4a4f57'; }
      else if (wait() > 0) { text = 'WAIT ' + (Math.ceil(wait() / 100) / 10).toFixed(1) + 's'; bg = '#4a4f57'; }
      else if (armed === S.i && Date.now() - armedAt <= ARM_MS) { text = 'CONFIRM ' + amt + ' → [' + it[0] + ']'; bg = '#1d4ed8'; }
      else                 { text = 'SEND ' + amt + ' → [' + it[0] + ']'; bg = '#15803d'; }
      sendBtn.textContent = text;
      sendBtn.style.background = bg;
      sendBtn.style.display = here || atVault || atTrade ? '' : 'none';

      releaseBtn.style.display = it[4] && !paid(S) && !atVault && !atTrade ? '' : 'none';
      // the vault / trade toggle is always on show, so the choice can be made before any cash runs short
      cashRow.style.display = !atVault && !atTrade ? 'flex' : 'none';
      vaultBtn.style.display = n > 0 ? '' : 'none';
      const viaTrade = src() === 'trade';
      vaultBtn.textContent = (viaTrade ? 'TRADE $' : 'VAULT $') + n.toLocaleString('en-US');
      vaultBtn.title = viaTrade
        ? 'Opens your ghost trade (the last trade you opened from the queue) to take out $' + n.toLocaleString('en-US') + ', the cash the rest of the queue still needs'
        : 'Opens your vault with $' + n.toLocaleString('en-US') + ' pre-filled (cash the rest of the queue still needs)';
      srcBtn.textContent = 'Cash from: ' + (viaTrade ? 'Trade' : 'Vault') + ' ⇄';
      srcBtn.title = 'Click to take short cash from your ' + (viaTrade ? 'vault' : 'ghost trade') + ' instead. Remembered for every queue.';

      nextBtn.textContent = !here ? 'Open ▶' : (S.i === S.q.length - 1 ? 'Finish' : 'Next ▶');
      fit(sendBtn, 14); fit(nextBtn, 14); fit(vaultBtn, 14); fit(srcBtn, 14);
    }

    show();
    setInterval(show, 250);
  }

  // ── messages.php: outreach mail queue (hit 1 send, hit 2 next mail). Torn allows one mail every 10 s ──
  function mailPanel() {
    const KEY = 'ffscouter_mailq_v1', KEY_LAST = 'ffscouter_maillast_v1', KEY_MAILED = 'ffscouter_mailed_v1';
    const MAIL_GAP   = 10000;   // Torn's 10 s between mails: the only thing that holds SEND back
    const CONFIRM_MS = 8000;    // no answer from Torn by then: counted as sent (unconfirmed), never sent twice
    const MAILED_TTL = 7 * 24 * 3600 * 1000;

    // the queue lives in this tab only: closing the tab drops it, and a tab opened by hand shows no panel
    localStorage.removeItem(KEY);   // queues saved by 6.5 and older
    const load = () => {
      try {
        const s = JSON.parse(sessionStorage.getItem(KEY));
        return s && s.i < s.q.length && Date.now() - s.t < 12 * 3600 * 1000 ? s : null;
      } catch (e) { return null; }
    };
    const save = s => { s.t = Date.now(); try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };

    // sent, failed and skipped mails all go in the ledger, so no later queue picks them up
    const mailed = () => ledger(KEY_MAILED, MAILED_TTL);
    const markMailed = id => { if (/^\d+$/.test(id || '')) tellPanel('ffMailed', remember(KEY_MAILED, MAILED_TTL, [[id, Date.now()]])); };
    tellPanel('ffMailed', mailed());

    const hp = new URLSearchParams(location.hash.indexOf('&') < 0 ? '' : location.hash.slice(location.hash.indexOf('&') + 1));
    const pageXID = hp.get('XID');
    if (hp.get('ffm')) {
      try {
        const p = JSON.parse(decodeURIComponent(escape(atob(hp.get('ffm')))));
        const l = mailed();
        const rows = p.q.filter(r => /^\d+$/.test(r[0]) && r[2] && r[3]);
        const fresh = rows.filter(r => !l[r[4]]);
        if (fresh.length) save({ q: fresh, i: 0, d: [] });
        else sessionStorage.removeItem(KEY);
        history.replaceState(null, '', location.pathname + location.search + '#/p=compose&XID=' + pageXID);
        const skipped = rows.length - fresh.length;
        if (skipped) note(skipped + ' mail' + (skipped > 1 ? 's' : '') + ' already sent or skipped from this browser - left out of the queue.', true);
      } catch (e) { console.warn('[FFScouter] Could not read mail queue from URL', e); }
    }

    let S = load();
    if (!S) return;

    const urlFor = k => '/messages.php?ffmail=' + k + '#/p=compose&XID=' + S.q[k][0];
    const sent   = () => S.d.indexOf(S.i) !== -1;
    const onPage = () => q.get('ffmail') === String(S.i) && pageXID === S.q[S.i][0];
    const wait   = () => Math.max(0, Number(localStorage.getItem(KEY_LAST) || 0) + MAIL_GAP - Date.now());
    const subj   = () => document.querySelector('input[name="subject"]');
    const filled = () => filledAt && subj() && subj().value === S.q[S.i][2];

    // Torn's own Send button in the compose form (the queue presses it for you: one key press, one mail)
    function sendButton() {
      for (let r = subj(), k = 0; r && k < 10; r = r.parentElement, k++) {
        const b = [...r.querySelectorAll('button, input[type="submit"], input[type="button"]')]
          .find(x => !P.panel.contains(x) && /^\s*send\b/i.test(x.value || x.textContent) && x.offsetParent !== null);
        if (b) return b;
      }
      return null;
    }

    let filledAt = 0, filling = false, sending = false, sendAt = 0, verdict = null;

    // a send is clicked and the page reloaded before its answer came back (Torn posted the form): count it, never resend
    if (S.p && S.p.i === S.i && Date.now() - S.p.t < 60000 && !sent()) {
      S.d.push(S.i); markMailed(S.q[S.i][4]);
      note('Mail to ' + S.q[S.i][1] + ' counted as sent - check your Sent mail if unsure.', true);
    }
    delete S.p; save(S);

    function fill() {
      const it = S.q[S.i];
      let tries = 0;
      filling = true;
      const t = setInterval(() => {
        if (!S || ++tries > 150) { clearInterval(t); filling = false; if (S && !filled()) note('Compose form not found - press again to retry.'); return; }
        if (!location.hash.includes('p=compose')) { const tab = document.querySelector('a[href="#/p=compose"]'); if (tab) tab.click(); return; }
        const ed = typeof tinymce !== 'undefined' ? tinymce.activeEditor : null;
        if (!subj() || !ed || !ed.getBody || !ed.getBody()) return;   // compose form / editor not ready yet
        clearInterval(t);
        filling = false;
        setValue(subj(), it[2]);
        ed.setContent(it[3]);
        // keys pressed inside the editor stay in its iframe, so the hotkey listens there too
        const doc = ed.getDoc && ed.getDoc();
        if (doc && !doc._ffKey) { doc._ffKey = true; P.listen(doc); }
        filledAt = Date.now();
        show();
      }, 150);
    }

    // Torn's answer to the send: its JSON reply, a message that appears on the page, or the form clearing
    hookCalls((url, body, text) => {
      if (!sending || verdict || !/messages\.php/.test(url || '')) return;
      let j;
      try { j = JSON.parse(text); } catch (e) { return; }
      if (j && (j.success === false || j.error)) verdict = { ok: false, text: strip(j.text || j.msg || j.error) };
      else if (j && j.success === true) verdict = { ok: true, text: strip(j.text || j.msg) };
    });
    new MutationObserver(ms => {
      if (!sending || verdict) return;
      for (const m of ms) for (const n of m.addedNodes) {
        const el = n.nodeType === 1 ? n : n.parentNode;
        if (!el || P.panel.contains(el) || (el.closest && el.closest('#ffq-note'))) continue;
        const t = strip(n.nodeType === 1 ? n.innerText || n.textContent : n.textContent);
        if (!t || t.length > 300) continue;
        if (/\b(not|n't)( been)? sent\b/i.test(t) || (!/\bsent\b/i.test(t) && /\b(wait|too (fast|quickly)|error|cannot|can't|unable|not allowed|failed|invalid)\b/i.test(t))) { verdict = { ok: false, text: t }; return; }
        if (/\bsent\b/i.test(t)) { verdict = { ok: true, text: t }; return; }
      }
    }).observe(document.body, { childList: true, subtree: true });

    function watchSend() {
      const el = Date.now() - sendAt, s = subj();
      if (!verdict && el > 1500 && (!s || s.value !== S.q[S.i][2])) verdict = { ok: true, text: '' };   // Torn cleared the form
      if (!verdict && el > CONFIRM_MS) verdict = { ok: true, unsure: true };
      if (!verdict) return;
      const v = verdict, it = S.q[S.i], last = S.i === S.q.length - 1;
      verdict = null; sending = false; delete S.p;
      // a clicked mail is done either way, so the button moves on and a mail is never sent twice
      S.d.push(S.i);
      markMailed(it[4]);   // failed ones too: never queued again
      save(S);
      note((!v.ok ? (v.text || 'Torn did not send the mail') + ' - skipped.' : v.unsure ? 'Torn did not confirm the mail to ' + it[1] + ' - check your Sent mail before mailing them again.' : (v.text || 'Mail sent ✓')) +
           (last ? ' · Queue finished ✓' : ''), v.ok && !v.unsure);
      if (last) finish();
    }

    function open() { if (!sending) location.href = urlFor(S.i); }
    function finish() { sessionStorage.removeItem(KEY); S = null; P.panel.remove(); finished(); }
    function next() {
      if (sending) return;
      if (S.i >= S.q.length - 1) return finish();
      S.i++; save(S);
      open();
    }
    function skip() {
      if (!S || sending) return;
      if (!sent()) { S.d.push(S.i); markMailed(S.q[S.i][4]); save(S); note('Skipped ' + S.q[S.i][1] + '.', true); }
      next();
    }

    function step() {
      if (!S || sending) return;
      if (sent()) return next();
      if (!onPage()) return open();
      if (wait() > 0) return;   // Torn's 10 s gap
      if (!filled()) return filling || fill();   // form re-rendered or not found: fill it again
      const b = sendButton();
      if (!b) return note("Torn's Send button was not found.");
      if (b.disabled) return note("Torn's Send button is disabled - wait for its countdown.");
      sending = true; sendAt = Date.now(); verdict = null;
      localStorage.setItem(KEY_LAST, sendAt);
      S.p = { i: S.i, t: sendAt }; save(S);
      b.click();
      show();
    }

    const P = makePanel(step, () => { sessionStorage.removeItem(KEY); S = null; }, true);
    const sendBtn = button('#15803d', step);
    const skipBtn = button('#4a4f57', skip);
    skipBtn.textContent = 'SKIP ⏭';
    skipBtn.title = 'Skip this mail without sending; it is left out of later queues';
    flexBtn(sendBtn, '1 1 0');
    flexBtn(skipBtn, '0 0 auto');
    P.btnRow.append(sendBtn, skipBtn);

    // mails done here go back to the marketing page, which leaves them out of the next queue
    const panelUrl = () => 'https://ffscouter.com/supportpanel/payment-provider/loss-buy-marketing#ffmailed=' +
      encodeURIComponent(Object.keys(mailed()).join(','));
    const finished = backTools(P.panel, panelUrl, 'Back to the marketing page; mails sent here are left out of the next queue', 'Mail queue finished ✓ ');
    dockPanel(P.panel, P.grip, () => S);

    function show() {
      if (!S) return;
      if (sending) watchSend();
      if (!S) return;
      const it = S.q[S.i], here = onPage();
      P.info.textContent = 'Mail #' + (S.i + 1) + '/' + S.q.length + ' · ' + it[1] + ' [' + it[0] + ']' + (here ? '' : ' · ⚠ not open');

      let text, bg;
      if (sent())               { text = 'SENT ✓ · NEXT ▶'; bg = '#00ADB5'; }
      else if (!here)           { text = 'OPEN MAIL ▶';     bg = '#00ADB5'; }
      else if (sending)         { text = 'SENDING…';        bg = '#4a4f57'; }
      else if (wait() > 0)      { text = 'WAIT ' + (Math.ceil(wait() / 100) / 10).toFixed(1) + 's'; bg = '#4a4f57'; }
      else if (!filled())       { text = filling ? 'FILLING…' : 'FILL MAIL ▶'; bg = filling ? '#4a4f57' : '#00ADB5'; }
      else                      { text = 'SEND MAIL → ' + it[1]; bg = '#15803d'; }
      sendBtn.textContent = text;
      sendBtn.style.background = bg;
      skipBtn.style.display = sending || sent() ? 'none' : '';
      fit(sendBtn, 14);
    }

    if (onPage() && !sent()) fill();
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
    // not on the open tab: open the Drugs tab once (Xanax and friends); any other category you open yourself
    if (!li) {
      const drugs = document.querySelector('a.drugs-category-icon');
      if (drugs && visible(drugs)) { drugs.click(); li = await waitFor(itemRow, 2500); }
    }
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
