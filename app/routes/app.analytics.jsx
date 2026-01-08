import { useLoaderData, Link, Form } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getDefaultModalLibrary } from "../utils/modalHash";
import AppLayout from "../components/AppLayout";

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  
  try {
    const formData = await request.formData();
    const action = formData.get("action");
    
    if (action === "testConversion") {
      const revenue = parseFloat(formData.get("testRevenue") || "100");
      
      // Get shop ID
      const shopResponse = await admin.graphql(`
        query {
          shop {
            id
            analytics: metafield(namespace: "exit_intent", key: "analytics") {
              value
            }
            modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
              value
            }
          }
        }
      `);
      
      const shopData = await shopResponse.json();
      const shopId = shopData.data.shop.id;
      
      // Update analytics
      const analytics = shopData.data.shop?.analytics?.value
        ? JSON.parse(shopData.data.shop.analytics.value)
        : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0, events: [] };
      
      analytics.conversions += 1;
      analytics.revenue += revenue;
      
      if (!analytics.events) analytics.events = [];
      analytics.events.push({
        type: "conversion",
        timestamp: new Date().toISOString(),
        revenue: revenue
      });
      
      await admin.graphql(`
        mutation SetAnalytics($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "analytics"
            value: $value
            type: "json"
          }]) {
            metafields { id }
          }
        }
      `, {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(analytics)
        }
      });
      
      // Update modal library
      if (shopData.data.shop?.modalLibrary?.value) {
        const modalLibrary = JSON.parse(shopData.data.shop.modalLibrary.value);
        const currentModal = modalLibrary.modals?.find(m => m.modalId === modalLibrary.currentModalId);
        
        if (currentModal) {
          currentModal.stats.conversions = (currentModal.stats.conversions || 0) + 1;
          currentModal.stats.revenue = (currentModal.stats.revenue || 0) + revenue;
          
          await admin.graphql(`
            mutation UpdateModalLibrary($ownerId: ID!, $value: String!) {
              metafieldsSet(metafields: [{
                ownerId: $ownerId
                namespace: "exit_intent"
                key: "modal_library"
                value: $value
                type: "json"
              }]) {
                metafields { id }
              }
            }
          `, {
            variables: {
              ownerId: shopId,
              value: JSON.stringify(modalLibrary)
            }
          });
        }
      }
      
      console.log(`✓ Test conversion added: $${revenue}`);
      return { success: true };
    }
    
    return { success: false };
  } catch (error) {
    console.error("Error in action:", error);
    return { success: false };
  }
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    // Get date range from URL params
    const url = new URL(request.url);
    const dateRange = url.searchParams.get('range') || '30d';
    
    const response = await admin.graphql(`
      query {
        shop {
          id
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
    
    const plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : { tier: "starter" };

    const modalLibrary = data.data.shop?.modalLibrary?.value
      ? JSON.parse(data.data.shop.modalLibrary.value)
      : getDefaultModalLibrary();

    // TODO: Filter modal stats by date range when event-level tracking is implemented
    // Currently showing all-time stats regardless of dateRange selection
    // Need to:
    // 1. Store timestamped events for each modal
    // 2. Filter events by dateRange (7d, 30d, all)
    // 3. Recalculate impressions, clicks, conversions, revenue from filtered events

    return { plan, modalLibrary, dateRange };
  } catch (error) {
    console.error("Error loading analytics:", error);
    return { 
      plan: { tier: "starter" },
      modalLibrary: getDefaultModalLibrary()
    };
  }
}

 

export default function Performance() {
  const { plan, modalLibrary, dateRange: loaderDateRange } = useLoaderData();
  const canAccessPerformance = plan && (plan.tier === 'pro' || plan.tier === 'enterprise');
  const canAccessAIVariants = plan && plan.tier === 'enterprise';
  
  const [activeTab, setActiveTab] = useState('modals');
  const [dateRange, setDateRange] = useState(loaderDateRange || '30d');
  
  const handleDateRangeChange = (range) => {
    setDateRange(range);
    // Update URL to trigger loader refresh
    window.location.href = `/app/analytics?range=${range}`;
  };

  // Starter users see locked page
  if (!canAccessPerformance) {
    return (
      <AppLayout plan={plan}>
        <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 32, marginBottom: 16 }}>Performance</h1>
        
        <div style={{
          background: "white",
          padding: 48,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          textAlign: "center"
        }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>Pro Feature</h2>
          <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Compare performance across all your modal campaigns, track trends over time, 
            and make data-driven decisions about your exit intent strategy.
          </p>
          
          {/* Blurred preview */}
          <div style={{ filter: "blur(8px)", opacity: 0.5, marginBottom: 32 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th style={{ padding: 16, textAlign: "left" }}>Modal Name</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Impressions</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Clicks</th>
                  <th style={{ padding: 16, textAlign: "right" }}>CVR</th>
                  <th style={{ padding: 16, textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: 16 }}>Holiday Special 15%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>12,847</td>
                  <td style={{ padding: 16, textAlign: "right" }}>4,231</td>
                  <td style={{ padding: 16, textAlign: "right" }}>4.2%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>$8,420</td>
                </tr>
                <tr>
                  <td style={{ padding: 16 }}>Welcome 10% Off</td>
                  <td style={{ padding: 16, textAlign: "right" }}>8,234</td>
                  <td style={{ padding: 16, textAlign: "right" }}>2,847</td>
                  <td style={{ padding: 16, textAlign: "right" }}>2.8%</td>
                  <td style={{ padding: 16, textAlign: "right" }}>$4,210</td>
                </tr>
              </tbody>
            </table>
          </div>

          <Link
            to="/app/upgrade"
            style={{
              display: "inline-block",
              padding: "12px 32px",
              background: "#8B5CF6",
              color: "white",
              textDecoration: "none",
              borderRadius: 6,
              fontWeight: 500,
              fontSize: 16
            }}
          >
            Upgrade to Pro
          </Link>
        </div>

        <div style={{ marginTop: 32, textAlign: "center" }}>
          <Link
            to="/app"
            style={{
              color: "#8B5CF6",
              textDecoration: "none",
              fontSize: 16
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
      </AppLayout>
    );
  }

   
  const modals = modalLibrary.modals || [];
  const activeModal = modals.find(m => m.modalId === modalLibrary.currentModalId);

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, margin: 0 }}>Performance</h1>
          
          {/* Date Selector */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleDateRangeChange('30d')}
              style={{
                padding: "8px 16px",
                background: dateRange === '30d' ? "#8B5CF6" : "white",
                color: dateRange === '30d' ? "white" : "#6b7280",
                border: dateRange === '30d' ? "none" : "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setDateRange('7d')}
              style={{
                padding: "8px 16px",
                background: dateRange === '7d' ? "#8B5CF6" : "white",
                color: dateRange === '7d' ? "white" : "#6b7280",
                border: dateRange === '7d' ? "none" : "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setDateRange('all')}
              style={{
                padding: "8px 16px",
                background: dateRange === 'all' ? "#8B5CF6" : "white",
                color: dateRange === 'all' ? "white" : "#6b7280",
                border: dateRange === 'all' ? "none" : "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              All Time
            </button>
          </div>
        </div>
        <p style={{ color: "#666", margin: 0 }}>
          Compare performance across all your modal campaigns
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{ 
        borderBottom: "2px solid #e5e7eb", 
        marginBottom: 32,
        display: "flex",
        gap: 0
      }}>
        <button
          onClick={() => setActiveTab('modals')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'modals' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'modals' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'modals' ? 600 : 400,
            fontSize: 16,
            cursor: "pointer",
            marginBottom: -2,
            transition: "all 0.2s"
          }}
        >
          Your Modals
        </button>
        
        <button
          onClick={() => canAccessAIVariants && setActiveTab('variants')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'variants' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'variants' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'variants' ? 600 : 400,
            fontSize: 16,
            cursor: canAccessAIVariants ? "pointer" : "not-allowed",
            marginBottom: -2,
            opacity: canAccessAIVariants ? 1 : 0.5,
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: 8
          }}
        >
          AI Variants
          {!canAccessAIVariants && (
            <span style={{
              padding: "2px 6px",
              background: "#8B5CF6",
              color: "white",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600
            }}>
              ENTERPRISE
            </span>
          )}
        </button>
      </div>

      {/* Tab Content - Your Modals */}
      {activeTab === 'modals' && (
        <>
      {/* Modal Performance Table */}
      <div style={{
        background: "white",
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        overflow: "hidden"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Modal</th>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Status</th>
              <th style={{ padding: 16, textAlign: "left", fontWeight: 600 }}>Dates</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Shown</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Clicks</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Orders</th>
              <th style={{ padding: 16, textAlign: "right", fontWeight: 600 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {modals.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
                  No modals created yet. Save your first modal in Settings to start tracking performance.
                </td>
              </tr>
            ) : (
              modals.map((modal) => {
                return (
                  <tr 
                    key={modal.modalId}
                    style={{ 
                      borderBottom: "1px solid #e5e7eb",
                      background: modal.active ? "#f0f9ff" : "white"
                    }}
                  >
                    <td style={{ padding: 16, fontWeight: 500 }}>
                      {modal.modalName}
                    </td>
                    <td style={{ padding: 16 }}>
                      {modal.active ? (
                        <span style={{
                          padding: "4px 8px",
                          background: "#10b981",
                          color: "white",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600
                        }}>
                          Enabled
                        </span>
                      ) : (
                        <span style={{
                          padding: "4px 8px",
                          background: "#6b7280",
                          color: "white",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600
                        }}>
                          Disabled
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 16, fontSize: 14, color: "#6b7280" }}>
                      {modal.active ? (
                        <div>
                          {new Date(modal.createdAt).toLocaleDateString()} - Now
                        </div>
                      ) : (
                        <div>
                          {new Date(modal.createdAt).toLocaleDateString()} - {new Date(modal.lastActiveAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.impressions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.clicks.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right" }}>
                      {modal.stats.conversions.toLocaleString()}
                    </td>
                    <td style={{ padding: 16, textAlign: "right", fontWeight: 600, color: "#10b981" }}>
                      ${modal.stats.revenue.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
        </>
      )}

      {/* Tab Content - AI Variants */}
      {activeTab === 'variants' && (
        <div style={{
          background: "white",
          padding: 48,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          textAlign: "center"
        }}>
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>AI Variant Testing</h2>
          <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 24 }}>
            Track performance across all AI-generated variants and see which copy performs best.
          </p>
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Coming soon - detailed variant performance analytics
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, textAlign: "center" }}>
        <Link
          to="/app"
          style={{
            color: "#8B5CF6",
            textDecoration: "none",
            fontSize: 16
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>
    </div>
    </AppLayout>
  );
}