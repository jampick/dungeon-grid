import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHelpSectionsForRole, HELP_SECTIONS } from '../lib/help.js';

test('DM gets every help section', () => {
  const got = getHelpSectionsForRole('dm');
  assert.equal(got.length, HELP_SECTIONS.length);
  for (const s of HELP_SECTIONS) {
    assert.ok(got.find(g => g.id === s.id), `missing ${s.id}`);
  }
});

test('Player does not get DM-only sections (walls, maps, undo)', () => {
  const got = getHelpSectionsForRole('player');
  const ids = got.map(s => s.id);
  assert.ok(!ids.includes('help-walls'),  'player should not see walls');
  assert.ok(!ids.includes('help-maps'),   'player should not see maps');
  assert.ok(!ids.includes('help-undo'),   'player should not see undo');
  // None of the returned sections are marked dmOnly.
  for (const s of got) assert.equal(s.dmOnly, false);
});

test('Shared sections appear for both DM and player', () => {
  const dm = getHelpSectionsForRole('dm').map(s => s.id);
  const pl = getHelpSectionsForRole('player').map(s => s.id);
  const shared = [
    'help-getting-started',
    'help-tokens',
    'help-fog',
    'help-chat',
    'help-interface',
  ];
  for (const id of shared) {
    assert.ok(dm.includes(id),  `DM missing ${id}`);
    assert.ok(pl.includes(id),  `player missing ${id}`);
  }
});

test('Unknown role is treated like a player', () => {
  const got = getHelpSectionsForRole(undefined);
  const ids = got.map(s => s.id);
  assert.ok(!ids.includes('help-walls'));
  assert.ok(!ids.includes('help-maps'));
  assert.ok(!ids.includes('help-undo'));
});
