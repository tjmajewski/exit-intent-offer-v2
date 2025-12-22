import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getAvailableTemplates, MODAL_TEMPLATES } from "../utils/templates";
import { generateModalHash, getDefaultModalLibrary, findModalByHash, getNextModalName } from "../utils/modalHash";
import AppLayout from "../components/AppLayout";

async function createDiscountCode(admin, discountPercentage) {
  const discountCode = `${discountPercentage}OFF`;
  
  console.log(`Creating discount code: ${discountCode}`);
  
  // Check if THIS SPECIFIC code already exists
  const checkQuery = `
    query {
      codeDiscountNodes(first: 50, query: "code:'${discountCode}'") {
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
  
  // If the code exists anywhere, just use it (even if not created by us)
  if (checkResult.data.codeDiscountNodes.nodes.length > 0) {
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
      title: `${discountPercentage}% Off - Exit Intent Offer`,
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

  // Load settings AND plan from shop metafields
  try {
    const response = await admin.graphql(
      `query {
        shop {
          metafield(namespace: "exit_intent", key: "settings") {
            value
          }
          plan: metafield(namespace: "exit_intent", key: "plan") {
            value
          }
        }
      }`
    );

    const data = await response.json();
    const settingsValue = data.data.shop?.metafield?.value;
    const planValue = data.data.shop?.plan?.value;
    
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
    const plan = planValue ? JSON.parse(planValue) : null;
    const availableTemplates = plan ? getAvailableTemplates(plan.tier) : getAvailableTemplates("starter");

    // Load modal library
    const modalLibraryResponse = await admin.graphql(`
      query {
        shop {
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
        }
      }
    `);
    const modalLibraryData = await modalLibraryResponse.json();
    const modalLibrary = modalLibraryData.data.shop?.modalLibrary?.value
      ? JSON.parse(modalLibraryData.data.shop.modalLibrary.value)
      : getDefaultModalLibrary();

    return { settings, plan, availableTemplates, modalLibrary };
  } catch (error) {
    console.error("Error loading settings:", error);
    return { 
      settings: {
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
      },
      plan: null
    };
  }
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const settings = {
    template: formData.get("template") || "discount",
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
          currentSettings: metafield(namespace: "exit_intent", key: "settings") {
            value
          }
          modalLibrary: metafield(namespace: "exit_intent", key: "modal_library") {
            value
          }
        }
      }`
    );
    const shopData = await shopResponse.json();
    const shopId = shopData.data.shop.id;

    // Load current settings and modal library
    const currentSettings = shopData.data.shop?.currentSettings?.value
      ? JSON.parse(shopData.data.shop.currentSettings.value)
      : null;

    const modalLibrary = shopData.data.shop?.modalLibrary?.value
      ? JSON.parse(shopData.data.shop.modalLibrary.value)
      : getDefaultModalLibrary();

    // Generate hash for new settings
    const newHash = generateModalHash(settings);
    const currentHash = currentSettings ? generateModalHash(currentSettings) : null;

    // Check if this is a new modal or confirmation with modal name
    const modalName = formData.get("modalName");
    const confirmSave = formData.get("confirmSave") === "true";

    // If settings changed and no confirmation yet, prompt for modal name
    if (newHash !== currentHash && !confirmSave) {
      const existingModal = findModalByHash(modalLibrary, newHash);
      const suggestedName = existingModal 
        ? existingModal.modalName 
        : getNextModalName(modalLibrary);

      return {
        success: false,
        needsConfirmation: true,
        suggestedName,
        existingModal,
        currentSettings,
        newSettings: settings
      };
    }

    // Save settings
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

    // If confirmed, update modal library
    if (confirmSave && modalName) {
      const existingModal = findModalByHash(modalLibrary, newHash);
      
      if (existingModal) {
        // Reactivating existing modal
        modalLibrary.modals = modalLibrary.modals.map(m => ({
          ...m,
          active: m.modalId === existingModal.modalId,
          lastActiveAt: m.modalId === existingModal.modalId ? new Date().toISOString() : m.lastActiveAt
        }));
        modalLibrary.currentModalId = existingModal.modalId;
      } else {
        // Create new modal
        const newModalId = `modal_${Date.now()}`;
        
        // Deactivate all existing modals
        modalLibrary.modals = modalLibrary.modals.map(m => ({ ...m, active: false }));
        
        // Add new modal
        modalLibrary.modals.push({
          modalId: newModalId,
          modalName: modalName,
          hash: newHash,
          active: true,
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          config: settings,
          stats: {
            impressions: 0,
            clicks: 0,
            conversions: 0,
            revenue: 0
          }
        });

        modalLibrary.currentModalId = newModalId;
        modalLibrary.nextModalNumber = modalLibrary.nextModalNumber + 1;
      }

      // Save modal library
      await admin.graphql(
        `mutation SetModalLibrary($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [{
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "modal_library"
            value: $value
            type: "json"
          }]) {
            metafields {
              id
            }
          }
        }`,
        {
          variables: {
            ownerId: shopId,
            value: JSON.stringify(modalLibrary)
          }
        }
      );
    }

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
  const { settings, plan, availableTemplates, modalLibrary } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [showPreview, setShowPreview] = useState(false);
  const [formChanged, setFormChanged] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(settings.template || "discount");
  const [showModalNaming, setShowModalNaming] = useState(false);
  const [modalName, setModalName] = useState("");

  const isSubmitting = navigation.state === "submitting";

  // Show modal naming popup if confirmation needed
  if (actionData?.needsConfirmation && !showModalNaming) {
    setShowModalNaming(true);
    setModalName(actionData.suggestedName);
  }

  // Close modal naming popup after successful save
  if (actionData?.success && showModalNaming) {
    setShowModalNaming(false);
  }

  // Feature gates
  const canUseAllTriggers = plan ? hasFeature(plan, 'allTriggers') : false;
  const canUseCartValue = plan ? hasFeature(plan, 'cartValueTargeting') : false;
  const canChooseRedirect = plan ? hasFeature(plan, 'redirectChoice') : false;
  const canUseMultipleTemplates = plan ? hasFeature(plan, 'multipleTemplates') : false;

  // Apply template to form
  const applyTemplate = (templateId) => {
    const template = MODAL_TEMPLATES[templateId];
    if (!template) return;

    setSelectedTemplate(templateId);

    // Update form fields
    document.querySelector('input[name="modalHeadline"]').value = template.headline;
    document.querySelector('textarea[name="modalBody"]').value = template.body;
    document.querySelector('input[name="ctaButton"]').value = template.ctaButton;
  };

  // Clear success message when form changes
  const handleFormChange = () => {
    if (actionData) {
      setFormChanged(true);
    }
  };

  const showSuccessMessage = actionData?.success && !formChanged && !isSubmitting;
  const showErrorMessage = actionData?.success === false && !formChanged && !isSubmitting;

  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>Exit Intent Settings</h1>
        {modalLibrary?.currentModalId && (
          <div style={{
            padding: "8px 16px",
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: 6,
            color: "#0c4a6e",
            fontWeight: 500,
            fontSize: 14
          }}>
            Current Modal: <strong>{modalLibrary.modals.find(m => m.modalId === modalLibrary.currentModalId)?.modalName || "Unknown"}</strong>
          </div>
        )}
      </div>
      <p style={{ color: "#666", marginBottom: 40 }}>
        Configure your exit intent modal and trigger conditions
      </p>

      <Form method="post" onChange={handleFormChange}>
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

        {/* Template Selector */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>
            Choose a Template
            {!canUseMultipleTemplates && (
              <span style={{ 
                marginLeft: 8, 
                padding: "2px 8px", 
                background: "#8B5CF6", 
                color: "white", 
                borderRadius: 4, 
                fontSize: 12,
                fontWeight: 600 
              }}>
                PRO for more
              </span>
            )}
          </h2>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
            Start with a pre-made template and customize it to match your brand
          </p>

          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", 
            gap: 16 
          }}>
            {availableTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.id)}
                style={{
                  padding: 16,
                  border: selectedTemplate === template.id ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: selectedTemplate === template.id ? "#f5f3ff" : "white",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.2s"
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>{template.icon}</div>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{template.name}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{template.description}</div>
              </button>
            ))}

            {/* Locked templates preview for Starter */}
            {!canUseMultipleTemplates && Object.values(MODAL_TEMPLATES).filter(t => t.tier === "pro").slice(0, 3).map((template) => (
              <div
                key={template.id}
                style={{
                  padding: 16,
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  background: "white",
                  opacity: 0.5,
                  position: "relative",
                  textAlign: "left"
                }}
              >
                <div style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "#8B5CF6",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600
                }}>
                  PRO
                </div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{template.icon}</div>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{template.name}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{template.description}</div>
              </div>
            ))}
          </div>

          {!canUseMultipleTemplates && (
            <div style={{ 
              marginTop: 16, 
              padding: 12, 
              background: "#fef3c7", 
              borderRadius: 6,
              fontSize: 14 
            }}>
              ⭐ <strong>Upgrade to Pro</strong> to unlock 4 additional templates including Free Shipping, Urgency, and more.{" "}
              <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                Learn more →
              </a>
            </div>
          )}

          <input type="hidden" name="template" value={selectedTemplate} />
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
          marginBottom: 24,
          opacity: canChooseRedirect ? 1 : 0.5,
          position: 'relative'
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>
            After Click Behavior <span style={{ color: "#dc2626" }}>*</span>
            {!canChooseRedirect && (
              <span style={{ 
                marginLeft: 8, 
                padding: "2px 8px", 
                background: "#8B5CF6", 
                color: "white", 
                borderRadius: 4, 
                fontSize: 12,
                fontWeight: 600 
              }}>
                PRO
              </span>
            )}
          </h2>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
              Where should customers go after clicking the CTA?
            </label>
            
            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              cursor: canChooseRedirect ? "pointer" : "not-allowed",
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
                disabled={!canChooseRedirect}
                style={{ marginRight: 12, marginTop: 4 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Checkout {!canChooseRedirect && "(Starter Plan Default)"}
                </div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Send customers directly to checkout. Fewer steps = higher conversion. Discount auto-applies.
                </div>
              </div>
            </label>

            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              cursor: canChooseRedirect ? "pointer" : "not-allowed",
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
                disabled={!canChooseRedirect}
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

          {!canChooseRedirect ? (
            <div style={{
              padding: 12,
              background: "#fef3c7",
              border: "1px solid #fde68a",
              borderRadius: 6,
              fontSize: 14,
              color: "#92400e",
              marginTop: 16
            }}>
              ⭐ <strong>Upgrade to Pro</strong> to choose between cart and checkout redirect and A/B test which converts better.{" "}
              <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                Learn more →
              </a>
            </div>
          ) : (
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
          )}
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

          <div style={{ 
            marginBottom: 20,
            opacity: canUseAllTriggers ? 1 : 0.5,
            position: 'relative'
          }}>
            <label style={{ display: "flex", alignItems: "center", cursor: canUseAllTriggers ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                name="timeDelayEnabled"
                defaultChecked={settings.timeDelayEnabled}
                disabled={!canUseAllTriggers}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>
                  Time Delay on Cart Page
                  {!canUseAllTriggers && (
                    <span style={{ 
                      marginLeft: 8, 
                      padding: "2px 8px", 
                      background: "#8B5CF6", 
                      color: "white", 
                      borderRadius: 4, 
                      fontSize: 12,
                      fontWeight: 600 
                    }}>
                      PRO
                    </span>
                  )}
                </div>
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
                disabled={!canUseAllTriggers}
                style={{ 
                  padding: "8px 12px", 
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  width: 100
                }}
              />
            </div>
            
            {!canUseAllTriggers && (
              <div style={{ 
                marginTop: 12, 
                padding: 12, 
                background: "#fef3c7", 
                borderRadius: 6,
                fontSize: 14 
              }}>
                ⭐ <strong>Upgrade to Pro</strong> to unlock time delay triggers and cart value targeting.{" "}
                <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                  Learn more →
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Cart Value Conditions Section */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 20 }}>Additional Conditions <span style={{ fontSize: 14, fontWeight: 400, color: "#6b7280" }}>(Optional)</span></h2>

          <div style={{ 
            marginBottom: 20,
            opacity: canUseCartValue ? 1 : 0.5,
            position: 'relative'
          }}>
            <label style={{ display: "flex", alignItems: "center", cursor: canUseCartValue ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                name="cartValueEnabled"
                defaultChecked={settings.cartValueEnabled}
                disabled={!canUseCartValue}
                style={{ marginRight: 12, width: 20, height: 20 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>
                  Cart Value Range
                  {!canUseCartValue && (
                    <span style={{ 
                      marginLeft: 8, 
                      padding: "2px 8px", 
                      background: "#8B5CF6", 
                      color: "white", 
                      borderRadius: 4, 
                      fontSize: 12,
                      fontWeight: 600 
                    }}>
                      PRO
                    </span>
                  )}
                </div>
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
                  disabled={!canUseCartValue}
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
                  disabled={!canUseCartValue}
                  style={{ 
                    padding: "8px 12px", 
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    width: 120
                  }}
                />
              </div>
            </div>
            
            {!canUseCartValue && (
              <div style={{ 
                marginTop: 12, 
                padding: 12, 
                background: "#fef3c7", 
                borderRadius: 6,
                fontSize: 14 
              }}>
                ⭐ <strong>Upgrade to Pro</strong> to target specific cart value ranges.{" "}
                <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                  Learn more →
                </a>
              </div>
            )}
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

{/* Modal Naming Popup */}
      {showModalNaming && actionData?.needsConfirmation && (
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
          zIndex: 2000
        }}>
          <div style={{
            background: "white",
            padding: 40,
            borderRadius: 12,
            maxWidth: 900,
            width: "90%",
            maxHeight: "90vh",
            overflow: "auto"
          }}>
            <h2 style={{ fontSize: 24, marginBottom: 16 }}>New Modal Version Detected</h2>
            
            {/* Side-by-side comparison */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
              {/* Current Modal */}
              <div>
                <h3 style={{ fontSize: 16, marginBottom: 12, color: "#6b7280" }}>
                  Current Modal {actionData.currentSettings && `(${modalLibrary?.modals?.find(m => m.active)?.modalName || "Unsaved"})`}
                </h3>
                <div style={{
                  background: "rgba(0, 0, 0, 0.05)",
                  padding: 24,
                  borderRadius: 8,
                  border: "2px solid #e5e7eb"
                }}>
                  <div style={{ background: "white", padding: 24, borderRadius: 8 }}>
                    <h4 style={{ fontSize: 18, marginBottom: 12 }}>
                      {actionData.currentSettings?.modalHeadline || "No current modal"}
                    </h4>
                    <p style={{ marginBottom: 16, color: "#666" }}>
                      {actionData.currentSettings?.modalBody || ""}
                    </p>
                    <button style={{
                      width: "100%",
                      padding: "10px",
                      background: "#8B5CF6",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 500
                    }}>
                      {actionData.currentSettings?.ctaButton || ""}
                    </button>
                    {actionData.currentSettings?.discountEnabled && (
                      <div style={{ marginTop: 12, fontSize: 14, color: "#6b7280" }}>
                        💰 Discount: {actionData.currentSettings.discountPercentage}%
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* New Modal */}
              <div>
                <h3 style={{ fontSize: 16, marginBottom: 12, color: "#10b981" }}>New Changes</h3>
                <div style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  padding: 24,
                  borderRadius: 8,
                  border: "2px solid #10b981"
                }}>
                  <div style={{ background: "white", padding: 24, borderRadius: 8 }}>
                    <h4 style={{ 
                      fontSize: 18, 
                      marginBottom: 12,
                      background: actionData.newSettings?.modalHeadline !== actionData.currentSettings?.modalHeadline ? "#fef3c7" : "transparent"
                    }}>
                      {actionData.newSettings?.modalHeadline}
                    </h4>
                    <p style={{ 
                      marginBottom: 16, 
                      color: "#666",
                      background: actionData.newSettings?.modalBody !== actionData.currentSettings?.modalBody ? "#fef3c7" : "transparent"
                    }}>
                      {actionData.newSettings?.modalBody}
                    </p>
                    <button style={{
                      width: "100%",
                      padding: "10px",
                      background: "#8B5CF6",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 500,
                      outline: actionData.newSettings?.ctaButton !== actionData.currentSettings?.ctaButton ? "3px solid #fbbf24" : "none"
                    }}>
                      {actionData.newSettings?.ctaButton}
                    </button>
                    {actionData.newSettings?.discountEnabled && (
                      <div style={{ 
                        marginTop: 12, 
                        fontSize: 14, 
                        color: "#6b7280",
                        background: actionData.newSettings?.discountPercentage !== actionData.currentSettings?.discountPercentage ? "#fef3c7" : "transparent"
                      }}>
                        💰 Discount: {actionData.newSettings.discountPercentage}%
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal naming */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                Name this modal:
              </label>
              <input
                type="text"
                value={modalName}
                onChange={(e) => setModalName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 16
                }}
              />
            </div>

            {/* Warning */}
            {actionData.existingModal ? (
              <div style={{
                padding: 16,
                background: "#fef3c7",
                borderRadius: 8,
                marginBottom: 24,
                border: "1px solid #fde68a"
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: "#92400e" }}>
                  ⚠️ Reverting to Existing Modal
                </div>
                <div style={{ fontSize: 14, color: "#92400e" }}>
                  This configuration matches "{actionData.existingModal.modalName}". 
                  Saving will reactivate that modal and continue tracking its performance.
                </div>
              </div>
            ) : (
              <div style={{
                padding: 16,
                background: "#dbeafe",
                borderRadius: 8,
                marginBottom: 24,
                border: "1px solid #93c5fd"
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: "#1e40af" }}>
                  📊 New Modal Campaign
                </div>
                <div style={{ fontSize: 14, color: "#1e40af" }}>
                  This will create a new modal and start tracking its performance separately. 
                  Your previous modal will be deactivated.
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowModalNaming(false)}
                style={{
                  padding: "10px 20px",
                  background: "#f3f4f6",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 16
                }}
              >
                Cancel
              </button>
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="modalName" value={modalName} />
                <input type="hidden" name="confirmSave" value="true" />
                <input type="hidden" name="template" value={actionData.newSettings?.template} />
                <input type="hidden" name="modalHeadline" value={actionData.newSettings?.modalHeadline} />
                <input type="hidden" name="modalBody" value={actionData.newSettings?.modalBody} />
                <input type="hidden" name="ctaButton" value={actionData.newSettings?.ctaButton} />
                <input type="hidden" name="exitIntentEnabled" value={actionData.newSettings?.exitIntentEnabled ? "on" : "off"} />
                <input type="hidden" name="timeDelayEnabled" value={actionData.newSettings?.timeDelayEnabled ? "on" : "off"} />
                <input type="hidden" name="timeDelaySeconds" value={actionData.newSettings?.timeDelaySeconds} />
                <input type="hidden" name="cartValueEnabled" value={actionData.newSettings?.cartValueEnabled ? "on" : "off"} />
                <input type="hidden" name="cartValueMin" value={actionData.newSettings?.cartValueMin} />
                <input type="hidden" name="cartValueMax" value={actionData.newSettings?.cartValueMax} />
                <input type="hidden" name="discountEnabled" value={actionData.newSettings?.discountEnabled ? "on" : "off"} />
                <input type="hidden" name="discountPercentage" value={actionData.newSettings?.discountPercentage} />
                <input type="hidden" name="redirectDestination" value={actionData.newSettings?.redirectDestination} />
                <button
                  type="submit"
                  style={{
                    padding: "10px 20px",
                    background: "#8B5CF6",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 500
                  }}
                >
                  Save as New Modal
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}

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
    </AppLayout>
  );
}