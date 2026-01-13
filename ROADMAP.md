ResparQ Launch Roadmap
Updated: January 13, 2026
App: Exit Intent Modal with AI-Powered Cart Recovery

✅ COMPLETED FEATURES
Core Functionality

AI Decision Engine - 13 customer signals (visit frequency, cart value, device type, account status, traffic source, time on site, page views, scroll depth, abandonment history, cart hesitation, product dwell time)
Advanced Triggers - Scroll depth, time on site, cart hesitation, product dwell time tracking
Cart Monitoring - Threshold offers, progress indicators, mini-cart integration, real-time cart value tracking
Promotional Intelligence (Enterprise) - Auto-detects site-wide promos, AI strategy recommendations, budget cap enforcement
Manual Intervention Controls (Enterprise) - Kill/Protect/Champion variant buttons with status dropdown
Order Tracking - Full conversion tracking with database storage, date filtering (7d/30d/all time)
False Advertising Prevention - Pure reminder baseline when aggression=0, no false discount promises
Professional Templates - 4 polished templates with clear use cases
Evolution System - Auto-generates and tests variants, learning from customer signals, generation-based improvement
Performance Analytics - Revenue per impression tracking, variant performance metrics, pagination (15 per page)
Settings Organization - Fixed Advanced tab, proper AI/Manual mode detection, tier-based feature gating
Branding - ResparQ branding across modal and admin interface

Recent Additions (January 2026)

Error Monitoring ✅ - Sentry integration (server + client), error boundaries, session replay
Cart icon for Conversions nav
Modal order reversed (newest first)
Variant counter showing totals
Date filtering on Performance page
Mobile-First Modal ✅ - Bottom sheet design, swipe-to-dismiss, 48px touch targets, no body scroll, mobile-optimized typography and animations


🚀 PRE-LAUNCH PRIORITIES (DO BEFORE LAUNCH)
1. Mobile-First Modal ✅ COMPLETED (January 13, 2026)
Implementation:

Bottom sheet design (slides up from bottom)
Larger touch targets (48px minimum)
Swipe-to-dismiss gesture
Faster animations
Reduced text, bigger buttons
Mobile-specific padding to prevent close button overlap
Disabled desktop exit intent on mobile
Prevented body scroll when modal open

Files modified:

extensions/exit-intent-modal/assets/exit-intent-modal.js


2. Custom CSS API (Enterprise Only) (8 hours) ⏳
Why: Enterprise customers want full control over modal appearance.
Implementation:
Database:
Add to Shop model:
prismamodel Shop {
  // ... existing fields
  customCSS String? @db.Text
}
API Endpoint:
Create app/routes/apps.exit-intent.api.custom-css.jsx:
javascriptexport async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const customCSS = formData.get('customCSS');
  
  const shop = await db.shop.update({
    where: { shopifyDomain: session.shop },
    data: { customCSS }
  });
  
  return json({ success: true });
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });
  
  return json({ customCSS: shop?.customCSS || '' });
}
Settings UI:
Add new tab in Settings page (Enterprise only):

Monaco editor (VS Code in browser): https://microsoft.github.io/monaco-editor/
Live preview iframe
Save/Reset buttons
CSS validation
Example snippets

Modal Integration:
In extensions/exit-intent-modal/assets/exit-intent-modal.js:
javascript// Fetch and inject custom CSS
const customCSS = await fetchCustomCSS(shopDomain);
if (customCSS) {
  const style = document.createElement('style');
  style.textContent = customCSS;
  document.head.appendChild(style);
}
Security:

Sanitize CSS (no <script> tags)
Limit file size (100KB max)
Rate limit API calls


3. Misc Bugs Cleanup (varies) ⏳
Action: Create comprehensive list of known bugs and fix them.
To check:

Any console errors?
Mobile rendering issues?
Form validation errors?
Edge cases in AI decision logic?
Date filter edge cases?
Pagination bugs?

Test checklist:

 All tier gates working (Starter/Pro/Enterprise)
 All forms submit correctly
 No React hydration errors
 All database queries optimized
 No N+1 queries
 All webhooks processing correctly
 Modal shows/hides properly on all pages


4. Create Website (external project) 🌐
Platform: Webflow, Framer, or custom Next.js site
Pages needed:

Homepage (hero, features, pricing, CTA)
Pricing
Features breakdown
Case studies/testimonials (post-launch)
Documentation/Help center
Blog (optional)

Key messaging:

"Exit intent that drives sales, not signups"
"Performance-first modals for merchants who want revenue, not subscribers"
"AI-powered cart recovery that converts in seconds, not days"

Differentiators to highlight:

No email required (unlike competitors)
Auto-applied discounts (unlike competitors)
AI learns from 13+ signals (more than competitors)
Promotional intelligence (unique)
Flat pricing, not pageview-based (simpler than competitors)


5. Update Upgrade Page (1 hour) ⏳
File: app/routes/app.upgrade.jsx
Update:

Clear tier comparison table
Feature list per tier
Pricing (decide on flat vs usage-based)
"Current plan" indicator
Upgrade CTA buttons
FAQ section

Pricing suggestions:

Starter: Free or $9/mo (basic modals, manual mode, up to 1,000 monthly visitors)
Pro: $29/mo (AI mode, unlimited visitors, A/B testing, analytics)
Enterprise: $99/mo (everything + manual controls, promo intelligence, custom CSS, priority support)


🚀 DEPLOYMENT & LAUNCH CHECKLIST

BEFORE DEPLOYING TO PRODUCTION:

1. Load Testing (2 hours) 🔴 MUST DO BEFORE LAUNCH
Why: Prevent Black Friday disasters, ensure app handles traffic spikes.
Status: Setup files ready (load-test.js, LOAD_TESTING.md, PERFORMANCE_CHECKLIST.md)
Prerequisites:

App must be deployed to production first (Fly.io, Heroku, etc.)
Cannot test on localhost

Tool: k6 (https://k6.io)
Setup:
bashnpm install -g k6  # Or: brew install k6 (macOS)
Run:
bashk6 run load-test.js
Targets:

100 requests/sec sustained ✓
500 requests/sec peak (Black Friday) ✓
<500ms response time ✓
<1% error rate ✓

What to test:

/apps/exit-intent/api/ai-decision (most critical)
/apps/exit-intent/api/enrich-signals
Settings page load
Order webhook processing

Performance Optimizations (do before load test):

Add database indexes (see PERFORMANCE_CHECKLIST.md)
Verify pagination on all lists
Check for N+1 queries
Optimize API responses (only return needed fields)

Files included:

load-test.js - k6 load test script
LOAD_TESTING.md - Complete testing guide
PERFORMANCE_CHECKLIST.md - Pre-test optimizations

Red flags during test:

p(95) > 1000ms - App too slow under load
Error rate > 5% - App crashing/timing out
Database connection errors - Increase connection pool

If load test fails:

Check Sentry for error patterns
Add database indexes
Implement caching for AI decisions
Scale up server resources
Fix one bottleneck at a time, re-test

DEPLOYMENT STEPS:

 Pre-deployment optimizations complete
 Database indexes added
 Load testing passed
 Error monitoring configured
 All bugs fixed
 Mobile optimization verified
 Website live

TECHNICAL LAUNCH CHECKLIST:

 Error monitoring (Sentry)
 Mobile-first modal design
 Load testing completed ← DO THIS AFTER DEPLOYING
 All bugs fixed
 Database optimized
 API rate limiting
 Security audit
 GDPR compliance check

FEATURES:

 AI decision engine
 Manual intervention controls
 Order tracking
 Analytics with date filtering
 Promotional intelligence
 Custom CSS API (Enterprise)
 Mobile optimization

CONTENT:

 Website live
 Help documentation
 Video tutorials
 Email templates (onboarding)
 Support responses templated

BUSINESS:

 Pricing finalized
 Payment processing set up (Shopify billing)
 Terms of service
 Privacy policy
 Support process defined
 Upgrade page updated

MARKETING:

 App Store listing optimized
 Screenshots ready
 Demo video
 Social media accounts
 Launch announcement drafted
 Beta testers lined up


📦 POST-LAUNCH PRIORITIES (AFTER LAUNCH)
Phase 1: Critical Differentiators (First 2-4 weeks)
1. Margin Protection (3 hours)
Why: Merchants want to protect profitability while offering discounts.
Implementation:

Fetch product costs via Shopify Admin API:

graphqlquery {
  products(first: 100) {
    edges {
      node {
        variants(first: 10) {
          edges {
            node {
              price
              inventoryItem {
                unitCost { amount }
              }
            }
          }
        }
      }
    }
  }
}

Calculate margins: margin = (price - cost) / price × 100
Store in database
Add to Settings: "Minimum margin (%)" input
AI checks before offering discount:

javascriptif (aiSuggestedDiscount > (margin - merchantMinMargin)) {
  aiSuggestedDiscount = margin - merchantMinMargin;
}
Settings UI:

Checkbox: "Protect margins on discounts"
Input: "Minimum margin threshold (%)"
Table showing per-product margins
Warning if discount would violate margin


2. Express Checkout Integration (8 hours)
Why: Reduce friction, increase conversions with one-click checkout.
Implementation:
Shop Pay:
javascript// Check if Shop Pay available
if (Shopify.PaymentButton) {
  // Show Shop Pay express button in modal
  // Apply discount automatically
  window.location.href = '/checkout';
}
Apple Pay:
javascriptif (window.ApplePaySession && ApplePaySession.canMakePayments()) {
  // Show Apple Pay button in modal
  // Handle payment flow
}
Multivariate Integration:

Add to gene pool: expressCheckout: [true, false]
Create variants with/without express checkout
Track performance difference
Add to VariantImpression data

Files to modify:

app/utils/gene-pools.js - Add express checkout to combinations
extensions/exit-intent-modal/assets/exit-intent-modal.js - Payment detection
Modal template - Express checkout buttons


3. Product Imagery in Modals (4 hours)
Why: Visual confirmation increases trust and conversions.
Implementation:

Fetch cart items with images via Shopify Ajax API
Display first 3 products in modal
Show product thumbnails (50x50px)
Fallback to text if no images

Multivariate Integration:

Add to gene pool: showProductImages: [true, false]
Test performance with/without images
Consider mobile data usage (images increase load time)

Design:
┌─────────────────────┐
│  🛒 Your Cart       │
│  [img] Product 1    │
│  [img] Product 2    │
│  [img] Product 3    │
│  + 2 more items...  │
│                     │
│  [Get 15% Off]      │
└─────────────────────┘

4. Variant Tracking / Advanced Analytics (6 hours)
Why: Merchants need deep insights into what's working.
Metrics to add:

Win rate per variant
Statistical significance indicators
Revenue attribution per variant
Confidence intervals
A/B test duration recommendations
Variant lifecycle visualization

UI additions:

Performance → AI Variants tab enhancements:

"Confidence" column (95% confidence = ready to declare winner)
"Days in test" column
"Sample size" column
Charts showing performance over time
Export to CSV



Database:

Already tracking in VariantImpression table ✓
Add aggregation queries
Add statistical calculations


Phase 2: Integrations (Weeks 3-6)
5. Google Analytics Events (2 hours)
Why: Merchants want to see modal performance in GA.
Events to track:

resparq_modal_shown
resparq_modal_clicked
resparq_modal_closed
resparq_discount_applied
resparq_conversion

Implementation:
javascript// In modal JS
if (window.gtag) {
  gtag('event', 'resparq_modal_shown', {
    variant_id: variantId,
    discount_amount: offerAmount,
    cart_value: cartValue
  });
}
Settings:

Checkbox: "Enable Google Analytics tracking"
Input: "GA4 Measurement ID" (optional override)


6. Klaviyo Integration (8 hours)
Why: Most Shopify stores use Klaviyo for email marketing.
Scope to discuss:

Option A: Profile sync only

Push modal interactions to Klaviyo profiles
Custom events: "Viewed Exit Modal", "Clicked Discount"
Use for segmentation in Klaviyo flows


Option B: Bidirectional

Pull Klaviyo segments into ResparQ
Target modals based on Klaviyo data
More complex, more powerful



Initial recommendation: Option A

Simpler implementation
Covers 80% of use cases
Can add Option B later if needed

Implementation:
javascript// Push event to Klaviyo
await fetch('https://a.klaviyo.com/api/events/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Klaviyo-API-Key ${apiKey}`
  },
  body: JSON.stringify({
    data: {
      type: 'event',
      attributes: {
        metric: { name: 'Viewed ResparQ Modal' },
        properties: {
          variant_id: variantId,
          discount_amount: offerAmount
        },
        profile: {
          $email: customerEmail
        }
      }
    }
  })
});
Settings:

Input: "Klaviyo Private API Key"
Checkbox: "Sync modal interactions to Klaviyo"
List of events to sync


7. Email Performance Updates (Enterprise Only) (6 hours)
Why: Show how ResparQ compares to abandoned cart emails.
Features:

Compare ResparQ conversions vs email recovery rates
Show "ResparQ recovered X more than emails would have"
Integration with Shopify's native abandoned cart emails
Performance comparison dashboard

Metrics:

Email send rate
Email open rate
Email click rate
Email conversion rate
ResparQ show rate
ResparQ click rate
ResparQ conversion rate
Time to conversion (ResparQ vs email)

Dashboard widget:
┌─────────────────────────────────┐
│  Recovery Performance           │
│  ───────────────────────────    │
│  📧 Email: 0.6% recovery rate   │
│  ⚡ ResparQ: 3.6% recovery rate │
│  💰 6x more effective           │
│  📈 $2,847 additional revenue   │
└─────────────────────────────────┘

Phase 3: Nice-to-Have (Weeks 7+)

Multi-currency support
Multi-language modal variants
Exit intent on product pages (not just cart)
BFCM/Flash sale mode
Geolocation-based offers
Inventory-aware discounts (clear slow-moving stock)
Countdown timer variants
Spin-to-win gamification
Quiz/survey modals
NPS score collection
Customer testimonials in modal
Free shipping threshold calculator
Upsell/cross-sell product recommendations
Abandoned cart SMS integration
WhatsApp integration
Push notification recovery


🎯 COMPETITIVE POSITIONING
Main Competitors

OptiMonk - Email focus, $29-99/mo, 300+ templates
Wisepops - Multi-channel, $49-299/mo, advanced personalization
Privy - Email/SMS, $12-45/mo, marketing automation
Justuno - AI recommendations, $59-399/mo, advanced segmentation
OptinMonster - General popup, $9-49/mo, WordPress focus

ResparQ's Unique Advantages
1. Performance-First (Not Email-First)

✅ Focus on immediate sales, not email capture
✅ No email required (competitors force signup)
✅ Auto-applied discounts
✅ Revenue per impression tracking

2. Superior AI

✅ 13 customer signals (more than competitors)
✅ Auto-generates and tests variants
✅ Learns and improves over time
✅ Manual intervention controls (unique)

3. Intelligent Features

✅ Cart monitoring with threshold offers
✅ Promotional intelligence (detects site-wide promos)
✅ Margin protection (coming)
✅ Pure reminder mode (no discount)

4. Pricing Simplicity

✅ Flat pricing, not pageview-based
✅ No surprise bills
✅ Unlimited traffic on Pro/Enterprise

Feature Comparison Matrix
FeatureResparQOptiMonkWisepopsPrivyJustunoFocusRevenueEmailMulti-channelEmail/SMSAI RecsNo Email Required✅❌❌❌❌Auto-Applied Discounts✅❌❌❌❌AI Decision Engine✅ (13 signals)❌Limited❌✅Cart Monitoring✅❌❌❌❌Promo Intelligence✅❌❌❌❌Manual Variant Control✅❌❌❌❌Revenue Tracking✅Limited✅Limited✅Starting PriceTBD$29$49$12$59

📈 SUCCESS METRICS
Week 1 Goals

10 installs
5 active merchants
0 critical bugs
<2 hour support response time

Month 1 Goals

50 installs
20 active merchants (using AI mode)
10 paid conversions (Pro/Enterprise)
4.5+ star rating
$500 MRR

Month 3 Goals

200 installs
100 active merchants
50 paid conversions
$2,000 MRR
First case study published


🚨 KNOWN LIMITATIONS
Current

No email capture mode (intentional - not our focus)
Limited to Shopify (no WordPress, WooCommerce, etc.)
English only (multi-language coming later)
No SMS recovery (Klaviyo integration will enable)

Technical Debt

Some components could use refactoring
Test coverage could be improved
Documentation needs expansion


💡 IMPORTANT NOTES
Multivariate Testing
Remember: Every new feature needs to be integrated into the gene pool for A/B testing:

Express checkout → Add to gene pool
Product images → Add to gene pool
New CTA copy → Add to gene pool
Button colors → Add to gene pool

Process:

Add to app/utils/gene-pools.js
Update variant generation logic
Track in VariantImpression table
Display in AI Variants analytics

Mobile Considerations

60%+ of traffic is mobile ✅ HANDLED
Mobile users have higher cart abandonment
Touch targets must be larger ✅ HANDLED (48px)
Load time is critical
Swipe gestures expected ✅ HANDLED

Customer Support

Set up Intercom or similar
Create help docs before launch
Have pre-written responses ready
Monitor Sentry for errors daily


🎯 NEXT SESSION PRIORITIES

Custom CSS API (Enterprise feature) - 8 hours
Misc bugs cleanup (polish) - varies
Website (external project) - TBD
Update Upgrade Page (quick win) - 1 hour
Deploy to production
Load testing (MUST DO AFTER DEPLOYMENT)


Questions? Concerns? Updates?
Bring this document to your next Claude session for continuity!
Last Updated: January 13, 2026
Status: Pre-Launch Phase - Mobile optimization complete!
Next Milestone: Custom CSS API or Upgrade Page