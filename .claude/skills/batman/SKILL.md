---
name: batman
description: Resparq cold outreach runner. Use when Taylor says "the bat signal is on", "bat signal", or invokes /batman - generates the next 12 prospect emails as a PowerPoint deck, saves it to the Resparq Outreach folder and opens it. Also use when he reports back who he emailed, who replied, or who said no, so the sends get recorded and follow-ups schedule themselves. Also use when he says he needs to make an update to Batman, which means editing this skill.
---

# Batman

Cold outreach for Resparq. Everything lives in `prospecting/` in
`/Users/taylormajewski/exit-intent-offer-v2`.

Three things trigger this skill, and they are different jobs. Work out which
one is being asked before doing anything.

---

## 1. "The bat signal is on" - generate the next batch

Run from the repo root. If the working directory is elsewhere, `cd` there first.

### Step 1: see where the pipeline stands

```bash
node prospecting/draft-emails.mjs --status
```

Read the counts. `followup-due` leads will be mixed into this batch
automatically; nothing extra is needed for them.

### Step 2: decide whether the source data is stale

```bash
ls -t prospecting/out/scan-*.json | head -1
```

If the newest scan is **more than 7 days old**, or `--status` shows fewer than
12 eligible leads, refresh the pool first. Tell Taylor this is happening,
because it takes a few minutes:

```bash
node prospecting/scrape-app-reviews.mjs --pages 3
node prospecting/scan-stores.mjs prospecting/out/reviews-<newest>-domains.txt
```

Otherwise skip straight to step 3. Do not refresh out of habit; a rescan of
unchanged stores buys nothing.

### Step 3: pick up any contacts added since last time

```bash
node prospecting/find-contacts.mjs
```

Cheap, and it catches rows Taylor pasted into `contacts.csv` by hand.

### Step 4: build the deck

```bash
node prospecting/draft-emails.mjs --pptx --limit 12
```

### Step 5: deliver it

Copy to the Outreach folder under a dated name, then open it:

```bash
cp "$(ls -t prospecting/out/drafts-*/outreach.pptx | head -1)" \
   ~/Desktop/Resparq/Outreach/outreach-$(date +%Y-%m-%d).pptx
open ~/Desktop/Resparq/Outreach/outreach-$(date +%Y-%m-%d).pptx
```

If a file for today already exists, add `-2`, `-3` and so on rather than
overwriting one he may already be working through.

### Step 6: report

List the 12 leads with score and scenario. Call out specifically:

- how many are follow-ups rather than first contacts
- how many still need a contact found
- any lead whose catalogue could not be priced, since its email has no
  concrete line in it

---

## 2. Taylor reports who he contacted

He will name stores in prose. Map each to its domain and record it. One
command per domain, and the domain must be bare, with no angle brackets:

```bash
node prospecting/draft-emails.mjs --sent kayladevitoart.com
```

Use the right verb for what he actually says:

| He says | Command |
|---|---|
| emailed / reached out / sent | `--sent` |
| they replied / got a response / they're interested | `--replied` |
| not interested / said no / bounced / dead | `--dead` |

`--replied` and `--dead` are the only thing preventing a third email to
someone who already answered or declined. If he mentions a reply in passing
while reporting sends, record it.

If a store he names is not obviously one of the tracked domains, ask rather
than guessing. Recording a send against the wrong domain silently removes the
right one from the pool.

Afterwards confirm what was recorded and when each follow-up comes due.

---

## 3. "I need to make an update to Batman"

He wants this file changed. Ask what should be different, edit
`.claude/skills/batman/SKILL.md`, and commit it. Do not change the pipeline
scripts under the guise of a Batman update unless he asks for that too.

---

## Rules that do not bend

- **Never send email.** This drafts only. There is no SMTP path in the
  scripts and none should be added. Sending stays Taylor's action.
- **Never invent performance claims.** One store is live: three recovered
  checkouts, roughly $3,000 attributed, and no measured lift because its
  volume has not cleared the holdout gate. Attributed is not causal. No uplift
  percentages, no conversion averages, no testimonials, no customer counts.
  The templates already handle this; do not "improve" them past it.
- **The ledger only advances when a batch is actually produced.** Previewing
  costs nothing, so preview freely.
- **Work on `main`.** No branches, no worktrees, no PRs.
- **Commit and push** after any change to the scripts or this skill.
