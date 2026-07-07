// Explainer copy for every chart, KPI, and table on the admin dashboards.
// Rendered by InfoPopover. Keep each entry to: importance (why you should
// care), meaning (how to read it), calculation (exact data source + math)
// so the console stays self-documenting as customers onboard.

export const METRIC_INFO = {
  // ── KPI tiles ────────────────────────────────────────────────────────
  decisions: {
    title: "AI decisions",
    importance:
      "Top of the funnel for the whole engine — if decisions stop, everything downstream (impressions, conversions, revenue) stops with it.",
    meaning:
      "How many times the AI was asked \"should we show a modal to this visitor?\" in the window, across every customer in the current filter.",
    calculation:
      "Count of AIDecision rows in the window. The arrow compares against the previous period of the same length.",
  },
  showRate: {
    title: "Show rate",
    importance:
      "Shows how selective the AI is being. A crashing show rate means threshold learning is deciding \"don't show\" — sometimes correct, sometimes the reason a merchant says modals disappeared.",
    meaning:
      "Of all intervention decisions, the share where the AI chose to show the modal rather than stay quiet.",
    calculation:
      "shown ÷ (shown + skipped) from InterventionOutcome rows (wasShown flag, holdout group excluded from the shown count).",
  },
  impressions: {
    title: "Impressions",
    importance:
      "The engine's pulse. Flat or falling impressions with steady traffic = something is blocking modals (settings, budget, thresholds, or a broken theme extension).",
    meaning: "Total modal displays across all customers in the current filter.",
    calculation: "Count of VariantImpression rows in the window (dev/test stores excluded unless toggled on).",
  },
  cvr: {
    title: "CVR — conversion rate",
    importance:
      "The core quality measure: of the people we interrupted, how many bought. Falling CVR with rising impressions means the AI is showing to the wrong people.",
    meaning: "Share of modal impressions that ended in a purchase attributed to that impression.",
    calculation: "converted VariantImpression rows ÷ all VariantImpression rows in the window.",
  },
  revenue: {
    title: "Revenue",
    importance: "The gross top-line the modals recovered — the number that justifies the product.",
    meaning: "Order value from purchases attributed to modal impressions, before subtracting discount cost.",
    calculation: "Sum of VariantImpression.revenue (stamped by the order webhook when a conversion is matched).",
  },
  profit: {
    title: "Profit",
    importance:
      "Better than revenue: a modal that converts by giving away a 30% discount can be a net loss. Profit is what the engine actually optimizes.",
    meaning: "Recovered revenue minus the discount cost it took to recover it.",
    calculation: "Sum of VariantImpression.profit, where profit = revenue − discountAmount per converted impression.",
  },
  profitPerImpression: {
    title: "$ / impression",
    importance:
      "The engine's efficiency score, and the fitness function the evolution system breeds variants on. Lets you compare a 100-impression store against a 10,000-impression store fairly.",
    meaning: "Average profit generated every time a modal is shown.",
    calculation: "Total profit ÷ total impressions in the window.",
  },
  holdoutLift: {
    title: "Holdout lift",
    importance:
      "The single best \"is the AI actually worth it\" number. It proves causation, not correlation — some of those shoppers would have bought anyway.",
    meaning:
      "How much likelier a shopper is to convert when shown a modal vs the 5% control group that qualified but was deliberately not shown.",
    calculation:
      "Shown-group CVR minus holdout CVR, in percentage points, from InterventionOutcome (isHoldout flag). Displays n/a until the holdout group has ≥10 samples. Same source as each merchant's dashboard lift card.",
  },

  // ── Charts ───────────────────────────────────────────────────────────
  impressionsOverTime: {
    title: "Modal impressions over time",
    importance:
      "Your primary troubleshooting chart. A store whose line drops to zero has a problem RIGHT NOW — disabled trigger, exhausted budget, all-skip thresholds, or a broken storefront extension.",
    meaning:
      "Modal displays per time bucket. With ≤5 shops in the filter, one line per shop so a single flatlined store can't hide inside a healthy total.",
    calculation:
      "VariantImpression rows grouped by hour/day/week/month (bucket selector). Pair with the shown-vs-skipped chart: decisions flowing but impressions flat = render problem; both flat = traffic/tracking problem.",
  },
  shownSkipped: {
    title: "Decisions: shown vs skipped",
    importance:
      "Skipping is a feature — staying quiet for likely buyers protects margin. But a skip share that suddenly balloons explains \"my modals stopped showing\" complaints instantly.",
    meaning: "Each bar splits the AI's intervention decisions into modal shown vs deliberately not shown.",
    calculation: "InterventionOutcome rows per bucket, split by wasShown (holdout group excluded from shown).",
  },
  cvrVsHoldout: {
    title: "CVR: shown vs holdout",
    importance:
      "The lift chart. The gap between the lines IS the AI's causal impact — if the lines touch, the modals aren't adding conversions and are just spending discount budget.",
    meaning:
      "Conversion rate of shoppers shown a modal vs the 5% control group that qualified but saw nothing, over time.",
    calculation:
      "Per bucket: shownConverted ÷ shown, and holdoutConverted ÷ holdout, from InterventionOutcome. Holdout is small (5%), so short windows are noisy — trust the trend, not single points.",
  },
  revenueProfit: {
    title: "Revenue & profit",
    importance:
      "The money trend, and the gap between the lines is your discount spend. A widening gap means conversions are being bought with increasingly expensive offers.",
    meaning: "Recovered revenue and net profit (revenue minus discount cost) per time bucket.",
    calculation: "Sum of VariantImpression.revenue and .profit per bucket for converted impressions.",
  },
  scoreBuckets: {
    title: "Threshold learning by score bucket",
    importance:
      "A window into the AI's show/don't-show brain. Where the skip arm beats the show arm, the engine has learned those shoppers buy anyway — interrupting them just costs discount.",
    meaning:
      "For each purchase-intent score band (0-20 = unlikely to buy … 80-100 = very likely), average profit per visitor when shown vs when skipped.",
    calculation:
      "InterventionOutcome grouped by scoreBucket × wasShown; profit ÷ count per arm. Skip-arm profit is full-margin natural purchases (no discount cost). This is the data Thompson Sampling uses to set each store's thresholds.",
  },
  breakdown: {
    title: "Profit breakdowns",
    importance:
      "Where the money concentrates — and where it leaks. A segment that's large in impressions but tiny in profit is where to tune next.",
    meaning:
      "Total profit in the window split by the named dimension (plan tier, device, traffic source, trigger reason, or offer archetype).",
    calculation:
      "VariantImpression rows grouped by the dimension, summing profit. Plan tier is joined from each shop's record; top 8 groups shown.",
  },

  // ── Tables / strips ──────────────────────────────────────────────────
  leaderboard: {
    title: "Customer leaderboard",
    importance:
      "Your account-health list: who's winning (case studies, upsells) and who needs attention before they churn — negative lift or many skip buckets are the early warnings.",
    meaning:
      "Every customer in the filter ranked by profit, with their impressions, CVR, holdout lift, and how many threshold buckets are currently set to never show.",
    calculation:
      "Per shop: impressions/CVR/profit from VariantImpression; holdout lift from InterventionOutcome (needs ≥10 holdout samples, else n/a); skip buckets = InterventionThreshold rows with shouldShow = false.",
  },
  engineHealth: {
    title: "Engine health",
    importance:
      "Infrastructure vitals. Stale evolution or zero champions long after install means the learning loop is stuck for that store even if today's revenue looks fine.",
    meaning:
      "AI-mode store count, living variant population, champion count, and cross-store meta-learning insight volume, with warnings for stores whose evolution cycle hasn't run in 7+ days.",
    calculation:
      "Counts from Shop (mode), Variant (status alive/champion), MetaLearningInsights, and Shop.lastEvolutionCycle age.",
  },
  trendSummary: {
    title: "Trend summary",
    importance: "The 10-second read: what moved, why, and which customer to look at first.",
    meaning:
      "Auto-generated sentences comparing this window to the previous one of the same length, plus the biggest segment mover and a watch list.",
    calculation:
      "Deterministic (no AI involved): KPI deltas vs prior period; movers ranked by absolute profit change among segments with ≥50 impressions in both periods; watch list = negative lift, ≥5 skip buckets, or zero impressions in 24h after a week of activity.",
  },

  // ── Shop detail performance tab ──────────────────────────────────────
  shopPerformance: {
    title: "Store performance",
    importance:
      "The same funnel the merchant sees, from the operator side — use it to verify a complaint or check on a store after changing its settings.",
    meaning:
      "This store's impressions → clicks → conversions → revenue → profit for the selected window, plus AI shown/skipped counts and webhook-attributed orders.",
    calculation:
      "VariantImpression aggregates (AI mode) or StarterImpression counts (manual mode); shown/skipped from InterventionOutcome; orders and order revenue from the Conversion table (order webhook). Totals can differ slightly from the merchant's analytics page, which reads live metafield counters.",
  },
};
