#!/bin/zsh
# Video summaries, run on Jeff's Mac every 2 hours by launchd (YouTube blocks cloud servers, not home internet).
# Pulls, summarises any finished meeting from its video, commits and pushes; the push deploys the site.
# Runs in its own clone (~/.squamish-voters-bot) so it never touches the working copy you edit.
# Install or remove: scripts/pipeline/mac/install.sh [remove]. Log: ~/Library/Logs/squamish-voters.log
# Stay awake until the run finishes, even after a scheduled wake (sudo pmset repeat wakeorpoweron MTWRFSU 23:00:00).
[ -z "$SV_AWAKE" ] && SV_AWAKE=1 exec /usr/bin/caffeinate -is /bin/zsh "$0" "$@"
set -e
cd "$(dirname "$0")/../../.."
export PATH="$PWD/scripts/pipeline/mac/bin:$HOME/.local/node/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a; . ./.env.local; set +a
git checkout -q main
git pull -q --rebase
[ -d node_modules/@anthropic-ai/sdk ] || npm ci --silent --no-audit --no-fund
node scripts/pipeline/sync.mjs
node scripts/pipeline/summarize.mjs
node scripts/pipeline/share.mjs
git add data/meetings data/promises.json public/transcripts public/share
if ! git diff --cached --quiet; then
  git commit -q -m "Meeting summary from video $(date -u +%Y-%m-%dT%H:%MZ)"
  git pull -q --rebase && git push -q
  echo "$(date) pushed"
fi
# Publish whatever is newest on main (ours or the GitHub job's), once per commit. The Vercel CLI is signed in on this Mac.
LAST=.last-deployed
if [ "$(git rev-parse HEAD)" != "$(cat $LAST 2>/dev/null)" ]; then
  PREV=$(cat $LAST 2>/dev/null)
  vercel deploy --prod --yes >/dev/null && git rev-parse HEAD > $LAST && echo "$(date) deployed $(git rev-parse --short HEAD)"
  # Tell Bing about meeting pages that changed in this deploy. Never fails the run.
  node scripts/pipeline/indexnow.mjs "$PREV" || true
else
  echo "$(date) nothing new"
fi
