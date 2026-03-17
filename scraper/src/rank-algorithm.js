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
// Based on the RANK (Relative Autocross Numerical Klassification) methodology:
// 1. Compile PAX-indexed results from all national events
// 2. For each event day, create pairwise comparisons between all drivers
// 3. Recursively weight wins/losses by opponent quality
// 4. Weight results by recency (exponential decay)
// 5. Prune statistical outliers (~3% individual, ~5% event day)
// 6. Iterate until convergence (like PageRank)
// ============================================================

const CONVERGENCE_THRESHOLD = 0.001;
const MAX_ITERATIONS = 100;
const INITIAL_SCORE = 1000;
const RECENCY_HALF_LIFE_DAYS = 365; // Recent results count more
const INDIVIDUAL_PRUNE_ZSCORE = 2.0; // Prune results >2 std devs below mean
const EVENT_PRUNE_ZSCORE = 1.8; // Prune event days with widespread poor results
const LIMITED_DATA_PENALTY_MAX = 0.05; // Up to 5% reduction for limited data
const LIMITED_DATA_THRESHOLD = 5; // Below this many events, apply penalty

// Load all event data and build comparison matrix
function loadEventData() {
  const eventFiles = readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
  const events = [];

  for (const file of eventFiles) {
    const event = JSON.parse(readFileSync(join(EVENTS_DIR, file), 'utf8'));
    events.push(event);
  }

  return events;
}

// Extract PAX-normalized results for each event day
// Returns array of "event days", each containing driver results normalized by PAX
function buildEventDays(events) {
  const eventDays = [];

  for (const event of events) {
    // Parse event date for recency weighting
    const dateMatch = (event.eventDates || '').match(/(\d{2}\/\d{2}\/\d{4})/);
    const eventDate = dateMatch ? new Date(dateMatch[1]) : new Date();

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
        // Calculate PAX time from raw best times if not directly available
        let paxTime = r.paxTime;
        if (!paxTime || paxTime === 0) {
          // Sum best course times and apply PAX
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

// Calculate recency weight for an event
function recencyWeight(eventDate, now = new Date()) {
  const daysDiff = (now - eventDate) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysDiff / RECENCY_HALF_LIFE_DAYS);
}

// Prune individual outlier results (~3%)
// Remove results where a driver performed significantly worse than their norm
function pruneIndividualOutliers(eventDays) {
  // First, collect all results per driver
  const driverResults = new Map();

  for (const day of eventDays) {
    for (const result of day.results) {
      if (!driverResults.has(result.driverName)) {
        driverResults.set(result.driverName, []);
      }
      driverResults.get(result.driverName).push({
        dayId: day.id,
        result,
        // Normalize: position / total drivers (0 = best, 1 = worst)
        normalizedPosition: result.position / day.results.length,
      });
    }
  }

  // For each driver, find outlier results
  const prunedResultIds = new Set();

  for (const [driverName, results] of driverResults) {
    if (results.length < 3) continue;

    const positions = results.map(r => r.normalizedPosition);
    const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
    const stdDev = Math.sqrt(positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / positions.length);

    if (stdDev === 0) continue;

    for (const r of results) {
      const zScore = (r.normalizedPosition - mean) / stdDev;
      // Prune results that are anomalously BAD (high z-score = much worse than normal)
      if (zScore > INDIVIDUAL_PRUNE_ZSCORE) {
        prunedResultIds.add(`${r.dayId}_${driverName}`);
      }
    }
  }

  // Remove pruned results
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

// Prune event days with widespread poor results (~5%)
// If many drivers had anomalously bad results on a day, likely bad conditions
function pruneEventDayOutliers(eventDays) {
  // For each event day, check if the median performance is an outlier
  // compared to other days at the same event
  const eventGroups = new Map();

  for (const day of eventDays) {
    const key = day.eventCode;
    if (!eventGroups.has(key)) eventGroups.set(key, []);
    eventGroups.get(key).push(day);
  }

  const prunedDays = new Set();

  // For now, we use a simpler approach: flag days where variance is unusually high
  for (const day of eventDays) {
    if (day.results.length < 5) continue;

    const positions = day.results.map(r => r.normalizedPosition || r.position / day.results.length);
    const times = day.results.map(r => r.paxTime).filter(t => t > 0);

    if (times.length < 5) continue;

    const meanTime = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((sum, t) => sum + Math.pow(t - meanTime, 2), 0) / times.length;
    const cv = Math.sqrt(variance) / meanTime; // Coefficient of variation

    // If CV is very high, conditions were likely variable (rain, etc.)
    if (cv > 0.15) {
      prunedDays.add(day.id);
    }
  }

  const before = eventDays.length;
  const filtered = eventDays.filter(d => !prunedDays.has(d.id));
  console.log(`Event day pruning: removed ${before - filtered.length} days (${((before - filtered.length) / before * 100).toFixed(1)}%)`);

  return filtered;
}

// Core RANK computation using iterative pairwise comparison
function computeRankScores(eventDays) {
  const now = new Date();

  // Initialize all driver scores
  const scores = new Map();
  const driverNames = new Map(); // normalized -> display name

  for (const day of eventDays) {
    for (const result of day.results) {
      if (!scores.has(result.driverName)) {
        scores.set(result.driverName, INITIAL_SCORE);
        driverNames.set(result.driverName, result.displayName);
      }
    }
  }

  console.log(`Computing RANK for ${scores.size} drivers across ${eventDays.length} event days...`);

  // Build pairwise comparison data
  // For each event day, every pair of drivers creates a comparison
  const comparisons = [];

  for (const day of eventDays) {
    const weight = recencyWeight(day.eventDate, now);
    const results = day.results.sort((a, b) => a.paxTime - b.paxTime);

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const winner = results[i]; // Lower PAX time = better
        const loser = results[j];

        // Margin of victory matters - closer results = less decisive
        const margin = (loser.paxTime - winner.paxTime) / winner.paxTime;

        comparisons.push({
          winner: winner.driverName,
          loser: loser.driverName,
          weight,
          margin: Math.min(margin, 0.3), // Cap margin effect
          dayId: day.id,
        });
      }
    }
  }

  console.log(`Built ${comparisons.length} pairwise comparisons`);

  // Iterative convergence
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const newScores = new Map();

    // Initialize with small base score
    for (const [driver] of scores) {
      newScores.set(driver, 100); // Base score
    }

    // Apply pairwise comparisons
    for (const comp of comparisons) {
      const winnerScore = scores.get(comp.winner) || INITIAL_SCORE;
      const loserScore = scores.get(comp.loser) || INITIAL_SCORE;

      // Beating a strong opponent (high score) is worth more
      // Losing to a weak opponent (low score) costs more
      const winValue = (loserScore / INITIAL_SCORE) * comp.weight * (1 + comp.margin);
      const lossValue = -(winnerScore / INITIAL_SCORE) * comp.weight * 0.3; // Losses weighted less than wins

      newScores.set(comp.winner, (newScores.get(comp.winner) || 0) + winValue);
      newScores.set(comp.loser, (newScores.get(comp.loser) || 0) + lossValue);
    }

    // Normalize scores to keep them centered around INITIAL_SCORE
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

    // Update scores
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

// Compute consistency metric (lower = more consistent)
function computeConsistency(driverResults) {
  if (driverResults.length < 2) return 1.0;

  const positions = driverResults.map(r => r.normalizedPosition);
  const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
  const variance = positions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / positions.length;

  // Return coefficient of variation (0 = perfectly consistent, 1+ = inconsistent)
  return mean > 0 ? Math.sqrt(variance) / mean : 1.0;
}

// Compute trend (improving, steady, declining, absent)
function computeTrend(driverResults, now = new Date()) {
  // Check if driver has been active in last year
  const lastEvent = driverResults.reduce((latest, r) => {
    return r.eventDate > latest ? r.eventDate : latest;
  }, new Date(0));

  const daysSinceLastEvent = (now - lastEvent) / (1000 * 60 * 60 * 24);
  if (daysSinceLastEvent > 365) return 'absent';

  if (driverResults.length < 3) return 'steady';

  // Simple linear regression of normalized position over time
  const sorted = [...driverResults].sort((a, b) => a.eventDate - b.eventDate);
  const n = sorted.length;

  const xs = sorted.map((r, i) => i);
  const ys = sorted.map(r => 1 - r.normalizedPosition); // Invert so higher = better

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0) /
    xs.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0);

  if (slope > 0.05) return 'up2';    // Strong improvement
  if (slope > 0.02) return 'up1';    // Moderate improvement
  if (slope < -0.05) return 'down2'; // Strong decline
  if (slope < -0.02) return 'down1'; // Moderate decline
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
  if (count >= 500) return 5;
  if (count >= 200) return 4;
  if (count >= 100) return 3;
  if (count >= 30) return 2;
  return 1;
}

// Apply limited data penalty
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

  // 3. Prune outliers
  eventDays = pruneIndividualOutliers(eventDays);
  eventDays = pruneEventDayOutliers(eventDays);

  // 4. Compute RANK scores
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
      });
    }
  }

  // 7. Build final rankings
  const rankings = [];
  const now = new Date();

  for (const [driverName, rawScore] of scores) {
    const results = driverResults.get(driverName) || [];
    const eventCount = new Set(results.map(r => r.eventCode)).size;

    // Apply limited data penalty
    const score = applyLimitedDataPenalty(rawScore, eventCount);

    const consistency = computeConsistency(results);
    const trend = computeTrend(results, now);
    const dataPoints = computeDataPoints(driverName, eventDays);

    // Find primary class (most frequent)
    const classCounts = {};
    for (const r of results) {
      classCounts[r.className] = (classCounts[r.className] || 0) + 1;
    }
    const primaryClass = Object.entries(classCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Find region from registry or results
    const registryEntry = Object.values(registry).find(d => d.normalizedName === driverName);
    const region = registryEntry?.regions?.[0] || results[0]?.region || '';

    rankings.push({
      driverName,
      displayName: driverNames.get(driverName) || driverName,
      driverId: registryEntry?.id || driverName.replace(/[^a-z0-9]/g, '-'),
      score: Math.round(score * 10) / 10,
      rank: 0, // Will be assigned after sorting
      primaryClass,
      allClasses: [...new Set(results.map(r => r.className))],
      region,
      consistency: Math.round(consistency * 1000) / 1000,
      trend,
      dataPoints,
      eventCount,
      lastEvent: results.reduce((latest, r) =>
        r.eventDate > latest ? r.eventDate : latest, new Date(0)
      ).toISOString(),
    });
  }

  // Sort by score descending and assign ranks
  rankings.sort((a, b) => b.score - a.score);
  rankings.forEach((r, i) => r.rank = i + 1);

  // Save rankings
  writeFileSync(OUTPUT_FILE, JSON.stringify(rankings, null, 2));
  console.log(`\nRankings computed for ${rankings.length} drivers`);
  console.log(`Top 10:`);
  rankings.slice(0, 10).forEach(r => {
    console.log(`  ${r.rank}. ${r.displayName} (${r.primaryClass}) - ${r.score} [${r.trend}]`);
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
