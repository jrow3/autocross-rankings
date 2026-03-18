import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry, normalizeName } from './driver-registry.js';
import { getPaxFactor } from './pax-factors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EVENTS_DIR = join(DATA_DIR, 'events');
const OUTPUT_FILE = join(DATA_DIR, 'rankings.json');

// ============================================================
// RANK Algorithm Implementation
//
// Replicates the RANK (Relative Autocross Numerical Klassification) system.
// From the reference spreadsheet:
//   "RANK compiles results from all national competitions and makes
//    recursive comparisons of the quality of the competitors above and
//    below each competitor. Finishing above strong competitors is
//    increasingly beneficial, while finishing below weak competitors
//    is increasingly detrimental."
//
// Pipeline:
// 1. Compile PAX-indexed results from all national events
// 2. Prune ~3% individual outliers (car failure, no clean runs, etc.)
// 3. Prune ~5% event day outliers (rain, changing conditions)
// 4. For each event day, create pairwise comparisons between all drivers
// 5. Recursively weight wins/losses by opponent quality (iterative)
// 6. Weight results by recency (recent >> past)
// 7. Apply limited data penalty (up to 5% reduction)
// 8. Normalize to 0-100 percentile scale
// 9. Compute per-year breakdowns, consistency, trend, data points
// ============================================================

const CONVERGENCE_THRESHOLD = 0.001;
const MAX_ITERATIONS = 100;
const INITIAL_SCORE = 1000;
const RECENCY_HALF_LIFE_DAYS = 365; // Recent results count more
const INDIVIDUAL_PRUNE_ZSCORE = 1.8; // Prune results with high z-score (~3% target)
const LIMITED_DATA_PENALTY_MAX = 0.05; // Up to 5% reduction for limited data
const LIMITED_DATA_THRESHOLD = 5; // Below this many events, apply penalty
const RECENT_CLASSES_COUNT = 3; // Use most recent N classes for driver's class list

// Load all event data
function loadEventData() {
  const eventFiles = readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
  const events = [];

  for (const file of eventFiles) {
    const event = JSON.parse(readFileSync(join(EVENTS_DIR, file), 'utf8'));
    events.push(event);
  }

  return events;
}

// Parse event date from various formats
function parseEventDate(dates) {
  if (!dates) return new Date();
  const slashMatch = dates.match(/(\d{2}\/\d{2}\/\d{4})/);
  const wordMatch = dates.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i);
  if (slashMatch) return new Date(slashMatch[1]);
  if (wordMatch) return new Date(wordMatch[1]);
  return new Date();
}

// Extract PAX-normalized results for each event day
function buildEventDays(events) {
  const eventDays = [];

  for (const event of events) {
    const eventDate = parseEventDate(event.eventDates || '');

    // Use PAX index if available (best cross-class comparison)
    if (event.paxIndex?.overall?.length > 0) {
      const dayResults = event.paxIndex.overall.map(r => ({
        driverName: normalizeName(r.name),
        displayName: r.name,
        className: r.className,
        paxTime: r.paxTime,
        position: r.position,
        eventCode: event.eventCode,
        eventName: event.eventName,
        eventDate,
        eventType: event.eventType,
      })).filter(r => r.paxTime > 0);

      if (dayResults.length >= 3) {
        eventDays.push({
          id: `${event.eventCode}_overall`,
          eventCode: event.eventCode,
          eventName: event.eventName,
          eventDate,
          eventType: event.eventType,
          results: dayResults,
        });
      }
    }

    // Also build per-class results (within-class comparison doesn't need PAX)
    for (const [className, classResults] of Object.entries(event.classResults || {})) {
      if (classResults.length < 3) continue;

      const paxFactor = getPaxFactor(className);
      const dayResults = classResults.map(r => {
        let paxTime = r.paxTime;
        if (!paxTime || paxTime === 0) {
          const bestC1 = r.runs?.course1?.filter(t => t.best)?.[0]?.adjusted;
          const bestC2 = r.runs?.course2?.filter(t => t.best)?.[0]?.adjusted;
          if (bestC1 && bestC2) {
            paxTime = (bestC1 + bestC2) * paxFactor;
          }
        }

        return {
          driverName: normalizeName(r.name),
          displayName: r.name,
          className,
          paxTime,
          position: r.position,
          eventCode: event.eventCode,
          eventName: event.eventName,
          eventDate,
          eventType: event.eventType,
        };
      }).filter(r => r.paxTime > 0);

      if (dayResults.length >= 3) {
        eventDays.push({
          id: `${event.eventCode}_${className}`,
          eventCode: event.eventCode,
          eventName: event.eventName,
          eventDate,
          eventType: event.eventType,
          className,
          results: dayResults,
        });
      }
    }
  }

  return eventDays;
}

// Calculate recency weight for an event (exponential decay)
function recencyWeight(eventDate, now = new Date()) {
  const daysDiff = (now - eventDate) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysDiff / RECENCY_HALF_LIFE_DAYS);
}

// Prune individual outlier results (~3% target)
// Removes results where a driver performed significantly worse than their norm
// (car failure, no clean runs, mechanical issues, etc.)
function pruneIndividualOutliers(eventDays) {
  const driverResults = new Map();

  for (const day of eventDays) {
    for (const result of day.results) {
      if (!driverResults.has(result.driverName)) {
        driverResults.set(result.driverName, []);
      }
      driverResults.get(result.driverName).push({
        dayId: day.id,
        result,
        normalizedPosition: result.position / day.results.length,
      });
    }
  }

  const prunedResultIds = new Set();

  for (const [driverName, results] of driverResults) {
    if (results.length < 3) continue;

    const positions = results.map(r => r.normalizedPosition);
    const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
    const stdDev = Math.sqrt(positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / positions.length);

    if (stdDev === 0) continue;

    for (const r of results) {
      const zScore = (r.normalizedPosition - mean) / stdDev;
      if (zScore > INDIVIDUAL_PRUNE_ZSCORE) {
        prunedResultIds.add(`${r.dayId}_${driverName}`);
      }
    }
  }

  let prunedCount = 0;
  for (const day of eventDays) {
    const before = day.results.length;
    day.results = day.results.filter(r =>
      !prunedResultIds.has(`${day.id}_${r.driverName}`)
    );
    prunedCount += before - day.results.length;
  }

  const totalResults = eventDays.reduce((sum, d) => sum + d.results.length, 0);
  console.log(`Individual pruning: removed ${prunedCount} results (${(prunedCount / (totalResults + prunedCount) * 100).toFixed(1)}%)`);

  return eventDays;
}

// Prune event days with widespread poor results (~5% target)
// When uncharacteristically low results are seen across a large portion of the field
// (changing conditions, rain, etc.)
function pruneEventDayOutliers(eventDays) {
  // First, build each driver's average normalized position across ALL event days
  const driverAvgPositions = new Map();
  const driverCounts = new Map();

  for (const day of eventDays) {
    for (const r of day.results) {
      const normPos = r.position / day.results.length;
      driverAvgPositions.set(r.driverName, (driverAvgPositions.get(r.driverName) || 0) + normPos);
      driverCounts.set(r.driverName, (driverCounts.get(r.driverName) || 0) + 1);
    }
  }

  for (const [name, total] of driverAvgPositions) {
    driverAvgPositions.set(name, total / driverCounts.get(name));
  }

  // For each event day, compute how much worse drivers did vs their averages
  // If many drivers performed worse than normal, conditions were likely bad
  const dayDeviations = [];

  for (const day of eventDays) {
    if (day.results.length < 5) {
      dayDeviations.push({ day, deviation: 0 });
      continue;
    }

    let totalDeviation = 0;
    let count = 0;

    for (const r of day.results) {
      const avgPos = driverAvgPositions.get(r.driverName);
      if (avgPos === undefined || driverCounts.get(r.driverName) < 2) continue;
      const normPos = r.position / day.results.length;
      // Positive = worse than average
      totalDeviation += (normPos - avgPos);
      count++;
    }

    const avgDeviation = count > 0 ? totalDeviation / count : 0;
    dayDeviations.push({ day, deviation: avgDeviation });
  }

  // Find event days where the field performed significantly worse than normal
  const deviations = dayDeviations.map(d => d.deviation);
  const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const stdDev = Math.sqrt(deviations.reduce((sum, d) => sum + Math.pow(d - meanDev, 2), 0) / deviations.length);

  const prunedDays = new Set();
  const EVENT_PRUNE_ZSCORE = 1.5; // Tuned to hit ~5% target

  for (const { day, deviation } of dayDeviations) {
    if (stdDev > 0) {
      const zScore = (deviation - meanDev) / stdDev;
      if (zScore > EVENT_PRUNE_ZSCORE) {
        prunedDays.add(day.id);
      }
    }
  }

  const before = eventDays.length;
  const filtered = eventDays.filter(d => !prunedDays.has(d.id));
  console.log(`Event day pruning: removed ${before - filtered.length} days (${((before - filtered.length) / before * 100).toFixed(1)}%)`);

  return filtered;
}

// Core RANK computation using iterative pairwise comparison
// This is the recursive comparison that is central to RANK:
// Each iteration updates scores based on opponent quality from the previous iteration,
// so beating a strong opponent (who themselves beat strong opponents) propagates value.
function computeRankScores(eventDays) {
  const now = new Date();

  const scores = new Map();
  const driverNames = new Map();

  for (const day of eventDays) {
    for (const result of day.results) {
      if (!scores.has(result.driverName)) {
        scores.set(result.driverName, INITIAL_SCORE);
        driverNames.set(result.driverName, result.displayName);
      }
    }
  }

  console.log(`Computing RANK for ${scores.size} drivers across ${eventDays.length} event days...`);

  // Build pairwise comparisons with recency weighting and time-margin scaling
  // Time margins matter: beating someone by 2 seconds is more meaningful than 0.01s.
  // We use a margin amplifier so that close finishes produce near-equal credit,
  // while dominant wins produce significantly more credit.
  const MARGIN_AMPLIFIER = 5; // Amplifies raw margin percentage into meaningful score difference
  const MARGIN_CAP = 2.5;     // Max margin multiplier (prevents extreme blowouts from dominating)
  const comparisons = [];

  for (const day of eventDays) {
    const weight = recencyWeight(day.eventDate, now);
    const results = day.results.sort((a, b) => a.paxTime - b.paxTime);

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const winner = results[i]; // Lower PAX time = better
        const loser = results[j];
        // Raw margin as fraction of winner's time (e.g., 0.02 = 2% slower)
        const rawMargin = (loser.paxTime - winner.paxTime) / winner.paxTime;
        // Amplified margin: 2% gap -> 1.10x, 5% gap -> 1.25x, 10% gap -> 1.50x
        const marginMultiplier = Math.min(1 + rawMargin * MARGIN_AMPLIFIER, MARGIN_CAP);

        comparisons.push({
          winner: winner.driverName,
          loser: loser.driverName,
          weight,
          marginMultiplier,
          dayId: day.id,
        });
      }
    }
  }

  console.log(`Built ${comparisons.length.toLocaleString()} pairwise comparisons`);

  // Iterative convergence (recursive quality propagation)
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const newScores = new Map();

    for (const [driver] of scores) {
      newScores.set(driver, 100); // Base score
    }

    for (const comp of comparisons) {
      const winnerScore = scores.get(comp.winner) || INITIAL_SCORE;
      const loserScore = scores.get(comp.loser) || INITIAL_SCORE;

      // Beating a strong opponent (high score) = more valuable
      // Losing to a weak opponent (low score) = more costly
      // Time margin scaling: winning by a large margin gives proportionally more credit
      // e.g., 0.01s ahead -> ~1.0x, 1s ahead on 60s run (~1.7%) -> 1.08x, 3s ahead (~5%) -> 1.25x
      const winValue = (loserScore / INITIAL_SCORE) * comp.weight * comp.marginMultiplier;
      // Loss penalty also scales: losing by a lot hurts more than a close loss
      const lossValue = -(winnerScore / INITIAL_SCORE) * comp.weight * 0.3 * comp.marginMultiplier;

      newScores.set(comp.winner, (newScores.get(comp.winner) || 0) + winValue);
      newScores.set(comp.loser, (newScores.get(comp.loser) || 0) + lossValue);
    }

    // Normalize to keep centered
    const allScores = [...newScores.values()];
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const range = maxScore - minScore || 1;

    for (const [driver, score] of newScores) {
      newScores.set(driver, ((score - minScore) / range) * 2000 + 100);
    }

    // Check convergence
    let maxDelta = 0;
    for (const [driver, newScore] of newScores) {
      const oldScore = scores.get(driver) || INITIAL_SCORE;
      maxDelta = Math.max(maxDelta, Math.abs(newScore - oldScore));
    }

    for (const [driver, newScore] of newScores) {
      scores.set(driver, newScore);
    }

    if (maxDelta < CONVERGENCE_THRESHOLD) {
      console.log(`Converged after ${iter + 1} iterations (max delta: ${maxDelta.toFixed(6)})`);
      break;
    }

    if ((iter + 1) % 10 === 0) {
      console.log(`  Iteration ${iter + 1}: max delta = ${maxDelta.toFixed(4)}`);
    }
  }

  return { scores, driverNames };
}

// Normalize raw iterative scores to 0-100 percentile scale (matching reference spreadsheet)
function normalizeToPercentile(rankings) {
  const n = rankings.length;
  if (n === 0) return;

  // Sort by raw score descending
  rankings.sort((a, b) => b.rawScore - a.rawScore);

  // Assign percentile: top driver = 100, bottom driver approaches 0
  // Using percentile rank formula: 100 * (n - rank) / (n - 1)
  for (let i = 0; i < n; i++) {
    if (n > 1) {
      rankings[i].score = Math.round(100 * (n - 1 - i) / (n - 1));
    } else {
      rankings[i].score = 100;
    }
  }
}

// Compute per-year RANK scores using percentile ranking
// For each year, rank all drivers by their average normalized position,
// then assign percentile scores (0-100) so year scores align with overall RANK methodology.
function computeAllYearScores(allDriverResults) {
  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const yearPercentiles = new Map(); // year -> Map(driverName -> percentile)

  for (const year of years) {
    // Collect average normalized position for each driver in this year
    const driverAvgs = [];

    for (const [driverName, results] of allDriverResults) {
      const yearResults = results.filter(r => r.eventDate.getFullYear() === year);
      if (yearResults.length === 0) continue;

      const avgPosition = yearResults.reduce((sum, r) => sum + r.normalizedPosition, 0) / yearResults.length;
      driverAvgs.push({ driverName, avgPosition });
    }

    if (driverAvgs.length === 0) continue;

    // Sort by avgPosition ascending (lower = better, more wins)
    driverAvgs.sort((a, b) => a.avgPosition - b.avgPosition);

    const n = driverAvgs.length;
    const percentileMap = new Map();

    for (let i = 0; i < n; i++) {
      // Top driver gets 100, bottom gets ~0
      const percentile = n > 1 ? Math.round(100 * (n - 1 - i) / (n - 1)) : 100;
      percentileMap.set(driverAvgs[i].driverName, percentile);
    }

    yearPercentiles.set(year, percentileMap);
  }

  return yearPercentiles;
}

// Compute consistency metric (1-5 bars, matching spreadsheet | to |||||)
// Higher = more consistent. Low consistency means results should be taken with grain of salt.
// Uses trimmed IQR approach:
//   1. Deduplicates by event code (one result per event, prefer largest field)
//   2. Uses only recent results (last 3 years) to avoid ancient outliers
//   3. Trims top/bottom 10% before computing IQR (handles event size disparity)
//   4. Wider thresholds to account for natural variance between event sizes
function computeConsistency(driverResults) {
  if (driverResults.length < 2) return 3; // Not enough data, assume average

  // Deduplicate: one result per event, prefer largest field (PAX overall > class)
  // When same eventCode + same fieldSize (multi-day events), average the positions
  const byEvent = new Map();
  for (const r of driverResults) {
    const existing = byEvent.get(r.eventCode);
    if (!existing || (r.fieldSize || 0) > (existing.fieldSize || 0)) {
      byEvent.set(r.eventCode, { ...r, _positions: [r.normalizedPosition], _count: 1 });
    } else if ((r.fieldSize || 0) === (existing.fieldSize || 0)) {
      // Same event, same field size (different day) — accumulate for averaging
      existing._positions.push(r.normalizedPosition);
      existing._count++;
      existing.normalizedPosition = existing._positions.reduce((a, b) => a + b, 0) / existing._count;
    }
  }

  let dedupedResults = [...byEvent.values()];
  if (dedupedResults.length < 2) return 3;

  // Use only results from last 3 years for consistency (old results shouldn't penalize)
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const recentResults = dedupedResults.filter(r => r.eventDate >= threeYearsAgo);
  if (recentResults.length >= 3) {
    dedupedResults = recentResults;
  }

  // Sort positions and trim top/bottom 10% (handles outlier events)
  let positions = dedupedResults.map(r => r.normalizedPosition).sort((a, b) => a - b);
  const n = positions.length;
  if (n >= 6) {
    const trimCount = Math.max(1, Math.floor(n * 0.1));
    positions = positions.slice(trimCount, n - trimCount);
  }

  const tn = positions.length;
  if (tn < 2) return 3;

  const q1 = positions[Math.floor(tn * 0.25)];
  const q3 = positions[Math.floor(tn * 0.75)];
  const iqr = q3 - q1;

  // Wider thresholds that account for natural variance between event sizes
  // A top driver will be 0.02 at Nationals (1000+) but 0.15 at a Tour (150)
  // That 0.13 spread is natural, not inconsistency
  if (iqr < 0.05) return 5;  // |||||  Extremely consistent
  if (iqr < 0.12) return 4;  // ||||   Consistent
  if (iqr < 0.22) return 3;  // |||    Average
  if (iqr < 0.35) return 2;  // ||     Variable
  return 1;                    // |      Inconsistent
}

// Compute trend (matching spreadsheet: up3, up1, steady, down1, absent)
// ↑↑↑ = strong improvement, ↑ = moderate, - = steady, ↓ = decline, X = absent
function computeTrend(driverResults, now = new Date()) {
  const lastEvent = driverResults.reduce((latest, r) => {
    return r.eventDate > latest ? r.eventDate : latest;
  }, new Date(0));

  const daysSinceLastEvent = (now - lastEvent) / (1000 * 60 * 60 * 24);
  if (daysSinceLastEvent > 365) return 'absent'; // X in spreadsheet

  if (driverResults.length < 3) return 'steady';

  // Linear regression of performance over time
  const sorted = [...driverResults].sort((a, b) => a.eventDate - b.eventDate);
  const n = sorted.length;

  const xs = sorted.map((r, i) => i);
  const ys = sorted.map(r => 1 - r.normalizedPosition); // Higher = better

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  const denominator = xs.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0);
  if (denominator === 0) return 'steady';

  const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0) / denominator;

  if (slope > 0.05) return 'up3';    // ↑↑↑ Strong improvement
  if (slope > 0.02) return 'up1';    // ↑ Moderate improvement
  if (slope < -0.05) return 'down2'; // ↓↓ Strong decline
  if (slope < -0.02) return 'down1'; // ↓ Moderate decline
  return 'steady';                    // -
}

// Compute data points metric (1-5 bars based on unique competitors faced)
// More competitors faced = more robust RANK score
function computeDataPoints(driverName, eventDays) {
  const competitorsFaced = new Set();

  for (const day of eventDays) {
    const driverInDay = day.results.find(r => r.driverName === driverName);
    if (!driverInDay) continue;

    for (const r of day.results) {
      if (r.driverName !== driverName) {
        competitorsFaced.add(r.driverName);
      }
    }
  }

  const count = competitorsFaced.size;
  if (count >= 1500) return 5;  // |||||
  if (count >= 800) return 4;   // ||||
  if (count >= 400) return 3;   // |||
  if (count >= 150) return 2;   // ||
  return 1;                      // |
}

// Determine driver's classes from most recent events (not most frequent)
// Uses the most recent RECENT_CLASSES_COUNT unique classes
function getRecentClasses(driverResults) {
  // Sort by event date descending (most recent first)
  const sorted = [...driverResults]
    .filter(r => r.className)
    .sort((a, b) => b.eventDate - a.eventDate);

  // Collect unique classes in order of recency
  const recentClasses = [];
  const seen = new Set();

  for (const r of sorted) {
    if (!seen.has(r.className)) {
      seen.add(r.className);
      recentClasses.push(r.className);
      if (recentClasses.length >= RECENT_CLASSES_COUNT) break;
    }
  }

  return recentClasses;
}

// Apply limited data penalty (up to 5% score reduction)
function applyLimitedDataPenalty(score, eventCount) {
  if (eventCount >= LIMITED_DATA_THRESHOLD) return score;
  const penaltyFraction = LIMITED_DATA_PENALTY_MAX * (1 - eventCount / LIMITED_DATA_THRESHOLD);
  return score * (1 - penaltyFraction);
}

// Main ranking pipeline
async function computeRankings() {
  console.log('=== RANK Algorithm ===\n');

  // 1. Load event data
  const events = loadEventData();
  console.log(`Loaded ${events.length} events`);

  // 2. Build event days
  let eventDays = buildEventDays(events);
  console.log(`Built ${eventDays.length} event days`);

  // 3. Prune outliers (before scoring)
  eventDays = pruneIndividualOutliers(eventDays);
  eventDays = pruneEventDayOutliers(eventDays);

  // 4. Compute iterative RANK scores (recursive pairwise comparison)
  const { scores, driverNames } = computeRankScores(eventDays);

  // 5. Load driver registry for metadata
  const registry = loadRegistry();

  // 6. Collect per-driver results for metrics
  const driverResults = new Map();
  for (const day of eventDays) {
    for (const result of day.results) {
      if (!driverResults.has(result.driverName)) {
        driverResults.set(result.driverName, []);
      }
      driverResults.get(result.driverName).push({
        ...result,
        normalizedPosition: result.position / day.results.length,
        fieldSize: day.results.length,
      });
    }
  }

  // 7. Compute per-year percentile scores (needs all drivers' results at once)
  const yearPercentiles = computeAllYearScores(driverResults);

  // 8. Build final rankings
  const rankings = [];
  const now = new Date();

  for (const [driverName, rawScore] of scores) {
    const results = driverResults.get(driverName) || [];
    const eventCount = new Set(results.map(r => r.eventCode)).size;

    // Apply limited data penalty
    const penalizedScore = applyLimitedDataPenalty(rawScore, eventCount);

    const consistency = computeConsistency(results);
    const trend = computeTrend(results, now);
    const dataPoints = computeDataPoints(driverName, eventDays);

    // Get classes from most recent events (not most frequent!)
    const recentClasses = getRecentClasses(results);
    const primaryClass = recentClasses[0] || '';
    const allClasses = recentClasses; // Only show recent classes

    // Per-year score breakdowns (percentile-based, aligned with overall RANK)
    const yearScores = {};
    for (const [year, percentileMap] of yearPercentiles) {
      const pct = percentileMap.get(driverName);
      if (pct !== undefined) yearScores[year] = pct;
    }

    // Find region from registry or results
    const registryEntry = Object.values(registry).find(d => d.normalizedName === driverName);
    const region = registryEntry?.regions?.[0] || results[0]?.region || '';

    rankings.push({
      driverName,
      displayName: driverNames.get(driverName) || driverName,
      driverId: registryEntry?.id || driverName.replace(/[^a-z0-9]/g, '-'),
      rawScore: penalizedScore, // Internal score for percentile calculation
      score: 0, // Will be set by normalizeToPercentile
      rank: 0,  // Will be assigned after sorting
      primaryClass,
      allClasses,
      region,
      consistency,
      trend,
      dataPoints,
      eventCount,
      yearScores, // e.g. { 2021: 95, 2022: 98, 2023: 97, 2024: 100 }
      lastEvent: results.reduce((latest, r) =>
        r.eventDate > latest ? r.eventDate : latest, new Date(0)
      ).toISOString(),
    });
  }

  // 9. Normalize to 0-100 percentile scale (matching reference spreadsheet)
  normalizeToPercentile(rankings);

  // 10. Assign ranks (already sorted by normalizeToPercentile)
  rankings.forEach((r, i) => r.rank = i + 1);

  // Clean up internal field
  rankings.forEach(r => delete r.rawScore);

  // Save rankings
  writeFileSync(OUTPUT_FILE, JSON.stringify(rankings, null, 2));
  console.log(`\nRankings computed for ${rankings.length} drivers`);
  console.log(`Top 20:`);
  rankings.slice(0, 20).forEach(r => {
    const yearStr = Object.entries(r.yearScores).map(([y, s]) => `${y}:${s}`).join(' ');
    console.log(`  ${r.rank}. ${r.displayName} (${r.primaryClass}) - RANK ${r.score} [${r.trend}] C:${r.consistency} DP:${r.dataPoints} | ${yearStr}`);
  });

  return rankings;
}

// Main
if (process.argv[1] && process.argv[1].includes('rank-algorithm')) {
  computeRankings().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

export { computeRankings };
