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

// =============================================================================
// MODAL LAYOUTS (visual templates)
//
// Distinct from MODAL_TEMPLATES above — those are *copy* presets (discount,
// urgency, social, reminder). MODAL_LAYOUTS are *visual* templates (the
// renderers live in extensions/exit-intent-modal/assets/modal-templates.js
// and the IDs must stay in sync with that file's TEMPLATES registry).
//
// Tiers:
//   1 = ships with Sprint 1 (Classic Card, Top Banner, Bottom Sheet, Coupon Ticket)
//   2 = Sprint 2 (Split Hero, Timer-Front, Testimonial, Scratch Reveal)
// =============================================================================
export const MODAL_LAYOUTS = {
  "classic-card": {
    id: "classic-card",
    name: "Classic Card",
    description: "Centered, soft shadow",
    tier: 1
  },
  "top-banner": {
    id: "top-banner",
    name: "Top Banner",
    description: "Slim, non-intrusive",
    tier: 1
  },
  "bottom-sheet": {
    id: "bottom-sheet",
    name: "Bottom Sheet",
    description: "Mobile-first",
    tier: 1
  },
  "coupon-ticket": {
    id: "coupon-ticket",
    name: "Coupon Ticket",
    description: "Gamified, dashed edge",
    tier: 1
  },
  "split-hero": {
    id: "split-hero",
    name: "Split Hero",
    description: "Two-panel, bold offer",
    tier: 2
  },
  "timer-front": {
    id: "timer-front",
    name: "Timer Front",
    description: "Live countdown urgency",
    tier: 2
  },
  "testimonial": {
    id: "testimonial",
    name: "Testimonial",
    description: "Star rating + social proof",
    tier: 2
  },
  "scratch-reveal": {
    id: "scratch-reveal",
    name: "Scratch Reveal",
    description: "Scratch-off to reveal",
    tier: 2
  }
};

export const DEFAULT_MODAL_LAYOUT_ID = "classic-card";

// Canonical ordered list of every shippable layout id. Mirrors TEMPLATE_IDS in
// gene-pools.js and the TEMPLATES registry in the storefront extension — kept
// local so this module has no dependency on the genetic engine.
export const ALL_LAYOUT_IDS = Object.keys(MODAL_LAYOUTS);

export function getAvailableLayouts() {
  // All merchants see Tier 1 + Tier 2 layouts.
  return Object.values(MODAL_LAYOUTS).filter((l) => l.tier <= 2);
}

// =============================================================================
// LAYOUT QA POLICY
//
// Merchants can turn off layouts that clash with their theme (see the QA page
// at /app/qa-layouts). The disabled set is stored on Shop.disabledLayouts as a
// JSON string array of templateIds. These two helpers are the single source of
// truth for parsing that column and resolving the enabled set — used by the QA
// route, the runtime clamp in ai-decision, and the genetic engine.
// =============================================================================

/**
 * Parse the Shop.disabledLayouts JSON column into a clean string[] of known
 * layout ids. Tolerant of null / malformed JSON / unknown ids (returns []).
 */
export function parseDisabledLayouts(json) {
  try {
    const arr = JSON.parse(json || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter((id) => typeof id === "string" && ALL_LAYOUT_IDS.includes(id));
  } catch {
    return [];
  }
}

/**
 * Resolve the set of layout ids the AI is allowed to generate and render for a
 * shop. Never returns empty: if a merchant somehow disabled every layout, falls
 * back to the default so a pop-up can always render.
 */
export function getEnabledLayoutIds(disabledJson) {
  const disabled = parseDisabledLayouts(disabledJson);
  const enabled = ALL_LAYOUT_IDS.filter((id) => !disabled.includes(id));
  return enabled.length > 0 ? enabled : [DEFAULT_MODAL_LAYOUT_ID];
}