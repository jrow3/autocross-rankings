# Regional Rankings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a regional rankings page that scores SCCA regions by driver strength using a tiered points system normalized by region size.

**Architecture:** New computation step in generate-output.js produces regions.json. New regions.js renders the table. App router gets a new route. Clicking a region navigates to the existing rankings page with the region filter applied.

**Tech Stack:** Vanilla JS (no build step), Node.js for data generation. Matches existing site patterns exactly.

---

### Task 1: Add regional score computation to generate-output.js

**Files:**
- Modify: `scraper/src/generate-output.js` (insert after line 91, before search index generation)

- [ ] **Step 1: Add the regional scoring function**

Add this before the `generateOutput()` function (before line 16):

```javascript
// Regional scoring: tiered points / sqrt(driverCount), normalized to 0-100
const REGION_TIERS = [
  { min: 90, points: 5 },
  { min: 80, points: 3 },
  { min: 70, points: 1 },
];
const MIN_REGION_DRIVERS = 25;

function computeRegionalRankings(rankings) {
  const regionDrivers = new Map();

  for (const driver of rankings) {
    const region = driver.region;
    if (!region) continue;
    if (!regionDrivers.has(region)) regionDrivers.set(region, []);
    regionDrivers.get(region).push(driver.score);
  }

  const regionScores = [];
  for (const [region, scores] of regionDrivers) {
    if (scores.length < MIN_REGION_DRIVERS) continue;

    let points = 0;
    for (const score of scores) {
      for (const tier of REGION_TIERS) {
        if (score >= tier.min) {
          points += tier.points;
          break;
        }
      }
    }

    const rawScore = points / Math.sqrt(scores.length);
    regionScores.push({ region, rawScore, driverCount: scores.length });
  }

  // Normalize to 0-100 (top region = 100)
  const maxRaw = Math.max(...regionScores.map(r => r.rawScore));
  const results = regionScores
    .map(r => ({
      region: r.region,
      score: Math.round((r.rawScore / maxRaw) * 100),
      driverCount: r.driverCount,
    }))
    .sort((a, b) => b.score - a.score || a.region.localeCompare(b.region))
    .map((r, i) => ({ rank: i + 1, ...r }));

  return results;
}
```

- [ ] **Step 2: Call the function and write regions.json**

Inside `generateOutput()`, after the `rankings.json` write (after line 92), add:

```javascript
  // Generate regional rankings
  const regionalRankings = computeRegionalRankings(slimRankings);
  writeFileSync(join(SITE_DATA_DIR, 'regions.json'), JSON.stringify(regionalRankings));
  console.log(`Wrote regions.json (${regionalRankings.length} regions)`);
```

- [ ] **Step 3: Run generate-output and verify**

Run from the scraper directory:
```bash
cd scraper && node src/generate-output.js
```

Expected: Output includes a line like `Wrote regions.json (XX regions)`. Verify the file exists:
```bash
cat ../site/data/regions.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.length + ' regions'); console.log(d.slice(0,5));"
```

Expected: ~80+ regions, top entries have score 100, all have rank/region/score/driverCount fields.

- [ ] **Step 4: Commit**

```bash
git add scraper/src/generate-output.js site/data/regions.json
git commit -m "Add regional score computation to generate-output"
```

---

### Task 2: Create the regions page frontend

**Files:**
- Create: `site/js/regions.js`

- [ ] **Step 1: Create regions.js**

Create `site/js/regions.js` with the following content. This follows the same patterns as `event.js` and `rankings.js` — loads JSON via `fetchJSON()`, renders into `#app`, uses `escapeHtml()` from utils.js:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add site/js/regions.js
git commit -m "Add regions page frontend"
```

---

### Task 3: Wire up routing and navigation

**Files:**
- Modify: `site/js/app.js` (lines 12, 14, 40-42)
- Modify: `site/index.html` (lines 29-30, 53)

- [ ] **Step 1: Add the route to app.js**

In `site/js/app.js`, add the regions route to `getRoute()` — insert after line 12 (`if (parts[0] === 'events')...`):

```javascript
  if (parts[0] === 'regions') return { page: 'regions' };
```

Add the case to the `route()` switch — insert after the `events` case (after line 41):

```javascript
    case 'regions':
      await renderRegions();
      break;
```

- [ ] **Step 2: Add the nav link to index.html**

In `site/index.html`, add the Regions link after the Events link (after line 29):

```html
      <a href="#/regions" class="nav-link" data-page="regions">Regions</a>
```

- [ ] **Step 3: Add the script tag to index.html**

In `site/index.html`, add the regions.js script after event.js (after line 53):

```html
  <script src="js/regions.js?v=15"></script>
```

- [ ] **Step 4: Test locally**

Open `site/index.html` in a browser (or use a local server). Verify:
- "Regions" link appears in the nav bar
- Clicking it shows the regional rankings table
- Table has Rank, Region, Score, Drivers columns
- Clicking a region row navigates to `#/?region=...` and the rankings page filters to that region
- The "Regions" nav link is highlighted when on the regions page

- [ ] **Step 5: Commit**

```bash
git add site/js/app.js site/index.html
git commit -m "Wire up regions route and nav link"
```

---

### Task 4: Update the GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/update-rankings.yml` (no change needed — generate-output.js already runs in the pipeline and the site/ directory is deployed as-is)

- [ ] **Step 1: Verify no workflow changes needed**

The workflow already runs `node src/generate-output.js` which will now produce `regions.json`. The deploy step uploads the entire `./site` directory. No changes needed.

Confirm by reading `.github/workflows/update-rankings.yml` and verifying:
1. `node src/generate-output.js` is called (it is — line 65 equivalent)
2. `./site` is the upload path for pages (it is — line 78)

- [ ] **Step 2: Push all commits and trigger a workflow run**

```bash
git push
gh workflow run update-rankings.yml
```

- [ ] **Step 3: Verify deployment**

After the workflow completes (~3 minutes), check:
- `https://rating.autox.tools/data/regions.json` returns valid JSON
- `https://rating.autox.tools/#/regions` shows the regional rankings page
- Clicking a region navigates to the filtered ratings page
