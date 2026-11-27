// @covers tools/app-shell/src/windows/custom/fiscal-models/fiscal-models.css
// Source-reading test: the AEAT349 key badge colours (`.fm-key--{E,S,A,I}`) are grouped by
// operation type — sales/issued keys E and S use the information tokens, purchases/received keys
// A and I the warning tokens (key I used to be painted like the sales keys). jsdom does not
// resolve stylesheet colours, so the rule bodies are read as text, same pattern as
// fiscal-models.css.stickyLayout.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Comments stripped so a selector mentioned in prose never counts as a rule.
const css = readFileSync(join(__dirname, '..', 'fiscal-models.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Every rule body whose selector list contains `selector` as an exact entry.
function ruleBodiesFor(selector) {
  const bodies = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectors = m[1].split(',').map(s => s.trim());
    if (selectors.includes(selector)) bodies.push(m[2]);
  }
  return bodies;
}

function assertTokens(selector, role) {
  const bodies = ruleBodiesFor(selector);
  assert.equal(bodies.length, 1, `${selector} must be declared by exactly one rule`);
  const body = bodies[0];
  assert.match(body, new RegExp(`background:\\s*var\\(--status-${role}-bg\\)`));
  assert.match(body, new RegExp(`border-color:\\s*var\\(--status-${role}-border\\)`));
  assert.match(body, new RegExp(`(^|[;\\s])color:\\s*var\\(--status-${role}-fg\\)`));
}

describe('fiscal-models.css — 349 key badge colours grouped by operation type', () => {
  for (const key of ['E', 'S']) {
    it(`.fm-key--${key} (sales/issued) uses the info tokens`, () => {
      assertTokens(`.fm-key--${key}`, 'info');
    });
  }

  for (const key of ['A', 'I']) {
    it(`.fm-key--${key} (purchases/received) uses the warning tokens`, () => {
      assertTokens(`.fm-key--${key}`, 'warning');
    });
  }

  it('no key badge rule mixes in the other group\'s tokens', () => {
    for (const key of ['E', 'S']) {
      assert.doesNotMatch(ruleBodiesFor(`.fm-key--${key}`)[0], /--status-warning-/);
    }
    for (const key of ['A', 'I']) {
      assert.doesNotMatch(ruleBodiesFor(`.fm-key--${key}`)[0], /--status-info-/);
    }
  });
});

// The 349 model tag is the design-system tag palette (app-shell-core components/ui/tag-tokens.js
// VARIANT_STYLES purple). The 303 and 390 are both VAT (IVA) models: they share the green family
// with their own colours outside the palette — lime for the 303, emerald for the 390 — and must
// stay distinguishable from each other.
describe('fiscal-models.css — model tag colours', () => {
  const varOf = (name) => (css.match(new RegExp(`--${name}:\\s*([^;]+);`)) ?? [])[1]?.trim().toUpperCase();

  it('the 349 tag uses its palette pair (VARIANT_STYLES.purple)', () => {
    assert.equal(varOf('fm-model-349-bg'), '#F4F1FD');
    assert.equal(varOf('fm-model-349-fg'), '#4316CA');
  });

  it('the 303 tag uses its own lime', () => {
    assert.equal(varOf('fm-model-303-bg'), '#F7FEE7');
    assert.equal(varOf('fm-model-303-fg'), '#3F6212');
    assert.equal(varOf('fm-model-303-border'), '#D9F99D');
  });

  it('the 303 and 390 tags differ in every colour', () => {
    for (const part of ['bg', 'fg', 'border']) {
      assert.ok(varOf(`fm-model-303-${part}`), `--fm-model-303-${part} is declared`);
      assert.ok(varOf(`fm-model-390-${part}`), `--fm-model-390-${part} is declared`);
      assert.notEqual(varOf(`fm-model-303-${part}`), varOf(`fm-model-390-${part}`));
    }
  });
});
