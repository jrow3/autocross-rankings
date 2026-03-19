# Autocross RATING

**Relative Autocross Time Index Normalized Grade**

A driver scoring system that compiles results from all SCCA national autocross competitions and produces a single 0–100 score representing each driver's skill level relative to all other national competitors.

## How It Works

RATING uses a multi-stage pipeline:

1. Compile PAX-indexed results from all national events (Tours & Nationals)
2. Build per-class results using PAX factors for cross-class comparison
3. Prune individual statistical outliers (~3%) and event day outliers (~5%)
4. Build pairwise comparisons between every driver at each event
5. Iteratively solve for driver quality using recursive opponent-strength weighting
6. Weight results by recency (3-year plateau, then 5-year half-life decay)
7. Apply limited data penalty for drivers with few events
8. Normalize to 0–100 using probit (bell-curve) mapping
9. Compute per-year breakdowns, consistency, trend, and confidence

## Site

The site is a static single-page application with no build step. Pages include:

- **Rankings** — Sortable table of all ranked drivers with consistency, trend, and confidence metrics
- **Events** — Browse all scraped national events
- **Driver Profiles** — Individual pages with year-by-year scores, event history, and performance charts
- **About** — Full algorithm documentation

## Scraper

The scraper pulls results from the SCCA Pronto Timing System. Data goes back to 2010.

```bash
cd scraper
npm install

# Scrape latest events
npm run scrape

# Compute rankings
npm run rank

# Generate site data
npm run generate

# Run full pipeline
npm run full
```

## Data

Currently tracking **8,500+ drivers** across **195 events** with data from 2010–2026.

## Disclaimer

This tool is unofficial and not affiliated with SCCA. It is a data-driven estimate of relative driver skill and should be interpreted as one useful perspective, not absolute truth.
