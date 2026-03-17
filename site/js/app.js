// === Main App Router ===

function getRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === '') return { page: 'rankings' };
  if (parts[0] === 'driver' && parts[1]) return { page: 'driver', id: parts[1] };
  if (parts[0] === 'events') return { page: 'events' };
  if (parts[0] === 'event' && parts[1]) return { page: 'event', id: parts[1] };
  if (parts[0] === 'about') return { page: 'about' };
  return { page: 'rankings' };
}

function updateNav(page) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}

async function route() {
  const { page, id } = getRoute();
  updateNav(page);

  switch (page) {
    case 'rankings':
      await renderRankings();
      break;
    case 'driver':
      await renderDriver(id);
      break;
    case 'events':
      await renderEvents();
      break;
    case 'event':
      await renderEventDetail(id);
      break;
    case 'about':
      renderAbout();
      break;
  }
}

function renderAbout() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="about-content">
      <h2>What is RANK?</h2>
      <p>
        <strong>RANK</strong> (Relative Autocross Numerical Klassification) is a driver scoring system
        that compiles results from all SCCA national autocross competitions and produces a single
        numerical score representing each driver's skill level relative to all other national competitors.
      </p>

      <h2>How It Works</h2>
      <p>The RANK algorithm makes recursive comparisons of the quality of competitors above and below
      each driver at every event. The key principles:</p>
      <ul>
        <li><strong>Beating strong opponents</strong> is increasingly beneficial to your score</li>
        <li><strong>Losing to weak opponents</strong> is increasingly detrimental</li>
        <li><strong>Recency matters</strong> &mdash; recent results are weighted much more heavily than older ones</li>
        <li><strong>Cross-class comparison</strong> &mdash; PAX indexing normalizes times across all classes</li>
      </ul>

      <h2>Statistical Pruning</h2>
      <p>Before computing final scores, the algorithm prunes outliers:</p>
      <ul>
        <li><strong>~3% of individual results</strong> that are uncharacteristically poor
        (car failures, no clean runs, etc.)</li>
        <li><strong>~5% of event day results</strong> when widespread poor results suggest
        changing conditions (rain, etc.)</li>
      </ul>

      <h2>Supporting Metrics</h2>
      <ul>
        <li><strong>Consistency</strong> &mdash; How consistent the driver's results are over time.
        Higher consistency means the RANK score is more reliable.</li>
        <li><strong>Trend</strong> &mdash; Whether the driver has been improving, staying steady, or declining recently.</li>
        <li><strong>Data Points</strong> &mdash; How many unique competitors this driver has been compared against.
        More data = more robust score.</li>
      </ul>

      <h2>Data Sources</h2>
      <p>Results are scraped from the official SCCA Pronto Timing System used at all national events,
      including National Tours and Solo Nationals. Data goes back to 2021.</p>
      <p>This tool is unofficial and should not be taken as absolute truth, but as a data-driven
      estimate of where drivers stand compared to others.</p>

      <h2>Limited Data</h2>
      <p>Drivers with very limited data receive a small score reduction (up to 5%) to prevent
      overranking from a single strong result. A driver with high consistency and high data points
      has the most robust RANK score.</p>
    </div>
  `;
}

// Load last updated info
async function loadMeta() {
  try {
    const meta = await fetchJSON('meta.json');
    const el = document.getElementById('last-updated');
    if (el && meta.lastUpdated) {
      el.textContent = `Last updated: ${new Date(meta.lastUpdated).toLocaleDateString()}`;
    }
  } catch (e) { /* no meta */ }
}

// Init
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  initSearch();
  loadMeta();
  route();
});
