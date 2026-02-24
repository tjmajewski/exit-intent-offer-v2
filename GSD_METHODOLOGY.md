# GSD (Get Shit Done) Methodology Guide
**For ResparQ — Exit Intent Offer v2**

---

## What Is GSD?

GSD is a no-bullshit productivity philosophy built around one principle: **momentum beats perfection**.

It rejects:
- Over-planning features that haven't shipped yet
- Endless refactoring before there are paying customers
- Bikeshedding color choices while core bugs exist
- Writing documentation nobody reads
- "We'll fix it properly later" blocks that become permanent

It embraces:
- Shipping working code fast
- Fixing real problems in priority order
- Time-boxing decisions
- Done beats perfect

---

## The 5 GSD Principles

### 1. Prioritize by Impact, Not Comfort

Work on the thing that unblocks the most, not the thing you feel like doing.

| Not GSD | GSD |
|---------|-----|
| Polishing the upgrade page UI | Fixing the plan persistence bug (#2) that breaks merchant experience |
| Adding gamification modals | Getting the settings preview modal working |
| Writing post-launch integration docs | Completing the pre-launch checklist |

**For ResparQ right now:** The ROADMAP has a clear pre-launch priority list. Start at the top. Don't skip to the fun stuff.

---

### 2. Time-Box Everything

Every task gets a time budget. When time runs out, ship what you have or cut scope — don't extend indefinitely.

ROADMAP already has estimates. Use them:
- Custom CSS API → 8 hours
- Settings Preview Modal → 4 hours
- Upgrade Page → 1 hour

If you hit the limit and it's not done: **scope down, ship partial, iterate.**

---

### 3. Bias for Action

When you hit a decision, pick one and move. You can always change it later.

Examples:
- Pricing not finalized? Pick a number. You can change it.
- Not sure which website platform? Pick Webflow. Ship it. You can migrate.
- A/B test unclear? Pick the variant with more data. Ship it.

**Stuck = expensive.** A wrong decision that ships beats a correct decision stuck in planning.

---

### 4. Eliminate Blockers First

Before writing new code, ask: "Is there something already blocking a user or blocking launch?"

The bug that prevents a merchant from saving settings is more important than the new feature that makes the dashboard prettier.

**ResparQ Blocker Priority Order:**
1. Bugs that break merchant experience (settings not saving, modals not showing)
2. Bugs that break customer experience (discounts not applying)
3. Missing pre-launch requirements (load testing, website)
4. Nice-to-have polish (preview modal, upgrade page copy)
5. Post-launch features

---

### 5. Done Is Deployable

"Done" means **deployed and working**, not "coded and waiting for review."

A feature that sits in a branch for two weeks isn't done. A rough feature that merchants can use today is.

---

## How To Apply GSD to This Project

### Step 1: Use the Existing Prioritization

The ROADMAP already has this ordered correctly. Follow it:

```
PRE-LAUNCH (do these in order):
1. Custom CSS API (Enterprise)
2. Settings Preview Modal
3. Bug #2 investigation + misc cleanup
4. Update Upgrade Page
5. Website
6. Load testing (after deploy)
```

**Don't invent a new priority order. The work is already scoped.**

### Step 2: One Thing At a Time

Pick the top item. Start it. Finish it. Mark it done. Move to the next.

Don't split focus between the upgrade page and the CSS API at the same time. Partial progress on two things = nothing ships.

### Step 3: Define "Done" Before You Start

Before touching Custom CSS API:
- [ ] `customCSS` field in schema
- [ ] API endpoint returns it
- [ ] Settings UI lets merchant paste CSS
- [ ] Modal injects it
- [ ] Basic sanitization in place

That's done. Ship it. Don't add syntax highlighting, undo history, or example snippets until merchants ask for them.

### Step 4: Ship Small Commits Often

Don't accumulate 3 days of changes in one commit. Each logical unit of work gets its own commit:

```bash
# Good
git commit -m "Add customCSS field to Shop model"
git commit -m "Create custom-css API endpoint"
git commit -m "Add CSS editor to enterprise settings UI"

# Not GSD
git commit -m "WIP: CSS stuff and also fixed some things and updated a few pages"
```

### Step 5: Test the Actual Launch Criteria

The real checklist before launch (from ROADMAP):

**Technical:**
- [ ] Load testing: 100 req/s sustained, <500ms, <1% errors
- [ ] All critical bugs fixed
- [ ] Database indexes added
- [ ] Sentry error monitoring live

**Business:**
- [ ] Pricing finalized
- [ ] Billing configured (Shopify billing API)
- [ ] Terms of service + privacy policy
- [ ] App Store listing complete with screenshots

**Content:**
- [ ] Website live
- [ ] At least basic help documentation

Don't launch missing items from this list. Everything else is post-launch.

---

## Common GSD Anti-Patterns to Avoid

### The "One More Feature" Trap
> "The app is ready but let me just add Klaviyo integration before launch."

No. Klaviyo is on the post-launch roadmap. Ship first. Integrate later.

### The "Perfect Architecture" Trap
> "Let me refactor the AI decision engine before adding the CSS API."

No. Refactor when the code is causing actual bugs or slowing development. Not before.

### The "We Need More Data" Trap
> "We're not sure about pricing so let's do more market research."

You have the competitor matrix in ROADMAP. Pick $29/$79/$199. Ship. Adjust after first 10 customers.

### The Yak Shave
> "Before I write the load test I need to set up a proper staging environment, and before that I need to..."

Stop. Load testing requires the app deployed. Deploy first. Then test.

---

## GSD Sprint Format for ResparQ

For each work session:

```
1. Open ROADMAP.md
2. Find the first unchecked pre-launch item
3. Define what "done" means for that item
4. Set a time budget
5. Execute
6. Commit when each logical unit is complete
7. Mark checklist item done in ROADMAP
8. Repeat
```

No status meetings. No lengthy planning. The ROADMAP is the plan.

---

## Pre-Launch GSD Checklist

Copy this, work through it top to bottom:

**This Week:**
- [ ] Fix bug #2 (plan navigation/persistence) — investigate + ship fix
- [ ] Settings preview modal — clicking "Show Preview" works
- [ ] Custom CSS API — end-to-end working for Enterprise

**Before Deploy:**
- [ ] Upgrade page updated (pricing, features, CTAs)
- [ ] Database indexes added (check for N+1 queries)
- [ ] No critical console errors

**After Deploy:**
- [ ] Load test passes (k6, 100 req/s, <500ms)
- [ ] Sentry showing 0 critical errors

**Before App Store Listing:**
- [ ] Website live (even a one-page landing is enough)
- [ ] Pricing page done
- [ ] Screenshots taken (5-7 quality screenshots)
- [ ] Short demo video (2 minutes max)

**Legal/Business:**
- [ ] Terms of service (use a template, don't write from scratch)
- [ ] Privacy policy (use a template)
- [ ] Shopify billing API configured

---

## The Bottom Line

ResparQ is 90% ready to launch. The remaining 10% is a defined list of tasks in ROADMAP.md.

**GSD means:** open that list, start at the top, don't stop until every item is checked.

No new features. No refactoring. No "just one more thing."

Ship. Learn. Iterate.

---

**Last Updated:** February 2026
