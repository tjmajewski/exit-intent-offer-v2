import { useLoaderData, Link, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`
      query {
        shop {
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
      
    const plan = data.data.shop?.plan?.value 
      ? JSON.parse(data.data.shop.plan.value) 
      : null;

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
    const enabled = formData.get("enabled") === "true";

    // Get shop ID
    const shopResponse = await admin.graphql(`
      query {
        shop {
          id
        }
      }
    `);
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    // Save status
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

    return { success: true };
  } catch (error) {
    console.error("Error toggling status:", error);
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
      { enabled: newStatus.toString() },
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