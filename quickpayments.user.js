// ==UserScript==
// @name         FFScouter - Profile Payment Pre-fill
// @namespace    https://ffscouter.com/
// @version      1.2
// @description  Pre-fills the "Give some money" form on Torn profile pages when FFScouter payment URL params are present (paymentamount, paymentref). Does NOT auto-send.
// @author       FFScouter
// @match        https://www.torn.com/profiles.php*
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

  // ── 2. Helper: set value on a React-controlled input ─────────────────────
  function setNativeValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── 3. Fill the form once it appears in the DOM ───────────────────────────
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

  // ── 4. Click the $ / "Send cash" button to open the form ─────────────────
  function openSendMoneyForm() {
    const btn = document.querySelector('.profile-button-sendMoney');
    if (!btn) return false;

    if (!document.querySelector('.send-cash .input-money')) {
      btn.click();
    }
    return true;
  }

  // ── 5. Wait for the profile Actions buttons to be rendered, then trigger ──
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
      }
    }, 120);

  }, 100);

})();
