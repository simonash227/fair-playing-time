export const FORMATS = ['7v7', '9v9', '11v11'] as const;
export type Format = typeof FORMATS[number];
export type Style = 'balanced' | 'attacking' | 'defensive';

export type Formation = {
  name: string;
  positions: string[];
  bestFor: string;
};

export const FORMAT_DETAILS: Record<Format, { onField: number; gameMinutes: number; ageGroup: string }> = {
  '7v7': { onField: 7, gameMinutes: 50, ageGroup: 'U8–U10' },
  '9v9': { onField: 9, gameMinutes: 60, ageGroup: 'U11–U12' },
  '11v11': { onField: 11, gameMinutes: 70, ageGroup: 'U13+' }
};

// Positions run from the goalkeeper to the forwards, left to right in each line.
// Notes follow /blog/youth-soccer-formations-guide.
export const FORMATIONS: Record<Format, Formation[]> = {
  '7v7': [
    { name: '1-2-3-1', positions: ['GK', 'LB', 'RB', 'LM', 'CM', 'RM', 'ST'], bestFor: 'Teams new to 7v7, balanced skill levels, teaching possession play.' },
    { name: '1-3-2-1', positions: ['GK', 'LB', 'CB', 'RB', 'LCM', 'RCM', 'ST'], bestFor: 'Teams facing stronger opponents, teaching defensive principles.' },
    { name: '1-2-2-2', positions: ['GK', 'LB', 'RB', 'LM', 'RM', 'LS', 'RS'], bestFor: 'Attacking-minded teams, faster players, teaching forward partnerships.' }
  ],
  '9v9': [
    { name: '1-3-2-3', positions: ['GK', 'LB', 'CB', 'RB', 'LCM', 'RCM', 'LW', 'ST', 'RW'], bestFor: 'Well-rounded teams, teaching width, preparing for 11v11.' },
    { name: '1-3-3-2', positions: ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LS', 'RS'], bestFor: 'Teams with strong midfielders, possession-based play.' },
    { name: '1-2-3-3', positions: ['GK', 'LB', 'RB', 'LM', 'CM', 'RM', 'LW', 'ST', 'RW'], bestFor: 'Fast teams, counter-attacking style, chasing a game.' }
  ],
  '11v11': [
    { name: '1-4-3-3', positions: ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LCM', 'CM', 'RCM', 'LW', 'ST', 'RW'], bestFor: 'Most youth teams, balanced approach, player development.' },
    { name: '1-4-4-2', positions: ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LS', 'RS'], bestFor: 'Teams learning 11v11, teaching compactness, balanced teams.' },
    { name: '1-3-5-2', positions: ['GK', 'LCB', 'CB', 'RCB', 'LWB', 'LCM', 'CM', 'RCM', 'RWB', 'LS', 'RS'], bestFor: 'Possession-oriented teams, technical players, controlling games.' }
  ]
};

export function validateFormat(format: unknown): asserts format is Format {
  if (!FORMATS.includes(format as Format)) throw new Error('Format must be 7v7, 9v9 or 11v11.');
}

export function getFormation(format: Format, name?: string): Formation {
  validateFormat(format);
  const formation = name === undefined ? FORMATIONS[format][0] : FORMATIONS[format].find(item => item.name === name);
  if (!formation) throw new Error(`Choose a supported ${format} formation: ${FORMATIONS[format].map(item => item.name).join(', ')}.`);
  return formation;
}
