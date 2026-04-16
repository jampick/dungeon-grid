import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordChange } from '../lib/logic.js';

test('validatePasswordChange: valid inputs return null', () => {
  assert.equal(validatePasswordChange('old123', 'newPass1', 'newPass1'), null);
});

test('validatePasswordChange: mismatched new passwords', () => {
  assert.equal(validatePasswordChange('old123', 'abcd', 'abce'), 'New passwords do not match');
});

test('validatePasswordChange: empty old password', () => {
  assert.equal(validatePasswordChange('', 'abcd', 'abcd'), 'Current password is required');
});

test('validatePasswordChange: empty new password', () => {
  assert.equal(validatePasswordChange('old123', '', ''), 'New password is required');
});

test('validatePasswordChange: new password too short', () => {
  assert.equal(validatePasswordChange('old123', 'abc', 'abc'), 'New password must be at least 4 characters');
});

test('validatePasswordChange: empty confirm password', () => {
  assert.equal(validatePasswordChange('old123', 'abcde', ''), 'Please confirm the new password');
});
