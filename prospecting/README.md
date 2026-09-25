# Prospecting

Cold-outreach tooling. Nothing here touches the Shopify app or the database.

## scan-stores.mjs

Given domains, answers: is it Shopify, what does the catalog cost, and which
email-capture / exit-intent vendor is already on the page.

```
node prospecting/scan-stores.mjs prospecting/domains.txt
node prospecting/scan-stores.mjs somestore.com anotherstore.com
```

Writes `prospecting/out/scan-<date>.json` and `.csv`.

Only public pages are fetched (homepage HTML and `/products.json`), one request
at a time per store with a delay. No keys, no paid data.

### Reading the output

`medianPrice` is the median of each product's cheapest variant. It is an **AOV
proxy, not AOV** — real AOV depends on cart size and mix. It is still the right
sorting key, because the pitch is per-order: `paybackMonths` is how many months
of Resparq one recovered order at that price would cover.

`vendors` and `exitIntentCapable` come from script signatures in the HTML. That
means the store *could* run exit intent, **not that it does**. Plenty of stores
load Klaviyo or Attentive and never turn on an exit trigger. Confirming an
actual popup needs a real browser, which is a separate later step.

`discountHints` is regex over homepage copy. Useful colour for a draft email,
not a measurement.

`currency` matters more than it looks. `/products.json` returns prices in the
shop's own currency and carries no currency field, so a Colombian store shows a
median of 75000. `paybackMonths` is therefore only computed for USD stores;
everything else gets `paybackNote` instead. Never quote a price from a row
whose currency is not USD without converting it first.

### Scenarios

| Scenario | Meaning |
|---|---|
| `E_HIGH_AOV_GREENFIELD` | No vendor, median price >= $150. Best targets. |
| `A_GREENFIELD` | No vendor at all. |
| `C_VENDOR_EXIT_CAPABLE` | Exit-intent-capable vendor present. Needs browser check. |
| `B_EMAIL_ONLY` | Capture vendor with no exit-intent trigger. |

## scrape-app-reviews.mjs

Feeds domains to the scanner by finding stores that are **already unhappy** with
a popup app. Happy reviewers are a bad list — the product is working for them.
1-3 star reviewers bought into the category, pay for it, and are annoyed today.

```
node prospecting/scrape-app-reviews.mjs
node prospecting/scrape-app-reviews.mjs --apps privy,optimonk --pages 5
node prospecting/scrape-app-reviews.mjs --no-resolve
```

Writes `reviews-<stamp>.json` (full review text per store) and
`reviews-<stamp>-domains.txt`, which `scan-stores.mjs` reads directly:

```
node prospecting/scan-stores.mjs prospecting/out/reviews-<stamp>-domains.txt
```

### App handles

The App Store 404s unknown handles, and the handle is often not the brand name:
`justuno` and `wheelio` both 404. Verify at `apps.shopify.com/<handle>` before
adding. Full app URLs are accepted and stripped to the handle.

### Domain resolution

Reviews give a store **name**, never a URL. Resolution slugifies the name and
tries `.com`, `.co`, `.shop`, `.store`, then checks the brand actually appears
on the page:

| Confidence | Meaning |
|---|---|
| `high` | Shopify **and** brand token in `<title>` |
| `medium` | Shopify, brand only in body text |
| `not-shopify` | Domain answered but isn't Shopify |
| `none` | Nothing responded |

Only `high` and `medium` reach the domains file. Expect roughly half of names
to resolve; the rest are still in the JSON with name plus country, which is
usually enough to find by hand.

### On quoting reviews in outreach

The review text is captured because it tells you what they actually hate,
which is usually billing surprises rather than the popup itself. Naming a
review in the email can read as surveillance. Use it to pick the angle, not as
a quote.

## draft-emails.mjs

Turns scan rows into reviewable drafts, best lead first, 12 at a time.

```
node prospecting/draft-emails.mjs             # preview 12 in the terminal
node prospecting/draft-emails.mjs --push      # also put them in Zoho Drafts
node prospecting/draft-emails.mjs --limit 5
node prospecting/draft-emails.mjs --include-drafted
node prospecting/draft-emails.mjs --reset     # clear the ledger
```

Reads the newest `scan-*.json` and `reviews-*.json` in `out/` unless you pass
`--scan` / `--reviews`. **Re-scan before drafting** if the scan predates a
scanner change; a row missing `currency` scores as if its catalog were
unreadable.

### Drafts only

There is no SMTP code in the file. It appends to the Drafts folder over IMAP
with the `\Draft` flag and nothing else, so nothing can reach a stranger's
inbox without you pressing send.

### The 12 cap and the ledger

Every pushed domain is recorded in `prospecting/state/drafted.json`. Triggering
again gives you the **next** 12, not the same 12. The ledger only advances on
`--push`, so previewing as often as you like costs nothing.

### Ranking

Sorted by a likelihood-to-engage score. There is **no outcome data behind these
weights** — nothing has been sent, so nothing has replied. They are a prior.
Each row prints which signals fired, and the components are kept so that once
replies come in you can see what actually predicted them and re-weight instead
of guessing twice. Edit `WEIGHTS` at the top of the file.

| Signal | Why |
|---|---|
| `angryRecently` +30 | Complained about a popup app within ~18 months |
| `noVendor` +25 | Nothing installed, nothing to rip out |
| `highAov` +25 | Median >= $150 USD, the thesis |
| `hasContact` +20 | A named human beats a guess |
| `catalogReadable` +15 | We can say something specific |
| `noCatalog` **-15** | Pricing unreadable, so the draft goes generic and weak |

That penalty matters: a store we can't price gets an email with no concrete
line in it, which is a worse email regardless of how big the store is.

### PowerPoint export

```
cd prospecting && npm install      # one time, installs pptxgenjs
cd .. && node prospecting/draft-emails.mjs --pptx
```

Writes `outreach.pptx` next to the other outputs: a title slide, one slide per
email, and a closing slide of the tracking commands. Each email slide carries
the body at readable size, the subject, the recipient, the scan evidence behind
the pitch, and the score breakdown.

`prospecting/` is its own npm package on purpose. The root `package.json` claims
only `extensions/*` as workspaces, so installing here leaves the Shopify app's
dependency tree and its deploy untouched.

### Recording sends and follow-ups

Drafting is not sending, so the ledger cannot know what went out until you say
so:

```
node prospecting/draft-emails.mjs --sent kayladevitoart.com
node prospecting/draft-emails.mjs --replied kayladevitoart.com
node prospecting/draft-emails.mjs --dead kayladevitoart.com
node prospecting/draft-emails.mjs --status
```

A sent lead leaves the pool and returns on its own when a follow-up is due:
four days after the first touch, ten days after the second, then never again.
Three touches total.

A due follow-up re-enters scored at its base plus 20, plus one point per day
overdue capped at 14, so it lands wherever it deserves in a later batch instead
of always at the top. The slide says which touch it is and how overdue.

**`--replied` and `--dead` are the only thing preventing a third email to
someone who already answered or declined.** Nothing else infers it.

## find-contacts.mjs

```
node prospecting/find-contacts.mjs                  # free scrape only
node prospecting/find-contacts.mjs --lusha          # + Lusha search, no credits spent
node prospecting/find-contacts.mjs --lusha --spend  # + reveal emails, SPENDS CREDITS
```

Merges into `contacts.csv` and never overwrites a row that already has an
email, so hand-researched contacts survive a re-run.

### Why two phases

Lusha's contact endpoints cannot start from a bare domain. `/v3/contacts/search`
needs a name, an email, or a LinkedIn URL. Only `/v3/contacts/prospecting` goes
domain to people, filtered by seniority, and every revealed email costs a
credit. So the free phase exists to find a name first, which makes the paid
phase cheaper or unnecessary.

### What the free phase actually yields

Roughly one store in ten, and that is being generous. Measured on a real batch
of 31: three names, of which two were genuinely the owner. Small DTC brands do
not put their founder on the site. **Do not plan around this number** — it is
the reason the Lusha path exists.

What it looks for, best source first:

| Source | Trust |
|---|---|
| `jsonld:founders` / `jsonld:employee` | High. Structured, explicit. |
| `prose:*` | Medium. "I'm X", "founded by X", "X, founder". |
| `brand-is-a-person` | Medium. The store is named after its owner. |

JSON-LD `author` is deliberately ignored: Shopify themes and apps put their own
developer there, which is how a theme author ends up looking like a founder.

Names are checked against a list of given names before being accepted. Without
that, "Thrift Goblin" and "Gospel Musicians" both parse as people, and an early
run produced a near-100% false positive rate. Missing a real founder is cheap;
putting a wrong name in an email is not.

`brandname@gmail.com` is classified generic, not personal. The local part being
the brand again means it reaches the shop rather than a person, which is the
thing this is meant to avoid. Those land in `notes` as a fallback.

### Lusha

Set `LUSHA_API_KEY`. `--lusha` searches only, which costs a search action;
`--spend` is required before anything reveals an email and consumes a credit.
The split is deliberate, so a mistyped command cannot burn credits.

**Check your Lusha plan has API access at all.** The browser extension and the
API are sold separately, and a seat that works in the browser may return 401
here. The tool stops the whole run on a 401 or 403 rather than failing the same
way once per domain.

### Contacts

Fill `prospecting/contacts.csv` (`domain,email,name,title`) from Lusha or the
store's own About page. Rows without an email still get a draft, addressed to
you, subject prefixed `[NEEDS CONTACT: domain]`, with a banner naming the store
and country. The draft doubles as the research worklist.

### Zoho free plan does not expose IMAP

`--push` needs IMAP, which Zoho gates behind a paid plan. On the free plan the
IMAP settings page reads "This feature is not available for your account".

Use `--review` instead. It writes a local page with every draft in rank order,
a copy button per field and a mailto link, which you paste into Zoho's web
compose. Same 12 cap, same ordering, same ledger, no credentials needed.

```
node prospecting/draft-emails.mjs --review
open prospecting/out/drafts-<stamp>/review.html
```

`--eml` writes one RFC822 file per draft in the same folder, for any client
that can import them.

Paying for Zoho Mail Lite restores IMAP and makes `--push` work as designed.
Check current pricing; it is roughly a dollar a month billed annually.

### Zoho setup (paid plans only)

```
export ZOHO_USER='you@yourdomain.com'
export ZOHO_APP_PASSWORD='...'      # Zoho > Settings > Security > App Passwords
node prospecting/draft-emails.mjs --test-connection
```

Optional: `ZOHO_IMAP_HOST` (default `imap.zoho.com`), `ZOHO_IMAP_PORT` (993),
`ZOHO_DRAFTS_FOLDER` (`Drafts`), `ZOHO_FROM`.

### Copy rules baked into the templates

No uplift percentages, no conversion averages, no testimonials, no customer
counts. The only track record cited is the one live store: three recovered
checkouts, about $3,000 attributed, two weeks in, stated as attributed rather
than causal and paired with an explicit "too early to claim a lift number."
That last clause is the differentiator, since every other popup app in the
inbox is claiming one. The concrete numbers in each email are the prospect's
own scraped prices. No em dashes.
