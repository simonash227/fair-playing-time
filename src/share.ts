import { FORMAT_DETAILS, getFormation, validateFormat } from './formations.ts';
import type { LineupResult } from './engine.ts';

const MAX_PAYLOAD_LENGTH = 100_000;

export function encodeLineup(result: LineupResult): string {
  const names = result.minutes.map(item => item.player);
  const payload = {
    v: 1,
    f: result.format,
    r: result.formation,
    t: result.gameMinutes,
    p: result.periods,
    n: names,
    s: result.segments.map(segment => segment.onField.map(item => names.indexOf(item.player))),
    x: result.notes
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (encoded.length > MAX_PAYLOAD_LENGTH) throw new Error('This lineup is too large to share.');
  return encoded;
}

export function decodeLineup(encoded: string): LineupResult {
  if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_PAYLOAD_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('This lineup link is invalid or too large. Create a new lineup below.');
  }
  let data;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  } catch {
    throw new Error('This lineup link could not be decoded. Create a new lineup below.');
  }
  if (!data || typeof data !== 'object' || data.v !== 1) throw new Error('This lineup link uses an unsupported version.');
  const format: unknown = data.f;
  validateFormat(format);
  const formation = getFormation(format, data.r);
  const size = FORMAT_DETAILS[format].onField;
  const valid = typeof data.r === 'string'
    && Number.isFinite(data.t) && data.t >= 10 && data.t <= 120
    && (data.p === 2 || data.p === 4)
    && Array.isArray(data.n) && data.n.length >= size && data.n.length <= 30
    && data.n.every((name: unknown) => typeof name === 'string' && name.trim().length > 0 && name.length <= 85)
    && new Set(data.n).size === data.n.length
    && Array.isArray(data.s) && data.s.length >= data.p && data.s.length <= data.p * 12 && data.s.length % data.p === 0
    && data.s.every((segment: unknown) => Array.isArray(segment) && segment.length === size && new Set(segment).size === size
      && segment.every(player => Number.isInteger(player) && player >= 0 && player < data.n.length))
    && Array.isArray(data.x) && data.x.length <= 20
    && data.x.every((note: unknown) => typeof note === 'string' && note.length <= 500);
  if (!valid) throw new Error('This lineup link contains invalid lineup data. Create a new lineup below.');
  const names: string[] = data.n;
  const assignments: number[][] = data.s;
  const appearances = Array<number>(names.length).fill(0);
  const segments = assignments.map((field, index) => {
    field.forEach(player => appearances[player]++);
    return {
      index: index + 1,
      period: Math.floor(index / (assignments.length / data.p)) + 1,
      startMinute: index * data.t / assignments.length,
      endMinute: (index + 1) * data.t / assignments.length,
      onField: field.map((player, position) => ({ position: formation.positions[position], player: names[player] })),
      bench: names.filter((_, player) => !field.includes(player))
    };
  });
  return {
    format, formation: data.r, gameMinutes: data.t, periods: data.p, segments,
    minutes: names.map((player, index) => ({ player, minutes: appearances[index] * data.t / assignments.length, percent: appearances[index] / assignments.length * 100 })),
    notes: data.x
  };
}

export function buildShareUrl(result: LineupResult): string {
  return `https://pitchtime.app/lineup#${encodeLineup(result)}`;
}
