import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { useEffect, useState } from "react";
import AppLayout from "../components/AppLayout";
import db from "../db.server";
import { getShopPlan } from "../utils/plan.server";

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

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  try {
  // Get filters from URL
  const url = new URL(request.url);
  const promoFilter = url.searchParams.get('promo') || 'all';
  const segmentFilter = url.searchParams.get('segment') || 'all';
  // Phase 2D filters
  const windowFilter = url.searchParams.get('window') || '30d';          // 7d | 30d | 90d
  const archetypeFilter = url.searchParams.get('archetype') || 'all';
  const pageTypeFilter = url.searchParams.get('pageType') || 'all';
  const promoInCartFilter = url.searchParams.get('promoInCart') || 'all'; // all | yes | no
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
      filters: { promo: 'all', segment: 'all' }
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

  // Phase 2D: promoInCart filter (customer has a discount code in cart right now)
  if (promoInCartFilter === 'yes') {
    whereClause.promoInCart = true;
  } else if (promoInCartFilter === 'no') {
    whereClause.promoInCart = false;
  }

  // Apply promo context filter (store-wide promotion running)
  if (promoFilter === 'no-promo') {
    whereClause.duringPromo = false;
  } else if (promoFilter === 'during-promo') {
    whereClause.duringPromo = true;
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
    filters: {
      promo: promoFilter,
      segment: segmentFilter,
      window: windowFilter,
      archetype: archetypeFilter,
      pageType: pageTypeFilter,
      promoInCart: promoInCartFilter,
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
      filters: { promo: 'all', segment: 'all', window: '30d', archetype: 'all', pageType: 'all', promoInCart: 'all', tab: 'archetypes' },
      dbError: true
    };
  }
}

export default function VariantsIndex() {
  const data = useLoaderData();
  const {
    hasAccess, shop, plan, variants, totalVariants, aliveCount, deadCount,
    generationStats, componentStats, dbError,
    archetypeRankings = [], avgArchetypeCvr = 0, bestSegment = null, observedPageTypes = []
  } = data;
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState(null);

  const promoMode = searchParams.get('promo') || 'all';
  const windowMode = searchParams.get('window') || '30d';
  const archetypeFilter = searchParams.get('archetype') || 'all';
  const pageTypeFilter = searchParams.get('pageType') || 'all';
  const promoInCartFilter = searchParams.get('promoInCart') || 'all';
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
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Winning Archetype</div>
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
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Best Segment</div>
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

          {/* Promo-in-cart filter */}
          <select
            value={promoInCartFilter}
            onChange={(e) => setParam('promoInCart', e.target.value)}
            style={{
              padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb',
              fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'white'
            }}
          >
            <option value="all">Promo in cart: any</option>
            <option value="yes">Promo in cart: yes</option>
            <option value="no">Promo in cart: no</option>
          </select>
        </div>

        {/* Legacy promo + segment filters (kept for backwards compat) */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 32, alignItems: 'center' }}>
          {/* Promo Toggle */}
          <div style={{ display: 'flex', background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 4 }}>
            <button
              onClick={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.set('promo', 'all');
                setSearchParams(newParams);
              }}
              style={{
                padding: '8px 20px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                background: promoMode === 'all' ? '#111' : 'transparent',
                color: promoMode === 'all' ? '#fff' : '#666',
                transition: 'all 0.2s'
              }}
            >
              All
            </button>
            <button
              onClick={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.set('promo', 'no-promo');
                setSearchParams(newParams);
              }}
              style={{
                padding: '8px 20px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                background: promoMode === 'no-promo' ? '#111' : 'transparent',
                color: promoMode === 'no-promo' ? '#fff' : '#666',
                transition: 'all 0.2s'
              }}
            >
              No Promo
            </button>
            <button
              onClick={() => {
                const newParams = new URLSearchParams(searchParams);
                newParams.set('promo', 'during-promo');
                setSearchParams(newParams);
              }}
              style={{
                padding: '8px 20px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                background: promoMode === 'during-promo' ? '#111' : 'transparent',
                color: promoMode === 'during-promo' ? '#fff' : '#666',
                transition: 'all 0.2s'
              }}
            >
              During Promo
            </button>
          </div>

          {/* Segment Filter */}
          <select
            value={searchParams.get('segment') || 'all'}
            onChange={(e) => {
              const newParams = new URLSearchParams(searchParams);
              newParams.set('segment', e.target.value);
              setSearchParams(newParams);
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              background: 'white'
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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
                  {displayArchetypes.map((r, i) => {
                    const vsAvg = displayAvgCvr > 0 ? ((r.cvr - displayAvgCvr) / displayAvgCvr) * 100 : 0;
                    const isWinner = i === 0;
                    const borderColor = isWinner ? '#16a34a' : '#e5e7eb';
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
                              {isWinner && (
                                <span style={{ marginLeft: 8, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 4, fontSize: 10 }}>
                                  WINNER
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
