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
        0&ndash;100 score representing each driver's skill level relative to all other national competitors.
      </p>

      <h2>Algorithm Overview</h2>
      <p>RANK uses a multi-stage pipeline to produce fair, statistically robust scores:</p>
      <ol>
        <li>Compile PAX-indexed results from all national events (Tours &amp; Nationals)</li>
        <li>Prune statistical outliers (bad days, weather, car failures)</li>
        <li>Build pairwise comparisons between every driver at each event</li>
        <li>Iteratively solve for driver quality using recursive opponent-strength weighting</li>
        <li>Apply penalties for limited data and inactivity</li>
        <li>Normalize to a 0&ndash;100 scale using probit (bell-curve) mapping</li>
      </ol>

      <h2>Pairwise Comparison Engine</h2>
      <p>At the core of RANK is an iterative pairwise comparison system. For every event day,
      each pair of drivers is compared head-to-head based on PAX time. Each comparison is weighted by several factors:</p>
      <ul>
        <li><strong>Opponent quality</strong> &mdash; Beating a strong opponent (who themselves beat strong opponents)
        is worth more than beating a weak one. This is solved iteratively until scores converge,
        propagating quality through the entire network of comparisons.</li>
        <li><strong>Time margin</strong> &mdash; Winning by a large margin earns proportionally more credit
        than a razor-thin finish. Margins are capped to prevent blowouts from dominating.</li>
        <li><strong>Recency</strong> &mdash; Results are exponentially weighted with a 1-year half-life.
        A result from 2 years ago counts about 25% as much as one from today.</li>
        <li><strong>Event type</strong> &mdash; Solo Nationals results carry 1.5&times; the weight of Tour results,
        reflecting the higher competition level at the pinnacle event.</li>
        <li><strong>Field-size normalization</strong> &mdash; Each comparison is weighted by 1/&radic;(field size).
        This means winning a 1,000-person field earns roughly 10&times; the credit of winning a 10-person field
        (&radic;1000/&radic;10 &asymp; 10), rather than the 100&times; that raw comparison counts would produce.
        This prevents high-volume drivers from dominating purely through event attendance while still properly
        rewarding performance in large, competitive fields.</li>
      </ul>

      <h2>Statistical Pruning</h2>
      <p>Before computing scores, the algorithm removes statistical outliers to prevent fluky results
      from distorting rankings:</p>
      <ul>
        <li><strong>Individual pruning (~3%)</strong> &mdash; Results where a driver performed far worse than their
        personal average (z-score &gt; 1.8) are removed. These typically represent car failures,
        mechanical issues, or runs with no clean times.</li>
        <li><strong>Event day pruning (~5%)</strong> &mdash; Entire event days are removed when drivers across the
        field performed significantly worse than their averages (z-score &gt; 1.5). This catches days with
        rain, changing conditions, or course issues that affected everyone.</li>
      </ul>

      <h2>Score Normalization (Probit Mapping)</h2>
      <p>Raw iterative scores are converted to the 0&ndash;100 scale using
      <strong>probit normalization</strong> &mdash; the same statistical approach used by standardized tests
      like the SAT and IQ scales:</p>
      <ol>
        <li><strong>Percentile rank</strong> &mdash; Each driver is assigned a percentile based on their position
        among all ranked drivers (0.0 to 1.0).</li>
        <li><strong>Probit transform</strong> &mdash; Percentiles are mapped through the inverse normal CDF
        (probit function) to produce z-scores. This creates a bell-curve distribution where score gaps
        reflect the statistical significance of performance differences.</li>
        <li><strong>Flattened bell curve</strong> &mdash; A sub-linear power transform (exponent 0.85) is applied to
        the z-scores, gently flattening the peak of the bell curve. This spreads drivers in the middle
        of the pack apart, producing a platykurtic distribution that is more informative than a pure normal curve.</li>
        <li><strong>Scale to 0&ndash;100</strong> &mdash; The flattened z-scores are linearly mapped to the 0&ndash;100 range.</li>
      </ol>
      <p>The result: very few drivers reach 100 or 0 (the tails of the distribution), most cluster
      around 50, and the spacing between scores reflects meaningful performance differences.</p>

      <h2>Penalties</h2>
      <ul>
        <li><strong>Limited data penalty</strong> &mdash; Drivers with fewer than 8 events receive up to a 30%
        score reduction. This prevents a single strong weekend from producing an inflated ranking.
        The penalty scales linearly: 1 event = 30% reduction, 4 events = 15%, 8+ events = no penalty.</li>
        <li><strong>Inactivity penalty</strong> &mdash; Drivers who haven't competed in over a year see their score
        gradually decay with a 2-year half-life. A driver who last competed 2 years ago loses roughly 50%
        of their score. This ensures the rankings reflect the current competitive landscape, not historical dominance.</li>
      </ul>

      <h2>Supporting Metrics</h2>
      <ul>
        <li><strong>Consistency (1&ndash;5 bars)</strong> &mdash; Measures how stable a driver's results are, using
        the interquartile range (IQR) of their normalized finishes over the last 3 years. Results are
        deduplicated by event and the top/bottom 10% are trimmed before calculation. Higher consistency
        means the RANK score is more reliable.</li>
        <li><strong>Trend</strong> &mdash; Linear regression of performance over time. Shows whether a driver is
        improving (&uarr;), steady (&ndash;), declining (&darr;), or absent (X, no results in 1+ year).</li>
        <li><strong>Data Points (1&ndash;5 bars)</strong> &mdash; The number of unique competitors this driver has been
        compared against. More comparisons = more robust and trustworthy score.</li>
      </ul>

      <h2>Year-by-Year Scores</h2>
      <p>Each driver's profile includes per-year scores computed using the same probit + flatten pipeline
      as the overall RANK score. This ensures year scores are on the same 0&ndash;100 scale as the overall
      ranking, so a year score of 90 means the same thing as an overall score of 90.</p>

      <h2>Name Deduplication</h2>
      <p>Driver names are deduplicated using a multi-layer system:</p>
      <ul>
        <li><strong>Nickname canonicalization</strong> &mdash; Common nicknames are mapped to formal names
        (e.g., Mike &rarr; Michael, Tom &rarr; Thomas, Bob &rarr; Robert) to merge entries that are the same person.</li>
        <li><strong>Suffix-aware merging</strong> &mdash; Name suffixes (Jr, Sr, II, III) are handled intelligently.
        When both a Jr and Sr exist for the same base name, they are kept separate. Otherwise, suffixed
        and unsuffixed versions are merged.</li>
        <li><strong>Manual aliases</strong> &mdash; Known typos and alternate spellings are corrected
        (e.g., "Micahel" &rarr; "Michael").</li>
      </ul>

      <h2>Data Sources</h2>
      <p>Results are scraped from the official SCCA Pronto Timing System used at all national events,
      including National Tours and Solo Nationals. Data goes back to 2015.</p>
      <p>Currently tracking <strong>6,800+ drivers</strong> across <strong>140+ events</strong> with
      over <strong>8.5 million pairwise comparisons</strong>.</p>
      <p class="disclaimer">This tool is unofficial and not affiliated with SCCA. It is a data-driven
      estimate of relative driver skill and should be interpreted as one useful perspective, not absolute truth.</p>
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
