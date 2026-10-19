#!/bin/zsh
# Installs (or with "remove", uninstalls) the launchd job that runs run.sh every 2 hours while the Mac is awake.
PLIST="$HOME/Library/LaunchAgents/com.squamishvoters.meetings.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null
if [ "$1" = remove ]; then rm -f "$PLIST"; echo removed; exit 0; fi
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"
BOT="$HOME/.squamish-voters-bot"
[ -d "$BOT/.git" ] || git clone -q "$(git -C "$SRC" remote get-url origin)" "$BOT"
cp "$SRC/.env.local" "$BOT/.env.local"   # the Anthropic key; .env* is gitignored
RUN="$BOT/scripts/pipeline/mac/run.sh"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.squamishvoters.meetings</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$RUN</string></array>
  <key>StartInterval</key><integer>7200</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/squamish-voters.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/squamish-voters.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "installed: runs every 2 hours while the Mac is awake"
