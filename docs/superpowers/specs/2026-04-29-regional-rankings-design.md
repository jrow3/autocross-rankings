# Regional Rankings Feature

## Overview

Add a regional rankings page that scores SCCA regions by the strength of their drivers. Uses a tiered points system normalized by region size to reward depth of talent without punishing large regions for having many casual participants.

## Scoring Formula

### Tier Points

Drivers contribute points to their region based on their RATING score:

| RATING Range | Points |
|-------------|--------|
| 90+         | 5      |
| 80-89       | 3      |
| 70-79       | 1      |
| Below 70    | 0      |

These tiers are defined as a config constant so they can be easily adjusted (e.g., adding a 60-69 tier later).

### Regional Score

```
raw_score = sum(tier_points for each driver in region) / sqrt(total_ranked_drivers_in_region)
```

Final scores are normalized to a 0-100 scale where the highest-scoring region gets 100.

### Region Assignment

Each driver is assigned to their **most recent region of record** (the region from their most recent event appearance). Drivers with no region data are excluded.

### Minimum Threshold

Regions with fewer than 25 rated drivers are excluded from the leaderboard.

## Data Pipeline

### Input

`scraper/data/rankings.json` — already contains `region` and `score` per driver.

### Processing

New function in `scraper/src/generate-output.js` that:

1. Groups drivers by region (most recent region of record)
2. Filters out regions with < 25 drivers
3. Computes tier points per region
4. Calculates raw score: `sum(points) / sqrt(driverCount)`
5. Normalizes to 0-100 scale (top region = 100)
6. Sorts by score descending and assigns ranks

### Output

`site/data/regions.json` — sorted array:

```json
[
  {
    "rank": 1,
    "region": "Northwest Region (#27)",
    "score": 100,
    "driverCount": 791
  },
  ...
]
```

## Frontend

### Routing

New hash route: `#/regions` handled by `site/js/regions.js`.

### Page Layout

Ranked table matching the existing site style:

| Column | Content |
|--------|---------|
| Rank   | Numeric rank (1, 2, 3...) |
| Region | Region name |
| Score  | Regional score (0-100) |
| Drivers | Count of rated drivers |

### Interaction

Clicking a region row navigates to `#/?region=<url-encoded region name>`, which activates the existing region filter on the main rankings page. No new detail view needed.

### Navigation

Add "Regions" link to the nav bar in `site/index.html`, between existing nav items.

## Files Modified

- `scraper/src/generate-output.js` — add regional score computation and `regions.json` output
- `site/js/regions.js` — new file, regions table view
- `site/js/app.js` — add `#/regions` route
- `site/index.html` — add Regions nav link

## Files Not Modified

- `scraper/src/scraper.js` — no new scraping needed
- `scraper/src/rank-algorithm.js` — no changes to individual driver scoring
- `scraper/src/driver-registry.js` — region data already collected
