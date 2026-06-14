// ==UserScript==
// @name         FFScouter - Profile Payment Pre-fill
// @namespace    https://ffscouter.com/
// @version      1.1
// @description  Pre-fills the "Give some money" form on Torn profile pages when FFScouter payment URL params are present (paymentamount, paymentref). Does NOT auto-send.
// @author       FFScouter
// @match        https://www.torn.com/profiles.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── 1. Parse query params ─────────────────────────────────────────────────
  const params   = new URLSearchParams(window.location.search);
  const xid      = params.get('XID');
  const rawAmount = params.get('paymentamount');
  const rawRef   = params.get('paymentref');

  // Only run when both payment params are present
  if (!rawAmount || !rawRef) return;

  const amount  = rawAmount.trim();                    // e.g. "800000"
  const message = decodeURIComponent(rawRef).trim();   // decoded ref + optional suffix

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

    if (!amountInput || !messageInput) return false;   // form not open yet

    setNativeValue(amountInput,  amount);
    setNativeValue(messageInput, message);

    // Briefly highlight the fields so the user notices the pre-fill
    [amountInput, messageInput].forEach(el => {
      el.style.transition = 'background 0.4s';
      el.style.background = '#ffffaa';
      setTimeout(() => { el.style.background = ''; }, 1500);
    });

    return true;
  }

  // ── 4. Click the $ / "Send cash" button to open the form ─────────────────
  function openSendMoneyForm() {
    const btn = document.querySelector('.profile-button-sendMoney');
    if (!btn) return false;

    // Only click if the form isn't already open
    if (!document.querySelector('.send-cash .input-money')) {
      btn.click();
    }
    return true;
  }

  // ── 5. Wait for the profile Actions buttons to be rendered, then trigger ──
  //  Torn is a React SPA; the buttons appear asynchronously after page load.
  let attempts = 0;
  const MAX_ATTEMPTS = 60;   // 6 seconds max wait

  const poller = setInterval(() => {
    attempts++;

    if (attempts > MAX_ATTEMPTS) {
      clearInterval(poller);
      console.warn('[FFScouter] Could not find send-money button after 6 s');
      return;
    }

    // Step A: open the form
    if (!openSendMoneyForm()) return;   // buttons not rendered yet, keep waiting

    // Step B: fill the form (give the DOM one tick after clicking)
    setTimeout(() => {
      const filled = fillForm();
      if (filled) {
        clearInterval(poller);
        console.info('[FFScouter] Payment form pre-filled — amount:', amount, '| ref:', message);
      }
      // If fillForm returned false, the poller will retry on the next tick
    }, 120);

  }, 100);

})();
