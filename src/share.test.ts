import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLineup } from './engine.ts';
import { buildShareUrl, decodeLineup, encodeLineup } from './share.ts';
import { FORMATS } from './formations.ts';

test('share round-trip preserves Unicode names, all positions, minutes, notes and timings', () => {
  for (const format of FORMATS) {
    const result = generateLineup({ format, players: ['José', 'Zoë', '李明', '⚽ Alex', '<img src=x onerror=alert(1)>', 'Jo', 'Sam', 'Noor', 'Lou', 'Max', 'Mia', 'Leo'], periods: 4, segmentsPerPeriod: 3 });
    assert.deepEqual(decodeLineup(encodeLineup(result)), result);
    const url = new URL(buildShareUrl(result));
    assert.equal(url.origin + url.pathname, 'https://pitchtime.app/lineup');
    assert.equal(url.search, '');
    assert.match(url.hash, /^#[A-Za-z0-9_-]+$/);
    assert.ok(url.href.length < 3000);
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(url.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))));
    assert.equal(payload.v, 1);
    assert.equal(payload.n.filter((name: string) => name === 'José').length, 1);
    assert.ok(payload.s.flat().every((index: unknown) => typeof index === 'number'));
  }
});

test('decoder rejects corrupt, oversized, unsupported and structurally invalid payloads', () => {
  const pack = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  for (const input of ['', '%notbase64', 'x'.repeat(100001), pack(null), pack({ v: 2 }), pack({ v: 1, f: '7v7' })]) {
    assert.throws(() => decodeLineup(input));
  }
  const result = generateLineup({ format: '7v7', players: Array.from({ length: 10 }, (_, i) => `P${i}`) });
  const payload = JSON.parse(atob(encodeLineup(result).replace(/-/g, '+').replace(/_/g, '/')));
  for (const changes of [{ t: -1 }, { p: 3 }, { n: ['a'] }, { s: [[0, 0, 0, 0, 0, 0, 0]] }, { s: payload.s.map(() => [0, 1, 2, 3, 4, 5, 90]) }, { x: [{}] }]) {
    assert.throws(() => decodeLineup(pack({ ...payload, ...changes })));
  }
});
