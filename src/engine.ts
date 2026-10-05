import { FORMAT_DETAILS, FORMATIONS, getFormation, validateFormat } from './formations.ts';
import type { Format, Style } from './formations.ts';

/** Formats game minutes as a sideline clock, e.g. 8.333 → "8:20". */
export function formatClock(minutes: number): string {
  const totalSeconds = Math.round(minutes * 60);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export type Player = { name: string; canPlayGK?: boolean; preferred?: string[] };
export type LineupInput = {
  players: Array<string | Player>;
  format: Format;
  gameMinutes?: number;
  periods?: number;
  segmentsPerPeriod?: number;
  formation?: string;
  goalkeepers?: string[];
  rotateGoalkeeper?: boolean;
};
export type Segment = {
  index: number;
  period: number;
  startMinute: number;
  endMinute: number;
  onField: Array<{ position: string; player: string }>;
  bench: string[];
};
export type LineupResult = {
  format: Format;
  formation: string;
  gameMinutes: number;
  periods: number;
  segments: Segment[];
  minutes: Array<{ player: string; minutes: number; percent: number }>;
  notes: string[];
};

function numberInRange(value: number, min: number, max: number, label: string, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  }
}

export const CALCULATOR_FORMATS = ['3v3', '4v4', '5v5', '7v7', '9v9', '11v11'] as const;
export type CalculatorFormat = typeof CALCULATOR_FORMATS[number];

export function calculatePlayingTime({ format, gameMinutes, rosterSize }: { format: CalculatorFormat; gameMinutes: number; rosterSize: number }) {
  if (!CALCULATOR_FORMATS.includes(format)) throw new Error('Format must be 3v3, 4v4, 5v5, 7v7, 9v9 or 11v11.');
  const onField = Number(format.split('v')[0]);
  numberInRange(gameMinutes, 10, 120, 'Game length');
  numberInRange(rosterSize, onField, 30, 'Roster size', true);
  return {
    minutesPerPlayer: gameMinutes * onField / rosterSize,
    percent: onField / rosterSize * 100,
    benchSize: rosterSize - onField,
    segmentLength: gameMinutes / rosterSize,
    meets50PercentMinimum: rosterSize <= onField * 2
  };
}

export function recommendFormation({ format, ageGroup, style = 'balanced' }: { format?: Format; ageGroup?: string; style?: Style } = {}) {
  if (ageGroup !== undefined && (typeof ageGroup !== 'string' || !/^U(?:[5-9]|1\d|20)$/i.test(ageGroup.trim()))) {
    throw new Error('Age group must be U5 to U20, for example U9.');
  }
  const age = ageGroup ? Number(ageGroup.trim().slice(1)) : 9;
  const resolved = format ?? (age <= 10 ? '7v7' : age <= 12 ? '9v9' : '11v11');
  validateFormat(resolved);
  if (!['balanced', 'attacking', 'defensive'].includes(style)) throw new Error('Style must be balanced, attacking or defensive.');
  const choice = style === 'balanced' ? 0 : style === 'defensive' ? 1 : resolved === '11v11' ? 0 : 2;
  const options = FORMATIONS[resolved];
  return {
    format: resolved,
    ageGuidance: FORMAT_DETAILS[resolved].ageGroup,
    recommended: { ...options[choice], positions: [...options[choice].positions] },
    alternatives: options.filter((_, index) => index !== choice).map(item => ({ ...item, positions: [...item.positions] }))
  };
}

function normalizePlayers(input: LineupInput['players']): Player[] {
  if (!Array.isArray(input)) throw new Error('Players must be a list of names or player objects.');
  const names = input.map(item => typeof item === 'string' ? item : item?.name);
  if (names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 80)) {
    throw new Error('Each player needs a non-empty name of at most 80 characters.');
  }
  const reserved = new Set(names.map(name => name.trim()));
  const used = new Set<string>();
  return input.map((item, index) => {
    const original = names[index].trim();
    let name = original;
    let suffix = 2;
    if (used.has(name)) {
      do { name = `${original} (${suffix++})`; } while (used.has(name) || reserved.has(name));
    }
    used.add(name);
    const player = typeof item === 'string' ? { name } : { ...item, name };
    if (player.canPlayGK !== undefined && typeof player.canPlayGK !== 'boolean') throw new Error('canPlayGK must be true or false.');
    if (player.preferred !== undefined && (!Array.isArray(player.preferred) || player.preferred.some(position => typeof position !== 'string' || !position.trim()))) {
      throw new Error('Preferred positions must be a list of position names.');
    }
    return { ...player, preferred: player.preferred?.map(position => position.trim().toUpperCase()) };
  });
}

// A small integral max-flow check lets us choose a bench without using minutes
// that a player must spend in goal later. All capacities are segment counts.
function canComplete(remaining: number[], keepers: number[], start: number, size: number, selected: Set<number>): boolean {
  const count = remaining.length;
  const slots = keepers.length - start;
  const source = count + slots;
  const sink = source + 1;
  const graph: Array<Array<{ to: number; reverse: number; capacity: number }>> = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, capacity: number) => {
    graph[from].push({ to, reverse: graph[to].length, capacity });
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0 });
  };
  const needed = [...remaining];
  let total = 0;
  for (let segment = start; segment < keepers.length; segment++) {
    const forced = new Set(segment === start ? selected : []);
    if (keepers[segment] >= 0) forced.add(keepers[segment]);
    if (forced.size > size) return false;
    for (const player of forced) needed[player]--;
    const capacity = size - forced.size;
    total += capacity;
    add(count + segment - start, sink, capacity);
    for (let player = 0; player < count; player++) {
      if (!forced.has(player)) add(player, count + segment - start, 1);
    }
  }
  if (needed.some(value => value < 0) || needed.reduce((a, b) => a + b, 0) !== total) return false;
  needed.forEach((value, player) => add(source, player, value));
  let flow = 0;
  while (flow < total) {
    const previous = new Int32Array(graph.length).fill(-1);
    const edges = new Int32Array(graph.length);
    const queue = [source];
    previous[source] = source;
    for (let i = 0; i < queue.length && previous[sink] < 0; i++) {
      const from = queue[i];
      graph[from].forEach((edge, index) => {
        if (edge.capacity > 0 && previous[edge.to] < 0) {
          previous[edge.to] = from;
          edges[edge.to] = index;
          queue.push(edge.to);
        }
      });
    }
    if (previous[sink] < 0) return false;
    for (let to = sink; to !== source; to = previous[to]) {
      const edge = graph[previous[to]][edges[to]];
      edge.capacity--;
      graph[to][edge.reverse].capacity++;
    }
    flow++;
  }
  return true;
}

function minimumRemaining(player: number, keepers: number[], start: number, size: number, selected: Set<number>, previouslyPlayed: boolean): number {
  let playing = previouslyPlayed ? 0 : Infinity;
  let sitting = previouslyPlayed ? Infinity : 0;
  for (let segment = start; segment < keepers.length; segment++) {
    const mustPlay = keepers[segment] === player || (segment === start && selected.has(player));
    const mustSit = segment === start && selected.size === size && !selected.has(player);
    const nextPlaying = mustSit ? Infinity : Math.min(playing, sitting) + 1;
    sitting = mustPlay ? Infinity : playing;
    playing = nextPlaying;
  }
  return Math.min(playing, sitting);
}

function schedulePlayers(count: number, size: number, keepers: number[]): Set<number>[] {
  const total = keepers.length;
  const targets = Array<number>(count).fill(0);
  const minimums = targets.map((_, player) => minimumRemaining(player, keepers, 0, size, new Set(), true));
  keepers.forEach(keeper => { if (keeper >= 0) targets[keeper]++; });
  // Water-fill the remaining minutes: compulsory GK time is a lower bound.
  for (let slots = total * size - targets.reduce((a, b) => a + b, 0); slots > 0; slots--) {
    const minimum = Math.min(...targets);
    const candidates = targets.flatMap((value, player) => value === minimum ? [player] : []);
    candidates.sort((a, b) => Math.max(0, minimums[b] - targets[b]) - Math.max(0, minimums[a] - targets[a]) || a - b);
    targets[candidates[0]]++;
  }
  const attempt = (avoidRepeats: boolean): Set<number>[] | undefined => {
    const remaining = [...targets];
    const schedule: Set<number>[] = [];
    for (let segment = 0; segment < total; segment++) {
      const selected = new Set<number>();
      if (keepers[segment] >= 0) selected.add(keepers[segment]);
      if (avoidRepeats && segment > 0) {
        for (let player = 0; player < count; player++) {
          if (!schedule[segment - 1].has(player)) selected.add(player);
        }
        if (selected.size > size) return;
      }
      const feasible = () => (!avoidRepeats || remaining.every((value, player) =>
        minimumRemaining(player, keepers, segment, size, selected, segment === 0 || schedule[segment - 1].has(player)) <= value))
        && canComplete(remaining, keepers, segment, size, selected);
      if (!feasible()) return;
      const candidates = Array.from({ length: count }, (_, player) => player).sort((a, b) => {
        const wasBenched = (player: number) => segment > 0 && !schedule[segment - 1].has(player) ? 1 : 0;
        return wasBenched(b) - wasBenched(a) || remaining[b] - remaining[a] || a - b;
      });
      for (const player of candidates) {
        if (selected.size === size) break;
        if (selected.has(player) || remaining[player] === 0) continue;
        selected.add(player);
        if (!feasible()) selected.delete(player);
      }
      if (selected.size !== size) return;
      selected.forEach(player => remaining[player]--);
      schedule.push(selected);
    }
    return schedule;
  };
  const schedule = attempt(true) ?? attempt(false);
  if (!schedule) throw new Error('Unable to schedule these goalkeeper constraints. Try more substitution windows.');
  improveBenchRotation(schedule, keepers, targets);
  return schedule;
}

// Exchange outfield assignments without changing the optimal minute spread.
// Look at both neighbouring windows, including across period breaks.
function improveBenchRotation(schedule: Set<number>[], keepers: number[], counts: number[]) {
  const penalty = (player: number, edges: Set<number>) => [...edges].reduce((sum, edge) =>
    sum + (edge > 0 && edge < schedule.length && !schedule[edge - 1].has(player) && !schedule[edge].has(player) ? 1 : 0), 0);
  let improved = true;
  while (improved) {
    improved = false;
    search: for (let segment = 1; segment < schedule.length; segment++) {
      for (let benched = 0; benched < counts.length; benched++) {
        if (schedule[segment].has(benched) || schedule[segment - 1].has(benched)) continue;
        for (const target of [segment, segment - 1]) {
          for (const field of [...schedule[target]]) {
            if (field === keepers[target]) continue;
            for (let other = -1; other < schedule.length; other++) {
              if (other === target) continue;
              if (other === -1) {
                if (counts[field] !== counts[benched] + 1) continue;
              } else if (!schedule[other].has(benched) || schedule[other].has(field) || keepers[other] === benched) continue;
              const edges = new Set([target, target + 1, ...(other >= 0 ? [other, other + 1] : [])]);
              const before = penalty(benched, edges) + penalty(field, edges);
              schedule[target].delete(field);
              schedule[target].add(benched);
              if (other >= 0) { schedule[other].delete(benched); schedule[other].add(field); }
              const after = penalty(benched, edges) + penalty(field, edges);
              if (after < before) {
                if (other === -1) { counts[benched]++; counts[field]--; }
                improved = true;
                break search;
              }
              schedule[target].delete(benched);
              schedule[target].add(field);
              if (other >= 0) { schedule[other].delete(field); schedule[other].add(benched); }
            }
          }
        }
      }
    }
  }
}

// At most ten outfield positions: weighted matching over subsets is small.
// Honour the maximum number of preferences, then minimise position changes.
// Stable iteration order breaks ties deterministically without moving incumbents.
function assignPositions(players: Player[], selected: number[], positions: string[], previous: number[]): number[] {
  const complete = (1 << positions.length) - 1;
  const scores = new Map<number, number>();
  const choices = new Map<number, number>();
  const match = (mask: number, index: number): number => {
    if (mask === complete) return 0;
    if (scores.has(mask)) return scores.get(mask)!;
    const player = selected[index];
    let best = -Infinity;
    for (let position = 0; position < positions.length; position++) {
      if (mask & (1 << position)) continue;
      const preference = players[player].preferred?.includes(positions[position]) ? positions.length + 1 : 0;
      const stability = previous[position] === player ? 1 : 0;
      const score = preference + stability + match(mask | (1 << position), index + 1);
      if (score > best) {
        best = score;
        choices.set(mask, position);
      }
    }
    scores.set(mask, best);
    return best;
  };
  match(0, 0);
  const assigned = Array<number>(positions.length);
  let mask = 0;
  for (const player of selected) {
    const position = choices.get(mask)!;
    assigned[position] = player;
    mask |= 1 << position;
  }
  return assigned;
}

export function generateLineup(input: LineupInput): LineupResult {
  validateFormat(input.format);
  const { format } = input;
  const details = FORMAT_DETAILS[format];
  if (!Array.isArray(input.players) || input.players.length < details.onField) throw new Error(`${format} needs at least ${details.onField} players.`);
  if (input.players.length > 30) throw new Error('A lineup can have at most 30 players.');
  const players = normalizePlayers(input.players);
  const gameMinutes = input.gameMinutes ?? details.gameMinutes;
  numberInRange(gameMinutes, 10, 120, 'Game length');
  const periods = input.periods ?? 2;
  if (periods !== 2 && periods !== 4) throw new Error('Periods must be 2 (halves) or 4 (quarters).');
  const segmentsPerPeriod = input.segmentsPerPeriod ?? (players.length === details.onField ? 1 : Math.max(2, Math.round(gameMinutes / periods / 8)));
  numberInRange(segmentsPerPeriod, 1, 12, 'Segments per period', true);
  const formation = getFormation(format, input.formation);
  const goalkeeperNames = input.goalkeepers ?? [];
  if (!Array.isArray(goalkeeperNames) || goalkeeperNames.some(name => typeof name !== 'string' || !players.some(player => player.name === name.trim()))) {
    throw new Error('Each goalkeeper must match a player name in the roster. Use the numbered name for a duplicate.');
  }
  const capable = [...new Set([
    ...goalkeeperNames.map(name => players.findIndex(player => player.name === name.trim())),
    ...players.flatMap((player, index) => player.canPlayGK ? [index] : [])
  ])];
  if (input.rotateGoalkeeper !== undefined && typeof input.rotateGoalkeeper !== 'boolean') throw new Error('rotateGoalkeeper must be true or false.');
  const rotate = input.rotateGoalkeeper ?? capable.length > 1;
  const segmentCount = periods * segmentsPerPeriod;
  const keepers = Array.from({ length: segmentCount }, (_, index) => capable.length
    ? capable[rotate ? Math.floor(index / segmentsPerPeriod) % capable.length : 0]
    : input.rotateGoalkeeper === false ? 0 : -1);
  const schedule = schedulePlayers(players.length, details.onField, keepers);
  const appearances = Array<number>(players.length).fill(0);
  const keeperTurns = Array<number>(players.length).fill(0);
  let previous: number[] = [];
  const segments = schedule.map((selected, index): Segment => {
    const ordered = [...selected].sort((a, b) => a - b);
    const incoming = ordered.filter(player => !previous.includes(player));
    const keeper = keepers[index] >= 0 ? keepers[index]
      : input.rotateGoalkeeper !== true && selected.has(previous[0]) ? previous[0]
      : [...(incoming.length ? incoming : ordered)].sort((a, b) => keeperTurns[a] - keeperTurns[b] || a - b)[0];
    keeperTurns[keeper]++;
    selected.forEach(player => appearances[player]++);
    const field = assignPositions(players, ordered.filter(player => player !== keeper), formation.positions.slice(1), previous.slice(1));
    previous = [keeper, ...field];
    return {
      index: index + 1,
      period: Math.floor(index / segmentsPerPeriod) + 1,
      startMinute: index * gameMinutes / segmentCount,
      endMinute: (index + 1) * gameMinutes / segmentCount,
      onField: [keeper, ...field].map((player, position) => ({ position: formation.positions[position], player: players[player].name })),
      bench: players.filter((_, player) => !selected.has(player)).map(player => player.name)
    };
  });
  const notes = [`${segmentCount} equal segments of ${formatClock(gameMinutes / segmentCount)}; times exclude breaks.`];
  if (!capable.length && input.rotateGoalkeeper !== false) notes.push(input.rotateGoalkeeper === true
    ? 'No goalkeepers specified: all players are treated as available in goal and rotate between segments.'
    : 'No goalkeepers specified: all players are treated as available in goal. The keeper stays in goal until benched; an incoming substitute takes over.');
  else notes.push(rotate && capable.length > 1 ? 'Goalkeepers rotate at period breaks in the listed order.' : 'The first designated goalkeeper stays in goal for the full game.');
  if (Math.max(...appearances) - Math.min(...appearances) > 1) notes.push('Goalkeeper commitments prevent equal minutes; remaining playing time is shared as evenly as possible.');
  if (segments.some((segment, index) => index > 0 && segment.bench.some(player => segments[index - 1].bench.includes(player)))) notes.push('Some consecutive bench segments are needed with this roster, goalkeeper schedule and equal-minute allocation.');
  if (players.some((player, index) => player.name !== (typeof input.players[index] === 'string' ? input.players[index] : (input.players[index] as Player).name).trim())) notes.push('Duplicate names have numbered suffixes so each player can be identified.');
  if (players.some(player => player.preferred?.some(position => !formation.positions.includes(position)))) notes.push('Preferences for positions outside this formation could not be used.');
  return {
    format, formation: formation.name, gameMinutes, periods, segments,
    minutes: players.map((player, index) => ({ player: player.name, minutes: appearances[index] * gameMinutes / segmentCount, percent: appearances[index] / segmentCount * 100 })),
    notes
  };
}
