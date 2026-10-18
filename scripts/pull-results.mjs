// Pulls the District of Squamish election results feed into data/results.json (the 2026 entry), then rebuild + deploy.
// The District's results page (Dominion ENR app) reads data/arearesults.json; we read the same file.
// Usage: node scripts/pull-results.mjs [unofficial|official]
import { readFileSync, writeFileSync } from 'node:fs';

const PAGE = 'https://squamish.ca/public/Squamish2026ENR_Ver1/index.html#at/1/ar/1/ct/000';
const FEED = 'https://squamish.ca/public/Squamish2026ENR_Ver1/data/arearesults.json';
const FILE = new URL('../data/results.json', import.meta.url);
const status = process.argv[2] || 'unofficial';

const d = await (await fetch(`${FEED}?${Date.now()}`, { headers: { 'user-agent': 'SquamishVoters results (squamishvoters.com)' } })).json();
const st = d.statistics, contests = d.areaResults[0]['1'].contestResults;
const KEY = { Mayor: 'mayor', Councillor: 'council', 'School Trustee': 'trustees' };
const res = JSON.parse(readFileSync(FILE, 'utf8'));
const r = res['2026'];
for (const c of contests) {
  const k = KEY[c.contestName];
  if (!k) { console.warn('Skipping contest', c.contestName); continue; }
  r[k] = c.choiceResults.map((x) => ({ name: x.choiceName, total: x.votes, pct: parseFloat(x.percentage), elected: !!x.isWinner }))
    .sort((a, b) => b.total - a.total);
}
Object.assign(r, {
  status,
  source_url: PAGE,
  ballots_cast: st.globBallotCast,
  eligible_voters: st.eligibleVoters,
  turnout_pct: parseFloat(st.globTurnout),
  counted: `${st.globClosedTabulators} of ${st.globTabulators} vote counting machines reported`,
  district_timestamp: st.timeStamp,
  updated: new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'long', timeStyle: 'short' }),
});
writeFileSync(FILE, JSON.stringify(res, null, 1) + '\n');
console.log(`${status}: ${r.ballots_cast} ballots, ${r.turnout_pct}% turnout, ${r.counted}`);
for (const k of ['mayor', 'council', 'trustees']) console.log(k, r[k].filter((x) => x.elected).map((x) => x.name).join(', '));
