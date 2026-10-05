import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePlayingTime, formatClock, generateLineup, recommendFormation } from './engine.ts';
import type { LineupResult } from './engine.ts';
import { FORMAT_DETAILS, FORMATIONS, FORMATS } from './formations.ts';
import type { Format } from './formations.ts';

const roster = (size: number) => Array.from({ length: size }, (_, i) => `Player ${i + 1}`);

const positionChanges = (result: LineupResult) => result.segments.slice(1).flatMap((segment, index) => {
  const previous = new Map(result.segments[index].onField.map(item => [item.player, item.position]));
  return segment.onField.filter(item => previous.has(item.player) && previous.get(item.player) !== item.position);
});

test('12-player 9v9 keeps every continuing player in position, including the goalkeeper', () => {
  for (const formation of FORMATIONS['9v9']) {
    const result = generateLineup({ format: '9v9', players: roster(12), formation: formation.name });
    assert.equal(positionChanges(result).length, 0);
    assert.deepEqual(result, generateLineup({ format: '9v9', players: roster(12), formation: formation.name }));
    for (const [index, segment] of result.segments.entries()) {
      if (!index) continue;
      const previous = result.segments[index - 1];
      const vacancies = previous.onField.filter(item => segment.bench.includes(item.player)).map(item => item.position).sort();
      const filled = segment.onField.filter(item => previous.bench.includes(item.player)).map(item => item.position).sort();
      assert.deepEqual(filled, vacancies);
    }
  }
});

test('stable assignments across formats, full rosters and fixed goalkeepers', () => {
  for (const format of FORMATS) {
    for (const count of [FORMAT_DETAILS[format].onField, FORMAT_DETAILS[format].onField + 3]) {
      for (const goalkeepers of [undefined, ['Player 1']]) {
        const result = generateLineup({ format, players: roster(count), goalkeepers });
        assert.equal(positionChanges(result).length, 0, `${format}/${count}/${goalkeepers}`);
      }
    }
  }
});

test('a compulsory keeper change only moves the two keepers when everyone stays on', () => {
  const result = generateLineup({ format: '9v9', players: roster(9), goalkeepers: ['Player 1', 'Player 2'], segmentsPerPeriod: 3 });
  assert.deepEqual(positionChanges(result).map(item => item.player).sort(), ['Player 1', 'Player 2']);
});

test('explicit rotation choices still apply without designated keepers', () => {
  const input = { format: '9v9' as const, players: roster(9), segmentsPerPeriod: 4 };
  const rotating = generateLineup({ ...input, rotateGoalkeeper: true });
  assert.equal(new Set(rotating.segments.map(segment => segment.onField[0].player)).size, 8);
  const fixed = generateLineup({ ...input, players: roster(12), rotateGoalkeeper: false });
  assert.ok(fixed.segments.every(segment => segment.onField[0].player === 'Player 1'));
  assert.equal(positionChanges(fixed).length, 0);
});

test('incoming preferences are honoured with only the necessary incumbent move', () => {
  const players = roster(12);
  const baseline = generateLineup({ format: '9v9', players });
  const first = baseline.segments[0];
  const next = baseline.segments[1];
  const incumbent = first.onField.find(item => item.position !== 'GK' && next.onField.some(nextItem => nextItem.player === item.player))!;
  const incoming = next.onField.find(item => item.position !== 'GK' && first.bench.includes(item.player))!;
  const result = generateLineup({ format: '9v9', players: players.map(name => ({ name, preferred: name === incoming.player ? [incumbent.position] : [] })) });
  assert.deepEqual(result.minutes, baseline.minutes);
  assert.equal(result.segments[1].onField.find(item => item.player === incoming.player)?.position, incumbent.position);
  assert.equal(positionChanges({ ...result, segments: result.segments.slice(0, 2) }).length, 1);
});

test('clock displays round seconds with carry instead of decimal minutes', () => {
  assert.equal(formatClock(50 / 6), '8:20');
  assert.equal(formatClock(45), '45:00');
  assert.equal(formatClock(59.999), '60:00');
});

test('calculator matches the existing page maths across all valid roster sizes', () => {
  for (const format of FORMATS) {
    const { onField, gameMinutes } = FORMAT_DETAILS[format];
    for (let rosterSize = onField; rosterSize <= 30; rosterSize++) {
      assert.deepEqual(calculatePlayingTime({ format, gameMinutes, rosterSize }), {
        minutesPerPlayer: gameMinutes * onField / rosterSize, percent: onField / rosterSize * 100,
        benchSize: rosterSize - onField, segmentLength: gameMinutes / rosterSize,
        meets50PercentMinimum: rosterSize <= onField * 2
      });
    }
  }
  assert.equal(calculatePlayingTime({ format: '9v9', gameMinutes: 60, rosterSize: 12 }).minutesPerPlayer, 45);
});

test('every formation has exactly one goalkeeper and the right number of distinct positions', () => {
  for (const format of FORMATS) {
    for (const formation of FORMATIONS[format]) {
      assert.equal(formation.positions.length, FORMAT_DETAILS[format].onField);
      assert.equal(new Set(formation.positions).size, formation.positions.length);
      assert.equal(formation.positions[0], 'GK');
    }
  }
});

test('fairness, coverage, period boundaries and no avoidable consecutive bench across formats', () => {
  for (const format of FORMATS) {
    const size = FORMAT_DETAILS[format].onField;
    for (let count = size; count <= 30; count++) {
      for (const periods of [2, 4]) {
        const lineup = generateLineup({ format, players: roster(count), periods, segmentsPerPeriod: 3 });
        const minutes = lineup.minutes.map(item => item.minutes);
        const segmentLength = lineup.gameMinutes / lineup.segments.length;
        assert.ok(Math.max(...minutes) - Math.min(...minutes) <= segmentLength + 1e-9, `${format}/${count}/${periods}: fairness`);
        assert.ok(Math.abs(minutes.reduce((a, b) => a + b) - size * lineup.gameMinutes) < 1e-8);
        for (const [i, segment] of lineup.segments.entries()) {
          assert.equal(segment.onField.length, size);
          assert.equal(new Set([...segment.onField.map(item => item.player), ...segment.bench]).size, count);
          assert.equal(segment.period, Math.floor(i / 3) + 1);
          assert.equal(segment.startMinute, i ? lineup.segments[i - 1].endMinute : 0);
          if (i && count <= 2 * size) assert.ok(segment.bench.every(player => !lineup.segments[i - 1].bench.includes(player)), `${format}/${count}/${periods}: repeated bench ${i}`);
        }
        assert.equal(lineup.segments.at(-1)!.endMinute, lineup.gameMinutes);
      }
    }
  }
});

test('GK-capable players rotate per period and still receive fair total minutes', () => {
  const lineup = generateLineup({ format: '9v9', players: roster(12).map((name, i) => ({ name, canPlayGK: i < 2 })), segmentsPerPeriod: 4 });
  assert.deepEqual(lineup.segments.map(segment => segment.onField[0].player), Array(4).fill('Player 1').concat(Array(4).fill('Player 2')));
  const minutes = lineup.minutes.map(item => item.minutes);
  assert.ok(Math.max(...minutes) - Math.min(...minutes) <= 7.5);
});

test('fixed GK and overlarge rosters report unavoidable constraints honestly', () => {
  const lineup = generateLineup({ format: '7v7', players: roster(10), goalkeepers: ['Player 3', 'Player 1'], rotateGoalkeeper: false });
  assert.ok(lineup.segments.every(segment => segment.onField[0].player === 'Player 3'));
  assert.equal(lineup.minutes[2].minutes, 50);
  const outfield = lineup.minutes.filter(item => item.player !== 'Player 3').map(item => item.minutes);
  assert.ok(Math.max(...outfield) - Math.min(...outfield) <= 50 / lineup.segments.length + 1e-9);
  assert.ok(lineup.notes.some(note => note.includes('prevent equal minutes')));
  const large = generateLineup({ format: '7v7', players: roster(30), goalkeepers: ['Player 1', 'Player 2'] });
  assert.ok(large.notes.some(note => note.includes('consecutive bench')));
});

test('quarter GK rotation honours explicit order and capable-player flags', () => {
  const result = generateLineup({ format: '7v7', periods: 4, segmentsPerPeriod: 2, players: roster(10).map((name, i) => ({ name, canPlayGK: i === 0 })), goalkeepers: ['Player 2'] });
  assert.deepEqual(result.segments.map(segment => segment.onField[0].player), ['Player 2', 'Player 2', 'Player 1', 'Player 1', 'Player 2', 'Player 2', 'Player 1', 'Player 1']);
});

test('look-ahead avoids consecutive benches around future GK duties', () => {
  for (const [format, count, periods, segmentsPerPeriod, keeperCount] of [
    ['7v7', 10, 2, 4, 2], ['7v7', 10, 4, 4, 3], ['9v9', 13, 4, 4, 3], ['11v11', 16, 4, 3, 4]
  ] as const) {
    const players = roster(count);
    const result = generateLineup({ format, players, periods, segmentsPerPeriod, goalkeepers: players.slice(0, keeperCount) });
    const minutes = result.minutes.map(item => item.minutes);
    assert.ok(Math.max(...minutes) - Math.min(...minutes) <= result.gameMinutes / result.segments.length + 1e-9);
    for (let i = 1; i < result.segments.length; i++) {
      assert.ok(result.segments[i].bench.every(player => !result.segments[i - 1].bench.includes(player)), `${format}/${count}/${periods}/${segmentsPerPeriod}`);
    }
  }
});

test('preferences use matching without changing who gets playing time', () => {
  const players = roster(7).map(name => ({ name, preferred: [] as string[] }));
  players[1].preferred = ['LB', 'RB'];
  players[2].preferred = ['LB'];
  const result = generateLineup({ format: '7v7', players, goalkeepers: ['Player 1'] });
  assert.ok(result.segments.every(segment => segment.onField.find(item => item.position === 'LB')?.player === 'Player 3'));
  assert.ok(result.segments.every(segment => segment.onField.find(item => item.position === 'RB')?.player === 'Player 2'));
  assert.ok(result.minutes.every(item => item.minutes === 50));
});

test('generation is deterministic, does not mutate inputs and handles colliding duplicate suffixes', () => {
  const players = ['Alex', 'Alex', 'Alex (2)', 'Sam', 'Jo', 'Max', 'Lou', 'Alex'];
  const before = [...players];
  const input = { format: '7v7' as const, players };
  const result = generateLineup(input);
  assert.deepEqual(result, generateLineup(input));
  assert.deepEqual(players, before);
  assert.deepEqual(result.minutes.map(item => item.player), ['Alex', 'Alex (3)', 'Alex (2)', 'Sam', 'Jo', 'Max', 'Lou', 'Alex (4)']);
});

test('recommendations follow age, explicit format and requested style', () => {
  assert.equal(recommendFormation({ ageGroup: 'U9' }).recommended.name, '1-2-3-1');
  assert.equal(recommendFormation({ ageGroup: 'u11' }).format, '9v9');
  assert.equal(recommendFormation({ ageGroup: 'U14' }).format, '11v11');
  assert.equal(recommendFormation({ ageGroup: 'U9', format: '9v9', style: 'attacking' }).recommended.name, '1-2-3-3');
  assert.equal(recommendFormation({ style: 'defensive' }).recommended.name, '1-3-2-1');
  assert.equal(recommendFormation().alternatives.length, 2);
});

test('invalid inputs produce clear errors', () => {
  const base = { format: '7v7' as const, players: roster(10) };
  for (const [input, pattern] of [
    [{ ...base, players: roster(6) }, /at least 7/],
    [{ ...base, players: roster(31) }, /at most 30/],
    [{ ...base, players: [...roster(7), '   '] }, /non-empty/],
    [{ ...base, format: '5v5' as Format }, /Format/],
    [{ ...base, gameMinutes: NaN }, /Game length/],
    [{ ...base, gameMinutes: 0 }, /Game length/],
    [{ ...base, periods: 3 }, /Periods/],
    [{ ...base, segmentsPerPeriod: 1.5 }, /Segments/],
    [{ ...base, segmentsPerPeriod: 13 }, /Segments/],
    [{ ...base, formation: '1-4-4-2' }, /supported/],
    [{ ...base, goalkeepers: ['Unknown'] }, /goalkeeper/]
  ] as const) assert.throws(() => generateLineup(input), pattern);
  assert.throws(() => recommendFormation({ ageGroup: 'nine' }), /Age group/);
  assert.throws(() => calculatePlayingTime({ format: '9v9', rosterSize: 8, gameMinutes: 60 }), /Roster size/);
});
