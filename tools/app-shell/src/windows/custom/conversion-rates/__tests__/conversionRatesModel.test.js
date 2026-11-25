// @covers tools/app-shell/src/windows/custom/conversion-rates/conversionRatesModel.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOpenEnded, displayValidTo, formatWallClock, convertWallClock, createZoneView, formatRangeInZone,
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
    ['synced daily range closing at 00:00 shows 23:59 of that day',
      { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-17T00:00:00', sMFCRSynced: true }, '17/11/2026 23:59'],
    ['synced range closing at another minute shows it as stored',
      { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-17T10:15:00', sMFCRSynced: true }, '17/11/2026 10:15'],
    ['manual range closing at 00:00 keeps 00:00',
      { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-18T00:00:00', sMFCRSynced: false }, '18/11/2026 00:00'],
    ['synced end at 00:00 before its start is not stretched',
      { validFromDate: '2026-11-18T09:00:00', validToDate: '2026-11-17T00:00:00', sMFCRSynced: true }, '17/11/2026 00:00'],
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
  const ui = (key, params) => `${key}:${params.text}|${params.zone}`;
  const view = createZoneView('UTC', 'America/Argentina/Buenos_Aires', new Date('2026-11-25T12:00:00Z'));

  it('shows server wall clock in the viewer zone and sends it back, labelled GMT-3', () => {
    assert.equal(view.show('2026-11-20T10:00:00'), '2026-11-20T07:00:00');
    assert.equal(view.send('2026-11-20T07:00:00'), '2026-11-20T10:00:00');
    assert.equal(view.label, 'GMT-3');
  });

  it('an unknown server zone converts nothing and labels nothing', () => {
    const off = createZoneView('Not/AZone', 'America/Argentina/Buenos_Aires');
    assert.equal(off.active, false);
    assert.equal(off.show('2026-11-20T10:00:00'), '2026-11-20T10:00:00');
    assert.equal(off.label, null);
  });

  it('displayValidTo stretches a synced 00:00 end to 23:59 of the server day, then converts it', () => {
    const row = { validFromDate: '2026-11-17T00:00:00', validToDate: '2026-11-17T00:00:00', sMFCRSynced: true };
    assert.equal(displayValidTo(row, view), '17/11/2026 20:59');
  });

  it('a range names its zone once, after its end, when both ends share it', () => {
    assert.deepEqual(formatRangeInZone('2026-11-01T12:00:00', '2026-11-05T11:59:00', view, ui), {
      from: '01/11/2026 09:00',
      to: 'convRateWithZone:05/11/2026 08:59|GMT-3',
    });
  });

  it('a range across a DST change names the zone after each end', () => {
    const madrid = createZoneView('UTC', 'Europe/Madrid');
    assert.deepEqual(formatRangeInZone('2026-10-20T10:00:00', '2026-10-30T10:00:00', madrid, ui), {
      from: 'convRateWithZone:20/10/2026 12:00|GMT+2',
      to: 'convRateWithZone:30/10/2026 11:00|GMT+1',
    });
  });
});
