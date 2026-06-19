'use strict';

/**
 * CryptoCalc — calculator.js
 *
 * Pure client-side position size, risk/reward and liquidation calculator.
 * No external dependencies. No data sent anywhere.
 *
 * Formulas:
 *   Position Size  = (Account × Risk%) / |Entry − StopLoss|
 *   Risk/Reward    = |TakeProfit − Entry| / |Entry − StopLoss|
 *   Breakeven      = 1 / (1 + R:R) × 100
 *   Liquidation    = Entry × (1 ∓ 1/Leverage ± maintenanceMargin)
 */

/* ── DOM helpers ────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── Number formatting ──────────────────────────────────── */
function fmtNum(n, dec) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
}

function fmtUSD(n) {
  return '$' + fmtNum(n, 2);
}

function fmtUnits(n) {
  if (n === 0)    return '0';
  if (n < 0.0001) return fmtNum(n, 8);
  if (n < 0.01)   return fmtNum(n, 6);
  if (n < 1)      return fmtNum(n, 4);
  if (n < 10)     return fmtNum(n, 4);
  if (n < 10000)  return fmtNum(n, 2);
  return fmtNum(n, 0);
}

function fmtPct(n, dec = 1) {
  return fmtNum(n, dec) + '%';
}

/* ── Input reading ──────────────────────────────────────── */
function readNum(id) {
  const raw = ($( id).value || '').replace(/,/g, '').trim();
  const n   = parseFloat(raw);
  return (isNaN(n) || n < 0) ? 0 : n;
}

/* ── State ──────────────────────────────────────────────── */
let direction = 'long';
let resultsShownOnce = false;

/* ── Validation ─────────────────────────────────────────── */
function validate(account, riskPct, entry, stop) {
  if (account <= 0) return 'Enter your account balance.';
  if (entry   <= 0) return 'Enter an entry price.';
  if (stop    <= 0) return 'Enter a stop loss price.';
  if (entry === stop) return 'Entry price and stop loss cannot be the same.';
  if (riskPct <= 0 || riskPct > 100) return 'Risk per trade must be between 0.1% and 100%.';
  if (direction === 'long'  && stop >= entry) return 'Long position: stop loss must be below entry price.';
  if (direction === 'short' && stop <= entry) return 'Short position: stop loss must be above entry price.';
  return null;
}

/* ── Error display ──────────────────────────────────────── */
function showError(msg) {
  const el = $('error-message');
  el.textContent = msg;
  el.classList.remove('hidden');
  $('results').classList.add('hidden');
  resultsShownOnce = false;
}

function clearError() {
  $('error-message').classList.add('hidden');
}

/* ── Direction toggle ───────────────────────────────────── */
function setDirection(dir) {
  direction = dir;
  $('btn-long').classList.toggle('active', dir === 'long');
  $('btn-short').classList.toggle('active', dir === 'short');
  runCalculation();
}

/* ── Main calculation ───────────────────────────────────── */
function runCalculation() {
  const account  = readNum('account-balance');
  const riskPct  = readNum('risk-percent');
  const entry    = readNum('entry-price');
  const stop     = readNum('stop-loss');
  const tp       = readNum('take-profit');
  const leverage = readNum('leverage');

  /* Hide results if required fields are empty */
  if (!account || !entry || !stop) {
    clearError();
    $('results').classList.add('hidden');
    resultsShownOnce = false;
    return;
  }

  const err = validate(account, riskPct, entry, stop);
  if (err) { showError(err); return; }
  clearError();

  /* ── 1. Position Size ──────────────────────────────── */
  const risk$    = account * (riskPct / 100);
  const stopDist = Math.abs(entry - stop);
  const units    = risk$ / stopDist;
  const posVal   = units * entry;

  /* ── 2. Risk / Reward (optional) ──────────────────── */
  let rrRatio = null, breakeven = null, profit$ = null;

  if (tp > 0 && tp !== entry) {
    const tpDir = direction === 'long' ? tp > entry : tp < entry;
    if (tpDir) {
      const reward = Math.abs(tp - entry);
      rrRatio      = reward / stopDist;
      breakeven    = (1 / (1 + rrRatio)) * 100;
      profit$      = units * reward;
    }
  }

  /* ── 3. Liquidation Price (optional) ──────────────── */
  let liqPrice = null;
  if (leverage >= 2) {
    /* Simplified isolated margin; 0.5% maintenance margin rate (conservative baseline) */
    const imr = 1 / leverage;
    const mmr = 0.005;
    liqPrice = direction === 'long'
      ? entry * (1 - imr + mmr)
      : entry * (1 + imr - mmr);
  }

  renderResults({ account, riskPct, risk$, units, posVal, rrRatio, breakeven, profit$, liqPrice, leverage });
}

/* ── Render results ─────────────────────────────────────── */
function renderResults({ account, riskPct, risk$, units, posVal, rrRatio, breakeven, profit$, liqPrice, leverage }) {

  /* Position size */
  $('res-units').textContent     = fmtUnits(units);
  $('res-units-sub').textContent = 'units';
  $('res-pos-value').textContent = fmtUSD(posVal);
  $('res-risk-sub').textContent  = fmtPct(riskPct) + ' of account at risk';

  /* Risk amount */
  $('res-risk-amount').textContent  = fmtUSD(risk$);
  $('res-risk-pct-sub').textContent = fmtPct(riskPct) + ' of ' + fmtUSD(account);

  /* R:R */
  if (rrRatio !== null) {
    const cls = rrRatio >= 2 ? 'rr-good' : rrRatio >= 1.5 ? 'rr-ok' : 'rr-poor';
    const lbl = rrRatio >= 2 ? 'Good' : rrRatio >= 1.5 ? 'Acceptable' : 'Below target';
    $('res-rr').className   = 'tile-value ' + cls;
    $('res-rr').textContent = fmtNum(rrRatio, 2) + ' : 1';
    $('res-rr-sub').textContent = lbl;
    $('tile-rr').classList.remove('hidden');

    $('res-breakeven').textContent = fmtPct(breakeven, 1);
    $('tile-breakeven').classList.remove('hidden');

    $('res-profit').textContent = fmtUSD(profit$);
    $('tile-profit').classList.remove('hidden');
  } else {
    $('tile-rr').classList.add('hidden');
    $('tile-breakeven').classList.add('hidden');
    $('tile-profit').classList.add('hidden');
  }

  /* Liquidation */
  if (liqPrice !== null) {
    $('res-liq').textContent     = fmtUSD(liqPrice);
    $('res-liq-sub').textContent = leverage + 'x ' + (direction === 'long' ? 'Long' : 'Short') + ' · estimate only';
    $('tile-liq').classList.remove('hidden');
    $('liq-disclaimer').classList.remove('hidden');
  } else {
    $('tile-liq').classList.add('hidden');
    $('liq-disclaimer').classList.add('hidden');
  }

  /* Show results; scroll into view only on first appearance */
  const resultsEl = $('results');
  const wasHidden = resultsEl.classList.contains('hidden');
  resultsEl.classList.remove('hidden');

  if (wasHidden && !resultsShownOnce) {
    resultsShownOnce = true;
    setTimeout(() => {
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }
}

/* ── Risk slider ↔ input sync ───────────────────────────── */
function syncSliderFromInput() {
  const pct   = parseFloat($('risk-percent').value) || 2;
  const clamped = Math.min(10, Math.max(0.1, pct));
  $('risk-range').value = clamped;
}

/* ── FAQ Accordion ──────────────────────────────────────── */
function initFAQ() {
  document.querySelectorAll('.faq-item').forEach(item => {
    const btn = item.querySelector('.faq-q');
    const ans = item.querySelector('.faq-ans');

    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      /* Close all */
      document.querySelectorAll('.faq-item').forEach(other => {
        other.classList.remove('open');
        other.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        other.querySelector('.faq-ans').setAttribute('hidden', '');
      });

      /* Open clicked if it was closed */
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        ans.removeAttribute('hidden');
      }
    });
  });
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* Bind all numeric inputs to live calculation */
  ['account-balance', 'entry-price', 'stop-loss', 'take-profit', 'leverage']
    .forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', runCalculation);
    });

  /* Risk percent input */
  $('risk-percent').addEventListener('input', () => {
    syncSliderFromInput();
    runCalculation();
  });

  /* Risk range slider */
  $('risk-range').addEventListener('input', () => {
    $('risk-percent').value = $('risk-range').value;
    runCalculation();
  });

  /* Direction buttons */
  $('btn-long').addEventListener('click',  () => setDirection('long'));
  $('btn-short').addEventListener('click', () => setDirection('short'));

  /* Reset */
  $('btn-reset').addEventListener('click', () => {
    $('calculator-form').reset();
    $('risk-percent').value = '2';
    $('risk-range').value   = '2';
    direction = 'long';
    $('btn-long').classList.add('active');
    $('btn-short').classList.remove('active');
    clearError();
    $('results').classList.add('hidden');
    resultsShownOnce = false;
  });

  /* FAQ */
  initFAQ();
});
