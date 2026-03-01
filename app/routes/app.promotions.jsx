import { useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import AppLayout from "../components/AppLayout";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);

    const data = await response.json();
    let plan = data.data.shop?.plan?.value
      ? JSON.parse(data.data.shop.plan.value)
      : { tier: "pro" };

    // Get shop from database and use database plan as source of truth
    const shopDomain = session.shop;
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain }
    });

    // Override plan with database value
    if (shopRecord?.plan) {
      plan = { ...plan, tier: shopRecord.plan };
    }

    // Enterprise-only feature
    if (plan.tier !== 'enterprise') {
      return {
        hasAccess: false,
        promotions: [],
        unseenCount: 0,
        newPromotions: [],
        plan
      };
    }

    if (!shopRecord) {
      return {
        hasAccess: true,
        promotions: [],
        unseenCount: 0,
        newPromotions: [],
        intelligenceEnabled: true,
        plan
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
      plan
    };
  } catch (error) {
    console.error("Error loading promotions:", error);
    return {
      hasAccess: false,
      promotions: [],
      unseenCount: 0,
      newPromotions: [],
      plan: { tier: "pro" }
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

export default function PromotionsPage() {
  const { hasAccess, promotions, unseenCount, newPromotions, intelligenceEnabled, plan } = useLoaderData();
  const fetcher = useFetcher();
  const [isIntelligenceEnabled, setIsIntelligenceEnabled] = useState(intelligenceEnabled);

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

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 32, marginBottom: 8 }}>Promotional Intelligence</h1>
            <p style={{ color: "#666", marginBottom: 0 }}>
              AI automatically detects your site-wide promotions and adjusts strategy to optimize revenue for your store
            </p>
          </div>

          {/* Toggle */}
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

        {/* Notification Banner for New Promotions */}
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
            <p style={{ margin: 0, marginBottom: 16, fontSize: 14 }}>
              AI detected {newPromotions.length} active promotion{newPromotions.length > 1 ? 's' : ''} and automatically adjusted your strategy.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {newPromotions.map(promo => (
                <div key={promo.id} style={{
                  padding: "8px 16px",
                  background: "rgba(255, 255, 255, 0.9)",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600
                }}>
                  {promo.code} ({promo.amount}{promo.type === 'percentage' ? '%' : '$'} off) → {getStrategyLabel(promo.aiStrategy || 'auto')}
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Performance Impact Metrics */}
        {isIntelligenceEnabled && promotions && promotions.length > 0 && (
          <div style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 24,
            marginBottom: 24
          }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              Performance Impact
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Total Detected</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1f2937" }}>
                  {promotions.length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Active Now</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#10b981" }}>
                  {activePromotions.length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>AI Managed</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#3b82f6" }}>
                  {promotions.filter(p => !p.merchantOverride && p.aiStrategy).length}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Total Usage</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>
                  {promotions.reduce((sum, p) => sum + (p.usageStats?.total || 0), 0).toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{
              marginTop: 16,
              padding: 12,
              background: "#f0fdf4",
              borderRadius: 6,
              fontSize: 13,
              color: "#166534"
            }}>
              Promotional Intelligence has automatically monitored and adjusted strategies for {promotions.length} promotion{promotions.length !== 1 ? 's' : ''}, helping protect your margins during sales periods.
            </div>
          </div>
        )}

        {/* Active Promotions */}
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

        {/* Ended Promotions */}
        {endedPromotions.length > 0 && (
          <div>
            <h2 style={{ fontSize: 24, marginBottom: 20 }}>Past Promotions</h2>
            {endedPromotions.map(promo => (
              <PromotionCard 
                key={promo.id} 
                promo={promo} 
                fetcher={fetcher}
                isEnded={true}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function PromotionCard({ promo, fetcher, isEnded = false }) {
  return (
    <div style={{
      padding: 24,
      background: isEnded ? "#f9fafb" : "white",
      border: `2px solid ${isEnded ? '#e5e7eb' : '#e5e7eb'}`,
      borderRadius: 12,
      marginBottom: 16
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
              {promo.code}
            </h3>
            <span style={{
              background: getStrategyColor(promo.aiStrategy || 'auto'),
              color: "white",
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600
            }}>
              {getStrategyLabel(promo.aiStrategy || 'auto')}
            </span>
            {promo.merchantOverride && (
              <span style={{
                background: "#8b5cf6",
                color: "white",
                padding: "4px 12px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600
              }}>
                Manual Override
              </span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Discount</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                {promo.amount}{promo.type === 'percentage' ? '%' : '$'} off
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Total Uses</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                {promo.usageStats.total}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Classification</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>
                {promo.classification || "Monitoring..."}
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>Detected</p>
              <p style={{ margin: 0, fontSize: 14 }}>
                {new Date(promo.detectedAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Smart Recommendation / AI Reasoning */}
          {promo.aiStrategyReason ? (
            <div style={{
              margin: 0,
              padding: 16,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              fontSize: 14,
              color: "#1e40af",
              marginBottom: 16
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 16v-4M12 8h.01"></path>
                </svg>
                AI Recommendation
              </div>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{promo.aiStrategyReason}</p>
            </div>
          ) : (
            <div style={{
              margin: 0,
              padding: 16,
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 8,
              fontSize: 14,
              color: "#166534",
              marginBottom: 16
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Smart Analysis
              </div>
              <p style={{ margin: 0, lineHeight: 1.6 }}>
                {promo.amount >= 30 && promo.type === 'percentage' ? (
                  `High discount detected (${promo.amount}%). Consider pausing exit offers to avoid margin erosion during this promotional period.`
                ) : promo.amount >= 20 && promo.type === 'percentage' ? (
                  `Moderate discount (${promo.amount}%). AI suggests reducing exit offers to maintain healthy margins while still capturing exits.`
                ) : promo.amount >= 15 && promo.type === 'percentage' ? (
                  `Small discount (${promo.amount}%). Consider continuing normal exit offers or decreasing to preserve margin since codes stack.`
                ) : (
                  'AI will monitor usage patterns and automatically adjust strategy to maximize profitability.'
                )}
              </p>
            </div>
          )}

          {!isEnded && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <select
                onChange={(e) => {
                  const strategy = e.target.value;
                  fetcher.submit(
                    { 
                      actionType: "updateStrategy",
                      promoId: promo.id,
                      strategy: strategy
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
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600
                }}
              >
                End Promotion
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}