// What a store is ACTUALLY running, read off the exit_intent.settings
// metafield — the same object the decision engine destructures in
// apps.exit-intent.api.ai-decision.jsx. The Shop row mirrors these fields
// (the merchant app writes both on save), but the metafield is the one the
// storefront reads, so it is the one the console must quote.

export const MODES = {
  manual: { label: "Manual", tone: undefined, blurb: "Fixed offer, merchant-written. No AI decisions." },
  hybrid: { label: "Guided (Hybrid)", tone: "info", blurb: "Merchant pins the offer; AI decides who sees it, when, and with what copy." },
  ai: { label: "AI", tone: "success", blurb: "AI decides the offer, the timing, the copy, and whether to show at all." },
};

export function describeMode(mode) {
  return MODES[mode] || { label: mode || "unknown", tone: "critical", blurb: "Unrecognized mode." };
}

export function makesAIDecisions(mode) {
  return mode === "ai" || mode === "hybrid";
}

function pct(n) {
  return `${Math.round(Number(n))}%`;
}

function money(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  return `$${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}`;
}

// The offer the visitor can actually be given, in the terms that mode uses.
// AI has no single number — the range is computed by the caller, which has the
// engine's ceiling function.
export function describeOffer(settings, aiRange = null) {
  if (!settings) return { headline: "Unknown — settings metafield unreadable", lines: [] };
  const mode = settings.mode;

  if (mode === "manual") {
    if (!settings.discountEnabled) {
      return { headline: "No discount — reminder only", lines: [] };
    }
    const amount = settings.offerType === "fixed"
      ? money(settings.discountAmount)
      : pct(settings.discountPercentage);
    return {
      headline: `${amount} off, every visitor`,
      lines: [
        `Code: ${settings.manualDiscountCodeMode === "generic"
          ? `one shared code (${settings.manualGenericDiscountCode || "not set"})`
          : `unique per visitor, prefix ${settings.manualDiscountCodePrefix || "EXIT"}`}`,
      ],
    };
  }

  if (mode === "hybrid") {
    const amount = settings.hybridOfferType === "fixed"
      ? money(settings.hybridOfferAmount)
      : pct(settings.hybridOfferAmount);
    return {
      headline: `${amount} off, pinned by the merchant`,
      lines: [
        "The amount is fixed — no margin guard and no propensity taper applied to it.",
        `Code: ${settings.hybridDiscountCodeMode === "generic"
          ? `one shared code (${settings.hybridGenericDiscountCode || "not set"})`
          : `unique per visitor, prefix ${settings.hybridDiscountCodePrefix || "EXIT"}`}`,
      ],
    };
  }

  if (mode === "ai") {
    return {
      headline: aiRange
        ? (aiRange.max === 0
            ? "Reminder only — the curve never clears the 5% floor"
            : `Up to ${pct(aiRange.max)} off, decided per visitor`)
        : "Decided per visitor",
      lines: [
        `Aggression ${settings.aggression ?? 5} of 10.`,
        aiRange && aiRange.announceAbove !== null
          ? `Above a buy-intent score of ${aiRange.announceAbove} it stops discounting and shows a reminder instead.`
          : null,
        `Code: ${settings.aiDiscountCodeMode === "generic"
          ? `one shared code (${settings.aiGenericDiscountCode || "not set"})`
          : `unique per visitor, prefix ${settings.aiDiscountCodePrefix || "EXIT"}`}`,
      ].filter(Boolean),
    };
  }

  return { headline: "Unknown mode", lines: [] };
}

export function describeTriggers(settings) {
  if (!settings) return [];
  const triggers = settings.triggers || settings;
  const list = [];
  if (triggers.exitIntent ?? settings.exitIntentEnabled) list.push("on exit intent");
  if (triggers.timeDelay ?? settings.timeDelayEnabled) {
    list.push(`after ${triggers.timeDelaySeconds ?? settings.timeDelaySeconds ?? 30}s`);
  }
  if (triggers.cartValue ?? settings.cartValueEnabled) {
    const min = money(triggers.minCartValue ?? settings.cartValueMin ?? 0);
    const max = money(triggers.maxCartValue ?? settings.cartValueMax ?? 0);
    list.push(`carts ${min}–${max}`);
  }
  return list.length ? list : ["no trigger enabled"];
}

export function describeBudget(settings) {
  if (!settings) return null;
  if (!settings.budgetEnabled) return "No budget cap.";
  return `Capped at ${money(settings.budgetAmount)} per ${settings.budgetPeriod || "month"}.`;
}

export function describeFrequency(settings) {
  if (!settings) return null;
  const cooldown = settings.cooldownDays;
  const max = settings.maxShowsPer30d;
  if (cooldown === undefined && max === undefined) return null;
  return `At most ${max ?? 5} shows per 30 days${
    cooldown ? `, ${cooldown} day${cooldown === 1 ? "" : "s"} apart` : ", no cooldown between shows"
  }.`;
}

// Fields the console's own Settings form writes to the Shop row but which the
// decision engine reads off the metafield. When these disagree, someone edited
// the row directly and the storefront never heard about it.
const MIRRORED = [
  ["mode", "Mode"],
  ["aggression", "Aggression"],
  ["budgetEnabled", "Budget enabled"],
  ["budgetAmount", "Budget amount"],
  ["budgetPeriod", "Budget period"],
  ["aiGoal", "AI goal"],
];

export function settingsDrift(settings, shop) {
  if (!settings || !shop) return [];
  return MIRRORED.filter(([key]) => {
    const live = settings[key];
    const stored = shop[key];
    if (live === undefined || live === null) return false;
    return String(live) !== String(stored);
  }).map(([key, label]) => ({
    label,
    live: String(settings[key]),
    stored: String(shop[key]),
  }));
}
