import { Link, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

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
            metrics: metafield(namespace: "exit_intent", key: "metrics") {
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

    const metrics = shopData?.metrics?.value
      ? JSON.parse(shopData.metrics.value)
      : { impressions: 0, clicks: 0, closeouts: 0, conversions: 0 };

    return { settings, status, metrics };
  } catch (error) {
    console.error("Error loading dashboard:", error);
    return {
      settings: {
        modalHeadline: "Wait! Don't leave yet 🎁",
        modalBody: "Complete your purchase now and get free shipping on your order!",
        ctaButton: "Complete My Order"
      },
      status: { enabled: false },
      metrics: { impressions: 0, clicks: 0, closeouts: 0, conversions: 0 }
    };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const enabled = formData.get("enabled") === "true";

  console.log("🔄 Toggling status to:", enabled);

  try {
    // Get shop ID for metafield owner
    console.log("📍 Step 1: Getting shop ID...");
    const shopResponse = await admin.graphql(
  `query {
    shop {
      id
    }
  }`
);
    const shopResponseText = await shopResponse.text();
    console.log("📍 Shop response:", shopResponseText);
    
    const shopData = JSON.parse(shopResponseText);
    
    if (shopData.errors) {
      console.error("❌ Shop query errors:", JSON.stringify(shopData.errors, null, 4));
      return { success: false, error: "Failed to get shop ID" };
    }
    
    const shopId = shopData.data.shop.id;
    console.log("📍 Shop ID:", shopId);

    console.log("📍 Step 2: Setting metafield...");
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
    console.log("✅ Full GraphQL response:", JSON.stringify(data, null, 4));

    if (data.errors) {
      console.error("❌ GraphQL Errors:", JSON.stringify(data.errors, null, 4));
      return { success: false, error: data.errors[0].message };
    }

    if (data.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("❌ User errors:", data.data.metafieldsSet.userErrors);
      return { success: false, errors: data.data.metafieldsSet.userErrors };
    }

    console.log("✅ Status updated successfully");
    return { success: true };
  } catch (error) {
    console.error("❌ Error updating status:", error);
    console.error("❌ Error details:", error.message);
    return { success: false, error: error.message };
  }
}

export default function Dashboard() {
  const { settings, status, metrics } = useLoaderData();
  const fetcher = useFetcher();

  // Get the current status - either from the fetcher (optimistic) or from loader data
  const currentStatus = fetcher.formData 
    ? fetcher.formData.get("enabled") === "true"
    : status.enabled;

  const isToggling = fetcher.state === "submitting" || fetcher.state === "loading";

  return (
    <div style={{ padding: 40 }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "flex-start",
        marginBottom: 40 
      }}>
        <div>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Exit Intent Dashboard</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, color: "#666" }}>Status:</span>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 16px",
              borderRadius: 20,
              background: currentStatus ? "#d1fae5" : "#e5e7eb",
              color: currentStatus ? "#065f46" : "#666",
              fontWeight: 500
            }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: currentStatus ? "#10b981" : "#9ca3af"
              }} />
              {currentStatus ? "Modal Enabled" : "Modal Disabled"}
            </div>
          </div>
        </div>

        {/* Toggle Switch */}
        <fetcher.Form method="post">
          <input type="hidden" name="enabled" value={currentStatus ? "false" : "true"} />
          <button
            type="submit"
            disabled={isToggling}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 24px",
              background: currentStatus ? "#d1fae5" : "#e5e7eb",
              color: currentStatus ? "#065f46" : "#666",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 500,
              cursor: isToggling ? "not-allowed" : "pointer",
              opacity: isToggling ? 0.6 : 1
            }}
          >
            <div style={{
              width: 48,
              height: 24,
              borderRadius: 12,
              background: currentStatus ? "#10b981" : "#9ca3af",
              position: "relative",
              transition: "background 0.2s"
            }}>
              <div style={{
                position: "absolute",
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "white",
                top: 2,
                left: currentStatus ? 26 : 2,
                transition: "left 0.2s"
              }} />
            </div>
            {isToggling ? "Updating..." : (currentStatus ? "Turn Off" : "Turn On")}
          </button>
        </fetcher.Form>
      </div>

      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "1fr 1fr", 
        gap: 40,
        marginBottom: 40
      }}>
        {/* Left: Modal Preview */}
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Current Modal</h2>
          <div style={{
            border: "2px solid #e5e7eb",
            borderRadius: 12,
            padding: 32,
            background: "white"
          }}>
            <h3 style={{ fontSize: 20, marginBottom: 12, fontWeight: 600 }}>
              {settings.modalHeadline}
            </h3>
            <p style={{ marginBottom: 20, color: "#666", lineHeight: 1.5 }}>
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
          </div>
        </div>

        {/* Right: Metrics */}
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Performance Metrics</h2>
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1fr 1fr", 
            gap: 16 
          }}>
            <MetricCard 
              title="Impressions" 
              value={metrics.impressions}
              color="#8B5CF6"
            />
            <MetricCard 
              title="Button Clicks" 
              value={metrics.clicks}
              color="#06B6D4"
            />
            <MetricCard 
              title="Close Outs" 
              value={metrics.closeouts}
              color="#F59E0B"
            />
            <MetricCard 
              title="Conversions" 
              value={metrics.conversions}
              color="#10B981"
            />
          </div>
        </div>
      </div>

      <Link to="/app/settings">
        <button style={{
          padding: "14px 28px",
          background: "#8B5CF6",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 500,
          cursor: "pointer"
        }}>
          Configure Modal
        </button>
      </Link>
    </div>
  );
}

function MetricCard({ title, value, color }) {
  return (
    <div style={{
      background: "white",
      padding: 20,
      borderRadius: 8,
      border: "1px solid #e5e7eb"
    }}>
      <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}