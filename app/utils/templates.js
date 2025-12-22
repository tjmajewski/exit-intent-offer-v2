export const MODAL_TEMPLATES = {
  discount: {
    id: "discount",
    name: "Discount Offer",
    tier: "starter", // Available on all plans
    icon: "🎁",
    headline: "Wait! Don't leave yet 🎁",
    body: "Complete your purchase now and get an exclusive discount on your order!",
    ctaButton: "Complete My Order",
    description: "Classic exit intent offer with discount code"
  },
  urgency: {
    id: "urgency",
    name: "Urgency & Scarcity",
    tier: "pro",
    icon: "⚡",
    headline: "Items Selling Fast! ⚡",
    body: "These items are in high demand and stock is running low. Complete your order now before they're gone!",
    ctaButton: "Secure My Order",
    description: "Create FOMO with urgency and scarcity"
  },
  welcome: {
    id: "welcome",
    name: "New Customer Welcome",
    tier: "pro",
    icon: "👋",
    headline: "Welcome! Here's a Special Offer 👋",
    body: "We noticed this is your first visit! Complete your order now and get a special first-time customer discount.",
    ctaButton: "Claim My Offer",
    description: "Welcome first-time visitors with special offer"
  },
  cartReminder: {
    id: "cartReminder",
    name: "Cart Abandonment",
    tier: "pro",
    icon: "💰",
    headline: "Complete Your Order & Save! 💰",
    body: "You have items waiting in your cart! Finish your purchase now and we'll add an extra discount just for you.",
    ctaButton: "Complete My Purchase",
    description: "Gentle reminder with added incentive"
  },
  giftCard: {
    id: "giftCard",
    name: "Gift Card Offer",
    tier: "enterprise",
    icon: "🎟️",
    headline: "Come Back & Get $10 Off! 🎟️",
    body: "We'll send you a $10 gift card to use on your next purchase. Complete your email below to claim your gift!",
    ctaButton: "Send Me My Gift Card",
    description: "Encourage return visits with gift card incentive"
  }
};

export function getAvailableTemplates(planTier) {
  const templates = Object.values(MODAL_TEMPLATES);
  
  if (planTier === "starter") {
    return templates.filter(t => t.tier === "starter");
  }
  
  // Pro and Enterprise get all templates
  return templates;
}