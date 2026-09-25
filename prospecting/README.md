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

### Contacts

Fill `prospecting/contacts.csv` (`domain,email,name,title`) from Lusha or the
store's own About page. Rows without an email still get a draft, addressed to
you, subject prefixed `[NEEDS CONTACT: domain]`, with a banner naming the store
and country. The draft doubles as the research worklist.

### Zoho setup

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
