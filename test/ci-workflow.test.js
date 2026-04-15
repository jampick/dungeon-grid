import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('docker-publish workflow exists and targets main with multi-arch', () => {
  const wf = fs.readFileSync('.github/workflows/docker-publish.yml', 'utf8');
  assert.match(wf, /push:[\s\S]*branches:[\s\S]*main/);
  assert.match(wf, /ghcr\.io\/jampick\/dungeon-grid/);
  assert.match(wf, /linux\/amd64/);
  assert.match(wf, /linux\/arm64/);
});
