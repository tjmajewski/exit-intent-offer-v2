# Production Cron Job Setup (Fly.io)

Production deploys recurring jobs as **Fly scheduled machines**. They share the
deployed app image, run the script, and exit. No external scheduler is involved.

The canonical schedule table also lives in
[DATABASE_MAINTENANCE.md](DATABASE_MAINTENANCE.md#automated-cleanup--cron-schedule).
This doc is the operational runbook: how to register, inspect, debug, and
manually invoke each job.

---

## Jobs

| Script | Schedule | Purpose |
|--------|----------|---------|
| `app/cron/evolution-cycle.js` | hourly | Variant evolution (Pro/Enterprise AI shops with 100+ new impressions) |
| `app/cron/threshold-learning-cycle.js` | hourly | Per-shop intervention threshold recalc (50+ new outcomes) |
| `app/cron/aggregate-gene-performance.js` | daily | Cross-store gene + archetype meta-learning; also cleans expired offers / old rows |
| `app/cron/track-seasonal-patterns.js` | weekly | Seasonal performance snapshot |

All four are plain Node entry points invoked via the deployed image:
`node app/cron/<name>.js`. They read the same `DATABASE_URL` /
`CRON_SECRET` env that the web process has.

---

## Registering / re-registering

Run once per job after a successful deploy. Re-run when the image changes
(only needed if the cron entry-point code changes — Fly pins the registered
machine to the image tag at registration time).

```bash
flyctl m run -a resparq --schedule hourly  registry.fly.io/resparq:latest node app/cron/evolution-cycle.js
flyctl m run -a resparq --schedule hourly  registry.fly.io/resparq:latest node app/cron/threshold-learning-cycle.js
flyctl m run -a resparq --schedule daily   registry.fly.io/resparq:latest node app/cron/aggregate-gene-performance.js
flyctl m run -a resparq --schedule weekly  registry.fly.io/resparq:latest node app/cron/track-seasonal-patterns.js
```

Confirm with:

```bash
flyctl m list -a resparq
```

Scheduled machines show their schedule (`hourly` / `daily` / `weekly`) in the
output. The web machine is the one with `state=started` continuously; the cron
machines spend most of their time in `stopped` and only spin up at their tick.

### Re-registering after an image change

Fly does not auto-update scheduled machines. If a cron script changed:

```bash
# Find the machine ID for the job you want to refresh
flyctl m list -a resparq

# Destroy the old scheduled machine
flyctl m destroy <machine-id> -a resparq --force

# Re-create with the new image
flyctl m run -a resparq --schedule <hourly|daily|weekly> registry.fly.io/resparq:latest node app/cron/<file>.js
```

---

## Manual invocation (debugging / one-offs)

To run a cron job immediately against production data without waiting for the
tick, SSH into the live web machine and exec it there. It shares the same DB
and env, so the result is identical to a scheduled run.

```bash
fly ssh console -a resparq -C "node app/cron/evolution-cycle.js"
fly ssh console -a resparq -C "node app/cron/threshold-learning-cycle.js"
fly ssh console -a resparq -C "node app/cron/aggregate-gene-performance.js"
fly ssh console -a resparq -C "node app/cron/track-seasonal-patterns.js"
```

For the cleanup endpoint specifically:

```bash
fly ssh console -a resparq -C "curl -X POST http://localhost:3000/api/cleanup-old-data"
```

---

## Local testing

```bash
npm run evolution         # node app/cron/evolution-cycle.js
npm run aggregate-genes   # node app/cron/aggregate-gene-performance.js
npm run track-seasonal    # node app/cron/track-seasonal-patterns.js
```

(There is no npm script for `threshold-learning-cycle.js` — invoke it directly
with `node app/cron/threshold-learning-cycle.js` if needed.)

Local runs hit your `DATABASE_URL` — point it at a dev DB before testing.

---

## Logs

Cron machines log to the same stream as the web machine. Filter by prefix:

```bash
# Tail everything
flyctl logs -a resparq

# Filter to a specific job (each script logs with a tagged prefix)
flyctl logs -a resparq | grep '\[Evolution Cron\]'
flyctl logs -a resparq | grep '\[Threshold Cron\]'
flyctl logs -a resparq | grep '\[Meta-Learning\]'
flyctl logs -a resparq | grep '\[Seasonal\]'
```

---

## Health monitoring

`/api/health` is pinged every 5 minutes by Fly's `[[http_service.checks]]`.
The endpoint returns 500 (→ Sentry alert + Fly machine restart) when:

- DB is unreachable, **or**
- Newest `Variant.birthDate` across AI-mode shops is > 2h old **while** real
  traffic exists (a `VariantImpression` in the last 24h).

Quiet stores skip the freshness check, so a no-traffic period won't false-alarm.
This is the tripwire for "evolution cron silently stopped firing." If you see
the 500 in Sentry, the first thing to check is `flyctl m list -a resparq` — a
destroyed or stuck scheduled machine is the usual cause.

---

## Troubleshooting

**Cron didn't run at its tick.**
- `flyctl m list -a resparq` — is the scheduled machine still there? If a
  recent `flyctl m destroy` or a manual cleanup removed it, re-register.
- Check the machine's state. `stopped` between ticks is normal; `failed` is not.
- `flyctl logs -a resparq | grep '<job-prefix>'` — did it run and error out?

**Evolution not killing/breeding variants.**
- Need 100+ impressions since last cycle for a shop to be eligible.
- Variants need 50+ impressions to be evaluated.
- Check `Shop.lastEvolutionCycle` in the DB.

**Gene aggregation produced no updates.**
- Need 3+ shops in AI mode with sufficient impressions.
- Variants need 10+ impressions to be included in the aggregation.

**Threshold learning isn't moving.**
- Need 50+ new outcomes (intervention + post-intervention signal) since the
  last recalc for that shop.

**Image is stale.** After a deploy, scheduled machines keep running the
previously-registered image until re-registered (see "Re-registering after an
image change" above).

---

## Post-deploy checklist

After a deploy that touches anything in `app/cron/`:

- [ ] Re-register affected scheduled machine(s) against the new image
- [ ] `flyctl m list -a resparq` shows all four cron schedules
- [ ] Manual invocation (see above) of the changed job succeeds
- [ ] `/api/health` returns 200
- [ ] Logs show the next tick firing cleanly
