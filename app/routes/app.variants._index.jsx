import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { useEffect, useState } from "react";
import AppLayout from "../components/AppLayout";
import db from "../db.server";
import { getShopPlan } from "../utils/plan.server";
import { parseSegmentKey } from "../utils/segment-key";

// Presentation helpers (shared across stat cards + archetype tab)
function cap(s) {
  if (!s || typeof s !== 'string') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function formatArchetypeName(raw) {
  if (!raw) return '';
  // Archetype names like "THRESHOLD_DISCOUNT" → "Threshold Discount"
  return raw
    .toLowerCase()
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// "?" icon with a custom hover tooltip. Native `title` attributes are
// unreliable inside Shopify's embedded app iframe, so we use a controlled
// React tooltip positioned above the icon.
function InfoIcon({ tip }) {
  const [show, setShow] = useState(false);
  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      tabIndex={0}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#e5e7eb',
        color: '#6b7280',
        fontSize: 11,
        fontWeight: 700,
        marginLeft: 6,
        cursor: 'help',
        verticalAlign: 'middle',
        outline: 'none'
      }}
    >
      ?
      {show && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: 'white',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.5,
            width: 280,
            textAlign: 'left',
            whiteSpace: 'normal',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          {tip}
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid #111827'
            }}
          />
        </span>
      )}
    </span>
  );
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  try {
  // Get filters from URL
  const url = new URL(request.url);
  const segmentFilter = url.searchParams.get('segment') || 'all';
  // Phase 2D filters
  const windowFilter = url.searchParams.get('window') || '30d';          // 7d | 30d | 90d
  const archetypeFilter = url.searchParams.get('archetype') || 'all';
  const pageTypeFilter = url.searchParams.get('pageType') || 'all';
  // Single "what does the modal offer" filter (replaces legacy promo + promoInCart)
  const offerFilter = url.searchParams.get('offer') || 'all';            // all | with-promo | no-promo
  const tab = url.searchParams.get('tab') || 'archetypes';                // archetypes | components

  // Get shop from database
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });

  if (!shop) {
    return { variants: [], shop: null, plan: null };
  }

  // DB is the single source of truth for plan tier (see utils/plan.server.js).
  const plan = await getShopPlan(session);
  const planTier = plan.tier;

  // Enterprise-only page
  if (planTier !== 'enterprise') {
    return {
      hasAccess: false,
      plan,
      shop: null,
      variants: [],
      totalVariants: 0,
      aliveCount: 0,
      deadCount: 0,
      generationStats: { max: 0 },
      componentStats: { headlines: [], subheads: [], ctas: [] },
      filters: { offer: 'all', segment: 'all' }
    };
  }

  // Get all variants for this shop
  const allVariants = await db.variant.findMany({
    where: { shopId: shop.id },
    include: {
      impressionRecords: true
    }
  });

  // Build where clause for filtered impressions
  const whereClause = { shopId: shop.id };

  // Phase 2D: time window filter (default 30d)
  const windowDays = windowFilter === '7d' ? 7 : windowFilter === '90d' ? 90 : 30;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  whereClause.timestamp = { gte: windowStart };

  // Phase 2D: archetype filter
  if (archetypeFilter !== 'all') {
    whereClause.archetype = archetypeFilter;
  }

  // Phase 2D: pageType filter
  if (pageTypeFilter !== 'all') {
    whereClause.pageType = pageTypeFilter;
  }

  // Modal-offer filter (does the modal itself offer a promo?). The variant's
  // offerAmount column stores the discount value (0 = no discount). We filter
  // through the variant relation so impressions only include rows whose
  // associated variant matches.
  if (offerFilter === 'with-promo') {
    whereClause.variant = { offerAmount: { gt: 0 } };
  } else if (offerFilter === 'no-promo') {
    whereClause.variant = { offerAmount: { equals: 0 } };
  }

  // Apply segment filter
  if (segmentFilter !== 'all') {
    switch (segmentFilter) {
      case 'desktop':
        whereClause.deviceType = 'desktop';
        break;
      case 'mobile':
        whereClause.deviceType = 'mobile';
        break;
      case 'tablet':
        whereClause.deviceType = 'tablet';
        break;
      case 'logged-in':
        whereClause.accountStatus = 'logged_in';
        break;
      case 'guest':
        whereClause.accountStatus = 'guest';
        break;
      case 'first-time':
        whereClause.visitFrequency = 1;
        break;
      case 'returning':
        whereClause.visitFrequency = { gte: 2 };
        break;
      case 'high-value':
        whereClause.cartValue = { gte: 100 };
        break;
      case 'low-value':
        whereClause.cartValue = { lt: 50 };
        break;
      case 'paid-traffic':
        whereClause.trafficSource = 'paid';
        break;
      case 'organic-traffic':
        whereClause.trafficSource = 'organic';
        break;
    }
  }

  // Get filtered impressions
  const filteredImpressions = await db.variantImpression.findMany({
    where: whereClause,
    include: {
      variant: {
        select: {
          id: true,
          variantId: true,
          headline: true,
          subhead: true,
          cta: true,
          offerAmount: true,
          baseline: true
        }
      }
    }
  });

  // Group impressions by variantId
  const impressionsByVariant = filteredImpressions.reduce((acc, imp) => {
    if (!acc[imp.variantId]) {
      acc[imp.variantId] = [];
    }
    acc[imp.variantId].push(imp);
    return acc;
  }, {});

  // Recalculate metrics based on filtered impressions
  const variants = allVariants.map(v => {
    const variantImpressions = impressionsByVariant[v.id] || [];
    const totalImpressions = variantImpressions.length;
    const totalConversions = variantImpressions.filter(i => i.converted).length;
    const totalRevenue = variantImpressions.reduce((sum, i) => sum + (i.profit || 0), 0);
    const profitPerImpression = totalImpressions > 0 ? totalRevenue / totalImpressions : 0;

    return {
      ...v,
      impressions: totalImpressions,
      conversions: totalConversions,
      profitPerImpression: profitPerImpression
    };
  }).sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'alive' || a.status === 'champion' ? -1 : 1;
    }
    return b.profitPerImpression - a.profitPerImpression;
  });

  // Aggregate performance by component (headlines, subheads, CTAs)
  function aggregateByComponent(impressions, componentType) {
    const grouped = {};

    impressions.forEach(imp => {
      if (!imp.variant) return;
      const key = imp.variant[componentType];
      if (!key) return;

      if (!grouped[key]) {
        grouped[key] = {
          text: key,
          impressions: 0,
          conversions: 0,
          revenue: 0,
          variantCount: new Set()
        };
      }

      grouped[key].impressions++;
      if (imp.converted) grouped[key].conversions++;
      if (imp.revenue) grouped[key].revenue += imp.revenue;
      grouped[key].variantCount.add(imp.variantId);
    });

    // Calculate metrics
    const results = Object.values(grouped).map(item => ({
      text: item.text,
      conversionRate: item.impressions > 0 ? (item.conversions / item.impressions) * 100 : 0,
      impressions: item.impressions,
      conversions: item.conversions,
      revenue: item.revenue,
      variantCount: item.variantCount.size
    }));

    // Sort by revenue (descending)
    return results.sort((a, b) => b.revenue - a.revenue);
  }

  // Get component stats
  const headlineStats = aggregateByComponent(filteredImpressions, 'headline');
  const subheadStats = aggregateByComponent(filteredImpressions, 'subhead');
  const ctaStats = aggregateByComponent(filteredImpressions, 'cta');

  // Calculate average revenue for tier calculation
  const avgHeadlineRevenue = headlineStats.length > 0
    ? headlineStats.reduce((sum, h) => sum + h.revenue, 0) / headlineStats.length
    : 0;
  const avgSubheadRevenue = subheadStats.length > 0
    ? subheadStats.reduce((sum, s) => sum + s.revenue, 0) / subheadStats.length
    : 0;
  const avgCtaRevenue = ctaStats.length > 0
    ? ctaStats.reduce((sum, c) => sum + c.revenue, 0) / ctaStats.length
    : 0;

  // Add performance tier to each component
  function addPerformanceTier(stats, avgRevenue) {
    return stats.map(item => {
      let tier, tierColor, tierBadgeTone;
      const vsAverage = avgRevenue > 0 ? ((item.revenue - avgRevenue) / avgRevenue) * 100 : 0;

      if (item.revenue >= avgRevenue * 1.5) {
        tier = 'Elite';
        tierColor = 'success';
        tierBadgeTone = 'success';
      } else if (item.revenue >= avgRevenue * 1.1) {
        tier = 'Strong';
        tierColor = 'info';
        tierBadgeTone = 'info';
      } else if (item.revenue >= avgRevenue * 0.9) {
        tier = 'Average';
        tierColor = 'default';
        tierBadgeTone = undefined;
      } else {
        tier = 'Poor';
        tierColor = 'critical';
        tierBadgeTone = 'critical';
      }

      return {
        ...item,
        tier,
        tierColor,
        tierBadgeTone,
        vsAverage: vsAverage.toFixed(1)
      };
    });
  }

  const headlinesWithTiers = addPerformanceTier(headlineStats, avgHeadlineRevenue).slice(0, 10);
  const subheadsWithTiers = addPerformanceTier(subheadStats, avgSubheadRevenue).slice(0, 10);
  const ctasWithTiers = addPerformanceTier(ctaStats, avgCtaRevenue).slice(0, 10);

  // ----- Phase 2D: archetype rankings (own-shop, current filter window) -----
  const archetypeBuckets = {};
  for (const imp of filteredImpressions) {
    const key = imp.archetype || 'UNCLASSIFIED';
    if (!archetypeBuckets[key]) {
      archetypeBuckets[key] = { impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    }
    const b = archetypeBuckets[key];
    b.impressions += 1;
    if (imp.clicked) b.clicks += 1;
    if (imp.converted) {
      b.conversions += 1;
      b.revenue += imp.revenue || 0;
    }
  }
  const archetypeRankings = Object.entries(archetypeBuckets)
    .map(([archetype, b]) => ({
      archetype,
      impressions: b.impressions,
      clicks: b.clicks,
      conversions: b.conversions,
      revenue: b.revenue,
      cvr: b.impressions > 0 ? (b.conversions / b.impressions) * 100 : 0,
      ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
      rpi: b.impressions > 0 ? b.revenue / b.impressions : 0
    }))
    .filter(r => r.archetype !== 'UNCLASSIFIED' && r.impressions >= 10) // avoid noise
    .sort((a, b) => b.cvr - a.cvr);

  // Average CVR across archetypes (for "vs avg" comparisons)
  const avgArchetypeCvr = archetypeRankings.length > 0
    ? archetypeRankings.reduce((s, r) => s + r.cvr, 0) / archetypeRankings.length
    : 0;

  // ----- Phase 2D: top segmentKey performers (for "Best Segment" card) -----
  const segmentKeyBuckets = {};
  for (const imp of filteredImpressions) {
    if (!imp.segmentKey) continue;
    if (!segmentKeyBuckets[imp.segmentKey]) {
      segmentKeyBuckets[imp.segmentKey] = { impressions: 0, conversions: 0 };
    }
    segmentKeyBuckets[imp.segmentKey].impressions += 1;
    if (imp.converted) segmentKeyBuckets[imp.segmentKey].conversions += 1;
  }
  const segmentKeyRankings = Object.entries(segmentKeyBuckets)
    .map(([segmentKey, b]) => ({
      segmentKey,
      impressions: b.impressions,
      conversions: b.conversions,
      cvr: b.impressions > 0 ? (b.conversions / b.impressions) * 100 : 0
    }))
    .filter(r => r.impressions >= 20) // need meaningful sample
    .sort((a, b) => b.cvr - a.cvr);

  const bestSegment = segmentKeyRankings[0] || null;

  // Observed pageType values (for filter dropdown — only show what we have data for)
  const observedPageTypes = [...new Set(filteredImpressions.map(i => i.pageType).filter(Boolean))].sort();

  // ----- Phase 2H: archetype × segmentKey heatmap -----
  // For the Segments tab. Rows = top N segmentKeys (by impressions), columns =
  // archetypes from archetypeRankings (already filtered ≥10 imps). Each cell
  // holds {impressions, conversions, cvr} so the UI can color by CVR and
  // annotate with sample size. Cells with fewer than HEATMAP_MIN_CELL_IMPS
  // impressions are kept but flagged as low-confidence so the UI can dim them.
  const HEATMAP_MIN_CELL_IMPS = 5;
  const HEATMAP_MIN_SEGMENT_IMPS = 20;
  const HEATMAP_MAX_SEGMENTS = 15;

  const heatmapArchetypes = archetypeRankings.map(r => r.archetype);
  const cellMap = new Map(); // `${segmentKey}::${archetype}` → { impressions, conversions }
  const segmentTotals = new Map(); // segmentKey → { impressions, conversions }

  for (const imp of filteredImpressions) {
    if (!imp.segmentKey || !imp.archetype) continue;
    if (!heatmapArchetypes.includes(imp.archetype)) continue;
    const cellKey = `${imp.segmentKey}::${imp.archetype}`;
    if (!cellMap.has(cellKey)) cellMap.set(cellKey, { impressions: 0, conversions: 0 });
    const cell = cellMap.get(cellKey);
    cell.impressions += 1;
    if (imp.converted) cell.conversions += 1;

    if (!segmentTotals.has(imp.segmentKey)) segmentTotals.set(imp.segmentKey, { impressions: 0, conversions: 0 });
    const seg = segmentTotals.get(imp.segmentKey);
    seg.impressions += 1;
    if (imp.converted) seg.conversions += 1;
  }

  const heatmapSegments = Array.from(segmentTotals.entries())
    .filter(([, t]) => t.impressions >= HEATMAP_MIN_SEGMENT_IMPS)
    .map(([key, t]) => ({
      key,
      impressions: t.impressions,
      conversions: t.conversions,
      cvr: t.impressions > 0 ? (t.conversions / t.impressions) * 100 : 0
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, HEATMAP_MAX_SEGMENTS);

  const heatmapCells = {};
  for (const seg of heatmapSegments) {
    heatmapCells[seg.key] = {};
    for (const arch of heatmapArchetypes) {
      const c = cellMap.get(`${seg.key}::${arch}`);
      if (!c) {
        heatmapCells[seg.key][arch] = null;
        continue;
      }
      heatmapCells[seg.key][arch] = {
        impressions: c.impressions,
        conversions: c.conversions,
        cvr: c.impressions > 0 ? (c.conversions / c.impressions) * 100 : 0,
        lowConfidence: c.impressions < HEATMAP_MIN_CELL_IMPS
      };
    }
  }

  // Per-segment winning archetype (highest CVR cell with ≥ HEATMAP_MIN_CELL_IMPS).
  // Used by the UI to outline the AI-promoted cell on each row.
  const heatmapWinners = {};
  for (const seg of heatmapSegments) {
    let best = null;
    for (const arch of heatmapArchetypes) {
      const c = heatmapCells[seg.key][arch];
      if (!c || c.lowConfidence) continue;
      if (!best || c.cvr > best.cvr) best = { archetype: arch, cvr: c.cvr };
    }
    heatmapWinners[seg.key] = best ? best.archetype : null;
  }

  const heatmap = {
    archetypes: heatmapArchetypes,
    segments: heatmapSegments,
    cells: heatmapCells,
    winners: heatmapWinners,
    minCellImps: HEATMAP_MIN_CELL_IMPS
  };

  // ----- Phase 2G: filter-narrowed signal (drives the "Promoted" badge) -----
  // The runtime priors fire when an incoming impression has a specific segmentKey.
  // On the dashboard, if the user has filtered down to a specific segment, the
  // archetype rankings on screen are an accurate proxy for what the AI would
  // promote at runtime for visitors matching that filter.
  const filtersAreNarrowed =
    segmentFilter !== 'all' ||
    pageTypeFilter !== 'all' ||
    offerFilter !== 'all';

  const filterDescriptionParts = [];
  if (segmentFilter !== 'all') filterDescriptionParts.push(segmentFilter.replace('-', ' '));
  if (pageTypeFilter !== 'all') filterDescriptionParts.push(`${pageTypeFilter} page`);
  if (offerFilter === 'with-promo') filterDescriptionParts.push('modals offering a promo');
  else if (offerFilter === 'no-promo') filterDescriptionParts.push('modals without a promo');
  const filterDescription = filterDescriptionParts.join(' · ') || null;

  // Only meaningfully "promoted" when there's spread across archetypes.
  const topCvr = archetypeRankings[0]?.cvr ?? 0;
  const bottomCvr = archetypeRankings[archetypeRankings.length - 1]?.cvr ?? 0;
  const archetypeSpreadPts = topCvr - bottomCvr;
  const hasMeaningfulSpread = archetypeRankings.length >= 2 && archetypeSpreadPts >= 0.5;

  // Network benchmark loader removed — moved to dev-only roadmap. Meta-learning
  // insights are still written nightly (see app/utils/meta-learning.js) and
  // consumed at runtime by archetype priors. The merchant-facing comparison UI
  // was removed because cross-store benchmarking is more useful as an internal
  // diagnostic dashboard than as a customer feature.

  // Total variants is all-time count
  const totalVariants = variants.length;

  // Active variants capped at current populationSize setting
  const maxVariants = plan.tier === 'enterprise' ? 20 : 2;
  const populationLimit = Math.min(shop.populationSize || maxVariants, maxVariants);
  const activeVariants = variants.filter(v => v.status === 'alive' || v.status === 'champion');
  const aliveCount = Math.min(activeVariants.length, populationLimit);

  // Eliminated is all-time
  const deadCount = variants.filter(v => v.status === 'killed').length;

  // For display, show variants up to populationLimit
  const displayVariants = variants.slice(0, populationLimit);
  const maxGeneration = displayVariants.length > 0 ? Math.max(...displayVariants.map(v => v.generation)) : 0;

  return {
    shop,
    plan,
    variants: displayVariants,
    totalVariants,
    aliveCount,
    deadCount,
    generationStats: {
      max: maxGeneration
    },
    componentStats: {
      headlines: headlinesWithTiers,
      subheads: subheadsWithTiers,
      ctas: ctasWithTiers
    },
    archetypeRankings,
    avgArchetypeCvr,
    bestSegment,
    observedPageTypes,
    filtersAreNarrowed,
    filterDescription,
    hasMeaningfulSpread,
    heatmap,
    filters: {
      offer: offerFilter,
      segment: segmentFilter,
      window: windowFilter,
      archetype: archetypeFilter,
      pageType: pageTypeFilter,
      tab
    }
  };
  } catch (error) {
    console.error("Variants loader error:", error);
    return {
      shop: null, plan: null, variants: [], totalVariants: 0,
      aliveCount: 0, deadCount: 0,
      generationStats: { max: 0 },
      componentStats: { headlines: [], subheads: [], ctas: [] },
      archetypeRankings: [],
      avgArchetypeCvr: 0,
      bestSegment: null,
      observedPageTypes: [],
      filtersAreNarrowed: false,
      filterDescription: null,
      hasMeaningfulSpread: false,
      heatmap: { archetypes: [], segments: [], cells: {}, winners: {}, minCellImps: 5 },
      filters: { offer: 'all', segment: 'all', window: '30d', archetype: 'all', pageType: 'all', tab: 'archetypes' },
      dbError: true
    };
  }
}

export default function VariantsIndex() {
  const data = useLoaderData();
  const {
    hasAccess, shop, plan, variants, totalVariants, aliveCount, deadCount,
    generationStats, componentStats, dbError,
    archetypeRankings = [], avgArchetypeCvr = 0, bestSegment = null, observedPageTypes = [],
    filtersAreNarrowed = false, filterDescription = null, hasMeaningfulSpread = false,
    heatmap = { archetypes: [], segments: [], cells: {}, winners: {}, minCellImps: 5 }
  } = data;
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState(null);

  const offerFilter = searchParams.get('offer') || 'all';
  const windowMode = searchParams.get('window') || '30d';
  const archetypeFilter = searchParams.get('archetype') || 'all';
  const pageTypeFilter = searchParams.get('pageType') || 'all';
  const tab = searchParams.get('tab') || 'archetypes';

  // Helper: update a single URL param (preserves others)
  const setParam = (key, value) => {
    const np = new URLSearchParams(searchParams);
    if (value === null || value === undefined || value === 'all') np.delete(key);
    else np.set(key, value);
    setSearchParams(np);
  };

  // Auto-refresh every 30 seconds — preserve all current filters
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetcher.load(`/app/variants?${searchParams.toString()}`);
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetcher, searchParams]);

  // Use fetcher data if available, otherwise use initial data
  const displayData = fetcher.data || data;
  const displayVariants = displayData.variants || variants;
  const displayArchetypes = displayData.archetypeRankings || archetypeRankings;
  const displayAvgCvr = displayData.avgArchetypeCvr ?? avgArchetypeCvr;
  const displayBestSegment = displayData.bestSegment || bestSegment;
  const displayPageTypes = displayData.observedPageTypes || observedPageTypes;
  const displayHeatmap = displayData.heatmap || heatmap;
  const displayFiltersNarrowed = displayData.filtersAreNarrowed ?? filtersAreNarrowed;
  const displayFilterDescription = displayData.filterDescription ?? filterDescription;
  const displayHasSpread = displayData.hasMeaningfulSpread ?? hasMeaningfulSpread;

  // Priors are active for Pro and Enterprise (Phase 2E). Show the "Promoted"
  // badge only when these are true AND filters narrow to a specific segment
  // AND there's meaningful CVR spread worth biasing on.
  const priorsActiveTier = plan?.tier === 'pro' || plan?.tier === 'enterprise';
  const showPromotedBadge = priorsActiveTier && displayFiltersNarrowed && displayHasSpread;

  // Non-Enterprise users see upgrade page
  if (hasAccess === false) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40 }}>
          <div style={{
            textAlign: "center",
            maxWidth: 600,
            margin: "80px auto",
            padding: 40,
            background: "#fef3c7",
            borderRadius: 12,
            border: "2px solid #f59e0b"
          }}>
            <h1 style={{ fontSize: 28, marginBottom: 16 }}>Enterprise Feature</h1>
            <p style={{ fontSize: 16, color: "#78350f", marginBottom: 24 }}>
              Variant Performance is only available on Enterprise plans.
              Unlock AI-powered copy testing that automatically evolves your exit offers to maximize conversions.
            </p>
            <a
              href="/app/upgrade"
              style={{
                display: "inline-block",
                background: "#f59e0b",
                color: "white",
                padding: "14px 28px",
                borderRadius: 8,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 16
              }}
            >
              Upgrade to Enterprise →
            </a>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (dbError) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40 }}>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Variant Performance</h1>
          <div style={{ background: 'white', padding: 48, borderRadius: 8, border: '1px solid #e5e7eb', textAlign: 'center' }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>Unable to load variants</h2>
            <p style={{ color: '#666' }}>There was a problem connecting to the database. Please try refreshing the page.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!shop) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40 }}>
          <h1>Variant Performance</h1>
          <p>No shop data found.</p>
        </div>
      </AppLayout>
    );
  }

  // Filter variants
  const filteredVariants = displayVariants.filter(v => v.status === 'alive' || v.status === 'champion');

  // Performance tier colors
  const getTierColor = (revenue, avgRevenue) => {
    if (avgRevenue === 0) return { bg: '#f3f4f6', border: '#9ca3af', label: 'N/A', textColor: '#4b5563' };
    const ratio = revenue / avgRevenue;
    if (ratio >= 1.5) return { bg: '#dcfce7', border: '#22c55e', label: 'Elite', textColor: '#16a34a' };
    if (ratio >= 1.1) return { bg: '#dbeafe', border: '#3b82f6', label: 'Strong', textColor: '#1e40af' };
    if (ratio >= 0.9) return { bg: '#f3f4f6', border: '#9ca3af', label: 'Average', textColor: '#4b5563' };
    return { bg: '#fee2e2', border: '#ef4444', label: 'Poor', textColor: '#dc2626' };
  };

  const avgRevenue = filteredVariants.length > 0
    ? filteredVariants.reduce((sum, v) => sum + (v.profitPerImpression * v.impressions), 0) / filteredVariants.length
    : 0;

  // Group by component and calculate performance
  const calculatePerformance = (variants) => {
    const byHeadline = {};
    const bySubhead = {};
    const byCTA = {};

    variants.forEach(v => {
      const revenue = v.profitPerImpression * v.impressions;

      if (!byHeadline[v.headline]) {
        byHeadline[v.headline] = { text: v.headline, cvr: 0, revenue: 0, impressions: 0, conversions: 0, variants: [] };
      }
      byHeadline[v.headline].revenue += revenue;
      byHeadline[v.headline].impressions += v.impressions;
      byHeadline[v.headline].conversions += v.conversions;
      byHeadline[v.headline].variants.push(v);

      if (!bySubhead[v.subhead]) {
        bySubhead[v.subhead] = { text: v.subhead, cvr: 0, revenue: 0, impressions: 0, conversions: 0, variants: [] };
      }
      bySubhead[v.subhead].revenue += revenue;
      bySubhead[v.subhead].impressions += v.impressions;
      bySubhead[v.subhead].conversions += v.conversions;
      bySubhead[v.subhead].variants.push(v);

      if (!byCTA[v.cta]) {
        byCTA[v.cta] = { text: v.cta, cvr: 0, revenue: 0, impressions: 0, conversions: 0, variants: [] };
      }
      byCTA[v.cta].revenue += revenue;
      byCTA[v.cta].impressions += v.impressions;
      byCTA[v.cta].conversions += v.conversions;
      byCTA[v.cta].variants.push(v);
    });

    // Calculate weighted averages and sort
    const headlines = Object.values(byHeadline)
      .map(h => ({ ...h, cvr: h.impressions > 0 ? (h.conversions / h.impressions) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const subheads = Object.values(bySubhead)
      .map(s => ({ ...s, cvr: s.impressions > 0 ? (s.conversions / s.impressions) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const ctas = Object.values(byCTA)
      .map(c => ({ ...c, cvr: c.impressions > 0 ? (c.conversions / c.impressions) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { headlines, subheads, ctas };
  };

  const performance = calculatePerformance(filteredVariants);

  const ComponentInsightsExplainer = () => {
    const [expanded, setExpanded] = useState(false);
    return (
      <div style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        marginBottom: 20,
        overflow: 'hidden'
      }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 14,
            fontWeight: 600,
            color: '#374151'
          }}
        >
          What this means
          <span style={{ fontSize: 12, color: '#6b7280' }}>{expanded ? '\u25B2' : '\u25BC'}</span>
        </button>
        {expanded && (
          <div style={{ padding: '0 16px 16px', fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
            The AI tests different combinations of headlines, subheadlines, and call-to-action buttons to find what converts best.
            <strong style={{ color: '#374151' }}> Elite</strong>-tier components significantly outperform the average and get shown to more visitors.
            <strong style={{ color: '#374151' }}> Strong</strong> performers are promising and still being tested.
            <strong style={{ color: '#374151' }}> Average</strong> components show moderate results.
            <strong style={{ color: '#374151' }}> Poor</strong>-tier components are being phased out and will be replaced by new mutations.
          </div>
        )}
      </div>
    );
  };

  const ComponentCard = ({ item, type }) => {
    const tier = getTierColor(item.revenue, avgRevenue);
    const vsAvg = avgRevenue > 0 ? ((item.revenue - avgRevenue) / avgRevenue * 100).toFixed(1) : 0;

    return (
      <div
        onClick={() => setSelectedVariant(item.variants[0])}
        style={{
          background: 'white',
          border: `2px solid ${tier.border}`,
          borderRadius: 8,
          padding: 16,
          marginBottom: 12,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <span style={{
            background: tier.bg,
            color: tier.textColor,
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}>
            {tier.label}
          </span>
          <div style={{ textAlign: 'right', fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: '#111' }}>{item.cvr.toFixed(1)}% CVR</div>
            <div style={{ color: '#666' }}>{item.impressions} imp</div>
          </div>
        </div>

        <div style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: '#111',
          marginBottom: 12,
          minHeight: 42,
          fontWeight: 500
        }}>
          "{item.text}"
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Revenue Impact</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>${item.revenue.toFixed(0)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>vs Average</div>
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: vsAvg >= 0 ? '#16a34a' : '#dc2626'
            }}>
              {vsAvg >= 0 ? '+' : ''}{vsAvg}%
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
          Used in {item.variants.length} variant{item.variants.length !== 1 ? 's' : ''}
        </div>
      </div>
    );
  };

  // Derived stat values for new top cards
  const winningArchetype = displayArchetypes[0] || null;
  const winningArchetypeVsAvg = winningArchetype && displayAvgCvr > 0
    ? ((winningArchetype.cvr - displayAvgCvr) / displayAvgCvr) * 100
    : 0;

  // Parse a composite segmentKey into a human label
  const prettySegmentKey = (key) => {
    if (!key) return 'Not enough data';
    const parts = {};
    for (const tok of key.split('|')) {
      const [k, v] = tok.split(':');
      parts[k] = v;
    }
    const d = parts.d || '?';
    const t = parts.t || '?';
    const a = parts.a || '?';
    const p = parts.p || '?';
    const pr = parts.pr === 'yes' ? 'Promo in cart' : 'No promo';
    const f = parts.f || '?';
    return `${cap(d)} · ${cap(t)} · ${cap(a)} · ${cap(p)} · ${pr} · ${cap(f)}`;
  };

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 32, marginBottom: 8 }}>Performance Intelligence</h1>
            <p style={{ color: '#666', marginBottom: 0 }}>Which archetypes win for which customers — and why the AI is promoting them</p>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: 14 }}>Auto-refresh (30s)</span>
          </label>
        </div>

        {/* Stats Row — Phase 2D: Winning Archetype + Best Segment + Active + Gen */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 1fr 1fr', gap: 20, marginBottom: 32 }}>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
              Winning Archetype
              <InfoIcon tip="The modal pattern (e.g. Threshold Discount, Soft Upsell) with the highest conversion rate in the selected window. An archetype is a coherent combination of headline style, offer type, and CTA — your AI builds variants from these patterns and learns which ones work best." />
            </div>
            {winningArchetype ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>
                  {formatArchetypeName(winningArchetype.archetype)}
                </div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                  {winningArchetype.cvr.toFixed(1)}% CVR
                  {displayAvgCvr > 0 && (
                    <span style={{ marginLeft: 8, color: winningArchetypeVsAvg >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                      {winningArchetypeVsAvg >= 0 ? '+' : ''}{winningArchetypeVsAvg.toFixed(0)}% vs avg
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6 }}>Not enough data yet</div>
            )}
          </div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
              Best Segment
              <InfoIcon tip="The visitor segment (combination of device, traffic source, account status, page, and visit frequency) that is converting at the highest rate. Your AI uses these patterns to decide which modal to show different shoppers in real time." />
            </div>
            {displayBestSegment ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111', lineHeight: 1.4 }}>
                  {prettySegmentKey(displayBestSegment.segmentKey)}
                </div>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                  {displayBestSegment.cvr.toFixed(1)}% CVR · {displayBestSegment.impressions} imp
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6 }}>Need 20+ imps in a segment</div>
            )}
          </div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Active Variants</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#008060' }}>{aliveCount}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{deadCount} eliminated</div>
          </div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Max Generation</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#7c3aed' }}>Gen {generationStats.max}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{totalVariants} all-time</div>
          </div>
        </div>

        {/* Filters Row — Phase 2D: time window + composite facets */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Time Window */}
          <div style={{ display: 'flex', background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 4 }}>
            {['7d', '30d', '90d'].map(w => (
              <button
                key={w}
                onClick={() => setParam('window', w === '30d' ? null : w)}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  background: windowMode === w ? '#111' : 'transparent',
                  color: windowMode === w ? '#fff' : '#666'
                }}
              >
                {w === '7d' ? '7 days' : w === '30d' ? '30 days' : '90 days'}
              </button>
            ))}
          </div>

          {/* Archetype filter */}
          <select
            value={archetypeFilter}
            onChange={(e) => setParam('archetype', e.target.value)}
            style={{
              padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'white'
            }}
          >
            <option value="all">All Archetypes</option>
            {displayArchetypes.map(r => (
              <option key={r.archetype} value={r.archetype}>{formatArchetypeName(r.archetype)}</option>
            ))}
          </select>

          {/* Page Type filter — only show if we have observed data */}
          {displayPageTypes.length > 0 && (
            <select
              value={pageTypeFilter}
              onChange={(e) => setParam('pageType', e.target.value)}
              style={{
                padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb',
                fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'white'
              }}
            >
              <option value="all">All Pages</option>
              {displayPageTypes.map(p => (
                <option key={p} value={p}>{cap(p)}</option>
              ))}
            </select>
          )}

          {/* Modal-offer filter (replaces legacy promo + promoInCart) */}
          <select
            value={offerFilter}
            onChange={(e) => setParam('offer', e.target.value)}
            style={{
              padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'white'
            }}
          >
            <option value="all">All modals</option>
            <option value="with-promo">Modals with a promo</option>
            <option value="no-promo">Modals without a promo</option>
          </select>

          {/* Segment / Customer filter */}
          <select
            value={searchParams.get('segment') || 'all'}
            onChange={(e) => setParam('segment', e.target.value)}
            style={{
              padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'white'
            }}
          >
            <option value="all">All Customers</option>
            <optgroup label="Device Type">
              <option value="desktop">Desktop Only</option>
              <option value="mobile">Mobile Only</option>
              <option value="tablet">Tablet Only</option>
            </optgroup>
            <optgroup label="Account Status">
              <option value="logged-in">Logged In</option>
              <option value="guest">Guest</option>
            </optgroup>
            <optgroup label="Visitor Type">
              <option value="first-time">First-Time Visitors</option>
              <option value="returning">Returning Visitors</option>
            </optgroup>
            <optgroup label="Cart Value">
              <option value="high-value">High Value ($100+)</option>
              <option value="low-value">Low Value (&lt;$50)</option>
            </optgroup>
            <optgroup label="Traffic Source">
              <option value="paid-traffic">Paid Traffic</option>
              <option value="organic-traffic">Organic Traffic</option>
            </optgroup>
          </select>

          <div style={{ marginLeft: 'auto', fontSize: 13, color: '#666' }}>
            Showing {filteredVariants.length} active variants
          </div>
        </div>

        {/* Sub-navigation — Phase 2D: Archetypes | Components | Manage */}
        <div style={{
          display: 'flex',
          gap: 16,
          marginBottom: 24,
          borderBottom: '2px solid #e5e7eb'
        }}>
          <button
            onClick={() => setParam('tab', null)}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: tab === 'archetypes' ? 600 : 400,
              fontSize: 14,
              color: tab === 'archetypes' ? '#008060' : '#666',
              borderBottom: `2px solid ${tab === 'archetypes' ? '#008060' : 'transparent'}`,
              marginBottom: -2
            }}
          >
            Archetypes
          </button>
          <button
            onClick={() => setParam('tab', 'components')}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: tab === 'components' ? 600 : 400,
              fontSize: 14,
              color: tab === 'components' ? '#008060' : '#666',
              borderBottom: `2px solid ${tab === 'components' ? '#008060' : 'transparent'}`,
              marginBottom: -2
            }}
          >
            Component Analysis
          </button>
          <button
            onClick={() => setParam('tab', 'segments')}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: tab === 'segments' ? 600 : 400,
              fontSize: 14,
              color: tab === 'segments' ? '#008060' : '#666',
              borderBottom: `2px solid ${tab === 'segments' ? '#008060' : 'transparent'}`,
              marginBottom: -2
            }}
          >
            Segments
          </button>
          <Link
            to="/app/variants/manage"
            style={{
              padding: '12px 24px',
              textDecoration: 'none',
              fontWeight: 400,
              fontSize: 14,
              color: '#666',
              borderBottom: '2px solid transparent',
              marginBottom: -2
            }}
          >
            Manage Variants
          </Link>
        </div>

        {/* Archetypes Tab (default) — Phase 2D */}
        {tab === 'archetypes' && (
          <div style={{ paddingTop: 24 }}>
            {displayArchetypes.length === 0 ? (
              <div style={{ background: 'white', padding: 60, borderRadius: 12, border: '1px solid #e5e7eb', textAlign: 'center' }}>
                <h3 style={{ fontSize: 20, marginBottom: 8 }}>No archetype data yet</h3>
                <p style={{ color: '#666' }}>
                  Archetypes need at least 10 impressions each before they show up here.
                  Try widening the time window or removing filters.
                </p>
              </div>
            ) : (
              <>
                <div style={{
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 24
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#3730a3', marginBottom: 6 }}>
                    How archetypes work
                  </div>
                  <div style={{ fontSize: 13, color: '#3730a3', lineHeight: 1.6 }}>
                    Each baseline offer maps to an <strong>archetype</strong> — a coherent modal pattern
                    (e.g. "Threshold Discount" pairs a spend-threshold headline with product recommendations and a "Shop Now" CTA).
                    {plan?.tier === 'enterprise' && (
                      <> For Enterprise, the AI biases variant selection toward archetypes that win the current visitor's segment — so logged-in shoppers on mobile may see a different archetype than first-time desktop visitors.</>
                    )}
                    {plan?.tier === 'pro' && (
                      <> Pro runs two variants at a time. When they represent different archetypes, the AI routes visitors by segment — each persona × scenario sees whichever archetype wins for them. When both Pro variants share an archetype, routing is a no-op and standard A/B testing resumes.</>
                    )}
                  </div>
                </div>

                {/* Phase 2G: banner announcing segment-scoped promotion */}
                {showPromotedBadge && displayArchetypes.length > 0 && (
                  <div style={{
                    background: 'linear-gradient(90deg, #fef3c7 0%, #fef9c3 100%)',
                    border: '1px solid #fbbf24',
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}>
                    <div style={{
                      background: '#f59e0b',
                      color: 'white',
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 16,
                      flexShrink: 0
                    }}>
                      ★
                    </div>
                    <div style={{ flex: 1, fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        AI is promoting <strong>{formatArchetypeName(displayArchetypes[0].archetype)}</strong> for
                        {displayFilterDescription ? <> {displayFilterDescription}</> : ' this segment'}
                      </div>
                      <div>
                        When visitors match this filter, selection is biased 1.30× toward rank #1 and 0.85× toward rank #{displayArchetypes.length}.
                        Exploration is preserved — Thompson Sampling still runs.
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
                  {displayArchetypes.map((r, i) => {
                    const vsAvg = displayAvgCvr > 0 ? ((r.cvr - displayAvgCvr) / displayAvgCvr) * 100 : 0;
                    const isWinner = i === 0;
                    const isLoser = displayArchetypes.length >= 2 && i === displayArchetypes.length - 1;
                    const isPromoted = showPromotedBadge && isWinner;
                    const isDemoted = showPromotedBadge && isLoser && !isWinner;
                    const borderColor = isPromoted ? '#f59e0b' : isWinner ? '#16a34a' : '#e5e7eb';
                    return (
                      <div
                        key={r.archetype}
                        onClick={() => setParam('archetype', archetypeFilter === r.archetype ? null : r.archetype)}
                        style={{
                          background: 'white',
                          border: `2px solid ${archetypeFilter === r.archetype ? '#008060' : borderColor}`,
                          borderRadius: 12,
                          padding: 20,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                              Rank #{i + 1}
                              {isPromoted ? (
                                <span style={{ marginLeft: 8, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                  ★ PROMOTED
                                </span>
                              ) : isWinner && (
                                <span style={{ marginLeft: 8, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 4, fontSize: 10 }}>
                                  WINNER
                                </span>
                              )}
                              {isDemoted && (
                                <span style={{ marginLeft: 8, background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 4, fontSize: 10 }}>
                                  ↓ DEMOTED
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginTop: 4 }}>
                              {formatArchetypeName(r.archetype)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#111' }}>{r.cvr.toFixed(1)}%</div>
                            <div style={{ fontSize: 11, color: '#6b7280' }}>CVR</div>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                          <div>
                            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>CTR</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{r.ctr.toFixed(1)}%</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>RPI</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>${r.rpi.toFixed(2)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Imp</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{r.impressions.toLocaleString()}</div>
                          </div>
                        </div>
                        {displayAvgCvr > 0 && (
                          <div style={{
                            marginTop: 12,
                            fontSize: 12,
                            color: vsAvg >= 0 ? '#16a34a' : '#dc2626',
                            fontWeight: 600
                          }}>
                            {vsAvg >= 0 ? '+' : ''}{vsAvg.toFixed(0)}% vs archetype average
                          </div>
                        )}
                        <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>
                          {archetypeFilter === r.archetype
                            ? 'Filtering components to this archetype. Click to clear.'
                            : 'Click to filter the Components tab to this archetype.'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Network Benchmark tab removed — moved to dev-only roadmap (see ROADMAP.md "Dev-only network benchmark"). */}

        {/* Segments Tab — Phase 2H: archetype × segmentKey heatmap */}
        {tab === 'segments' && (
          <div style={{ paddingTop: 24 }}>
            {displayHeatmap.segments.length === 0 || displayHeatmap.archetypes.length === 0 ? (
              <div style={{ background: 'white', padding: 60, borderRadius: 12, border: '1px solid #e5e7eb', textAlign: 'center' }}>
                <h3 style={{ fontSize: 20, marginBottom: 8 }}>Not enough segment data yet</h3>
                <p style={{ color: '#666', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
                  We need at least 20 impressions per segment and 10 per archetype before drawing the heatmap.
                  Try widening the time window, or wait until more traffic accrues.
                </p>
              </div>
            ) : (
              <>
                <div style={{
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 24
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#3730a3', marginBottom: 6 }}>
                    Where each archetype wins
                  </div>
                  <div style={{ fontSize: 13, color: '#3730a3', lineHeight: 1.6 }}>
                    Rows are visitor segments (device · traffic · account · page · promo-in-cart · frequency).
                    Columns are archetypes. Each cell shows the conversion rate of that archetype for that segment.
                    Greener = higher CVR, redder = lower. The outlined cell on each row is the archetype the AI
                    promotes for that segment at runtime.
                  </div>
                </div>

                <HeatmapTable heatmap={displayHeatmap} avgCvr={displayAvgCvr} formatArchetypeName={formatArchetypeName} />

                <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
                  Cells with fewer than {displayHeatmap.minCellImps} impressions are dimmed (low confidence).
                  Empty cells (—) had no impressions of that archetype in this segment for the selected window.
                  Top {displayHeatmap.segments.length} segments shown by impression volume.
                </div>
              </>
            )}
          </div>
        )}

        {/* Component Analysis Content */}
        {tab === 'components' && (
        <div style={{ paddingTop: 24 }}>
          {filteredVariants.length === 0 ? (
            <div style={{ background: 'white', padding: 60, borderRadius: 12, border: '1px solid #e5e7eb', textAlign: 'center' }}>
              <h3 style={{ fontSize: 20, marginBottom: 8 }}>No variants yet</h3>
              <p style={{ color: '#666' }}>Variants will appear once you start getting traffic in AI mode.</p>
            </div>
          ) : (
            <>
            {/* What This Means Explainer */}
            <ComponentInsightsExplainer />

            {/* Per-Component Insights */}
            {(() => {
              const avgCVR = filteredVariants.length > 0
                ? filteredVariants.reduce((s, v) => s + (v.impressions > 0 ? v.conversions / v.impressions * 100 : 0), 0) / filteredVariants.length
                : 0;

              const topHeadline = performance.headlines[0];
              const topCta = performance.ctas[0];
              const topSubhead = performance.subheads[0];

              const insights = [];
              if (topHeadline && topHeadline.cvr > avgCVR && avgCVR > 0) {
                insights.push(`Your best headline "${topHeadline.text}" converts ${(topHeadline.cvr - avgCVR).toFixed(1)} pts better than average. The AI is using it more often.`);
              }
              if (topCta && topCta.impressions > 0) {
                insights.push(`Visitors respond best to "${topCta.text}" — consider using similar language in your manual campaigns.`);
              }
              if (topSubhead && topSubhead.revenue > 0) {
                insights.push(`"${topSubhead.text}" generates $${Math.round(topSubhead.revenue).toLocaleString()} in revenue impact.`);
              }

              if (insights.length === 0) return null;

              return (
                <div style={{
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 24
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0369a1', marginBottom: 8 }}>Key Insights</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {insights.map((insight, i) => (
                      <li key={i} style={{ fontSize: 14, color: '#0c4a6e', lineHeight: 1.6, marginBottom: 4 }}>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
              {/* Headlines Column */}
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                  Headlines
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#666', marginLeft: 8 }}>
                    (Top {performance.headlines.length})
                  </span>
                </h3>
                {performance.headlines.map((item, i) => (
                  <ComponentCard key={i} item={item} type="headline" />
                ))}
              </div>

              {/* Subheads Column */}
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                  Subheads
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#666', marginLeft: 8 }}>
                    (Top {performance.subheads.length})
                  </span>
                </h3>
                {performance.subheads.map((item, i) => (
                  <ComponentCard key={i} item={item} type="subhead" />
                ))}
              </div>

              {/* CTAs Column */}
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
                  CTAs
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#666', marginLeft: 8 }}>
                    (Top {performance.ctas.length})
                  </span>
                </h3>
                {performance.ctas.map((item, i) => (
                  <ComponentCard key={i} item={item} type="cta" />
                ))}
              </div>
            </div>
            </>
          )}
        </div>
        )}

        {/* Modal for Variant Details */}
        {selectedVariant && (
          <div
            onClick={() => setSelectedVariant(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 20
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'white',
                borderRadius: 12,
                padding: 40,
                maxWidth: 700,
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                  <h2 style={{ fontSize: 24, marginBottom: 8 }}>Variant Details</h2>
                  <p style={{ color: '#666', fontSize: 14 }}>{selectedVariant.variantId}</p>
                </div>
                <button
                  onClick={() => setSelectedVariant(null)}
                  style={{
                    background: '#f3f4f6',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 14
                  }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Conversion Rate</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {selectedVariant.impressions > 0 ? ((selectedVariant.conversions / selectedVariant.impressions) * 100).toFixed(1) : '0.0'}%
                  </div>
                </div>
                <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Revenue/Impression</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>${selectedVariant.profitPerImpression.toFixed(2)}</div>
                </div>
                <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Impressions</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{selectedVariant.impressions}</div>
                </div>
                <div style={{ background: '#f9fafb', padding: 16, borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Generation</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>Gen {selectedVariant.generation}</div>
                </div>
              </div>

              <div style={{ borderTop: '2px solid #e5e7eb', paddingTop: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Copy Components</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Headline</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>"{selectedVariant.headline}"</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Subhead</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>"{selectedVariant.subhead}"</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>CTA</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>"{selectedVariant.cta}"</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Offer Amount</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>${selectedVariant.offerAmount}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Redirect</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>{selectedVariant.redirect || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Urgency</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>{selectedVariant.urgency ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ----- Phase 2H: heatmap subcomponent -----
// Pure presentation. Receives the precomputed heatmap object from the loader.
// Color uses a divergent scale around the per-row median to make hot/cold
// archetypes pop within each segment, instead of all cells looking similar
// when archetype CVRs are globally close together.

function cvrCellColor(cvr, rowMedian) {
  // Divergent palette: green above row median, red below. Strength scales
  // with absolute distance from median, capped so extreme outliers don't
  // dominate visually.
  const delta = cvr - rowMedian;
  const intensity = Math.min(1, Math.abs(delta) / 2.0); // 2pt = full saturation
  if (delta >= 0) {
    // Green tint
    const a = 0.10 + intensity * 0.55;
    return `rgba(34, 197, 94, ${a.toFixed(2)})`;
  }
  // Red tint
  const a = 0.10 + intensity * 0.45;
  return `rgba(239, 68, 68, ${a.toFixed(2)})`;
}

function formatSegmentLabel(segmentKey) {
  const parsed = parseSegmentKey(segmentKey);
  if (!parsed) return segmentKey; // legacy / malformed key — show raw
  const parts = [];
  if (parsed.deviceType) parts.push(parsed.deviceType);
  if (parsed.trafficSource) parts.push(parsed.trafficSource);
  if (parsed.accountStatus) parts.push(parsed.accountStatus);
  if (parsed.pageType) parts.push(parsed.pageType);
  if (parsed.promoInCart) parts.push('promo-in-cart');
  if (parsed.frequencyBucket) parts.push(parsed.frequencyBucket);
  return parts.join(' · ');
}

function HeatmapTable({ heatmap, avgCvr, formatArchetypeName }) {
  const { archetypes, segments, cells, winners } = heatmap;

  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: '#f9fafb' }}>
          <tr>
            <th style={{
              padding: '12px 16px',
              textAlign: 'left',
              fontWeight: 600,
              color: '#374151',
              borderBottom: '1px solid #e5e7eb',
              position: 'sticky',
              left: 0,
              background: '#f9fafb',
              minWidth: 260
            }}>
              Segment
            </th>
            <th style={{
              padding: '12px 12px',
              textAlign: 'right',
              fontWeight: 600,
              color: '#374151',
              borderBottom: '1px solid #e5e7eb',
              minWidth: 80
            }}>
              Imp
            </th>
            {archetypes.map(arch => (
              <th key={arch} style={{
                padding: '12px 12px',
                textAlign: 'center',
                fontWeight: 600,
                color: '#374151',
                borderBottom: '1px solid #e5e7eb',
                minWidth: 110,
                fontSize: 12
              }}>
                {formatArchetypeName(arch)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map(seg => {
            // Compute per-row median for divergent coloring
            const rowCvrs = archetypes
              .map(a => cells[seg.key]?.[a])
              .filter(c => c && !c.lowConfidence)
              .map(c => c.cvr);
            const rowMedian = rowCvrs.length > 0
              ? rowCvrs.slice().sort((a, b) => a - b)[Math.floor(rowCvrs.length / 2)]
              : avgCvr;
            const winnerArch = winners[seg.key];

            return (
              <tr key={seg.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{
                  padding: '12px 16px',
                  color: '#111',
                  position: 'sticky',
                  left: 0,
                  background: 'white',
                  borderRight: '1px solid #f3f4f6'
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
                    {formatSegmentLabel(seg.key)}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    overall {seg.cvr.toFixed(1)}% CVR
                  </div>
                </td>
                <td style={{
                  padding: '12px 12px',
                  textAlign: 'right',
                  color: '#6b7280',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {seg.impressions.toLocaleString()}
                </td>
                {archetypes.map(arch => {
                  const cell = cells[seg.key]?.[arch];
                  if (!cell) {
                    return (
                      <td key={arch} style={{
                        padding: '12px 12px',
                        textAlign: 'center',
                        color: '#d1d5db',
                        fontSize: 13
                      }}>
                        —
                      </td>
                    );
                  }
                  const isWinner = winnerArch === arch;
                  const bg = cell.lowConfidence ? 'transparent' : cvrCellColor(cell.cvr, rowMedian);
                  return (
                    <td key={arch} style={{
                      padding: 4,
                      textAlign: 'center'
                    }}>
                      <div style={{
                        background: bg,
                        border: isWinner ? '2px solid #f59e0b' : '1px solid transparent',
                        borderRadius: 6,
                        padding: '8px 6px',
                        opacity: cell.lowConfidence ? 0.45 : 1,
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>
                          {cell.cvr.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                          {cell.impressions.toLocaleString()} imp
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
