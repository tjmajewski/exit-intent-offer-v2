/**
 * Collect store metrics from Shopify
 */
export async function collectStoreMetrics(admin, shopifyDomain) {
  console.log(`📊 Collecting social proof metrics for ${shopifyDomain}`);

  try {
    // Get customer count
    const customerCount = await getCustomerCount(admin);
    console.log(`  ✅ Customers: ${customerCount}`);

    // Get order count (better for social proof)
    const orderCount = await getOrderCount(admin);
    console.log(`  ✅ Orders: ${orderCount}`);

    // Get product reviews (if available)
    const reviews = await getReviewMetrics(admin);
    if (reviews) {
      console.log(`  ✅ Reviews: ${reviews.count} (avg: ${reviews.avgRating})`);
    }

    // Update shop record
    const { default: db } = await import('../db.server.js');
    const shop = await db.shop.update({
      where: { shopifyDomain },
      data: {
        customerCount,
        orderCount,
        avgRating: reviews?.avgRating || null,
        reviewCount: reviews?.count || null,
        socialProofUpdatedAt: new Date()
      }
    });
    
    console.log(`  ✅ Social proof updated for ${shopifyDomain}`);
    
    return {
      customerCount,
      orderCount,
      avgRating: reviews?.avgRating,
      reviewCount: reviews?.count
    };
  } catch (error) {
    console.error(`  ❌ Error collecting metrics: ${error.message}`);
    return null;
  }
}

/**
 * Get total customer count from Shopify
 */
async function getCustomerCount(admin) {
  try {
    const query = `
      query {
        customersCount {
          count
        }
      }
    `;
    
    const response = await admin.graphql(query);
    const data = await response.json();
    
    return data?.data?.customersCount?.count || 0;
  } catch (error) {
    console.error('Error fetching customer count:', error);
    return 0;
  }
}

/**
 * Get total order count from Shopify
 */
async function getOrderCount(admin) {
  try {
    const query = `
      query {
        ordersCount {
          count
        }
      }
    `;
    
    const response = await admin.graphql(query);
    const data = await response.json();
    
    return data?.data?.ordersCount?.count || 0;
  } catch (error) {
    console.error('Error fetching order count:', error);
    return 0;
  }
}

/**
 * Get review metrics from Shopify product reviews
 * Note: This only works if merchant has Shopify's built-in reviews
 * For Judge.me, Yotpo, etc., we'd need separate API integrations
 */
async function getReviewMetrics(admin) {
  try {
    // Shopify doesn't have a native reviews API in GraphQL
    // This would need integration with review app APIs
    // For now, return null and let merchants manually configure
    console.log('  ⚠️ Reviews require review app integration (Judge.me, Yotpo, etc.)');
    return null;
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return null;
  }
}

/**
 * Format social proof numbers for display
 * Only shows if count is impressive enough
 */
export function formatSocialProof(count, type = 'orders') {
  if (!count || count < 100) {
    return null; // Don't show if too small
  }
  
  // Round to nice numbers for credibility
  if (count < 1000) {
    const rounded = Math.floor(count / 100) * 100;
    return `${rounded}+`; // "500+", "900+"
  }
  
  if (count < 10000) {
    const rounded = Math.floor(count / 1000);
    return `${rounded}k+`; // "2k+", "5k+", "9k+"
  }
  
  if (count < 100000) {
    const rounded = Math.floor(count / 1000);
    return `${rounded}k+`; // "15k+", "50k+"
  }
  
  const rounded = Math.floor(count / 100000) * 100;
  return `${rounded}k+`; // "100k+", "200k+"
}

/**
 * Format rating for display
 * Only shows if rating is good (4.0+)
 */
export function formatRating(rating) {
  if (!rating || rating < 4.0) {
    return null; // Don't show low ratings
  }
  
  return rating.toFixed(1); // "4.8", "4.9"
}

/**
 * Replace social proof placeholders in text with actual values
 */
export function replaceSocialProofPlaceholders(text, shop) {
  if (!text || !text.includes('{{')) return text;
  
  // Determine which count to use (prefer orders over customers)
  const count = shop.orderCount || shop.customerCount || 0;
  const proofCount = formatSocialProof(count);
  
  const rating = formatRating(shop.avgRating);
  
  // If no valid social proof available, return null to signal skipping this gene
  if (!proofCount && text.includes('{{social_proof_count}}')) {
    return null;
  }
  
  if (!rating && text.includes('{{rating}}')) {
    return null;
  }
  
  // Replace placeholders
  let result = text;
  if (proofCount) {
    result = result.replace(/\{\{social_proof_count\}\}/g, proofCount);
  }
  if (rating) {
    result = result.replace(/\{\{rating\}\}/g, rating);
  }
  
  return result;
}

/**
 * Check if shop has social proof data available
 */
export function hasSocialProof(shop) {
  const hasCount = (shop.orderCount && shop.orderCount >= (shop.socialProofMinimum || 100)) || 
                   (shop.customerCount && shop.customerCount >= (shop.socialProofMinimum || 100));
  const hasRating = shop.avgRating && shop.avgRating >= 4.0;
  
  return hasCount || hasRating;
}

/**
 * Test social proof formatting
 */
export function testSocialProofFormatting() {
  console.log('🧪 Testing Social Proof Formatting');
  console.log('===================================\n');
  
  const testCases = [
    { count: 50, expected: null, reason: 'Too small' },
    { count: 500, expected: '500+', reason: 'Hundreds' },
    { count: 2500, expected: '2k+', reason: 'Thousands' },
    { count: 15000, expected: '15k+', reason: 'Tens of thousands' },
    { count: 150000, expected: '100k+', reason: 'Hundreds of thousands' }
  ];
  
  testCases.forEach(test => {
    const result = formatSocialProof(test.count);
    const passed = result === test.expected ? '✅' : '❌';
    console.log(`${passed} ${test.count} orders → ${result || 'null'} (${test.reason})`);
  });
  
  console.log('\n🧪 Testing Rating Formatting');
  console.log('=============================\n');
  
  const ratingTests = [
    { rating: 3.5, expected: null, reason: 'Too low' },
    { rating: 4.0, expected: '4.0', reason: 'Minimum' },
    { rating: 4.8, expected: '4.8', reason: 'Good' },
    { rating: 4.95, expected: '5.0', reason: 'Excellent' }
  ];
  
  ratingTests.forEach(test => {
    const result = formatRating(test.rating);
    const passed = result === test.expected ? '✅' : '❌';
    console.log(`${passed} ${test.rating} stars → ${result || 'null'} (${test.reason})`);
  });
}
