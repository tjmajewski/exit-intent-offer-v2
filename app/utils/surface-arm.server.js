// =============================================================================
// OPENING-SURFACE ARM (build plan phase 7a — Enterprise, flag-gated)
//
// The modal has always been touch 1; the pill and cart surfaces were only
// dismissal recovery. This module makes the OPENING surface itself a learned
// two-arm bandit: for some visitors a quiet bottom-corner pill ("Still want
// your 15% off?") converts as well as a full-screen interruption — and costs
// far less annoyance. That is the escalation ladder's L1 rung.
//
// Arms are scored from the journey log (VisitorTouch): every server-written
// opening 'shown' touch (surface modal|pill) is an arm pull; a 'converted'
// touch for the same visitor within 24h is the reward. Aggregated per
// (shop, device) by the threshold-learning cron into a MetaLearningInsights
// row; served with Thompson Sampling + a fixed exploration floor so the pill
// arm accumulates data even while modal is winning.
//
// Escalation (7b) lives client-side: an ignored opener-pill escalates to the
// full modal on the visitor's next exit signal (min 60s gap), once.
// =============================================================================

import jStat from 'jstat';
import { writeClusterInsight } from './cluster-priors.server.js';
import { deviceKeyFromSegmentKey } from './segment-key.js';

export const SURFACE_ARM_INSIGHT_TYPE = 'surface_arm_stats';

// Below this many outcomes per arm, the pill is served at the exploration
// rate only (modal stays the default opener).
export const MIN_ARM_OUTCOMES = 20;

// Fraction of eligible decisions that open with the pill during cold start /
// as the permanent exploration floor.
export const PILL_EXPLORATION_RATE = 0.10;

const STATS_MAX_AGE_DAYS = 14;
const CONVERSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Choose the opening surface. Deterministic contract: returns 'modal' or
 * 'pill'. With mature arms, Thompson-sample both CVRs; otherwise explore
 * the pill at a fixed floor.
 */
export function chooseOpeningSurface(stats) {
  const m = stats?.modal;
  const p = stats?.pill;
  const mature = m && p && m.shown >= MIN_ARM_OUTCOMES && p.shown >= MIN_ARM_OUTCOMES;

  if (!mature) {
    return Math.random() < PILL_EXPLORATION_RATE ? 'pill' : 'modal';
  }

  const modalSample = jStat.beta.sample(m.converted + 1, (m.shown - m.converted) + 1);
  const pillSample = jStat.beta.sample(p.converted + 1, (p.shown - p.converted) + 1);

  // Exploration floor: keep feeding the losing arm
  if (Math.random() < PILL_EXPLORATION_RATE) {
    return modalSample > pillSample ? 'pill' : 'modal';
  }
  return pillSample > modalSample ? 'pill' : 'modal';
}

// ---------------------------------------------------------------------------
// Serve-time loader (10-min cache, same pattern as discount-arm)
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = new Map();

export function clearSurfaceArmCache() {
  cache = new Map();
}

export async function getSurfaceArmStats(db, shopId, deviceType) {
  const device = deviceType === 'mobile' || deviceType === 'desktop' ? deviceType : 'all';
  const segment = `${shopId}::${device}`;
  const hit = cache.get(segment);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

  let value = null;
  try {
    const row = await db.metaLearningInsights.findFirst({
      where: { insightType: SURFACE_ARM_INSIGHT_TYPE, segment },
      orderBy: { lastUpdated: 'desc' }
    });
    if (row && Date.now() - row.lastUpdated.getTime() < STATS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
      value = JSON.parse(row.data);
    }
  } catch (e) {
    console.error(`[Surface Arm] Load failed (${segment}):`, e.message);
  }
  if (cache.size > 2000) cache = new Map();
  cache.set(segment, { value, fetchedAt: Date.now() });
  return value;
}

// ---------------------------------------------------------------------------
// Cron-side builder: journey touches -> per-device arm stats.
// Pure sessionization helper exported for tests.
// ---------------------------------------------------------------------------

/**
 * Given one visitor's touches (ordered by timestamp), return arm pulls:
 * every server-written opening (surface modal|pill, response shown) paired
 * with whether a converted touch followed within 24h.
 *
 * Escalation correction: when a pill opener escalates to the modal
 * ('modal:escalated' touch), the pill's conversion window is CAPPED at the
 * escalation, and the escalation itself becomes a modal pull. Without this,
 * post-escalation conversions credit the pill and the arm learns that
 * annoying-then-converting equals a quiet win.
 */
export function scoreVisitorTouches(touches) {
  const pulls = [];
  const conversions = touches.filter(t => t.response === 'converted');
  const escalations = touches.filter(t => t.response === 'escalated' && t.surface === 'modal');

  const convertedIn = (startMs, endMs) => conversions.some(c => {
    const cts = new Date(c.timestamp).getTime();
    return cts >= startMs && cts <= endMs;
  });

  for (const t of touches) {
    const ts = new Date(t.timestamp).getTime();
    const device = deviceKeyFromSegmentKey(t.segmentKey || '')?.slice(2) || 'all';

    // Escalated modal = a modal pull (the modal is now doing the converting).
    // Client-reported escalations carry no segmentKey — inherit the device
    // from the pill opener that preceded them.
    if (t.response === 'escalated' && t.surface === 'modal') {
      const openerPill = [...touches].reverse().find(p => {
        return p.response === 'shown' && p.surface === 'pill' &&
          new Date(p.timestamp).getTime() <= ts;
      });
      const escDevice = openerPill
        ? (deviceKeyFromSegmentKey(openerPill.segmentKey || '')?.slice(2) || 'all')
        : device;
      pulls.push({ surface: 'modal', device: escDevice, converted: convertedIn(ts, ts + CONVERSION_WINDOW_MS) });
      continue;
    }

    if (t.response !== 'shown') continue;
    if (t.surface !== 'modal' && t.surface !== 'pill') continue;

    // Pill pulls stop earning credit at the moment they escalated
    let windowEnd = ts + CONVERSION_WINDOW_MS;
    if (t.surface === 'pill') {
      const esc = escalations.find(e => {
        const ets = new Date(e.timestamp).getTime();
        return ets >= ts && ets <= windowEnd;
      });
      if (esc) windowEnd = new Date(esc.timestamp).getTime();
    }

    pulls.push({ surface: t.surface, device, converted: convertedIn(ts, windowEnd) });
  }
  return pulls;
}

export async function rebuildSurfaceArmStats(db, shopId) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const touches = await db.visitorTouch.findMany({
    where: {
      shopId,
      timestamp: { gte: since },
      response: { in: ['shown', 'converted', 'escalated'] }
    },
    orderBy: { timestamp: 'asc' },
    select: { visitorId: true, surface: true, response: true, segmentKey: true, timestamp: true }
  });
  if (touches.length === 0) return 0;

  const byVisitor = new Map();
  for (const t of touches) {
    if (!byVisitor.has(t.visitorId)) byVisitor.set(t.visitorId, []);
    byVisitor.get(t.visitorId).push(t);
  }

  // device -> { modal: {shown, converted}, pill: {shown, converted} }
  const arms = new Map();
  const bump = (device, surface, converted) => {
    if (!arms.has(device)) {
      arms.set(device, {
        modal: { shown: 0, converted: 0 },
        pill: { shown: 0, converted: 0 }
      });
    }
    const a = arms.get(device)[surface];
    a.shown += 1;
    if (converted) a.converted += 1;
  };

  for (const visitorTouches of byVisitor.values()) {
    for (const pull of scoreVisitorTouches(visitorTouches)) {
      bump(pull.device, pull.surface, pull.converted);
      bump('all', pull.surface, pull.converted); // pooled fallback arm
    }
  }

  let written = 0;
  for (const [device, stats] of arms) {
    const total = stats.modal.shown + stats.pill.shown;
    if (total === 0) continue;
    await writeClusterInsight(
      db, SURFACE_ARM_INSIGHT_TYPE, `${shopId}::${device}`,
      stats, total,
      Math.min(stats.modal.shown, stats.pill.shown) >= MIN_ARM_OUTCOMES ? 0.9 : 0.3
    );
    written++;
  }
  return written;
}
