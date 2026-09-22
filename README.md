# Squamish Voters 2026

Source code and data for **https://squamishvoters.com** — an independent, non-partisan
voter guide for the District of Squamish municipal election on October 17, 2026.
Built and paid for by Jeff Kirdeikis, a Squamish resident. Not connected to any candidate,
campaign, party or business.

**Want to check how the quiz and the "where they lean" numbers are worked out?
Read [METHODOLOGY.md](METHODOLOGY.md).** The matching code is `src/quiz.js`
(about 40 lines of arithmetic in `score()`), the lean/compass code is in `build.mjs`
(`AXES`, `CLASSIC`), and every candidate score is in `data/candidates.json` with its source.

## What is here

- `build.mjs` — zero-dependency static site generator. `node build.mjs` renders `data/` into `dist/`.
- `src/quiz.js` — the quiz. Runs in the browser; answers never leave the device.
- `src/lean.js`, `src/site.js`, `src/site.css` — page behaviour and styles.
- `data/candidates.json` — the source of truth: every candidate's bio, sourced supports/opposes,
  per-issue stances and `quiz_answers` (−2..+2 or `null` = no public position found).
- `data/questions.json` — the statements (17 core ones are in the voter quiz; all are asked of candidates).
- `data/context.json` — voting logistics, issue explainers, key facts with sources.
- `data/pages/` — About page and full transcriptions of candidate position papers.
- `scripts/` — one-off scripts used to apply questionnaire responses and research into the data.
- `api/` — the candidate questionnaire form endpoint (Vercel Blob, private store). Needs
  `BLOB_READ_WRITE_TOKEN` and `ADMIN_TOKEN` to run; not needed to build the site.

Not included: raw research notes, outreach emails and the questionnaire tracker.

## Run it

```
node build.mjs                                   # build into dist/
python3 -m http.server 4173 --directory dist     # then open http://localhost:4173
```

Requires Node 18+. Deployed on Vercel (`vercel.json` runs the build).

## Editorial rules

- Never guess a position. No source, no score — the site says "No public position found".
- Every published position links to its source.
- A candidate's own questionnaire answer overrides our reading of the record and is labelled as theirs.
- Candidates are always listed alphabetically. No endorsements.

## Found an error?

Open an issue here or email squamishvoters@gmail.com with a link to a public source.

## Licence

Code: MIT (see LICENSE). Candidate data in `data/` is compiled from public sources and is
released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — reuse it with credit.
Candidate photos in `public/img/` belong to their credited owners and are not covered.
