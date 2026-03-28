import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedGoogleSub } from '../src/auth/allowlist.js';
import { parseAllowlistSubs } from '../src/config.js';

test('parseAllowlistSubs trims values and ignores empty entries', () => {
  const allowlist = parseAllowlistSubs(' sub_1 , ,sub_2,  sub_3  ');

  assert.deepEqual([...allowlist], ['sub_1', 'sub_2', 'sub_3']);
});

test('isAllowedGoogleSub allows all verified users when the allowlist is blank', () => {
  assert.equal(isAllowedGoogleSub('sub_any', new Set()), true);
});

test('isAllowedGoogleSub only allows configured tester subs when the allowlist is present', () => {
  assert.equal(isAllowedGoogleSub('sub_allowed', new Set(['sub_allowed'])), true);
  assert.equal(isAllowedGoogleSub('sub_blocked', new Set(['sub_allowed'])), false);
});
