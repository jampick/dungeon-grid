import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDeploymentInfo, buildTriggerFilename, TRIGGER_DIR } from '../lib/deployment.js';

test('getDeploymentInfo falls back to unknown when env is empty', () => {
  const info = getDeploymentInfo({});
  assert.equal(info.sha, 'unknown');
  assert.equal(info.shortSha, 'unknown');
  assert.equal(info.subject, 'unknown');
});

test('getDeploymentInfo trims and shortens SHA', () => {
  const full = 'abc1234deadbeefcafe1234567890abcdef01234';
  const info = getDeploymentInfo({
    GIT_SHA: `  ${full}  `,
    GIT_SUBJECT: 'Fix thing',
  });
  assert.equal(info.sha, full);
  assert.equal(info.shortSha, 'abc1234');
  assert.equal(info.subject, 'Fix thing');
});

test('getDeploymentInfo caps subject at 200 chars', () => {
  const long = 'x'.repeat(500);
  const info = getDeploymentInfo({ GIT_SHA: 'abc', GIT_SUBJECT: long });
  assert.equal(info.subject.length, 200);
});

test('buildTriggerFilename produces unique, parseable names', () => {
  const a = buildTriggerFilename(1700000000000, () => 0.123);
  const b = buildTriggerFilename(1700000000000, () => 0.456);
  assert.match(a, /^update-1700000000000-[a-z0-9]+\.req$/);
  assert.notEqual(a, b);
});

test('TRIGGER_DIR is the container-internal path', () => {
  assert.equal(TRIGGER_DIR, '/app/triggers');
});
