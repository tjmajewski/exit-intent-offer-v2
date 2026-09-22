// Plain-English read of a stored AIDecision row.
//
// The DB keeps the raw JSON (queries depend on it, and the console still shows
// it behind the "raw JSON" toggle). This module exists only so a human looking
// at the customer page sees a sentence instead of a serialized object.
//
// Every writer of AIDecision.decision is covered here:
//   apps.exit-intent.api.ai-decision.jsx  percentage | fixed | threshold |
//                                         no-discount | no_intervention |
//                                         holdout | budget-exhausted
//   webhooks.carts.update.jsx             same shapes + source: cart_webhook
//   utils/idle-cart-pickup.server.js      same shapes + source: idle_cart_pickup
// An unrecognized type degrades to the raw type string — never to a crash.

import { fmtDate } from "../../utils/format.js";

function money(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return `$${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}`;
}

// Types whose amount is 0 by definition and which have their own label below.
const UNINSTRUMENTED_TYPES = new Set(["no_intervention", "holdout", "budget-exhausted"]);

function outcomeOf(decision) {
  const amount = decision.amount;

  // Gate on the OUTCOME, not the type. A margin-guarded or floored offer keeps
  // its original type (`percentage` / `fixed` / `threshold`) with amount 0, so
  // keying the no-offer labels on `type === "no-discount"` rendered those as
  // "0% off" with a success badge — the opposite of what happened.
  // Types with their own canonical label below take it, even when they also
  // carry a suppression record. budget-exhausted does: without this guard its
  // badge read the generic "a cap bound" while whyOf — which already excludes
  // the type — printed the specific budget sentence, so label and reason
  // disagreed on the same row. Keep the two exclusion lists in step.
  const kind = UNINSTRUMENTED_TYPES.has(decision.type)
    ? null
    : decision.offerSuppression?.kind;
  if (kind) {
    if (kind === "failure") return { label: "Reminder only — offer failed", tone: "critical" };
    if (kind === "exploration") return { label: "Reminder only — still testing", tone: "attention" };
    if (kind === "config") return { label: "Reminder only — store setting", tone: "warning" };
    if (kind === "limit") return { label: "Reminder only — a cap bound", tone: "warning" };
    if (kind === "judgement") return { label: "Reminder only — chose not to discount", tone: "info" };
  }

  // A zero-amount offer with no suppression record. Only the live decision path
  // writes those records, so "missing" usually means the row came from
  // somewhere else or predates the feature — not that a path needs
  // instrumenting. Flagging all of those amber buried the real gaps under the
  // entire historical corpus.
  if (amount === 0 && !UNINSTRUMENTED_TYPES.has(decision.type)) {
    const knownWriter = decision.source === "cart_webhook" || decision.source === "idle_cart_pickup";
    if (decision.type === "no-discount" || knownWriter) {
      return { label: "Reminder only, no discount", tone: "info" };
    }
    // A typed offer (percentage/fixed/threshold) that served nothing and left
    // no record IS a genuine gap in the live path. This is the narrow case the
    // amber badge was meant for.
    return { label: "Reminder only — reason not recorded", tone: "attention" };
  }

  // A pre-decision, not something a shopper saw. These writers mint a
  // recommendation ahead of any visit — the cart webhook's rows in particular
  // now carry a real offer rather than 'no_intervention', because the
  // accidental-visit skip no longer fires on their sentinel signals. Rendering
  // "15% off" with a success badge would imply an impression that never
  // happened, on a path that shows no modal at all.
  if (decision.source === "cart_webhook" || decision.source === "idle_cart_pickup") {
    const offer = amount > 0
      ? (decision.type === "percentage" ? `${amount}% off` : `${money(amount)} off`)
      : "no discount";
    return { label: `Pre-decided: ${offer} (not shown yet)`, tone: "info" };
  }

  switch (decision.type) {
    case "percentage":
      return { label: `${amount}% off`, tone: "success" };
    case "fixed":
      return { label: `${money(amount)} off`, tone: "success" };
    case "threshold":
      return {
        label: decision.threshold
          ? `${money(amount)} off orders over ${money(decision.threshold)}`
          : `${money(amount)} off`,
        tone: "success",
      };
    case "no-discount":
      // Reached only by decisions minted before offerSuppression existed.
      return { label: "Reminder only, no discount", tone: "info" };
    case "no_intervention":
      return { label: "Showed nothing", tone: undefined };
    case "holdout":
      return { label: "Holdout — nothing shown", tone: "attention" };
    case "budget-exhausted":
      return { label: "Blocked — budget spent", tone: "warning" };
    default:
      return { label: String(decision.type || "unknown"), tone: undefined };
  }
}

// The engine writes reasoning as an internal string ("Conversion mode (P=30):
// 17% discount (margin-protected)"). Rewrite the known ones; pass anything
// else through so a new reasoning string still shows up rather than vanishing.
function whyOf(decision, propensity) {
  const reasoning = String(decision.reasoning || "");
  const P = propensity;
  const intent = P === null ? "" : ` Buy-intent scored ${P} out of 100.`;

  // When a suppression record exists it is the most specific answer available —
  // it names the branch that actually zeroed the offer, rather than inferring
  // from a reasoning string written for a different purpose.
  // These have their own canonical wording below and must not be overwritten
  // by a generic suppression line.
  const sup = ["holdout", "no_intervention", "budget-exhausted"].includes(decision.type)
    ? null
    : decision.offerSuppression;
  if (sup && sup.detail) {
    const PREFIX = {
      judgement: "Chose not to discount",
      exploration: "Withheld to keep testing",
      config: "A store setting stopped the discount",
      limit: "A cap stopped the discount",
      failure: "The offer did not make it to the shopper",
    };
    const prefix = PREFIX[sup.kind] || "No discount";
    return `${prefix}: ${sup.detail}.${intent}`;
  }

  switch (decision.type) {
    case "holdout":
      return "Held back on purpose as a control, so real lift can be measured against it.";
    case "budget-exhausted":
      return "The discount budget for this period was already spent, so no offer could be made.";
    case "no_intervention":
      return `Not worth interrupting this visitor.${intent}`;
    default:
      break;
  }

  if (/^Revenue mode/.test(reasoning)) {
    const target = money(decision.threshold);
    return `Cart was worth growing, so it asked for a bigger order${target ? ` (spend ${target}+)` : ""} instead of cutting the price outright.${intent}`;
  }
  if (/^Conversion mode/.test(reasoning)) {
    return `Low enough buy-intent to need a push, so it offered the largest discount margin allows.${intent}`;
  }
  if (/High propensity/.test(reasoning)) {
    return `Likely to buy anyway, so it showed a nudge with no discount and kept the margin.${intent}`;
  }
  if (/Aggression 0/.test(reasoning)) {
    return "Discounting is turned off for this store, so the visitor saw a reminder only.";
  }
  if (/Merchant override/.test(reasoning)) {
    return "Paused by the merchant's own override during a site-wide promo.";
  }
  if (/AI paused/.test(reasoning)) {
    return "Paused automatically so it would not stack on top of a site-wide promo.";
  }
  if (reasoning) return reasoning;
  return decision.headline ? `Showed: “${decision.headline}”` : "No reason recorded.";
}

// WHY the visitor was flagged as worth an offer — a different axis from the
// triggerType gene above, which is WHEN the modal fires. The values are the
// ones VariantImpression.triggerReason documents; the earlier map here listed
// surface names instead and so matched nothing but "general".
const TRIGGER_REASONS = {
  failedCoupon: "tried a coupon that failed",
  checkoutExit: "leaving checkout",
  cartHesitation: "hesitating over the cart",
  staleCart: "sitting on an old cart",
  general: null,
};

const SOURCES = {
  cart_webhook: "pre-computed from a cart update",
  idle_cart_pickup: "pre-computed for an idle cart",
};

// Short "who this was" chips. Null entries are dropped by the caller.
function contextOf(decision, signals) {
  const cart = money(signals.cartValue ?? decision.cartValue);
  const visits = signals.visitFrequency;
  const reason = TRIGGER_REASONS[decision.triggerReason || signals.triggerReason] || null;
  return [
    signals.deviceType ? `${signals.deviceType} visitor` : null,
    cart ? `${cart} cart` : null,
    signals.trafficSource ? `from ${signals.trafficSource}` : null,
    Number.isFinite(visits) ? (visits <= 1 ? "first visit" : `visit ${visits}`) : null,
    reason ? `flagged for ${reason}` : null,
    decision.confidence ? `${decision.confidence} confidence` : null,
    SOURCES[decision.source] || null,
  ].filter(Boolean);
}

// WHEN the modal was set to fire. This is the variant's triggerType gene plus
// its idleSeconds — the thing the AI actually chose, distinct from
// triggerReason (WHY the visitor was flagged) which the context line carries.
// Rows from the cart webhook and idle sweep have no variant, so they carry
// determineOffer's coarser `timing` instead.
// On mobile the exit-intent listener is never registered at all — every
// mouseout site in the storefront extension is behind !isMobileDevice(),
// because mouseout does not fire there. So a mobile row must not claim exit
// intent as a trigger: what actually armed was the idle timer, capped to 15s
// when the gene asked for exit intent alone.
const TRIGGER_TYPES = {
  exit_intent: (seconds, isMobile) =>
    isMobile
      ? `after ${Math.min(seconds, 15)}s idle (exit intent can't fire on mobile)`
      : "on exit intent",
  idle: (seconds) => `after ${seconds}s idle`,
  exit_intent_or_idle: (seconds, isMobile) =>
    isMobile
      ? `after ${seconds}s idle (exit intent can't fire on mobile)`
      : `on exit intent, or after ${seconds}s idle`,
};

const TIMINGS = {
  immediate: "immediately — the visitor was already at a decision point",
  exit_intent: "on exit intent",
};

/**
 * Fill the same placeholders exit-intent-modal.js fills at render time.
 *
 * Deliberately a mirror, not a shared module: the storefront asset ships to
 * Shopify's CDN and imports nothing from the app. If the storefront's
 * replacement map changes, this changes with it — the alternative is a console
 * that quietly disagrees with the shopper's screen.
 *
 * `{{amount}}` is a bare number for percentage offers (the % lives in the
 * template) and a currency value otherwise. A placeholder with nothing to fill
 * it is left standing rather than blanked, so a genuinely broken gene still
 * looks broken here.
 */
function interpolate(text, decision) {
  if (typeof text !== "string" || !text.includes("{{")) return text;
  // Number(null) and Number("") are both 0, so a decision with no amount
  // would render "$0" — a confident wrong number in place of a placeholder
  // that correctly signals a broken gene. Absent must stay absent.
  const money = (n) => {
    if (n == null || n === "") return null;
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
  };
  const amount = decision?.amount;
  const values = {
    "{{amount}}": decision?.type === "percentage"
      ? (amount == null || amount === "" || !Number.isFinite(Number(amount))
          ? null : String(amount))
      : money(amount),
    "{{threshold}}": money(decision?.threshold),
  };
  let out = text;
  for (const [token, value] of Object.entries(values)) {
    if (value != null) out = out.split(token).join(value);
  }
  return out;
}

function triggerOf(decision, signals) {
  const type = decision.triggerType;
  if (!type) {
    return TIMINGS[decision.timing] || (decision.timing ? String(decision.timing).replace(/_/g, " ") : null);
  }
  const describe = TRIGGER_TYPES[type];
  const seconds = Number.isFinite(decision.idleSeconds) ? decision.idleSeconds : 30;
  if (!describe) return String(type).replace(/_/g, " ");
  return describe(seconds, signals.deviceType === "mobile");
}

export function summarizeDecision(row) {
  let decision = {};
  let signals = {};
  try {
    decision = JSON.parse(row.decision) || {};
  } catch {
    // Early rows stored a bare label ("show_variant", "suppress_promo_active")
    // rather than a JSON object. They are history, not corruption — read them
    // as the label they are instead of flagging them red.
    const legacy = String(row.decision || "").trim();
    const isLabel = legacy.length > 0 && legacy.length <= 64 && !legacy.startsWith("{");
    return {
      id: row.id,
      createdAt: row.createdAt,
      outcome: isLabel
        ? { label: legacy.replace(/_/g, " "), tone: undefined }
        : { label: "Unreadable record", tone: "critical" },
      why: isLabel
        ? "Logged before decisions carried their reasoning — the label is all this row holds."
        : "The stored decision is not valid JSON.",
      context: [],
      trigger: null,
      shownReached: false,
    shown: null,
      result: row.result ?? null,
      source: null,
      raw: row.decision,
    };
  }
  try {
    signals = JSON.parse(row.signals || "{}") || {};
  } catch {
    signals = {};
  }

  const P = Number.isFinite(signals.propensityScore) ? Math.round(signals.propensityScore) : null;

  return {
    id: row.id,
    createdAt: row.createdAt,
    outcome: outcomeOf(decision),
    trigger: triggerOf(decision, signals),
    why: whyOf(decision, P),
    context: contextOf(decision, signals),
    // Whether this copy actually reached a shopper. The console rendered
    // "Visitor saw: ..." unconditionally, which put a flat contradiction
    // directly above "the visitor never actually saw this" — on the one
    // surface whose entire purpose is to stop the console asserting things
    // that did not happen.
    shownReached: Boolean(row.result?.rendered),
    // The copy this decision carried, with placeholders filled in the way the
    // storefront fills them.
    //
    // The console printed the RAW gene under the label "Visitor saw:", so an
    // operator read `Your {{amount}} discount expires in 24 hours` and
    // reasonably concluded interpolation was broken in production. It is not —
    // the storefront substitutes at render — but a console that shows a
    // template while claiming to show what a shopper saw is manufacturing
    // false alarms about the one path nobody can observe directly.
    shown: decision.headline
      ? [decision.headline, decision.showSubhead === false ? null : decision.subhead, decision.cta]
          .filter(Boolean)
          .map(part => interpolate(part, decision))
          .join(" · ")
      : null,
    result: row.result ?? null,
    source: decision.source || null,
    raw: row.decision,
  };
}

export function relativeTime(value, now = Date.now()) {
  const then = new Date(value).getTime();
  const seconds = Math.round((now - then) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}

// What became of a decision, read off InterventionOutcome (+ the linked
// VariantImpression for the click). `result` is null when no outcome row
// exists at all — that is a real state, not missing data: budget blocks,
// promo pauses, the cart/idle pre-decision writers and test traffic all mint
// decisions without ever entering the tracked path.
export function describeResult(result, source = null) {
  if (!result) {
    // A cart-webhook / idle-sweep row was never a surface in the first place:
    // it is a speculative answer computed when the cart changed, kept so the
    // storefront can pick it up later. Calling that "not tracked" reads like a
    // failure when it is simply a different kind of record.
    if (SOURCES[source]) {
      return {
        label: "Pre-decision, never surfaced",
        tone: undefined,
        detail: `Computed ahead of time (${SOURCES[source]}), not in response to a visitor leaving — no impression was ever meant to follow.`,
      };
    }
    return {
      label: "Not tracked",
      tone: undefined,
      detail:
        "No impression record exists — minted outside the tracked path (budget block, promo pause, or test traffic).",
    };
  }
  if (!result.wasShown) {
    return result.converted
      ? {
          label: `Bought anyway · ${money(result.revenue)}`,
          tone: "success",
          detail: "Nothing was shown to this visitor and the order came in regardless.",
        }
      : {
          label: "No impression",
          tone: undefined,
          detail: "Nothing was shown, and no order followed.",
        };
  }
  if (result.converted) {
    // The cart attribute is stamped at render, not at click (see the modal
    // extension), so an order can attribute to a modal the visitor dismissed.
    // That is weaker evidence than a click and must not read the same.
    const margin = Number.isFinite(result.profit)
      ? `${money(result.profit)} left after the discount.`
      : null;
    if (!result.hasImpression) {
      // Pill openers mint no VariantImpression, so there is no click to read.
      return {
        label: `Converted · ${money(result.revenue)}`,
        tone: "success",
        detail: margin,
      };
    }
    return result.clicked
      ? {
          label: `Clicked, converted · ${money(result.revenue)}`,
          tone: "success",
          detail: margin,
        }
      : {
          label: `Converted without clicking · ${money(result.revenue)}`,
          tone: "success",
          detail: [
            "Shown but never clicked — attributed by the cart attribute stamped at render, so the visitor may have checked out on their own.",
            margin,
          ]
            .filter(Boolean)
            .join(" "),
        };
  }
  if (!result.rendered) {
    return {
      label: "Never rendered",
      tone: "warning",
      detail:
        "Decided at prefetch, but the trigger never fired — the visitor never actually saw this.",
    };
  }
  // "yet" is load-bearing: the order webhook attributes on an exact
  // aiDecisionId match with no deadline, and falls back to a 24h window, so a
  // recent row can still flip to converted.
  return {
    label: result.clicked ? "Clicked, no order yet" : "Seen, no order yet",
    tone: "info",
    detail: result.clicked
      ? "Took the offer but no order has attributed to it."
      : "Shown and ignored so far.",
  };
}

// Counts for the one-line header above the log.
export function tallyResults(rows) {
  const tally = { total: rows.length, rendered: 0, converted: 0, untracked: 0, preDecisions: 0 };
  for (const row of rows) {
    if (!row.result) {
      if (SOURCES[row.source]) tally.preDecisions += 1;
      else tally.untracked += 1;
    } else {
      if (row.result.rendered && row.result.wasShown) tally.rendered += 1;
      if (row.result.converted) tally.converted += 1;
    }
  }
  return tally;
}
