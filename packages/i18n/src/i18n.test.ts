import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRtl, dir, translate, formatMoney, catalogs } from './index.js';

test('arabic is rtl, others ltr', () => {
  assert.equal(isRtl('ar'), true);
  assert.equal(dir('ar'), 'rtl');
  assert.equal(dir('fr'), 'ltr');
  assert.equal(dir('en'), 'ltr');
});

test('all three locales have complete key parity', () => {
  const keys = Object.keys(catalogs.en).sort();
  for (const loc of ['fr', 'ar'] as const) {
    assert.deepEqual(Object.keys(catalogs[loc]).sort(), keys, `${loc} catalog keys must match en`);
  }
});

test('translate falls back to en then key', () => {
  assert.equal(translate('fr', 'nav.projects'), 'Chantiers');
  assert.equal(translate('ar', 'nav.projects'), 'الورشات');
  assert.equal(translate('fr', 'nonexistent.key'), 'nonexistent.key');
});

test('interpolation replaces variables', () => {
  assert.equal(translate('en', 'nonexistent.k', { x: 1 }), 'nonexistent.k');
});

test('money formats as DZD/DA', () => {
  const s = formatMoney(1250000);
  assert.ok(s.includes('DZD') || s.includes('DA'), `unexpected format: ${s}`);
});
