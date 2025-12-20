import { useLoaderData, Link, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query {
        shop {
          id
          settings: metafield(namespace: "exit_intent", key: "settings") {
            value
          }
          status: metafield(namespace: "exit_intent", key: "status") {
            value
          }
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);

    const data = await response.json();
    
    const settings = data.data.shop?.settings?.value 
      ? JSON.parse(data.data.shop.settings.value) 
      : null;
      
    const status = data.data.shop?.status?.value 
      ? JSON.parse(data.data.shop.status.value) 
      : { enabled: false };
      
    let plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : null;

    // If no plan exists, create default plan
    if (!plan) {
      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 14);
      
      const resetDate = new Date(now);
      resetDate.setMonth(resetDate.getMonth() + 1);
      
      plan = {
        tier: "starter",
        status: "trialing",
        billingCycle: "monthly",
        startDate: now.toISOString(),
        trialEndsAt: trialEnd.toISOString(),
        usage: {
          impressionsThisMonth: 0,
          resetDate: resetDate.toISOString()
        }
      };

      // Save the plan
      const shopId = data.data.shop.id;
      await admin.graphql(`
        mutation SetDefaultPlan($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "plan"
            value: $value
            type: "json"
          }]) {
            metafields { id }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(plan)
        }
      });

      console.log('✓ Created default plan:', plan.tier);
    }

    return { 
      settings, 
      status,
      plan,
      analytics: {
        totalRevenue: 0,
        conversionRate: 0,
        clickRate: 0,
        revenuePerView: 0
      }
    };
  } catch (error) {
    console.error("Error loading dashboard:", error);
    return { 
      settings: null, 
      status: { enabled: false },
      plan: null,
      analytics: {
        totalRevenue: 0,
        conversionRate: 0,
        clickRate: 0,
        revenuePerView: 0
      }
    };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    // Get shop ID
    const shopResponse = await admin.graphql(`
      query {
        shop {
          id
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }
    `);
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    // Handle plan switching
    if (actionType === "switchPlan") {
      const newTier = formData.get("tier");
      const currentPlan = shopData.data.shop?.plan?.value 
        ? JSON.parse(shopData.data.shop.plan.value)
        : null;

      if (currentPlan) {
        currentPlan.tier = newTier;

        await admin.graphql(`
          mutation UpdatePlan($ownerId: ID!, $value: String!) {
            metafieldsSet(metafields: [{
              ownerId: $ownerId
              namespace: "exit_intent"
              key: "plan"
              value: $value
              type: "json"
            }]) {
              metafields { id }
            }
          }
        `, {
          variables: {
            ownerId: shopId,
            value: JSON.stringify(currentPlan)
          }
        });

        console.log(`✓ Switched plan to: ${newTier}`);
        return { success: true, planSwitched: true };
      }
    }

    // Handle status toggle
    if (actionType === "toggleStatus") {
      const enabled = formData.get("enabled") === "true";

      await admin.graphql(`
        mutation SetStatus($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "status"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify({ enabled })
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Error in action:", error);
    return { success: false };
  }
}

// Info tooltip component
function InfoTooltip({ content }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        style={{
          background: isOpen ? "#a78bfa" : "#8b5cf6",
          color: "white",
          border: "none",
          borderRadius: "50%",
          width: 20,
          height: 20,
          fontSize: 12,
          fontWeight: "bold",
          cursor: "pointer",
          marginLeft: 8,
          boxShadow: isOpen ? "0 0 0 3px rgba(139, 92, 246, 0.3)" : "none",
          transition: "all 0.2s"
        }}
      >
        ?
      </button>
      
      {isOpen && (
        <div style={{
          position: "absolute",
          bottom: 30,
          left: "50%",
          transform: "translateX(-50%)",
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          width: 240,
          fontSize: 13,
          lineHeight: 1.5,
          color: "#374151",
          zIndex: 1000
        }}>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "none",
              border: "none",
              fontSize: 16,
              color: "#9ca3af",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1
            }}
          >
            ×
          </button>
          <div style={{ paddingRight: 16 }}>
            {content}
          </div>
          <div style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            width: 12,
            height: 12,
            background: "white",
            border: "1px solid #e5e7eb",
            borderTop: "none",
            borderRight: "none",
            transform: "translateX(-50%) rotate(-45deg)"
          }} />
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { settings, status, plan, analytics } = useLoaderData();
  const fetcher = useFetcher();
  const [isEnabled, setIsEnabled] = useState(status.enabled);

  const handleToggle = () => {
    const newStatus = !isEnabled;
    setIsEnabled(newStatus);

    fetcher.submit(
      { 
        actionType: "toggleStatus",
        enabled: newStatus.toString() 
      },
      { method: "post" }
    );
  };

  const handlePlanSwitch = (newTier) => {
    fetcher.submit(
      { 
        actionType: "switchPlan",
        tier: newTier 
      },
      { method: "post" }
    );
  };

  return (
    <div style={{ padding: 40 }}>
      {/* Header with Toggle */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: 40 
      }}>
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>Exit Intent Dashboard</h1>
          <p style={{ color: "#666", marginTop: 8 }}>
            Track your modal performance and recovered revenue
          </p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Plan Switcher (Dev Tool) */}
          {plan && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                🔧 Dev: Switch Plan
              </label>
              <select
                value={plan.tier}
                onChange={(e) => handlePlanSwitch(e.target.value)}
                style={{
                  padding: "8px 12px",
                  border: "2px solid #8B5CF6",
                  borderRadius: 6,
                  background: "white",
                  color: "#8B5CF6",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer"
                }}
              >
                <option value="starter">Starter ($29/mo)</option>
                <option value="pro">Pro ($79/mo)</option>
                <option value="enterprise">Enterprise ($299/mo)</option>
              </select>
            </div>
          )}

          {/* Active/Inactive Toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ 
              fontWeight: 500,
              color: isEnabled ? "#10b981" : "#6b7280"
            }}>
              {isEnabled ? "Active" : "Inactive"}
            </span>
            <button
              onClick={handleToggle}
              style={{
                position: "relative",
                width: 56,
                height: 32,
                borderRadius: 16,
                border: "none",
                cursor: "pointer",
                background: isEnabled ? "#10b981" : "#d1d5db",
                transition: "background 0.3s"
              }}
            >
              <div style={{
                position: "absolute",
                top: 4,
                left: isEnabled ? 28 : 4,
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "white",
                transition: "left 0.3s",
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
              }} />
            </button>
          </div>
        </div>
      </div>

      {/* Plan Badge */}
      {plan && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              padding: "6px 12px",
              background: plan.tier === "starter" ? "#dbeafe" : plan.tier === "pro" ? "#8B5CF6" : "#fbbf24",
              color: plan.tier === "starter" ? "#1e40af" : "white",
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 14,
              textTransform: "uppercase"
            }}>
              {plan.tier} Plan
            </div>
          </div>

          {/* Only show upgrade CTA if trialing OR Pro wanting to upgrade to Enterprise */}
          {(plan.status === "trialing" || plan.tier === "pro") && plan.tier !== "enterprise" && (
            <Link
              to="/app/upgrade"
              style={{
                padding: "8px 16px",
                background: "#8B5CF6",
                color: "white",
                textDecoration: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500
              }}
            >
              {plan.tier === "starter" 
                ? "🚀 Unlock unlimited impressions - Upgrade to Pro" 
                : "⚡ Get A/B testing & AI - Upgrade to Enterprise"}
            </Link>
          )}
        </div>
      )}

      {/* Usage Stats - Only show for plans with limits */}
      {plan && plan.usage && plan.usage.impressionsThisMonth !== undefined && (
        (() => {
          const limit = plan.tier === "starter" ? 1000 : null;
          const usage = plan.usage.impressionsThisMonth || 0;
          const percentage = limit ? Math.min((usage / limit) * 100, 100) : 0;
          const isNearLimit = percentage >= 80;
          const isOverLimit = percentage >= 100;

          if (!limit) return null; // Don't show for unlimited plans

          // Format reset date
          const resetDate = plan.usage.resetDate ? new Date(plan.usage.resetDate) : null;
          const resetDateFormatted = resetDate ? resetDate.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
          }) : 'Unknown';

          return (
            <div style={{
              padding: 16,
              background: isOverLimit ? "#fee2e2" : isNearLimit ? "#fef3c7" : "#f0f9ff",
              border: `1px solid ${isOverLimit ? "#fca5a5" : isNearLimit ? "#fde68a" : "#bae6fd"}`,
              borderRadius: 8,
              marginBottom: 24
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 500, color: isOverLimit ? "#991b1b" : isNearLimit ? "#92400e" : "#0c4a6e" }}>
                  Monthly Impressions
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: isOverLimit ? "#991b1b" : isNearLimit ? "#92400e" : "#0c4a6e" }}>
                  {usage.toLocaleString()} / {limit.toLocaleString()}
                </div>
              </div>
              <div style={{
                width: "100%",
                height: 8,
                background: "#e5e7eb",
                borderRadius: 4,
                overflow: "hidden"
              }}>
                <div style={{
                  width: `${percentage}%`,
                  height: "100%",
                  background: isOverLimit ? "#dc2626" : isNearLimit ? "#f59e0b" : "#3b82f6",
                  transition: "width 0.3s"
                }} />
              </div>
              
              {/* Reset date - always show */}
              <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
                📅 Resets on {resetDateFormatted}
              </div>

              {isOverLimit && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#991b1b" }}>
                  ⚠️ Monthly limit reached. Upgrade to Pro for unlimited impressions.{" "}
                  <Link to="/app/upgrade" style={{ color: "#7c3aed", textDecoration: "underline" }}>
                    Upgrade now →
                  </Link>
                </div>
              )}
              {isNearLimit && !isOverLimit && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#92400e" }}>
                  ⚡ You're at {Math.round(percentage)}% of your monthly limit.
                </div>
              )}
            </div>
          );
        })()
      )}

      {/* Hero Revenue Card */}
      <div style={{
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: 40,
        borderRadius: 12,
        color: "white",
        marginBottom: 32,
        boxShadow: "0 10px 30px rgba(102, 126, 234, 0.3)"
      }}>
        <div style={{ fontSize: 16, opacity: 0.9, marginBottom: 8 }}>
          Total Revenue Recovered
          <InfoTooltip content="Total value of orders that used your exit intent discount code. This is the revenue you recovered from customers who were about to leave." />
        </div>
        <div style={{ fontSize: 56, fontWeight: "bold", marginBottom: 8 }}>
          ${analytics.totalRevenue.toLocaleString()}
        </div>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          From exit intent conversions
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(3, 1fr)", 
        gap: 24,
        marginBottom: 32
      }}>
        <div style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e5e7eb"
        }}>
          <div style={{ 
            fontSize: 14, 
            color: "#6b7280", 
            marginBottom: 8,
            display: "flex",
            alignItems: "center"
          }}>
            Conversion Rate
            <InfoTooltip content="Conversions ÷ Impressions × 100. Shows what % of people who saw your modal completed a purchase." />
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.conversionRate}%
          </div>
        </div>

        <div style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e5e7eb"
        }}>
          <div style={{ 
            fontSize: 14, 
            color: "#6b7280", 
            marginBottom: 8,
            display: "flex",
            alignItems: "center"
          }}>
            Click Rate
            <InfoTooltip content="Clicks ÷ Impressions × 100. Shows what % of people who saw your modal clicked the CTA button." />
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.clickRate}%
          </div>
        </div>

        <div style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e5e7eb"
        }}>
          <div style={{ 
            fontSize: 14, 
            color: "#6b7280", 
            marginBottom: 8,
            display: "flex",
            alignItems: "center"
          }}>
            RPV (Revenue Per View)
            <InfoTooltip content="Revenue Per View (Total Revenue ÷ Impressions). Shows average revenue generated each time someone sees your modal. Higher is better!" />
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            ${analytics.revenuePerView.toFixed(2)}
          </div>
        </div>
      </div>

{/* Configure Button */}
      <div style={{ marginTop: 32 }}>
        <Link
          to="/app/settings"
          style={{
            display: "inline-block",
            padding: "12px 24px",
            background: "#8B5CF6",
            color: "white",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 500,
            fontSize: 16
          }}
        >
          Configure Modal
        </Link>
      </div>

      {/* Current Modal Preview */}
      {settings && (
        <div style={{
          marginTop: 32,
          padding: 24,
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8
        }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>
            Current Modal Preview
          </h3>
          <div style={{
            background: "rgba(0, 0, 0, 0.05)",
            padding: 40,
            borderRadius: 8,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          }}>
            <div style={{
              background: "white",
              padding: 40,
              borderRadius: 12,
              maxWidth: 500,
              width: "100%",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)"
            }}>
              <h2 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>
                {settings.modalHeadline}
              </h2>
              <p style={{ marginBottom: 24, color: "#666", lineHeight: 1.6 }}>
                {settings.modalBody}
              </p>
              <button style={{
                width: "100%",
                padding: "12px 24px",
                background: "#8B5CF6",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontSize: 16,
                fontWeight: 500,
                cursor: "pointer"
              }}>
                {settings.ctaButton}
              </button>
              {settings.discountCode && (
                <div style={{
                  marginTop: 16,
                  padding: 12,
                  background: "#f0fdf4",
                  border: "1px solid #86efac",
                  borderRadius: 6,
                  fontSize: 14,
                  textAlign: "center",
                  color: "#166534"
                }}>
                  💰 Code: <strong>{settings.discountCode}</strong> will be auto-applied
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Setup Guide */}
      {!settings && (
        <div style={{
          marginTop: 32,
          padding: 24,
          background: "#fef3c7",
          border: "1px solid #fde68a",
          borderRadius: 8
        }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>
            🚀 Get Started
          </h3>
          <p style={{ marginBottom: 16, color: "#92400e" }}>
            Configure your exit intent modal to start recovering abandoned carts and growing revenue.
          </p>
          <Link
            to="/app/settings"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "#8B5CF6",
              color: "white",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500
            }}
          >
            Configure Now →
          </Link>
        </div>
      )}
    </div>
  );
}