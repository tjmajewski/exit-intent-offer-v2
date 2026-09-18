#!/usr/bin/env bash
# =============================================================================
# Fly scheduled-machine manager for Resparq's cron jobs.
#
# WHY THIS EXISTS
# `fly deploy` updates the web machine and nothing else. Scheduled machines stay
# pinned to whatever image they were registered with, so cron code silently runs
# at the version it was registered at — for as long as nobody notices. This
# script shows the drift and closes it.
#
#   ./scripts/ops/cron-machines.sh status    # what is registered, on what image
#   ./scripts/ops/cron-machines.sh refresh   # move every cron machine to the
#                                            # image the web process is running
#   ./scripts/ops/cron-machines.sh register  # create any job that has no machine
#
# `refresh` uses `fly machine update`, which swaps the image in place. The
# runbook's destroy-then-recreate leaves a window with NO machine for that job
# if the re-create fails; this does not.
# =============================================================================
set -euo pipefail

APP="${FLY_APP:-resparq}"

# job file : schedule — the canonical list, mirrored in PRODUCTION-CRON-SETUP.md
JOBS=(
  "app/cron/evolution-cycle.js:hourly"
  "app/cron/threshold-learning-cycle.js:hourly"
  "app/cron/aggregate-gene-performance.js:daily"
  "app/cron/track-seasonal-patterns.js:weekly"
  "app/cron/calibrate-propensity.js:weekly"
  "app/cron/generate-copy.js:monthly"
)

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need fly
need python3

# Image the web process is on, i.e. the newest successful deploy.
current_image() {
  fly status -a "$APP" --json | python3 -c '
import json,sys
d = json.load(sys.stdin)
for m in d.get("Machines", []):
    if m.get("config", {}).get("metadata", {}).get("fly_process_group") == "app":
        print(m["config"]["image"]); break
'
}

# id<TAB>name<TAB>schedule<TAB>image<TAB>command, one machine per line.
machines() {
  fly machines list -a "$APP" --json | python3 -c '
import json,sys
for m in json.load(sys.stdin):
    c = m.get("config", {}) or {}
    cmd = (c.get("init", {}) or {}).get("cmd") or []
    print("\t".join([
        m.get("id",""), m.get("name",""),
        c.get("schedule") or "-",
        c.get("image",""),
        " ".join(cmd) if cmd else "-",
    ]))
'
}

require_image() {
  local img; img="$(current_image)"
  # set -e does not catch an empty capture. Without this, `refresh` would run
  # `--image ""` and `register` would parse `node` as the image name.
  [ -n "$img" ] || { echo "could not resolve the app image from 'fly status'" >&2; exit 1; }
  printf '%s' "$img"
}

cmd_status() {
  local img; img="$(require_image)"
  echo "app image: $img"
  echo
  printf '%-16s %-22s %-9s %-7s %s\n' ID NAME SCHEDULE IMAGE COMMAND
  while IFS=$'\t' read -r id name sched image command; do
    [ "$sched" = "-" ] && continue   # skip the web machine
    local mark="stale"
    [ "$image" = "$img" ] && mark="ok"
    printf '%-16s %-22s %-9s %-7s %s\n' "$id" "$name" "$sched" "$mark" "$command"
  done < <(machines)

  echo
  echo "jobs with no scheduled machine:"
  local all; all="$(machines)"
  local missing=0
  for job in "${JOBS[@]}"; do
    local file="${job%%:*}"
    if ! grep -qF "$file" <<<"$all"; then echo "  $file"; missing=1; fi
  done
  if [ "$missing" = 0 ]; then echo "  (none)"; fi
}

cmd_refresh() {
  local img; img="$(require_image)"
  echo "target image: $img"
  while IFS=$'\t' read -r id name sched image command; do
    [ "$sched" = "-" ] && continue
    if [ "$image" = "$img" ]; then
      echo "ok      $name ($command)"
      continue
    fi
    echo "update  $name ($command)"
    # --skip-start is load-bearing: without it `fly machine update` restarts the
    # machine, which for a scheduled machine means an immediate out-of-band run
    # of that job. Refreshing all six would fire every cron at once, including
    # aggregate-gene-performance, which also deletes expired offers and old
    # rows. Refresh should change the image and nothing else.
    fly machine update "$id" -a "$APP" --image "$img" --schedule "$sched" --skip-start --yes
  done < <(machines)
}

cmd_register() {
  local img; img="$(require_image)"
  local all; all="$(machines)"
  # An empty listing means every job looks "missing" and this would create a
  # duplicate scheduled machine for all six — silently doubling cron execution.
  # An expired token or a flyctl JSON shape change both produce that state.
  [ -n "$all" ] || { echo "no machines listed — refusing to register (check FLY_APP / auth)" >&2; exit 1; }
  for job in "${JOBS[@]}"; do
    local file="${job%%:*}" sched="${job##*:}"
    if grep -qF "$file" <<<"$all"; then continue; fi
    echo "create  $file ($sched)"
    fly machine run -a "$APP" --schedule "$sched" "$img" node "$file"
  done
}

case "${1:-status}" in
  status)   cmd_status ;;
  refresh)  cmd_refresh ;;
  register) cmd_register ;;
  *) echo "usage: $0 {status|refresh|register}" >&2; exit 2 ;;
esac
