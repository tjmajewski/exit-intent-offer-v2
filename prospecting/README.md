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

### Scenarios

| Scenario | Meaning |
|---|---|
| `E_HIGH_AOV_GREENFIELD` | No vendor, median price >= $150. Best targets. |
| `A_GREENFIELD` | No vendor at all. |
| `C_VENDOR_EXIT_CAPABLE` | Exit-intent-capable vendor present. Needs browser check. |
| `B_EMAIL_ONLY` | Capture vendor with no exit-intent trigger. |
