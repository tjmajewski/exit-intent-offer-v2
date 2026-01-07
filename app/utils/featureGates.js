// Feature gate definitions for each plan tier
export const PLAN_FEATURES = {
  starter: {
    name: "Starter",
    price: 29,
    autoApplyDiscount: true,
    abTesting: false,
    personalization: false,
    multipleTemplates: false,
    allTriggers: false,
    cartValueTargeting: false,
    redirectChoice: false,
    revenueTracking: true,
    perModalAnalytics: false,
    impressionLimit: 1000,
    templates: ["discount"]
  },
  pro: {
    name: "Pro",
    price: 79,
    autoApplyDiscount: true,
    abTesting: false,
    personalization: false,
    multipleTemplates: true,
    allTriggers: true,
    cartValueTargeting: true,
    redirectChoice: true,
    revenueTracking: true,
    perModalAnalytics: false,
    impressionLimit: 10000,
    templates: ["discount", "free-shipping", "urgency", "welcome", "reminder"]
  },
  enterprise: {
    name: "Enterprise",
    price: 299,
    autoApplyDiscount: true,
    abTesting: true,
    personalization: true,
    multipleTemplates: true,
    allTriggers: true,
    cartValueTargeting: true,
    redirectChoice: true,
    revenueTracking: true,
    perModalAnalytics: true,
    impressionLimit: null,
    templates: ["discount", "free-shipping", "urgency", "welcome", "reminder", "custom"]
  }
};

export function hasFeature(plan, feature) {
  if (!plan || !plan.tier) return false;
  return PLAN_FEATURES[plan.tier]?.[feature] || false;
}

export function checkUsageLimit(plan, metricName) {
  if (!plan || !plan.tier) {
    return { allowed: false, usage: 0, limit: 0, percentage: 100 };
  }
  
  const limit = PLAN_FEATURES[plan.tier].impressionLimit;
  
  // No limit means unlimited
  if (!limit) {
    return { 
      allowed: true, 
      usage: plan.usage?.impressionsThisMonth || 0, 
      limit: null, 
      percentage: 0 
    };
  }
  
  const usage = plan.usage?.impressionsThisMonth || 0;
  
  return {
    allowed: usage < limit,
    usage,
    limit,
    percentage: Math.round((usage / limit) * 100)
  };
}

export function getDefaultPlan() {
  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 14); // 14 day trial
  
  const resetDate = new Date(now);
  resetDate.setMonth(resetDate.getMonth() + 1);
  
  return {
    tier: "starter",
    status: "trialing",
    billingCycle: "monthly",
    startDate: now.toISOString(),
    trialEndsAt: trialEnd.toISOString(),
    usage: {
      impressionsThisMonth: 0,
      resetDate: resetDate.toISOString()
    }
  };
}
export function checkAndResetUsage(plan, shopId, admin) {
  if (!plan || !plan.usage || !plan.usage.resetDate) {
    return { needsReset: false, plan };
  }

  const now = new Date();
  const resetDate = new Date(plan.usage.resetDate);

  // Check if we're past the reset date
  if (now >= resetDate) {
    console.log(`🔄 Resetting usage - reset date was ${resetDate.toISOString()}`);

    // Reset usage
    plan.usage.impressionsThisMonth = 0;

    // Calculate next reset date (30 days from now)
    const nextReset = new Date(now);
    nextReset.setDate(nextReset.getDate() + 30);
    nextReset.setHours(0, 0, 0, 0);
    
    plan.usage.resetDate = nextReset.toISOString();

    console.log(`✓ Usage reset complete. Next reset: ${nextReset.toISOString()}`);

    return { needsReset: true, plan };
  }

  return { needsReset: false, plan };
}