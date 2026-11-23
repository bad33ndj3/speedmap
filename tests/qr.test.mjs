import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageUrl, isLocalOnly } from '../qr.js';

test('QR address contains the page path without private query or fragment', () => {
  assert.equal(pageUrl(new URL('https://example.org/my-app/?token=secret#private')), 'https://example.org/my-app/');
  assert.equal(isLocalOnly('localhost'), true);
  assert.equal(isLocalOnly('127.0.0.1'), true);
  assert.equal(isLocalOnly('example.org'), false);
});
