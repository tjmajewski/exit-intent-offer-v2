import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { useEffect, useState } from "react";
import AppLayout from "../components/AppLayout";
import db from "../db.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  // Get filters from URL
  const url = new URL(request.url);
  const promoFilter = url.searchParams.get('promo') || 'all';
  const segmentFilter = url.searchParams.get('segment') || 'all';

  // Get shop from database
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });

  if (!shop) {
    return json({ variants: [], shop: null, plan: null });
  }

  // Map plan string to tier
  const planTier = shop.plan === 'enterprise' ? 'enterprise' : shop.plan === 'pro' ? 'pro' : 'starter';
  const plan = { tier: planTier };

  // Get all variants for this shop
  const allVariants = await db.variant.findMany({
    where: { shopId: shop.id },
    include: {
      impressionRecords: true
    }
  });

  // Build where clause for filtered impressions
  const whereClause = { shopId: shop.id };

  // Apply promo context filter
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

  return json({
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
    filters: {
      promo: promoFilter,
      segment: segmentFilter
    }
  });
}

export default function VariantsIndex() {
  const data = useLoaderData();
  const { shop, plan, variants, totalVariants, aliveCount, deadCount, generationStats, componentStats } = data;
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState(null);

  const promoMode = searchParams.get('promo') || 'all';

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetcher.load(`/app/variants?promo=${promoMode}`);
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, fetcher, promoMode]);

  // Use fetcher data if available, otherwise use initial data
  const displayData = fetcher.data || data;
  const displayVariants = displayData.variants || variants;

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

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 32, marginBottom: 8 }}>Variant Performance</h1>
            <p style={{ color: '#666', marginBottom: 0 }}>Analyze top performing copy across your exit offers</p>
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

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 32 }}>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Total Variants</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{totalVariants}</div>
          </div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Active</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#008060' }}>{aliveCount}</div>
          </div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Eliminated</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#bf0711' }}>{deadCount}</div>
          </div>
          <div style={{ background: 'white', padding: 20, borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Max Generation</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#7c3aed' }}>Gen {generationStats.max}</div>
          </div>
        </div>

        {/* Filters Row */}
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

        {/* Sub-navigation */}
        <div style={{
          display: 'flex',
          gap: 16,
          marginBottom: 24,
          borderBottom: '2px solid #e5e7eb'
        }}>
          <Link
            to="/app/variants"
            style={{
              padding: '12px 24px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
              color: '#008060',
              borderBottom: '2px solid #008060',
              marginBottom: -2
            }}
          >
            Component Analysis
          </Link>
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

        {/* Component Analysis Content */}
        <div style={{ paddingTop: 24 }}>
          {filteredVariants.length === 0 ? (
            <div style={{ background: 'white', padding: 60, borderRadius: 12, border: '1px solid #e5e7eb', textAlign: 'center' }}>
              <h3 style={{ fontSize: 20, marginBottom: 8 }}>No variants yet</h3>
              <p style={{ color: '#666' }}>Variants will appear once you start getting traffic in AI mode.</p>
            </div>
          ) : (
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
          )}
        </div>

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
