// === Driver Profile View ===

let scoreChart = null;

async function loadChartJs() {
  if (window.Chart) return;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// In-memory cache for driver chunks (persists across navigations within session)
let _driverIndex = null;
const _chunkCache = new Map();

async function loadDriverFromChunk(driverId) {
  // Load the driver index (maps slug -> chunk number)
  if (!_driverIndex) {
    _driverIndex = await fetchJSON('driver-index.json');
  }

  const chunkNum = _driverIndex[driverId];
  if (chunkNum === undefined) return null;

  // Load the chunk (cached in memory for instant same-chunk navigation)
  if (!_chunkCache.has(chunkNum)) {
    const chunk = await fetchJSON(`drivers/chunk-${chunkNum}.json`);
    _chunkCache.set(chunkNum, chunk);
  }

  return _chunkCache.get(chunkNum)[driverId] || null;
}

async function renderDriver(driverId) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading-state"><span class="spinner"></span> Loading driver profile...</div></div>';

  let driver;
  try {
    driver = await loadDriverFromChunk(driverId);
    if (!driver) throw new Error('Not found');
  } catch (e) {
    app.innerHTML = '<div class="loading">Driver not found.</div>';
    return;
  }

  // Consistency is now 1-5 integer
  const consistencyLabel = driver.consistency >= 5 ? 'Very Consistent' :
    driver.consistency >= 4 ? 'Consistent' :
    driver.consistency >= 3 ? 'Average' :
    driver.consistency >= 2 ? 'Variable' : 'Inconsistent';

  const trendLabels = {
    up3: 'Strong Improvement', up2: 'Strong Improvement', up1: 'Improving', steady: 'Steady',
    down1: 'Declining', down2: 'Strong Decline', absent: 'Absent',
  };

  const nationalsWins = (driver.history || []).filter(h => h.eventType === 'nationals' && h.position === 1).length;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Rankings</a>

    <div class="driver-profile">
      <div class="driver-header">
        <div class="driver-rank-badge">
          <div>${driver.rank}</div>
          <div class="label">Rank</div>
        </div>
        <div class="driver-info">
          <h2>${escapeHtml(driver.displayName)} ${renderTrend(driver.trend)} <button class="share-btn" onclick="navigator.clipboard.writeText(window.location.href).then(() => { this.textContent = 'Copied!'; setTimeout(() => this.textContent = '\u{1F517}', 1500); })" title="Copy link">\u{1F517}</button></h2>
          <div class="meta">
            ${renderClassBadge(driver.primaryClass)}
            ${driver.allClasses?.length > 1 ? driver.allClasses.filter(c => c !== driver.primaryClass).map(c => renderClassBadge(c)).join(' ') : ''}
            &nbsp;&middot;&nbsp; ${escapeHtml(driver.region || 'Unknown Region')}
          </div>
        </div>
        ${nationalsWins > 0 ? `
        <div class="driver-nationals-count">
          <div class="value">${nationalsWins} <svg class="trophy-icon" viewBox="0 0 16 16" width="18" height="18"><path d="M6 1L4 2L1 4L2 10L4 9V15H12V9L14 10L15 4L12 2L10 1H6Z" fill="#dc2626"/><path d="M6 1L7 3L8 5L9 3L10 1" fill="none" stroke="#fff" stroke-width="0.8"/><path d="M4 9V15H12V9" fill="none" stroke="#b91c1c" stroke-width="0.5"/></svg></div>
          <div class="label">Jacket${nationalsWins !== 1 ? 's' : ''}</div>
        </div>
        ` : ''}
        <div class="driver-score">
          <div class="value">${formatScore(driver.score)}</div>
          <div class="label">RATING Score</div>
        </div>
      </div>

      <div class="card compare-launcher" style="grid-column: 1 / -1;">
        <div class="compare-launcher-row">
          <button class="compare-btn" id="compare-toggle-btn">Compare with another driver</button>
          <div class="compare-search-wrapper" id="compare-search-wrapper" style="display:none;">
            <input type="text" id="compare-search" class="compare-search-input" placeholder="Search for a driver..." autocomplete="off" />
            <div class="compare-dropdown" id="compare-dropdown"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Metrics</h3>
        <div class="metrics-grid">
          <div class="metric">
            <div class="metric-name">Consistency</div>
            <div class="value">${renderConsistency(driver.consistency)}</div>
            <div class="label">${consistencyLabel}</div>
          </div>
          <div class="metric">
            <div class="metric-name">Confidence</div>
            <div class="value">${renderConfidence(driver.confidence)}</div>
            <div class="label">${renderConfidenceLabel(driver.confidence)}</div>
          </div>
          <div class="metric">
            <div class="metric-name">Events</div>
            <div class="value">${driver.eventCount}</div>
            <div class="label">Competitions</div>
          </div>
        </div>
      </div>

      ${driver.yearScores && Object.keys(driver.yearScores).length > 0 ? `
      <div class="card">
        <h3>Year-by-Year RATING</h3>
        <div class="year-scores">
          ${Object.entries(driver.yearScores).sort(([a], [b]) => a - b).map(([year, score]) => `
            <div class="year-score">
              <div class="value">${score}</div>
              <div class="label">${year}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <div class="card">
        <h3>Details</h3>
        <table style="width:100%; font-size:0.85rem;">
          <tr><td style="color:var(--text-dim)">Cars</td><td>${(driver.cars || []).map(c => escapeHtml(c)).join('<br>') || 'N/A'}</td></tr>
          <tr><td style="color:var(--text-dim)">Tires</td><td>${(driver.tires || []).filter(t => t).join(', ') || 'N/A'}</td></tr>
          <tr><td style="color:var(--text-dim)">Locations</td><td>${(driver.cities || []).slice(0, 3).map(c => escapeHtml(c)).join(', ') || 'N/A'}</td></tr>
          <tr><td style="color:var(--text-dim)">Last Event</td><td>${driver.lastEvent ? new Date(driver.lastEvent).toLocaleDateString() : 'N/A'}</td></tr>
        </table>
      </div>

      <div class="card chart-container">
        <h3>Performance Over Time</h3>
        <canvas id="score-chart"></canvas>
      </div>

      <div class="card history-table">
        <h3>Event History</h3>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Class</th>
              <th>Position</th>
              <th class="hide-mobile">Car</th>
              <th class="hide-mobile">PAX Overall</th>
            </tr>
          </thead>
          <tbody>
            ${(driver.history || []).map(h => `
              <tr>
                <td>
                  <a href="#/event/${h.eventCode}">${escapeHtml(h.eventName || h.eventCode)}</a>
                  <div style="font-size:0.75rem;color:var(--text-dim)">${h.eventDates || ''}</div>
                </td>
                <td>${renderClassBadge(h.className)}</td>
                <td>${h.trophy ? renderTrophy(h.eventType, h.position) : ''}${h.position}/${h.totalInClass || '?'}</td>
                <td class="hide-mobile">${escapeHtml(h.car || '')}</td>
                <td class="hide-mobile">${h.paxOverallPosition ? `${h.paxOverallPosition}/${h.paxOverallTotal}` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Render score chart (lazy-loads Chart.js)
  await renderScoreChart(driver);

  // Wire up compare button
  wireCompareButton(driverId);
}

async function renderScoreChart(driver) {
  const canvas = document.getElementById('score-chart');
  if (!canvas || !driver.history?.length) return;

  await loadChartJs();

  // Build data: normalized position per event over time
  const history = [...(driver.history || [])].reverse();
  const labels = history.map(h => {
    const name = h.eventName || h.eventCode;
    // Shorten: "2026 Tire Rack SCCA Red Hills National Tour" -> "Red Hills '26"
    const short = name.replace(/\d{4}\s+Tire Rack SCCA\s+/i, '').replace(/National Tour/i, '').trim();
    return short.slice(0, 20);
  });

  // Use PAX overall position when available (better metric, especially for small classes)
  // Fall back to class position if no PAX data
  const positions = history.map(h => {
    if (h.paxOverallPosition && h.paxOverallTotal) {
      return Math.round((1 - h.paxOverallPosition / h.paxOverallTotal) * 100);
    }
    return h.totalInClass ? Math.round((1 - h.position / h.totalInClass) * 100) : 50;
  });

  if (scoreChart) scoreChart.destroy();

  scoreChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Performance %',
        data: positions,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#2563eb',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const h = history[ctx.dataIndex];
              const isPax = h.paxOverallPosition && h.paxOverallTotal;
              return isPax
                ? `Top ${100 - ctx.parsed.y}% PAX overall (${h.paxOverallPosition}/${h.paxOverallTotal})`
                : `Top ${100 - ctx.parsed.y}% of class (${h.position}/${h.totalInClass})`;
            },
          },
        },
      },
      scales: {
        y: {
          min: 0, max: 100,
          title: { display: true, text: 'Percentile', color: '#6b7085' },
          grid: { color: '#d8dbe5' },
          ticks: { color: '#6b7085' },
        },
        x: {
          grid: { color: '#d8dbe5' },
          ticks: { color: '#6b7085', maxRotation: 45 },
        },
      },
    },
  });
}

// === Compare Button on Driver Profile ===

function wireCompareButton(currentDriverId) {
  const toggleBtn = document.getElementById('compare-toggle-btn');
  const wrapper = document.getElementById('compare-search-wrapper');
  const input = document.getElementById('compare-search');
  const dropdown = document.getElementById('compare-dropdown');
  if (!toggleBtn) return;

  let compareSelectedIndex = -1;

  toggleBtn.addEventListener('click', () => {
    const isVisible = wrapper.style.display !== 'none';
    wrapper.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) input.focus();
  });

  input.addEventListener('input', async () => {
    compareSelectedIndex = -1;
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      dropdown.classList.remove('active');
      return;
    }

    if (!allDrivers) {
      allDrivers = await fetchJSON('search-index.json');
    }

    const matches = allDrivers
      .filter(d => d.driverId !== currentDriverId && d.displayName.toLowerCase().includes(query))
      .slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="search-item"><span class="name">No results</span></div>';
    } else {
      dropdown.innerHTML = matches.map(d => `
        <div class="search-item" data-driver="${d.driverId}">
          <span class="name">${escapeHtml(d.displayName)}</span>
          <span class="meta">#${d.rank} ${d.primaryClass}</span>
        </div>
      `).join('');
    }
    dropdown.classList.add('active');
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (!item || !item.dataset.driver) return;
    window.location.hash = `/compare/${currentDriverId}/${item.dataset.driver}`;
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-item[data-driver]');
    const count = items.length;

    if (e.key === 'Escape') {
      dropdown.classList.remove('active');
      compareSelectedIndex = -1;
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!dropdown.classList.contains('active') || count === 0) return;
      compareSelectedIndex = compareSelectedIndex < count - 1 ? compareSelectedIndex + 1 : 0;
      items.forEach((it, i) => it.classList.toggle('selected', i === compareSelectedIndex));
      if (items[compareSelectedIndex]) items[compareSelectedIndex].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!dropdown.classList.contains('active') || count === 0) return;
      compareSelectedIndex = compareSelectedIndex > 0 ? compareSelectedIndex - 1 : count - 1;
      items.forEach((it, i) => it.classList.toggle('selected', i === compareSelectedIndex));
      if (items[compareSelectedIndex]) items[compareSelectedIndex].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      const target = compareSelectedIndex >= 0 && items[compareSelectedIndex]
        ? items[compareSelectedIndex]
        : dropdown.querySelector('.search-item[data-driver]');
      if (target && target.dataset.driver) {
        window.location.hash = `/compare/${currentDriverId}/${target.dataset.driver}`;
      }
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.compare-launcher')) {
      dropdown.classList.remove('active');
    }
  });
}

// === Driver Comparison View ===

let compareChart = null;

function getTrendLabel(trend) {
  const map = {
    up3: 'Strong Improvement', up2: 'Strong Improvement', up1: 'Improving', steady: 'Steady',
    down1: 'Declining', down2: 'Strong Decline', absent: 'Absent',
  };
  return map[trend] || 'Steady';
}

function getConsistencyLabel(value) {
  return value >= 5 ? 'Very Consistent' :
    value >= 4 ? 'Consistent' :
    value >= 3 ? 'Average' :
    value >= 2 ? 'Variable' : 'Inconsistent';
}

function computeHeadToHead(d1, d2) {
  // Find shared events by eventCode and compare PAX overall positions
  const d1Events = new Map();
  (d1.history || []).forEach(h => {
    // Use eventCode as key; store paxOverallPosition or class position
    const pos = h.paxOverallPosition || h.position;
    const total = h.paxOverallTotal || h.totalInClass || 999;
    // Normalize to percentile for comparison
    if (pos && total) {
      d1Events.set(h.eventCode, { position: pos, total });
    }
  });

  let d1Wins = 0, d2Wins = 0, ties = 0;
  (d2.history || []).forEach(h => {
    const d1Entry = d1Events.get(h.eventCode);
    if (!d1Entry) return;
    const d2Pos = h.paxOverallPosition || h.position;
    const d2Total = h.paxOverallTotal || h.totalInClass || 999;
    if (!d2Pos || !d2Total) return;

    // Compare normalized percentile (lower position = better)
    const d1Pct = d1Entry.position / d1Entry.total;
    const d2Pct = d2Pos / d2Total;
    if (d1Pct < d2Pct) d1Wins++;
    else if (d2Pct < d1Pct) d2Wins++;
    else ties++;
  });

  return { d1Wins, d2Wins, ties, total: d1Wins + d2Wins + ties };
}

async function renderCompare(driverId1, driverId2) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading-state"><span class="spinner"></span> Loading comparison...</div></div>';

  let d1, d2;
  try {
    [d1, d2] = await Promise.all([
      loadDriverFromChunk(driverId1),
      loadDriverFromChunk(driverId2),
    ]);
    if (!d1 || !d2) throw new Error('Not found');
  } catch (e) {
    app.innerHTML = '<div class="loading">One or both drivers not found.</div>';
    return;
  }

  const h2h = computeHeadToHead(d1, d2);

  function compareCell(val1, val2, higherIsBetter = true) {
    const better1 = higherIsBetter ? val1 > val2 : val1 < val2;
    const better2 = higherIsBetter ? val2 > val1 : val2 < val1;
    return {
      cls1: better1 ? 'compare-winner' : (better2 ? 'compare-loser' : ''),
      cls2: better2 ? 'compare-winner' : (better1 ? 'compare-loser' : ''),
    };
  }

  const scoreComp = compareCell(d1.score, d2.score, true);
  const rankComp = compareCell(d1.rank, d2.rank, false);
  const eventsComp = compareCell(d1.eventCount, d2.eventCount, true);
  const consistencyComp = compareCell(d1.consistency, d2.consistency, true);
  const confidenceComp = compareCell(d1.confidence, d2.confidence, true);

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Rankings</a>

    <div class="compare-view">
      <div class="compare-header">
        <div class="compare-driver">
          <a href="#/driver/${driverId1}" class="compare-driver-name">${escapeHtml(d1.displayName)}</a>
          <div class="meta">${renderClassBadge(d1.primaryClass)} &middot; ${escapeHtml(d1.region || 'Unknown')}</div>
        </div>
        <div class="compare-vs">VS</div>
        <div class="compare-driver">
          <a href="#/driver/${driverId2}" class="compare-driver-name">${escapeHtml(d2.displayName)}</a>
          <div class="meta">${renderClassBadge(d2.primaryClass)} &middot; ${escapeHtml(d2.region || 'Unknown')}</div>
        </div>
      </div>

      <div class="card" style="grid-column: 1 / -1;">
        <h3>Side-by-Side Stats</h3>
        <table class="compare-table">
          <thead>
            <tr>
              <th></th>
              <th>${escapeHtml(d1.displayName)}</th>
              <th>${escapeHtml(d2.displayName)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="compare-label">RATING Score</td>
              <td class="${scoreComp.cls1}"><span class="score">${formatScore(d1.score)}</span></td>
              <td class="${scoreComp.cls2}"><span class="score">${formatScore(d2.score)}</span></td>
            </tr>
            <tr>
              <td class="compare-label">Rank</td>
              <td class="${rankComp.cls1}">#${d1.rank}</td>
              <td class="${rankComp.cls2}">#${d2.rank}</td>
            </tr>
            <tr>
              <td class="compare-label">Events</td>
              <td class="${eventsComp.cls1}">${d1.eventCount}</td>
              <td class="${eventsComp.cls2}">${d2.eventCount}</td>
            </tr>
            <tr>
              <td class="compare-label">Consistency</td>
              <td class="${consistencyComp.cls1}">${renderConsistency(d1.consistency)} ${getConsistencyLabel(d1.consistency)}</td>
              <td class="${consistencyComp.cls2}">${renderConsistency(d2.consistency)} ${getConsistencyLabel(d2.consistency)}</td>
            </tr>
            <tr>
              <td class="compare-label">Confidence</td>
              <td class="${confidenceComp.cls1}">${renderConfidence(d1.confidence)} ${renderConfidenceLabel(d1.confidence)}</td>
              <td class="${confidenceComp.cls2}">${renderConfidence(d2.confidence)} ${renderConfidenceLabel(d2.confidence)}</td>
            </tr>
            <tr>
              <td class="compare-label">Trend</td>
              <td>${renderTrend(d1.trend)} ${getTrendLabel(d1.trend)}</td>
              <td>${renderTrend(d2.trend)} ${getTrendLabel(d2.trend)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      ${h2h.total > 0 ? `
      <div class="card" style="grid-column: 1 / -1;">
        <h3>Head-to-Head (${h2h.total} shared event${h2h.total !== 1 ? 's' : ''})</h3>
        <div class="h2h-bar-container">
          <div class="h2h-label">${escapeHtml(d1.displayName)}: ${h2h.d1Wins}</div>
          <div class="h2h-bar">
            <div class="h2h-bar-fill h2h-d1" style="width: ${h2h.total ? (h2h.d1Wins / h2h.total * 100) : 0}%"></div>
            ${h2h.ties > 0 ? `<div class="h2h-bar-fill h2h-tie" style="width: ${h2h.ties / h2h.total * 100}%"></div>` : ''}
            <div class="h2h-bar-fill h2h-d2" style="width: ${h2h.total ? (h2h.d2Wins / h2h.total * 100) : 0}%"></div>
          </div>
          <div class="h2h-label">${escapeHtml(d2.displayName)}: ${h2h.d2Wins}</div>
        </div>
        ${h2h.ties > 0 ? `<div style="text-align:center;color:var(--text-dim);font-size:0.85rem;margin-top:0.5rem;">Ties: ${h2h.ties}</div>` : ''}
      </div>
      ` : `
      <div class="card" style="grid-column: 1 / -1;">
        <h3>Head-to-Head</h3>
        <p style="color:var(--text-dim);text-align:center;">No shared events found.</p>
      </div>
      `}

      <div class="card chart-container" style="grid-column: 1 / -1;">
        <h3>Year-by-Year Score Comparison</h3>
        <canvas id="compare-chart"></canvas>
      </div>
    </div>
  `;

  // Render year-by-year comparison chart
  await renderCompareChart(d1, d2);
}

async function renderCompareChart(d1, d2) {
  const canvas = document.getElementById('compare-chart');
  if (!canvas) return;

  const ys1 = d1.yearScores || {};
  const ys2 = d2.yearScores || {};
  const allYears = [...new Set([...Object.keys(ys1), ...Object.keys(ys2)])].sort();

  if (allYears.length === 0) {
    canvas.parentElement.style.display = 'none';
    return;
  }

  await loadChartJs();

  if (compareChart) compareChart.destroy();

  compareChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: allYears,
      datasets: [
        {
          label: d1.displayName,
          data: allYears.map(y => ys1[y] ?? null),
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          tension: 0.3,
          pointRadius: 5,
          pointBackgroundColor: '#2563eb',
          spanGaps: true,
        },
        {
          label: d2.displayName,
          data: allYears.map(y => ys2[y] ?? null),
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220, 38, 38, 0.1)',
          tension: 0.3,
          pointRadius: 5,
          pointBackgroundColor: '#dc2626',
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#6b7085' },
        },
      },
      scales: {
        y: {
          min: 0, max: 100,
          title: { display: true, text: 'RATING Score', color: '#6b7085' },
          grid: { color: '#d8dbe5' },
          ticks: { color: '#6b7085' },
        },
        x: {
          grid: { color: '#d8dbe5' },
          ticks: { color: '#6b7085' },
        },
      },
    },
  });
}
