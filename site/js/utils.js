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

// Render consistency as visual bars (1-5, color-coded by level)
function renderConsistency(value) {
  const filled = Math.max(1, Math.min(5, value || 1));
  const cls = filled >= 4 ? 'green' : filled >= 2 ? 'yellow' : 'red';
  let html = `<span class="metric-bar" title="Consistency: ${filled}/5">`;
  for (let i = 0; i < 5; i++) {
    html += `<span class="bar ${i < filled ? cls : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

// Render confidence as bars (1-5, color-coded by level)
function renderConfidence(value) {
  const filled = Math.max(1, Math.min(5, value || 1));
  const labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
  const cls = filled >= 4 ? 'green' : filled >= 3 ? 'yellow' : 'orange';
  let html = `<span class="metric-bar" title="${labels[filled - 1]} confidence">`;
  for (let i = 0; i < 5; i++) {
    html += `<span class="bar ${i < filled ? cls : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

// Render data points as bars (1-5, color-coded by level)
function renderDataPoints(value) {
  const filled = Math.max(1, Math.min(5, value || 1));
  const cls = filled >= 4 ? 'green' : filled >= 2 ? 'yellow' : 'red';
  let html = `<span class="metric-bar" title="Data Points: ${filled}/5">`;
  for (let i = 0; i < 5; i++) {
    html += `<span class="bar ${i < filled ? cls : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

// Confidence label text
function renderConfidenceLabel(value) {
  const filled = Math.max(1, Math.min(5, value || 1));
  const labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
  return labels[filled - 1];
}

// Render trophy/jacket icon for event wins
function renderTrophy(eventType, position) {
  if (eventType === 'nationals' && position === 1) {
    // Red jacket for nationals wins
    return '<svg class="trophy-icon" title="Nationals jacket" viewBox="0 0 16 16" width="14" height="14">' +
      '<path d="M6 1L4 2L1 4L2 10L4 9V15H12V9L14 10L15 4L12 2L10 1H6Z" fill="#dc2626"/>' +
      '<path d="M6 1L7 3L8 5L9 3L10 1" fill="none" stroke="#fff" stroke-width="0.8"/>' +
      '<path d="M4 9V15H12V9" fill="none" stroke="#b91c1c" stroke-width="0.5"/>' +
      '</svg> ';
  }
  // Trophy for tour wins
  return '<svg class="trophy-icon" title="Tour trophy" viewBox="0 0 16 16" width="14" height="14">' +
    '<path d="M4 2C4 2 3 2 2 3C1 4 1 6 1 6L3 7L3 5L4 4V2ZM12 2C12 2 13 2 14 3C15 4 15 6 15 6L13 7L13 5L12 4V2ZM5 1H11V4C11 6.2 9.2 8 8 8C6.8 8 5 6.2 5 4V1ZM5 9L6 14H10L11 9C10 9.5 9 10 8 10C7 10 6 9.5 5 9Z" fill="#ca8a04"/>' +
    '</svg> ';
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
