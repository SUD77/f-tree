/*
 * Entitlements.kt, for the parts a JVM has no other way to check.
 *
 * The table itself -- `policy-cases.json` -- is not this file's to own. It is read by
 * `PolicyCasesTest.kt` too, the same way `sample-family.ftree` already feeds a Node test and a
 * Kotlin JVM test from one file, so a case added here is a case the Kotlin evaluator is held to as
 * well, without anyone having to remember to port it by hand.
 *
 * Each case becomes its own `test()`, rather than one loop wrapped in a single assertion, so a
 * failing row names itself in the output instead of reporting "case 14 failed".
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPolicy, decide } from './policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const shippedPolicy = JSON.parse(readFileSync(path.join(HERE, 'policy.json'), 'utf8'));
const table = JSON.parse(readFileSync(path.join(HERE, 'policy-cases.json'), 'utf8'));

/** `"shipped"` means the real file this app ships; anything else is the case's own hypothetical. */
function resolvePolicy(casePolicy) {
  return casePolicy === 'shipped' ? shippedPolicy : casePolicy;
}

for (const testCase of table.cases) {
  test(testCase.name, () => {
    const policy = loadPolicy(resolvePolicy(testCase.policy));
    const decision = decide(policy, testCase.request, testCase.context);
    assert.deepStrictEqual(decision, testCase.expect);
  });
}

test('the shipped policy is itself well-formed, not merely one of the cases above', () => {
  assert.strictEqual(loadPolicy(shippedPolicy) !== null, true);
});

test('the shipped policy is read by loadPolicy from its raw file text too, not only as an object', () => {
  const raw = readFileSync(path.join(HERE, 'policy.json'), 'utf8');
  assert.notStrictEqual(loadPolicy(raw), null);
});

test('loadPolicy never throws on nonsense, however it arrives', () => {
  for (const bad of [null, undefined, 42, [], '{not json', '"a plain string"', '[]']) {
    assert.doesNotThrow(() => loadPolicy(bad));
  }
});
