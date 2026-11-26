// @covers tools/app-shell/src/lib/searchText.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchText } from '../searchText.js';

describe('normalizeSearchText', () => {
  const cases = [
    ['lower-cases a mixed-case label', 'Factura rectificativa', 'factura rectificativa'],
    ['leaves an already-normal label unchanged', 'factura rectificativa', 'factura rectificativa'],
    ['strips acute accents', 'Bórrador PÚBLICO', 'borrador publico'],
    ['folds ñ to n (NFD splits it into n + combining tilde)', 'Año ÑANDÚ', 'ano nandu'],
    ['strips cedilla and diaeresis', 'Çà Pingüino', 'ca pinguino'],
    ['keeps spaces and punctuation', ' Nº 12 / Ábaco ', ' nº 12 / abaco '],
    ['turns null into an empty string', null, ''],
    ['turns undefined into an empty string', undefined, ''],
    ['keeps an empty string empty', '', ''],
    ['stringifies a number', 42, '42'],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.equal(normalizeSearchText(input), expected);
    });
  }

  it('lets an unaccented lower-case term match an accented capitalised label', () => {
    const label = normalizeSearchText('Facturas Rectificativas');
    assert.ok(label.includes(normalizeSearchText('rectíf')));
    assert.ok(label.includes(normalizeSearchText('FACT')));
    assert.ok(!label.includes(normalizeSearchText('abono')));
  });
});
