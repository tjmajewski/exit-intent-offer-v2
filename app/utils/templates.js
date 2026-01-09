export const MODAL_TEMPLATES = {
  discount: {
    id: "discount",
    name: "Discount Offer",
    tier: "starter",
    icon: "💰",
    headline: "Wait! Get your exclusive discount",
    body: "Complete your purchase in the next 24 hours and save on your order. Your discount code will be applied automatically.",
    ctaButton: "Claim My Discount",
    description: "Direct discount offer - best for price-sensitive shoppers"
  },
  urgency: {
    id: "urgency",
    name: "Limited Time",
    tier: "starter",
    icon: "⏰",
    headline: "Limited time offer - don't miss out",
    body: "This exclusive discount expires in 24 hours. Save on items you love before the offer ends.",
    ctaButton: "Apply Discount Now",
    description: "Time-limited offer - creates urgency and FOMO"
  },
  social: {
    id: "social",
    name: "Social Proof",
    tier: "starter",
    icon: "⭐",
    headline: "Join 10,000+ happy customers",
    body: "Thousands of customers trust us for quality products and fast shipping. Complete your order with confidence.",
    ctaButton: "Complete My Order",
    description: "Trust-building message - works when discount not needed"
  },
  reminder: {
    id: "reminder",
    name: "Cart Reminder",
    tier: "starter",
    icon: "🛒",
    headline: "You have items in your cart",
    body: "Your items are reserved and ready for checkout whenever you're ready to complete your purchase.",
    ctaButton: "View Cart",
    description: "Gentle reminder - no discount, just helpful nudge"
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