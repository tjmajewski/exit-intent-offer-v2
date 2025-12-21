// Generate a simple hash from modal configuration
export function generateModalHash(config) {
  const hashString = JSON.stringify({
    template: config.template || "discount",
    headline: config.modalHeadline,
    body: config.modalBody,
    ctaButton: config.ctaButton,
    discountEnabled: config.discountEnabled,
    discountPercentage: config.discountPercentage,
    redirectDestination: config.redirectDestination,
    exitIntentEnabled: config.exitIntentEnabled,
    timeDelayEnabled: config.timeDelayEnabled,
    timeDelaySeconds: config.timeDelaySeconds,
    cartValueEnabled: config.cartValueEnabled,
    cartValueMin: config.cartValueMin,
    cartValueMax: config.cartValueMax
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