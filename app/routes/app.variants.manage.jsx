import { useLoaderData, useFetcher, Link, useSearchParams, Form, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { useEffect, useState } from "react";
import AppLayout from "../components/AppLayout";
import db from "../db.server";

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const action = formData.get("action");
    const variantId = formData.get('variantId');

    if (action === 'updateStatus' && variantId) {
      const newStatus = formData.get('status');
      const variant = await db.variant.findUnique({
        where: { id: variantId }
      });

      if (!variant) {
        return { error: 'Variant not found', success: false };
      }

      // Handle status change
      if (newStatus === 'alive') {
        await db.variant.update({
          where: { id: variantId },
          data: {
            status: 'alive',
            isChampion: false
          }
        });
        return { success: true, message: 'Variant set to Active' };
      }

      if (newStatus === 'protected') {
        await db.variant.update({
          where: { id: variantId },
          data: {
            status: 'protected',
            isChampion: false
          }
        });
        return { success: true, message: 'Variant protected from evolution' };
      }

      if (newStatus === 'champion') {
        // Clear any existing champion for this baseline + segment combo
        await db.variant.updateMany({
          where: {
            shopId: variant.shopId,
            baseline: variant.baseline,
            segment: variant.segment
          },
          data: { isChampion: false }
        });

        await db.variant.update({
          where: { id: variantId },
          data: {
            status: 'champion',
            isChampion: true
          }
        });

        return { success: true, message: 'Variant set as champion' };
      }
    }

    if (action === 'killVariant' && variantId) {
      await db.variant.update({
        where: { id: variantId },
        data: {
          status: 'killed'
        }
      });

      return redirect('/app/variants/manage');
    }

    return { success: false, error: 'Invalid action' };
  } catch (error) {
    console.error('Action error:', error);
    return { error: error.message, success: false };
  }
}

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
    return { variants: [], shop: null, plan: null };
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
    where: whereClause
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

  const totalVariants = variants.length;
  const aliveCount = variants.filter(v => v.status === 'alive' || v.status === 'champion').length;
  const deadCount = variants.filter(v => v.status === 'killed').length;
  const maxGeneration = variants.length > 0 ? Math.max(...variants.map(v => v.generation)) : 0;

  return {
    shop,
    plan,
    variants,
    totalVariants,
    aliveCount,
    deadCount,
    generationStats: {
      max: maxGeneration
    },
    filters: {
      promo: promoFilter,
      segment: segmentFilter
    }
  };
}

export default function ManageVariants() {
  const data = useLoaderData();
  const { shop, plan, variants, totalVariants, aliveCount, deadCount, generationStats } = data;
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const promoMode = searchParams.get('promo') || 'all';

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetcher.load(`/app/variants/manage?promo=${promoMode}`);
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
          <h1>Manage Variants</h1>
          <p>No shop data found.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 32, marginBottom: 8 }}>Variant Performance</h1>
            <p style={{ color: '#666', marginBottom: 0 }}>Manage variant lifecycle and performance</p>
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
            Showing {displayVariants.filter(v => v.status !== 'killed').length} active variants
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
              fontWeight: 400,
              fontSize: 14,
              color: '#666',
              borderBottom: '2px solid transparent',
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
              fontWeight: 600,
              fontSize: 14,
              color: '#008060',
              borderBottom: '2px solid #008060',
              marginBottom: -2
            }}
          >
            Manage Variants
          </Link>
        </div>

        {/* Manage Variants Table */}
        <div style={{ paddingTop: 24 }}>
          {displayVariants.length === 0 ? (
            <div style={{ background: 'white', padding: 60, borderRadius: 12, border: '1px solid #e5e7eb', textAlign: 'center' }}>
              <h3 style={{ fontSize: 20, marginBottom: 8 }}>No variants yet</h3>
              <p style={{ color: '#666' }}>Variants will appear once you start getting traffic in AI mode.</p>
            </div>
          ) : (
            <div style={{
              background: "white",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              overflow: "hidden"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Variant</th>
                    <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Headline</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Shown</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Orders</th>
                    <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Revenue</th>
                    <th style={{ padding: 16, textAlign: "center", fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayVariants
                    .filter(v => v.status !== 'killed')
                    .map((variant) => {
                      const conversionRate = variant.impressions > 0
                        ? ((variant.conversions / variant.impressions) * 100).toFixed(1)
                        : 0;
                      const revenue = (variant.profitPerImpression * variant.impressions);

                      return (
                        <tr
                          key={variant.id}
                          style={{
                            borderBottom: "1px solid #e5e7eb",
                            background: variant.isChampion ? "#f0fdf4" : variant.status === 'protected' ? "#fef3c7" : "white"
                          }}
                        >
                          <td style={{ padding: 16 }}>
                            <div style={{ fontWeight: 500, marginBottom: 4 }}>
                              {variant.variantId}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              Gen {variant.generation} · {variant.baseline}
                            </div>
                            {variant.isChampion && (
                              <span style={{
                                display: 'inline-block',
                                marginTop: 4,
                                padding: "2px 6px",
                                background: "#10b981",
                                color: "white",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 600
                              }}>
                                CHAMPION
                              </span>
                            )}
                            {variant.status === 'protected' && (
                              <span style={{
                                display: 'inline-block',
                                marginTop: 4,
                                padding: "2px 6px",
                                background: "#f59e0b",
                                color: "white",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 600
                              }}>
                                PROTECTED
                              </span>
                            )}
                          </td>
                          <td style={{ padding: 16, maxWidth: 300 }}>
                            <div style={{ fontSize: 14, marginBottom: 4 }}>
                              {variant.headline}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              {variant.cta}
                            </div>
                          </td>
                          <td style={{ padding: 16, textAlign: "right" }}>
                            {variant.impressions.toLocaleString()}
                          </td>
                          <td style={{ padding: 16, textAlign: "right" }}>
                            {variant.conversions.toLocaleString()}
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              {conversionRate}%
                            </div>
                          </td>
                          <td style={{ padding: 16, textAlign: "right", fontWeight: 600, color: "#10b981" }}>
                            ${revenue.toFixed(0)}
                          </td>
                          <td style={{ padding: 16 }}>
                            <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
                              <Form method="post" style={{ margin: 0 }}>
                                <input type="hidden" name="action" value="updateStatus" />
                                <input type="hidden" name="variantId" value={variant.id} />
                                <select
                                  name="status"
                                  defaultValue={variant.isChampion ? 'champion' : variant.status}
                                  onChange={(e) => e.target.form.requestSubmit()}
                                  style={{
                                    padding: "6px 12px",
                                    border: "1px solid #d1d5db",
                                    borderRadius: 4,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    background: "white"
                                  }}
                                >
                                  <option value="alive">Active</option>
                                  <option value="protected">Protected</option>
                                  <option value="champion">Champion</option>
                                </select>
                              </Form>

                              <button
                                type="button"
                                style={{
                                  padding: "6px 12px",
                                  background: "#ef4444",
                                  color: "white",
                                  border: "none",
                                  borderRadius: 4,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer"
                                }}
                                title="Permanently remove this variant"
                                onClick={() => {
                                  if (confirm('Are you sure you want to kill this variant? This action cannot be undone.')) {
                                    fetcher.submit(
                                      { action: 'killVariant', variantId: variant.id },
                                      { method: 'post' }
                                    );
                                  }
                                }}
                              >
                                Kill
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
