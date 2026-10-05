# fair-playing-time

Plan equal playing time, bench rotations and goalkeeper duties for youth soccer
(football). This deterministic TypeScript engine generates a full match plan for
7v7, 9v9 or 11v11, with positions, substitutions and minutes for every player.
It runs locally, has zero runtime dependencies and makes no network requests.

Equal minutes become harder when players must stay in goal, substitutions happen
at fixed intervals, and nobody should sit out twice in a row. The engine allocates
whole substitution windows, reserves goalkeeper duties, then assigns outfield
positions while respecting preferences and keeping continuing players in place
where possible.

## Install

Use Node.js 23 or later and an ESM project (`"type": "module"` in `package.json`,
or a `.mjs` file). Once this repository is published on GitHub:

```sh
npm install github:simonash227/fair-playing-time
```

The GitHub address above is the intended publication location. This checkout can
also be installed before publication:

```sh
cd fair-playing-time
npm ci
npm pack
# From your application's directory, using the actual path to the tarball:
npm install /path/to/fair-playing-time/fair-playing-time-1.0.0.tgz
```

The `prepare` script builds JavaScript and declarations during Git installs and
packing. TypeScript is a development dependency only; the installed package uses
the compiled ESM in `dist/`. Git installs need npm lifecycle scripts enabled.

## Generate a lineup

```js
import { generateLineup, formatClock } from 'fair-playing-time';

const players = [
  'Alex', 'Blair', 'Casey', 'Drew', 'Ellis', 'Frankie',
  'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Lou',
];

const lineup = generateLineup({
  players,
  format: '9v9',
  gameMinutes: 60,
  periods: 2,
  segmentsPerPeriod: 4,
  goalkeepers: ['Alex', 'Blair'],
});

console.table(lineup.segments.map(segment => ({
  window: segment.index,
  time: `${formatClock(segment.startMinute)}–${formatClock(segment.endMinute)}`,
  goalkeeper: segment.onField[0].player,
  bench: segment.bench.join(', '),
})));
console.table(lineup.minutes);
console.log(lineup.notes);
// Each segment.onField contains every { position, player } assignment.
```

Actual output for this roster, using formation `1-3-2-3`:

| Window | Time | Goalkeeper | Bench |
| --- | --- | --- | --- |
| 1 | 0:00–7:30 | Alex | Jules, Kai, Lou |
| 2 | 7:30–15:00 | Alex | Blair, Harper, Indy |
| 3 | 15:00–22:30 | Alex | Ellis, Frankie, Gray |
| 4 | 22:30–30:00 | Alex | Blair, Casey, Drew |
| 5 | 30:00–37:30 | Blair | Alex, Kai, Lou |
| 6 | 37:30–45:00 | Blair | Harper, Indy, Jules |
| 7 | 45:00–52:30 | Blair | Ellis, Frankie, Gray |
| 8 | 52:30–60:00 | Blair | Alex, Casey, Drew |

All 12 players receive **45 minutes (75%)**: six windows each. Alex and Blair each
spend 30 minutes in goal and 15 outfield. The nine players not listed on the bench
are on the field in each row; positions are included in `onField`. The first window is
GK Alex, LB Blair, CB Casey, RB Drew, LCM Ellis, RCM Frankie, LW Gray, ST Harper and
RW Indy. Half-time is at 30:00; break time is excluded from the clock.

### `generateLineup(input): LineupResult`

| Input | Meaning and default |
| --- | --- |
| `players` | Required array of names or `Player` objects; between the format's field size and 30 players. |
| `format` | Required: `'7v7'`, `'9v9'` or `'11v11'`. |
| `gameMinutes` | Number from 10 to 120. Defaults to 50, 60 or 70 respectively. |
| `periods` | `2` for halves (default) or `4` for quarters. |
| `segmentsPerPeriod` | Integer from 1 to 12. Defaults to 1 with no substitutes; otherwise `max(2, round(gameMinutes / periods / 8))`. |
| `formation` | A supported formation name including the goalkeeper, e.g. `'1-3-2-3'`. Defaults to the first formation for the format. |
| `goalkeepers` | Ordered array of roster names. Explicit names come before players marked `canPlayGK`; duplicates are removed. |
| `rotateGoalkeeper` | Defaults to rotation when there is more than one designated goalkeeper. See the rules below. |

`Player` is `{ name: string, canPlayGK?: boolean, preferred?: string[] }`. Names
are trimmed, must be non-empty and at most 80 characters. Repeated names receive
unique numbered suffixes, avoiding existing names such as `Alex (2)`. Goalkeeper
names must match the normalized names, including suffixes for duplicate players.

Preferences are outfield position labels, such as `{ name: 'Alex', preferred:
['LB', 'CM'] }`. Labels are trimmed and uppercased. Preferences are soft: they do
not change the playing-time allocation, and unavailable positions produce a note.
`canPlayGK: false` does not exclude a player from goal if no goalkeepers have been
designated; designate keepers explicitly when availability is restricted.

Goalkeeper rules:

- With multiple designated keepers and rotation enabled, keepers switch at period
  breaks in order, cycling through the list. With more keepers than periods, some
  will not have a turn in goal during this match.
- With one designated keeper, or `rotateGoalkeeper: false`, the first designated
  keeper stays in goal all match. Without any designation, `false` fixes the first
  roster player in goal.
- Without designated keepers and with rotation unspecified, everyone is eligible;
  the keeper stays in goal until benched and an incoming player takes over.
- Without designated keepers and with `rotateGoalkeeper: true`, the engine chooses
  a keeper each window, preferring incoming players with fewer turns in goal.
  This does not guarantee equal goalkeeper minutes.

The result includes `format`, `formation`, `gameMinutes`, `periods`, `segments`,
`minutes` and `notes`. Segment and period indices start at 1. Every segment has
`startMinute`, `endMinute`, `onField` and `bench`. The minutes array follows roster
order, with `{ player, minutes, percent }` for each player. Percentages run from
0 to 100. Invalid inputs throw `Error`; callers should handle errors and display
the returned notes alongside the plan.

## Calculate the equal-time target

```js
import { calculatePlayingTime } from 'fair-playing-time';

console.log(calculatePlayingTime({
  format: '9v9',
  gameMinutes: 60,
  rosterSize: 12,
}));
// {
//   minutesPerPlayer: 45,
//   percent: 75,
//   benchSize: 3,
//   segmentLength: 5,
//   meets50PercentMinimum: true
// }
```

`minutesPerPlayer = gameMinutes × onField / rosterSize` is a mathematical target.
The calculator accepts `'3v3'`, `'4v4'`, `'5v5'`, `'7v7'`, `'9v9'` and `'11v11'`,
10–120 minutes, and a roster from the field size through 30 players. Lineup
generation remains limited to 7v7, 9v9 and 11v11. The calculator does not take
goalkeeper constraints or substitution windows into
account. Its `segmentLength` is `gameMinutes / rosterSize`, a suggested interval;
it is **not** the generator's chosen interval (7.5 minutes in the lineup above).
`meets50PercentMinimum` means the equal-share target reaches 50%, not that every
player in a generated plan reaches 50% or that a league's rules are satisfied.

## Recommend a formation

```js
import { recommendFormation } from 'fair-playing-time';

const advice = recommendFormation({ ageGroup: 'U11', style: 'balanced' });
console.log(advice.format);                    // '9v9'
console.log(advice.recommended.name);          // '1-3-2-3'
console.log(advice.recommended.positions);     // GK, LB, CB, RB, LCM, RCM, LW, ST, RW
console.log(advice.alternatives.map(f => f.name)); // ['1-3-3-2', '1-2-3-3']
```

`recommendFormation({ format?, ageGroup?, style? } = {})` accepts styles
`'balanced'` (default), `'attacking'` and `'defensive'`. An explicit format takes
precedence. Age input is case-insensitive U5–U20; the fallback selects 7v7 through
U10, 9v9 at U11–U12 and 11v11 from U13. With no arguments it uses 7v7. These are
simple coaching defaults, including the fallback for ages below U8; check your
competition's actual format and match length.

| Format | Available formations (first is the default) |
| --- | --- |
| 7v7 | `1-2-3-1`, `1-3-2-1`, `1-2-2-2` |
| 9v9 | `1-3-2-3`, `1-3-3-2`, `1-2-3-3` |
| 11v11 | `1-4-3-3`, `1-4-4-2`, `1-3-5-2` |

## Format a sideline clock

```js
import { formatClock } from 'fair-playing-time';

console.log(formatClock(50 / 6)); // '8:20'
console.log(formatClock(59.999)); // '60:00'
```

`formatClock(minutes)` rounds to the nearest second with minute carry. Pass a
finite, non-negative minute value; this display helper does not validate inputs.
Keep the unrounded numeric values for calculations.

## Encode, decode and share

```js
import { buildShareUrl, decodeLineup, encodeLineup } from 'fair-playing-time';

// `lineup` is the result from generateLineup above.
const encoded = encodeLineup(lineup);
const restored = decodeLineup(encoded);
const shareUrl = buildShareUrl(restored);
// https://pitchtime.app/lineup#<base64url-payload>
```

All three helpers are also exported from `fair-playing-time/share`.
`encodeLineup` produces a versioned base64url string; `decodeLineup` reconstructs
positions, benches, timings and minutes and validates the payload's structure.
Unicode names are preserved. Encoded payloads are capped at 100,000 characters.
Use the encoder with a generated `LineupResult`; decoding is not a proof of
fairness or authenticity.

`buildShareUrl` only constructs a URL; it does not upload or store the lineup.
Anyone with the fragment can read the names and plan: base64url is not encryption.
Treat decoded names as text when rendering them. Long links may exceed limits in
other applications, and the hosted viewer can change independently of this
package. The encoder and decoder also work without using the hosted viewer.

## Public exports and types

The root entry point exports the four engine functions above, the three share
helpers, and `CALCULATOR_FORMATS`, `FORMATS`, `FORMAT_DETAILS`, `FORMATIONS`, `getFormation(format,
name?)` and `validateFormat(value)`. The latter throws for unsupported formats;
`getFormation` returns the requested formation, or the default when omitted.
Treat the exported formation objects as read-only configuration.

Compiled subpaths are `fair-playing-time/engine`, `fair-playing-time/formations`
and `fair-playing-time/share`. TypeScript consumers can import the public types:

```ts
import type {
  CalculatorFormat, Format, Formation, Style, Player, LineupInput, LineupResult, Segment,
} from 'fair-playing-time';
```

## Fairness guarantees as tested

The included [engine tests](src/engine.test.ts) check all three formats, every
roster size from the field size through 30, halves and quarters, with three
windows per period and no designated goalkeepers. Across that matrix:

- Player totals differ by at most one window; total player-minutes equal field
  size multiplied by match length.
- Every window has the correct number on field and every player is accounted
  for on the field or bench. Windows are contiguous, respect period boundaries
  and cover the entire match.
- Nobody sits out consecutive windows when the roster is at most twice the
  field size, including across period breaks.

Additional cases test fixed and rotating keepers, fair allocation of remaining
outfield time with a fixed keeper, avoidance of consecutive benches around future
keeper duties, stable positions, preferences without changed minutes, input
validation, duplicate names, deterministic output and unmodified input arrays.
The [share tests](src/share.test.ts) check lossless round trips across formats
with Unicode names and rejection of corrupt or structurally invalid payloads.

These are guarantees exercised by those tests, not a proof for every combination
of options. The engine spreads available slots as evenly as possible subject to
keeper duties, and tries to reduce consecutive benches without sacrificing the
minute allocation. The bench optimization is heuristic; its note that consecutive
benches are "needed" should not be treated as a proof that no better schedule
exists for an arbitrary constrained case.

## Limitations

- Equality is measured in whole windows. Exact equal minutes may be impossible;
  roster order breaks ties deterministically, so the same order can favor the
  same players across matches. There is no season-long fairness history.
- A fixed keeper or mandatory period in goal can exceed a player's equal share.
  Inspect `minutes` and `notes` instead of assuming everyone gets the same total.
- Large benches can force consecutive sits. Very large rosters with few windows
  can leave some players without minutes.
- Only the built-in formats and formations, equal-length periods/windows and one
  goalkeeper at a time are supported. There is no custom formation, arrival time,
  injury handling, live rescheduling, substitution limit or stoppage-time model.
- Preferences are soft and there is no skill balancing or guarantee of equal
  time in each position. Availability in goal should be explicitly specified.
- Age guidance and the 50% calculator flag do not encode competition rules.
  Adjust the plan to local rules and make substitutions at permitted stoppages.
- Generation is synchronous. The documented bounds are validated, but no
  performance guarantee is made for every maximum-size input.

## Development

```sh
npm ci
npm test
npm run build
npm pack --dry-run
```

Tests use Node's built-in runner and run directly on the erasable TypeScript;
they need no installed dependencies. `npm test` enables type stripping explicitly
for early Node 23 releases. On Node 23.6+ this also works:

```sh
node --test src/*.test.ts
```

The build checks the library in strict mode and emits ESM `.js` and `.d.ts` files
for the root entry point, engine, formations and share helpers. Tests are excluded
from `dist/`. Relative `.ts` runtime imports become `.js` in the compiled output.
Only `dist/`, package metadata, this README and the license are packed. Generated
files and dependencies are ignored by Git. No publish command is run by these
scripts.

The engine, formations, share helpers and both test files were copied unchanged
from `pitchtimewebsite/wt-ai-mcp/src/lib/lineup/` on 2026-10-05. This package adds
the public entry point, build configuration and documentation. Relevant tooling
references: [Node TypeScript support](https://nodejs.org/docs/latest-v23.x/api/typescript.html),
[erasable-only syntax](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html),
[relative import rewriting](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)
and [npm prepare lifecycle](https://docs.npmjs.com/cli/v11/using-npm/scripts/#life-cycle-scripts).

## Use it without code

Use the [lineup builder](https://pitchtime.app/lineup), or connect an AI client to
the [MCP server](https://pitchtime.app/mcp). See the
[connection and tool documentation](https://pitchtime.app/ai).

## License

[MIT](LICENSE). Copyright (c) 2026 Pitch Time.

## Maintained by

[Pitch Time](https://pitchtime.app). Pitch Time is a youth soccer coaching app that automatically generates fair playing time lineups.
