#!/bin/zsh
# Video summaries, run on Jeff's Mac every 2 hours by launchd (YouTube blocks cloud servers, not home internet).
# Pulls, summarises any finished meeting from its video, commits and pushes; the push deploys the site.
# Runs in its own clone (~/.squamish-voters-bot) so it never touches the working copy you edit.
# Install or remove: scripts/pipeline/mac/install.sh [remove]. Log: ~/Library/Logs/squamish-voters.log
set -e
cd "$(dirname "$0")/../../.."
export PATH="$PWD/scripts/pipeline/mac/bin:$HOME/.local/node/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a; . ./.env.local; set +a
git checkout -q main
git pull -q --rebase
[ -d node_modules/@anthropic-ai/sdk ] || npm ci --silent --no-audit --no-fund
node scripts/pipeline/sync.mjs
node scripts/pipeline/summarize.mjs
git add data/meetings data/promises.json public/transcripts
if git diff --cached --quiet; then echo "$(date) nothing new"; exit 0; fi
git commit -q -m "Meeting summary from video $(date -u +%Y-%m-%dT%H:%MZ)"
git pull -q --rebase && git push -q
echo "$(date) pushed"
