#!/bin/zsh
# Puts the Resend sending key (copied to the clipboard) into Vercel and GitHub, plus the other two email settings.
# The key is read from the clipboard and never printed.
set -e
export PATH=$HOME/.local/node/bin:$PATH
cd ~/squamish-votes
# Waits up to 3 minutes for a Resend key (starts with re_) to land on the clipboard, so you can start this first.
echo "Waiting: copy the Resend key now (it starts with re_)..."
KEY=''
for i in {1..180}; do
  KEY=$(pbpaste | tr -d '[:space:]')
  [[ $KEY == re_* ]] && break
  KEY=''; sleep 1
done
[[ -n $KEY ]] || { echo "No Resend key showed up on the clipboard. Run this again, then copy the key."; exit 1; }
echo "Got it. Saving..." 
FROM='Squamish Voters <news@squamishvoters.com>'
for ENV in production preview; do
  vercel env rm RESEND_API_KEY $ENV --yes >/dev/null 2>&1 || true
  printf '%s' "$KEY" | vercel env add RESEND_API_KEY $ENV >/dev/null
  vercel env rm EMAIL_FROM $ENV --yes >/dev/null 2>&1 || true
  printf '%s' "$FROM" | vercel env add EMAIL_FROM $ENV >/dev/null
done
printf '%s' "$KEY" | gh secret set RESEND_API_KEY -R jeffkirdeikis/squamish-voters
printf '%s' "$FROM" | gh secret set EMAIL_FROM -R jeffkirdeikis/squamish-voters
TMP=$(mktemp); vercel env pull "$TMP" --environment=production --yes >/dev/null 2>&1
grep '^POSTGRES_URL=' "$TMP" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//' | gh secret set POSTGRES_URL -R jeffkirdeikis/squamish-voters
rm -f "$TMP"
printf '' | pbcopy
echo "Done: email key and settings saved to Vercel and GitHub. Clipboard cleared."
