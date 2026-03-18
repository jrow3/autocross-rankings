// === Shared Utilities ===

const DATA_BASE = 'data';

// Fetch JSON with caching
const jsonCache = new Map();

const CACHE_BUST = 'v=11';
async function fetchJSON(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  const res = await fetch(`${DATA_BASE}/${path}?${CACHE_BUST}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  const data = await res.json();
  jsonCache.set(path, data);
  return data;
}

// Render trend indicator (matches spreadsheet: up arrows, dash, down arrows, X)
function renderTrend(trend) {
  const map = {
    up3: '<span class="trend trend-up3" title="Strong improvement">&#9650;&#9650;&#9650;</span>',
    up2: '<span class="trend trend-up2" title="Strong improvement">&#9650;&#9650;</span>',
    up1: '<span class="trend trend-up1" title="Improving">&#9650;</span>',
    steady: '<span class="trend trend-steady" title="Steady">&mdash;</span>',
    down1: '<span class="trend trend-down1" title="Declining">&#9660;</span>',
    down2: '<span class="trend trend-down2" title="Strong decline">&#9660;&#9660;</span>',
    absent: '<span class="trend trend-absent" title="Absent (no events in 1 year)">&#10005;</span>',
  };
  return map[trend] || map.steady;
}

// Render consistency as visual bars (1-5 integer, more bars = more consistent)
function renderConsistency(value) {
  // value is now 1-5 integer from the algorithm
  const filled = Math.max(1, Math.min(5, value || 1));
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

// Format score (0-100 percentile scale)
function formatScore(score) {
  return Math.round(score);
}

// Escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
