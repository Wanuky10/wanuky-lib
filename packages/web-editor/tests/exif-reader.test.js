import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { orientasiKeTransform } from '../src/exif-reader.js';

// orientasiKeTransform adalah fungsi murni — dapat diuji di Node.js

describe('orientasiKeTransform', () => {
  test('orientasi 1 = normal (tidak ada transform)', () => {
    const t = orientasiKeTransform(1);
    assert.equal(t.rotate, 0);
    assert.equal(t.flipH, false);
    assert.equal(t.flipV, false);
  });

  test('orientasi 3 = 180 derajat', () => {
    const t = orientasiKeTransform(3);
    assert.equal(t.rotate, 180);
    assert.equal(t.flipH, false);
  });

  test('orientasi 6 = 90 derajat CW (foto portrait iPhone)', () => {
    const t = orientasiKeTransform(6);
    assert.equal(t.rotate, 90);
    assert.equal(t.flipH, false);
    assert.equal(t.flipV, false);
  });

  test('orientasi 8 = 270 derajat', () => {
    const t = orientasiKeTransform(8);
    assert.equal(t.rotate, 270);
    assert.equal(t.flipH, false);
  });

  test('orientasi 2 = flip horizontal', () => {
    const t = orientasiKeTransform(2);
    assert.equal(t.rotate, 0);
    assert.equal(t.flipH, true);
    assert.equal(t.flipV, false);
  });

  test('orientasi tidak valid → fallback ke orientasi 1', () => {
    const t = orientasiKeTransform(99);
    assert.equal(t.rotate, 0);
    assert.equal(t.flipH, false);
    assert.equal(t.flipV, false);
  });

  test('undefined → fallback ke orientasi 1', () => {
    const t = orientasiKeTransform(undefined);
    assert.equal(t.rotate, 0);
  });

  test('semua orientasi 1-8 memiliki properti rotate, flipH, flipV', () => {
    for (let i = 1; i <= 8; i++) {
      const t = orientasiKeTransform(i);
      assert.ok('rotate' in t, `orientasi ${i} tidak memiliki rotate`);
      assert.ok('flipH'  in t, `orientasi ${i} tidak memiliki flipH`);
      assert.ok('flipV'  in t, `orientasi ${i} tidak memiliki flipV`);
    }
  });
});
