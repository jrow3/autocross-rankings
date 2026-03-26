// === Main App Router ===

function getRoute() {
  const hash = window.location.hash.slice(1) || '/';
  // Split off query string from the hash path (e.g. #/?class=SS&region=NER)
  const [pathPart] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === '') return { page: 'rankings' };
  if (parts[0] === 'compare' && parts[1] && parts[2]) return { page: 'compare', id: parts[1], id2: parts[2] };
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
  const { page, id, id2 } = getRoute();
  updateNav(page);
  window.scrollTo(0, 0);

  switch (page) {
    case 'rankings':
      await renderRankings();
      break;
    case 'driver':
      await renderDriver(id);
      break;
    case 'compare':
      await renderCompare(id, id2);
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
      <h2>Disclaimer</h2>
      <p>
        This is an unofficial project and is <strong>not affiliated with or endorsed by the SCCA</strong>.
        The ratings produced here are the result of one algorithm's attempt at quantifying driver performance
        from publicly available competition results. They are not an official measure of driver skill, nor
        should they be treated as a definitive or authoritative ranking. Autocross performance depends on
        countless factors that no single number can fully capture. Take these scores as a fun, approximation
        on the data, nothing more.
      </p>

      <h2>What is RATING?</h2>
      <p>
        <strong>RATING</strong> (Relative Autocross Time Index Normalized Grade) is a driver scoring system
        that compiles results from all SCCA national autocross competitions and produces a single
        0&ndash;100 score representing each driver's skill level relative to all other national competitors.
      </p>
      <p>The algorithm's philosophy is: <strong>your skill is defined by who you beat and who beats you,
      weighted by how strong those people are, how decisively you won or lost, how recently it happened, and how
      competitive the field was.</strong> It then applies careful statistical techniques to remove noise (pruning),
      propagate quality signal (iteration), handle uncertainty (penalties), and present results on an interpretable
      scale (probit normalization).</p>

      <h2>Deep Dive into How the RATING is Calculated</h2>

      <h3>Step 1: Scrape &amp; Build Event Days</h3>
      <p>The algorithm scrapes results from all SCCA National Tours and Nationals events and builds "event days" - one entry per event
      per context (overall PAX index + per-class). Each event day contains a list of drivers with their
      PAX-normalized times.</p>
      <p><em>Why not ProSolo's?</em> The data for ProSolo's is very tricky to extract. Hopefully that will be added in the future.</p>
      <p><em>Why PAX indexing?</em> Autocross classes run different cars. A raw time from a Modified car
      isn't comparable to a Stock car. PAX factors level the playing field so a 60-second run in one
      class can be compared to a 70-second run in another. Both the overall PAX index (all drivers at an
      event) and per-class results are used - the overall PAX gives cross-class comparisons while
      per-class gives cleaner within-class signal.</p>
      <p><em>Why event days and not just events?</em> Some events span multiple days with different courses.
      Each day is its own independent competition context.</p>

      <h3>Step 2: Prune Individual Outliers (~3%)</h3>
      <p>For each driver, the algorithm computes their PAX time ratio (their time / best time in field)
      across all events. It calculates the median ratio and the MAD (Median Absolute Deviation). Any result
      where the driver's modified z-score exceeds 2.0 is removed.</p>
      <p><em>Why MAD instead of standard deviation?</em> Standard deviation is pulled by the very outliers
      you're trying to detect - one catastrophic result inflates the stddev, making it harder to
      flag that result as an outlier. MAD uses the median of deviations, so it's robust against
      contamination. The 1.4826 scaling factor makes MAD comparable to stddev for normal distributions.</p>
      <p><em>Why do this at all?</em> A driver who blows an engine, has a mechanical failure, or gets zero
      clean runs will post a wildly unrepresentative time. Without pruning, one terrible day could pull down
      an otherwise strong driver's score, or distort the scores of everyone they "beat" or
      "lost to" that day. Removing ~3% of results cleans up the data without being aggressive
      enough to cherry-pick.</p>

      <h3>Step 3: Prune Event Day Outliers (~5%)</h3>
      <p>For each driver, the algorithm computes their average normalized position across all events. Then for
      each event day, it checks whether the field as a whole performed worse than their personal averages. If
      the average deviation is more than 1.5 standard deviations above the mean, the entire event day is removed.</p>
      <p><em>Why?</em> Sometimes an entire event day is compromised - rain starts mid-session, the course
      surface changes, or conditions are wildly inconsistent. When most drivers at an event perform worse than
      their cross-event averages, the problem is the event, not the drivers. Removing the whole day prevents
      these conditions from polluting everyone's scores.</p>
      <p><em>Why z-score 1.5?</em> This is intentionally more aggressive than individual pruning (2.0) because
      a bad event day affects many drivers simultaneously. A lower threshold catches more compromised days while
      still only removing ~5%.</p>

      <h3>Step 4: Build Pairwise Comparisons</h3>
      <p>For each event day, every pair of drivers is compared head-to-head. The faster driver "wins."
      Each comparison gets a weight computed from four factors multiplied together:</p>

      <h4>Recency Weight</h4>
      <ul>
        <li><strong>0&ndash;3 years old:</strong> Full weight (1.0)</li>
        <li><strong>3+ years:</strong> Exponential decay with 5-year half-life</li>
        <li><strong>Floor:</strong> Never below 15%</li>
      </ul>
      <p><em>Why the 3-year plateau?</em> Autocross seasons are annual. A result from last year is just as
      relevant as one from two years ago - skill doesn't change that fast. The plateau prevents
      recent-event bias where someone who competed last month dominates someone who competed 10 months ago
      despite similar skill levels.</p>
      <p><em>Why 5-year half-life?</em> Skill does change over a decade. A dominant driver from 2015 who
      hasn't competed since shouldn't rank above active competitors. But the decay is slow because
      fundamental driving skill is durable - someone who was good 6 years ago is probably still good if
      they come back.</p>
      <p><em>Why a 15% floor?</em> A National Championship win from 2005 still means something. Without a floor,
      old results would decay to essentially zero, losing valuable historical signal. The floor ensures legendary
      performances remain in the calculation, just at reduced influence.</p>

      <h4>Field-Strength Weight</h4>
      <p>Each event day is weighted by the average RATING score of its participants, normalized so the median
      event equals 1.0. Events with stronger fields (more highly-rated drivers) carry more weight; weaker fields
      carry less. This weight is recomputed each iteration as scores update.</p>
      <p><em>Why not a flat multiplier for Nationals?</em> A fixed "1.5&times; for Nationals" is a
      blunt instrument. It doesn't account for variation between events - a stacked National Tour
      with top-20 drivers deserves more weight than a lightly-attended one. Field-strength weighting captures
      this automatically: Nationals naturally gets higher weight because elite drivers attend, but so does any
      Tour that attracts a strong field. It also avoids penalizing drivers who skip Nationals, since the weight
      is per-event, not per-event-type.</p>

      <h4>Field-Size Normalization: 1/&radic;(fieldSize)</h4>
      <p><em>Why?</em> Without this, a 200-person event generates 19,900 pairwise comparisons while a 10-person
      event generates only 45. A driver who attends many large events would have ~400&times; more data points,
      overwhelming drivers who attend fewer/smaller events.</p>
      <p>Using 1/&radic;(n) instead of 1/n is the key insight: &radic;200/&radic;10 &asymp; 4.5&times;, meaning a
      large field still earns more credit than a small one (it's harder to beat 200 people than 10), but
      the relationship is sublinear. Pure 1/n would give each event equal total weight regardless of size, which
      undervalues the difficulty of large-field performance.</p>

      <h4>Time Margin (Log-Ratio + Tanh Soft-Cap)</h4>
      <p>The algorithm computes <code>log(loserTime / winnerTime)</code> then applies
      <code>1 + (3.0 - 1) &times; tanh(logMargin &times; 15)</code> as a multiplier.</p>
      <p><em>Why log-ratio?</em> Absolute time differences are meaningless in autocross - 0.5 seconds is
      a blowout on a 30-second course but nothing on a 120-second course. The log-ratio is scale-invariant:
      beating someone by 2% is the same signal regardless of course length.</p>
      <p><em>Why tanh soft-cap?</em> Without a cap, a massive blowout would dominate. The tanh function gives a
      smooth S-curve: small margins earn credit quickly, large margins asymptote to 3.0&times;. This means a
      decisive win is worth up to 3&times; a razor-thin win, but never more. No hard cliff - the transition
      is smooth.</p>

      <h3>Step 5: Iterative Convergence (Recursive Quality Propagation)</h3>
      <p>All drivers start at score 1000. Then for each comparison:</p>
      <ul>
        <li><strong>Winner gains:</strong> <code>(loserScore / 1000) &times; weight &times; marginMultiplier</code></li>
        <li><strong>Loser loses:</strong> <code>(winnerScore / 1000) &times; weight &times; 0.4 &times; marginMultiplier</code></li>
      </ul>
      <p>These are accumulated per driver, normalized by their total comparison weight, then rescaled. This
      repeats until scores converge (max delta &lt; 0.001) or 100 iterations.</p>
      <p><em>Why iterative?</em> This is the heart of the algorithm. On the first pass, beating someone rated 1000
      is worth the same regardless of who they are. But after one round, strong drivers have higher scores. On the
      next pass, beating that strong driver is now worth more. Their score was high because <em>they</em> beat strong
      drivers. This quality signal propagates through the entire network - every driver's score reflects
      the strength of everyone they competed against, and everyone <em>those</em> drivers competed against,
      recursively.</p>
      <p>It's conceptually similar to Google's PageRank: a link from an important page is worth more
      than a link from an unimportant page, and importance is defined recursively.</p>
      <p><em>Why asymmetric 0.4&times; loss weight?</em> Autocross has high variance - tires, course conditions,
      a missed shift, a cone. A single bad run shouldn't tank a proven driver. By making losses hurt only 40%
      as much as wins help, the algorithm is more forgiving of fluky bad days while still rewarding consistent
      winners. This stabilizes rankings and reduces volatility.</p>
      <p><em>Why normalize each iteration?</em> Without normalization, scores would diverge - the best drivers
      would grow exponentially and the worst would collapse. Rescaling to a fixed range (100&ndash;2100) after each
      iteration keeps the numbers stable and ensures convergence.</p>

      <h3>Step 6: Limited Data Penalty</h3>
      <p>Drivers with fewer than 10 unique events get a score reduction:
      <code>score &times; (1 - 0.25 &times; (1 - events/10)&sup2;)</code></p>
      <p><em>Why squared curve?</em> A linear penalty would be too harsh on drivers with 5&ndash;6 events who
      actually have reasonable data. The squared curve means:</p>
      <ul>
        <li>1 event: ~25% penalty</li>
        <li>5 events: ~6% penalty</li>
        <li>8 events: ~1% penalty</li>
        <li>10+ events: no penalty</li>
      </ul>
      <p>The steep dropoff means you quickly escape the penalty zone, but a single-event wonder gets meaningfully
      penalized.</p>
      <p><em>Why not just require a minimum?</em> Hiding drivers with few events loses information. A driver who
      won Nationals their only time out is probably very good - they just have uncertainty. The penalty
      reflects that uncertainty without discarding the data entirely.</p>

      <h3>Step 7: Probit Normalization (0&ndash;100 Scale)</h3>
      <ol>
        <li><strong>Rank all drivers</strong> by raw score</li>
        <li><strong>Assign percentiles</strong> (0.0 to 1.0)</li>
        <li><strong>Map through inverse normal CDF</strong> (probit function) &rarr; z-scores</li>
        <li><strong>Apply power transform</strong> with exponent 0.85</li>
        <li><strong>Linearly map</strong> to 0&ndash;100</li>
      </ol>
      <p><em>Why probit instead of just percentiles?</em> Raw percentiles give equal spacing - the difference
      between rank 1 and 2 would look the same as rank 500 and 501. But in reality, the gap between the #1 and #2
      driver is usually massive, while mid-pack drivers are tightly clustered. Probit mapping creates a bell-curve
      distribution where score gaps reflect actual performance gaps.</p>
      <p><em>Why the 0.85 power flattening?</em> A pure probit produces a very peaked normal distribution -
      most drivers clustered tightly around 50 with extreme tails. The sub-linear power transform gently flattens
      the peak, spreading mid-pack drivers apart. This makes the scores more informative in the 30&ndash;70 range
      where most drivers live. The result is a platykurtic (flatter-than-normal) distribution.</p>

      <h3>Step 8: Per-Year Scores</h3>
      <p>The exact same pairwise engine and probit normalization runs on each year's data independently,
      but with recency decay disabled.</p>
      <p><em>Why no recency decay within a year?</em> All events in the same year are equally "recent"
      - there's no reason a January event should count less than a September event within the same season.</p>
      <p><em>Why use the same engine?</em> Ensures year scores are on the same 0&ndash;100 scale with the same
      methodology. A year score of 85 means the same thing as an overall score of 85, so you can directly compare
      a driver's 2019 season to their 2023 season.</p>

      <h3>Step 9: Supporting Metrics</h3>
      <h4>Consistency (1&ndash;5 bars)</h4>
      <p>IQR of normalized finishes over last 3 years, trimmed 10% on each end, deduplicated by event.</p>
      <p><em>Why IQR?</em> It measures spread in the middle 50% of results, ignoring extremes. A driver who always
      finishes in a tight band is consistent; one who swings between 1st and last is not.</p>
      <p><em>Why does consistency matter?</em> It tells you how much to trust the RATING score. A consistent
      driver's score is reliable; an inconsistent driver might be better or worse than their score suggests.</p>

      <h4>Trend</h4>
      <p>Linear regression of normalized performance over time. Slope &gt; 0.05 = strong improvement,
      &lt; -0.05 = strong decline, etc. Absent if no events in 1+ year.</p>
      <p><em>Why linear regression?</em> Simple and interpretable. Autocross performance trends are generally
      gradual - a driver improves or declines over seasons, not events.</p>

      <h4>Confidence (1&ndash;5 bars)</h4>
      <p>Weighted combination of event count (35%), unique competitors faced (30%), recency (20%), and
      consistency (15%).</p>
      <p><em>Why these weights?</em> Event count and competitor network are the strongest signals of data quality
      - more events against more people means more comparisons to triangulate from. Recency matters because
      an inactive driver's ranking is increasingly speculative. Consistency gets a small weight because it
      indicates score reliability.</p>

      <h2>Name Deduplication</h2>
      <p>Driver names are deduplicated using a multi-layer system:</p>
      <ul>
        <li><strong>Nickname canonicalization</strong> - Common nicknames are mapped to formal names
        (e.g., Mike &rarr; Michael, Tom &rarr; Thomas, Bob &rarr; Robert) to merge entries that are the same person.</li>
        <li><strong>Suffix-aware merging</strong> - Name suffixes (Jr, Sr, II, III) are handled intelligently.
        When both a Jr and Sr exist for the same base name, they are kept separate. Otherwise, suffixed
        and unsuffixed versions are merged.</li>
        <li><strong>Manual aliases</strong> - Known typos and alternate spellings are corrected
        (e.g., "Micahel" &rarr; "Michael").</li>
      </ul>

      <h2>Data Sources</h2>
      <p>Results are scraped from the official SCCA Pronto Timing System used at all national events,
      including National Tours and Solo Nationals. Data goes back to 1995.</p>
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
