import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { EditorError } from '../src/errors.js';

describe('EditorError', () => {
  test('instanceof Error dan EditorError', () => {
    const err = new EditorError('test');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof EditorError);
  });

  test('name === EditorError', () => {
    const err = new EditorError('test');
    assert.equal(err.name, 'EditorError');
  });

  test('message tersimpan dengan benar', () => {
    const err = new EditorError('URL tidak valid');
    assert.equal(err.message, 'URL tidak valid');
  });

  test('cause tersimpan di error chain', () => {
    const cause = new Error('root cause');
    const err   = new EditorError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });

  test('tanpa options tidak throw', () => {
    assert.doesNotThrow(() => new EditorError('ok'));
  });
});
