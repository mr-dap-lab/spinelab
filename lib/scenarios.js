export const LEVELS = [
  ...Array.from({ length: 5 }, (_, i) => `C${i + 2}–C${i + 3}`),
  'C7–T1',
  ...Array.from({ length: 11 }, (_, i) => `T${i + 1}–T${i + 2}`),
  'T12–L1',
  ...Array.from({ length: 4 }, (_, i) => `L${i + 1}–L${i + 2}`),
  'L5–S1',
];
export const DEFAULT_SCENARIO = {
  bulge: 25,
  compression: 10,
  direction: 35,
  spread: 24,
};
export const NEUTRAL_SCENARIO = {
  bulge: 0,
  compression: 0,
  direction: 35,
  spread: 24,
};
export function validateScenario(value) {
  if (!value || typeof value !== 'object') return null;
  const bounds = {
    bulge: [0, 100],
    compression: [0, 60],
    direction: [-60, 60],
    spread: [12, 65],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (
      typeof value[key] !== 'number' ||
      !Number.isFinite(value[key]) ||
      value[key] < min ||
      value[key] > max
    )
      return null;
  return {
    bulge: value.bulge,
    compression: value.compression,
    direction: value.direction,
    spread: value.spread,
  };
}
