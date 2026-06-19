/**
 * RiskLab 3.0 - Crypto Position Size Calculator
 * Know your risk before you trade
 * 
 * Features:
 * - Position size calculation
 * - Risk/reward visualization
 * - Liquidation price estimate
 * - Live price fetch
 * - Auto-save & history
 * - Export & share
 */

(function() {
  'use strict';

  // ============================================
  // State
  // ============================================
  const state = {
    asset: 'BTC',
    direction: 'long',
    livePrice: null,
    history: [],
    portfolio: [],
    totalCalculations: 0,
    autoSaveEnabled: true,
    lastResults: null
  };

  // ============================================
  // DOM References
  // ============================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Form
    form: $('#calculator-form'),
    accountBalance: $('#account-balance'),
    riskPercent: $('#risk-percent'),
    riskSlider: $('#risk-slider'),
    entryPrice: $('#entry-price'),
    stopLoss: $('#stop-loss'),
    takeProfit: $('#take-profit'),
    leverage: $('#leverage'),
    feePercent: $('#fee-percent'),
    
    // Display
    livePrice: $('#live-price'),
    stopDistance: $('#stop-distance'),
    errorMessage: $('#error-message'),
    
    // Results
    resultsEmpty: $('#results-empty'),
    resultsContent: $('#results-content'),
    rrBadge: $('#rr-badge'),
    riskGauge: $('#risk-gauge'),
    riskLabel: $('#risk-label'),
    riskFactors: $('#risk-factors'),
    
    // Result values
    resUnits: $('#res-units'),
    resUnitsSub: $('#res-units-sub'),
    resValue: $('#res-value'),
    resValueSub: $('#res-value-sub'),
    resRisk: $('#res-risk'),
    resRiskSub: $('#res-risk-sub'),
    resRR: $('#res-rr'),
    resRRSub: $('#res-rr-sub'),
    resBreakeven: $('#res-breakeven'),
    resProfit: $('#res-profit'),
    resProfitSub: $('#res-profit-sub'),
    resLiq: $('#res-liq'),
    resLiqSub: $('#res-liq-sub'),
    
    // Cards
    cardRR: $('#card-rr'),
    cardBreakeven: $('#card-breakeven'),
    cardProfit: $('#card-profit'),
    cardLiq: $('#card-liq'),
    liqWarning: $('#liq-warning'),
    
    // Trade visualizer
    tradeChart: $('#trade-chart'),
    
    // History
    historyList: $('#history-list'),
    historySection: $('#history-section'),
    
    // Portfolio
    portfolioPositions: $('#portfolio-positions'),
    portfolioSummary: $('#portfolio-summary'),
    portfolioCount: $('#portfolio-count'),
    portfolioTotalRisk: $('#portfolio-total-risk'),
    portfolioRiskPercent: $('#portfolio-risk-percent'),
    portfolioPotentialProfit: $('#portfolio-potential-profit'),
    
    // Footer
    totalCalculations: $('#total-calculations'),
    
    // Panels (for mobile)
    panelSetup: $('#panel-setup'),
    panelResults: $('#panel-results'),
    
    // Quick start
    quickStart: $('#quick-start')
  };

  // ============================================
  // Tooltip Content
  // ============================================
  const tooltips = {
    account: 'Your total trading account balance in USD. This is used to calculate the dollar amount you\'ll risk per trade.',
    risk: 'Percentage of your account you\'re willing to lose on this trade. Professional traders typically risk 1-2% per trade.',
    entry: 'The price at which you plan to enter the trade. Use the "Fetch Price" button to get the current market price.',
    stop: 'The price at which your trade will be closed to limit losses. Your position size is calculated to lose exactly your risk amount if this price is hit.'
  };

  // ============================================
  // Formatters
  // ============================================
  const fmt = {
    usd: (n, decimals = 2) => {
      if (n === null || isNaN(n)) return '—';
      return '$' + n.toLocaleString('en-US', { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
      });
    },
    
    number: (n, decimals = 4) => {
      if (n === null || isNaN(n)) return '—';
      // Remove trailing zeros
      const formatted = n.toFixed(decimals);
      return parseFloat(formatted).toString();
    },
    
    percent: (n, decimals = 2) => {
      if (n === null || isNaN(n)) return '—';
      return n.toFixed(decimals) + '%';
    },
    
    ratio: (n) => {
      if (n === null || isNaN(n)) return '—';
      return '1:' + n.toFixed(2);
    },
    
    compact: (n) => {
      if (n === null || isNaN(n)) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toFixed(2);
    }
  };

  // ============================================
  // Calculations
  // ============================================
  function calculate() {
    // Get values
    const accountBalance = parseFloat(dom.accountBalance.value);
    const riskPercent = parseFloat(dom.riskPercent.value);
    const entryPrice = parseFloat(dom.entryPrice.value);
    const stopLoss = parseFloat(dom.stopLoss.value);
    const takeProfit = parseFloat(dom.takeProfit.value) || null;
    const leverage = parseFloat(dom.leverage.value) || 1;
    const feePercent = parseFloat(dom.feePercent.value) || 0;
    const direction = state.direction;

    // Validation
    const errors = [];
    
    if (!accountBalance || accountBalance <= 0) {
      errors.push('Enter a valid account balance');
    }
    if (!riskPercent || riskPercent <= 0 || riskPercent > 100) {
      errors.push('Risk must be between 0.1% and 100%');
    }
    if (!entryPrice || entryPrice <= 0) {
      errors.push('Enter a valid entry price');
    }
    if (!stopLoss || stopLoss <= 0) {
      errors.push('Enter a valid stop loss price');
    }
    
    // Direction validation
    if (direction === 'long' && stopLoss >= entryPrice) {
      errors.push('Stop loss must be below entry for long positions');
    }
    if (direction === 'short' && stopLoss <= entryPrice) {
      errors.push('Stop loss must be above entry for short positions');
    }
    
    // Take profit validation
    if (takeProfit) {
      if (direction === 'long' && takeProfit <= entryPrice) {
        errors.push('Take profit must be above entry for long positions');
      }
      if (direction === 'short' && takeProfit >= entryPrice) {
        errors.push('Take profit must be below entry for short positions');
      }
    }

    if (errors.length > 0) {
      showError(errors[0]);
      hideResults();
      return null;
    }

    hideError();

    // Core calculations
    const riskAmount = accountBalance * (riskPercent / 100);
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const stopDistancePercent = (stopDistance / entryPrice) * 100;
    
    // Position size in units
    const positionUnits = riskAmount / stopDistance;
    const positionValue = positionUnits * entryPrice;
    
    // Fee calculation (round trip)
    const totalFees = positionValue * (feePercent / 100) * 2;
    const riskAmountWithFees = riskAmount + totalFees;
    
    // R:R calculation
    let rrRatio = null;
    let potentialProfit = null;
    let breakevenWinRate = null;
    
    if (takeProfit) {
      const tpDistance = Math.abs(takeProfit - entryPrice);
      rrRatio = tpDistance / stopDistance;
      potentialProfit = positionUnits * tpDistance - totalFees;
      breakevenWinRate = 1 / (1 + rrRatio) * 100;
    }
    
    // Liquidation price (simplified isolated margin)
    let liquidationPrice = null;
    if (leverage > 1) {
      const maintenanceMargin = 0.005; // 0.5%
      const margin = positionValue / leverage;
      
      if (direction === 'long') {
        liquidationPrice = entryPrice * (1 - (1 / leverage) + maintenanceMargin);
      } else {
        liquidationPrice = entryPrice * (1 + (1 / leverage) - maintenanceMargin);
      }
    }
    
    // Margin required
    const marginRequired = leverage > 1 ? positionValue / leverage : positionValue;
    
    // Risk assessment score (0-100)
    let riskScore = 0;
    const riskFactorsList = [];
    
    // Factor 1: Risk percentage (higher = more risky)
    if (riskPercent <= 1) { riskScore += 10; riskFactorsList.push('Low risk %'); }
    else if (riskPercent <= 2) { riskScore += 20; }
    else if (riskPercent <= 5) { riskScore += 40; riskFactorsList.push('Moderate risk %'); }
    else { riskScore += 60; riskFactorsList.push('High risk %'); }
    
    // Factor 2: Leverage
    if (leverage <= 1) { riskScore += 0; }
    else if (leverage <= 5) { riskScore += 10; }
    else if (leverage <= 20) { riskScore += 20; riskFactorsList.push('Leverage'); }
    else { riskScore += 40; riskFactorsList.push('High leverage'); }
    
    // Factor 3: Stop distance
    if (stopDistancePercent > 10) { riskScore += 10; riskFactorsList.push('Wide stop'); }
    
    // Factor 4: Position size relative to account
    const positionRatio = positionValue / accountBalance;
    if (positionRatio > 0.5) { riskScore += 10; riskFactorsList.push('Large position'); }
    
    // Risk level
    let riskLevel = 'Low';
    if (riskScore > 60) riskLevel = 'High';
    else if (riskScore > 30) riskLevel = 'Medium';

    const results = {
      positionUnits,
      positionValue,
      riskAmount,
      riskAmountWithFees,
      stopDistance,
      stopDistancePercent,
      rrRatio,
      potentialProfit,
      breakevenWinRate,
      liquidationPrice,
      marginRequired,
      totalFees,
      leverage,
      riskScore,
      riskLevel,
      riskFactors: riskFactorsList,
      // Input values for history
      asset: state.asset,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      accountBalance,
      riskPercent
    };

    displayResults(results);
    updateVisualization(results);
    saveToHistory(results);
    incrementCalculations();
    
    // Store for portfolio
    state.lastResults = results;
    
    return results;
  }

  // ============================================
  // Display Functions
  // ============================================
  function displayResults(r) {
    dom.resultsEmpty.classList.add('hidden');
    dom.resultsContent.classList.remove('hidden');
    
    // Position size
    dom.resUnits.textContent = fmt.number(r.positionUnits, 6);
    dom.resUnitsSub.textContent = `${state.asset} units`;
    
    // Position value
    dom.resValue.textContent = fmt.usd(r.positionValue);
    dom.resValueSub.textContent = r.leverage > 1 ? `Margin: ${fmt.usd(r.marginRequired)}` : '';
    
    // Risk amount
    dom.resRisk.textContent = fmt.usd(r.riskAmount);
    dom.resRiskSub.textContent = r.totalFees > 0 
      ? `+${fmt.usd(r.totalFees)} fees = ${fmt.usd(r.riskAmountWithFees)} total`
      : `${fmt.percent(r.riskPercent)} of account`;
    
    // R:R
    if (r.rrRatio) {
      dom.cardRR.classList.remove('hidden');
      dom.cardBreakeven.classList.remove('hidden');
      dom.cardProfit.classList.remove('hidden');
      
      dom.resRR.textContent = fmt.ratio(r.rrRatio);
      dom.resRRSub.textContent = r.rrRatio >= 2 ? 'Good R:R' : r.rrRatio >= 1 ? 'Fair R:R' : 'Poor R:R';
      
      dom.resBreakeven.textContent = fmt.percent(r.breakevenWinRate, 1);
      
      dom.resProfit.textContent = fmt.usd(r.potentialProfit);
      dom.resProfitSub.textContent = `+${fmt.percent((r.potentialProfit / r.accountBalance) * 100, 1)} of account`;
      
      // R:R badge
      dom.rrBadge.textContent = `R:R ${r.rrRatio.toFixed(2)}`;
      dom.rrBadge.className = 'visualizer-badge';
      if (r.rrRatio >= 2) dom.rrBadge.classList.add('positive');
      else if (r.rrRatio < 1) dom.rrBadge.classList.add('negative');
    } else {
      dom.cardRR.classList.add('hidden');
      dom.cardBreakeven.classList.add('hidden');
      dom.cardProfit.classList.add('hidden');
      dom.rrBadge.textContent = 'R:R —';
      dom.rrBadge.className = 'visualizer-badge';
    }
    
    // Liquidation
    if (r.liquidationPrice && r.leverage > 1) {
      dom.cardLiq.classList.remove('hidden');
      dom.liqWarning.classList.remove('hidden');
      
      dom.resLiq.textContent = fmt.usd(r.liquidationPrice);
      
      const liqDistance = Math.abs(r.liquidationPrice - r.entryPrice) / r.entryPrice * 100;
      dom.resLiqSub.textContent = `${liqDistance.toFixed(1)}% from entry at ${r.leverage}x`;
    } else {
      dom.cardLiq.classList.add('hidden');
      dom.liqWarning.classList.add('hidden');
    }
    
    // Risk meter
    const riskPosition = Math.min(r.riskScore, 100);
    dom.riskGauge.style.setProperty('--risk-position', `${riskPosition}%`);
    dom.riskLabel.textContent = r.riskLevel + ' Risk';
    dom.riskLabel.className = 'risk-meter-label ' + r.riskLevel.toLowerCase();
    dom.riskFactors.textContent = r.riskFactors.length > 0 
      ? r.riskFactors.join(' • ') 
      : 'Standard trade parameters';
    
    // Stop distance hint
    dom.stopDistance.textContent = `${fmt.percent(r.stopDistancePercent, 2)} from entry`;
    
    // Auto-switch to results on mobile
    if (window.innerWidth <= 768) {
      switchMobileTab('results');
    }
  }

  function hideResults() {
    dom.resultsEmpty.classList.remove('hidden');
    dom.resultsContent.classList.add('hidden');
    dom.stopDistance.textContent = '';
  }

  function showError(message) {
    dom.errorMessage.textContent = message;
    dom.errorMessage.classList.remove('hidden');
  }

  function hideError() {
    dom.errorMessage.classList.add('hidden');
  }

  // ============================================
  // Trade Visualization
  // ============================================
  function updateVisualization(r) {
    const chart = dom.tradeChart;
    const isLong = r.direction === 'long';
    
    // Calculate price range
    const prices = [r.entryPrice, r.stopLoss];
    if (r.takeProfit) prices.push(r.takeProfit);
    if (r.liquidationPrice) prices.push(r.liquidationPrice);
    
    const minPrice = Math.min(...prices) * 0.995;
    const maxPrice = Math.max(...prices) * 1.005;
    const range = maxPrice - minPrice;
    
    // Convert price to Y position (inverted: higher price = lower Y)
    const priceToY = (price) => ((maxPrice - price) / range) * 160 + 20;
    
    const entryY = priceToY(r.entryPrice);
    const stopY = priceToY(r.stopLoss);
    const tpY = r.takeProfit ? priceToY(r.takeProfit) : null;
    const liqY = r.liquidationPrice ? priceToY(r.liquidationPrice) : null;
    
    // Build SVG
    let svg = `
      <svg width="100%" height="200" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="profitZone" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#22c55e" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="#22c55e" stop-opacity="0.05"/>
          </linearGradient>
          <linearGradient id="lossZone" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ef4444" stop-opacity="0.05"/>
            <stop offset="100%" stop-color="#ef4444" stop-opacity="0.2"/>
          </linearGradient>
        </defs>
    `;
    
    // Profit zone (above entry for long, below for short)
    if (r.takeProfit) {
      if (isLong) {
        svg += `<rect x="40" y="${tpY}" width="320" height="${entryY - tpY}" fill="url(#profitZone)"/>`;
      } else {
        svg += `<rect x="40" y="${entryY}" width="320" height="${tpY - entryY}" fill="url(#profitZone)"/>`;
      }
    }
    
    // Loss zone (below entry for long, above for short)
    if (isLong) {
      svg += `<rect x="40" y="${entryY}" width="320" height="${stopY - entryY}" fill="url(#lossZone)"/>`;
    } else {
      svg += `<rect x="40" y="${stopY}" width="320" height="${entryY - stopY}" fill="url(#lossZone)"/>`;
    }
    
    // Take profit line
    if (tpY !== null) {
      svg += `
        <line x1="40" y1="${tpY}" x2="360" y2="${tpY}" stroke="#22c55e" stroke-width="2" stroke-dasharray="6,4"/>
        <circle cx="360" cy="${tpY}" r="4" fill="#22c55e"/>
        <text x="45" y="${tpY - 6}" fill="#22c55e" font-size="11" font-weight="500">TP ${fmt.usd(r.takeProfit, 0)}</text>
      `;
    }
    
    // Entry line
    svg += `
      <line x1="40" y1="${entryY}" x2="360" y2="${entryY}" stroke="#14b8a6" stroke-width="2"/>
      <circle cx="40" cy="${entryY}" r="6" fill="#14b8a6"/>
      <text x="45" y="${entryY - 6}" fill="#14b8a6" font-size="11" font-weight="600">Entry ${fmt.usd(r.entryPrice, 0)}</text>
    `;
    
    // Stop loss line
    svg += `
      <line x1="40" y1="${stopY}" x2="360" y2="${stopY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4"/>
      <circle cx="360" cy="${stopY}" r="4" fill="#ef4444"/>
      <text x="45" y="${stopY + 14}" fill="#ef4444" font-size="11" font-weight="500">SL ${fmt.usd(r.stopLoss, 0)}</text>
    `;
    
    // Liquidation line
    if (liqY !== null) {
      svg += `
        <line x1="40" y1="${liqY}" x2="360" y2="${liqY}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,3"/>
        <text x="300" y="${liqY + 14}" fill="#f59e0b" font-size="10">LIQ ${fmt.usd(r.liquidationPrice, 0)}</text>
      `;
    }
    
    // Direction arrow
    const arrowY = entryY + (isLong ? -30 : 30);
    svg += `
      <text x="370" y="${entryY}" fill="${isLong ? '#22c55e' : '#ef4444'}" font-size="20" text-anchor="middle">${isLong ? '▲' : '▼'}</text>
    `;
    
    svg += '</svg>';
    chart.innerHTML = svg;
  }

  // ============================================
  // Live Price Fetch
  // ============================================
  async function fetchLivePrice() {
    const btn = $('#btn-fetch-price');
    btn.classList.add('loading');
    btn.disabled = true;
    
    try {
      // CoinGecko free API (no key needed, rate limited)
      const coinIds = {
        BTC: 'bitcoin',
        ETH: 'ethereum',
        SOL: 'solana',
        BNB: 'binancecoin'
      };
      
      const coinId = coinIds[state.asset];
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(5000) }
      );
      
      if (!response.ok) throw new Error('API error');
      
      const data = await response.json();
      const price = data[coinId]?.usd;
      
      if (price) {
        state.livePrice = price;
        dom.livePrice.textContent = fmt.usd(price);
        dom.entryPrice.value = price;
        dom.entryPrice.dispatchEvent(new Event('input'));
        showToast(`${state.asset} price: ${fmt.usd(price)}`, 'success');
      } else {
        throw new Error('No price data');
      }
    } catch (error) {
      console.error('Price fetch error:', error);
      dom.livePrice.textContent = 'Error';
      showToast('Could not fetch price. Try again.', 'error');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  // ============================================
  // History
  // ============================================
  function saveToHistory(results) {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      asset: results.asset,
      direction: results.direction,
      entryPrice: results.entryPrice,
      stopLoss: results.stopLoss,
      takeProfit: results.takeProfit,
      positionUnits: results.positionUnits,
      positionValue: results.positionValue,
      riskAmount: results.riskAmount,
      rrRatio: results.rrRatio
    };
    
    state.history.unshift(entry);
    
    // Keep only last 20
    if (state.history.length > 20) {
      state.history = state.history.slice(0, 20);
    }
    
    localStorage.setItem('risklab_history', JSON.stringify(state.history));
    renderHistory();
  }

  function loadHistory() {
    try {
      const saved = localStorage.getItem('risklab_history');
      if (saved) {
        state.history = JSON.parse(saved);
        renderHistory();
      }
    } catch (e) {
      console.error('Error loading history:', e);
    }
  }

  function renderHistory() {
    if (state.history.length === 0) {
      dom.historySection.style.display = 'none';
      return;
    }
    
    dom.historySection.style.display = 'block';
    
    dom.historyList.innerHTML = state.history.slice(0, 5).map(h => {
      const time = new Date(h.timestamp);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = isToday(time) ? 'Today' : time.toLocaleDateString([], { month: 'short', day: 'numeric' });
      
      return `
        <div class="history-item" data-id="${h.id}">
          <div class="history-item-info">
            <span class="history-item-asset">${h.asset}</span>
            <span class="history-item-size">${fmt.number(h.positionUnits, 4)} @ ${fmt.usd(h.entryPrice, 0)}</span>
          </div>
          <span class="history-item-time">${dateStr} ${timeStr}</span>
        </div>
      `;
    }).join('');
    
    // Add click handlers
    dom.historyList.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => loadFromHistory(parseInt(el.dataset.id)));
    });
  }

  function loadFromHistory(id) {
    const entry = state.history.find(h => h.id === id);
    if (!entry) return;
    
    // Set asset
    state.asset = entry.asset;
    $$('.asset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.asset === entry.asset);
    });
    
    // Set direction
    state.direction = entry.direction;
    $('#btn-long').classList.toggle('active', entry.direction === 'long');
    $('#btn-short').classList.toggle('active', entry.direction === 'short');
    
    // Set values
    dom.entryPrice.value = entry.entryPrice;
    dom.stopLoss.value = entry.stopLoss;
    if (entry.takeProfit) {
      dom.takeProfit.value = entry.takeProfit;
      // Expand TP section
      $('#group-tp').classList.remove('collapsed');
    }
    
    calculate();
    showToast('Trade loaded from history');
  }

  function clearHistory() {
    state.history = [];
    localStorage.removeItem('risklab_history');
    renderHistory();
    showToast('History cleared');
  }

  function isToday(date) {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }

  // ============================================
  // Calculations Counter
  // ============================================
  function incrementCalculations() {
    state.totalCalculations++;
    localStorage.setItem('risklab_total_calculations', state.totalCalculations);
    dom.totalCalculations.textContent = fmt.compact(state.totalCalculations);
  }

  function loadCalculationsCount() {
    const saved = localStorage.getItem('risklab_total_calculations');
    state.totalCalculations = saved ? parseInt(saved) : 0;
    dom.totalCalculations.textContent = fmt.compact(state.totalCalculations);
  }

  // ============================================
  // Auto-save
  // ============================================
  function saveFormState() {
    if (!state.autoSaveEnabled) return;
    
    const formState = {
      accountBalance: dom.accountBalance.value,
      riskPercent: dom.riskPercent.value,
      entryPrice: dom.entryPrice.value,
      stopLoss: dom.stopLoss.value,
      takeProfit: dom.takeProfit.value,
      leverage: dom.leverage.value,
      feePercent: dom.feePercent.value,
      asset: state.asset,
      direction: state.direction
    };
    
    localStorage.setItem('risklab_form_state', JSON.stringify(formState));
  }

  function loadFormState() {
    try {
      const saved = localStorage.getItem('risklab_form_state');
      if (!saved) return false;
      
      const formState = JSON.parse(saved);
      
      if (formState.accountBalance) dom.accountBalance.value = formState.accountBalance;
      if (formState.riskPercent) {
        dom.riskPercent.value = formState.riskPercent;
        dom.riskSlider.value = formState.riskPercent;
        updateRiskPresets(parseFloat(formState.riskPercent));
      }
      if (formState.entryPrice) dom.entryPrice.value = formState.entryPrice;
      if (formState.stopLoss) dom.stopLoss.value = formState.stopLoss;
      if (formState.takeProfit) dom.takeProfit.value = formState.takeProfit;
      if (formState.leverage) dom.leverage.value = formState.leverage;
      if (formState.feePercent) dom.feePercent.value = formState.feePercent;
      
      if (formState.asset) {
        state.asset = formState.asset;
        $$('.asset-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.asset === formState.asset);
        });
      }
      
      if (formState.direction) {
        state.direction = formState.direction;
        $('#btn-long').classList.toggle('active', formState.direction === 'long');
        $('#btn-short').classList.toggle('active', formState.direction === 'short');
      }
      
      return true;
    } catch (e) {
      console.error('Error loading form state:', e);
      return false;
    }
  }

  // ============================================
  // Copy, Share, Export
  // ============================================
  function copyResults() {
    const results = getResultsText();
    navigator.clipboard.writeText(results).then(() => {
      showToast('Copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Could not copy', 'error');
    });
  }

  function shareResults() {
    const results = getResultsText();
    const url = window.location.href;
    
    if (navigator.share) {
      navigator.share({
        title: 'RiskLab Trade Calculation',
        text: results,
        url: url
      }).catch(() => {});
    } else {
      // Fallback: copy URL
      navigator.clipboard.writeText(`${results}\n\n${url}`).then(() => {
        showToast('Copied to clipboard for sharing!', 'success');
      });
    }
  }

  function exportResults() {
    const results = getResultsText();
    const blob = new Blob([results], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `risklab-trade-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported!', 'success');
  }

  function getResultsText() {
    const lines = [
      '=== RiskLab Trade Calculation ===',
      '',
      `Asset: ${state.asset}`,
      `Direction: ${state.direction.toUpperCase()}`,
      `Entry: ${dom.entryPrice.value}`,
      `Stop Loss: ${dom.stopLoss.value}`,
      dom.takeProfit.value ? `Take Profit: ${dom.takeProfit.value}` : null,
      '',
      `Position Size: ${dom.resUnits.textContent} ${state.asset}`,
      `Position Value: ${dom.resValue.textContent}`,
      `Risk Amount: ${dom.resRisk.textContent}`,
      dom.cardRR.classList.contains('hidden') ? null : `R:R Ratio: ${dom.resRR.textContent}`,
      dom.cardProfit.classList.contains('hidden') ? null : `Potential Profit: ${dom.resProfit.textContent}`,
      dom.cardLiq.classList.contains('hidden') ? null : `Est. Liquidation: ${dom.resLiq.textContent}`,
      '',
      'Calculated at risklab.io'
    ];
    
    return lines.filter(Boolean).join('\n');
  }

  // ============================================
  // Toast Notifications
  // ============================================
  function showToast(message, type = 'default') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });
    
    // Remove after delay
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }

  // ============================================
  // Mobile Tabs
  // ============================================
  function switchMobileTab(tab) {
    $$('.mobile-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    dom.panelSetup.classList.toggle('active', tab === 'setup');
    dom.panelResults.classList.toggle('active', tab === 'results');
  }

  // ============================================
  // Quick Start / Example
  // ============================================
  function loadExample() {
    // BTC long example
    state.asset = 'BTC';
    state.direction = 'long';
    
    $$('.asset-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.asset === 'BTC'));
    $('#btn-long').classList.add('active');
    $('#btn-short').classList.remove('active');
    
    dom.accountBalance.value = 10000;
    dom.riskPercent.value = 2;
    dom.riskSlider.value = 2;
    dom.entryPrice.value = 65000;
    dom.stopLoss.value = 63000;
    dom.takeProfit.value = 70000;
    dom.leverage.value = 10;
    dom.feePercent.value = 0.1;
    
    // Expand optional sections
    $('#group-tp').classList.remove('collapsed');
    $('#group-leverage').classList.remove('collapsed');
    
    // Hide quick start
    dom.quickStart.classList.add('hidden');
    
    updateRiskPresets(2);
    calculate();
  }

  function updateRiskPresets(value) {
    $$('.preset-btn[data-risk]').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.risk) === value);
    });
  }

  // ============================================
  // Collapsible Field Groups
  // ============================================
  function initCollapsibles() {
    $$('.field-group-header[data-toggle]').forEach(header => {
      header.addEventListener('click', () => {
        const group = document.getElementById(header.dataset.toggle);
        if (group) {
          group.classList.toggle('collapsed');
        }
      });
    });
  }

  // ============================================
  // Event Listeners
  // ============================================
  function initEventListeners() {
    // Form inputs - live calculation
    const inputs = [dom.accountBalance, dom.riskPercent, dom.entryPrice, dom.stopLoss, dom.takeProfit, dom.leverage, dom.feePercent];
    inputs.forEach(input => {
      if (input) {
        input.addEventListener('input', debounce(() => {
          calculate();
          saveFormState();
        }, 150));
      }
    });
    
    // Risk slider
    dom.riskSlider.addEventListener('input', (e) => {
      dom.riskPercent.value = e.target.value;
      updateRiskPresets(parseFloat(e.target.value));
      calculate();
      saveFormState();
    });
    
    // Risk presets
    $$('.preset-btn[data-risk]').forEach(btn => {
      btn.addEventListener('click', () => {
        const risk = parseFloat(btn.dataset.risk);
        dom.riskPercent.value = risk;
        dom.riskSlider.value = risk;
        updateRiskPresets(risk);
        calculate();
        saveFormState();
      });
    });
    
    // Asset buttons
    $$('.asset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.asset = btn.dataset.asset;
        $$('.asset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dom.livePrice.textContent = '—';
        state.livePrice = null;
        calculate();
        saveFormState();
      });
    });
    
    // Direction buttons
    $('#btn-long').addEventListener('click', () => {
      state.direction = 'long';
      $('#btn-long').classList.add('active');
      $('#btn-short').classList.remove('active');
      calculate();
      saveFormState();
    });
    
    $('#btn-short').addEventListener('click', () => {
      state.direction = 'short';
      $('#btn-short').classList.add('active');
      $('#btn-long').classList.remove('active');
      calculate();
      saveFormState();
    });
    
    // Fetch price
    $('#btn-fetch-price').addEventListener('click', fetchLivePrice);
    
    // Reset
    $('#btn-reset').addEventListener('click', () => {
      dom.form.reset();
      state.direction = 'long';
      state.asset = 'BTC';
      $('#btn-long').classList.add('active');
      $('#btn-short').classList.remove('active');
      $$('.asset-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.asset === 'BTC'));
      dom.riskPercent.value = 2;
      dom.riskSlider.value = 2;
      updateRiskPresets(2);
      hideResults();
      hideError();
      dom.quickStart.classList.remove('hidden');
      localStorage.removeItem('risklab_form_state');
      showToast('Form reset');
    });
    
    // Actions
    $('#btn-copy').addEventListener('click', copyResults);
    $('#btn-share').addEventListener('click', shareResults);
    $('#btn-export').addEventListener('click', exportResults);
    $('#btn-save').addEventListener('click', () => {
      saveFormState();
      showToast('Saved!', 'success');
    });
    
    // Clear history
    $('#btn-clear-history').addEventListener('click', clearHistory);
    
    // Portfolio
    $('#btn-add-position').addEventListener('click', addToPortfolio);
    $('#btn-clear-portfolio').addEventListener('click', clearPortfolio);
    
    // Quick start
    $('#btn-load-example').addEventListener('click', loadExample);
    
    // Mobile tabs
    $$('.mobile-tab').forEach(tab => {
      tab.addEventListener('click', () => switchMobileTab(tab.dataset.tab));
    });
    
    // Prevent form submission
    dom.form.addEventListener('submit', (e) => e.preventDefault());
  }

  // ============================================
  // Utilities
  // ============================================
  function debounce(fn, delay) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ============================================
  // Portfolio Mode
  // ============================================
  function addToPortfolio() {
    if (!state.lastResults) {
      showToast('Calculate a position first', 'error');
      return;
    }
    
    const r = state.lastResults;
    
    const position = {
      id: Date.now(),
      asset: r.asset,
      direction: r.direction,
      entryPrice: r.entryPrice,
      stopLoss: r.stopLoss,
      takeProfit: r.takeProfit,
      positionUnits: r.positionUnits,
      positionValue: r.positionValue,
      riskAmount: r.riskAmount,
      potentialProfit: r.potentialProfit || 0,
      accountBalance: r.accountBalance
    };
    
    state.portfolio.push(position);
    localStorage.setItem('risklab_portfolio', JSON.stringify(state.portfolio));
    
    renderPortfolio();
    showToast('Position added to portfolio', 'success');
  }

  function removeFromPortfolio(id) {
    state.portfolio = state.portfolio.filter(p => p.id !== id);
    localStorage.setItem('risklab_portfolio', JSON.stringify(state.portfolio));
    renderPortfolio();
    showToast('Position removed');
  }

  function clearPortfolio() {
    state.portfolio = [];
    localStorage.removeItem('risklab_portfolio');
    renderPortfolio();
    showToast('Portfolio cleared');
  }

  function loadPortfolio() {
    try {
      const saved = localStorage.getItem('risklab_portfolio');
      if (saved) {
        state.portfolio = JSON.parse(saved);
        renderPortfolio();
      }
    } catch (e) {
      console.error('Error loading portfolio:', e);
    }
  }

  function renderPortfolio() {
    const container = dom.portfolioPositions;
    const summary = dom.portfolioSummary;
    
    if (state.portfolio.length === 0) {
      container.innerHTML = '';
      summary.classList.add('hidden');
      return;
    }
    
    summary.classList.remove('hidden');
    
    // Render positions
    container.innerHTML = state.portfolio.map(p => `
      <div class="portfolio-position" data-id="${p.id}">
        <div class="portfolio-position-info">
          <span class="portfolio-position-asset">${p.asset}</span>
          <span class="portfolio-position-dir ${p.direction}">${p.direction.toUpperCase()}</span>
          <div class="portfolio-position-details">
            <span class="portfolio-position-size">${fmt.number(p.positionUnits, 4)} @ ${fmt.usd(p.entryPrice, 0)}</span>
            <span class="portfolio-position-risk">Risk: ${fmt.usd(p.riskAmount)}</span>
          </div>
        </div>
        <button type="button" class="btn-remove-position" data-id="${p.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');
    
    // Add remove handlers
    container.querySelectorAll('.btn-remove-position').forEach(btn => {
      btn.addEventListener('click', () => removeFromPortfolio(parseInt(btn.dataset.id)));
    });
    
    // Calculate totals
    const totalRisk = state.portfolio.reduce((sum, p) => sum + p.riskAmount, 0);
    const totalProfit = state.portfolio.reduce((sum, p) => sum + (p.potentialProfit || 0), 0);
    const accountBalance = state.portfolio[0]?.accountBalance || parseFloat(dom.accountBalance.value) || 0;
    const riskPercent = accountBalance > 0 ? (totalRisk / accountBalance) * 100 : 0;
    
    // Update summary
    dom.portfolioCount.textContent = state.portfolio.length;
    dom.portfolioTotalRisk.textContent = fmt.usd(totalRisk);
    dom.portfolioRiskPercent.textContent = fmt.percent(riskPercent, 1);
    dom.portfolioPotentialProfit.textContent = fmt.usd(totalProfit);
  }

  // ============================================
  // Keyboard Shortcuts
  // ============================================
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Ignore if modal is open and key is not Escape
      const modalOpen = !$('#modal-shortcuts').classList.contains('hidden') || 
                       !$('#modal-help').classList.contains('hidden');
      
      if (e.key === 'Escape') {
        closeAllModals();
        return;
      }
      
      if (modalOpen) return;
      
      switch(e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          fetchLivePrice();
          break;
        case 'l':
          e.preventDefault();
          setDirection('long');
          break;
        case 's':
          e.preventDefault();
          setDirection('short');
          break;
        case 'r':
          e.preventDefault();
          resetForm();
          break;
        case 'c':
          e.preventDefault();
          copyResults();
          break;
        case 'p':
          e.preventDefault();
          addToPortfolio();
          break;
        case '1':
          e.preventDefault();
          selectAsset('BTC');
          break;
        case '2':
          e.preventDefault();
          selectAsset('ETH');
          break;
        case '3':
          e.preventDefault();
          selectAsset('SOL');
          break;
        case '4':
          e.preventDefault();
          selectAsset('BNB');
          break;
        case '?':
          e.preventDefault();
          openModal('shortcuts');
          break;
      }
    });
  }

  function setDirection(dir) {
    state.direction = dir;
    $('#btn-long').classList.toggle('active', dir === 'long');
    $('#btn-short').classList.toggle('active', dir === 'short');
    calculate();
    saveFormState();
  }

  function selectAsset(asset) {
    state.asset = asset;
    $$('.asset-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.asset === asset));
    dom.livePrice.textContent = '—';
    state.livePrice = null;
    calculate();
    saveFormState();
  }

  function resetForm() {
    dom.form.reset();
    state.direction = 'long';
    state.asset = 'BTC';
    $('#btn-long').classList.add('active');
    $('#btn-short').classList.remove('active');
    $$('.asset-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.asset === 'BTC'));
    dom.riskPercent.value = 2;
    dom.riskSlider.value = 2;
    updateRiskPresets(2);
    hideResults();
    hideError();
    dom.quickStart.classList.remove('hidden');
    localStorage.removeItem('risklab_form_state');
    showToast('Form reset');
  }

  // ============================================
  // Modals
  // ============================================
  function openModal(name) {
    const modal = $(`#modal-${name}`);
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(name) {
    const modal = $(`#modal-${name}`);
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

  function closeAllModals() {
    $$('.modal').forEach(modal => modal.classList.add('hidden'));
    document.body.style.overflow = '';
  }

  function initModals() {
    // Shortcuts modal
    $('#btn-close-shortcuts')?.addEventListener('click', () => closeModal('shortcuts'));
    $('#modal-shortcuts .modal-backdrop')?.addEventListener('click', () => closeModal('shortcuts'));
    
    // Help modal
    $('#btn-help')?.addEventListener('click', () => openModal('help'));
    $('#btn-close-help')?.addEventListener('click', () => closeModal('help'));
    $('#modal-help .modal-backdrop')?.addEventListener('click', () => closeModal('help'));
  }

  // ============================================
  // Drawdown Simulator
  // ============================================
  function initDrawdownSimulator() {
    const slider = $('#dd-losses-slider');
    const input = $('#dd-losses');
    
    if (!slider || !input) return;
    
    const updateDrawdown = () => {
      const losses = parseInt(input.value) || 5;
      const accountBalance = parseFloat(dom.accountBalance.value) || 10000;
      const riskPercent = parseFloat(dom.riskPercent.value) || 2;
      
      calculateDrawdown(accountBalance, riskPercent, losses);
    };
    
    slider.addEventListener('input', (e) => {
      input.value = e.target.value;
      updateDrawdown();
    });
    
    input.addEventListener('input', (e) => {
      slider.value = e.target.value;
      updateDrawdown();
    });
    
    // Initial calculation
    updateDrawdown();
  }

  function calculateDrawdown(startBalance, riskPercent, losses) {
    const riskFraction = riskPercent / 100;
    const balances = [startBalance];
    
    // Calculate balance after each loss
    let currentBalance = startBalance;
    for (let i = 0; i < losses; i++) {
      const loss = currentBalance * riskFraction;
      currentBalance -= loss;
      balances.push(currentBalance);
    }
    
    const finalBalance = currentBalance;
    const totalDrawdownPercent = ((startBalance - finalBalance) / startBalance) * 100;
    const recoveryNeeded = ((startBalance - finalBalance) / finalBalance) * 100;
    
    // Update display
    $('#dd-final-balance').textContent = fmt.usd(finalBalance);
    $('#dd-total-percent').textContent = fmt.percent(totalDrawdownPercent, 1);
    $('#dd-recovery').textContent = fmt.percent(recoveryNeeded, 1);
    
    // Generate insight
    const insight = getDrawdownInsight(losses, riskPercent, totalDrawdownPercent);
    $('#dd-insight').textContent = insight;
    
    // Draw chart
    drawDrawdownChart(balances, startBalance);
  }

  function getDrawdownInsight(losses, riskPercent, drawdown) {
    if (drawdown < 10) {
      return `${losses} consecutive losses at ${riskPercent}% risk is manageable. Your account remains healthy.`;
    } else if (drawdown < 20) {
      return `A ${drawdown.toFixed(0)}% drawdown requires discipline to recover. Consider reducing position size during losing streaks.`;
    } else if (drawdown < 30) {
      return `${drawdown.toFixed(0)}% drawdown is significant. You'd need ${((drawdown / (100 - drawdown)) * 100).toFixed(0)}% gains to recover.`;
    } else {
      return `Warning: ${drawdown.toFixed(0)}% drawdown is severe. Consider using smaller risk per trade (1-2% max).`;
    }
  }

  function drawDrawdownChart(balances, startBalance) {
    const chart = $('#drawdown-chart');
    if (!chart) return;
    
    const width = 400;
    const height = 120;
    const padding = 20;
    
    const maxVal = startBalance * 1.02;
    const minVal = Math.min(...balances) * 0.98;
    const range = maxVal - minVal;
    
    const points = balances.map((bal, i) => {
      const x = padding + (i / (balances.length - 1)) * (width - padding * 2);
      const y = height - padding - ((bal - minVal) / range) * (height - padding * 2);
      return `${x},${y}`;
    });
    
    const areaPoints = [
      `${padding},${height - padding}`,
      ...points,
      `${width - padding},${height - padding}`
    ].join(' ');
    
    const svg = `
      <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="ddGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ef4444" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="#ef4444" stop-opacity="0.05"/>
          </linearGradient>
        </defs>
        
        <!-- Grid lines -->
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="var(--color-border)" stroke-width="1"/>
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="var(--color-border)" stroke-width="1"/>
        
        <!-- Area fill -->
        <polygon points="${areaPoints}" fill="url(#ddGradient)"/>
        
        <!-- Line -->
        <polyline points="${points.join(' ')}" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        
        <!-- Points -->
        ${balances.map((bal, i) => {
          const x = padding + (i / (balances.length - 1)) * (width - padding * 2);
          const y = height - padding - ((bal - minVal) / range) * (height - padding * 2);
          return `<circle cx="${x}" cy="${y}" r="3" fill="#ef4444"/>`;
        }).join('')}
        
        <!-- Labels -->
        <text x="${padding}" y="${padding - 5}" fill="var(--color-text-muted)" font-size="10">${fmt.compact(startBalance)}</text>
        <text x="${width - padding}" y="${height - 5}" fill="var(--color-text-muted)" font-size="10" text-anchor="end">${balances.length - 1} losses</text>
      </svg>
    `;
    
    chart.innerHTML = svg;
  }

  // ============================================
  // Kelly Criterion Calculator
  // ============================================
  function initKellyCalculator() {
    const winrateInput = $('#kelly-winrate');
    const rrInput = $('#kelly-rr');
    
    if (!winrateInput || !rrInput) return;
    
    const updateKelly = () => {
      const winrate = parseFloat(winrateInput.value) / 100;
      const rr = parseFloat(rrInput.value);
      
      if (!winrate || !rr || winrate <= 0 || winrate >= 1 || rr <= 0) {
        $('#kelly-full').textContent = '—';
        $('#kelly-half').textContent = '—';
        $('#kelly-quarter').textContent = '—';
        return;
      }
      
      // Kelly formula: K% = W - [(1-W) / R]
      // where W = probability of winning, R = win/loss ratio
      const kelly = winrate - ((1 - winrate) / rr);
      
      if (kelly <= 0) {
        $('#kelly-full').textContent = '0% (No Edge)';
        $('#kelly-half').textContent = '0%';
        $('#kelly-quarter').textContent = '0%';
        return;
      }
      
      const fullKelly = kelly * 100;
      const halfKelly = fullKelly / 2;
      const quarterKelly = fullKelly / 4;
      
      $('#kelly-full').textContent = fmt.percent(fullKelly, 1);
      $('#kelly-half').textContent = fmt.percent(halfKelly, 1);
      $('#kelly-quarter').textContent = fmt.percent(quarterKelly, 1);
    };
    
    winrateInput.addEventListener('input', debounce(updateKelly, 150));
    rrInput.addEventListener('input', debounce(updateKelly, 150));
  }

  // ============================================
  // Compound Growth Calculator
  // ============================================
  function initCompoundCalculator() {
    const targetInput = $('#compound-target');
    const gainInput = $('#compound-gain');
    
    if (!targetInput || !gainInput) return;
    
    const updateCompound = () => {
      const startBalance = parseFloat(dom.accountBalance.value) || 10000;
      const targetBalance = parseFloat(targetInput.value);
      const gainPercent = parseFloat(gainInput.value);
      
      if (!targetBalance || !gainPercent || targetBalance <= startBalance || gainPercent <= 0) {
        $('#compound-trades').textContent = '—';
        $('#compound-factor').textContent = '—';
        $('#compound-milestones').innerHTML = '';
        return;
      }
      
      const gainFactor = 1 + (gainPercent / 100);
      const growthFactor = targetBalance / startBalance;
      
      // n = log(target/start) / log(1+gain)
      const tradesNeeded = Math.ceil(Math.log(growthFactor) / Math.log(gainFactor));
      
      $('#compound-trades').textContent = tradesNeeded.toLocaleString();
      $('#compound-factor').textContent = growthFactor.toFixed(1) + 'x';
      
      // Calculate milestones
      const milestones = [];
      const milestoneTargets = [2, 5, 10];
      
      milestoneTargets.forEach(mult => {
        if (mult < growthFactor) {
          const trades = Math.ceil(Math.log(mult) / Math.log(gainFactor));
          milestones.push({
            label: `${mult}x (${fmt.usd(startBalance * mult, 0)})`,
            trades
          });
        }
      });
      
      if (milestones.length > 0) {
        $('#compound-milestones').innerHTML = `
          <div class="milestone-header">Milestones:</div>
          ${milestones.map(m => `
            <div class="milestone-item">
              <span>${m.label}</span>
              <span>${m.trades} trades</span>
            </div>
          `).join('')}
        `;
      } else {
        $('#compound-milestones').innerHTML = '';
      }
    };
    
    targetInput.addEventListener('input', debounce(updateCompound, 150));
    gainInput.addEventListener('input', debounce(updateCompound, 150));
    
    // Also update when account balance changes
    dom.accountBalance.addEventListener('input', debounce(updateCompound, 300));
  }

  // ============================================
  // Initialize
  // ============================================
  function init() {
    initEventListeners();
    initCollapsibles();
    initKeyboardShortcuts();
    initModals();
    initDrawdownSimulator();
    initKellyCalculator();
    initCompoundCalculator();
    loadCalculationsCount();
    loadHistory();
    loadPortfolio();
    
    // Try to restore form state
    const hasState = loadFormState();
    
    if (hasState) {
      // Hide quick start if we have saved state
      dom.quickStart.classList.add('hidden');
      // Try to calculate with restored values
      calculate();
    }
    
    // Set initial mobile panel
    if (window.innerWidth <= 768) {
      dom.panelSetup.classList.add('active');
    }
    
    console.log('RiskLab 3.0 initialized - Press ? for keyboard shortcuts');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
