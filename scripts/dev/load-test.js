import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },    // Warm-up: Ramp to 50 users
    { duration: '5m', target: 100 },   // Normal traffic: 100 concurrent users
    { duration: '2m', target: 500 },   // Black Friday spike: Ramp to 500 users
    { duration: '5m', target: 500 },   // Hold Black Friday load
    { duration: '2m', target: 1000 },  // Cyber Monday spike: 1000 users
    { duration: '3m', target: 1000 },  // Hold Cyber Monday load
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95% of requests must complete below 500ms
    'http_req_failed': ['rate<0.01'],   // Error rate must be below 1%
    'errors': ['rate<0.01'],            // Custom error rate below 1%
  },
};

// Test data - Replace with your actual app URL
const BASE_URL = 'https://your-app-url.fly.dev'; // CHANGE THIS TO YOUR APP URL

// Sample test shop
const TEST_SHOP = 'test-store.myshopify.com';

// Sample customer signals for AI decision endpoint
function getRandomSignals() {
  return {
    visitFrequency: Math.floor(Math.random() * 10) + 1,
    cartValue: Math.floor(Math.random() * 500) + 20,
    itemCount: Math.floor(Math.random() * 5) + 1,
    deviceType: Math.random() > 0.4 ? 'mobile' : 'desktop',
    accountStatus: Math.random() > 0.7 ? 'logged_in' : 'guest',
    trafficSource: ['organic', 'social', 'paid', 'direct'][Math.floor(Math.random() * 4)],
    timeOnSite: Math.floor(Math.random() * 300) + 30,
    pageViews: Math.floor(Math.random() * 10) + 1,
    hasAbandonedBefore: Math.random() > 0.5,
    scrollDepth: Math.floor(Math.random() * 100),
    abandonmentCount: Math.floor(Math.random() * 3),
    cartHesitation: Math.floor(Math.random() * 2),
    productDwellTime: Math.floor(Math.random() * 180),
  };
}

export default function () {
  // Test 1: AI Decision Endpoint (Most Critical)
  const aiDecisionPayload = JSON.stringify({
    shop: TEST_SHOP,
    signals: getRandomSignals(),
    mode: Math.random() > 0.5 ? 'enterprise' : 'ai',
  });

  const aiDecisionRes = http.post(
    `${BASE_URL}/apps/exit-intent/api/ai-decision`,
    aiDecisionPayload,
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'AIDecision' },
    }
  );

  check(aiDecisionRes, {
    'AI decision status is 200': (r) => r.status === 200,
    'AI decision response time < 500ms': (r) => r.timings.duration < 500,
    'AI decision returns valid decision': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.decision !== undefined;
      } catch (e) {
        return false;
      }
    },
  }) || errorRate.add(1);

  sleep(1);

  // Test 2: Signal Enrichment Endpoint (Enterprise)
  if (Math.random() > 0.5) {
    const enrichPayload = JSON.stringify({
      customerId: Math.floor(Math.random() * 10000),
      cart: {
        item_count: Math.floor(Math.random() * 5) + 1,
        total_price: Math.floor(Math.random() * 50000) + 2000,
      },
      basicSignals: getRandomSignals(),
    });

    const enrichRes = http.post(
      `${BASE_URL}/apps/exit-intent/api/enrich-signals`,
      enrichPayload,
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'EnrichSignals' },
      }
    );

    check(enrichRes, {
      'Enrich signals status is 200': (r) => r.status === 200,
      'Enrich signals response time < 300ms': (r) => r.timings.duration < 300,
    }) || errorRate.add(1);

    sleep(0.5);
  }

  // Test 3: Variant Tracking (All tiers)
  const trackPayload = JSON.stringify({
    shop: TEST_SHOP,
    variantId: Math.floor(Math.random() * 100) + 1,
    event: ['impression', 'click', 'conversion'][Math.floor(Math.random() * 3)],
    revenue: Math.random() > 0.9 ? Math.floor(Math.random() * 500) + 20 : 0,
  });

  const trackRes = http.post(
    `${BASE_URL}/apps/exit-intent/api/track-variant`,
    trackPayload,
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'TrackVariant' },
    }
  );

  check(trackRes, {
    'Track variant status is 200': (r) => r.status === 200,
    'Track variant response time < 200ms': (r) => r.timings.duration < 200,
  }) || errorRate.add(1);

  sleep(1);

  // Test 4: Admin Dashboard Load (Performance page)
  if (Math.random() > 0.8) {
    const dashboardRes = http.get(`${BASE_URL}/app/performance`, {
      tags: { name: 'Dashboard' },
    });

    check(dashboardRes, {
      'Dashboard status is 200': (r) => r.status === 200,
      'Dashboard response time < 1000ms': (r) => r.timings.duration < 1000,
    }) || errorRate.add(1);

    sleep(2);
  }

  // Random sleep between requests (1-3 seconds)
  sleep(Math.random() * 2 + 1);
}

// Setup function (runs once at start)
export function setup() {
  console.log('🚀 Starting Repsarq load test...');
  console.log(`📊 Target: ${BASE_URL}`);
  console.log('⚡ Simulating Black Friday/Cyber Monday traffic');
}

// Teardown function (runs once at end)
export function teardown(data) {
  console.log('✅ Load test completed');
  console.log('📈 Check results above for performance metrics');
}
