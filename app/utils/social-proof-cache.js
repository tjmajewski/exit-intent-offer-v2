// Simple in-memory cache for social proof data
// Resets on server restart (which is fine for this use case)

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export function getSocialProofFromCache(shopId) {
  const cached = cache.get(shopId);
  
  if (!cached) return null;
  
  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(shopId);
    return null;
  }
  
  return cached.data;
}

export function setSocialProofCache(shopId, data) {
  cache.set(shopId, {
    data,
    timestamp: Date.now()
  });
}

export function clearSocialProofCache(shopId) {
  cache.delete(shopId);
}

export function clearAllSocialProofCache() {
  cache.clear();
}
