import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Load settings from shop metafields
  try {
    const response = await admin.graphql(
      `query {
        shop {
          metafield(namespace: "exit_intent", key: "settings") {
            value
          }
        }
      }`
    );

    const data = await response.json();
    const settingsValue = data.data.shop?.metafield?.value;
    
    // Default settings if none exist
    const defaultSettings = {
      modalHeadline: "Wait! Don't leave yet 🎁",
      modalBody: "Complete your purchase now and get free shipping on your order!",
      ctaButton: "Complete My Order",
      exitIntentEnabled: true,
      timeDelayEnabled: false,
      timeDelaySeconds: 30,
      cartValueEnabled: false,
      cartValueMin: 0,
      cartValueMax: 1000
    };

    const settings = settingsValue ? JSON.parse(settingsValue) : defaultSettings;

    return { settings };
  } catch (error) {
    console.error("Error loading settings:", error);
    return { settings: {
      modalHeadline: "Wait! Don't leave yet 🎁",
      modalBody: "Complete your purchase now and get free shipping on your order!",
      ctaButton: "Complete My Order",
      exitIntentEnabled: true,
      timeDelayEnabled: false,
      timeDelaySeconds: 30,
      cartValueEnabled: false,
      cartValueMin: 0,
      cartValueMax: 1000
    }};
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const settings = {
    modalHeadline: formData.get("modalHeadline"),
    modalBody: formData.get("modalBody"),
    ctaButton: formData.get("ctaButton"),
    exitIntentEnabled: formData.get("exitIntentEnabled") === "on",
    timeDelayEnabled: formData.get("timeDelayEnabled") === "on",
    timeDelaySeconds: parseInt(formData.get("timeDelaySeconds") || "30"),
    cartValueEnabled: formData.get("cartValueEnabled") === "on",
    cartValueMin: parseFloat(formData.get("cartValueMin") || "0"),
    cartValueMax: parseFloat(formData.get("cartValueMax") || "1000")
  };

  try {
    // Get shop ID
    const shopResponse = await admin.graphql(
      `query {
        shop {
          id
        }
      }`
    );
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    // Save to shop metafields
    await admin.graphql(
      `mutation SetSettings($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{
          ownerId: $ownerId
          namespace: "exit_intent"
          key: "settings"
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
      }`,
      {
        variables: {
          ownerId: shopId,
          value: JSON.stringify(settings)
        }
      }
    );

    return { success: true, message: "Settings saved successfully!" };
  } catch (error) {
    console.error("Error saving settings:", error);
    return { success: false, message: "Failed to save settings" };
  }
}

export default function Settings() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [showPreview, setShowPreview] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Exit Intent Settings</h1>
      <p style={{ color: "#666", marginBottom: 40 }}>
        Configure your exit intent modal and trigger conditions
      </p>

      {actionData?.success && (
        <div style={{ 
          padding: 16, 
          background: "#d1fae5", 
          color: "#065f46", 
          borderRadius: 8,
          marginBottom: 24 
        }}>
          ✓ {actionData.message}
        </div>
      )}

      <Form method="post">
        {/* Modal Content Section */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>Modal Content</h2>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
              Headline
            </label>
            <input
              type="text"
              name="modalHeadline"
              defaultValue={settings.modalHeadline}
              style={{ 
                width: "100%", 
                padding: "10px 12px", 
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 16
              }}
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
              Body Text
            </label>
            <textarea
              name="modalBody"
              defaultValue={settings.modalBody}
              rows={4}
              style={{ 
                width: "100%", 
                padding: "10px 12px", 
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 16,
                fontFamily: "inherit"
              }}
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
              Button Text
            </label>
            <input
              type="text"
              name="ctaButton"
              defaultValue={settings.ctaButton}
              style={{ 
                width: "100%", 
                padding: "10px 12px", 
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 16
              }}
              required
            />
          </div>

          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            style={{ 
              padding: "10px 20px", 
              background: "#f3f4f6", 
              border: "1px solid #d1d5db",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 16
            }}
          >
            {showPreview ? "Hide Preview" : "Show Preview"}
          </button>
        </div>

        {/* Trigger Conditions Section */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>Trigger Conditions</h2>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                name="exitIntentEnabled"
                defaultChecked={settings.exitIntentEnabled}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>Exit Intent</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Show modal when cursor moves towards top of browser
                </div>
              </div>
            </label>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                name="timeDelayEnabled"
                defaultChecked={settings.timeDelayEnabled}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>Time on Cart Page</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Show modal after customer spends time on cart
                </div>
              </div>
            </label>
            <div style={{ marginLeft: 32, marginTop: 12 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
                Seconds to wait:
              </label>
              <input
                type="number"
                name="timeDelaySeconds"
                defaultValue={settings.timeDelaySeconds}
                min="5"
                max="300"
                style={{ 
                  padding: "8px 12px", 
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  width: 100
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                name="cartValueEnabled"
                defaultChecked={settings.cartValueEnabled}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>Cart Value Threshold</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Only show modal if cart value is within range
                </div>
              </div>
            </label>
            <div style={{ marginLeft: 32, marginTop: 12, display: "flex", gap: 20 }}>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
                  Minimum ($):
                </label>
                <input
                  type="number"
                  name="cartValueMin"
                  defaultValue={settings.cartValueMin}
                  min="0"
                  step="0.01"
                  style={{ 
                    padding: "8px 12px", 
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    width: 120
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 14 }}>
                  Maximum ($):
                </label>
                <input
                  type="number"
                  name="cartValueMax"
                  defaultValue={settings.cartValueMax}
                  min="0"
                  step="0.01"
                  style={{ 
                    padding: "8px 12px", 
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    width: 120
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ 
            padding: "12px 24px", 
            background: isSubmitting ? "#9ca3af" : "#8B5CF6", 
            color: "white", 
            border: "none",
            borderRadius: 6,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            fontSize: 16,
            fontWeight: 500
          }}
        >
          {isSubmitting ? "Saving..." : "Save Settings"}
        </button>
      </Form>

      {/* Preview Modal */}
      {showPreview && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            padding: 40,
            borderRadius: 12,
            maxWidth: 500,
            width: "90%",
            position: "relative"
          }}>
            <button
              onClick={() => setShowPreview(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                background: "none",
                border: "none",
                fontSize: 24,
                cursor: "pointer",
                color: "#666"
              }}
            >
              ×
            </button>
            <h2 style={{ fontSize: 24, marginBottom: 16 }}>
              {settings.modalHeadline}
            </h2>
            <p style={{ marginBottom: 24, color: "#666" }}>
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
      )}
    </div>
  );
}