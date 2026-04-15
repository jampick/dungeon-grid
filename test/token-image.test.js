import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImageReady, chooseTokenImage } from '../lib/logic.js';

test('isImageReady: null/undefined entry is not ready', () => {
  assert.equal(isImageReady(null), false);
  assert.equal(isImageReady(undefined), false);
});

test('isImageReady: loading entry is not ready', () => {
  assert.equal(isImageReady({ img: {}, status: 'loading' }), false);
});

test('isImageReady: error entry is not ready', () => {
  assert.equal(isImageReady({ img: {}, status: 'error' }), false);
});

test('isImageReady: loaded entry with img is ready', () => {
  assert.equal(isImageReady({ img: {}, status: 'loaded' }), true);
});

test('chooseTokenImage: no image url → hasImage false', () => {
  const cache = new Map();
  const res = chooseTokenImage({ name: 'Bob' }, cache);
  assert.equal(res.hasImage, false);
  assert.equal(res.imgRef, null);
});

test('chooseTokenImage: image url + loaded cache → hasImage true, imgRef set', () => {
  const cache = new Map();
  const fakeImg = { fake: true };
  cache.set('/uploads/a.png', { img: fakeImg, status: 'loaded' });
  const res = chooseTokenImage({ name: 'Bob', image: '/uploads/a.png' }, cache);
  assert.equal(res.hasImage, true);
  assert.equal(res.imgRef, fakeImg);
});

test('chooseTokenImage: image url + loading cache → hasImage false', () => {
  const cache = new Map();
  cache.set('/uploads/a.png', { img: {}, status: 'loading' });
  const res = chooseTokenImage({ name: 'Bob', image: '/uploads/a.png' }, cache);
  assert.equal(res.hasImage, false);
  assert.equal(res.imgRef, null);
});

test('chooseTokenImage: image url + error cache → hasImage false', () => {
  const cache = new Map();
  cache.set('/uploads/a.png', { img: {}, status: 'error' });
  const res = chooseTokenImage({ name: 'Bob', image: '/uploads/a.png' }, cache);
  assert.equal(res.hasImage, false);
});

test('chooseTokenImage: image url but not in cache yet → hasImage false', () => {
  const cache = new Map();
  const res = chooseTokenImage({ name: 'Bob', image: '/uploads/missing.png' }, cache);
  assert.equal(res.hasImage, false);
});
