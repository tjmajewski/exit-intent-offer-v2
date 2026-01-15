import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import AppLayout from "../components/AppLayout";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

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
    const plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : { tier: "pro" };

    // Enterprise-only feature
    if (plan.tier !== 'enterprise') {
      return { 
        hasAccess: false, 
        promotions: [],
        plan 
      };
    }

    // Get shop from database
    const shopDomain = new URL(request.url).searchParams.get('shop') || request.headers.get('host');
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain }
    });

    if (!shopRecord) {
      return { 
        hasAccess: true, 
        promotions: [],
        plan 
      };
    }

    // Get all promotions (active and ended)
    const promotions = await db.promotion.findMany({
      where: { shopId: shopRecord.id },
      orderBy: { detectedAt: 'desc' }
    });

    return { 
      hasAccess: true,
      promotions: promotions.map(p => ({
        ...p,
        usageStats: JSON.parse(p.usageStats),
        merchantOverride: p.merchantOverride ? JSON.parse(p.merchantOverride) : null
      })),
      plan
    };
  } catch (error) {
    console.error("Error loading promotions:", error);
    return { 
      hasAccess: false,
      promotions: [],
      plan: { tier: "pro" }
    };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");
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

      console.log(`✅ Promotion strategy updated: ${promoId} → ${newStrategy}`);
    }

    if (actionType === "endPromo") {
      await db.promotion.update({
        where: { id: promoId },
        data: { status: "ended" }
      });

      console.log(`✅ Promotion ended: ${promoId}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Promotion action error:", error);
    return { success: false, error: error.message };
  }
}

export default function PromotionsPage() {
  const { hasAccess, promotions, plan } = useLoaderData();
  const fetcher = useFetcher();

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
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Promotional Intelligence</h1>
        <p style={{ color: "#666", marginBottom: 32 }}>
          AI automatically detects your site-wide promotions and adjusts strategy to optimize revenue for your store
        </p>

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
                ResparQ will automatically detect when you run sales and adjust your AI strategy to protect margins.
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
  const getStrategyColor = (strategy) => {
    switch(strategy) {
      case 'pause': return '#ef4444';
      case 'increase': return '#f59e0b';
      case 'continue': return '#10b981';
      case 'ignore': return '#6b7280';
      default: return '#3b82f6';
    }
  };

  const getStrategyLabel = (strategy) => {
    switch(strategy) {
      case 'pause': return '⏸️ AI Paused';
      case 'increase': return '📈 Increased Offers';
      case 'continue': return '▶️ Continue Normal';
      case 'ignore': return '🚫 Ignored';
      default: return '🤖 Auto';
    }
  };

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
                🔧 Manual Override
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

          {promo.aiStrategyReason && (
            <p style={{
              margin: 0,
              padding: 12,
              background: "#f3f4f6",
              borderRadius: 6,
              fontSize: 14,
              color: "#374151",
              marginBottom: 16
            }}>
              <strong>AI Reasoning:</strong> {promo.aiStrategyReason}
            </p>
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
                <option value="auto">🤖 Auto (AI decides)</option>
                <option value="pause">⏸️ Pause AI (no modals)</option>
                <option value="force_zero">📢 Announcement mode (0% offers)</option>
                <option value="increase">📈 Increase offers</option>
                <option value="continue">▶️ Continue normal</option>
                <option value="ignore">🚫 Ignore this promo</option>
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