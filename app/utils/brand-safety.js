import db from '../db.server.js';

/**
 * Check if variant copy violates brand safety rules
 */
export async function validateVariantCopy(shopId, headline, subhead, cta, offerAmount) {
  const rules = await db.brandSafetyRule.findUnique({
    where: { shopId: shopId }
  });

  if (!rules || !rules.enabled) {
    return { valid: true };
  }

  const violations = [];
  const allText = `${headline} ${subhead} ${cta}`.toLowerCase();

  // Check prohibited words
  const prohibitedWords = JSON.parse(rules.prohibitedWords);
  for (const word of prohibitedWords) {
    if (allText.includes(word.toLowerCase())) {
      violations.push(`Contains prohibited word: "${word}"`);
    }
  }

  // Check required phrases
  const requiredPhrases = JSON.parse(rules.requiredPhrases);
  for (const phrase of requiredPhrases) {
    if (!allText.includes(phrase.toLowerCase())) {
      violations.push(`Missing required phrase: "${phrase}"`);
    }
  }

  // Check max discount
  if (offerAmount > rules.maxDiscountPercent) {
    violations.push(`Discount ${offerAmount}% exceeds max ${rules.maxDiscountPercent}%`);
  }

  return {
    valid: violations.length === 0,
    violations: violations
  };
}

/**
 * Filter gene pool to only include brand-safe options
 */
export async function filterGenePool(shopId, genePool) {
  const rules = await db.brandSafetyRule.findUnique({
    where: { shopId: shopId }
  });

  if (!rules || !rules.enabled) {
    return genePool;
  }

  const filtered = { ...genePool };

  // Filter offer amounts
  filtered.offerAmounts = genePool.offerAmounts.filter(
    amount => amount <= rules.maxDiscountPercent
  );

  // Filter headlines, subheads, CTAs
  const prohibitedWords = JSON.parse(rules.prohibitedWords);
  
  filtered.headlines = genePool.headlines.filter(h => 
    !containsProhibitedWords(h, prohibitedWords)
  );
  
  filtered.subheads = genePool.subheads.filter(s => 
    !containsProhibitedWords(s, prohibitedWords)
  );
  
  filtered.ctas = genePool.ctas.filter(c => 
    !containsProhibitedWords(c, prohibitedWords)
  );

  return filtered;
}

function containsProhibitedWords(text, prohibitedWords) {
  const lowerText = text.toLowerCase();
  return prohibitedWords.some(word => lowerText.includes(word.toLowerCase()));
}
