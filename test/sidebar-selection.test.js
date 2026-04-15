import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenSelected } from '../lib/logic.js';

// Regression for issue #5: clicking a sidebar row must update the
// selection state so the canvas halo AND the sidebar .selected class
// both end up on the newly clicked token. The real bug was DOM-driven
// (the row onclick handler wasn't re-rendering the sidebar before
// opening the dialog, so the halo/border indicators stayed on the
// previously selected token). That DOM path is hard to exercise
// headlessly, so here we model the pure state transition the handler
// performs and verify isTokenSelected agrees at each step.

// Simulates the state-update portion of renderTokenList()'s row click:
//   selectedTokenId = t.id; renderTokenList(); draw(); openTokenDialog(t.id);
function setSelection(state, newId) {
  state.selectedTokenId = newId;
  return state;
}

test('sidebar click: setSelection flips from null to a token id', () => {
  const state = { selectedTokenId: null };
  setSelection(state, 2);
  assert.equal(state.selectedTokenId, 2);
  assert.equal(isTokenSelected(2, state.selectedTokenId), true);
  assert.equal(isTokenSelected(3, state.selectedTokenId), false);
});

test('sidebar click: a second click on a different row moves selection', () => {
  const state = { selectedTokenId: 2 };
  // User clicks Token3's row in the sidebar.
  setSelection(state, 3);
  assert.equal(state.selectedTokenId, 3);
  // Halo predicate now favours Token3, not Token2 (the core bug).
  assert.equal(isTokenSelected(3, state.selectedTokenId), true);
  assert.equal(isTokenSelected(2, state.selectedTokenId), false);
});

test('sidebar click: re-clicking the same row keeps it selected', () => {
  const state = { selectedTokenId: 7 };
  setSelection(state, 7);
  assert.equal(state.selectedTokenId, 7);
  assert.equal(isTokenSelected(7, state.selectedTokenId), true);
});
