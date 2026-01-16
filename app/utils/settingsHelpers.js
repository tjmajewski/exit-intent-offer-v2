export function getTriggerDisplay(settings) {
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

export function getDiscountDisplay(settings) {
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
}
