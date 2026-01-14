import { useState, useEffect } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { hasFeature } from "../utils/featureGates";
import { getAvailableTemplates, MODAL_TEMPLATES } from "../utils/templates";
import { generateModalHash, getDefaultModalLibrary, findModalByHash, getNextModalName } from "../utils/modalHash";
import AppLayout from "../components/AppLayout";

function getTriggerDisplay(settings) {
  const triggers = settings?.triggers || {};
  const activeTriggers = [];
  
  if (triggers.exitIntent) {
    activeTriggers.push("Exit Intent");
  }
  
  if (triggers.timeDelay && triggers.timeDelaySeconds) {
    activeTriggers.push(`Timer (${triggers.timeDelaySeconds}s after add-to-cart)`);
  }
  
  if (triggers.cartValue) {
    const conditions = [];
    if (triggers.minCartValue) conditions.push(`min $${triggers.minCartValue}`);
    if (triggers.maxCartValue) conditions.push(`max $${triggers.maxCartValue}`);
    activeTriggers.push(`Cart Value (${conditions.join(', ')})`);
  }
  
  return activeTriggers.length > 0 ? activeTriggers.join(" + ") : "None";
}

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

async function createFixedAmountDiscountCode(admin, discountAmount, currencyCode = 'USD') {
  const discountCode = `${discountAmount}DOLLARSOFF`;
  
  console.log(`Creating fixed amount discount code: ${discountCode}`);
  
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
  
  console.log('=== CHECK QUERY RESULT ===');
  console.log('Query result:', JSON.stringify(checkResult, null, 2));
  console.log('Nodes found:', checkResult.data?.codeDiscountNodes?.nodes?.length || 0);
  
  // Check if the SPECIFIC code exists in the results
  const codeExists = checkResult.data.codeDiscountNodes.nodes.some(node => 
    node.codeDiscount?.codes?.nodes?.some(c => c.code === discountCode)
  );
  
  if (codeExists) {
    console.log(`✓ Using existing discount code: ${discountCode}`);
    return discountCode;
  }
  
  // Create new fixed amount discount code
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
      title: `$${discountAmount} Off - Exit Intent Offer`,
      code: discountCode,
      startsAt: new Date().toISOString(),
      customerSelection: {
        all: true
      },
      customerGets: {
        value: {
          discountAmount: {
            amount: discountAmount.toString(),
            appliesOnEachItem: false
          }
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
    throw new Error("Failed to create discount code: " + JSON.stringify(result.data.discountCodeBasicCreate.userErrors));
  }
  
  const code = result.data.discountCodeBasicCreate.codeDiscountNode
    .codeDiscount.codes.nodes[0].code;
  
  console.log(`✓ Created new fixed amount discount code: ${code}`);
  return code;
}
async function createGiftCard(admin, giftCardAmount) {
  const giftCardValue = parseFloat(giftCardAmount);
  
  console.log(`Creating $${giftCardValue} gift card`);
  
  const mutation = `
    mutation giftCardCreate($input: GiftCardCreateInput!) {
      giftCardCreate(input: $input) {
        giftCard {
          id
          initialValue {
            amount
          }
          maskedCode
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      initialValue: giftCardValue,
      note: "Exit Intent Offer"
    }
  };

  const response = await admin.graphql(mutation, { variables });
  const result = await response.json();
  
  if (result.data.giftCardCreate.userErrors.length > 0) {
    console.error("Error creating gift card:", result.data.giftCardCreate.userErrors);
    throw new Error("Failed to create gift card: " + JSON.stringify(result.data.giftCardCreate.userErrors));
  }
  
  const giftCardCode = result.data.giftCardCreate.giftCard.id;
  console.log(`✓ Created gift card: ${giftCardCode}`);
  
  return giftCardCode;
}

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
    cartValueMax: parseFloat(formData.get("cartValueMax") || "1000"),
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
        customCSS: formData.get("customCSS") || ""
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
  const [customCSS, setCustomCSS] = useState(settings?.customCSS || '');
  const [autoDetecting, setAutoDetecting] = useState(false);
     


  // Helper function to display discount text
  const getDiscountDisplay = (settings) => {
    if (!settings?.discountEnabled) return null;
    
    const offerType = settings.offerType || "percentage";
    
    if (offerType === "percentage") {
      return `${settings.discountPercentage}%`;
    } else if (offerType === "fixed") {
      return `$${settings.discountAmount}`;
    } else if (offerType === "giftcard") {
      return `$${settings.discountAmount} gift card`;
    }
    
    return `${settings.discountPercentage}%`;
  };



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

    // Update form fields
    document.querySelector('input[name="modalHeadline"]').value = template.headline;
    document.querySelector('textarea[name="modalBody"]').value = template.body;
    document.querySelector('input[name="ctaButton"]').value = template.ctaButton;
  };

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
        <>
        {/* Optimization Mode Selector */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>How do you want to manage your offers?</h2>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
            Choose between full manual control or AI-powered optimization
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Manual Mode */}
            <label style={{ 
              display: "flex", 
              flexDirection: "column",
              cursor: "pointer",
              padding: 20,
              border: optimizationMode === "manual" ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
              borderRadius: 8,
              background: optimizationMode === "manual" ? "#f5f3ff" : "white"
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <input
                  type="radio"
                  name="mode"
                  value="manual"
                  checked={optimizationMode === "manual"}
                  onChange={(e) => setOptimizationMode(e.target.value)}
                  style={{ marginRight: 12 }}
                />
                <div style={{ fontWeight: 600, fontSize: 16 }}>Manual Mode</div>
              </div>
              <div style={{ fontSize: 14, color: "#666", marginLeft: 28 }}>
                Full control over templates, copy, and triggers. Perfect for testing specific offers.
              </div>
            </label>

            {/* AI Mode */}
            <label style={{ 
              display: "flex", 
              flexDirection: "column",
              cursor: canUseAIMode ? "pointer" : "not-allowed",
              padding: 20,
              border: optimizationMode === "ai" ? "2px solid #8B5CF6" : "1px solid #e5e7eb",
              borderRadius: 8,
              background: optimizationMode === "ai" ? "#f5f3ff" : "white",
              opacity: canUseAIMode ? 1 : 0.6
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <input
                  type="radio"
                  name="mode"
                  value="ai"
                  checked={optimizationMode === "ai"}
                  onChange={(e) => setOptimizationMode(e.target.value)}
                  disabled={!canUseAIMode}
                  style={{ marginRight: 12 }}
                />
                <div style={{ fontWeight: 600, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  AI Mode
                  {!canUseAIMode && (
                    <span style={{ 
                      padding: "2px 8px", 
                      background: "#8B5CF6", 
                      color: "white", 
                      borderRadius: 4, 
                      fontSize: 11,
                      fontWeight: 600 
                    }}>
                      PRO
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 14, color: "#666", marginLeft: 28 }}>
                AI automatically tests and optimizes to maximize results. Configure in AI Settings tab.
              </div>
            </label>
          </div>

          {!canUseAIMode && (
            <div style={{ 
              marginTop: 16, 
              padding: 12, 
              background: "#fef3c7", 
              borderRadius: 6,
              fontSize: 14,
              textAlign: "center"
            }}>
               <strong>Upgrade to Pro</strong> to unlock AI Mode with automatic optimization.{" "}
              <a href="/app/upgrade" style={{ color: "#8B5CF6", textDecoration: "underline" }}>
                Learn more →
              </a>
            </div>
          )}
        </div>

        {/* Template Selector */}
       {/* AI Mode Active - Guide to AI Settings */}
        {optimizationMode === "ai" && (
          <div style={{ 
            background: "#f5f3ff", 
            padding: 24, 
            borderRadius: 8, 
            border: "2px solid #8B5CF6",
            marginBottom: 24
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ fontSize: 40 }}></div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 18, marginBottom: 8, color: "#8B5CF6", fontWeight: 600 }}>
                  AI Mode Enabled
                </h3>
                <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
                  The AI will automatically test and optimize your offers. Configure AI settings like optimization goal, discount aggression, and budget cap in the <strong>AI Settings</strong> tab.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('ai')}
                  style={{
                    padding: "10px 20px",
                    background: "#8B5CF6",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Go to AI Settings →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Mode - Show All Settings */}
        {optimizationMode === "manual" && (
          <>
            {/* Template Selector */}
        <div style={{ 
          background: "white", 
          padding: 24, 
          borderRadius: 8, 
          border: "1px solid #e5e7eb",
          marginBottom: 24 
        }}>
          <h2 style={{ fontSize: 20, marginBottom: 8, opacity: optimizationMode === "ai" ? 0.5 : 1 }}>
            Choose a Template
          </h2>
          <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
            {optimizationMode === "ai" 
              ? "   AI will automatically choose and test the best templates" 
              : "Start with a pre-made template and customize it to match your brand"}
          </p>

          <div style={{ opacity: optimizationMode === "ai" ? 0.5 : 1, pointerEvents: optimizationMode === "ai" ? "none" : "auto" }}>
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
            </div>
          </div>

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
          <h2 style={{ fontSize: 20, marginBottom: 8, opacity: optimizationMode === "ai" ? 0.5 : 1 }}>
            Modal Content
          </h2>
          
          {optimizationMode === "ai" && (
            <div style={{ 
              marginBottom: 16, 
              padding: 12, 
              background: "#e0f2fe", 
              borderRadius: 6,
              fontSize: 14,
              color: "#075985"
            }}>
              ℹ️ AI Mode is controlling modal content. Copy will be automatically optimized based on performance.
            </div>
          )}

          <div style={{ opacity: optimizationMode === "ai" ? 0.5 : 1, pointerEvents: optimizationMode === "ai" ? "none" : "auto" }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                Headline <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="text"
                name="modalHeadline"
                defaultValue={settings.modalHeadline}
                disabled={optimizationMode === "ai"}
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
                disabled={optimizationMode === "ai"}
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
                disabled={optimizationMode === "ai"}
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
              disabled={optimizationMode === "ai"}
              style={{ 
                padding: "10px 20px", 
                background: "#f3f4f6", 
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: optimizationMode === "ai" ? "not-allowed" : "pointer",
                fontSize: 16
              }}
            >
              {showPreview ? "Hide Preview" : "Show Preview"}
            </button>
          </div>
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
                <div style={{ fontWeight: 500 }}>Enable Discount Offer</div>
                <div style={{ fontSize: 14, color: "#666" }}>
                  Automatically apply discount when customer clicks the CTA
                </div>
              </div>
            </label>
          </div>

          <div style={{ marginLeft: 32, marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 12, fontWeight: 500 }}>
              Offer Type
            </label>
            
            {/* Percentage Discount */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="offerType"
                  value="percentage"
                  defaultChecked={settings.offerType === "percentage" || !settings.offerType}
                  style={{ marginRight: 12, marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>Percentage Off</div>
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                    e.g., "10OFF" for 10% discount
                  </div>
                  <input
                    type="number"
                    name="discountPercentage"
                    defaultValue={settings.discountPercentage || 10}
                    min="1"
                    max="100"
                    style={{ 
                      padding: "8px 12px", 
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      width: 100,
                      fontSize: 16
                    }}
                  />
                  <span style={{ marginLeft: 8, color: "#666" }}>%</span>
                </div>
              </label>
            </div>

            {/* Fixed Dollar Amount */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="offerType"
                  value="fixed"
                  defaultChecked={settings.offerType === "fixed"}
                  style={{ marginRight: 12, marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>Dollar Amount Off</div>
                  <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
                    e.g., "10DOLLARSOFF" for $10 discount
                  </div>
                  <span style={{ marginRight: 8, color: "#666" }}>$</span>
                  <input
                    type="number"
                    name="discountAmount"
                    defaultValue={settings.discountAmount || 10}
                    min="1"
                    step="1"
                    style={{ 
                      padding: "8px 12px", 
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      width: 100,
                      fontSize: 16
                    }}
                  />
                </div>
              </label>
            </div>
            
            {settings.discountCode && (
              <div style={{ 
                marginTop: 16, 
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

        </>
        )}
      </>
      )}

      {/* AI Settings Tab */}
      {activeTab === 'ai' && (
        <>
        {!canUseAIMode ? (
          <div style={{
            background: 'white',
            padding: 48,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              background: '#f3f4f6',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 16,
              color: '#6b7280'
            }}>
              PRO
            </div>
            <h2 style={{ fontSize: 24, marginBottom: 12 }}>AI-Powered Optimization</h2>
            <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
              Let AI automatically test headlines, body copy, and CTAs to find what converts best. 
              Available on Pro and Enterprise plans.
            </p>
            <button
              type="button"
              onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
              style={{
                padding: '12px 24px',
                background: '#8B5CF6',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Upgrade to Pro
            </button>
          </div>
        ) : (
          <>
          {optimizationMode === "manual" ? (
            <div style={{
              background: 'white',
              padding: 48,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
              <h2 style={{ fontSize: 24, marginBottom: 12 }}>Manual Mode Active</h2>
              <p style={{ color: '#6b7280', marginBottom: 24 }}>
                You're currently in Manual Mode. Switch to AI Mode in the Quick Setup tab to access AI optimization settings.
              </p>
            </div>
          ) : (
            <div style={{ 
              background: "white", 
              padding: 24, 
              borderRadius: 8, 
              border: "1px solid #e5e7eb",
              marginBottom: 24 
            }}>
              <h2 style={{ fontSize: 20, marginBottom: 8 }}>AI Optimization Settings</h2>
              <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
                Configure how the AI optimizes your exit intent offers
              </p>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 16 }}>
                  Optimization Goal
                </label>
                <p style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
                  What should the AI optimize for?
                </p>
                <select
                  name="aiGoal"
                  defaultValue={settings.aiGoal || "revenue"}
                  onChange={(e) => setFormChanged(true)}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 16
                  }}
                >
                  <option value="revenue">Maximize Revenue (recommended)</option>
                  <option value="conversions">Maximize Conversions</option>
                </select>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 16 }}>
                  Discount Aggression: {aggressionLevel}
                </label>
                <p style={{ fontSize: 14, color: "#666", marginBottom: 12 }}>
                  How aggressive should discounts be?
                </p>
                <input
                  type="range"
                  name="aggression"
                  min="0"
                  max="10"
                  value={aggressionLevel}
                  onChange={(e) => { setAggressionLevel(parseInt(e.target.value)); setFormChanged(true); }}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#666", marginTop: 8 }}>
                  <span>Conservative (0)</span>
                  <span>Moderate (5)</span>
                  <span>Aggressive (10)</span>
                </div>
                {aggressionLevel === 0 && (
                  <div style={{ 
                    marginTop: 12, 
                    padding: 12, 
                    background: "#eff6ff", 
                    borderRadius: 6,
                    fontSize: 14,
                    color: "#1e40af"
                  }}>
                    💡 At level 0, modals will show without discount offers - great for announcements or cart reminders
                  </div>
                )}
              </div>

              {/* Budget Controls */}
              <div style={{ 
                padding: 20, 
                background: "#f9fafb", 
                borderRadius: 8,
                marginBottom: 24
              }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    name="budgetEnabled"
                    defaultChecked={settings.budgetEnabled}
                    onChange={(e) => setFormChanged(true)}
                    style={{ marginRight: 12, width: 20, height: 20, cursor: "pointer" }}
                  />
                  <label style={{ fontWeight: 500, fontSize: 16, cursor: "pointer" }}>
                    Enable Discount Budget Cap
                  </label>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                      Maximum Discount Budget
                    </label>
                    <input
                      type="number"
                      name="budgetAmount"
                      defaultValue={settings.budgetAmount || 500}
                      onChange={(e) => setFormChanged(true)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        fontSize: 16
                      }}
                    />
                  </div>
                  
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                      Time Period
                    </label>
                    <select
                      name="budgetPeriod"
                      defaultValue={settings.budgetPeriod || "month"}
                      onChange={(e) => setFormChanged(true)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        fontSize: 16
                      }}
                    >
                      <option value="week">Per Week</option>
                      <option value="month">Per Month</option>
                    </select>
                  </div>
                </div>

                <div style={{ 
                  marginTop: 12, 
                  padding: 12, 
                  background: "#eff6ff", 
                  borderRadius: 6,
                  fontSize: 13,
                  color: "#1e40af"
                }}>
                  💡 <strong>Example:</strong> $500/month means AI will stop offering discounts once $500 in total discounts have been given out this month. Resets at the start of each period.
                </div>
              </div>
            </div>
          )}

          {/* Control System (Pro: Locked, Enterprise: Unlocked) */}
          {(plan?.tier === 'pro' || plan?.tier === 'enterprise') && optimizationMode === 'ai' && (
            <div style={{ 
              background: "white", 
              padding: 24, 
              borderRadius: 8, 
              border: "1px solid #e5e7eb",
              marginTop: 24,
              position: 'relative',
              opacity: plan?.tier === 'enterprise' ? 1 : 0.6
            }}>
              {/* Overlay for Pro users */}
              {plan?.tier === 'pro' && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(255, 255, 255, 0.9)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 10,
                  cursor: 'not-allowed'
                }}>
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{
                      display: 'inline-block',
                      padding: '6px 16px',
                      background: '#8B5CF6',
                      color: 'white',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 16
                    }}>
                      ENTERPRISE FEATURE
                    </div>
                    <h3 style={{ fontSize: 20, marginBottom: 8, color: '#1f2937' }}>
                      Fine-Tune Your AI
                    </h3>
                    <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, maxWidth: 400 }}>
                      Get granular control over how your AI learns and evolves. Adjust innovation speed, learning strategy, quality standards, and test group size.
                    </p>
                    <button
                      type="button"
                      onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
                      style={{
                        padding: '12px 24px',
                        background: '#8B5CF6',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 16,
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      Upgrade to Enterprise
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 20, marginBottom: 4 }}>Control System</h2>
                  <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
                    Fine-tune how the AI learns and evolves
                  </p>
                </div>
                <span style={{ 
                  padding: "4px 12px", 
                  background: "#8B5CF6", 
                  color: "white", 
                  borderRadius: 4, 
                  fontSize: 12,
                  fontWeight: 600 
                }}>
                  ENTERPRISE
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {/* Innovation Speed */}
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                    Innovation Speed: {mutationRate}%
                  </label>
                  <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                    How quickly to try new ideas
                  </p>
                  <input
                    type="range"
                    name="mutationRate"
                    min="0"
                    max="100"
                    value={mutationRate}
                    onChange={(e) => { setMutationRate(parseInt(e.target.value)); setFormChanged(true); }}
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    <span>Slow & Steady</span>
                    <span>Fast & Bold</span>
                  </div>
                </div>

                {/* Learning Strategy */}
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                    Learning Strategy: {crossoverRate}%
                  </label>
                  <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                    Combine winners vs. start fresh with new modals
                  </p>
                  <input
                    type="range"
                    name="crossoverRate"
                    min="0"
                    max="100"
                    value={crossoverRate}
                    onChange={(e) => { setCrossoverRate(parseInt(e.target.value)); setFormChanged(true); }}
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    <span>Start Fresh</span>
                    <span>Combine Winners</span>
                  </div>
                </div>

                {/* Quality Standards */}
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                    Quality Standards: {selectionPressure}/10
                  </label>
                  <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                    Keep underperformers longer vs. cut quickly
                  </p>
                  <input
                    type="range"
                    name="selectionPressure"
                    min="1"
                    max="10"
                    value={selectionPressure}
                    onChange={(e) => { setSelectionPressure(parseInt(e.target.value)); setFormChanged(true); }}
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                    <span>Patient</span>
                    <span>Ruthless</span>
                  </div>
                </div>

                {/* Test Group Size */}
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                    Test Group Size
                  </label>
                  <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                    Test more options (slower) vs. fewer (faster)
                  </p>
                  <select
                    name="populationSize"
                    defaultValue={settings.populationSize || 10}
                    onChange={(e) => setFormChanged(true)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  >
                    <option value="5">5 variants (faster learning)</option>
                    <option value="10">10 variants (balanced)</option>
                    <option value="15">15 variants (more exploration)</option>
                    <option value="20">20 variants (maximum diversity)</option>
                  </select>
                </div>
              </div>

              <div style={{ 
                marginTop: 20, 
                padding: 12, 
                background: "#eff6ff", 
                borderRadius: 6,
                fontSize: 13,
                color: "#1e40af"
              }}>
                💡 <strong>Tip:</strong> Default settings work well for most stores. Higher innovation speed and lower quality standards = more experimentation but less stability.
              </div>
            </div>
          )}
        </>
        )}
      </>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <>
          {/* Upsell for Starter customers */}
          {plan && plan.tier === 'starter' && (
            <div style={{
              background: 'white',
              padding: 80,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              textAlign: 'center',
              marginBottom: 24
            }}>
              <div style={{
                display: 'inline-block',
                padding: '4px 12px',
                background: '#f3f4f6',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: 24
              }}>
                PRO
              </div>
              <h2 style={{ fontSize: 28, marginBottom: 16, fontWeight: 700 }}>Advanced Settings</h2>
              <p style={{ color: '#6b7280', marginBottom: 32, fontSize: 17, lineHeight: 1.6 }}>
                Choose redirect destinations, set cart value conditions, and fine-tune your modal behavior. Available on Pro and Enterprise plans.
              </p>
              
              <a
                href="/app/upgrade"
                style={{
                  display: 'inline-block',
                  background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                  color: 'white',
                  padding: '14px 32px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: 16,
                  transition: 'transform 0.2s',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                Upgrade to Pro
              </a>
            </div>
          )}
          {/* Show content for Pro/Enterprise customers */}
          {plan && (plan.tier === 'pro' || plan.tier === 'enterprise') && (
        <>
          {optimizationMode === "ai" && (
            <div style={{
              background: 'white',
              padding: 48,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              textAlign: 'center',
              marginBottom: 24
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}></div>
              <h2 style={{ fontSize: 24, marginBottom: 12 }}>AI Mode Active</h2>
              <p style={{ color: '#6b7280', marginBottom: 24 }}>
                Advanced settings are managed by AI. Switch to Manual Mode in the Quick Setup tab to access manual controls.
              </p>
            </div>
          )}

          {/* Manual Mode Only: After Click Behavior & Cart Value Conditions */}
          {optimizationMode !== "ai" && (
          <>
          {/* Redirect Destination & Cart Value Conditions Sections */}
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
               <strong>Upgrade to Pro</strong> to choose between cart and checkout redirect and A/B test which converts better.{" "}
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
                 <strong>Upgrade to Pro</strong> to target specific cart value ranges.{" "}
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
             <strong>Example:</strong> Set minimum to $100 and maximum to $3000 to only show the modal for mid-range carts. Combine with any trigger above!
          </div>
        </div>
          </>
          )}
        </>
        )}
      </>
      )}

      {/* Branding Tab */}
      {activeTab === 'branding' && (
        <>
        {/* Hidden inputs to preserve trigger settings when saving from Branding tab */}
        <input type="hidden" name="exitIntentEnabled" value={settings.exitIntentEnabled || settings.triggers?.exitIntent ? "on" : ""} />
        <input type="hidden" name="timeDelayEnabled" value={settings.timeDelayEnabled || settings.triggers?.timeDelay ? "on" : ""} />
        <input type="hidden" name="timeDelaySeconds" value={settings.timeDelaySeconds || settings.triggers?.timeDelaySeconds || 30} />
        <input type="hidden" name="cartValueEnabled" value={settings.cartValueEnabled || settings.triggers?.cartValue ? "on" : ""} />
        <input type="hidden" name="cartValueMin" value={settings.cartValueMin || settings.triggers?.minCartValue || 0} />
        <input type="hidden" name="cartValueMax" value={settings.cartValueMax || settings.triggers?.maxCartValue || 1000} />
        
        {plan?.tier !== 'enterprise' ? (
          <div style={{
            background: 'white',
            padding: 48,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              background: '#8B5CF6',
              color: 'white',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 16
            }}>
              ENTERPRISE
            </div>
            <h2 style={{ fontSize: 24, marginBottom: 12 }}>Brand Customization</h2>
            <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 500, margin: '0 auto 24px' }}>
              Customize your modal colors and fonts to match your brand perfectly. 
              Available on Enterprise plan.
            </p>
            <button
              type="button"
              onClick={() => window.open('https://sealdeal.ai/pricing', '_blank')}
              style={{
                padding: '12px 24px',
                background: '#8B5CF6',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 500
              }}
            >
              Upgrade to Enterprise
            </button>
          </div>
        ) : (
          <div style={{ 
            background: "white", 
            padding: 24, 
            borderRadius: 8, 
            border: "1px solid #e5e7eb",
            marginBottom: 24 
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 20, marginBottom: 4 }}>Brand Customization</h2>
                <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
                  Customize the modal to match your brand
                </p>
              </div>
              <span style={{ 
                padding: "4px 12px", 
                background: "#8B5CF6", 
                color: "white", 
                borderRadius: 4, 
                fontSize: 12,
                fontWeight: 600 
              }}>
                ENTERPRISE
              </span>
            </div>

            {/* Auto-Detect Button */}
            <div style={{ marginBottom: 24 }}>
              <button
                type="button"
                onClick={async () => {
                  setAutoDetecting(true);
                  try {
                    const response = await fetch('/apps/exit-intent/api/detect-brand', {
                      method: 'POST'
                    });
                    const data = await response.json();
                    if (data.success) {
                      setBrandPrimaryColor(data.colors.primary);
                      setBrandSecondaryColor(data.colors.secondary);
                      setBrandAccentColor(data.colors.accent);
                      setBrandFont(data.colors.font);
                    }
                  } catch (error) {
                    console.error('Auto-detect failed:', error);
                  } finally {
                    setAutoDetecting(false);
                  }
                }}
                disabled={autoDetecting}
                style={{
                  padding: "10px 20px",
                  background: autoDetecting ? "#9ca3af" : "#10b981",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: autoDetecting ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                {autoDetecting ? "Detecting..." : "Auto-Detect Brand Colors"}
              </button>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
                Automatically detect colors from your store's homepage
              </div>
            </div>

            {/* Color Pickers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                  Primary Color
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    name="brandPrimaryColor"
                    value={brandPrimaryColor}
                    onChange={(e) => { setBrandPrimaryColor(e.target.value); setFormChanged(true); }}
                    style={{ width: 50, height: 40, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={brandPrimaryColor}
                    onChange={(e) => { setBrandPrimaryColor(e.target.value); setFormChanged(true); }}
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                  Secondary Color
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    name="brandSecondaryColor"
                    value={brandSecondaryColor}
                    onChange={(e) => { setBrandSecondaryColor(e.target.value); setFormChanged(true); }}
                    style={{ width: 50, height: 40, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={brandSecondaryColor}
                    onChange={(e) => { setBrandSecondaryColor(e.target.value); setFormChanged(true); }}
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                  Accent Color
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    name="brandAccentColor"
                    value={brandAccentColor}
                    onChange={(e) => { setBrandAccentColor(e.target.value); setFormChanged(true); }}
                    style={{ width: 50, height: 40, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={brandAccentColor}
                    onChange={(e) => { setBrandAccentColor(e.target.value); setFormChanged(true); }}
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }}
                  />
                </div>
              </div>
            </div>

            {/* Font Selector */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                Font Family
              </label>
              <select
                name="brandFont"
                value={brandFont}
                onChange={(e) => { setBrandFont(e.target.value); setFormChanged(true); }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14
                }}
              >
                <option value="system">System Default</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="'Helvetica Neue', sans-serif">Helvetica</option>
                <option value="'Georgia', serif">Georgia</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
                <option value="'Courier New', monospace">Courier</option>
                <option value="'Roboto', sans-serif">Roboto</option>
                <option value="'Open Sans', sans-serif">Open Sans</option>
                <option value="'Lato', sans-serif">Lato</option>
                <option value="'Montserrat', sans-serif">Montserrat</option>
              </select>
            </div>

            {/* Custom CSS Section */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                Custom CSS (Advanced)
              </label>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                Add custom CSS to style your modal. You can change colors, fonts, spacing, etc. 
                <strong> You cannot change modal copy</strong> (that's controlled by AI/admin).
              </div>
              <textarea
                name="customCSS"
                value={customCSS}
                onChange={(e) => { setCustomCSS(e.target.value); setFormChanged(true); }}
                placeholder="/* Enter your custom CSS here... */
#exit-intent-modal {
  /* Add your styles */
}"
                style={{
                  width: "100%",
                  minHeight: "200px",
                  fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
                  fontSize: "12px",
                  padding: "12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  backgroundColor: "#f9fafb",
                  resize: "vertical"
                }}
              />
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                {customCSS?.length || 0} / 102,400 characters (100KB max)
              </div>
            </div>

            {/* Preview Box */}
            <div style={{
              padding: 16,
              background: brandSecondaryColor,
              border: `2px solid ${brandPrimaryColor}`,
              borderRadius: 8,
              textAlign: "center"
            }}>
              <div style={{ 
                fontSize: 18, 
                fontWeight: 600, 
                color: brandPrimaryColor,
                fontFamily: brandFont,
                marginBottom: 8
              }}>
                Preview
              </div>
              <button type="button" style={{
                padding: "10px 20px",
                background: brandAccentColor,
                color: brandSecondaryColor,
                border: "none",
                borderRadius: 6,
                fontFamily: brandFont,
                fontSize: 14,
                fontWeight: 500,
                cursor: "default"
              }}>
                Sample Button
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {/* Save Button - Appears on all tabs */}
      <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 16 }}>
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