import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";

async function createDiscountCode(admin, discountPercentage) {
  const discountCode = `${discountPercentage}OFF`;  // Changed from EXIT${discountPercentage}
  
  console.log(`Creating discount code: ${discountCode}`);
  
  // Check if THIS SPECIFIC code already exists
  const checkQuery = `
    query {
      codeDiscountNodes(first: 10, query: "title:'Exit Intent Offer'") {
        nodes {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
      }
    }
  `;
  
  const checkResponse = await admin.graphql(checkQuery);
  const checkResult = await checkResponse.json();
  
  // Check if the specific code (10OFF, 15OFF, etc) already exists
  const existingNode = checkResult.data.codeDiscountNodes.nodes.find(node => 
    node.codeDiscount.codes.nodes[0]?.code === discountCode
  );
  
  if (existingNode) {
    console.log(`✓ Using existing discount code: ${discountCode}`);
    return discountCode;
  }
  
  // Create new discount code with percentage in title
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `${discountPercentage}% Off - Exit Intent Offer`,  // Updated title format
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: {
        all: true
      },
      customerGets: {
        value: {
          percentage: discountPercentage / 100
        },
        items: {
          all: true
        }
      },
      appliesOncePerCustomer: false,
      usageLimit: null
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.discountCodeBasicCreate.userErrors.length > 0) {
    console.error("Error creating discount:", result.data.discountCodeBasicCreate.userErrors);
    throw new Error("Failed to create discount code");
  }
  
  const code = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(`✓ Created new discount code: ${code}`);
  return code;
}

 

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
      cartValueMax: 1000,
      discountEnabled: false,
      discountPercentage: 10,
      discountCode: null,
      redirectDestination: "checkout"
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
      cartValueMax: 1000,
      discountEnabled: false,
      discountPercentage: 10,
      discountCode: null,
      redirectDestination: "checkout"
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
    cartValueMax: parseFloat(formData.get("cartValueMax") || "1000"),
    discountEnabled: formData.get("discountEnabled") === "on",
    discountPercentage: parseInt(formData.get("discountPercentage") || "10"),
    discountCode: null,
    redirectDestination: formData.get("redirectDestination") || "checkout"
  };

  try {
    // Create discount code if enabled
    if (settings.discountEnabled && settings.discountPercentage > 0) {
      settings.discountCode = await createDiscountCode(admin, settings.discountPercentage);
    }

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

    return { 
      success: true, 
      message: settings.discountCode 
        ? `Settings saved! Discount code ${settings.discountCode} created.`
        : "Settings saved successfully!" 
    };
  } catch (error) {
    console.error("Error saving settings:", error);
    return { success: false, message: "Failed to save settings: " + error.message };
  }
}

export default function Settings() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [showPreview, setShowPreview] = useState(false);
  const [formChanged, setFormChanged] = useState(false);  // NEW

  const isSubmitting = navigation.state === "submitting";

  // NEW - Clear success message when form changes
  const handleFormChange = () => {
    if (actionData) {
      setFormChanged(true);
    }
  };

  // NEW - Conditionally show messages
  const showSuccessMessage = actionData?.success && !formChanged && !isSubmitting;
  const showErrorMessage = actionData?.success === false && !formChanged && !isSubmitting;

  return (
    <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Exit Intent Settings</h1>
      <p style={{ color: "#666", marginBottom: 40 }}>
        Configure your exit intent modal and trigger conditions
      </p>

      <Form method="post" onChange={handleFormChange}>  {/* Added onChange */}
        {/* Required Fields Legend */}
        <div style={{
          padding: 12,
          background: "#f3f4f6",
          borderRadius: 6,
          marginBottom: 24,
          fontSize: 14,
          color: "#4b5563"
        }}>
          Fields marked with <span style={{ color: "#dc2626", fontWeight: 600 }}>*</span> are required
        </div>

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
              Headline <span style={{ color: "#dc2626" }}>*</span>
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
              Body Text <span style={{ color: "#dc2626" }}>*</span>
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
              Button Text <span style={{ color: "#dc2626" }}>*</span>
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

        {/* Discount Section */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>Discount Offer <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(Optional)</span></h2>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                name="discountEnabled"
                defaultChecked={settings.discountEnabled}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div>
                <div style={{ fontWeight: 500 }}>Enable Discount Code</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Automatically apply discount when customer clicks the CTA
                </div>
              </div>
            </label>
          </div>

          <div style={{ marginLeft: 32, marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
              Discount Percentage
            </label>
            <input
              type="number"
              name="discountPercentage"
              defaultValue={settings.discountPercentage}
              min="1"
              max="100"
              style={{ 
                padding: "10px 12px", 
                border: "1px solid #d1d5db",
                borderRadius: 6,
                width: 100,
                fontSize: 16
              }}
            />
            <span style={{ marginLeft: 8, color: "#666" }}>%</span>
            
            {settings.discountCode && (
              <div style={{ 
                marginTop: 12, 
                padding: 12, 
                background: "#f9fafb", 
                borderRadius: 6,
                fontSize: 14
              }}>
                <strong>Current code:</strong> {settings.discountCode}
                <div style={{ color: "#666", marginTop: 4 }}>
                  This code will be automatically applied at checkout
                </div>
              </div>
            )}
          </div>

          <div style={{
            padding: 12,
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 6,
            fontSize: 14,
            color: "#1e40af"
          }}>
            💡 <strong>Tip:</strong> If discount is disabled, the modal will still show but won't include a discount offer. Great for simple cart reminders or announcements!
          </div>
        </div>

        {/* Redirect Destination Section */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>After Click Behavior <span style={{ color: "#dc2626" }}>*</span></h2>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
              Where should customers go after clicking the CTA?
            </label>
            
            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              cursor: "pointer",
              padding: 16,
              border: "2px solid",
              borderRadius: 8,
              marginBottom: 12,
              background: (settings.redirectDestination === "checkout" || !settings.redirectDestination) ? "#f0fdf4" : "white",
              borderColor: (settings.redirectDestination === "checkout" || !settings.redirectDestination) ? "#10b981" : "#e5e7eb",
              transition: "all 0.2s"
            }}>
              <input
                type="radio"
                name="redirectDestination"
                value="checkout"
                defaultChecked={!settings.redirectDestination || settings.redirectDestination === "checkout"}
                style={{ marginRight: 12, marginTop: 4 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Checkout
                </div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Send customers directly to checkout. Fewer steps = higher conversion. Discount auto-applies.
                </div>
              </div>
            </label>

            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              cursor: "pointer",
              padding: 16,
              border: "2px solid",
              borderRadius: 8,
              background: settings.redirectDestination === "cart" ? "#f0fdf4" : "white",
              borderColor: settings.redirectDestination === "cart" ? "#10b981" : "#e5e7eb",
              transition: "all 0.2s"
            }}>
              <input
                type="radio"
                name="redirectDestination"
                value="cart"
                defaultChecked={settings.redirectDestination === "cart"}
                style={{ marginRight: 12, marginTop: 4 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Cart Page*
                </div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Send customers to cart page first. Gives them a chance to review or add more items before checkout.
                </div>
                <div style={{ fontSize: 13, color: "#f59e0b", marginTop: 8, fontStyle: "italic" }}>
                  *If discount is enabled and your theme doesn't have a cart discount field, customers will be automatically redirected to checkout to apply the discount.
                </div>
              </div>
            </label>
          </div>

          <div style={{
            padding: 12,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 6,
            fontSize: 14,
            color: "#92400e",
            marginTop: 16
          }}>
            🧪 <strong>A/B Testing Tip:</strong> This is a great variable to test! Try both and see which converts better for your store.
          </div>
        </div>

        {/* Trigger Conditions Section */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>When to Show Modal <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(At least one required)</span></h2>

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
                  Show modal when cursor moves towards top of browser (customer trying to leave)
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
                <div style={{ fontWeight: 500 }}>Time Delay on Cart Page</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Show modal after customer spends time on cart page or has mini cart open
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
        </div>

        {/* Cart Value Conditions Section - NEW SEPARATE SECTION */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>Additional Conditions <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(Optional)</span></h2>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                name="cartValueEnabled"
                defaultChecked={settings.cartValueEnabled}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>Cart Value Range</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Only show modal if cart value falls within a specific range
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

          <div style={{
            padding: 12,
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: 6,
            fontSize: 14,
            color: "#0c4a6e"
          }}>
            💡 <strong>Example:</strong> Set minimum to $100 and maximum to $3000 to only show the modal for mid-range carts. Combine with any trigger above!
          </div>
        </div>

        {/* Save Button with Inline Notification */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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

          {/* Inline Success/Error Message */}
          {showSuccessMessage && (
            <div style={{ 
              padding: "10px 16px", 
              background: "#d1fae5", 
              color: "#065f46", 
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500
            }}>
              ✓ {actionData.message}
            </div>
          )}

          {showErrorMessage && (
            <div style={{ 
              padding: "10px 16px", 
              background: "#fee2e2", 
              color: "#991b1b", 
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500
            }}>
              ✗ {actionData.message}
            </div>
          )}
        </div>
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