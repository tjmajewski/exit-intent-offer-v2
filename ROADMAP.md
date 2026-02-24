cat > ROADMAP.md << 'EOF'
# ResparQ Launch Roadmap
**Updated: February 24, 2026**
**App:** Exit Intent Modal with AI-Powered Cart Recovery
**Status: 🟡 Under Shopify App Review**

---

## ✅ COMPLETED FEATURES

### Core Functionality
- **AI Decision Engine** - 13 customer signals (visit frequency, cart value, device type, account status, traffic source, time on site, page views, scroll depth, abandonment history, cart hesitation, product dwell time)
- **Advanced Triggers** - Exit intent, timer delay, cart value thresholds (all working)
- **Cart Monitoring** - Threshold offers, progress indicators, mini-cart integration, real-time tracking
- **Promotional Intelligence (Enterprise)** - Auto-detects site-wide promos, AI strategy recommendations, budget cap enforcement
- **Manual Intervention Controls (Enterprise)** - Kill/Protect/Champion variant buttons
- **Order Tracking** - Full conversion tracking with database storage, date filtering (7d/30d/all time)
- **False Advertising Prevention** - Pure reminder baseline when aggression=0
- **Professional Templates** - 4 polished templates with auto-selection
- **Evolution System** - Auto-generates and tests variants, generation-based improvement
- **Performance Analytics** - Revenue per impression, variant performance, pagination (15/page)
- **Settings Organization** - Advanced tab with proper tier gating, AI/Manual mode detection
- **Branding** - ResparQ branding, ENTERPRISE gold badges, PRO purple badges

### Recent Additions (January 2026)
- **Error Monitoring** ✅ - Sentry integration (server + client), error boundaries, session replay
- **Cart icon for Conversions nav** ✅
- **Modal order reversed** ✅ (newest first)
- **Variant counter** ✅ showing totals
- **Date filtering** ✅ on Performance page
- **Mobile-First Modal** ✅ - Bottom sheet, swipe-to-dismiss, 48px touch targets, optimized animations

### Shipped Jan 16 – Feb 24, 2026 (Post-Roadmap)
- **Settings Preview Modal + Custom CSS (Monaco editor)** ✅ - Jan 16
- **Social Proof System** ✅ - Dynamic customer counts and ratings - Jan 16
- **Discount Code Modes** ✅ - Generic vs Unique codes (Manual + AI) - Jan 21
- **Plan Persistence Bug Fixed** ✅ - Plan tier now stored in DB and consistent across all routes - Jan 21 – Feb 5
- **Tier-Based Variant Population Limits** ✅ - Jan 24
- **Shopify Billing API** ✅ - Recurring subscriptions, 14-day trial, all tiers - Jan 25
- **Upgrade Page Redesign** ✅ - Dark theme, pricing, feature comparison - Jan 25
- **Onboarding Documentation** ✅ - Starter/Pro/Enterprise welcome guides - Jan 23-24
- **Discount Code Modes Spec** ✅ - Full implementation documented - Jan 23
- **Production Deploy (Fly.io)** ✅ - PostgreSQL, migrations, deployment guide - Jan 30
- **Database Cleanup Job** ✅ - Expired session cleanup + stats endpoint - Jan 31
- **Starter Tier AI Learning** ✅ - Trains AI from manual settings - Jan 31
- **Pro AI "Should We Show" Logic** ✅ - Budget/frequency gating for Pro - Jan 31
- **AI Signal Overhaul** ✅ - High-value signal detection improvements - Jan 31
- **Promo Strategy Reversal** ✅ - Correctly decreases offers during site-wide promos - Jan 27
- **Trial Logic Fixes** ✅ - Prevents new 14-day trial on every plan switch - Jan 27
- **Privacy Policy Page** ✅ - GDPR-compliant `/privacy` route - Feb 1
- **GDPR Webhooks** ✅ - customers/data_request, customers/redact, shop/redact - Feb 1
- **Shopify Submission Checklist** ✅ - SHOPIFY_SUBMISSION_CHECKLIST.md - Feb 1
- **Usage-Based Billing** ✅ - Commission on recovered revenue - Feb 2
- **Unified Compliance Webhook Handler** ✅ - Single `/webhooks` endpoint - Feb 5
- **Production URL Configured** ✅ - shopify.app.toml updated to fly.dev domain - Feb 5
- **Currency Symbol Support** ✅ - Modal shows correct currency - Feb 6
- **Time-Delay Modal Fix** ✅ - Manual time-delay now displays correctly - Feb 6
- **FLASH30 Promo Logic Fix** ✅ - Correct promo detection behavior - Feb 6
- **Upgrade/Trial Logic Fix** ✅ - Mid-trial plan switching works correctly - Feb 6

---

## 🎉 MASSIVE BUG FIX SESSION (January 15, 2026)

### CRITICAL BUGS FIXED
**#1 - Modal Not Displaying** ✅
- Root cause: Triggers object missing from shop-settings API
- Fixed: Added triggers to API response with database values
- Fixed: Wrapped sessionStorage in try-catch for Shopify preview mode
- Status: Modal now displays correctly on exit intent and timer

**#3 - Timer Trigger Not Working** ✅
- Root cause: Timer function didn't exist, only cart monitoring
- Fixed: Added `startCartPageTimer()` function
- Fixed: Timer starts when item added to cart (works on any page)
- Fixed: Triggers from `pollCart` when cart changes
- Status: Timer works perfectly, respects configured delay

**#15 + CRITICAL - Discount Codes Not Applying** ✅
- Root cause: Discount codes created in Shopify but not saved to database
- Root cause: Modal had no discount code to apply to checkout URL
- Fixed: Added discountCode fields to database (Shop model)
- Fixed: Settings action saves discount code after creation
- Fixed: Shop-settings API returns discount code to modal
- Fixed: Modal applies `?discount=CODE` to checkout URL
- Status: Both percentage and fixed discounts working, tested and verified
- Impact: **This was breaking customer expectations** - modal promised discounts but didn't deliver

**#14 - Budget Cap Verification** ✅
- Fixed: Created test simulation script
- Verified: Budget tracking works correctly
- Verified: When budget exhausted, AI returns no-discount modal
- Status: Budget cap enforcement working as designed

### UI/UX IMPROVEMENTS FIXED
**#4 - Pro Upsell Message** ✅ - Changed from "A/B testing" to "smarter AI & manual controls"
**#7 - Dashboard Preview Modal** ✅ - Removed pointer cursor (not clickable)
**#8, #12 - Enterprise Badge Styling** ✅ - Gold badges everywhere, consistent colors
**#9 - Advanced Tab PRO Badge** ✅ - Shows for Starter customers with full upsell overlay
**#16 - Emojis Removed** ✅ - Removed from all upsell messages (⚡, 🚀, 🔒)
**#17 - Promotions Empty State** ✅ - Better message explaining the feature
**#18 - Activity Feed** ✅ - Filtered to show only conversions and clicks (not impressions)
**#11 - Template Pre-Selection** ✅ - First template auto-selected on page load, content pre-filled
**#10 - Timer for Starter** ✅ - Enabled timer trigger for Starter tier (mobile support)

### FEATURES ADDED
**Timer Trigger** ✅
- Works on any page after cart updated
- Starter tier gets access (mobile support)
- Configurable delay (5-300 seconds)

**Discount Code System** ✅
- Unique codes per customer (manual + AI modes)
- Stored in database for API access
- Both percentage and fixed amount support
- Auto-applies at checkout via URL parameter

**Modal Content in Database** ✅
- Headline, body, CTA, redirect destination
- Fast API access (no metafield queries)
- Supports high cart values ($999,999 max)

**Dashboard Preview (AI Mode)** ✅
- Shows example AI-generated copy
- Explains that real copy is personalized per customer
- No longer broken/blank in AI mode

### VERIFIED WORKING (Not Bugs)
**#6 - Impression Tracking** ✅
- Tracks unique sessions (by design)
- SessionStorage prevents duplicate counting
- Working correctly - "1" impression expected in same browser session
- New incognito windows properly increment counter

---

## 🚨 BUGS REMAINING

### High Priority
**#2 - Plan Navigation/Persistence Issue**
- Description: Unknown - needs investigation
- Impact: Unknown
- Priority: High (investigate first)

**#19 - Settings Preview Modal** (Partial Fix)
- Dashboard preview: ✅ FIXED
- Settings preview button: ❌ NOT WORKING
- Needs: Actual modal preview with live form values
- Impact: Medium (nice-to-have for merchants)

### Medium Priority
**#13 - AI Decisions Documentation**
- Need: Document explaining Pro vs Enterprise AI differences
- Need: Help docs for merchants
- Impact: Medium (support burden without docs)

---

## ✅ PRE-LAUNCH PRIORITIES (ALL COMPLETE)

### 1. Custom CSS API (Enterprise Only) ✅ DONE - Jan 16
- Monaco CSS editor integrated into Settings
- Live preview functional
- CSS injected into modal

### 2. Settings Preview Modal ✅ DONE - Jan 16
- "Show Preview" opens actual modal overlay with live form values

### 3. Misc Bugs Cleanup ✅ DONE
- Plan navigation/persistence (#2) — fixed across Jan 21 – Feb 5 commits
- Console errors resolved
- All tier gates working (Starter/Pro/Enterprise)
- All webhooks processing correctly

### 4. Website 🟡 IN PROGRESS
- `resparq-website` submodule added Jan 19
- Status: confirm if live

### 5. Upgrade Page ✅ DONE - Jan 25
- Dark theme redesign
- Flat pricing finalized: Starter $29 / Pro $79 / Enterprise $199
- Shopify Billing API integrated with 14-day trial

---

## 🚀 DEPLOYMENT & LAUNCH CHECKLIST

### DEPLOYMENT STEPS
- [x] Pre-deployment optimizations complete
- [ ] Database indexes added ← still needed
- [ ] Load testing passed ← still needed (see below)
- [x] Error monitoring configured (Sentry)
- [x] All critical bugs fixed
- [x] Mobile optimization verified
- [ ] Website live ← confirm status

### TECHNICAL LAUNCH CHECKLIST
- [x] Error monitoring (Sentry)
- [x] Mobile-first modal design
- [ ] Load testing completed ← **DO THIS NOW** (app is deployed on Fly.io)
  - **Tool:** k6 — `load-test.js` already exists in repo
  - **Targets:** 100 req/s sustained, 500 req/s peak, <500ms, <1% errors
  - **Test:** `/apps/exit-intent/api/ai-decision` (most critical)
  - **Red flags:** p(95) > 1000ms, error rate > 5%, DB connection errors
- [x] All critical bugs fixed
- [ ] Database indexes added
- [ ] API rate limiting
- [x] GDPR compliance — privacy policy, data_request/redact webhooks ✅ Feb 1
- [ ] Security audit

### FEATURES
- [x] AI decision engine
- [x] Manual intervention controls
- [x] Order tracking
- [x] Analytics with date filtering
- [x] Promotional intelligence
- [x] Custom CSS API (Enterprise)
- [x] Mobile optimization
- [x] Discount code system
- [x] Usage-based billing (commission on recovered revenue)
- [x] Shopify Billing API (recurring subscriptions, 14-day trial)

### CONTENT
- [ ] Website live ← confirm status
- [x] Help documentation (Starter/Pro/Enterprise onboarding guides)
- [ ] Video tutorials
- [ ] Email templates (onboarding)
- [ ] Support responses templated

### BUSINESS
- [x] Pricing finalized — Starter $29 / Pro $79 / Enterprise $199
- [x] Payment processing set up (Shopify Billing API)
- [ ] Terms of service ← still needed
- [x] Privacy policy ✅ Feb 1
- [ ] Support process defined
- [x] Upgrade page updated ✅ Jan 25

### MARKETING / APP STORE
- [x] App Store submission prep (screenshots seeded, dev tools hidden)
- [x] GDPR webhooks (required for Shopify review) ✅ Feb 1
- [x] SHOPIFY_SUBMISSION_CHECKLIST.md created
- [x] Production URL configured in shopify.app.toml ✅ Feb 5
- [ ] Demo video
- [ ] Social media accounts
- [ ] Launch announcement drafted
- [ ] Beta testers lined up

### 🟡 SHOPIFY REVIEW STATUS
App submitted and currently under review. Remaining items to address while waiting:
- [ ] Load testing (app is live on Fly.io — run now)
- [ ] Terms of service page
- [ ] Database indexes
- [ ] Website (confirm if live)

---

## 📦 POST-LAUNCH PRIORITIES

### Phase 1: Critical Differentiators (Weeks 1-4)

**1. Margin Protection - 3 hours**
- Fetch product costs via Shopify Admin API
- Calculate margins per product
- Add "Minimum margin (%)" setting
- AI checks before offering discount
- Don't discount below merchant's margin threshold

**2. Express Checkout Integration - 8 hours**
- Shop Pay button in modal
- Apple Pay detection
- One-click checkout flow
- Multivariate test: with/without express checkout
- Track performance difference

**3. Product Imagery in Modals - 4 hours**
- Fetch cart items with images
- Display first 3 products (50x50px thumbnails)
- Multivariate test: with/without images
- Consider mobile data usage

**4. Variant Tracking / Advanced Analytics - 6 hours**
- Win rate per variant
- Statistical significance indicators
- Revenue attribution
- Confidence intervals
- A/B test duration recommendations
- Variant lifecycle visualization

### Phase 2: Integrations (Weeks 3-6)

**5. Google Analytics Events - 2 hours**
- Track: modal_shown, modal_clicked, modal_closed, discount_applied, conversion
- Push events to GA4
- Custom dimensions: variant_id, discount_amount, cart_value

**6. Klaviyo Integration - 8 hours**
- Push modal interactions to Klaviyo profiles
- Custom events: "Viewed Exit Modal", "Clicked Discount"
- Use for segmentation in Klaviyo flows
- Settings: API key input, event selection

**7. Email Performance Updates (Enterprise) - 6 hours**
- Compare ResparQ vs abandoned cart email recovery rates
- Dashboard widget showing performance comparison
- Metrics: recovery rate, time to conversion, additional revenue
- "6x more effective than emails" messaging

### Phase 3: Nice-to-Have (Weeks 7+)
- Multi-currency support
- Multi-language variants
- Exit intent on product pages
- BFCM/Flash sale mode
- Geolocation-based offers
- Inventory-aware discounts
- Countdown timer variants
- Spin-to-win gamification
- Quiz/survey modals
- NPS score collection
- Customer testimonials in modal
- Free shipping calculator
- Upsell/cross-sell recommendations
- SMS integration
- WhatsApp integration
- Push notification recovery

---

## 🎯 COMPETITIVE POSITIONING

### Main Competitors
- **OptiMonk** - Email focus, $29-99/mo, 300+ templates
- **Wisepops** - Multi-channel, $49-299/mo, advanced personalization
- **Privy** - Email/SMS, $12-45/mo, marketing automation
- **Justuno** - AI recommendations, $59-399/mo, advanced segmentation
- **OptinMonster** - General popup, $9-49/mo, WordPress focus

### ResparQ's Unique Advantages

**1. Performance-First (Not Email-First)**
- ✅ Focus on immediate sales, not email capture
- ✅ No email required (competitors force signup)
- ✅ Auto-applied discounts ← **MAJOR DIFFERENTIATOR**
- ✅ Revenue per impression tracking

**2. Superior AI**
- ✅ 13 customer signals (more than competitors)
- ✅ Auto-generates and tests variants
- ✅ Learns and improves over time
- ✅ Manual intervention controls (unique)

**3. Intelligent Features**
- ✅ Cart monitoring with threshold offers
- ✅ Promotional intelligence (detects site-wide promos)
- ✅ Budget cap enforcement
- ✅ Margin protection (coming)
- ✅ Pure reminder mode (no discount)

**4. Pricing Simplicity**
- ✅ Flat pricing, not pageview-based
- ✅ No surprise bills
- ✅ Unlimited traffic on Pro/Enterprise

### Feature Comparison Matrix
| Feature | ResparQ | OptiMonk | Wisepops | Privy | Justuno |
|---------|---------|----------|----------|-------|---------|
| Focus | Revenue | Email | Multi-channel | Email/SMS | AI Recs |
| No Email Required | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-Applied Discounts | ✅ | ❌ | ❌ | ❌ | ❌ |
| AI Decision Engine | ✅ (13 signals) | ❌ | Limited | ❌ | ✅ |
| Cart Monitoring | ✅ | ❌ | ❌ | ❌ | ❌ |
| Promo Intelligence | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manual Variant Control | ✅ | ❌ | ❌ | ❌ | ❌ |
| Revenue Tracking | ✅ | Limited | ✅ | Limited | ✅ |
| Starting Price | TBD | $29 | $49 | $12 | $59 |

---

## 📈 SUCCESS METRICS

**Week 1 Goals**
- 10 installs
- 5 active merchants
- 0 critical bugs
- <2 hour support response time

**Month 1 Goals**
- 50 installs
- 20 active merchants (using AI mode)
- 10 paid conversions (Pro/Enterprise)
- 4.5+ star rating
- $500 MRR

**Month 3 Goals**
- 200 installs
- 100 active merchants
- 50 paid conversions
- $2,000 MRR
- First case study published

---

## 🚨 KNOWN LIMITATIONS

**Current:**
- No email capture mode (intentional - not our focus)
- Limited to Shopify (no WordPress, WooCommerce, etc.)
- English only (multi-language coming later)
- No SMS recovery (Klaviyo integration will enable)

**Technical Debt:**
- Some components could use refactoring
- Test coverage could be improved
- Documentation needs expansion

---

## 💡 CRITICAL LEARNINGS FROM BUG FIX SESSION

### Database vs Metafields
**Lesson:** Store frequently-accessed data in database, not metafields.

**Why:**
- Modal needs fast API responses (<100ms)
- Metafield queries add 200-500ms latency
- Database queries are 10x faster
- Modal loads on every page view (performance critical)

**What we moved to database:**
- Triggers (exitIntent, timeDelay, cartValue)
- Modal content (headline, body, CTA)
- Discount codes
- Plan and tier information

### Discount Code Architecture
**Lesson:** Always save to database after creating in Shopify.

**Flow:**
1. Create in Shopify (via Admin API)
2. **IMMEDIATELY** save to database
3. API returns from database (not Shopify)
4. Modal applies from database value

**Why this matters:**
- Shopify Admin API is slow (500-1000ms)
- Modal API needs to be fast (<100ms)
- Database is source of truth for modal
- Prevents "promised but not delivered" bugs

### Session-Based Tracking
**Lesson:** Track unique sessions, not total impressions.

**Why:**
- Prevents impression inflation
- More accurate for pricing tiers
- Matches industry standards
- SessionStorage works perfectly for this

**Implementation:**
- Check sessionStorage before showing modal
- Set flag after first impression
- One impression = one unique visitor session
- Reset on browser close or incognito

### Timer Triggers
**Lesson:** Timer should work on ANY page, not just cart page.

**Why:**
- Customers browse multiple pages
- Cart page detection is unreliable
- "After add to cart" is universal trigger
- Works on mobile and desktop

**Implementation:**
- Start timer when cart changes (item added)
- Works on product page, collection page, anywhere
- No page detection needed
- Clean, simple logic

### AI Mode Preview
**Lesson:** Show example copy, not actual AI copy.

**Why:**
- AI generates unique copy per customer
- No "current" copy exists
- Example educates merchants
- Prevents confusion

**What we did:**
- Hardcoded example in dashboard
- Added note: "AI generates unique copy per customer"
- Shows gradient button, modern design
- Professional appearance

---

## 🎯 CURRENT PRIORITIES (While Under Review)

**Do Now:**
1. **Load testing** — App is deployed on Fly.io. Run `load-test.js` with k6. Target: 100 req/s, <500ms, <1% errors
2. **Terms of service page** — Add `/terms` route (same pattern as `/privacy`)
3. **Database indexes** — Review schema for missing indexes on high-traffic queries
4. **Website** — Confirm if `resparq-website` submodule is live

**When Review Passes:**
1. Announce launch
2. Onboard beta testers
3. Monitor Sentry for production errors
4. Watch first installs and conversion data

**Post-Launch (Month 1):**
1. Margin protection
2. Express checkout integration
3. Google Analytics events
4. Klaviyo integration

---

## 📋 IMPORTANT NOTES FOR NEXT SESSION

### Database Schema Changes
We added these fields to Shop model:
```prisma
// Triggers
exitIntentEnabled   Boolean  @default(true)
timeDelayEnabled    Boolean  @default(false)
timeDelaySeconds    Int      @default(30)
cartValueEnabled    Boolean  @default(false)
cartValueMin        Float    @default(0)
cartValueMax        Float    @default(999999)

// Modal Content
modalHeadline       String?  @default("Wait! Don't leave yet 🎁")
modalBody           String?  @default("Complete your purchase now and get an exclusive discount!")
ctaButton           String?  @default("Complete My Order")
redirectDestination String?  @default("checkout")

// Discount
discountCode        String?
discountEnabled     Boolean  @default(false)
offerType           String?  @default("percentage")
```

**Migrations run:**
- `add_trigger_settings`
- `add_modal_content`
- `update_cart_value_max_default`
- `add_discount_code`

### Files with Major Changes
**Critical files modified:**
- `app/routes/app.settings.jsx` - Discount creation, database saves, controlled inputs
- `app/routes/apps.exit-intent.api.shop-settings.jsx` - Returns all settings from database
- `extensions/exit-intent-modal/assets/exit-intent-modal.js` - Timer trigger, discount application
- `app/routes/app._index.jsx` - AI mode preview fix
- `app/utils/featureGates.js` - Starter gets timer trigger

### Testing Notes
**Always test these scenarios:**
1. Manual mode discount (percentage + fixed) ✅
2. AI mode discount (unique codes) ✅
3. Timer trigger (5-10 seconds) ✅
4. Exit intent (move cursor up) ✅
5. Cart value threshold ✅
6. Budget cap (simulate with script) ✅
7. Impression tracking (new sessions) ✅

### Performance Considerations
**Modal must be fast:**
- Target: <100ms API response
- Database queries are faster than metafields
- Cache shop settings in modal (don't refetch)
- Optimize bundle size (<50KB)

### Mobile Notes
**60%+ of traffic is mobile:**
- Timer trigger essential (exit intent doesn't work)
- Touch targets 48px minimum ✅
- Bottom sheet design ✅
- Fast animations ✅
- Swipe to dismiss ✅

---

## 🎯 SESSION SUMMARY (January 15, 2026)

**Bugs Fixed:** 15+
**Features Added:** 4
**Database Fields Added:** 15+
**Files Modified:** 8
**Tests Created:** 2
**Session Duration:** ~4 hours
**Lines of Code Changed:** ~500+

**Impact:**
- ✅ Modal now works reliably
- ✅ Discounts apply correctly (was CRITICAL bug)
- ✅ Timer trigger functional
- ✅ Budget cap verified
- ✅ Dashboard preview fixed
- ✅ Better UX across the board

**Ready for:**
- Custom CSS API implementation
- Settings preview modal
- Final pre-launch polish

---

**Questions? Concerns? Updates?**
Bring this document to your next Claude session for continuity!

**Last Updated:** February 24, 2026
**Status:** 🟡 Under Shopify App Review
**Next Milestone:** Review approval → public launch
**Submitted:** ~February 2026
EOF