// === Rankings Table View ===

const PAGE_SIZE = 50;
let rankingsData = null;
let filteredData = null;
let currentPage = 1;
let sortField = 'rank';
let sortDir = 'asc';
// Read filter state from URL hash query params (e.g. #/?class=SS&region=NER)
function getHashParams() {
  const hash = window.location.hash.slice(1) || '';
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIndex + 1));
}

// Write filter state to URL hash without triggering a full re-route
function setHashParams(classFilter, regionFilter) {
  const params = new URLSearchParams();
  if (classFilter) params.set('class', classFilter);
  if (regionFilter) params.set('region', regionFilter);
  const qs = params.toString();
  const newHash = qs ? `#/?${qs}` : '#/';
  if (window.location.hash !== newHash) {
    // Use replaceState to avoid adding history entries for every filter change
    history.replaceState(null, '', newHash);
  }
}

let savedClassFilter = '';
let savedRegionFilter = '';

async function renderRankings() {
  const app = document.getElementById('app');

  if (!rankingsData) {
    app.innerHTML = '<div class="loading">Loading rankings...</div>';
    rankingsData = await fetchJSON('rankings.json');
    filteredData = rankingsData;
  }

  // Get unique classes and regions for filters
  const classes = [...new Set(rankingsData.map(d => d.primaryClass))].sort();
  const regions = [...new Set(rankingsData.map(d => d.region).filter(Boolean))].sort();

  app.innerHTML = `
    <div class="rankings-header">
      <h2>National Driver Ratings</h2>
      <div class="filters">
        <select class="filter-select" id="filter-class">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <select class="filter-select" id="filter-region">
          <option value="">All Regions</option>
          ${regions.map(r => `<option value="${r}">${escapeHtml(r)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="stats-bar">
      <div><span class="stat-value" id="stat-events">0</span> events</div>
      <div><span class="stat-value" id="stat-drivers">0</span> drivers</div>
      <div><span class="stat-value" id="stat-comparisons">0</span> comparisons</div>
    </div>

    <div class="table-scroll-container">
      <table class="rankings-table">
        <thead>
          <tr>
            <th class="col-rank">Rank</th>
            <th>Driver</th>
            <th class="sortable" data-sort="score">RATING Score ${renderSortIndicator('score')}</th>
            <th class="col-class">Class</th>
            <th class="col-trend">Trend</th>
            <th class="col-consistency">Consistency</th>
            <th>Confidence</th>
            <th class="col-region">Region</th>
            <th class="sortable col-jackets" data-sort="nationalsWins">Jackets ${renderSortIndicator('nationalsWins')}</th>
            <th class="sortable col-events" data-sort="eventCount">Events ${renderSortIndicator('eventCount')}</th>
          </tr>
        </thead>
        <tbody id="rankings-body"></tbody>
      </table>
    </div>

    <div class="pagination" id="pagination"></div>
  `;

  // Load meta for stats
  try {
    const meta = await fetchJSON('meta.json');
    document.getElementById('stat-drivers').textContent = meta.totalDrivers.toLocaleString();
    document.getElementById('stat-events').textContent = meta.totalEvents;
    document.getElementById('stat-comparisons').textContent = (meta.totalComparisons || 0).toLocaleString();
  } catch (e) { /* meta not available */ }

  // Wire up sortable column headers
  wireSortHeaders();

  // Wire up filters
  document.getElementById('filter-class').addEventListener('change', applyFilters);
  document.getElementById('filter-region').addEventListener('change', applyFilters);

  // Restore filter values from URL hash (takes priority) or saved JS state
  const hashParams = getHashParams();
  const hashClass = hashParams.get('class') || '';
  const hashRegion = hashParams.get('region') || '';
  savedClassFilter = hashClass || savedClassFilter;
  savedRegionFilter = hashRegion || savedRegionFilter;

  if (savedClassFilter) document.getElementById('filter-class').value = savedClassFilter;
  if (savedRegionFilter) document.getElementById('filter-region').value = savedRegionFilter;

  // Re-apply filters if any were saved
  if (savedClassFilter || savedRegionFilter) {
    applyFilters();
  } else {
    currentPage = 1;
    applySortAndRender();
  }
}

function applyFilters() {
  const classFilter = document.getElementById('filter-class').value;
  const regionFilter = document.getElementById('filter-region').value;
  savedClassFilter = classFilter;
  savedRegionFilter = regionFilter;

  // Persist filter state in URL hash so it survives reloads and can be shared
  setHashParams(classFilter, regionFilter);

  filteredData = rankingsData.filter(d => {
    if (classFilter && d.primaryClass !== classFilter) return false;
    if (regionFilter && d.region !== regionFilter) return false;
    return true;
  });

  currentPage = 1;
  applySortAndRender();
}

function renderSortIndicator(field) {
  if (field !== sortField) return '';
  return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
}

function wireSortHeaders() {
  document.querySelectorAll('.rankings-table th.sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortDir = 'asc';
      }
      // Re-render the full rankings to update sort indicators in headers
      currentPage = 1;
      renderRankings();
    });
  });
}

function applySortAndRender() {
  const data = [...filteredData];

  data.sort((a, b) => {
    let va = a[sortField];
    let vb = b[sortField];

    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();

    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  renderPage(data);
}

function renderPage(data) {
  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = data.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('rankings-body');
  tbody.innerHTML = page.map(d => `
      <tr data-driver="${d.driverId}" role="button" tabindex="0" aria-label="View profile for ${escapeHtml(d.displayName)}">
        <td class="col-rank"><span class="rank-num">${d.rank}</span></td>
        <td><strong>${escapeHtml(d.displayName)}</strong></td>
        <td><span class="score">${formatScore(d.score)}</span></td>
        <td class="col-class">${renderClassBadge(d.primaryClass)}</td>
        <td class="col-trend">${renderTrend(d.trend)}</td>
        <td class="col-consistency">${renderConsistency(d.consistency)}</td>
        <td>${renderConfidence(d.confidence)}</td>
        <td class="col-region">${escapeHtml(d.region || '')}</td>
        <td class="col-jackets">${d.nationalsWins ? `<span class="jacket-count">${d.nationalsWins}<svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 1L4 2L1 4L2 10L4 9V15H12V9L14 10L15 4L12 2L10 1H6Z" fill="#dc2626"/><path d="M6 1L7 3L8 5L9 3L10 1" fill="none" stroke="#fff" stroke-width="0.8"/><path d="M4 9V15H12V9" fill="none" stroke="#b91c1c" stroke-width="0.5"/></svg></span>` : ''}</td>
        <td class="col-events">${d.eventCount}</td>
      </tr>
    `).join('');

  // Click and keyboard navigation to driver profile
  tbody.querySelectorAll('tr[data-driver]').forEach(tr => {
    tr.addEventListener('click', () => {
      window.location.hash = `/driver/${tr.dataset.driver}`;
    });
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.hash = `/driver/${tr.dataset.driver}`;
      }
    });
  });

  // Pagination
  const pagination = document.getElementById('pagination');
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  let paginationHTML = `
    <button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">&laquo; Prev</button>
  `;

  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

  if (startPage > 1) paginationHTML += `<button data-page="1">1</button><span class="page-info">...</span>`;

  for (let p = startPage; p <= endPage; p++) {
    paginationHTML += `<button class="${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }

  if (endPage < totalPages) paginationHTML += `<span class="page-info">...</span><button data-page="${totalPages}">${totalPages}</button>`;

  paginationHTML += `
    <button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next &raquo;</button>
    <span class="page-info">${start + 1}-${Math.min(start + PAGE_SIZE, data.length)} of ${data.length}</span>
  `;

  pagination.innerHTML = paginationHTML;
  pagination.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      applySortAndRender();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}
