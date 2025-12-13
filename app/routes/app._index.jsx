import { Link, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { useState } from "react";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(
      `#graphql
        query {
          shop {
            settings: metafield(namespace: "exit_intent", key: "settings") {
              value
            }
            status: metafield(namespace: "exit_intent", key: "status") {
              value
            }
            analytics: metafield(namespace: "exit_intent", key: "analytics") {
              value
            }
          }
        }`
    );

    const data = await response.json();
    const shopData = data.data.shop;

    const defaultSettings = {
      modalHeadline: "Wait! Don't leave yet 🎁",
      modalBody: "Complete your purchase now and get free shipping on your order!",
      ctaButton: "Complete My Order"
    };

    const settings = shopData?.settings?.value 
      ? JSON.parse(shopData.settings.value) 
      : defaultSettings;

    const status = shopData?.status?.value 
      ? JSON.parse(shopData.status.value)
      : { enabled: false };

    const analytics = shopData?.analytics?.value
      ? JSON.parse(shopData.analytics.value)
      : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0 };

    return { settings, status, analytics };
  } catch (error) {
    console.error("Error loading dashboard:", error);
    return {
      settings: {
        modalHeadline: "Wait! Don't leave yet 🎁",
        modalBody: "Complete your purchase now and get free shipping on your order!",
        ctaButton: "Complete My Order"
      },
      status: { enabled: false },
      analytics: { impressions: 0, clicks: 0, closeouts: 0, conversions: 0, revenue: 0 }
    };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const enabled = formData.get("enabled") === "true";

  try {
    const shopResponse = await admin.graphql(
      `query {
        shop {
          id
        }
      }`
    );
    const shopData = await shopResponse.json();
    
    if (shopData.errors) {
      return { success: false, error: "Failed to get shop ID" };
    }
    
    const shopId = shopData.data.shop.id;

    const result = await admin.graphql(
      `#graphql
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
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          ownerId: shopId,
          value: JSON.stringify({ enabled })
        }
      }
    );

    const data = await result.json();

    if (data.errors) {
      return { success: false, error: data.errors[0].message };
    }

    if (data.data?.metafieldsSet?.userErrors?.length > 0) {
      return { success: false, errors: data.data.metafieldsSet.userErrors };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default function Dashboard() {
  const { settings, status, analytics } = useLoaderData();
  const fetcher = useFetcher();

  const currentStatus = fetcher.formData 
    ? fetcher.formData.get("enabled") === "true"
    : status.enabled;

  const isToggling = fetcher.state === "submitting" || fetcher.state === "loading";

  const conversionRate = analytics.impressions > 0 
    ? ((analytics.conversions / analytics.impressions) * 100).toFixed(1)
    : 0;
  
  const clickRate = analytics.impressions > 0
    ? ((analytics.clicks / analytics.impressions) * 100).toFixed(1)
    : 0;

  const revenuePerImpression = analytics.impressions > 0
    ? (analytics.revenue / analytics.impressions).toFixed(2)
    : "0.00";

  return (
    <div style={{ 
      minHeight: "100vh",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      padding: "48px 24px"
    }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        
        {/* Header */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          marginBottom: 48
        }}>
          <div>
            <h1 style={{ 
              fontSize: 42, 
              fontWeight: 800, 
              color: "white",
              marginBottom: 8,
              letterSpacing: "-0.02em"
            }}>
              Exit Intent Dashboard
            </h1>
            <p style={{ 
              fontSize: 18, 
              color: "rgba(255,255,255,0.8)",
              margin: 0
            }}>
              Track your modal performance and revenue recovery
            </p>
          </div>

          {/* Status Toggle */}
          <fetcher.Form method="post">
            <input type="hidden" name="enabled" value={currentStatus ? "false" : "true"} />
            <button
              type="submit"
              disabled={isToggling}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 28px",
                background: "white",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 600,
                cursor: isToggling ? "not-allowed" : "pointer",
                opacity: isToggling ? 0.6 : 1,
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                transition: "all 0.2s",
                color: "#1f2937"
              }}
            >
              <div style={{
                width: 52,
                height: 28,
                borderRadius: 14,
                background: currentStatus ? "#10b981" : "#d1d5db",
                position: "relative",
                transition: "background 0.3s"
              }}>
                <div style={{
                  position: "absolute",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "white",
                  top: 2,
                  left: currentStatus ? 26 : 2,
                  transition: "left 0.3s",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                }} />
              </div>
              <span>{currentStatus ? "Active" : "Inactive"}</span>
            </button>
          </fetcher.Form>
        </div>

        {/* Revenue Hero Card */}
        <div style={{
          background: "white",
          borderRadius: 24,
          padding: 48,
          marginBottom: 32,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
        }}>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: 48,
            alignItems: "center"
          }}>
            <div>
              <div style={{ 
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12
              }}>
                <div style={{ 
                  fontSize: 14, 
                  fontWeight: 600,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em"
                }}>
                  Total Revenue Recovered
                </div>
                <InfoTooltip text="Total value of orders that used your exit intent discount code. This is the revenue you recovered from customers who were about to leave." />
              </div>
              <div style={{ 
                fontSize: 64, 
                fontWeight: 800, 
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                lineHeight: 1,
                marginBottom: 8
              }}>
                ${analytics.revenue.toLocaleString('en-US', { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })}
              </div>
              <div style={{ fontSize: 14, color: "#9ca3af" }}>
                from {analytics.conversions} conversions
              </div>
            </div>

            <StatPill 
              label="Conversion Rate"
              value={`${conversionRate}%`}
              color="#10b981"
              tooltip="Conversions ÷ Impressions × 100. Shows what % of people who saw your modal completed a purchase."
            />
            <StatPill 
              label="Click Rate"
              value={`${clickRate}%`}
              color="#3b82f6"
              tooltip="Clicks ÷ Impressions × 100. Shows what % of people who saw your modal clicked the CTA button."
            />
            <StatPill 
              label="RPV"
              value={`$${revenuePerImpression}`}
              color="#8b5cf6"
              tooltip="Revenue Per View (Total Revenue ÷ Impressions). Shows average revenue generated each time someone sees your modal. Higher is better!"
            />
          </div>
        </div>

        {/* Metrics Grid */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          marginBottom: 32
        }}>
          <MetricCard 
            icon="📊"
            title="Impressions" 
            value={analytics.impressions}
            color="#8b5cf6"
            bgGradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
          />
          <MetricCard 
            icon="🖱️"
            title="Clicks" 
            value={analytics.clicks}
            color="#3b82f6"
            bgGradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
            subtitle={`${clickRate}% of impressions`}
          />
          <MetricCard 
            icon="✅"
            title="Conversions" 
            value={analytics.conversions}
            color="#10b981"
            bgGradient="linear-gradient(135deg, #10b981 0%, #059669 100%)"
            subtitle={`${conversionRate}% rate`}
          />
          <MetricCard 
            icon="❌"
            title="Closed" 
            value={analytics.closeouts}
            color="#f59e0b"
            bgGradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
          />
        </div>

        {/* Modal Preview */}
        <div style={{
          background: "white",
          borderRadius: 24,
          padding: 48,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
        }}>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 32
          }}>
            <h2 style={{ 
              fontSize: 24, 
              fontWeight: 700,
              color: "#1f2937",
              margin: 0
            }}>
              Current Modal Preview
            </h2>
            <Link to="/app/settings" style={{ textDecoration: "none" }}>
              <button style={{
                padding: "12px 24px",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4)",
                transition: "transform 0.2s, box-shadow 0.2s"
              }}>
                ⚙️ Configure Modal
              </button>
            </Link>
          </div>

          <div style={{
            maxWidth: 600,
            margin: "0 auto",
            border: "2px solid #e5e7eb",
            borderRadius: 16,
            padding: 40,
            background: "#f9fafb"
          }}>
            <h3 style={{ 
              fontSize: 28, 
              marginBottom: 16, 
              fontWeight: 700,
              color: "#1f2937"
            }}>
              {settings.modalHeadline}
            </h3>
            <p style={{ 
              marginBottom: 28, 
              color: "#6b7280", 
              lineHeight: 1.6,
              fontSize: 16
            }}>
              {settings.modalBody}
            </p>
            <button style={{
              width: "100%",
              padding: "16px 32px",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              border: "none",
              borderRadius: 12,
              fontSize: 17,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(102, 126, 234, 0.4)"
            }}>
              {settings.ctaButton}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);

  return (
    <div 
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "#d1d5db",
        color: "#6b7280",
        fontSize: 11,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "help",
        userSelect: "none"
      }}>
        i
      </div>
      {show && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#1f2937",
          color: "white",
          padding: "12px 16px",
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "nowrap",
          maxWidth: 300,
          whiteSpace: "normal",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          zIndex: 1000,
          pointerEvents: "none"
        }}>
          {text}
          <div style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: "6px solid #1f2937"
          }} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, title, value, color, bgGradient, subtitle }) {
  return (
    <div style={{
      background: "white",
      padding: 28,
      borderRadius: 20,
      boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
      transition: "transform 0.2s, box-shadow 0.2s",
      cursor: "default",
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        background: bgGradient
      }} />
      <div style={{ 
        fontSize: 32, 
        marginBottom: 12
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 8, fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ fontSize: 40, fontWeight: 800, color: "#1f2937", lineHeight: 1 }}>
        {value.toLocaleString()}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color, tooltip }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ 
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        marginBottom: 8
      }}>
        <div style={{ 
          fontSize: 12, 
          color: "#6b7280",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}>
          {label}
        </div>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div style={{
        fontSize: 32,
        fontWeight: 800,
        color: color
      }}>
        {value}
      </div>
    </div>
  );
}