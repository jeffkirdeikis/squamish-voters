// node --test scripts/pipeline/status.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { promiseTally, tallyText, recomputePromises, positionStatus, isBudgetAdoption } from './status.mjs';

const vote = (v, source = 'minutes', extra = {}) => ({ title: 'x', votes: { 'sean-easton': v, 'sarah-ellis': 'yes' }, votes_source: source, ...extra });
const meetings = [
  { id: 'm1', votes_source: 'minutes', decisions: [vote('no'), vote('yes'), vote('absent')] },
  { id: 'm2', decisions: [vote('no', 'video')] },
  { id: 'm3', votes_source: 'minutes', decisions: [vote('yes', 'minutes', { consent_agenda: true })] },
];
const P = (evidence, extra = {}) => ({ id: 'p', slug: 'sean-easton', status: 'not_yet', evidence, ...extra });

test('no evidence: not tested yet', () => assert.equal(promiseTally(P([]), meetings).status, 'not_yet'));

test('a confirmed vote the way he promised: kept', () => {
  const t = promiseTally(P([{ meeting: 'm1', decision: 0, keeps_if: 'no' }]), meetings);
  assert.equal(t.status, 'kept'); assert.equal(tallyText(t), '1 vote');
});

test('a confirmed vote the other way: not kept, with a tally', () => {
  const t = promiseTally(P([{ meeting: 'm1', decision: 1, keeps_if: 'no' }]), meetings);
  assert.equal(t.status, 'not_kept'); assert.equal(tallyText(t), '1 vote');
});

test('video only can never be red: early sign', () => {
  const t = promiseTally(P([{ meeting: 'm2', decision: 0, keeps_if: 'yes', status: 'not_kept' }]), meetings);
  assert.equal(t.status, 'early'); assert.match(tallyText(t), /waiting for the official minutes/);
});

test('consent agenda never gives a red label', () => {
  assert.equal(promiseTally(P([{ meeting: 'm3', decision: 0, keeps_if: 'no' }]), meetings).status, 'early');
});

test('votes both ways: mixed, not the newest one', () => {
  const t = promiseTally(P([{ meeting: 'm1', decision: 0, keeps_if: 'no' }, { meeting: 'm1', decision: 1, keeps_if: 'no' }]), meetings);
  assert.equal(t.status, 'mixed'); assert.equal(tallyText(t), '1 kept, 1 not kept');
});

test('away for the vote: says nothing', () => assert.equal(promiseTally(P([{ meeting: 'm1', decision: 2, keeps_if: 'yes' }]), meetings).status, 'not_yet'));

test('minutes correct the vote: the label follows the corrected vote', () => {
  const ms = [{ id: 'm2', decisions: [vote('no', 'video')] }];
  const p = P([{ meeting: 'm2', decision: 0, keeps_if: 'yes', status: 'not_kept' }]);
  recomputePromises([p], ms); assert.equal(p.status, 'early');
  ms[0].decisions[0] = vote('yes'); // minutes.mjs: he actually voted yes
  recomputePromises([p], ms); assert.equal(p.status, 'kept');
});

test('old evidence without a decision link still counts, "broken" read as not kept', () => {
  assert.equal(promiseTally(P([{ meeting: 'm1', status: 'broken' }]), meetings).status, 'not_kept');
  assert.equal(promiseTally(P([{ meeting: 'm2', status: 'broken' }]), meetings).status, 'early');
});

test('not testable by votes', () => assert.equal(promiseTally(P([{ meeting: 'm1', decision: 0, keeps_if: 'no' }], { testable: false }), meetings).status, 'not_testable'));

test('positions: red only after 2 or more confirmed votes against', () => {
  assert.equal(positionStatus([]), 'untested');
  assert.equal(positionStatus([{ inLine: false, confirmed: true }]), 'early');
  assert.equal(positionStatus([{ inLine: false, confirmed: false }, { inLine: false, confirmed: false }]), 'early');
  assert.equal(positionStatus([{ inLine: false, confirmed: true }, { inLine: false, confirmed: true }]), 'against');
  assert.equal(positionStatus([{ inLine: true, confirmed: true }]), 'in_line');
  assert.equal(positionStatus([{ inLine: true, confirmed: true }, { inLine: false, confirmed: true }]), 'mixed');
});

test('whole budget adoption votes never test a position', () => {
  assert.equal(isBudgetAdoption({ title: '2027 to 2031 Five Year Financial Plan Bylaw, third reading' }), true);
  assert.equal(isBudgetAdoption({ title: 'Council adopts the 2027 budget' }), true);
  assert.equal(isBudgetAdoption({ title: 'Grant for the Brennan Park roof study' }), false);
  assert.equal(isBudgetAdoption({ title: 'Approve a $50,000 budget for the trail study' }), false);
  assert.equal(isBudgetAdoption({ title: 'Rezoning for 120 rental homes', budget_adoption: true }), true);
  assert.equal(isBudgetAdoption({ title: 'Approve the 2027 budget', budget_adoption: false }), false);
});
