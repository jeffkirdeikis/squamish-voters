# How Squamish Voters calculates things

This document explains every number the site shows. The code is short and unminified;
file and function names below point at the exact lines so you can check for yourself.

## 1. The raw data: candidate scores

`data/candidates.json` is the source of truth. For every candidate, `quiz_answers` holds a
score per statement: `2` strongly agree, `1` somewhat agree, `0` mixed / middle,
`-1` somewhat disagree, `-2` strongly disagree, or `null` = no public position found.

Where a score comes from, in priority order:

1. **The candidate's own answer** to our questionnaire (`direct.kind = "questionnaire"`,
   with `direct.answered` listing the statement IDs they answered themselves). Their answer
   replaces anything we had researched, and the site marks it "✓ Answered us directly".
   Their optional free-text comment is in `answer_notes` and is shown unedited.
   Applied by `scripts/apply-direct.py`.
2. **Our reading of the public record**: campaign sites, press coverage, letters, public
   posts and, for the four incumbents, 2022–2026 council votes. Every published position
   in `supports` / `opposes` / `stances` carries a `source_url`. Where we found nothing,
   the score is `null`, never a guess. `research_notes` on each candidate are our working
   notes on what we found and what we deliberately left unscored.

The statements themselves are in `data/questions.json`. `core: true` statements (17)
are asked in the voter quiz; the rest are only asked of candidates and shown on
profiles and the Compare page.

## 2. The quiz match percentage

Code: `src/quiz.js`, function `score(c)`. It runs entirely in the browser; answers are
never sent anywhere.

For each statement `q` where **both** the voter (`u`) and the candidate (`v`) have a
numeric answer:

```
d      = |u - v|                    // 0..4 steps apart
credit = max(0, 1 - d / 3)          // 0 steps = 1, 1 step = 0.67, 2 = 0.33, 3+ = 0
w      = 2 if the voter starred the statement as important, else 1
```

Then

```
raw   = Σ(w × credit) / Σ(w)
match = (Σ(w × credit) + SHRINK × 0.5) / (Σ(w) + SHRINK)        with SHRINK = 2
pct   = round(match × 100)
```

The `SHRINK` term behaves like two extra questions scored 50%. It pulls thin matches
toward 50% so that a candidate with only four scorable statements cannot land at 100%
on four lucky answers. With many overlapping questions its effect is small.

Rules around the percentage:

- `MIN_OVERLAP = 4`: a candidate needs at least 4 statements in common with the voter
  to get a percentage. Otherwise they are listed under "Not enough public information
  to match" with no number.
- "Not sure — skip this one" stores `null` and drops the statement for everyone.
  "Mixed — I'm in the middle" stores `0` and **is** scored.
- `RECOMMEND = 55`: the shortlist, the "top 6 for council" and the Save-all button only
  include candidates at 55% or higher. Anyone below is still shown, labelled
  "match — you mostly disagree". If fewer than 6 council candidates clear 55%, fewer
  are shown; the list is never padded.
- Ties are broken by more overlapping questions first, then alphabetically.
- Every match card shows "based on N of your M answers" so a high match on few
  questions is visibly weaker than one on many.

Why the credit curve is `1 - d/3` and not `1 - d/4`: the original curve gave a "mixed"
voter half credit against a candidate who strongly agrees, which read to voters as
"I said neutral and got matched with someone who voted yes". With `1 - d/3`,
middle-vs-strong is one third and opposite ends are zero.

## 3. "Where they lean" (the five lines)

Code: `build.mjs`, constants `AXES`, functions `axisScore`, `BANDS`, `leanList`.
Computed at build time, only from the scores in section 1. Nothing here is a judgment call.

Each line lists which statements feed it and a sign. A candidate's position is the plain
average of `score × sign` over the statements they have a score on:

| Line | Statements (sign) |
|---|---|
| Homelessness & street safety | q5 (−), q20 (−), q6 (+), q18 (+), q31 (+), q19 (+), q32 (+), q35 (+) |
| Money | q7 (+), q4 (−), q12 (−), q11 (−) |
| Growth | q1 (−), q2 (+), q10 (+) |
| The Woodfibre tax deal | q23 (+) |
| Climate & environment | q9 (+), q24 (+) |

Positive pushes toward the right-hand label of the line (e.g. "Enforcement and order
first", "Hold taxes down", "Build more, faster", "Sign it", "Climate first").

Grouping (`BANDS`): average `< −1.2` and at least 3 statements = "Clearly [left label]";
`< −0.34` = "Leans"; between `−0.34` and `0.34` = "In the middle"; symmetric on the
right. A strong score on a single statement can only be a "lean", never "clearly".
A candidate with no score on any statement of a line is listed under "Haven't said yet"
rather than placed in the middle. Rows resting on one statement are drawn hollow.

The dot's position on the track is linear: `4 + (v + 2) / 4 × 92` percent.

## 4. The 2-D compass

Code: `build.mjs`, constant `CLASSIC`, functions `classicScore`, `compassPos`.

- X (left = more public spending, right = hold taxes down): average of
  q7 (+), q21 (+), q4 (−), q5 (−), q11 (−), q12 (−), q22 (−), q26 (−), q30 (−), q34 (−), q15 (−).
- Y (up = housing and support first, down = enforcement and order first): the
  homelessness line above, flipped in sign.

A candidate is placed only if both axes have at least one score. If they have fewer
than 2 money statements, X falls back to the researched `compass.economic` estimate
(−5..+5, scaled by 0.4) and the dot is drawn hollow and labelled "our estimate".
A dot is also hollow when Y rests on a single statement.

## 5. What the site never does

- No score is ever inferred from party, endorsements or tone. `null` means `null`.
- Candidates are always listed alphabetically by last name. The quiz result is the only
  ranking on the site and it is personal to the voter.
- Analytics are counts only (page views, quiz started/finished, which topic was opened).
  Quiz answers, matches and ballot picks never leave the browser. See `SV.track` calls
  in `src/site.js` and `src/quiz.js`.

## Reproducing the site

```
node build.mjs      # writes dist/
```

No dependencies are needed for the build. Compare `dist/data.js` with the live
https://squamishvoters.com/data.js to confirm the deployed scores match this repository.
