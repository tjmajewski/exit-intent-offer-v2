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
    calculation: "InterventionOutcome rows with wasShown AND rendered, holdouts excluded — plus StarterImpression rows for manual-mode stores, which write no outcome rows. Identical to each store's own page (both build their queries from canonicalWhere in shop-metrics.server.js), so a figure here reconciles against the shop view. Dev/test stores excluded unless toggled on.",
  },
  cvr: {
    title: "CVR — conversion rate",
    importance:
      "The core quality measure: of the people we interrupted, how many bought. Falling CVR with rising impressions means the AI is showing to the wrong people.",
    meaning: "Share of modal impressions that ended in a purchase attributed to that impression.",
    calculation: "Conversions belonging to impressions shown in this window ÷ those impressions (InterventionOutcome). Both sides are the same cohort on purpose: the Revenue tile is period-based (order date in window), and dividing period orders by cohort impressions drifts at the window edge and can exceed 100%.",
  },
  revenue: {
    title: "Revenue",
    importance: "The gross top-line the modals recovered — the number that justifies the product.",
    meaning: "Order value from purchases attributed to modal impressions, before subtracting discount cost.",
    calculation: "Sum of Conversion.orderValue for orders placed in the window — the same table the store's own page reads, written once per attributed order whether or not a code was redeemed. Under an active device/traffic filter it falls back to attributed impressions, since orders carry no such column; the tile says so when that happens.",
  },
  profit: {
    title: "Profit",
    importance:
      "Better than revenue: a modal that converts by giving away a 30% discount can be a net loss. Profit is what the engine actually optimizes.",
    meaning: "Recovered revenue minus the discount cost it took to recover it.",
    calculation: "Revenue minus Conversion.discountAmount over the same orders. Discount cost is only our own code's share, never the order's whole discount. No COGS, shipping, fees, or refunds are in it — this is revenue net of discount, not margin.",
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
      "Rendered InterventionOutcome shows grouped by hour/day/week/month (bucket selector) — the same rows as the Impressions tile. Pair with the shown-vs-skipped chart: decisions flowing but impressions flat = render problem; both flat = traffic/tracking problem.",
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
    calculation: "Conversion rows bucketed by order date: revenue = sum of orderValue, profit = that minus discount granted. Segment filters don't apply to this chart — orders carry no device or traffic column.",
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
    title: "Conversion breakdowns",
    importance:
      "Which kinds of visitor the offer actually converts. A total-money bar can't answer that — it rewards whichever segment simply has the most traffic. A rate puts a low-volume segment that converts brilliantly next to a high-volume one that doesn't.",
    meaning:
      "Conversion rate within each segment (plan tier, device, traffic source, trigger reason, or offer archetype), sorted best first. Hover for that segment's whole funnel: impressions → clicks → conversions, plus $ per impression.",
    calculation:
      "Rendered VariantImpression rows grouped by the dimension: CVR = converted ÷ impressions, click rate = clicked ÷ impressions, $/impression = profit ÷ impressions. Plan tier is joined from each shop's record; top 8 groups shown. Bars under 30 impressions are dimmed — at n=2 a single conversion is a 50% CVR and would otherwise top the chart. Note these dimensions live only on VariantImpression, so pill-opener surfaces (which have no such row by design) are invisible here.",
  },

  // ── Tables / strips ──────────────────────────────────────────────────
  leaderboard: {
    title: "Customer leaderboard",
    importance:
      "Your account-health list: who's winning (case studies, upsells) and who needs attention before they churn — negative lift or many skip buckets are the early warnings.",
    meaning:
      "Every customer in the filter ranked by profit, with their impressions, CVR, holdout lift, and how many threshold buckets are currently set to never show.",
    calculation:
      "Per shop, built from the same canonical predicates as that store's own page: impressions from InterventionOutcome (or StarterImpression in manual mode), orders and profit from the Conversion table, CVR cohort-based. Holdout lift needs ≥10 holdout samples, else n/a; skip buckets = InterventionThreshold rows with shouldShow = false.",
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
      "The exact numbers the merchant sees on their own dashboard. Both surfaces read one module (app/utils/shop-metrics.server.js), so anything quoted here can be quoted to them verbatim.",
    meaning:
      "This store's decisions → impressions → clicks → conversions → revenue → profit for the selected window, plus how often the AI chose to stay quiet.",
    calculation:
      "Decisions = AIDecision rows in the window — the top of the funnel; every impression below it started as one, so decisions flowing while impressions sit flat is a render or trigger problem, and both flat is a traffic or tracking problem. Impressions = InterventionOutcome rows with wasShown AND rendered (AI/Guided) or StarterImpression rows (manual). Decisions are minted at prefetch, before any trigger fires, so unrendered rows are excluded — a raw row count overstates shows. Orders, revenue and discount cost come from the Conversion table, written once per attributed order whether or not a code was redeemed. Profit = revenue − discount granted. Holdouts are excluded from every figure above and reported separately.",
  },
};
