// @covers tools/app-shell/src/windows/custom/conversion-rates/conversionRatesModel.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @covers tools/app-shell/src/windows/custom/conversion-rates/conversionRatesModel.js
import {
  isOpenEnded, displayValidTo, displayValidFrom, formatWallClock, convertWallClock, createZoneView,
  isCalendarDayRow, formatCalendarDay, formatStartInSentence, currentRateRow, zoneName, overlapMessage,
} from '../conversionRatesModel.js';

describe('isOpenEnded', () => {
  for (const [validTo, expected] of [
    ['9999-12-31T00:00:00', true],
    ['2999-12-31T00:00:00', true],
    ['2998-12-31T23:59:00', false],
    ['2026-11-17T00:00:00', false],
    [null, true],
    ['', true],
  ]) {
    it(`${JSON.stringify(validTo)} → ${expected}`, () => {
      assert.equal(isOpenEnded(validTo), expected);
    });
  }
});

describe('displayValidTo', () => {
  for (const [label, row, expected] of [
    ['open range (9999) shows no end', { validFromDate: '2026-11-01T00:00:00', validToDate: '9999-12-31T00:00:00' }, null],
    ['open range (2999) shows no end', { validFromDate: '2026-11-01T00:00:00', validToDate: '2999-12-31T00:00:00', sMFCRSynced: true }, null],
    ['synced daily range closing at 00:00 shows that day (a range of days)',
      { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-17T00:00:00', sMFCRSynced: true }, '17/11/2026'],
    ['synced range closing at another minute shows its day',
      { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-17T10:15:00', sMFCRSynced: true }, '17/11/2026'],
    ['date-only manual range (00:00 → 00:00) shows its day',
      { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-18T00:00:00', sMFCRSynced: false }, '18/11/2026'],
    ['manual range entered here keeps its minute',
      { validFromDate: '2026-11-17T09:30:00', validToDate: '2026-11-18T14:29:00', sMFCRSynced: false }, '18/11/2026 14:29'],
  ]) {
    it(label, () => {
      assert.equal(displayValidTo(row), expected);
    });
  }
});

describe('formatWallClock', () => {
  it('shows the stored wall clock as dd/MM/yyyy HH:mm, without timezone shift', () => {
    assert.equal(formatWallClock('2026-01-02T00:05:59'), '02/01/2026 00:05');
  });

  it('is empty for an unparseable value', () => {
    assert.equal(formatWallClock('not a date'), '');
  });
});

describe('convertWallClock (server zone ↔ viewer zone)', () => {
  for (const [label, raw, from, to, expected] of [
    ['UTC → Buenos Aires is 3 h earlier', '2026-11-20T10:00:00', 'UTC', 'America/Argentina/Buenos_Aires', '2026-11-20T07:00:00'],
    ['Buenos Aires → UTC crosses midnight', '2026-11-20T22:30:00', 'America/Argentina/Buenos_Aires', 'UTC', '2026-11-21T01:30:00'],
    ['UTC → Madrid in summer (CEST, +2)', '2026-07-15T12:00:00', 'UTC', 'Europe/Madrid', '2026-07-15T14:00:00'],
    ['UTC → Madrid in winter (CET, +1)', '2026-01-15T12:00:00', 'UTC', 'Europe/Madrid', '2026-01-15T13:00:00'],
    ['Madrid → UTC on the day DST ends', '2026-10-25T12:00:00', 'Europe/Madrid', 'UTC', '2026-10-25T11:00:00'],
    ['same zone: unchanged', '2026-11-20T10:00:59', 'UTC', 'UTC', '2026-11-20T10:00:59'],
    ['missing zone: unchanged', '2026-11-20T10:00:00', null, 'UTC', '2026-11-20T10:00:00'],
    ['open end: unchanged', '9999-12-31T00:00:00', 'UTC', 'America/Argentina/Buenos_Aires', '9999-12-31T00:00:00'],
    ['unparseable: unchanged', 'not a date', 'UTC', 'America/Argentina/Buenos_Aires', 'not a date'],
  ]) {
    it(label, () => {
      assert.equal(convertWallClock(raw, from, to), expected);
    });
  }
});

describe('createZoneView', () => {
  const view = createZoneView('UTC', 'America/Argentina/Buenos_Aires', new Date('2026-11-25T12:00:00Z'), 'es_ES');

  it('shows server wall clock in the viewer zone and sends it back, named as a region (QA CP-2/7/11)', () => {
    assert.equal(view.show('2026-11-20T10:00:00'), '2026-11-20T07:00:00');
    assert.equal(view.send('2026-11-20T07:00:00'), '2026-11-20T10:00:00');
    assert.equal(view.label, zoneName('America/Argentina/Buenos_Aires', { locale: 'es_ES' }));
    assert.match(view.label, /Argentina/);
    // «hora de Buenos Aires» does not fit a date field: its suffix falls back to the offset.
    assert.equal(view.compactLabel, 'GMT-3');
  });

  it('an unknown server zone converts nothing and labels nothing', () => {
    const off = createZoneView('Not/AZone', 'America/Argentina/Buenos_Aires');
    assert.equal(off.active, false);
    assert.equal(off.show('2026-11-20T10:00:00'), '2026-11-20T10:00:00');
    assert.equal(off.label, null);
  });

  it('a downloaded range is a calendar day for every viewer: never moved to the day before (QA CP-3)', () => {
    const row = { validFromDate: '2026-11-26T00:00:00', validToDate: '2026-11-26T00:00:00', sMFCRSynced: true };
    assert.equal(displayValidFrom(row, view), '26/11/2026');
    assert.equal(displayValidTo(row, view), '26/11/2026');
    assert.equal(formatStartInSentence(row, view, (k, p) => `${k}${JSON.stringify(p)}`), '26/11/2026');
  });

  it('a manual range is converted and named', () => {
    const row = { validFromDate: '2026-11-26T12:00:00', validToDate: '2999-12-31T00:00:00', sMFCRSynced: false };
    assert.equal(displayValidFrom(row, view), '26/11/2026 09:00');
    assert.equal(formatStartInSentence(row, view, (k, p) => `${p.text} (${p.zone})`), `26/11/2026 09:00 (${view.label})`);
  });
});

describe('isCalendarDayRow', () => {
  for (const [label, row, expected] of [
    ['downloaded', { validFromDate: '2026-11-26T00:00:00', validToDate: '2026-11-26T00:00:00', sMFCRSynced: true }, true],
    ['date-only manual, open', { validFromDate: '2026-11-26T00:00:00', validToDate: '2999-12-31T00:00:00' }, true],
    ['entered here at 09:00', { validFromDate: '2026-11-26T09:00:00', validToDate: '2999-12-31T00:00:00' }, false],
    ['entered here at 00:00, closed at 08:59', { validFromDate: '2026-11-26T00:00:00', validToDate: '2026-11-27T08:59:00' }, false],
    ['no row', null, false],
  ]) {
    it(`${label} → ${expected}`, () => assert.equal(isCalendarDayRow(row), expected));
  }

  it('formatCalendarDay reads the day literally', () => {
    assert.equal(formatCalendarDay('2026-11-26T00:00:00'), '26/11/2026');
    assert.equal(formatCalendarDay('2026-11-26'), '26/11/2026');
    assert.equal(formatCalendarDay(null), '');
  });

  it('currentRateRow takes the listed row, else the origin of currentRates', () => {
    const listed = { validFromDate: '2026-11-26T00:00:00', validToDate: '2026-11-26T00:00:00', sMFCRSynced: true };
    assert.equal(currentRateRow({ validFrom: listed.validFromDate, rows: [listed] }), listed);
    assert.equal(currentRateRow({ validFrom: '2026-11-26T10:00:00', automatic: true, rows: [] }).sMFCRSynced, true);
    assert.equal(currentRateRow({ validFrom: null }), null);
  });
});

describe('zoneName', () => {
  const epoch = Date.UTC(2026, 10, 25, 12);
  it('names UTC by its offset', () => assert.equal(zoneName('UTC', { epoch, locale: 'es_ES' }), 'GMT'));
  it('falls back to the offset for an abbreviation in compact form', () => {
    assert.equal(zoneName('Europe/Madrid', { epoch, locale: 'es_ES', compact: true }), 'GMT+1');
  });
  it('is a readable region name in full form', () => {
    assert.match(zoneName('Europe/Madrid', { epoch, locale: 'es_ES' }), /\p{Ll}/u);
  });
});

describe('overlapMessage (QA CP-13)', () => {
  const view = createZoneView('UTC', 'America/Argentina/Cordoba', new Date('2026-11-26T15:00:00Z'), 'es_ES');
  const ui = (key, p) => (key === 'convRateWithZone' ? `${p.text} (${p.zone})` : `${key}${JSON.stringify(p ?? {})}`);
  const details = {
    conflictFrom: '2026-11-26T12:00:00', conflictTo: null, conflictOpen: true,
    suggestedFrom: '2026-11-26T12:00:00', timeZone: 'UTC',
  };

  it('words the server instants in the viewer zone, naming it once', () => {
    const text = overlapMessage(details, { fromIso: 'EUR', toIso: 'CHF' }, view, ui);
    assert.match(text, /"start":"26\/11\/2026 09:00"/);
    assert.match(text, /"end":"convRateNoEndDate\{\}"/);
    assert.ok(text.includes(`"suggested":"26/11/2026 09:00 (${view.label})"`), text);
    assert.ok(!text.includes('12:00'), text);
  });

  it('without a zone view it keeps server time and names the server zone', () => {
    const off = createZoneView(null);
    const text = overlapMessage(details, { fromIso: 'EUR', toIso: 'CHF' }, off, ui);
    assert.ok(text.includes('"suggested":"26/11/2026 12:00 (UTC)"'), text);
  });

  it('answers null without details, so the server text is kept', () => {
    assert.equal(overlapMessage(null, { fromIso: 'EUR', toIso: 'CHF' }, view, ui), null);
  });
});
