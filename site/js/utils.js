// === Shared Utilities ===

const DATA_BASE = 'data';

// Fetch JSON with caching
const jsonCache = new Map();

async function fetchJSON(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  const res = await fetch(`${DATA_BASE}/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  const data = await res.json();
  jsonCache.set(path, data);
  return data;
}

// Render trend indicator
function renderTrend(trend) {
  const map = {
    up2: '<span class="trend trend-up2" title="Strong improvement">&#9650;&#9650;</span>',
    up1: '<span class="trend trend-up1" title="Improving">&#9650;</span>',
    steady: '<span class="trend trend-steady" title="Steady">&mdash;</span>',
    down1: '<span class="trend trend-down1" title="Declining">&#9660;</span>',
    down2: '<span class="trend trend-down2" title="Strong decline">&#9660;&#9660;</span>',
    absent: '<span class="trend trend-absent" title="Absent (no events in 1 year)">&#10005;</span>',
  };
  return map[trend] || map.steady;
}

// Render consistency as visual bars (5 bars, more filled = more consistent)
function renderConsistency(value) {
  // Lower value = more consistent. Map 0-1.5 range to 5-0 bars
  const filled = Math.max(0, Math.min(5, Math.round(5 - (value * 3.5))));
  let html = '<span class="consistency-bar">';
  for (let i = 0; i < 5; i++) {
    if (i < filled) {
      const cls = filled >= 4 ? 'filled' : filled >= 2 ? 'mid' : 'low';
      html += `<span class="bar ${cls}"></span>`;
    } else {
      html += '<span class="bar"></span>';
    }
  }
  html += '</span>';
  return html;
}

// Render data points as bars
function renderDataPoints(value) {
  let html = '<span class="data-bars">';
  for (let i = 0; i < 5; i++) {
    html += `<span class="bar ${i < value ? 'filled' : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

// Render class badge
function renderClassBadge(className) {
  return `<span class="class-badge">${className}</span>`;
}

// Format score
function formatScore(score) {
  return score.toFixed(1);
}

// Escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
