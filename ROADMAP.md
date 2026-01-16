cat > ROADMAP.md << 'EOF'
# ResparQ Launch Roadmap
**Updated: January 15, 2026**
**App:** Exit Intent Modal with AI-Powered Cart Recovery

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

## 🎯 PRE-LAUNCH PRIORITIES (DO BEFORE LAUNCH)

### 1. Custom CSS API (Enterprise Only) - 8 hours ⏳
**Why:** Enterprise customers want full control over modal appearance.

**Implementation:**
- Add `customCSS` field to Shop model (Text type)
- Create API endpoint: `app/routes/apps.exit-intent.api.custom-css.jsx`
- Settings UI: Monaco editor, live preview, save/reset buttons
- Modal integration: Fetch and inject CSS into `<style>` tag
- Security: Sanitize CSS, limit 100KB, rate limit

**Important Notes:**
- CSS must use `!important` to override inline styles
- Document this for customers
- Provide example snippets
- Test with brand colors from database

### 2. Settings Preview Modal - 4 hours ⏳
**Why:** Merchants need to see changes before saving.

**Implementation:**
- Clicking "Show Preview" opens actual modal overlay
- Use current form values (headline, body, CTA)
- Show with current brand colors
- Responsive preview (desktop + mobile)
- Close button functional
- Don't track as impression

**Dashboard preview is done** ✅ - Just need settings preview

### 3. Misc Bugs Cleanup - varies ⏳
**Action:** Investigate and fix remaining bugs

**To Check:**
- [ ] Plan navigation/persistence (#2)
- [ ] Any console errors?
- [ ] Mobile rendering issues?
- [ ] Form validation errors?
- [ ] Edge cases in AI decision logic?
- [ ] Date filter edge cases?
- [ ] Pagination bugs?

**Test Checklist:**
- [ ] All tier gates working (Starter/Pro/Enterprise)
- [ ] All forms submit correctly
- [ ] No React hydration errors
- [ ] All database queries optimized
- [ ] No N+1 queries
- [ ] All webhooks processing correctly
- [ ] Modal shows/hides properly on all pages

### 4. Create Website - external project 🌐
**Platform:** Webflow, Framer, or Next.js

**Pages Needed:**
- Homepage (hero, features, pricing, CTA)
- Pricing
- Features breakdown
- Case studies/testimonials (post-launch)
- Documentation/Help center
- Blog (optional)

**Key Messaging:**
- "Exit intent that drives sales, not signups"
- "Performance-first modals for merchants who want revenue, not subscribers"
- "AI-powered cart recovery that converts in seconds, not days"

**Differentiators:**
- No email required (unlike competitors)
- Auto-applied discounts (unlike competitors)
- AI learns from 13+ signals (more than competitors)
- Promotional intelligence (unique)
- Flat pricing, not pageview-based (simpler)

### 5. Update Upgrade Page - 1 hour ⏳
**File:** `app/routes/app.upgrade.jsx`

**Update:**
- Clear tier comparison table
- Feature list per tier
- Pricing (decide on flat vs usage-based)
- "Current plan" indicator
- Upgrade CTA buttons
- FAQ section

**Pricing Suggestions:**
- **Starter:** $29/mo (1,000 sessions/month, manual mode, basic triggers)
- **Pro:** $79/mo (10,000 sessions/month, AI mode, all triggers, analytics)
- **Enterprise:** $199/mo (unlimited sessions, manual controls, promo intelligence, custom CSS, priority support)

---

## 🚀 DEPLOYMENT & LAUNCH CHECKLIST

### BEFORE DEPLOYING TO PRODUCTION

**1. Load Testing - 2 hours** 🔴 MUST DO BEFORE LAUNCH
- **Why:** Prevent Black Friday disasters
- **Tool:** k6 (https://k6.io)
- **Targets:** 100 req/s sustained, 500 req/s peak, <500ms response, <1% errors
- **What to test:**
  - `/apps/exit-intent/api/ai-decision` (most critical)
  - `/apps/exit-intent/api/enrich-signals`
  - Settings page load
  - Order webhook processing
- **Prerequisites:** App must be deployed first (cannot test localhost)
- **Files included:** `load-test.js`, `LOAD_TESTING.md`, `PERFORMANCE_CHECKLIST.md`
- **Red flags:** p(95) > 1000ms, Error rate > 5%, DB connection errors

**Pre-deployment optimizations:**
- [ ] Add database indexes
- [ ] Verify pagination on all lists
- [ ] Check for N+1 queries
- [ ] Optimize API responses (only needed fields)

### DEPLOYMENT STEPS
- [ ] Pre-deployment optimizations complete
- [ ] Database indexes added
- [ ] Load testing passed
- [ ] Error monitoring configured
- [ ] All bugs fixed
- [ ] Mobile optimization verified
- [ ] Website live

### TECHNICAL LAUNCH CHECKLIST
- [ ] Error monitoring (Sentry)
- [ ] Mobile-first modal design
- [ ] Load testing completed ← DO THIS AFTER DEPLOYING
- [ ] All bugs fixed
- [ ] Database optimized
- [ ] API rate limiting
- [ ] Security audit
- [ ] GDPR compliance check

### FEATURES
- [ ] AI decision engine
- [ ] Manual intervention controls
- [ ] Order tracking
- [ ] Analytics with date filtering
- [ ] Promotional intelligence
- [ ] Custom CSS API (Enterprise)
- [ ] Mobile optimization
- [ ] Discount code system ✅

### CONTENT
- [ ] Website live
- [ ] Help documentation
- [ ] Video tutorials
- [ ] Email templates (onboarding)
- [ ] Support responses templated

### BUSINESS
- [ ] Pricing finalized
- [ ] Payment processing set up (Shopify billing)
- [ ] Terms of service
- [ ] Privacy policy
- [ ] Support process defined
- [ ] Upgrade page updated

### MARKETING
- [ ] App Store listing optimized
- [ ] Screenshots ready
- [ ] Demo video
- [ ] Social media accounts
- [ ] Launch announcement drafted
- [ ] Beta testers lined up

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

## 🎯 NEXT SESSION PRIORITIES

**Immediate (This Week):**
1. ✅ Settings preview modal - Make "Show Preview" actually work
2. ✅ Custom CSS API (Enterprise) - 8 hours
3. ✅ Bug #2 investigation - What's the plan persistence issue?
4. ✅ Update upgrade page - Quick win, 1 hour

**Before Launch (Next 2 Weeks):**
1. Load testing (AFTER deployment)
2. Website launch
3. Help docs
4. App Store listing

**Post-Launch (Month 1):**
1. Margin protection
2. Express checkout
3. Google Analytics
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

**Last Updated:** January 15, 2026
**Status:** Pre-Launch Phase - Major bug fixes complete!
**Next Milestone:** Custom CSS API + Settings Preview Modal
**Launch Target:** Late January 2026
EOF