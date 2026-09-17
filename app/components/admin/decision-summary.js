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

const TRIGGERS = {
  exit_intent: "leaving the page",
  idle: "going idle",
  scroll: "scrolling away",
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
  const trigger = TRIGGERS[decision.triggerReason || signals.triggerReason] || null;
  return [
    signals.deviceType ? `${signals.deviceType} visitor` : null,
    cart ? `${cart} cart` : null,
    signals.trafficSource ? `from ${signals.trafficSource}` : null,
    Number.isFinite(visits) ? (visits <= 1 ? "first visit" : `visit ${visits}`) : null,
    trigger ? `caught ${trigger}` : null,
    decision.confidence ? `${decision.confidence} confidence` : null,
    SOURCES[decision.source] || null,
  ].filter(Boolean);
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
      shown: null,
      result: row.result ?? null,
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
    why: whyOf(decision, P),
    context: contextOf(decision, signals),
    // What the visitor actually read, when this decision produced a modal.
    shown: decision.headline
      ? [decision.headline, decision.showSubhead === false ? null : decision.subhead, decision.cta]
          .filter(Boolean)
          .join(" · ")
      : null,
    result: row.result ?? null,
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
export function describeResult(result) {
  if (!result) {
    return {
      label: "Not tracked",
      tone: undefined,
      detail:
        "No impression record exists — minted outside the tracked path (budget block, promo pause, cart prefetch, or test traffic).",
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
  return {
    label: result.clicked ? "Clicked, no order" : "Seen, no order",
    tone: "info",
    detail: null,
  };
}

// Counts for the one-line header above the log.
export function tallyResults(rows) {
  const tally = { total: rows.length, rendered: 0, converted: 0, untracked: 0 };
  for (const row of rows) {
    if (!row.result) tally.untracked += 1;
    else {
      if (row.result.rendered && row.result.wasShown) tally.rendered += 1;
      if (row.result.converted) tally.converted += 1;
    }
  }
  return tally;
}
