import { useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { syncSubscriptionToPlan } from "../utils/billing.server";
import db from "../db.server";
import AppLayout from "../components/AppLayout";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query {
        shop {
          id
          currencyCode
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);

    const data = await response.json();
    const currencyCode = data.data.shop?.currencyCode || "USD";
    let plan = data.data.shop?.plan?.value
      ? JSON.parse(data.data.shop.plan.value)
      : { tier: "starter" };

    // Sync subscription state with DB (self-heals if billing callback missed)
    const syncedTier = await syncSubscriptionToPlan(admin, session, db);
    if (syncedTier) {
      plan = { ...plan, tier: syncedTier };
    }

    const shopDomain = session.shop;
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain }
    });

    // Fallback to DB value if sync returned null
    if (!syncedTier && shopRecord?.plan) {
      plan = { ...plan, tier: shopRecord.plan };
    }

    // Enterprise-only feature
    if (plan.tier !== 'enterprise') {
      return {
        hasAccess: false,
        promotions: [],
        unseenCount: 0,
        newPromotions: [],
        plan,
        currencyCode,
        impactMetrics: null
      };
    }

    if (!shopRecord) {
      return {
        hasAccess: true,
        promotions: [],
        unseenCount: 0,
        newPromotions: [],
        intelligenceEnabled: true,
        plan,
        currencyCode,
        impactMetrics: null
      };
    }

    // Get all promotions (active and ended)
    const promotions = await db.promotion.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { detectedAt: 'desc' }
    });

    // Count unseen promotions
    const unseenCount = promotions.filter(p => !p.seenByMerchant && p.status === 'active').length;

    // Get "new" promotions (detected in last 48 hours and unseen)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const newPromotions = promotions.filter(p =>
      !p.seenByMerchant &&
      p.status === 'active' &&
      new Date(p.detectedAt) > twoDaysAgo
    );

    // Mark all active promotions as seen
    if (unseenCount > 0) {
      await db.promotion.updateMany({
        where: {
          shopId: shopRecord.id,
          status: 'active',
          seenByMerchant: false
        },
        data: { seenByMerchant: true }
      });
    }

    // Impact metrics: compare performance during vs outside promos
    // Uses @@index([shopId, duringPromo]) for fast queries
    let impactMetrics = null;
    try {
      const [duringPromoAgg, outsidePromoAgg, duringPromoConverted, outsidePromoConverted] = await Promise.all([
        db.variantImpression.aggregate({
          where: { shopId: shopRecord.id, duringPromo: true },
          _count: true,
          _sum: { revenue: true, profit: true, discountAmount: true },
        }),
        db.variantImpression.aggregate({
          where: { shopId: shopRecord.id, duringPromo: false },
          _count: true,
          _sum: { revenue: true, profit: true },
        }),
        db.variantImpression.count({
          where: { shopId: shopRecord.id, duringPromo: true, converted: true }
        }),
        db.variantImpression.count({
          where: { shopId: shopRecord.id, duringPromo: false, converted: true }
        })
      ]);

      const duringTotal = duringPromoAgg._count || 0;
      const outsideTotal = outsidePromoAgg._count || 0;

      impactMetrics = {
        marginProtected: Math.round(duringPromoAgg._sum?.discountAmount || 0),
        duringPromo: {
          impressions: duringTotal,
          conversions: duringPromoConverted,
          cvr: duringTotal > 0 ? (duringPromoConverted / duringTotal * 100).toFixed(1) : '0.0',
          revenue: Math.round(duringPromoAgg._sum?.revenue || 0),
          profit: Math.round(duringPromoAgg._sum?.profit || 0)
        },
        outsidePromo: {
          impressions: outsideTotal,
          conversions: outsidePromoConverted,
          cvr: outsideTotal > 0 ? (outsidePromoConverted / outsideTotal * 100).toFixed(1) : '0.0',
          revenue: Math.round(outsidePromoAgg._sum?.revenue || 0),
          profit: Math.round(outsidePromoAgg._sum?.profit || 0)
        }
      };
    } catch (e) {
      console.error("Error computing promo impact metrics:", e);
    }

    return {
      hasAccess: true,
      promotions: promotions.map(p => ({
        ...p,
        usageStats: JSON.parse(p.usageStats),
        merchantOverride: p.merchantOverride ? JSON.parse(p.merchantOverride) : null
      })),
      unseenCount,
      newPromotions: newPromotions.map(p => ({
        ...p,
        usageStats: JSON.parse(p.usageStats),
        merchantOverride: p.merchantOverride ? JSON.parse(p.merchantOverride) : null
      })),
      intelligenceEnabled: shopRecord.promotionalIntelligenceEnabled ?? true,
      plan,
      currencyCode,
      impactMetrics
    };
  } catch (error) {
    console.error("Error loading promotions:", error);
    return {
      hasAccess: false,
      promotions: [],
      unseenCount: 0,
      newPromotions: [],
      plan: { tier: "starter" },
      currencyCode: "USD",
      impactMetrics: null
    };
  }
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "toggleIntelligence") {
      const enabled = formData.get("enabled") === "true";
      const shopDomain = session.shop;

      const shopRecord = await db.shop.findUnique({
        where: { shopifyDomain: shopDomain }
      });

      if (shopRecord) {
        await db.shop.update({
          where: { id: shopRecord.id },
          data: { promotionalIntelligenceEnabled: enabled }
        });
        console.log(` Promotional Intelligence ${enabled ? 'enabled' : 'disabled'}`);
      }

      return { success: true };
    }

    const promoId = formData.get("promoId");

    if (actionType === "updateStrategy") {
      const newStrategy = formData.get("strategy");
      const customAggression = formData.get("customAggression");

      let merchantOverride = null;

      if (newStrategy === "pause") {
        merchantOverride = JSON.stringify({ type: "pause" });
      } else if (newStrategy === "force_zero") {
        merchantOverride = JSON.stringify({ type: "force_zero" });
      } else if (newStrategy === "custom") {
        merchantOverride = JSON.stringify({
          type: "custom",
          customAggression: parseInt(customAggression)
        });
      }

      await db.promotion.update({
        where: { id: promoId },
        data: {
          merchantOverride,
          aiStrategy: newStrategy === "auto" ? null : newStrategy
        }
      });

      console.log(` Promotion strategy updated: ${promoId} → ${newStrategy}`);
    }

    if (actionType === "endPromo") {
      await db.promotion.update({
        where: { id: promoId },
        data: { status: "ended" }
      });

      console.log(` Promotion ended: ${promoId}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Promotion action error:", error);
    return { success: false, error: error.message };
  }
}

// Helper functions
function getStrategyColor(strategy) {
  switch(strategy) {
    case 'pause': return '#ef4444';
    case 'decrease': return '#f59e0b';
    case 'continue': return '#10b981';
    case 'ignore': return '#6b7280';
    default: return '#3b82f6';
  }
}

function getStrategyLabel(strategy) {
  switch(strategy) {
    case 'pause': return 'AI Paused';
    case 'decrease': return 'Decreased Offers';
    case 'continue': return 'Continue Normal';
    case 'ignore': return 'Ignored';
    default: return 'Auto';
  }
}

function getClassificationLabel(classification) {
  switch(classification) {
    case 'site_wide': return 'Site-Wide';
    case 'targeted': return 'Targeted';
    case 'customer_service': return 'Customer Service';
    default: return 'Monitoring';
  }
}

export default function PromotionsPage() {
  const { hasAccess, promotions, unseenCount, newPromotions, intelligenceEnabled, plan, currencyCode, impactMetrics } = useLoaderData();
  const fetcher = useFetcher();
  const [isIntelligenceEnabled, setIsIntelligenceEnabled] = useState(intelligenceEnabled);
  const [showAllPast, setShowAllPast] = useState(false);

  // Format a promo discount amount with correct currency symbol placement.
  // Percentage discounts always show as "10% off". Fixed-amount discounts use
  // Intl.NumberFormat so the symbol is placed correctly for the shop's currency
  // (e.g. "$10 off" for USD, "10 € off" for EUR).
  const formatDiscount = (amount, type) => {
    if (type === 'percentage') return `${amount}% off`;
    try {
      const locale = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      const formatted = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currencyCode || "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(Number(amount) || 0);
      return `${formatted} off`;
    } catch {
      return `${currencyCode || "USD"} ${amount} off`;
    }
  };

  // Non-Enterprise users see upgrade page
  if (!hasAccess) {
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
              Promotional Intelligence is only available on Enterprise plans.
              Automatically detect site-wide sales and adjust your AI strategy to protect margins.
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

  const activePromotions = promotions.filter(p => p.status === 'active');
  const endedPromotions = promotions.filter(p => p.status === 'ended');
  const pausedCount = promotions.filter(p => p.aiStrategy === 'pause' || p.aiStrategy === 'decrease').length;

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 32, marginBottom: 8 }}>Promotional Intelligence</h1>
            <p style={{ color: "#666", marginBottom: 0 }}>
              Automatically detects your promotions and adjusts exit offers to protect margins
            </p>
          </div>

          <label style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            cursor: "pointer",
            padding: 12,
            background: "white",
            borderRadius: 8,
            border: "1px solid #e5e7eb"
          }}>
            <input
              type="checkbox"
              checked={isIntelligenceEnabled}
              onChange={(e) => {
                const newValue = e.target.checked;
                setIsIntelligenceEnabled(newValue);
                fetcher.submit(
                  {
                    actionType: "toggleIntelligence",
                    enabled: String(newValue)
                  },
                  { method: "post" }
                );
              }}
              style={{ width: 20, height: 20 }}
            />
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {isIntelligenceEnabled ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>

        {/* Disabled Warning */}
        {!isIntelligenceEnabled && (
          <div style={{
            padding: 20,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 8,
            marginBottom: 24,
            color: "#92400e"
          }}>
            <strong>Promotional Intelligence is disabled.</strong> The AI will not automatically adjust your strategy when promotions are detected. Enable it above to let AI optimize your offers during sales.
          </div>
        )}

        {/* New Promotion Alert */}
        {newPromotions && newPromotions.length > 0 && (
          <div style={{
            padding: 20,
            background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
            borderRadius: 8,
            marginBottom: 24,
            color: "#78350f",
            border: "2px solid #f59e0b"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#78350f",
                color: "#fbbf24",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 16
              }}>
                {newPromotions.length}
              </div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                New Promotion{newPromotions.length > 1 ? 's' : ''} Detected
              </h3>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {newPromotions.map(promo => (
                <div key={promo.id} style={{
                  padding: "8px 16px",
                  background: "rgba(255, 255, 255, 0.9)",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600
                }}>
                  {promo.code} ({formatDiscount(promo.amount, promo.type)}) → {getStrategyLabel(promo.aiStrategy || 'auto')}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* A. Hero Impact Section */}
        {isIntelligenceEnabled && promotions.length > 0 && (() => {
          const hasAIData = impactMetrics && impactMetrics.marginProtected > 0;
          const totalUsage = promotions.reduce((sum, p) => sum + (p.usageStats?.total || 0), 0);

          return (
            <div style={{
              background: hasAIData
                ? "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)"
                : "white",
              border: hasAIData ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 32,
              marginBottom: 24
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, marginBottom: 20 }}>
                {hasAIData ? (
                  <div>
                    <div style={{ fontSize: 13, color: "#166534", marginBottom: 6, fontWeight: 500 }}>Margin Protected</div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: "#15803d" }}>
                      ${impactMetrics.marginProtected.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 13, color: "#166534", marginTop: 4 }}>estimated savings</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6, fontWeight: 500 }}>Total Promo Usage</div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: "#1f2937" }}>
                      {totalUsage.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>discount code redemptions</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, color: hasAIData ? "#166534" : "#6b7280", marginBottom: 6, fontWeight: 500 }}>Promotions Managed</div>
                  <div style={{ fontSize: 36, fontWeight: 700, color: hasAIData ? "#15803d" : "#1f2937" }}>
                    {promotions.length}
                  </div>
                  <div style={{ fontSize: 13, color: hasAIData ? "#166534" : "#6b7280", marginTop: 4 }}>
                    {activePromotions.length} active now
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: hasAIData ? "#166534" : "#6b7280", marginBottom: 6, fontWeight: 500 }}>
                    {hasAIData ? "AI Decisions" : "Strategies Set"}
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 700, color: hasAIData ? "#15803d" : "#1f2937" }}>
                    {pausedCount}
                  </div>
                  <div style={{ fontSize: 13, color: hasAIData ? "#166534" : "#6b7280", marginTop: 4 }}>
                    paused or reduced
                  </div>
                </div>
              </div>

              {hasAIData ? (
                <div style={{
                  padding: 12,
                  background: "rgba(255, 255, 255, 0.7)",
                  borderRadius: 8,
                  fontSize: 14,
                  color: "#166534",
                  lineHeight: 1.5
                }}>
                  Promotional Intelligence saved an estimated <strong>${impactMetrics.marginProtected.toLocaleString()}</strong> in margin erosion across {promotions.length} promotion{promotions.length !== 1 ? 's' : ''} by automatically pausing or reducing exit offers during your sales.
                </div>
              ) : (
                <div style={{
                  padding: 12,
                  background: "#f5f3ff",
                  border: "1px solid #ddd6fe",
                  borderRadius: 8,
                  fontSize: 14,
                  color: "#6d28d9",
                  lineHeight: 1.5
                }}>
                  Enable AI mode in Settings to see margin protection estimates. In AI mode, Resparq automatically adjusts offer amounts during your promotions to prevent double-discounting.
                </div>
              )}
            </div>
          );
        })()}

        {/* B. Performance Comparison — AI mode only */}
        {impactMetrics && (impactMetrics.duringPromo.impressions > 0 || impactMetrics.outsidePromo.impressions > 0) && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 0,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid #e5e7eb",
            marginBottom: 24
          }}>
            <div style={{ padding: 24, background: "#fefce8" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#854d0e", marginBottom: 16 }}>
                During Promotions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#a16207" }}>Conversion Rate</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#854d0e" }}>{impactMetrics.duringPromo.cvr}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#a16207" }}>Revenue</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "#854d0e" }}>${impactMetrics.duringPromo.revenue.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#a16207" }}>Impressions</div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "#854d0e" }}>{impactMetrics.duringPromo.impressions.toLocaleString()}</div>
                </div>
              </div>
            </div>
            <div style={{ padding: 24, background: "#f0fdf4" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#166534", marginBottom: 16 }}>
                Outside Promotions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#15803d" }}>Conversion Rate</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#166534" }}>{impactMetrics.outsidePromo.cvr}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#15803d" }}>Revenue</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "#166534" }}>${impactMetrics.outsidePromo.revenue.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#15803d" }}>Impressions</div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "#166534" }}>{impactMetrics.outsidePromo.impressions.toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* C. Active Promotions */}
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 24, marginBottom: 20 }}>Active Promotions</h2>

          {activePromotions.length === 0 ? (
            <div style={{
              padding: 40,
              background: "#f9fafb",
              borderRadius: 8,
              textAlign: "center",
              color: "#6b7280"
            }}>
              <p style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>
                No active site-wide promotions detected.
              </p>
              <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>
                Resparq will automatically detect when you run sales and adjust your AI strategy to protect margins.
              </p>
            </div>
          ) : (
            activePromotions.map(promo => (
              <PromotionCard
                key={promo.id}
                promo={promo}
                fetcher={fetcher}
              />
            ))
          )}
        </div>

        {/* D. Past Promotions Timeline */}
        {endedPromotions.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 24, marginBottom: 20 }}>Past Promotions</h2>
            <div style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              overflow: "hidden"
            }}>
              {(showAllPast ? endedPromotions : endedPromotions.slice(0, 5)).map((promo, i) => (
                <div
                  key={promo.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr 120px 100px",
                    gap: 16,
                    padding: "16px 20px",
                    borderBottom: i < endedPromotions.length - 1 ? "1px solid #f3f4f6" : "none",
                    alignItems: "center",
                    fontSize: 14
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#1f2937" }}>
                    {promo.code}
                  </div>
                  <div style={{ color: "#6b7280" }}>
                    {formatDiscount(promo.amount, promo.type)} — {getClassificationLabel(promo.classification)} — {getStrategyLabel(promo.aiStrategy || 'auto')}
                  </div>
                  <div style={{ color: "#9ca3af", fontSize: 13 }}>
                    {new Date(promo.detectedAt).toLocaleDateString()}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{
                      padding: "3px 8px",
                      background: "#f3f4f6",
                      color: "#6b7280",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500
                    }}>
                      {promo.usageStats?.total || 0} uses
                    </span>
                  </div>
                </div>
              ))}

              {endedPromotions.length > 5 && !showAllPast && (
                <div style={{ padding: 12, textAlign: "center", borderTop: "1px solid #f3f4f6" }}>
                  <button
                    onClick={() => setShowAllPast(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#8B5CF6",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: "pointer",
                      padding: "4px 12px"
                    }}
                  >
                    Show all {endedPromotions.length} past promotions
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* E. How It Works */}
        <div style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 32
        }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, marginBottom: 20, color: "#1f2937" }}>
            How It Works
          </h3>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>
            When you run a sale, Resparq detects it and adjusts your exit offers to avoid giving double discounts that erode your margins.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#eff6ff",
                color: "#3b82f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
                fontWeight: 700,
                fontSize: 18
              }}>
                1
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1f2937", marginBottom: 4 }}>Detect</div>
              <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                Monitors discount code usage via order webhooks
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#fef3c7",
                color: "#f59e0b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
                fontWeight: 700,
                fontSize: 18
              }}>
                2
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1f2937", marginBottom: 4 }}>Classify</div>
              <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                Determines if it's site-wide, targeted, or one-off
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#f0fdf4",
                color: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
                fontWeight: 700,
                fontSize: 18
              }}>
                3
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1f2937", marginBottom: 4 }}>Adjust</div>
              <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                Pauses or reduces exit offers to protect your margins
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function PromotionCard({ promo, fetcher }) {
  return (
    <div style={{
      padding: 24,
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      marginBottom: 16
    }}>
      {/* Top row: Code + badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          {promo.code}
        </h3>
        <span style={{
          padding: "4px 10px",
          background: "#f3f4f6",
          color: "#374151",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600
        }}>
          {formatDiscount(promo.amount, promo.type)}
        </span>
        <span style={{
          background: getStrategyColor(promo.aiStrategy || 'auto'),
          color: "white",
          padding: "4px 12px",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600
        }}>
          {getStrategyLabel(promo.aiStrategy || 'auto')}
        </span>
        {promo.merchantOverride && (
          <span style={{
            background: "#8b5cf6",
            color: "white",
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600
          }}>
            Manual Override
          </span>
        )}
      </div>

      {/* 3-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 16 }}>
        {/* Left: Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Classification</div>
            <div style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>
              {getClassificationLabel(promo.classification)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Total Uses</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{promo.usageStats?.total || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Detected</div>
            <div style={{ fontSize: 14 }}>{new Date(promo.detectedAt).toLocaleDateString()}</div>
          </div>
        </div>

        {/* Center: AI Reasoning */}
        <div style={{ gridColumn: "span 2" }}>
          {promo.aiStrategyReason ? (
            <div style={{
              padding: 16,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              fontSize: 14,
              color: "#1e40af",
              height: "100%"
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                AI Recommendation
              </div>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{promo.aiStrategyReason}</p>
            </div>
          ) : (
            <div style={{
              padding: 16,
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 14,
              color: "#374151",
              height: "100%"
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13, color: "#6b7280" }}>
                AI Analysis
              </div>
              <p style={{ margin: 0, lineHeight: 1.6 }}>
                {promo.aiStrategy === 'pause'
                  ? `High-volume discount (${formatDiscount(promo.amount, promo.type)}). Exit offers paused to prevent double discounting.`
                  : promo.aiStrategy === 'decrease'
                  ? `Active promotion detected. Exit offer amounts reduced to preserve margins while still capturing exits.`
                  : promo.aiStrategy === 'ignore'
                  ? `Low usage pattern indicates a customer service code. No action needed.`
                  : 'Monitoring usage patterns to determine optimal strategy.'
                }
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select
          onChange={(e) => {
            fetcher.submit(
              {
                actionType: "updateStrategy",
                promoId: promo.id,
                strategy: e.target.value
              },
              { method: "post" }
            );
          }}
          value={promo.merchantOverride?.type || promo.aiStrategy || 'auto'}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14
          }}
        >
          <option value="auto">Auto (AI decides)</option>
          <option value="pause">Pause AI (no modals)</option>
          <option value="force_zero">Announcement mode (0% offers)</option>
          <option value="decrease">Decrease offers</option>
          <option value="continue">Continue normal</option>
          <option value="ignore">Ignore this promo</option>
        </select>

        <button
          onClick={() => {
            fetcher.submit(
              {
                actionType: "endPromo",
                promoId: promo.id
              },
              { method: "post" }
            );
          }}
          style={{
            padding: "8px 16px",
            background: "white",
            color: "#ef4444",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600
          }}
        >
          End Promotion
        </button>
      </div>
    </div>
  );
}
