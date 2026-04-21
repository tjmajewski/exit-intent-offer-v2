# Pro vs Enterprise - Feature Comparison
**Last Updated:** April 21, 2026

---

## Quick Comparison Table

| Feature | Pro | Enterprise |
|---------|-----|------------|
| **Price** | $79/mo | $299/mo |
| **AI Evolution** | ✅ Full system | ✅ Full system |
| **Thompson Sampling** | ✅ | ✅ |
| **Champion Detection** | ✅ | ✅ |
| **Budget Caps** | ✅ | ✅ |
| **Social Proof** | ✅ | ✅ |
| **Revenue/Conversion Modes** | ✅ | ✅ |
| **Network Meta-Learning** | ✅ | ✅ |
| **Archetype Priors (segment-aware bias)** | ✅ Limited (2 variants) | ✅ Full per-segment routing |
| **Adaptive Intervention Thresholds** | ✅ | ✅ |
| **5% Holdout / Incrementality** | ✅ | ✅ |
| **Manual Variant Controls** | ❌ | ✅ |
| **Evolution Settings Control** | ❌ | ✅ |
| **Device-Specific Evolution** | ❌ | ✅ |
| **Brand Safety Validation** | ❌ | ✅ |
| **Promotional Intelligence (Active)** | ❌ Detect Only | ✅ Auto-Adjust |
| **Advanced Analytics** | ❌ | ✅ |

---

## Pro Tier ($79/mo)

### What You Get

✅ **Full Evolutionary AI**
- Automatic variant creation and testing
- Thompson Sampling for optimal selection
- Champion detection (70/30 split)
- Bayesian statistics for confident decisions

✅ **AI Optimization Settings**
- Choose goal: Revenue or Conversion mode
- Discount aggression slider (0-10)
- Budget caps with automatic enforcement

✅ **Social Proof**
- Automatic data collection from Shopify
- Dynamic insertion in modal copy
- Merchant control over thresholds

✅ **Network Meta-Learning**
- New stores inherit proven genes
- Faster initial performance
- Contribute to network (opt-out available)

✅ **Archetype Priors — Limited**
- AI selection is biased toward archetypes that win for the visitor's segment
- With 2 variants, this is meaningful only when they represent *different* archetypes (e.g. one Threshold Discount + one Soft Upsell): the AI routes ~70/30 by segment instead of pure A/B
- When both variants share an archetype, the prior map is empty and standard A/B testing resumes

✅ **Adaptive Intervention Thresholds**
- Per-store learning of whether to show or skip the modal
- Thompson Sampling per propensity score bucket
- Optimizes for profit (revenue minus discount cost)
- Natural conversion tracking for "skip" decisions
- Gets smarter with every visitor interaction

✅ **Promotional Intelligence (Detection)**
- Detects site-wide promotions
- Shows warning in dashboard
- **Does NOT automatically adjust** (manual only)

### What You Control

- AI Goal (Revenue vs Conversion)
- Aggression level (0-10)
- Budget amount and period
- Social proof on/off and thresholds

### What's Automatic

- All variant creation
- All testing decisions
- All evolution cycles
- Champion selection
- Gene mutations and crossover

### Limitations

- **No manual variant controls** - Can't kill/protect/champion specific variants
- **Standard evolution settings** - Mutation 15%, Crossover 70%, Pressure 5/10, Pop 10
- **Promo detection only** - Shows warning but doesn't auto-adjust strategy
- **Single evolution pool** - Mobile and desktop variants evolve together
- **No brand safety** - AI can create any copy from gene pools
- **Archetype routing is binary** - With only 2 active variants, the AI can route between *at most* two archetypes. Enterprise stores running 10–20 variants get genuine per-segment routing across many archetypes simultaneously.

---

## Enterprise Tier ($299/mo)

### Everything in Pro, PLUS:

### 1. Manual Variant Controls

**Kill Variant**
- Remove a variant immediately
- Use case: Copy is off-brand or problematic
- Example: Variant uses wrong tone → Kill it

**Protect Variant**
- Prevent variant from being killed by evolution
- Use case: Want to test longer before culling
- Example: New variant needs more data → Protect for 7 days

**Force Champion**
- Manually promote a variant to Champion status
- Use case: Running a specific promotion
- Example: Black Friday sale → Champion the 25% off variant

### 2. Advanced Evolution Controls

**Innovation Speed (Mutation Rate): 0-100%**
- Default: 15%
- Low (5%): Slow, steady improvements
- High (50%): Radical experimentation, less stability
- What it controls: How often genes randomly change

**Learning Strategy (Crossover Rate): 0-100%**
- Default: 70%
- Low (30%): More random exploration, less mixing
- High (90%): More blending of winners
- What it controls: How much parent genes are mixed

**Quality Standards (Selection Pressure): 1-10**
- Default: 5
- Low (2): Patient, keeps underperformers longer
- High (9): Ruthless, kills poor performers quickly
- What it controls: Bayesian confidence threshold (70%-99%)

**Test Group Size (Population): 5-20**
- Default: 10
- Small (5): Faster convergence, less diversity
- Large (20): More exploration, slower convergence
- What it controls: How many variants alive simultaneously

### 3. Device-Specific Evolution

**Separate pools for mobile vs desktop:**
- Mobile visitors see mobile-optimized variants
- Desktop visitors see desktop-optimized variants
- Different Champions for each device
- Accounts for different behavior patterns

**Why it matters:**
- Mobile users scroll differently
- Desktop users read more copy
- Different conversion rates by device
- Optimizes for each experience separately

### 4. Brand Safety Validation

**Automatic copy validation:**
- Checks headlines/subheads/CTAs against brand guidelines
- Rejects variants that violate rules
- Automatically re-breeds until compliant

**Customizable rules:**
```javascript
{
  forbiddenWords: ['cheap', 'limited', 'act now'],
  requiredTone: 'professional',
  maxExclamations: 1,
  allowEmoji: false
}
```

**Example:**
- AI creates: "ACT NOW!!! Get 25% OFF CHEAP!!!"
- Brand safety: ❌ Violation - too many exclamations, uses "cheap"
- AI re-breeds until: "Save 25% on your order today"

### 5. Promotional Intelligence (Active)

**Auto-detects site-wide promos:**
- Scans for discount codes active site-wide
- Tracks: Code, amount, expiration

**Notification System:**
- Notification badge in sidebar showing unseen promotions count
- Notification banner on promotions page for new detections
- Dashboard widget showing active promotions summary (up to 3)
- "Seen" status tracking for each promotion

**Three strategies (merchant chooses):**

**A. Pause AI**
- Stops showing modals during promo
- Avoids discount stacking
- Use case: Black Friday sale already live

**B. Increase Offers**
- AI automatically beats promo by 5%+
- Example: 20% site-wide → AI offers 25%+
- Use case: Want exit intent to beat regular promo

**C. Merchant Override**
- Custom aggression during promo
- Example: Set aggression to 8 during sale
- Use case: Manual control of strategy

**D. Ignore Promo**
- Continue normal operation
- Use case: Small discount doesn't affect strategy

**Performance Metrics:**
- Shows revenue impact for each promotion
- Smart recommendations based on discount levels:
  - High discount (30%+): Suggests pausing to avoid margin erosion
  - Moderate discount (20-30%): Suggests reducing offers
  - Low discount (<20%): Suggests continuing normal operation

**Feature Toggle:**
- Enable/disable promotional intelligence
- Persists merchant preference
- Shows warning banner when disabled

**Pro Tier Alternative:**
- Detects promo and shows warning
- Merchant manually adjusts settings
- No automatic strategy changes
- No notification system or dashboard widget

### 6. Performance Intelligence Dashboard (formerly "Variants")

The page lives at `/app/variants` and is structured as **three tabs** plus a "Manage Variants" link.

**Top stat cards:**
- **Winning Archetype** — top-ranked archetype by CVR for the current filter window, with a tooltip explaining what an archetype is
- **Best Segment** — composite segment with the highest CVR (≥20 imps), formatted as e.g. "mobile · paid · guest · product · first"
- **Active Variants** / **Max Generation**

**Filter row** (URL-driven so filters survive auto-refresh):
- Time window: 7 days / 30 days / 90 days
- Archetype dropdown (only archetypes with ≥10 imps shown)
- Page Type dropdown (only pages with observed data)
- Modal-offer dropdown: All modals / Modals with a promo / Modals without a promo
- Customer segment dropdown (device, account, visitor type, cart value, traffic source)

**Tab 1 — Archetypes** (default):
- Ranked card grid showing each archetype's CVR, CTR, and RPI
- Top card gets a green WINNER badge globally
- When the user narrows by segment AND there's ≥0.5pt CVR spread, the top card flips to an amber **★ PROMOTED** badge and the bottom card gets a red ↓ DEMOTED badge
- Banner above the grid explains: "AI is promoting {archetype} for {filterDescription}. Selection is biased 1.30× toward rank #1 and 0.85× toward rank #N. Exploration is preserved — Thompson Sampling still runs."

**Tab 2 — Component Analysis** (existing):
- Side-by-side columns showing top Headlines, Subheads, and CTAs
- Performance tier indicators (Elite/Strong/Average/Poor) based on revenue
- Click any component to view full variant details in modal

**Tab 3 — Segments**:
- Heatmap matrix: top 15 segments (rows) × ranked archetypes (columns)
- Each cell shows CVR % and impression count for that archetype × segment combo
- Divergent green/red coloring around per-row median CVR
- Amber outline on the AI-promoted archetype for each row
- Cells with <5 impressions are dimmed (low confidence)

**Auto-refresh:** every 30 seconds (toggle), preserves all current filters via URL params.

**Value Insights:**
- Visual indicators show which copy drives the most revenue
- "vs Average" metric highlights top performers
- Easy identification of winning headlines, subheads, and CTAs
- Revenue impact displayed in absolute dollars

**Pro Tier Alternative:**
- No access to Variant Performance page
- Limited to basic analytics dashboard

### 7. Additional Advanced Analytics

**Variant Lineage Tracking**
- See parent-child relationships
- Track which genes perform best
- Visualize evolution tree

**Segment Performance**
- Break down by device, traffic source
- Compare mobile vs desktop Champions
- See which segments convert best

**Gene-Level Analysis**
- Which headlines convert best?
- Which CTAs get clicked most?
- Which offer amounts maximize profit?

**A/B Test Confidence**
- Bayesian probability charts
- Confidence intervals
- Lift calculations

---

## Should You Upgrade to Enterprise?

### Upgrade if:

✅ **You want control** - Manually kill/protect/champion variants  
✅ **You run promotions** - Need automatic strategy adjustment  
✅ **You're brand-conscious** - Need copy validation  
✅ **You're sophisticated** - Want to tune evolution parameters  
✅ **You have high traffic** - Device-specific evolution pays off  
✅ **You're analytical** - Want deep performance insights  

### Stay on Pro if:

✅ **You prefer "set it and forget it"** - AI runs autonomously  
✅ **You don't run many promotions** - Or happy adjusting manually  
✅ **You trust the AI completely** - Default settings work well  
✅ **You're budget-conscious** - $79/mo is plenty  
✅ **You have moderate traffic** - Single evolution pool is fine  

---

## Migration Path

**Upgrading Pro → Enterprise:**
- All variants preserved
- Evolution continues seamlessly
- New controls unlock immediately
- No data loss

**Downgrading Enterprise → Pro:**
- Variants preserved
- Manual overrides removed
- Evolution settings reset to defaults
- Device-specific pools merged

---

## ROI Calculation

**Enterprise pays for itself if:**

Scenario 1: **Promotional Intelligence**
- Run 4 promos/year
- Each promo: $50k revenue
- Without Enterprise: Stack discounts, lose 5% margin = $10k lost
- With Enterprise: Auto-adjust strategy, save $10k
- **ROI: 4 promos × $10k = $40k saved > $2,640 Enterprise cost**

Scenario 2: **Brand Safety**
- 1 off-brand variant goes viral on social
- PR damage, brand reputation hit
- Cost to brand: $50k+ in lost trust
- With Enterprise: Prevented automatically
- **ROI: 1 prevented incident > $2,640/year**

Scenario 3: **Device Optimization**
- 60% mobile traffic, 40% desktop
- Mobile Champion: 3% CVR, Desktop Champion: 5% CVR
- Without Enterprise: Blended 3.8% CVR
- With Enterprise: Device-specific 4.2% CVR
- **ROI: 10% lift on $100k revenue = $10k > $2,640/year**

---

## Feature Request Roadmap

**Coming to Pro Soon:**
- Visual gene evolution (colors, layouts)
- Multi-language support
- Threshold offer optimization

**Enterprise Exclusives (Planned):**
- AI-powered image selection
- Video modal support
- Advanced segmentation (repeat buyers, VIPs)
- Predictive LTV-based strategies

