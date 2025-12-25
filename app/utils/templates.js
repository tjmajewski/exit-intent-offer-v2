export const MODAL_TEMPLATES = {
  discount: {
    id: "discount",
    name: "Discount Offer",
    tier: "starter",
    icon: "🎁",
    headline: "Wait! Don't leave yet 🎁",
    body: "Complete your purchase now and get an exclusive discount on your order!",
    ctaButton: "Complete My Order",
    description: "Classic exit intent offer with discount code"
  },
  urgency: {
    id: "urgency",
    name: "Limited Time Offer",
    tier: "starter",
    icon: "⚡",
    headline: "Don't Miss Out! ⚡",
    body: "This exclusive offer won't last forever. Complete your order now and save!",
    ctaButton: "Claim My Offer",
    description: "Create urgency without requiring stock/timer data"
  },
  welcome: {
    id: "welcome",
    name: "Special Offer",
    tier: "starter",
    icon: "✨",
    headline: "Special Offer Just For You! ✨",
    body: "We're offering an exclusive discount on your order. Complete your purchase now to save!",
    ctaButton: "Get My Discount",
    description: "Generic special offer messaging"
  },
  cartReminder: {
    id: "cartReminder",
    name: "Cart Reminder",
    tier: "starter",
    icon: "🛒",
    headline: "Complete Your Order! 🛒",
    body: "You have items in your cart. Finish your purchase now and get an exclusive discount!",
    ctaButton: "Complete My Order",
    description: "Cart abandonment reminder with incentive"
  }
};

export function getAvailableTemplates(planTier) {
  const templates = Object.values(MODAL_TEMPLATES);
  
  if (planTier === "starter") {
    return templates.filter(t => t.tier === "starter");
  }
  
  // Pro and Enterprise get all templates (currently all are starter tier anyway)
  return templates;
}