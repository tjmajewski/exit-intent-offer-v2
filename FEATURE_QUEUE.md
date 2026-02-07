# Feature Queue — ResparQ

> **Purpose:** This is the task queue for the next Claude instance. Pick the top unchecked item, read its spec file, and build it. Check it off when done.
>
> **Rule:** Do NOT push code changes while Shopify is reviewing the app. Only docs/planning until review is complete.
>
> **Review Status:** Pending Shopify approval
> **Last Updated:** February 7, 2026

---

## Queue (in priority order)

### 1. Customer Onboarding Experience
- [ ] **Dashboard setup checklist** — Dismissible 5-step card on the Dashboard that guides new merchants from install to first live modal
- [ ] **Getting Started page** — New `/app/getting-started` route with reference guide, accordion FAQ sections, and quick-start steps
- [ ] **Sidebar nav update** — Add "Getting Started" link between Dashboard and Settings in `AppLayout.jsx`

**Spec file:** `ONBOARDING_PLAN.md`
- Exact checklist steps with completion detection logic
- Component props, file creation list, files to modify
- UI design tokens matching existing app style
- What NOT to build (no email drips, no wizards, no videos)

---

### 2. Smarter "Don't Show" Modal Logic
- [ ] **Suppress when customer just added item** (< 10 seconds ago)
- [ ] **Suppress on product pages** (only show on cart/checkout)
- [ ] **Suppress for previous ResparQ converters** (cookie/localStorage flag)
- [ ] **Suppress when customer arrived with email discount code** (UTM param check)

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #6
- All client-side checks in `exit-intent-modal.js` before calling API
- High impact, low effort — no backend changes needed

---

### 3. Segment-Aware Variant Selection
- [ ] **Define segments** (new_visitor, returning_browser, loyal_customer, price_sensitive, high_value_cart, mobile_shopper, paid_traffic)
- [ ] **Compute segment from signals** in AI decision endpoint
- [ ] **Filter Thompson Sampling by segment** so variants optimize per-audience
- [ ] **Track per-segment performance** in VariantImpression table

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #1
- Files: `variant-engine.js`, `ai-decision.server.js`, `exit-intent-modal.js`, `apps.exit-intent.api.ai-decision.jsx`
- VariantImpression table already has `segment` column

---

### 4. Copy Personalization Tokens
- [ ] **Add new placeholders** (`{{cart_item_name}}`, `{{customer_first_name}}`, `{{cart_total}}`, `{{cart_item_count}}`, `{{savings_amount}}`)
- [ ] **Add personalized headline/subhead variants** to gene pools
- [ ] **Expand replacement logic** in `showModalWithOffer()` with fallback for missing data (e.g., guest users)

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #2
- Cart data already available from `/cart.js` call
- Customer name from `window.Shopify.customer.first_name`
- Files: `gene-pools.js`, `exit-intent-modal.js`

---

### 5. Profit-Optimized Discounting
- [ ] **Add "Average Margin" merchant setting** (default 50%)
- [ ] **Factor margin into offer calculation** — don't offer 20% on a 30% margin product
- [ ] **Weight PPI (profit per impression) higher** in Thompson Sampling fitness
- [ ] **Track discountAmount on every converting VariantImpression**

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #7
- New field: `averageMargin` on Shop model in `prisma/schema.prisma`
- Files: `ai-decision.server.js`, `variant-engine.js`, `app.settings.jsx` (AI Settings tab)

---

### 6. Discount Escalation (2-Step Offers)
- [ ] **First dismiss → flag, don't session-block**
- [ ] **Second exit intent → escalated offer** (+5%, different urgency copy)
- [ ] **Max 2 shows per session**, track escalation conversion separately
- [ ] **Add escalation gene pool** with "last chance" copy variants
- [ ] **Gate behind aggression >= 5** (conservative merchants opt out)

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #3
- Files: `exit-intent-modal.js`, `gene-pools.js`, `ai-decision.server.js`

---

### 7. Time-of-Day & Day-of-Week Optimization
- [ ] **Add hourOfDay and dayOfWeek to signals**
- [ ] **Store time data in VariantImpression** (new columns or JSON field)
- [ ] **Calculate conversion rate multipliers** per time bucket after 2+ weeks of data
- [ ] **Adjust score in `determineOffer()`** — reduce discount during peak, increase during slow

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #4
- Time buckets: morning/afternoon/evening/late-night, weekday/weekend
- Files: `exit-intent-modal.js`, `ai-decision.server.js`, `prisma/schema.prisma`

---

### 8. Product Category Awareness
- [ ] **Parse product_type, tags, title, price** from `/cart.js` response
- [ ] **Send cartComposition signal** to AI decision endpoint
- [ ] **Adjust strategy by category** (consumables → "stock up", gifts → urgency, sale items → smaller discount)
- [ ] **Reference most expensive item** in personalized copy

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #5
- `/cart.js` already returns full product data per line item
- Files: `exit-intent-modal.js`, `ai-decision.server.js`

---

### 9. Cross-Store Meta-Learning (Long-term)
- [ ] **Aggregate anonymized variant performance** across stores
- [ ] **Push data after each evolution cycle** (contributing stores only)
- [ ] **Pull meta-learned priors for new stores** — bootstrap Thompson Sampling
- [ ] **MetaLearning table** in database

**Spec file:** `AI_IMPROVEMENTS_PLAN.md` → Section #8
- `contributeToMetaLearning` flag already exists in shop settings
- `meta-learning.js` already exists but needs implementation
- Files: `meta-learning.js`, `evolution-cycle.js`, `variant-engine.js`, `prisma/schema.prisma`

---

## Reference Docs

| Doc | What it covers |
|-----|---------------|
| `ONBOARDING_PLAN.md` | Customer onboarding UX — checklist + Getting Started page |
| `AI_IMPROVEMENTS_PLAN.md` | 8 AI improvements with implementation details per section |
| `AI_SYSTEM_COMPLETE_GUIDE.md` | Current AI architecture — evolution, Thompson Sampling, gene pools |
| `AI_TECHNICAL_ARCHITECTURE.md` | Technical details of AI decision flow |
| `AI_PRO_VS_ENTERPRISE.md` | Differences between Pro and Enterprise AI |
| `DEVELOPER_ONBOARDING.md` | Dev environment setup and codebase walkthrough |
| `DEPLOYMENT_GUIDE.md` | Fly.io deployment, env vars, production config |
| `DATABASE_SCHEMA.md` | Prisma schema reference |

---

## Instructions for Claude

1. Read this file first
2. Pick the top unchecked item
3. Read its spec file for implementation details
4. Build it, commit, push to your working branch
5. Tell the user to merge with: `git fetch origin <branch> && git checkout main && git merge origin/<branch> --no-edit && git push origin main`
6. Check off completed items in this file and push the update
7. Move to the next item
