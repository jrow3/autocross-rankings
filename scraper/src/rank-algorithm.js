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
// RATING Algorithm Implementation
//
// RATING (Relative Autocross Time Index Normalized Grade) compiles results
// from all national competitions and makes recursive comparisons of the
// quality of the competitors above and below each competitor. Finishing
// above strong competitors is increasingly beneficial, while finishing
// below weak competitors is increasingly detrimental.
//
// Pipeline:
// 1. Compile PAX-indexed results from all national events
// 2. Prune ~3% individual outliers (car failure, no clean runs, etc.)
// 3. Prune ~5% event day outliers (rain, changing conditions)
// 4. For each event day, create pairwise comparisons between all drivers
// 5. Recursively weight wins/losses by opponent quality (iterative)
// 6. Weight results by recency (plateau + slow decay model)
// 7. Apply limited data penalty (smooth curve)
// 8. Normalize to 0-100 percentile scale
// 9. Compute per-year breakdowns using same pairwise engine
// 10. Compute consistency, trend, data points, confidence
// ============================================================

// --- Core algorithm constants ---
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_ITERATIONS = 100;
const INITIAL_SCORE = 1000;

// Recency: plateau at full strength, then slow decay with a floor.
// 0-3 years: 100% weight. 3+ years: half-life of 5 years. Never below 15%.
const RECENCY_FULL_STRENGTH_YEARS = 3;
const RECENCY_DECAY_HALF_LIFE_YEARS = 5;
const RECENCY_FLOOR = 0.15;

// Margin: log-ratio with tanh softcap (smooth S-curve, no hard cliff)
const MARGIN_SCALE = 15;
const MARGIN_SOFTCAP = 3.0;

// Pairwise scoring
const NATIONALS_WEIGHT = 1.5;
const LOSS_WEIGHT_FACTOR = 0.4;

// Outlier pruning: PAX time ratio + MAD
const PRUNE_ZSCORE = 2.0;

// Limited data penalty: smooth squared curve
const LIMITED_DATA_PENALTY_MAX = 0.25;
const LIMITED_DATA_THRESHOLD = 10;

const RECENT_CLASSES_COUNT = 3;

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

// Calculate recency weight for an event using plateau + slow decay model.
// 0-3 years: full weight. 3+ years: 5-year half-life. Floor at 15%.
function recencyWeight(eventDate, now = new Date()) {
  const yearsAgo = (now - eventDate) / (1000 * 60 * 60 * 24 * 365.25);
  if (yearsAgo <= RECENCY_FULL_STRENGTH_YEARS) return 1.0;
  const decayYears = yearsAgo - RECENCY_FULL_STRENGTH_YEARS;
  const decayed = Math.pow(0.5, decayYears / RECENCY_DECAY_HALF_LIFE_YEARS);
  return Math.max(RECENCY_FLOOR, decayed);
}

// Prune individual outlier results (~3% target)
// Uses PAX time ratio + MAD (Median Absolute Deviation) for robust detection.
// PAX time ratio is universal regardless of field size, and MAD resists
// being pulled by the very outliers we're trying to detect.
function pruneIndividualOutliers(eventDays) {
  const driverResults = new Map();

  for (const day of eventDays) {
    const sortedResults = [...day.results].sort((a, b) => a.paxTime - b.paxTime);
    const bestTime = sortedResults[0]?.paxTime || 1;

    for (const result of day.results) {
      if (!driverResults.has(result.driverName)) {
        driverResults.set(result.driverName, []);
      }
      driverResults.get(result.driverName).push({
        dayId: day.id,
        driverName: result.driverName,
        timeRatio: result.paxTime / bestTime,
      });
    }
  }

  const prunedResultIds = new Set();

  for (const [driverName, results] of driverResults) {
    if (results.length < 3) continue;

    const ratios = results.map(r => r.timeRatio);
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // MAD (Median Absolute Deviation) scaled to be comparable to stddev
    const absDeviations = ratios.map(r => Math.abs(r - median));
    const sortedDeviations = [...absDeviations].sort((a, b) => a - b);
    const mad = sortedDeviations[Math.floor(sortedDeviations.length / 2)];
    const madScale = mad * 1.4826;

    if (madScale < 0.001) continue; // Very consistent driver, skip

    for (const r of results) {
      const modifiedZ = (r.timeRatio - median) / madScale;
      if (modifiedZ > PRUNE_ZSCORE) {
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
  const EVENT_PRUNE_ZSCORE = 1.5;

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

// Core pairwise RATING computation — extracted so it can be reused for
// both overall rankings and per-year rankings.
//
// options.useRecencyDecay: true for overall (weight by age), false for single-year
// options.now: reference date for recency calculation
function computeRankScoresForSubset(eventDays, options = {}) {
  const { useRecencyDecay = true, now = new Date() } = options;

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

  // Build pairwise comparisons with log-ratio margin scaling.
  // The tanh softcap gives a smooth S-curve: small gaps earn credit quickly,
  // large gaps asymptote to MARGIN_SOFTCAP. No hard cliff.
  const comparisons = [];

  for (const day of eventDays) {
    const eventTypeWeight = (day.eventType === 'nationals') ? NATIONALS_WEIGHT : 1.0;
    const recency = useRecencyDecay ? recencyWeight(day.eventDate, now) : 1.0;
    const baseWeight = recency * eventTypeWeight;

    // Field-size normalization: 1/sqrt(fieldSize)
    const fieldSize = day.results.length;
    const fieldNorm = 1 / Math.sqrt(fieldSize);
    const weight = baseWeight * fieldNorm;

    const results = [...day.results].sort((a, b) => a.paxTime - b.paxTime);

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const winner = results[i];
        const loser = results[j];

        // Log-ratio margin with tanh softcap
        const timeRatio = loser.paxTime / winner.paxTime;
        const logMargin = Math.log(timeRatio);
        const marginMultiplier = 1 + (MARGIN_SOFTCAP - 1) * Math.tanh(logMargin * MARGIN_SCALE);

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

  // Pre-compute total comparison weight per driver for normalization
  const driverTotalWeight = new Map();
  for (const comp of comparisons) {
    const w = comp.weight * comp.marginMultiplier;
    driverTotalWeight.set(comp.winner, (driverTotalWeight.get(comp.winner) || 0) + w);
    driverTotalWeight.set(comp.loser, (driverTotalWeight.get(comp.loser) || 0) + w);
  }

  // Iterative convergence (recursive quality propagation)
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const newScores = new Map();
    const driverAccum = new Map();

    for (const [driver] of scores) {
      driverAccum.set(driver, 0);
    }

    for (const comp of comparisons) {
      const winnerScore = scores.get(comp.winner) || INITIAL_SCORE;
      const loserScore = scores.get(comp.loser) || INITIAL_SCORE;

      const winValue = (loserScore / INITIAL_SCORE) * comp.weight * comp.marginMultiplier;
      const lossValue = -(winnerScore / INITIAL_SCORE) * comp.weight * LOSS_WEIGHT_FACTOR * comp.marginMultiplier;

      driverAccum.set(comp.winner, (driverAccum.get(comp.winner) || 0) + winValue);
      driverAccum.set(comp.loser, (driverAccum.get(comp.loser) || 0) + lossValue);
    }

    for (const [driver, accum] of driverAccum) {
      const totalWeight = driverTotalWeight.get(driver) || 1;
      newScores.set(driver, (accum / totalWeight) * INITIAL_SCORE + INITIAL_SCORE);
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
      if (useRecencyDecay) {
        console.log(`Converged after ${iter + 1} iterations (max delta: ${maxDelta.toFixed(6)})`);
      }
      break;
    }

    if (useRecencyDecay && (iter + 1) % 10 === 0) {
      console.log(`  Iteration ${iter + 1}: max delta = ${maxDelta.toFixed(4)}`);
    }
  }

  return { scores, driverNames, totalComparisons: comparisons.length };
}

// Overall RATING computation — delegates to subset engine with recency decay enabled
function computeRankScores(eventDays) {
  const now = new Date();
  console.log(`Computing RATING for event days across all years...`);
  const result = computeRankScoresForSubset(eventDays, { useRecencyDecay: true, now });
  console.log(`Computed scores for ${result.scores.size} drivers`);
  return result;
}

// Inverse normal CDF (probit function) — Abramowitz & Stegun approximation.
function probit(p) {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  if (p < 0.5) return -probit(1 - p);
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

// Normalize raw scores to 0-100 using quantile normalization to a normal distribution.
function normalizeToPercentile(rankings) {
  const n = rankings.length;
  if (n === 0) return;

  rankings.sort((a, b) => b.rawScore - a.rawScore);

  if (n === 1) {
    rankings[0].score = 100;
    return;
  }

  const percentiles = rankings.map((_, i) => {
    const raw = (n - 1 - i) / n;
    return Math.max(0.0001, Math.min(0.9999, raw));
  });

  const zScores = percentiles.map(p => probit(p));

  const FLATTEN_EXPONENT = 0.85;
  const flatZ = zScores.map(z =>
    Math.sign(z) * Math.pow(Math.abs(z), FLATTEN_EXPONENT)
  );

  const maxZ = flatZ[0];
  const minZ = flatZ[n - 1];
  const zRange = maxZ - minZ || 1;

  for (let i = 0; i < n; i++) {
    const normalized = ((flatZ[i] - minZ) / zRange) * 100;
    rankings[i].score = Math.round(normalized);
  }
}

// Compute per-year RATING scores using the same pairwise engine as overall.
// This ensures yearly scores use the same methodology (opponent quality propagation,
// margin weighting, etc.) so they align with the overall ranking.
function computeAllYearScores(eventDays) {
  const years = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const yearPercentiles = new Map();

  for (const year of years) {
    const yearDays = eventDays.filter(d => d.eventDate.getFullYear() === year);
    if (yearDays.length === 0) continue;

    // Run the same pairwise engine but without recency decay
    // (all events within the same year are equally recent)
    const { scores } = computeRankScoresForSubset(yearDays, { useRecencyDecay: false });

    const yearRankings = [];
    for (const [driverName, rawScore] of scores) {
      yearRankings.push({ driverName, rawScore, score: 0 });
    }

    if (yearRankings.length === 0) continue;

    normalizeToPercentile(yearRankings);

    const percentileMap = new Map();
    for (const r of yearRankings) {
      percentileMap.set(r.driverName, r.score);
    }
    yearPercentiles.set(year, percentileMap);
  }

  return yearPercentiles;
}

// Compute consistency metric (1-5 bars)
function computeConsistency(driverResults) {
  if (driverResults.length < 2) return 3;

  const byEvent = new Map();
  for (const r of driverResults) {
    const existing = byEvent.get(r.eventCode);
    if (!existing || (r.fieldSize || 0) > (existing.fieldSize || 0)) {
      byEvent.set(r.eventCode, { ...r, _positions: [r.normalizedPosition], _count: 1 });
    } else if ((r.fieldSize || 0) === (existing.fieldSize || 0)) {
      existing._positions.push(r.normalizedPosition);
      existing._count++;
      existing.normalizedPosition = existing._positions.reduce((a, b) => a + b, 0) / existing._count;
    }
  }

  let dedupedResults = [...byEvent.values()];
  if (dedupedResults.length < 2) return 3;

  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const recentResults = dedupedResults.filter(r => r.eventDate >= threeYearsAgo);
  if (recentResults.length >= 3) {
    dedupedResults = recentResults;
  }

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

  if (iqr < 0.05) return 5;
  if (iqr < 0.12) return 4;
  if (iqr < 0.22) return 3;
  if (iqr < 0.35) return 2;
  return 1;
}

// Compute trend
function computeTrend(driverResults, now = new Date()) {
  const lastEvent = driverResults.reduce((latest, r) => {
    return r.eventDate > latest ? r.eventDate : latest;
  }, new Date(0));

  const daysSinceLastEvent = (now - lastEvent) / (1000 * 60 * 60 * 24);
  if (daysSinceLastEvent > 365) return 'absent';

  if (driverResults.length < 3) return 'steady';

  const sorted = [...driverResults].sort((a, b) => a.eventDate - b.eventDate);
  const n = sorted.length;

  const xs = sorted.map((r, i) => i);
  const ys = sorted.map(r => 1 - r.normalizedPosition);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  const denominator = xs.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0);
  if (denominator === 0) return 'steady';

  const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0) / denominator;

  if (slope > 0.05) return 'up3';
  if (slope > 0.02) return 'up1';
  if (slope < -0.05) return 'down2';
  if (slope < -0.02) return 'down1';
  return 'steady';
}

// Compute data points metric (1-5 bars based on unique competitors faced)
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
  if (count >= 1500) return 5;
  if (count >= 800) return 4;
  if (count >= 400) return 3;
  if (count >= 150) return 2;
  return 1;
}

// Compute confidence metric (1-5 bars)
// Combines event count, network breadth, recency, and consistency into
// a single "how sure are we about this ranking?" signal.
function computeConfidence(driverName, driverResults, eventDays, consistency) {
  // Factor 1: Event count (more events = more data)
  const uniqueEvents = new Set(driverResults.map(r => r.eventCode)).size;
  const eventScore = Math.min(uniqueEvents / 12, 1.0);

  // Factor 2: Unique competitors faced (network breadth)
  const competitorsFaced = new Set();
  for (const day of eventDays) {
    if (!day.results.find(r => r.driverName === driverName)) continue;
    for (const r of day.results) {
      if (r.driverName !== driverName) competitorsFaced.add(r.driverName);
    }
  }
  const networkScore = Math.min(competitorsFaced.size / 800, 1.0);

  // Factor 3: Recency (have they competed recently?)
  const lastEvent = driverResults.reduce((latest, r) =>
    r.eventDate > latest ? r.eventDate : latest, new Date(0));
  const yearsSinceLast = (new Date() - lastEvent) / (1000 * 60 * 60 * 24 * 365.25);
  const recencyScore = yearsSinceLast <= 2 ? 1.0 :
                       yearsSinceLast <= 5 ? 0.7 :
                       yearsSinceLast <= 8 ? 0.4 : 0.2;

  // Factor 4: Consistency (consistent drivers have more reliable rankings)
  const consistencyScore = consistency / 5;

  // Weighted combination
  const raw = eventScore * 0.35 + networkScore * 0.30 + recencyScore * 0.20 + consistencyScore * 0.15;

  if (raw >= 0.80) return 5;
  if (raw >= 0.60) return 4;
  if (raw >= 0.40) return 3;
  if (raw >= 0.25) return 2;
  return 1;
}

// Determine driver's classes from most recent events
function getRecentClasses(driverResults) {
  const sorted = [...driverResults]
    .filter(r => r.className)
    .sort((a, b) => b.eventDate - a.eventDate);

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

// Apply limited data penalty (smooth squared curve, no cliff)
function applyLimitedDataPenalty(score, eventCount) {
  if (eventCount >= LIMITED_DATA_THRESHOLD) return score;
  const fraction = eventCount / LIMITED_DATA_THRESHOLD;
  const penaltyFraction = LIMITED_DATA_PENALTY_MAX * Math.pow(1 - fraction, 2);
  return score * (1 - penaltyFraction);
}

// Main ranking pipeline
async function computeRankings() {
  console.log('=== RATING Algorithm ===\n');

  // 1. Load event data
  const events = loadEventData();
  console.log(`Loaded ${events.length} events`);

  // 2. Build event days
  let eventDays = buildEventDays(events);
  console.log(`Built ${eventDays.length} event days`);

  // 3. Prune outliers (before scoring)
  eventDays = pruneIndividualOutliers(eventDays);
  eventDays = pruneEventDayOutliers(eventDays);

  // 4. Compute iterative RATING scores (recursive pairwise comparison)
  const { scores, driverNames, totalComparisons } = computeRankScores(eventDays);

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

  // 7. Compute per-year scores using same pairwise engine
  console.log('Computing per-year scores...');
  const yearPercentiles = computeAllYearScores(eventDays);

  // 8. Build final rankings
  const rankings = [];
  const now = new Date();

  for (const [driverName, rawScore] of scores) {
    const results = driverResults.get(driverName) || [];
    const eventCount = new Set(results.map(r => r.eventCode)).size;

    // Apply limited data penalty (no inactivity penalty — recency model handles it)
    const penalizedScore = applyLimitedDataPenalty(rawScore, eventCount);

    const consistency = computeConsistency(results);
    const trend = computeTrend(results, now);
    const dataPoints = computeDataPoints(driverName, eventDays);
    const confidence = computeConfidence(driverName, results, eventDays, consistency);

    const recentClasses = getRecentClasses(results);
    const primaryClass = recentClasses[0] || '';
    const allClasses = recentClasses;

    const yearScores = {};
    for (const [year, percentileMap] of yearPercentiles) {
      const pct = percentileMap.get(driverName);
      if (pct !== undefined) yearScores[year] = pct;
    }

    const registryEntry = Object.values(registry).find(d => d.normalizedName === driverName);
    const region = registryEntry?.regions?.[0] || results[0]?.region || '';

    rankings.push({
      driverName,
      displayName: driverNames.get(driverName) || driverName,
      driverId: registryEntry?.id || driverName.replace(/[^a-z0-9]/g, '-'),
      rawScore: penalizedScore,
      score: 0,
      rank: 0,
      primaryClass,
      allClasses,
      region,
      consistency,
      trend,
      dataPoints,
      confidence,
      eventCount,
      yearScores,
      lastEvent: results.reduce((latest, r) =>
        r.eventDate > latest ? r.eventDate : latest, new Date(0)
      ).toISOString(),
    });
  }

  // 9. Normalize to 0-100 percentile scale
  normalizeToPercentile(rankings);

  // 10. Assign ranks
  rankings.forEach((r, i) => r.rank = i + 1);

  // Clean up internal field
  rankings.forEach(r => delete r.rawScore);

  // Save rankings
  writeFileSync(OUTPUT_FILE, JSON.stringify(rankings, null, 2));
  console.log(`\nRankings computed for ${rankings.length} drivers`);
  console.log(`Top 20:`);
  rankings.slice(0, 20).forEach(r => {
    const yearStr = Object.entries(r.yearScores).map(([y, s]) => `${y}:${s}`).join(' ');
    console.log(`  ${r.rank}. ${r.displayName} (${r.primaryClass}) - RATING ${r.score} [${r.trend}] C:${r.consistency} DP:${r.dataPoints} Conf:${r.confidence} | ${yearStr}`);
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
