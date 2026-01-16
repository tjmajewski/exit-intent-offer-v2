import { useState, useEffect } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getAvailableTemplates, MODAL_TEMPLATES } from "../utils/templates";
import { generateModalHash, getDefaultModalLibrary, findModalByHash, getNextModalName } from "../utils/modalHash";
 import { createDiscountCode, createFixedAmountDiscountCode, createGiftCard } from "../utils/discounts";
import { getTriggerDisplay, getDiscountDisplay } from "../utils/settingsHelpers";
import AppLayout from "../components/AppLayout";
import QuickSetupTab from "../components/settings/tabs/QuickSetupTab";
import AISettingsTab from "../components/settings/tabs/AISettingsTab";
import AdvancedTab from "../components/settings/tabs/AdvancedTab";
import BrandingTab from "../components/settings/tabs/BrandingTab";
import SettingsPreview from "../components/settings/SettingsPreview";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  // Load settings AND plan from shop metafields
  try {
    // Import database client
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    
    // Load brand settings from database
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: {
        brandPrimaryColor: true,
        brandSecondaryColor: true,
        brandAccentColor: true,
        brandFont: true,
        plan: true
      }
    });
    
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
      modalBody: "Complete your purchase now and get an exclusive discount on your order!",
      ctaButton: "Complete My Order",
      exitIntentEnabled: true,
      timeDelayEnabled: false,
      timeDelaySeconds: 30,
      cartValueEnabled: false,
      cartValueMin: 0,
      cartValueMax: 1000,
      discountEnabled: false,
      offerType: "percentage", // "percentage", "fixed", or "giftcard"
      discountPercentage: 10,
      discountAmount: 10,
      discountCode: null,
      redirectDestination: "checkout"
    };

    const settings = settingsValue ? JSON.parse(settingsValue) : defaultSettings;
    
    // Use plan from database if available, fallback to metafield
    let plan = planValue ? JSON.parse(planValue) : null;
    if (shopRecord && shopRecord.plan) {
      plan = { tier: shopRecord.plan, billingCycle: "monthly" };
    }
    
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

    // Add brand settings to settings object and override plan from database
    if (shopRecord) {
      settings.brandPrimaryColor = shopRecord.brandPrimaryColor;
      settings.brandSecondaryColor = shopRecord.brandSecondaryColor;
      settings.brandAccentColor = shopRecord.brandAccentColor;
      settings.brandFont = shopRecord.brandFont;
      
      // Override plan with database value (more reliable than metafields)
      if (shopRecord.plan) {
        plan = { tier: shopRecord.plan, billingCycle: "monthly" };
      }
    }

    // Load AI variants for Enterprise users
    let variants = [];
    if (shopRecord && shopRecord.plan === 'enterprise' && settings.mode === 'ai') {
      variants = await db.variant.findMany({
        where: {
          shopId: shopRecord.id,
          status: { in: ['alive', 'champion'] }
        },
        orderBy: { profitPerImpression: 'desc' },
        take: 20
      });
    }

    return { settings, plan, availableTemplates, modalLibrary, variants };
  } catch (error) {
    console.error("Error loading settings:", error);
    return { 
      settings: {
        modalHeadline: "Wait! Don't leave yet 🎁",
        modalBody: "Complete your purchase now and get an exclusive discount on your order!",
        ctaButton: "Complete My Order",
        exitIntentEnabled: true,
        timeDelayEnabled: false,
        timeDelaySeconds: 30,
        cartValueEnabled: false,
        cartValueMin: 0,
        cartValueMax: 1000,
        discountEnabled: false,
        offerType: "percentage",
        discountPercentage: 10,
        discountAmount: 10,
        discountCode: null,
        redirectDestination: "checkout"
      },
      plan: null,
      availableTemplates: getAvailableTemplates("starter")
    };
  }
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const mode = formData.get("mode") || "manual";
  
  const settings = {
    modalHeadline: formData.get("modalHeadline"),
    modalBody: formData.get("modalBody"),
    ctaButton: formData.get("ctaButton"),
    exitIntentEnabled: mode === "ai" ? true : formData.get("exitIntentEnabled") === "on",
    timeDelayEnabled: mode === "ai" ? true : formData.get("timeDelayEnabled") === "on",
    timeDelaySeconds: parseInt(formData.get("timeDelaySeconds") || "30"),
    cartValueEnabled: formData.get("cartValueEnabled") === "on",
    cartValueMin: parseFloat(formData.get("cartValueMin") || "0"),
    cartValueMax: parseFloat(formData.get("cartValueMax") || "999999"),
    discountEnabled: formData.get("discountEnabled") === "on",
    offerType: formData.get("offerType") || "percentage",
    discountPercentage: parseInt(formData.get("discountPercentage") || "10"),
    discountAmount: parseFloat(formData.get("discountAmount") || "10"),
    discountCode: null,
    redirectDestination: formData.get("redirectDestination") || "checkout",
    template: formData.get("template") || "discount",
    mode: formData.get("mode") || "manual",
    aiGoal: formData.get("aiGoal") || "revenue",
    aggression: parseInt(formData.get("aggression") || "5"),
    budgetEnabled: formData.get("budgetEnabled") === "on",
    budgetAmount: parseFloat(formData.get("budgetAmount") || "500"),
    budgetPeriod: formData.get("budgetPeriod") || "month",
    triggers: {
      exitIntent: formData.get("exitIntentEnabled") === "on",
      timeDelay: formData.get("timeDelayEnabled") === "on",
      timeDelaySeconds: parseInt(formData.get("timeDelaySeconds") || "30"),
      cartValue: formData.get("cartValueEnabled") === "on",
      minCartValue: parseFloat(formData.get("cartValueMin") || "0"),
      maxCartValue: parseFloat(formData.get("cartValueMax") || "1000")
    },
    brandPrimaryColor: formData.get("brandPrimaryColor") || "#000000",
    brandSecondaryColor: formData.get("brandSecondaryColor") || "#ffffff",
    brandAccentColor: formData.get("brandAccentColor") || "#f59e0b",
    brandFont: formData.get("brandFont") || "system",
    customCSS: formData.get("customCSS") || ""
  };

  console.log('=== SETTINGS BEING SAVED ===');
  console.log('Mode:', settings.mode);
  console.log('AI Goal:', settings.aiGoal);
  console.log('Aggression:', settings.aggression);
  console.log('Full settings:', settings);

  try {
    // Import database client
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    
    // Get shop domain
    const shopDomain = session.shop;
    
    // Update or create shop record in database
    await db.shop.upsert({
      where: { shopifyDomain: shopDomain },
      update: {
        mode: settings.mode,
        aiGoal: settings.aiGoal,
        aggression: settings.aggression,
        budgetEnabled: settings.budgetEnabled,
        budgetAmount: settings.budgetAmount,
        budgetPeriod: settings.budgetPeriod,
        mutationRate: parseInt(formData.get("mutationRate")) || 15,
        crossoverRate: parseInt(formData.get("crossoverRate")) || 70,
        selectionPressure: parseInt(formData.get("selectionPressure")) || 5,
        populationSize: parseInt(formData.get("populationSize")) || 10,
        brandPrimaryColor: formData.get("brandPrimaryColor") || undefined,
        brandSecondaryColor: formData.get("brandSecondaryColor") || undefined,
        brandAccentColor: formData.get("brandAccentColor") || undefined,
        brandFont: formData.get("brandFont") || undefined,
        customCSS: formData.get("customCSS") || undefined,
        exitIntentEnabled: settings.exitIntentEnabled,
        timeDelayEnabled: settings.timeDelayEnabled,
        timeDelaySeconds: settings.timeDelaySeconds,
        cartValueEnabled: settings.cartValueEnabled,
        cartValueMin: settings.cartValueMin,
        cartValueMax: settings.cartValueMax,
        modalHeadline: settings.modalHeadline,
        modalBody: settings.modalBody,
        ctaButton: settings.ctaButton,
        redirectDestination: settings.redirectDestination,
         discountCode: settings.discountCode,
        discountEnabled: settings.discountEnabled,
        offerType: settings.offerType,
        updatedAt: new Date()
      },
      create: {
        shopifyDomain: shopDomain,
        mode: settings.mode,
        aiGoal: settings.aiGoal,
        aggression: settings.aggression,
        budgetEnabled: settings.budgetEnabled,
        budgetAmount: settings.budgetAmount,
        budgetPeriod: settings.budgetPeriod,
        mutationRate: parseInt(formData.get("mutationRate")) || 15,
        crossoverRate: parseInt(formData.get("crossoverRate")) || 70,
        selectionPressure: parseInt(formData.get("selectionPressure")) || 5,
        populationSize: parseInt(formData.get("populationSize")) || 10,
        brandPrimaryColor: formData.get("brandPrimaryColor") || "#000000",
        brandSecondaryColor: formData.get("brandSecondaryColor") || "#ffffff",
        brandAccentColor: formData.get("brandAccentColor") || "#f59e0b",
        brandFont: formData.get("brandFont") || "system",
        customCSS: formData.get("customCSS") || "",
        exitIntentEnabled: settings.exitIntentEnabled,
        timeDelayEnabled: settings.timeDelayEnabled,
        timeDelaySeconds: settings.timeDelaySeconds,
        cartValueEnabled: settings.cartValueEnabled,
        cartValueMin: settings.cartValueMin,
        cartValueMax: settings.cartValueMax,
        modalHeadline: settings.modalHeadline,
        modalBody: settings.modalBody,
        ctaButton: settings.ctaButton,
        redirectDestination: settings.redirectDestination
      }
    });
    
    console.log(`✓ Shop settings saved to database for ${shopDomain}`);
    
    // Debug logging
    console.log('=== DISCOUNT DEBUG ===');
    console.log('Discount enabled:', settings.discountEnabled);
    console.log('Offer type:', settings.offerType);
    console.log('Discount percentage:', settings.discountPercentage);
    console.log('Discount amount:', settings.discountAmount);
    
    // Create discount code based on offer type
    if (settings.discountEnabled) {
      console.log('Creating discount code...');
      
      if (settings.offerType === "percentage" && settings.discountPercentage > 0) {
        console.log('Creating percentage discount:', settings.discountPercentage);
        settings.discountCode = await createDiscountCode(admin, settings.discountPercentage);
        console.log('Created code:', settings.discountCode);
      } else if (settings.offerType === "fixed" && settings.discountAmount > 0) {
        console.log('Creating fixed amount discount:', settings.discountAmount);
        settings.discountCode = await createFixedAmountDiscountCode(admin, settings.discountAmount);
        console.log('Created code:', settings.discountCode);
 } else if (settings.offerType === "giftcard" && settings.discountAmount > 0) {
        console.log('Creating gift card:', settings.discountAmount);
        settings.discountCode = await createGiftCard(admin, settings.discountAmount);
        console.log('Created gift card code:', settings.discountCode);
      } else {
        console.log('No discount code created - conditions not met');
      }
    } else {
      console.log('Discount not enabled');
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

    // Load brand colors from database and add to currentSettings
    const shopRecord = await db.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: {
        brandPrimaryColor: true,
        brandSecondaryColor: true,
        brandAccentColor: true,
        brandFont: true
      }
    });

    // Add brand colors from database to currentSettings
    if (currentSettings && shopRecord) {
      currentSettings.brandPrimaryColor = shopRecord.brandPrimaryColor;
      currentSettings.brandSecondaryColor = shopRecord.brandSecondaryColor;
      currentSettings.brandAccentColor = shopRecord.brandAccentColor;
      currentSettings.brandFont = shopRecord.brandFont;
    }

    // Generate hash for new settings
    const newHash = generateModalHash(settings);
    const currentHash = currentSettings ? generateModalHash(currentSettings) : null;

    // Auto-generate modal name based on whether this is a new config or existing one
    let modalName;
    let isNewModal = false;
    
    if (newHash !== currentHash) {
      const existingModal = findModalByHash(modalLibrary, newHash);
      if (existingModal) {
        // Reactivating an existing modal configuration
        modalName = existingModal.modalName;
      } else {
        // Creating a new modal configuration
        modalName = getNextModalName(modalLibrary);
        isNewModal = true;
      }
    } else {
      // Hash is the same, but user still clicked save (maybe tweaked brand colors slightly)
      // Create a new modal version anyway
      modalName = getNextModalName(modalLibrary);
      isNewModal = true;
    }

    // Save settings and plan
    await admin.graphql(
      `mutation SetSettings($ownerId: ID!, $settingsValue: String!, $planValue: String!) {
        metafieldsSet(metafields: [
          {
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "settings"
            value: $settingsValue
            type: "json"
          },
          {
            ownerId: $ownerId
            namespace: "exit_intent"
            key: "plan"
            value: $planValue
            type: "json"
          }
        ]) {
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
          settingsValue: JSON.stringify(settings),
          planValue: JSON.stringify({
            tier: formData.get("tier") || "pro",
            billingCycle: formData.get("billingCycle") || "monthly"
          })
        }
      }
    );

    // Always create new modal entry for performance tracking
    if (modalName) {
      const newModalId = `modal_${Date.now()}`;
      const newHash = generateModalHash(settings);
      
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

    // Save to database for API access
    await db.shop.upsert({
      where: { shopifyDomain: shopDomain },
      update: {
        mode: settings.mode,
        exitIntentEnabled: settings.exitIntentEnabled,
        timeDelayEnabled: settings.timeDelayEnabled,
        timeDelaySeconds: settings.timeDelaySeconds,
        cartValueEnabled: settings.cartValueEnabled,
        cartValueMin: settings.cartValueMin,
        cartValueMax: settings.cartValueMax,
        modalHeadline: settings.modalHeadline,
        modalBody: settings.modalBody,
        ctaButton: settings.ctaButton,
        redirectDestination: settings.redirectDestination,
        discountCode: settings.discountCode,
        discountEnabled: settings.discountEnabled,
        offerType: settings.offerType,
        updatedAt: new Date()
      },
      create: {
        shopifyDomain: shopDomain,
        mode: settings.mode,
        exitIntentEnabled: settings.exitIntentEnabled,
        timeDelayEnabled: settings.timeDelayEnabled,
        timeDelaySeconds: settings.timeDelaySeconds,
        cartValueEnabled: settings.cartValueEnabled,
        cartValueMin: settings.cartValueMin,
        cartValueMax: settings.cartValueMax,
        modalHeadline: settings.modalHeadline,
        modalBody: settings.modalBody,
        ctaButton: settings.ctaButton,
        redirectDestination: settings.redirectDestination,
        discountCode: settings.discountCode,
        discountEnabled: settings.discountEnabled,
        offerType: settings.offerType
      }
    });

    console.log(`✓ Settings saved to database including discount code: ${settings.discountCode}`);

    return { 
      success: true, 
      message: isNewModal 
        ? `Settings saved as ${modalName}${settings.discountCode ? `. Discount code ${settings.discountCode} created` : ''}`
        : `Settings updated successfully${settings.discountCode ? `. Discount code ${settings.discountCode} created` : ''}` 
    };
  } catch (error) {
    console.error("Error saving settings:", error);
    return { success: false, message: "Failed to save settings: " + error.message };
  }
}

export default function Settings() {
  const { settings, status, plan, modalLibrary, hasPromo, availableTemplates } = useLoaderData();
  const [activeTab, setActiveTab] = useState('quick');
  const actionData = useActionData();
  const navigation = useNavigation();
  const [showPreview, setShowPreview] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [formChanged, setFormChanged] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(settings.template || "discount");
  const [showModalNaming, setShowModalNaming] = useState(false);
  const [modalName, setModalName] = useState("");
  const [optimizationMode, setOptimizationMode] = useState(settings.mode || "manual");
  const [aggressionLevel, setAggressionLevel] = useState(settings.aggression || 5);
  const [mutationRate, setMutationRate] = useState(settings.mutationRate || 15);
  const [crossoverRate, setCrossoverRate] = useState(settings.crossoverRate || 70);
  const [selectionPressure, setSelectionPressure] = useState(settings.selectionPressure || 5);
  const [brandPrimaryColor, setBrandPrimaryColor] = useState(settings.brandPrimaryColor || "#000000");
  const [brandSecondaryColor, setBrandSecondaryColor] = useState(settings.brandSecondaryColor || "#ffffff");
  const [brandAccentColor, setBrandAccentColor] = useState(settings.brandAccentColor || "#f59e0b");
  const [brandFont, setBrandFont] = useState(settings.brandFont || "system");
  const [customCSS, setCustomCSS] = useState(settings.customCSS || "");
  const [modalHeadline, setModalHeadline] = useState(settings.modalHeadline || "Wait! Don't leave yet 🎁");
  const [modalBody, setModalBody] = useState(settings.modalBody || "Complete your purchase now and get an exclusive discount on your order!");
  const [ctaButton, setCtaButton] = useState(settings.ctaButton || "Complete My Order");
     


   



  const isSubmitting = navigation.state === "submitting";

   

  // Feature gates
  const canUseAllTriggers = plan ? hasFeature(plan, 'allTriggers') : false;
  const canUseCartValue = plan ? hasFeature(plan, 'cartValueTargeting') : false;
  const canChooseRedirect = plan ? hasFeature(plan, 'redirectChoice') : false;
  const canUseMultipleTemplates = plan ? hasFeature(plan, 'multipleTemplates') : false;
  const canUseAIMode = plan && (plan.tier === "pro" || plan.tier === "enterprise");

  // Apply template to form
  const applyTemplate = (templateId) => {
    const template = MODAL_TEMPLATES[templateId];
    if (!template) return;

    setSelectedTemplate(templateId);
    setModalHeadline(template.headline);
    setModalBody(template.body);
    setCtaButton(template.ctaButton);
    setFormChanged(true);
  };

  // Auto-select first template on mount if no template is selected
  useEffect(() => {
    if (!settings.template || !selectedTemplate) {
      const firstTemplate = Object.keys(MODAL_TEMPLATES)[0];
      applyTemplate(firstTemplate);
    }
  }, []);

  // Keep success message visible
  const handleFormChange = () => {
    // Message will stay visible now
  };

  const showSuccessMessage = actionData?.success && !isSubmitting;
  const showErrorMessage = actionData?.success === false && !isSubmitting;
  
  // Reset formChanged after successful save
  useEffect(() => {
    if (actionData?.success) {
      setFormChanged(false);
    }
  }, [actionData]);

  // Helper function to detect what changed
  

     
  
  return (
    <AppLayout plan={plan}>
      <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>Settings</h1>
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
      <p style={{ color: "#666", marginBottom: 24 }}>
        Configure your modal, triggers, and optimization
      </p>

      {/* Tab Navigation */}
      <div style={{ 
        borderBottom: "2px solid #e5e7eb", 
        marginBottom: 32,
        display: "flex",
        gap: 0
      }}>
        <button
          onClick={() => setActiveTab('quick')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'quick' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'quick' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'quick' ? 600 : 400,
            fontSize: 16,
            cursor: "pointer",
            marginBottom: -2
          }}
        >
          Quick Setup
        </button>
        
        <button
          onClick={() => setActiveTab('ai')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'ai' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'ai' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'ai' ? 600 : 400,
            fontSize: 16,
            cursor: "pointer",
            marginBottom: -2,
            display: "flex",
            alignItems: "center",
            gap: 8
          }}
        >
          AI Settings
          {plan && plan.tier === 'starter' && (
            <span style={{
              padding: "2px 6px",
              background: "#8B5CF6",
              color: "white",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600
            }}>
              PRO
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('advanced')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'advanced' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'advanced' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'advanced' ? 600 : 400,
            fontSize: 16,
            cursor: "pointer",
            marginBottom: -2
          }}
        >
          Advanced
          {plan && plan.tier === 'starter' && (
            <span style={{
              padding: "2px 6px",
              background: "#8B5CF6",
              color: "white",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              marginLeft: 8
            }}>
              PRO
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('branding')}
          style={{
            padding: "12px 24px",
            background: "transparent",
            border: "none",
            borderBottom: activeTab === 'branding' ? "3px solid #8B5CF6" : "3px solid transparent",
            color: activeTab === 'branding' ? "#8B5CF6" : "#6b7280",
            fontWeight: activeTab === 'branding' ? 600 : 400,
            fontSize: 16,
            cursor: "pointer",
            marginBottom: -2,
            display: "flex",
            alignItems: "center",
            gap: 8
          }}
        >
          Branding
          {plan && plan.tier !== 'enterprise' && (
            <span style={{
              padding: "2px 6px",
              background: "#fbbf24",
              color: "#78350f",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600
            }}>
              ENTERPRISE
            </span>
          )}
        </button>
      </div>

      <Form method="post">

        {/* Quick Setup Tab */}
      {activeTab === 'quick' && (
        <QuickSetupTab
          settings={settings}
          plan={plan}
          availableTemplates={availableTemplates}
          canUseAIMode={canUseAIMode}
          optimizationMode={optimizationMode}
          setOptimizationMode={setOptimizationMode}
          selectedTemplate={selectedTemplate}
          setSelectedTemplate={setSelectedTemplate}
          applyTemplate={applyTemplate}
          modalHeadline={modalHeadline}
          setModalHeadline={setModalHeadline}
          modalBody={modalBody}
          setModalBody={setModalBody}
          ctaButton={ctaButton}
          setCtaButton={setCtaButton}
          setFormChanged={setFormChanged}
          showPreview={showPreview}
          setShowPreview={setShowPreview}
          setActiveTab={setActiveTab}
          canUseAllTriggers={canUseAllTriggers}
          canUseCartValue={canUseCartValue}
        />
      )}

{/* AI Settings Tab */}
      {activeTab === 'ai' && (
        <AISettingsTab
          canUseAIMode={canUseAIMode}
          optimizationMode={optimizationMode}
          settings={settings}
          aggressionLevel={aggressionLevel}
          setAggressionLevel={setAggressionLevel}
          setFormChanged={setFormChanged}
          plan={plan}
          mutationRate={mutationRate}
          setMutationRate={setMutationRate}
          crossoverRate={crossoverRate}
          setCrossoverRate={setCrossoverRate}
          selectionPressure={selectionPressure}
          setSelectionPressure={setSelectionPressure}
        />
      )}

     {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <AdvancedTab
          plan={plan}
          optimizationMode={optimizationMode}
          canChooseRedirect={canChooseRedirect}
          settings={settings}
          canUseCartValue={canUseCartValue}
        />
      )}

     {/* Branding Tab */}
      {activeTab === 'branding' && (
        <BrandingTab
          plan={plan}
          settings={settings}
          brandPrimaryColor={brandPrimaryColor}
          setBrandPrimaryColor={setBrandPrimaryColor}
          brandSecondaryColor={brandSecondaryColor}
          setBrandSecondaryColor={setBrandSecondaryColor}
          brandAccentColor={brandAccentColor}
          setBrandAccentColor={setBrandAccentColor}
          brandFont={brandFont}
          setBrandFont={setBrandFont}
          customCSS={customCSS}
          setCustomCSS={setCustomCSS}
          setFormChanged={setFormChanged}
        />
      )}

      {/* Save Button - Appears on all tabs */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setShowPreviewModal(true)}
            disabled={!formChanged}
            style={{
              padding: "16px 32px",
              background: formChanged ? "white" : "#f3f4f6",
              color: formChanged ? "#8B5CF6" : "#9ca3af",
              border: formChanged ? "2px solid #8B5CF6" : "2px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 17,
              fontWeight: 600,
              cursor: formChanged ? "pointer" : "not-allowed",
              flex: 1,
              transition: "all 0.2s"
            }}
          >
            Preview Modal
          </button>
          
          <button
            type="submit"
            disabled={!formChanged || isSubmitting}
            style={{ 
              padding: "16px 32px", 
              background: (formChanged && !isSubmitting) ? "#8B5CF6" : "#9ca3af", 
              color: "white", 
              border: "none",
              borderRadius: 8,
              cursor: (formChanged && !isSubmitting) ? "pointer" : "not-allowed",
              fontSize: 17,
              fontWeight: 600,
              flex: 1,
              transition: "all 0.2s"
            }}
          >
            {isSubmitting ? "Saving..." : "Save Settings"}
          </button>
        </div>

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

      {/* Settings Preview Modal */}
      <SettingsPreview
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        optimizationMode={optimizationMode}
        modalHeadline={modalHeadline}
        modalBody={modalBody}
        ctaButton={ctaButton}
        discountEnabled={settings.discountEnabled}
        offerType={settings.offerType}
        discountPercentage={settings.discountPercentage || 10}
        discountAmount={settings.discountAmount || 10}
        exitIntentEnabled={settings.exitIntentEnabled || settings.triggers?.exitIntent}
        timeDelayEnabled={settings.timeDelayEnabled || settings.triggers?.timeDelay}
        timeDelaySeconds={settings.timeDelaySeconds || settings.triggers?.timeDelaySeconds || 30}
        cartValueEnabled={settings.cartValueEnabled || settings.triggers?.cartValue}
        cartValueMin={settings.cartValueMin || settings.triggers?.minCartValue}
        cartValueMax={settings.cartValueMax || settings.triggers?.maxCartValue}
        brandPrimaryColor={brandPrimaryColor}
        brandSecondaryColor={brandSecondaryColor}
        brandAccentColor={brandAccentColor}
        brandFont={brandFont}
        customCSS={customCSS}
      />

      {/* Old Preview Modal */}
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
              type="button"
              onClick={() => setShowPreview(false)}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                background: "#f3f4f6",
                border: "none",
                fontSize: 28,
                cursor: "pointer",
                color: "#666",
                lineHeight: 1,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                borderRadius: 6,
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => e.target.style.background = "#e5e7eb"}
              onMouseLeave={(e) => e.target.style.background = "#f3f4f6"}
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