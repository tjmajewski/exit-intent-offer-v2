// Pro lift upsell — device-conditional "detect but don't act" (Sprint 3 #5).
//
// Enterprise personalizes offers by device via partial-pool priors on existing
// segments. Pro does not. This module analyzes a Pro store's OWN impression
// data, splits it by device, and detects when device cohorts prefer DIFFERENT
// modal templates — i.e. the store is leaving conversion on the table by
// serving every device the same layout. It quantifies that gap into an
// "upgrade to Enterprise" nudge.
//
// HARD RULE (handoff): the lift figure must come from the store's real
// device-split data. If there isn't enough, we return a QUALITATIVE nudge —
// never a fabricated %. With no divergence at all we return null (no card).

const WINDOW_DAYS = 30;

// Data gates before we'll quantify anything.
const MIN_PER_DEVICE_IMPRESSIONS = 60;   // a device cohort must clear this to count
const MIN_PER_TEMPLATE_IMPRESSIONS = 20;  // a (device,template) cell needs this to rank
const MIN_QUALIFYING_DEVICES = 2;         // need >=2 cohorts to compare
const MIN_LIFT_PCT = 5;                   // below this the gap isn't worth a card

const DEVICE_LABELS = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

/**
 * @returns {Promise<null | {
 *   kind: 'quantitative' | 'qualitative',
 *   liftPct?: string,            // quantitative only, e.g. "12.3"
 *   cohorts: Array<{ device, deviceLabel, bestTemplate, bestTemplateLabel, cvr, impressions }>,
 *   globalBestTemplate: string,
 *   message: string
 * }>}
 */
export async function computeDeviceLiftUpsell(prisma, shopId, layoutNameOf = (id) => id) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.variantImpression.findMany({
    where: { shopId, timestamp: { gte: since }, deviceType: { not: null } },
    select: {
      converted: true,
      deviceType: true,
      variant: { select: { templateId: true } }
    }
  });

  if (rows.length === 0) return null;

  // device → template → { i, c }, plus device totals and pooled-per-template.
  const byDevice = new Map();
  const deviceTotal = new Map();
  const pooled = new Map(); // templateId → { i, c } across all devices

  for (const r of rows) {
    const d = r.deviceType;
    const tid = r.variant?.templateId;
    if (!d || !tid) continue;
    if (!byDevice.has(d)) byDevice.set(d, new Map());
    bump(byDevice.get(d), tid, r.converted);
    deviceTotal.set(d, (deviceTotal.get(d) || 0) + 1);
    bump(pooled, tid, r.converted);
  }

  // Pooled global winner = highest-CVR template across the whole store (with
  // enough data). This is what a single non-personalized layout would default
  // to — the baseline Enterprise improves on.
  const globalBest = bestTemplate(pooled, MIN_PER_TEMPLATE_IMPRESSIONS * MIN_QUALIFYING_DEVICES);

  // Per-device winners among cohorts that clear the impression gate.
  const cohorts = [];
  for (const [device, total] of deviceTotal) {
    if (total < MIN_PER_DEVICE_IMPRESSIONS) continue;
    const tmap = byDevice.get(device);
    const best = bestTemplate(tmap, MIN_PER_TEMPLATE_IMPRESSIONS);
    if (!best) continue;
    cohorts.push({
      device,
      deviceLabel: DEVICE_LABELS[device] || cap(device),
      bestTemplate: best.templateId,
      bestTemplateLabel: layoutNameOf(best.templateId),
      cvr: best.cvr,
      impressions: total
    });
  }

  if (cohorts.length < MIN_QUALIFYING_DEVICES) return null;

  // Divergence: do cohorts actually prefer different layouts? If every device's
  // winner is the same template, device personalization buys nothing.
  const distinctWinners = new Set(cohorts.map((c) => c.bestTemplate));
  if (distinctWinners.size < 2) return null;

  // ---- Quantify the lift the store is leaving on the table ----
  // Personalized = each cohort served its OWN best template.
  // Baseline     = each cohort served the GLOBAL best template (its CVR within
  //                that cohort). Both use the cohort's real data.
  let canQuantify = !!globalBest;
  let personalizedConv = 0;
  let baselineConv = 0;

  if (canQuantify) {
    for (const c of cohorts) {
      const tmap = byDevice.get(c.device);
      const baseCell = tmap.get(globalBest.templateId);
      // Need the global-winner's performance within this cohort to compare.
      if (!baseCell || baseCell.i < MIN_PER_TEMPLATE_IMPRESSIONS) {
        canQuantify = false;
        break;
      }
      personalizedConv += c.impressions * c.cvr;
      baselineConv += c.impressions * (baseCell.c / baseCell.i);
    }
  }

  if (canQuantify && baselineConv > 0) {
    const liftPct = ((personalizedConv - baselineConv) / baselineConv) * 100;
    if (liftPct >= MIN_LIFT_PCT) {
      const lead = cohorts
        .map((c) => `${c.deviceLabel} prefers ${c.bestTemplateLabel}`)
        .join('; ');
      return {
        kind: 'quantitative',
        liftPct: liftPct.toFixed(1),
        cohorts,
        globalBestTemplate: globalBest.templateId,
        message: `Your shoppers split by device: ${lead}. Serving every device the same layout leaves about ${liftPct.toFixed(0)}% conversion on the table. Enterprise personalizes layout by device automatically.`
      };
    }
    // Divergence exists but the modeled gap is small — no card.
    return null;
  }

  // Divergence detected but not enough data to put a number on it → qualitative.
  const lead = cohorts
    .map((c) => `${c.deviceLabel} leans toward ${c.bestTemplateLabel}`)
    .join('; ');
  return {
    kind: 'qualitative',
    cohorts,
    globalBestTemplate: globalBest ? globalBest.templateId : null,
    message: `Your devices are behaving differently: ${lead}. Once there's more traffic we can quantify the gain — Enterprise personalizes layout by device automatically.`
  };
}

function bump(map, key, converted) {
  if (!map.has(key)) map.set(key, { i: 0, c: 0 });
  const b = map.get(key);
  b.i += 1;
  if (converted) b.c += 1;
}

// Highest-CVR template in a map, requiring minImp impressions to qualify.
function bestTemplate(tmap, minImp) {
  let best = null;
  for (const [templateId, b] of tmap) {
    if (b.i < minImp) continue;
    const cvr = b.c / b.i;
    if (!best || cvr > best.cvr) best = { templateId, cvr, impressions: b.i };
  }
  return best;
}

function cap(s) {
  return typeof s === 'string' && s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
