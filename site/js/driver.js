// === Driver Profile View ===

let scoreChart = null;

async function renderDriver(driverId) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading driver profile...</div>';

  let driver;
  try {
    driver = await fetchJSON(`drivers/${driverId}.json`);
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

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Rankings</a>

    <div class="driver-profile">
      <div class="driver-header">
        <div class="driver-rank-badge">
          <div>${driver.rank}</div>
          <div class="label">Rank</div>
        </div>
        <div class="driver-info">
          <h2>${escapeHtml(driver.displayName)}</h2>
          <div class="meta">
            ${renderClassBadge(driver.primaryClass)}
            ${driver.allClasses?.length > 1 ? driver.allClasses.filter(c => c !== driver.primaryClass).map(c => renderClassBadge(c)).join(' ') : ''}
            &nbsp;&middot;&nbsp; ${escapeHtml(driver.region || 'Unknown Region')}
          </div>
        </div>
        <div class="driver-score">
          <div class="value">${formatScore(driver.score)}</div>
          <div class="label">RANK Score</div>
        </div>
      </div>

      <div class="card">
        <h3>Metrics</h3>
        <div class="metrics-grid">
          <div class="metric">
            <div class="value">${renderConsistency(driver.consistency)}</div>
            <div class="label">${consistencyLabel}</div>
          </div>
          <div class="metric">
            <div class="value">${renderTrend(driver.trend)}</div>
            <div class="label">${trendLabels[driver.trend] || 'Steady'}</div>
          </div>
          <div class="metric">
            <div class="value">${renderDataPoints(driver.dataPoints)}</div>
            <div class="label">${driver.eventCount} Events</div>
          </div>
        </div>
      </div>

      ${driver.yearScores && Object.keys(driver.yearScores).length > 0 ? `
      <div class="card">
        <h3>Year-by-Year RANK</h3>
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
              <th>PAX Time</th>
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
                <td>${h.trophy ? '<span class="trophy">&#9733;</span> ' : ''}${h.position}/${h.totalInClass || '?'}</td>
                <td style="font-family:var(--mono)">${h.paxTime ? h.paxTime.toFixed(3) : 'N/A'}</td>
                <td class="hide-mobile">${escapeHtml(h.car || '')}</td>
                <td class="hide-mobile">${h.paxOverallPosition ? `${h.paxOverallPosition}/${h.paxOverallTotal}` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Render score chart
  renderScoreChart(driver);
}

function renderScoreChart(driver) {
  const canvas = document.getElementById('score-chart');
  if (!canvas || !driver.history?.length) return;

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
        borderColor: '#4f8cff',
        backgroundColor: 'rgba(79, 140, 255, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#4f8cff',
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
          title: { display: true, text: 'Percentile', color: '#8b8fa3' },
          grid: { color: '#2a2e3d' },
          ticks: { color: '#8b8fa3' },
        },
        x: {
          grid: { color: '#2a2e3d' },
          ticks: { color: '#8b8fa3', maxRotation: 45 },
        },
      },
    },
  });
}
