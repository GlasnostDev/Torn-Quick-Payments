// ==UserScript==
// @name         FFScouter - Profile Payment Pre-fill & Mail Pre-fill
// @namespace    https://ffscouter.com/
// @version      2.0
// @description  Pre-fills profile send-money (paymentamount, paymentref) and messages.php compose (mailsubject, mailbody). Recipient from XID is left to Torn. Does NOT auto-send.
// @author       FFScouter / Glasnost [1844049]
// @match        https://www.torn.com/profiles.php*
// @match        https://www.torn.com/messages.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
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

    function checkCashAndWarn() {
      const moneyEl = document.getElementById('user-money');
      if (!moneyEl) return;
      const cashOnHand = parseFloat(moneyEl.dataset.money || '0');
      if (isNaN(cashOnHand) || cashOnHand >= requested) return;

      const fmt = n => '$' + Math.floor(n).toLocaleString('en-US');
      const banner = document.createElement('div');
      banner.id = 'ffscouter-cash-warning';
      banner.style.cssText = [
        'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
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
        if (fillPaymentForm()) {
          clearInterval(poller);
          console.info('[FFScouter] Payment form pre-filled — amount:', amount, '| ref:', message);
          setTimeout(checkCashAndWarn, 300);
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
