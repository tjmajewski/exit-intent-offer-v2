import { useLoaderData, Link, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import { checkAndResetUsage } from "../utils/featureGates";
import AppLayout from "../components/AppLayout";
import db from "../db.server";

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
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
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

    const modalLibrary = data.data.shop?.modalLibrary?.value 
      ? JSON.parse(data.data.shop.modalLibrary.value) 
      : null;

    // If no plan exists, create default plan
    if (!plan) {
      const now = new Date();
      
      const resetDate = new Date(now);
      resetDate.setMonth(resetDate.getMonth() + 1);
      
      plan = {
        tier: "starter",
        status: "active",
        billingCycle: "monthly",
        startDate: now.toISOString(),
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

    // Check if usage needs to be reset
    if (plan) {
      const shopId = data.data.shop.id;
      const resetResult = checkAndResetUsage(plan, shopId, admin);
      
      if (resetResult.needsReset) {
        // Save the updated plan with reset usage
        await admin.graphql(`
          mutation UpdatePlanAfterReset($ownerId: ID!, $value: String!) {
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
            value: JSON.stringify(resetResult.plan)
          }
        });

        plan = resetResult.plan;
        console.log('✓ Usage reset saved to metafields');
      }
    }

    // Load real analytics data
    const analyticsResponse = await admin.graphql(`
      query {
        shop {
          analytics: metafield(namespace: "exit_intent", key: "analytics") {
            value
          }
        }
      }
    `);

    const analyticsData = await analyticsResponse.json();
    const analyticsRaw = analyticsData.data.shop?.analytics?.value 
      ? JSON.parse(analyticsData.data.shop.analytics.value)
      : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0, events: [] };

    // Calculate 30-day rolling metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = analyticsRaw.events || [];
    const last30DaysEvents = events.filter(e => new Date(e.timestamp) > thirtyDaysAgo);

    const impressions30d = last30DaysEvents.filter(e => e.type === 'impression').length;
    const clicks30d = last30DaysEvents.filter(e => e.type === 'click').length;
    const conversions30d = last30DaysEvents.filter(e => e.type === 'conversion').length;

    const conversionRate30d = impressions30d > 0 
      ? ((conversions30d / impressions30d) * 100).toFixed(1) 
      : 0;

    const clickRate30d = impressions30d > 0 
      ? ((clicks30d / impressions30d) * 100).toFixed(1) 
      : 0;

    const revenuePerView30d = impressions30d > 0 
      ? ((analyticsRaw.revenue || 0) / impressions30d).toFixed(2) 
      : 0;

    // Calculate lifetime metrics (for Pro+)
    const impressionsLifetime = analyticsRaw.impressions || 0;
    const clicksLifetime = analyticsRaw.clicks || 0;
    const conversionsLifetime = analyticsRaw.conversions || 0;
    const revenueLifetime = analyticsRaw.revenue || 0;

    const conversionRateLifetime = impressionsLifetime > 0 
      ? ((conversionsLifetime / impressionsLifetime) * 100).toFixed(1) 
      : 0;

    const clickRateLifetime = impressionsLifetime > 0 
      ? ((clicksLifetime / impressionsLifetime) * 100).toFixed(1) 
      : 0;

    const revenuePerViewLifetime = impressionsLifetime > 0 
      ? (revenueLifetime / impressionsLifetime).toFixed(2) 
      : 0;

    // Get recent events for activity feed (Enterprise)
    const recentEvents = last30DaysEvents
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10); // Last 10 events

    const analytics = {
      // 30-day metrics (everyone)
      last30Days: {
        totalRevenue: analyticsRaw.revenue || 0, // Note: revenue is cumulative, we'd need to track per-event
        conversionRate: parseFloat(conversionRate30d),
        clickRate: parseFloat(clickRate30d),
        revenuePerView: parseFloat(revenuePerView30d),
        impressions: impressions30d,
        clicks: clicks30d,
        conversions: conversions30d
      },
      // Lifetime metrics (Pro+)
      lifetime: {
        totalRevenue: revenueLifetime,
        conversionRate: parseFloat(conversionRateLifetime),
        clickRate: parseFloat(clickRateLifetime),
        revenuePerView: parseFloat(revenuePerViewLifetime),
        impressions: impressionsLifetime,
        clicks: clicksLifetime,
        conversions: conversionsLifetime
      },
      // Recent activity (Enterprise)
      recentEvents: recentEvents
    };

    // PHASE 5: Check for active site-wide promotions (Pro tier upsell)
    let promoWarning = null;
    
    if (plan && plan.tier === 'pro') {
      const shopDomain = new URL(request.url).searchParams.get('shop') || request.headers.get('host');
      
      const shopRecord = await db.shop.findUnique({
        where: { shopifyDomain: shopDomain }
      });
      
      if (shopRecord) {
        const activePromo = await db.promotion.findFirst({
          where: {
            shopId: shopRecord.id,
            status: "active",
            classification: "site_wide"
          },
          orderBy: {
            amount: 'desc'
          }
        });
        
        if (activePromo) {
          promoWarning = {
            code: activePromo.code,
            amount: activePromo.amount,
            type: activePromo.type,
            aiStrategy: activePromo.aiStrategy,
            message: `Your AI is still offering discounts during your ${activePromo.amount}${activePromo.type === 'percentage' ? '%' : '$'} ${activePromo.code} promotion, potentially wasting budget.`
          };
        }
      }
    }

    return { 
      settings, 
      status,
      plan,
      analytics,
      promoWarning,
      modalLibrary
    };
  } catch (error) {
    console.error("Error loading dashboard:", error);
    return { 
      settings: null, 
      status: { enabled: false },
      plan: null,
      analytics: {
        last30Days: {
          totalRevenue: 0,
          conversionRate: 0,
          clickRate: 0,
          revenuePerView: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0
        },
        lifetime: {
          totalRevenue: 0,
          conversionRate: 0,
          clickRate: 0,
          revenuePerView: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0
        }
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
        
        // Ensure usage object exists when switching plans
        if (!currentPlan.usage) {
          const now = new Date();
          const resetDate = new Date(now);
          resetDate.setMonth(resetDate.getMonth() + 1);
          
          currentPlan.usage = {
            impressionsThisMonth: 0,
            resetDate: resetDate.toISOString()
          };
        }

        // Also update settings to include plan tier
        const settingsResponse = await admin.graphql(`
          query {
            shop {
              settings: metafield(namespace: "exit_intent", key: "settings") {
                value
              }
            }
          }
        `);
        const settingsData = await settingsResponse.json();
        const currentSettings = settingsData.data.shop?.settings?.value 
          ? JSON.parse(settingsData.data.shop.settings.value)
          : {};
        
        currentSettings.plan = newTier;

        await admin.graphql(`
          mutation UpdatePlanAndSettings($ownerId: ID!, $planValue: String!, $settingsValue: String!) {
            metafieldsSet(metafields: [
              {
                ownerId: $ownerId
                namespace: "exit_intent"
                key: "plan"
                value: $planValue
                type: "json"
              },
              {
                ownerId: $ownerId
                namespace: "exit_intent"
                key: "settings"
                value: $settingsValue
                type: "json"
              }
            ]) {
              metafields { id }
            }
          }
        `, {
          variables: {
            ownerId: shopId,
            planValue: JSON.stringify(currentPlan),
            settingsValue: JSON.stringify(currentSettings)
          }
        });

        console.log(`✓ Switched plan to: ${newTier}`);
        return { success: true, planSwitched: true };
      }
    }

    // TEST: Force reset by setting reset date to yesterday
    if (actionType === "testReset") {
      const currentPlan = shopData.data.shop?.plan?.value 
        ? JSON.parse(shopData.data.shop.plan.value)
        : null;

      if (currentPlan && currentPlan.usage) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        currentPlan.usage.resetDate = yesterday.toISOString();

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

        console.log(`✓ Set reset date to yesterday - refresh page to trigger reset`);
        return { success: true, testResetReady: true };
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
  const { settings, status, plan, analytics, promoWarning, modalLibrary } = useLoaderData();
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
    <AppLayout plan={plan}>
      <div style={{ padding: 40 }}>
      
      {/* PHASE 5: Promotional Intelligence Warning (Pro Tier Upsell) */}
      {promoWarning && (
        <div style={{
          background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
          border: "2px solid #f59e0b",
          borderRadius: 12,
          padding: 24,
          marginBottom: 32,
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ 
                margin: 0, 
                fontSize: 20, 
                fontWeight: 600,
                color: "#92400e",
                marginBottom: 8 
              }}>
                Site-Wide Promotion Detected: {promoWarning.code}
              </h3>
              <p style={{ 
                margin: 0, 
                fontSize: 16, 
                color: "#78350f",
                marginBottom: 16,
                lineHeight: 1.5
              }}>
                {promoWarning.message}
              </p>
              <div style={{
                background: "white",
                padding: 16,
                borderRadius: 8,
                marginBottom: 16
              }}>
                <p style={{ margin: 0, fontSize: 14, color: "#92400e", marginBottom: 12 }}>
                  <strong>💡 What Enterprise AI would do automatically:</strong>
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, color: "#78350f", fontSize: 14 }}>
                  {promoWarning.aiStrategy === 'pause' && (
                    <li><strong>Pause exit modals</strong> during your {promoWarning.amount}% sale to avoid double-discounting</li>
                  )}
                  {promoWarning.aiStrategy === 'increase' && (
                    <li><strong>Increase exit offers to {promoWarning.amount + 5}%</strong> to beat your site-wide promotion</li>
                  )}
                  <li>Save you money by not showing discounts to customers who would buy anyway</li>
                  <li>Email you when promotions are detected with recommended actions</li>
                  <li>Let you set announcement mode (0% offers) with one click</li>
                </ul>
              </div>
              <Link 
                to="/app/upgrade" 
                style={{
                  display: "inline-block",
                  background: "#f59e0b",
                  color: "white",
                  padding: "12px 24px",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 16,
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                }}
              >
                Upgrade to Enterprise - $249/mo →
              </Link>
              <p style={{ 
                margin: 0, 
                marginTop: 12,
                fontSize: 13, 
                color: "#92400e" 
              }}>
                Save $600/year with annual billing
              </p>
            </div>
          </div>
        </div>
      )}
      
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
          {/* Dev Tools */}
          {plan && (
            <div style={{ display: "flex", gap: 12 }}>
              {/* Plan Switcher */}
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

              {/* Test Reset Button */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  🔧 Dev: Test Reset
                </label>
                <button
                  onClick={() => {
                    fetcher.submit(
                      { actionType: "testReset" },
                      { method: "post" }
                    );
                    setTimeout(() => window.location.reload(), 500);
                  }}
                  style={{
                    padding: "8px 12px",
                    border: "2px solid #ef4444",
                    borderRadius: 6,
                    background: "white",
                    color: "#ef4444",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: "pointer"
                  }}
                >
                  Force Reset
                </button>
              </div>
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
          const limit = plan.tier === "starter" ? 1000 : plan.tier === "pro" ? 10000 : null;
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
                <div style={{ fontWeight: 600, fontSize: 16, color: isOverLimit ? "#991b1b" : isNearLimit ? "#92400e" : "#1f2937" }}>
                  {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Plan • {usage.toLocaleString()} of {limit.toLocaleString()} sessions used this month
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
                Resets {resetDateFormatted} 
                <InfoTooltip content="Sessions = each time the modal is shown to a customer. Your counter resets monthly." />
              </div>

              {isOverLimit && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#991b1b" }}>
                  ⚠️ Monthly limit reached. {plan.tier === "starter" ? "Upgrade to Pro for 10,000 sessions/month" : "Upgrade to Enterprise for unlimited sessions"}.{" "}
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

      {/* Hero Revenue Card - Last 30 Days */}
      <div style={{
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: 40,
        borderRadius: 12,
        color: "white",
        marginBottom: 32,
        boxShadow: "0 10px 30px rgba(102, 126, 234, 0.3)"
      }}>
        <div style={{ fontSize: 16, opacity: 0.9, marginBottom: 16 }}>
          Your Performance (Last 30 Days)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Revenue Saved</div>
            <div style={{ fontSize: 32, fontWeight: "bold" }}>
              ${analytics.last30Days.totalRevenue.toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Orders Created</div>
            <div style={{ fontSize: 32, fontWeight: "bold" }}>
              {analytics.last30Days.conversions.toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Times Shown</div>
            <div style={{ fontSize: 32, fontWeight: "bold" }}>
              {analytics.last30Days.impressions.toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>Success Rate</div>
            <div style={{ fontSize: 32, fontWeight: "bold" }}>
              {analytics.last30Days.conversionRate}%
            </div>
          </div>
        </div>
        
        {/* Empty State Guidance */}
        {analytics.last30Days.conversions === 0 && analytics.last30Days.impressions > 0 && (
          <div style={{
            marginTop: 24,
            padding: 16,
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: 8,
            fontSize: 14
          }}>
            Just getting started? These numbers will grow as customers see your modal and make purchases.
          </div>
        )}
        
        {analytics.last30Days.impressions === 0 && (
          <div style={{
            marginTop: 24,
            padding: 16,
            background: "rgba(255, 255, 255, 0.15)",
            borderRadius: 8,
            fontSize: 14
          }}>
            Your modal is ready! Enable it using the toggle above to start recovering revenue.
          </div>
        )}
      </div>

      {/* Second Row Metrics */}
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
            marginBottom: 8
          }}>
            People Clicked
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.last30Days.clicks.toLocaleString()}
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
            marginBottom: 8
          }}>
            Click Rate
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            {analytics.last30Days.clickRate}%
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
            marginBottom: 8
          }}>
            Avg Order
          </div>
          <div style={{ fontSize: 32, fontWeight: "bold", color: "#111827" }}>
            ${analytics.last30Days.conversions > 0 
              ? (analytics.last30Days.totalRevenue / analytics.last30Days.conversions).toFixed(2)
              : '0.00'}
          </div>
        </div>
      </div>

      {/* Removed: Old metrics grid replaced with new hero card layout */}

      {/* Removed: Lifetime Analytics now on Performance page */}

{/* AI Performance Section - Pro/Enterprise with AI Mode */}
      {plan && (plan.tier === 'pro' || plan.tier === 'enterprise') && settings && settings.mode === 'ai' && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 32,
          marginBottom: 32
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: "#1f2937" }}>
              AI Performance
            </div>
            <span style={{
              padding: "4px 12px",
              background: "#10b981",
              color: "white",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600
            }}>
              AI Mode Active
            </span>
          </div>
          
          <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 16, lineHeight: 1.6 }}>
            {modalLibrary && modalLibrary.modals && modalLibrary.modals.length > 0 ? (
              <>
                Your AI is testing {modalLibrary.modals.length} different offer{modalLibrary.modals.length > 1 ? 's' : ''} to find what works best
                {modalLibrary.currentModalId && (() => {
                  const currentModal = modalLibrary.modals.find(m => m.modalId === modalLibrary.currentModalId);
                  return currentModal && currentModal.headline ? (
                    <div style={{ marginTop: 12, padding: 16, background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#166534", marginBottom: 4 }}>
                        Current best performer:
                      </div>
                      <div style={{ fontSize: 14, color: "#166534" }}>
                        "{currentModal.headline}"
                      </div>
                    </div>
                  ) : null;
                })()}
              </>
            ) : (
              'Your AI is learning from customer behavior to optimize your offers'
            )}
          </div>
          
          <div style={{ display: "flex", gap: 16 }}>
            <Link
              to="/app/analytics"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                background: "#8B5CF6",
                color: "white",
                textDecoration: "none",
                borderRadius: 6,
                fontWeight: 500,
                fontSize: 14
              }}
            >
              See Detailed Performance →
            </Link>
            <Link
              to="/app/settings"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                border: "1px solid #d1d5db",
                color: "#374151",
                textDecoration: "none",
                borderRadius: 6,
                fontWeight: 500,
                fontSize: 14
              }}
            >
              Adjust AI Settings
            </Link>
          </div>
        </div>
      )}

      {/* Enterprise: Advanced AI Testing Status */}
      {plan && plan.tier === 'enterprise' && settings && settings.mode === 'ai' && (
        <div style={{
          background: "white",
          border: "2px solid #fbbf24",
          borderRadius: 12,
          padding: 32,
          marginBottom: 32
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: "#1f2937" }}>
              Advanced AI Testing
            </div>
            <span style={{
              padding: "4px 12px",
              background: "#fbbf24",
              color: "#78350f",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600
            }}>
              Enterprise Active
            </span>
          </div>
          
          <div style={{ 
            padding: 20, 
            background: "#fef3c7", 
            borderRadius: 8,
            marginBottom: 16
          }}>
            <div style={{ fontSize: 14, color: "#92400e", marginBottom: 8 }}>
              <strong>AI is testing {modalLibrary?.modals?.length || 0} different offers</strong>
            </div>
            <div style={{ fontSize: 13, color: "#92400e" }}>
              {analytics.last30Days.impressions} impressions collected this period
            </div>
          </div>
          
          {modalLibrary && modalLibrary.currentModalId && modalLibrary.modals && modalLibrary.modals.length > 0 && (() => {
            const currentModal = modalLibrary.modals.find(m => m.modalId === modalLibrary.currentModalId);
            if (!currentModal) return null;
            
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", marginBottom: 12 }}>
                  Current Champion
                </div>
                <div style={{ 
                  padding: 16, 
                  background: "#f0fdf4", 
                  borderRadius: 8,
                  border: "1px solid #86efac"
                }}>
                  <div style={{ fontSize: 14, color: "#166534", marginBottom: 4 }}>
                    <strong>"{currentModal.headline}"</strong>
                  </div>
                  <div style={{ fontSize: 13, color: "#166534" }}>
                    {currentModal.body}
                  </div>
                </div>
              </div>
            );
          })()}
          
          <Link
            to="/app/variants"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              background: "#fbbf24",
              color: "#78350f",
              textDecoration: "none",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14
            }}
          >
            View All Variants →
          </Link>
        </div>
      )}

      {/* Tier-Specific Upsell */}
{plan && plan.tier === "starter" && (
  <div style={{
    background: "white",
    border: "2px solid #8B5CF6",
    borderRadius: 12,
    padding: 32,
    marginBottom: 32
  }}>
    <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 8, color: "#1f2937" }}>
      🚀 Grow Sales with Pro
    </div>
    <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>
      Upgrade to get:
    </div>
    <ul style={{ marginBottom: 24, color: "#374151", lineHeight: 1.8 }}>
      <li>AI automatically tests different discounts and messages</li>
      <li>10x more sessions (10,000/month vs 1,000)</li>
      <li>Show modal when customers hesitate on cart page</li>
      <li>Target specific cart amounts</li>
      <li>Track performance over time (not just 30 days)</li>
    </ul>
    <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>
      Most stores see 2-3x more conversions with AI optimization
    </div>
    <Link
      to="/app/upgrade"
      style={{
        display: "inline-block",
        padding: "12px 24px",
        background: "#8B5CF6",
        color: "white",
        textDecoration: "none",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 16
      }}
    >
      See Plans & Pricing →
    </Link>
  </div>
)}

{plan && plan.tier === "pro" && (
  <div style={{
    background: "white",
    border: "2px solid #fbbf24",
    borderRadius: 12,
    padding: 32,
    marginBottom: 32
  }}>
    <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 8, color: "#1f2937" }}>
      ⚡ Maximize Results with Enterprise
    </div>
    <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>
      Get even better performance:
    </div>
    <ul style={{ marginBottom: 24, color: "#374151", lineHeight: 1.8 }}>
      <li>AI tests 10 variants at once (vs 2 on Pro)</li>
      <li>Unlimited sessions (never get cut off)</li>
      <li>Modal matches your brand colors automatically</li>
      <li>Adapts to Black Friday, holidays, busy seasons</li>
      <li>Detailed variant performance tracking</li>
      <li>Priority support</li>
    </ul>
    <Link
      to="/app/upgrade"
      style={{
        display: "inline-block",
        padding: "12px 24px",
        background: "#fbbf24",
        color: "#78350f",
        textDecoration: "none",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 16
      }}
    >
      Compare Plans →
    </Link>
  </div>
)}

{/* Recent Activity Feed - Enterprise Only */}
      {plan && plan.tier === 'enterprise' && analytics.recentEvents && analytics.recentEvents.length > 0 && (
        <div style={{
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 32,
          marginBottom: 32
        }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: "#1f2937", marginBottom: 16 }}>
            Recent Activity
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {analytics.recentEvents.slice(0, 5).map((event, index) => {
              const timeAgo = (() => {
                const now = new Date();
                const eventTime = new Date(event.timestamp);
                const diffMinutes = Math.floor((now - eventTime) / (1000 * 60));
                
                if (diffMinutes < 1) return 'Just now';
                if (diffMinutes < 60) return `${diffMinutes} min ago`;
                const diffHours = Math.floor(diffMinutes / 60);
                if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                const diffDays = Math.floor(diffHours / 24);
                return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
              })();
              
              const eventIcon = event.type === 'conversion' ? '●' : event.type === 'click' ? '●' : '●';
              const eventColor = event.type === 'conversion' ? '#10b981' : event.type === 'click' ? '#8B5CF6' : '#6b7280';
              const eventText = event.type === 'conversion' 
                ? `Conversion${event.revenue ? `: $${event.revenue.toFixed(2)} order` : ''}`
                : event.type === 'click' 
                  ? 'Click on primary CTA'
                  : 'Impression shown';
              
              return (
                <div 
                  key={index}
                  style={{
                    padding: 12,
                    background: "#f9fafb",
                    borderRadius: 6,
                    fontSize: 14,
                    color: "#374151",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: eventColor, fontSize: 20 }}>●</span>
                    <span>{eventText}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    {timeAgo}
                  </div>
                </div>
              );
            })}
          </div>
          
          {analytics.recentEvents.length === 0 && (
            <div style={{ 
              padding: 24, 
              textAlign: "center", 
              color: "#6b7280",
              fontSize: 14 
            }}>
              No recent activity yet. Activity will appear here as customers interact with your modal.
            </div>
          )}
        </div>
      )}

      {/* Configure Button removed - now in modal preview header */}

      {/* Current Modal Preview */}
      {settings && (
        <div style={{
          marginTop: 32,
          padding: 24,
          background: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 0, fontSize: 20, fontWeight: 600 }}>
                Your Current Modal
              </h3>
              {settings.mode === 'ai' && modalLibrary && modalLibrary.currentModalId && (
                <span style={{
                  padding: "4px 12px",
                  background: "#8B5CF6",
                  color: "white",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600
                }}>
                  AI-Generated
                </span>
              )}
            </div>
            <Link
              to="/app/settings"
              style={{
                padding: "8px 16px",
                background: "#8B5CF6",
                color: "white",
                textDecoration: "none",
                borderRadius: 6,
                fontWeight: 500,
                fontSize: 14
              }}
            >
              Edit Settings
            </Link>
          </div>
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
              {(() => {
                // If AI mode and modal library exists, show AI-generated copy
                if (settings.mode === 'ai' && modalLibrary && modalLibrary.currentModalId) {
                  const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);
                  if (currentModal) {
                    return (
                      <>
                        <h2 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>
                          {currentModal.headline}
                        </h2>
                        <p style={{ marginBottom: 24, color: "#666", lineHeight: 1.6 }}>
                          {currentModal.body}
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
                          {currentModal.cta}
                        </button>
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
                          Discount code will be auto-applied at checkout
                        </div>
                      </>
                    );
                  }
                }
                
                // Fallback to manual settings
                return (
                  <>
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
                        Code: <strong>{settings.discountCode}</strong> will be auto-applied
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          
          {/* Trigger Info */}
          <div style={{ marginTop: 16, fontSize: 14, color: "#6b7280" }}>
            Shows when: Customer tries to leave page
            {plan && (plan.tier === 'pro' || plan.tier === 'enterprise') && (
              <span> • Cart page after 30s • Cart value triggers</span>
            )}
          </div>
          
          <Link
            to="/app/settings"
            style={{
              display: "inline-block",
              marginTop: 16,
              color: "#8B5CF6",
              textDecoration: "none",
              fontWeight: 500,
              fontSize: 14
            }}
          >
            Edit Modal Settings →
          </Link>
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
    </AppLayout>
  );
}