// Generate a simple hash from modal configuration
export function generateModalHash(config) {
  // Handle both old flat structure and new nested triggers structure
  const triggers = config.triggers || {};
  
  const hashString = JSON.stringify({
    template: config.template || "discount",
    headline: config.modalHeadline,
    body: config.modalBody,
    ctaButton: config.ctaButton,
    discountEnabled: config.discountEnabled,
    offerType: config.offerType || "percentage",
    discountPercentage: config.discountPercentage,
    discountAmount: config.discountAmount,
    redirectDestination: config.redirectDestination,
    // Support both old and new trigger formats
    exitIntentEnabled: triggers.exitIntent !== undefined ? triggers.exitIntent : config.exitIntentEnabled,
    timeDelayEnabled: triggers.timeDelay !== undefined ? triggers.timeDelay : config.timeDelayEnabled,
    timeDelaySeconds: triggers.timeDelaySeconds !== undefined ? triggers.timeDelaySeconds : config.timeDelaySeconds,
    cartValueEnabled: triggers.cartValue !== undefined ? triggers.cartValue : config.cartValueEnabled,
    cartValueMin: triggers.minCartValue !== undefined ? triggers.minCartValue : config.cartValueMin,
    cartValueMax: triggers.maxCartValue !== undefined ? triggers.maxCartValue : config.cartValueMax
  });

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < hashString.length; i++) {
    const char = hashString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export function getDefaultModalLibrary() {
  return {
    modals: [],
    nextModalNumber: 1,
    currentModalId: null
  };
}

export function findModalByHash(library, hash) {
  return library.modals.find(m => m.hash === hash);
}

export function getNextModalName(library) {
  return `modal${library.nextModalNumber}`;
}