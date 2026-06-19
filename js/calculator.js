'use strict';

/**
 * CryptoCalc 2.0 — calculator.js
 *
 * Features:
 *   - Position Size Calculator
 *   - Risk/Reward Ratio
 *   - Liquidation Price Estimate
 *   - Trade Visualizer (SVG)
 *   - Visual Risk Meter
 *   - Live Price Fetch (BTC, ETH, SOL, BNB)
 *   - Fee Impact Calculator
 *   - Copy Results / Share to X
 *   - Export as Image
 *
 * All client-side. No external dependencies except CoinGecko API (on-demand).
 */

/* ═══════════════════════════════════════════════════════════
   DOM & UTILITIES
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

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

function fmtPrice(n) {
  if (n >= 1000) return fmtNum(n, 2);
  if (n >= 1)    return fmtNum(n, 4);
  return fmtNum(n, 6);
}

/* ── Input reading ──────────────────────────────────────── */
function readNum(id) {
  const el = $(id);
  if (!el) return 0;
  const raw = (el.value || '').replace(/,/g, '').trim();
  const n = parseFloat(raw);
  return (isNaN(n) || n < 0) ? 0 : n;
}


/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */

let direction = 'long';
let resultsShownOnce = false;
let lastCalcData = null;        // Store last calculation for share/copy
let selectedAsset = 'BTC';      // For live price


/* ═══════════════════════════════════════════════════════════
   PRICE CACHE (localStorage)
   ═══════════════════════════════════════════════════════════ */

const PRICE_CACHE_KEY = 'cryptocalc_prices';
const PRICE_CACHE_TTL = 60000; // 1 minute

function getPriceCache() {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function setPriceCache(asset, price) {
  try {
    const cache = getPriceCache();
    cache[asset] = { price, ts: Date.now() };
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

function getCachedPrice(asset) {
  const cache = getPriceCache();
  const entry = cache[asset];
  if (!entry) return null;
  if (Date.now() - entry.ts > PRICE_CACHE_TTL) return null;
  return entry.price;
}


/* ═══════════════════════════════════════════════════════════
   LIVE PRICE FETCH (CoinGecko)
   ═══════════════════════════════════════════════════════════ */

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin'
};

async function fetchPrice(asset) {
  const cgId = COINGECKO_IDS[asset];
  if (!cgId) return null;

  // Check cache first
  const cached = getCachedPrice(asset);
  if (cached !== null) return cached;

  const btn = $('btn-fetch-price');
  const spinner = $('price-spinner');
  const priceDisplay = $('live-price-display');

  try {
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (priceDisplay) priceDisplay.textContent = 'Loading...';

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    
    if (!res.ok) throw new Error('API error');
    
    const data = await res.json();
    const price = data[cgId]?.usd;
    
    if (price) {
      setPriceCache(asset, price);
      if (priceDisplay) priceDisplay.textContent = fmtUSD(price);
      return price;
    }
    throw new Error('No price data');
  } catch (err) {
    if (priceDisplay) priceDisplay.textContent = 'Unavailable';
    return null;
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
  }
}

function applyFetchedPrice(price) {
  if (price && $('entry-price')) {
    $('entry-price').value = fmtPrice(price).replace(/,/g, '');
    runCalculation();
  }
}


/* ═══════════════════════════════════════════════════════════
   VALIDATION
   ═══════════════════════════════════════════════════════════ */

function validate(account, riskPct, entry, stop) {
  if (account <= 0) return 'Enter your account balance.';
  if (entry   <= 0) return 'Enter an entry price.';
  if (stop    <= 0) return 'Enter a stop loss price.';
  if (entry === stop) return 'Entry and stop loss cannot be the same.';
  if (riskPct <= 0 || riskPct > 100) return 'Risk must be between 0.1% and 100%.';
  if (direction === 'long'  && stop >= entry) return 'Long: stop loss must be below entry.';
  if (direction === 'short' && stop <= entry) return 'Short: stop loss must be above entry.';
  return null;
}

function showError(msg) {
  const el = $('error-message');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  const results = $('results');
  if (results) results.classList.add('hidden');
  resultsShownOnce = false;
}

function clearError() {
  const el = $('error-message');
  if (el) el.classList.add('hidden');
}


/* ═══════════════════════════════════════════════════════════
   DIRECTION TOGGLE
   ═══════════════════════════════════════════════════════════ */

function setDirection(dir) {
  direction = dir;
  const btnLong = $('btn-long');
  const btnShort = $('btn-short');
  if (btnLong) btnLong.classList.toggle('active', dir === 'long');
  if (btnShort) btnShort.classList.toggle('active', dir === 'short');
  runCalculation();
}


/* ═══════════════════════════════════════════════════════════
   MAIN CALCULATION
   ═══════════════════════════════════════════════════════════ */

function runCalculation() {
  const account  = readNum('account-balance');
  const riskPct  = readNum('risk-percent');
  const entry    = readNum('entry-price');
  const stop     = readNum('stop-loss');
  const tp       = readNum('take-profit');
  const leverage = readNum('leverage');
  const feePct   = readNum('fee-percent');

  // Hide results if required fields are empty
  if (!account || !entry || !stop) {
    clearError();
    const results = $('results');
    if (results) results.classList.add('hidden');
    resultsShownOnce = false;
    lastCalcData = null;
    return;
  }

  const err = validate(account, riskPct, entry, stop);
  if (err) { showError(err); lastCalcData = null; return; }
  clearError();

  /* ── 1. Position Size ──────────────────────────────── */
  const risk$    = account * (riskPct / 100);
  const stopDist = Math.abs(entry - stop);
  const units    = risk$ / stopDist;
  const posVal   = units * entry;

  /* ── 2. Risk / Reward (optional) ──────────────────── */
  let rrRatio = null, breakeven = null, profit$ = null, profitAfterFees = null;

  if (tp > 0 && tp !== entry) {
    const tpValid = direction === 'long' ? tp > entry : tp < entry;
    if (tpValid) {
      const reward = Math.abs(tp - entry);
      rrRatio      = reward / stopDist;
      breakeven    = (1 / (1 + rrRatio)) * 100;
      profit$      = units * reward;
      
      // Fee impact
      if (feePct > 0) {
        const entryFee = posVal * (feePct / 100);
        const exitFee  = (units * tp) * (feePct / 100);
        profitAfterFees = profit$ - entryFee - exitFee;
      }
    }
  }

  /* ── 3. Liquidation Price (optional) ──────────────── */
  let liqPrice = null;
  if (leverage >= 2) {
    const imr = 1 / leverage;
    const mmr = 0.005;
    liqPrice = direction === 'long'
      ? entry * (1 - imr + mmr)
      : entry * (1 + imr - mmr);
  }

  /* ── 4. Risk Level (for meter) ──────────────────── */
  // Risk level 0-100 based on: risk%, leverage, R:R
  let riskLevel = riskPct * 10; // Base: 2% = 20
  if (leverage >= 10) riskLevel += 20;
  else if (leverage >= 5) riskLevel += 10;
  if (rrRatio !== null && rrRatio < 1.5) riskLevel += 15;
  riskLevel = Math.min(100, Math.max(0, riskLevel));

  // Store for share/copy
  lastCalcData = {
    account, riskPct, risk$, units, posVal, entry, stop, tp,
    rrRatio, breakeven, profit$, profitAfterFees, liqPrice, leverage, feePct,
    direction, riskLevel
  };

  renderResults(lastCalcData);
}


/* ═══════════════════════════════════════════════════════════
   RENDER RESULTS
   ═══════════════════════════════════════════════════════════ */

function renderResults(data) {
  const {
    account, riskPct, risk$, units, posVal, entry, stop, tp,
    rrRatio, breakeven, profit$, profitAfterFees, liqPrice, leverage,
    feePct, riskLevel
  } = data;

  /* Position size */
  if ($('res-units')) $('res-units').textContent = fmtUnits(units);
  if ($('res-units-sub')) $('res-units-sub').textContent = 'units';
  if ($('res-pos-value')) $('res-pos-value').textContent = fmtUSD(posVal);
  if ($('res-risk-sub')) $('res-risk-sub').textContent = fmtPct(riskPct) + ' of account at risk';

  /* Risk amount */
  if ($('res-risk-amount')) $('res-risk-amount').textContent = fmtUSD(risk$);
  if ($('res-risk-pct-sub')) $('res-risk-pct-sub').textContent = fmtPct(riskPct) + ' of ' + fmtUSD(account);

  /* R:R */
  if (rrRatio !== null) {
    const cls = rrRatio >= 2 ? 'rr-good' : rrRatio >= 1.5 ? 'rr-ok' : 'rr-poor';
    const lbl = rrRatio >= 2 ? 'Good' : rrRatio >= 1.5 ? 'Acceptable' : 'Below target';
    const rrEl = $('res-rr');
    if (rrEl) {
      rrEl.className = 'tile-value ' + cls;
      rrEl.textContent = fmtNum(rrRatio, 2) + ' : 1';
    }
    if ($('res-rr-sub')) $('res-rr-sub').textContent = lbl;
    if ($('tile-rr')) $('tile-rr').classList.remove('hidden');

    if ($('res-breakeven')) $('res-breakeven').textContent = fmtPct(breakeven, 1);
    if ($('tile-breakeven')) $('tile-breakeven').classList.remove('hidden');

    // Profit with fee impact
    if ($('res-profit')) {
      if (profitAfterFees !== null && feePct > 0) {
        $('res-profit').textContent = fmtUSD(profitAfterFees);
        if ($('tile-profit .tile-sub')) {
          $('tile-profit').querySelector('.tile-sub').textContent = 
            `after ${fmtPct(feePct, 2)} fees · gross ${fmtUSD(profit$)}`;
        }
      } else {
        $('res-profit').textContent = fmtUSD(profit$);
      }
    }
    if ($('tile-profit')) $('tile-profit').classList.remove('hidden');
  } else {
    if ($('tile-rr')) $('tile-rr').classList.add('hidden');
    if ($('tile-breakeven')) $('tile-breakeven').classList.add('hidden');
    if ($('tile-profit')) $('tile-profit').classList.add('hidden');
  }

  /* Liquidation */
  if (liqPrice !== null) {
    if ($('res-liq')) $('res-liq').textContent = fmtUSD(liqPrice);
    if ($('res-liq-sub')) $('res-liq-sub').textContent = leverage + 'x ' + (direction === 'long' ? 'Long' : 'Short') + ' · estimate only';
    if ($('tile-liq')) $('tile-liq').classList.remove('hidden');
    if ($('liq-disclaimer')) $('liq-disclaimer').classList.remove('hidden');
  } else {
    if ($('tile-liq')) $('tile-liq').classList.add('hidden');
    if ($('liq-disclaimer')) $('liq-disclaimer').classList.add('hidden');
  }

  /* Risk Meter */
  renderRiskMeter(riskLevel);

  /* Trade Visualizer */
  renderTradeVisualizer(data);

  /* Show results */
  const resultsEl = $('results');
  if (resultsEl) {
    const wasHidden = resultsEl.classList.contains('hidden');
    resultsEl.classList.remove('hidden');

    if (wasHidden && !resultsShownOnce) {
      resultsShownOnce = true;
      setTimeout(() => {
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }
  }

  /* Show action buttons */
  if ($('result-actions')) $('result-actions').classList.remove('hidden');
}


/* ═══════════════════════════════════════════════════════════
   RISK METER (SVG Gauge)
   ═══════════════════════════════════════════════════════════ */

function renderRiskMeter(level) {
  const container = $('risk-meter');
  if (!container) return;

  // level: 0-100
  const angle = (level / 100) * 180 - 90; // -90 to 90 degrees
  const color = level < 30 ? '#10b981' : level < 60 ? '#f59e0b' : '#ef4444';
  const label = level < 30 ? 'Low Risk' : level < 60 ? 'Moderate' : 'High Risk';

  container.innerHTML = `
    <svg viewBox="0 0 120 70" class="risk-meter-svg">
      <defs>
        <linearGradient id="meterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#10b981"/>
          <stop offset="50%" stop-color="#f59e0b"/>
          <stop offset="100%" stop-color="#ef4444"/>
        </linearGradient>
      </defs>
      <!-- Background arc -->
      <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#1e2640" stroke-width="8" stroke-linecap="round"/>
      <!-- Colored arc -->
      <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="url(#meterGrad)" stroke-width="8" stroke-linecap="round" opacity="0.3"/>
      <!-- Needle -->
      <g transform="rotate(${angle} 60 60)">
        <line x1="60" y1="60" x2="60" y2="20" stroke="${color}" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y2" from="60" to="20" dur="0.5s" fill="freeze"/>
        </line>
        <circle cx="60" cy="60" r="6" fill="${color}"/>
      </g>
      <!-- Labels -->
      <text x="10" y="68" font-size="7" fill="#5a6a88">Safe</text>
      <text x="95" y="68" font-size="7" fill="#5a6a88">Risky</text>
    </svg>
    <div class="risk-meter-label" style="color: ${color}">${label}</div>
  `;
  container.classList.remove('hidden');
}


/* ═══════════════════════════════════════════════════════════
   TRADE VISUALIZER (SVG Chart)
   ═══════════════════════════════════════════════════════════ */

function renderTradeVisualizer(data) {
  const container = $('trade-visualizer');
  if (!container) return;

  const { entry, stop, tp, liqPrice, direction, rrRatio, risk$, profit$ } = data;

  // Collect all price levels
  const prices = [entry, stop];
  if (tp > 0) prices.push(tp);
  if (liqPrice) prices.push(liqPrice);

  const minP = Math.min(...prices) * 0.995;
  const maxP = Math.max(...prices) * 1.005;
  const range = maxP - minP;

  // SVG dimensions
  const width = 300;
  const height = 180;
  const padding = { top: 25, bottom: 25, left: 70, right: 70 };
  const chartH = height - padding.top - padding.bottom;

  // Price to Y coordinate (inverted: high price = low Y)
  const priceToY = p => padding.top + ((maxP - p) / range) * chartH;

  const entryY = priceToY(entry);
  const stopY = priceToY(stop);
  const tpY = tp > 0 ? priceToY(tp) : null;
  const liqY = liqPrice ? priceToY(liqPrice) : null;

  // Colors
  const greenColor = '#10b981';
  const redColor = '#ef4444';
  const yellowColor = '#f59e0b';
  const entryColor = '#5b63f7';

  // Zone colors based on direction
  const rewardZone = direction === 'long' 
    ? { y1: tpY, y2: entryY, color: greenColor }
    : { y1: entryY, y2: tpY, color: greenColor };
  
  const riskZone = direction === 'long'
    ? { y1: entryY, y2: stopY, color: redColor }
    : { y1: stopY, y2: entryY, color: redColor };

  let svg = `
    <svg viewBox="0 0 ${width} ${height}" class="trade-viz-svg">
      <defs>
        <linearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${greenColor}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${greenColor}" stop-opacity="0.05"/>
        </linearGradient>
        <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${redColor}" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="${redColor}" stop-opacity="0.25"/>
        </linearGradient>
      </defs>
  `;

  // Reward zone (if TP exists)
  if (tpY !== null) {
    const zoneY = Math.min(tpY, entryY);
    const zoneH = Math.abs(tpY - entryY);
    svg += `
      <rect x="${padding.left}" y="${zoneY}" width="${width - padding.left - padding.right}" height="${zoneH}" 
            fill="url(#rewardGrad)" rx="4">
        <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze"/>
      </rect>
    `;
  }

  // Risk zone
  const riskZoneY = Math.min(entryY, stopY);
  const riskZoneH = Math.abs(stopY - entryY);
  svg += `
    <rect x="${padding.left}" y="${riskZoneY}" width="${width - padding.left - padding.right}" height="${riskZoneH}" 
          fill="url(#riskGrad)" rx="4">
      <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze"/>
    </rect>
  `;

  // Price lines
  const lineStart = padding.left;
  const lineEnd = width - padding.right;

  // Take Profit line
  if (tpY !== null) {
    svg += `
      <line x1="${lineStart}" y1="${tpY}" x2="${lineEnd}" y2="${tpY}" 
            stroke="${greenColor}" stroke-width="2" stroke-dasharray="6,4">
        <animate attributeName="x2" from="${lineStart}" to="${lineEnd}" dur="0.3s" fill="freeze"/>
      </line>
      <text x="${lineEnd + 5}" y="${tpY + 4}" font-size="10" fill="${greenColor}" font-weight="600">TP</text>
      <text x="${lineStart - 5}" y="${tpY + 4}" font-size="9" fill="${greenColor}" text-anchor="end">$${fmtPrice(tp).replace(/,/g, '')}</text>
    `;
    if (profit$) {
      svg += `<text x="${lineEnd + 5}" y="${tpY + 14}" font-size="8" fill="${greenColor}" opacity="0.8">+$${fmtNum(profit$, 0)}</text>`;
    }
  }

  // Entry line
  svg += `
    <line x1="${lineStart}" y1="${entryY}" x2="${lineEnd}" y2="${entryY}" 
          stroke="${entryColor}" stroke-width="2.5">
      <animate attributeName="x2" from="${lineStart}" to="${lineEnd}" dur="0.3s" fill="freeze"/>
    </line>
    <text x="${lineEnd + 5}" y="${entryY + 4}" font-size="10" fill="${entryColor}" font-weight="600">Entry</text>
    <text x="${lineStart - 5}" y="${entryY + 4}" font-size="9" fill="${entryColor}" text-anchor="end">$${fmtPrice(entry).replace(/,/g, '')}</text>
  `;

  // Stop Loss line
  svg += `
    <line x1="${lineStart}" y1="${stopY}" x2="${lineEnd}" y2="${stopY}" 
          stroke="${redColor}" stroke-width="2" stroke-dasharray="6,4">
      <animate attributeName="x2" from="${lineStart}" to="${lineEnd}" dur="0.3s" fill="freeze"/>
    </line>
    <text x="${lineEnd + 5}" y="${stopY + 4}" font-size="10" fill="${redColor}" font-weight="600">SL</text>
    <text x="${lineStart - 5}" y="${stopY + 4}" font-size="9" fill="${redColor}" text-anchor="end">$${fmtPrice(stop).replace(/,/g, '')}</text>
    <text x="${lineEnd + 5}" y="${stopY + 14}" font-size="8" fill="${redColor}" opacity="0.8">-$${fmtNum(risk$, 0)}</text>
  `;

  // Liquidation line (if exists)
  if (liqY !== null) {
    svg += `
      <line x1="${lineStart}" y1="${liqY}" x2="${lineEnd}" y2="${liqY}" 
            stroke="${yellowColor}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.7">
        <animate attributeName="x2" from="${lineStart}" to="${lineEnd}" dur="0.3s" fill="freeze"/>
      </line>
      <text x="${lineEnd + 5}" y="${liqY + 4}" font-size="9" fill="${yellowColor}" opacity="0.8">Liq</text>
      <text x="${lineStart - 5}" y="${liqY + 4}" font-size="8" fill="${yellowColor}" text-anchor="end" opacity="0.8">$${fmtPrice(liqPrice).replace(/,/g, '')}</text>
    `;
  }

  // R:R badge
  if (rrRatio !== null) {
    const badgeColor = rrRatio >= 2 ? greenColor : rrRatio >= 1.5 ? yellowColor : redColor;
    svg += `
      <rect x="${width/2 - 30}" y="5" width="60" height="18" rx="9" fill="${badgeColor}" opacity="0.15"/>
      <text x="${width/2}" y="17" font-size="10" fill="${badgeColor}" text-anchor="middle" font-weight="700">
        R:R ${fmtNum(rrRatio, 1)}:1
      </text>
    `;
  }

  // Direction arrow
  const arrowY = entryY;
  const arrowDir = direction === 'long' ? -1 : 1;
  svg += `
    <path d="M ${width/2} ${arrowY} l -6 ${12 * arrowDir} l 12 0 Z" 
          fill="${direction === 'long' ? greenColor : redColor}" opacity="0.6">
      <animate attributeName="opacity" from="0" to="0.6" dur="0.5s" fill="freeze"/>
    </path>
  `;

  svg += '</svg>';

  container.innerHTML = svg;
  container.classList.remove('hidden');
}


/* ═══════════════════════════════════════════════════════════
   COPY RESULTS
   ═══════════════════════════════════════════════════════════ */

function copyResults() {
  if (!lastCalcData) return;

  const d = lastCalcData;
  let text = `📊 Trade Setup (${d.direction.toUpperCase()})

💰 Account: ${fmtUSD(d.account)}
⚠️ Risk: ${fmtPct(d.riskPct)} (${fmtUSD(d.risk$)})

📍 Entry: ${fmtUSD(d.entry)}
🛑 Stop Loss: ${fmtUSD(d.stop)}`;

  if (d.tp > 0) {
    text += `\n🎯 Take Profit: ${fmtUSD(d.tp)}`;
  }

  text += `\n\n📐 Position Size: ${fmtUnits(d.units)} units (${fmtUSD(d.posVal)})`;

  if (d.rrRatio !== null) {
    text += `\n📈 Risk/Reward: ${fmtNum(d.rrRatio, 2)}:1`;
    text += `\n💵 Potential Profit: ${fmtUSD(d.profit$)}`;
  }

  if (d.liqPrice !== null) {
    text += `\n⚡ Est. Liquidation: ${fmtUSD(d.liqPrice)} (${d.leverage}x)`;
  }

  text += `\n\n🔗 Calculate yours: https://valemond06-svg.github.io/crypto-calculator/`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = $('btn-copy');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg class="action-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg> Copied!';
      btn.classList.add('success');
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('success');
      }, 2000);
    }
  });
}


/* ═══════════════════════════════════════════════════════════
   SHARE TO X (Twitter)
   ═══════════════════════════════════════════════════════════ */

function shareToX() {
  if (!lastCalcData) return;

  const d = lastCalcData;
  let text = `${d.direction === 'long' ? '📈' : '📉'} ${d.direction.toUpperCase()} Setup\n`;
  text += `Entry: ${fmtUSD(d.entry)}\n`;
  text += `Stop: ${fmtUSD(d.stop)}\n`;
  
  if (d.tp > 0) {
    text += `TP: ${fmtUSD(d.tp)}\n`;
  }
  
  if (d.rrRatio !== null) {
    text += `R:R: ${fmtNum(d.rrRatio, 1)}:1 ${d.rrRatio >= 2 ? '✅' : d.rrRatio >= 1.5 ? '⚠️' : '❌'}\n`;
  }

  text += `\nCalculate yours 👇`;

  const url = 'https://valemond06-svg.github.io/crypto-calculator/';
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  
  window.open(twitterUrl, '_blank', 'width=550,height=420');
}


/* ═══════════════════════════════════════════════════════════
   EXPORT AS IMAGE
   ═══════════════════════════════════════════════════════════ */

async function exportAsImage() {
  if (!lastCalcData) return;

  const btn = $('btn-export');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg class="action-icon spin" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="25 75"/></svg> Generating...';
  }

  const d = lastCalcData;

  // Create canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const w = 600;
  const h = 400;
  const dpr = 2;
  
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = '#09090f';
  ctx.fillRect(0, 0, w, h);

  // Border
  ctx.strokeStyle = '#1e2640';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  // Header
  ctx.fillStyle = '#5b63f7';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillText('CryptoCalc', 30, 40);

  ctx.fillStyle = d.direction === 'long' ? '#10b981' : '#ef4444';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(d.direction.toUpperCase(), 160, 40);

  // Divider
  ctx.strokeStyle = '#1e2640';
  ctx.beginPath();
  ctx.moveTo(30, 55);
  ctx.lineTo(w - 30, 55);
  ctx.stroke();

  // Main stats
  ctx.fillStyle = '#8494b2';
  ctx.font = '12px system-ui, sans-serif';
  
  const leftCol = 30;
  const rightCol = 320;
  let y = 85;
  const lineH = 35;

  // Left column
  ctx.fillText('Entry Price', leftCol, y);
  ctx.fillStyle = '#e2e8f4';
  ctx.font = 'bold 18px SF Mono, monospace';
  ctx.fillText(fmtUSD(d.entry), leftCol, y + 20);

  ctx.fillStyle = '#8494b2';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('Stop Loss', leftCol, y + lineH + 15);
  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 18px SF Mono, monospace';
  ctx.fillText(fmtUSD(d.stop), leftCol, y + lineH + 35);

  if (d.tp > 0) {
    ctx.fillStyle = '#8494b2';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Take Profit', leftCol, y + lineH * 2 + 30);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 18px SF Mono, monospace';
    ctx.fillText(fmtUSD(d.tp), leftCol, y + lineH * 2 + 50);
  }

  // Right column
  ctx.fillStyle = '#8494b2';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('Position Size', rightCol, y);
  ctx.fillStyle = '#7c83f8';
  ctx.font = 'bold 18px SF Mono, monospace';
  ctx.fillText(fmtUnits(d.units) + ' units', rightCol, y + 20);

  ctx.fillStyle = '#8494b2';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('Risk Amount', rightCol, y + lineH + 15);
  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 18px SF Mono, monospace';
  ctx.fillText(fmtUSD(d.risk$) + ` (${fmtPct(d.riskPct)})`, rightCol, y + lineH + 35);

  if (d.rrRatio !== null) {
    ctx.fillStyle = '#8494b2';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Risk / Reward', rightCol, y + lineH * 2 + 30);
    ctx.fillStyle = d.rrRatio >= 2 ? '#10b981' : d.rrRatio >= 1.5 ? '#f59e0b' : '#ef4444';
    ctx.font = 'bold 18px SF Mono, monospace';
    ctx.fillText(fmtNum(d.rrRatio, 2) + ':1', rightCol, y + lineH * 2 + 50);
  }

  // Bottom stats
  y = 280;
  ctx.fillStyle = '#1e2640';
  ctx.fillRect(20, y, w - 40, 60);

  ctx.fillStyle = '#8494b2';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('Account', 40, y + 20);
  ctx.fillStyle = '#e2e8f4';
  ctx.font = 'bold 14px SF Mono, monospace';
  ctx.fillText(fmtUSD(d.account), 40, y + 40);

  if (d.profit$ !== null) {
    ctx.fillStyle = '#8494b2';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Potential Profit', 180, y + 20);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 14px SF Mono, monospace';
    ctx.fillText(fmtUSD(d.profit$), 180, y + 40);
  }

  if (d.liqPrice !== null) {
    ctx.fillStyle = '#8494b2';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`Est. Liquidation (${d.leverage}x)`, 350, y + 20);
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 14px SF Mono, monospace';
    ctx.fillText(fmtUSD(d.liqPrice), 350, y + 40);
  }

  // Footer
  ctx.fillStyle = '#5a6a88';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('valemond06-svg.github.io/crypto-calculator', 30, h - 20);

  // Download
  const link = document.createElement('a');
  link.download = `trade-setup-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  // Reset button
  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg class="action-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 10h14M10 3v14"/></svg> Export';
    }
  }, 500);
}


/* ═══════════════════════════════════════════════════════════
   PRESET RISK PROFILES
   ═══════════════════════════════════════════════════════════ */

function setRiskPreset(pct) {
  const input = $('risk-percent');
  const slider = $('risk-range');
  if (input) input.value = pct;
  if (slider) slider.value = Math.min(10, pct);
  
  // Update active state on buttons
  $$('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.risk) === pct);
  });
  
  runCalculation();
}


/* ═══════════════════════════════════════════════════════════
   RISK SLIDER SYNC
   ═══════════════════════════════════════════════════════════ */

function syncSliderFromInput() {
  const pct = parseFloat($('risk-percent')?.value) || 2;
  const clamped = Math.min(10, Math.max(0.1, pct));
  if ($('risk-range')) $('risk-range').value = clamped;
  
  // Update preset buttons
  $$('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.risk) === pct);
  });
}


/* ═══════════════════════════════════════════════════════════
   FAQ ACCORDION
   ═══════════════════════════════════════════════════════════ */

function initFAQ() {
  $$('.faq-item').forEach(item => {
    const btn = item.querySelector('.faq-q');
    const ans = item.querySelector('.faq-ans');
    if (!btn || !ans) return;

    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');

      $$('.faq-item').forEach(other => {
        other.classList.remove('open');
        other.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
        other.querySelector('.faq-ans')?.setAttribute('hidden', '');
      });

      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        ans.removeAttribute('hidden');
      }
    });
  });
}


/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* Bind numeric inputs to live calculation */
  ['account-balance', 'entry-price', 'stop-loss', 'take-profit', 'leverage', 'fee-percent']
    .forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', runCalculation);
    });

  /* Risk percent input */
  const riskInput = $('risk-percent');
  if (riskInput) {
    riskInput.addEventListener('input', () => {
      syncSliderFromInput();
      runCalculation();
    });
  }

  /* Risk range slider */
  const riskSlider = $('risk-range');
  if (riskSlider) {
    riskSlider.addEventListener('input', () => {
      if ($('risk-percent')) $('risk-percent').value = riskSlider.value;
      syncSliderFromInput();
      runCalculation();
    });
  }

  /* Direction buttons */
  const btnLong = $('btn-long');
  const btnShort = $('btn-short');
  if (btnLong) btnLong.addEventListener('click', () => setDirection('long'));
  if (btnShort) btnShort.addEventListener('click', () => setDirection('short'));

  /* Preset risk buttons */
  $$('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const risk = parseFloat(btn.dataset.risk);
      if (risk) setRiskPreset(risk);
    });
  });

  /* Live price fetch */
  const btnFetch = $('btn-fetch-price');
  if (btnFetch) {
    btnFetch.addEventListener('click', async () => {
      const price = await fetchPrice(selectedAsset);
      if (price) applyFetchedPrice(price);
    });
  }

  /* Asset selector */
  $$('.asset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedAsset = btn.dataset.asset;
      $$('.asset-btn').forEach(b => b.classList.toggle('active', b === btn));
      // Update display
      const display = $('live-price-display');
      const cached = getCachedPrice(selectedAsset);
      if (display) {
        display.textContent = cached ? fmtUSD(cached) : '—';
      }
    });
  });

  /* Copy results */
  const btnCopy = $('btn-copy');
  if (btnCopy) btnCopy.addEventListener('click', copyResults);

  /* Share to X */
  const btnShare = $('btn-share');
  if (btnShare) btnShare.addEventListener('click', shareToX);

  /* Export image */
  const btnExport = $('btn-export');
  if (btnExport) btnExport.addEventListener('click', exportAsImage);

  /* Reset */
  const btnReset = $('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const form = $('calculator-form');
      if (form) form.reset();
      if ($('risk-percent')) $('risk-percent').value = '2';
      if ($('risk-range')) $('risk-range').value = '2';
      direction = 'long';
      if ($('btn-long')) $('btn-long').classList.add('active');
      if ($('btn-short')) $('btn-short').classList.remove('active');
      clearError();
      if ($('results')) $('results').classList.add('hidden');
      if ($('risk-meter')) $('risk-meter').classList.add('hidden');
      if ($('trade-visualizer')) $('trade-visualizer').classList.add('hidden');
      if ($('result-actions')) $('result-actions').classList.add('hidden');
      resultsShownOnce = false;
      lastCalcData = null;
      $$('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.risk) === 2);
      });
    });
  }

  /* FAQ */
  initFAQ();

  /* Set initial preset active state */
  $$('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.risk) === 2);
  });
});
