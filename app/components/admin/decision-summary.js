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

function money(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return `$${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}`;
}

function outcomeOf(decision) {
  const amount = decision.amount;
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
    // What the visitor actually read, when this decision produced a modal.
    shown: decision.headline
      ? [decision.headline, decision.showSubhead === false ? null : decision.subhead, decision.cta]
          .filter(Boolean)
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
  return new Date(value).toLocaleDateString();
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
