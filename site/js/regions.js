// === Regional Rankings View ===

async function renderRegions() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading regional rankings...</div>';

  let regions;
  try {
    regions = await fetchJSON('regions.json');
  } catch (e) {
    app.innerHTML = '<div class="loading">No regional data available yet.</div>';
    return;
  }

  app.innerHTML = `
    <div class="rankings-header">
      <h2>Regional Rankings</h2>
      <div class="stats-bar">
        <div><span class="stat-value">${regions.length}</span> regions ranked</div>
      </div>
    </div>

    <table class="rankings-table">
      <thead>
        <tr>
          <th class="col-rank">Rank</th>
          <th>Region</th>
          <th>Score</th>
          <th>Drivers</th>
        </tr>
      </thead>
      <tbody>
        ${regions.map(r => `
          <tr class="clickable-row" data-region="${escapeHtml(r.region)}">
            <td class="col-rank">${r.rank}</td>
            <td>${escapeHtml(r.region)}</td>
            <td>${r.score}</td>
            <td>${r.driverCount}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Click row to navigate to rankings filtered by that region
  app.querySelectorAll('.clickable-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const region = row.dataset.region;
      const encoded = encodeURIComponent(region);
      window.location.hash = `#/?region=${encoded}`;
    });
  });
}
