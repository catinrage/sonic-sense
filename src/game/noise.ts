/** Cheap smooth 1D noise in [-1, 1] for camera shake and idle motion. */
export function gnoise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const g = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const a = g(i) * f;
  const b = g(i + 1) * (f - 1);
  return (a + (b - a) * u) * 2;
}
