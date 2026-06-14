// ==UserScript==
// @name         FFScouter - Profile Payment Pre-fill
// @namespace    https://ffscouter.com/
// @version      1.4
// @description  Pre-fills the "Give some money" form on Torn profile pages when FFScouter payment URL params are present (paymentamount, paymentref). Does NOT auto-send.
// @author       FFScouter / Glasnost [1844049]
// @match        https://www.torn.com/profiles.php*
// @updateURL    https://raw.githubusercontent.com/GlasnostDev/Torn-Quick-Payments/main/quickpayments.user.js
// @downloadURL  https://raw.githubusercontent.com/GlasnostDev/Torn-Quick-Payments/main/quickpayments.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── 1. Parse query params ─────────────────────────────────────────────────

  const params    = new URLSearchParams(window.location.search);
  const xid       = params.get('XID');
  const rawAmount = params.get('paymentamount');
  const rawRef    = params.get('paymentref');

  // Only run when both payment params are present
  if (!rawAmount || !rawRef) return;

  const amount  = rawAmount.trim();
  const message = decodeURIComponent(rawRef).trim();

  // Parse the requested amount as a plain number for comparison
  const requestedAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));

  // ── 2. Helper: set value on a React-controlled input ─────────────────────

  function setNativeValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── 3. Cash-on-hand warning ───────────────────────────────────────────────

  function checkCashAndWarn() {
    // Torn stores the user's current cash in data-money on #user-money
    const moneyEl   = document.getElementById('user-money');
    if (!moneyEl) return; // sidebar not yet loaded — skip silently

    const cashOnHand = parseFloat(moneyEl.dataset.money || '0');

    if (isNaN(cashOnHand) || cashOnHand >= requestedAmount) return; // all good

    // Format numbers for readability
    const fmt = n => '$' + Math.floor(n).toLocaleString('en-US');

    // Build the warning banner
    const banner = document.createElement('div');
    banner.id = 'ffscouter-cash-warning';
    banner.style.cssText = [
      'position: fixed',
      'top: 16px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 2147483647',
      'background: #7a1a1a',
      'color: #f8d7da',
      'border: 2px solid #e05555',
      'border-radius: 6px',
      'padding: 14px 20px',
      'font: bold 14px/1.5 Arial, sans-serif',
      'box-shadow: 0 4px 18px rgba(0,0,0,0.55)',
      'max-width: 480px',
      'text-align: center',
      'cursor: pointer',
    ].join(';');

    banner.innerHTML =
      '⚠️ <strong>FFScouter – Insufficient Cash</strong><br>' +
      'Requested: <strong>' + fmt(requestedAmount) + '</strong> &nbsp;|&nbsp; ' +
      'On hand: <strong>' + fmt(cashOnHand) + '</strong><br>' +
      '<span style="font-size:12px;opacity:0.85">' +
        'The amount field may have been reduced. Do NOT send until you have enough cash.' +
      '</span><br>' +
      '<span style="font-size:11px;opacity:0.65">(Click to dismiss)</span>';

    banner.addEventListener('click', () => banner.remove());

    // Also auto-dismiss after 30 s so it never permanently blocks the UI
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 30000);

    document.body.appendChild(banner);

    console.warn(
      '[FFScouter] Insufficient cash — requested:', requestedAmount,
      '| on hand:', cashOnHand
    );
  }

  // ── 4. Fill the form once it appears in the DOM ───────────────────────────

  function fillForm() {
    const amountInput  = document.querySelector('.send-cash .input-money:not([type="hidden"])');
    const messageInput = document.querySelector('.send-cash .send-cash-message-input');

    if (!amountInput || !messageInput) return false;

    setNativeValue(amountInput,  amount);
    setNativeValue(messageInput, message);

    // Briefly flash a subtle border around the fields so the user notices the pre-fill
    [amountInput, messageInput].forEach(el => {
      el.style.transition = 'outline-color 0.15s ease-in-out';
      el.style.outline = '2px solid rgba(180, 160, 60, 0.85)';
      el.style.outlineOffset = '2px';
      setTimeout(() => {
        el.style.outline = '2px solid transparent';
        setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 300);
      }, 1200);
    });

    return true;
  }

  // ── 5. Click the $ / "Send cash" button to open the form ─────────────────

  function openSendMoneyForm() {
    const btn = document.querySelector('.profile-button-sendMoney');
    if (!btn) return false;
    if (!document.querySelector('.send-cash .input-money')) {
      btn.click();
    }
    return true;
  }

  // ── 6. Wait for the profile Actions buttons to be rendered, then trigger ──

  let attempts = 0;
  const MAX_ATTEMPTS = 60;

  const poller = setInterval(() => {
    attempts++;
    if (attempts > MAX_ATTEMPTS) {
      clearInterval(poller);
      console.warn('[FFScouter] Could not find send-money button after 6 s');
      return;
    }

    if (!openSendMoneyForm()) return;

    setTimeout(() => {
      const filled = fillForm();
      if (filled) {
        clearInterval(poller);
        console.info('[FFScouter] Payment form pre-filled — amount:', amount, '| ref:', message);

        // ── Check cash AFTER the form is filled and Torn has had a chance
        //    to silently cap the value. A short delay lets React settle.
        setTimeout(checkCashAndWarn, 300);
      }
    }, 120);
  }, 100);

})();
