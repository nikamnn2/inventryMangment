import { code128, toBars } from './code128';

describe('code128', () => {
  const modules = (w: number[]) => w.reduce((a, b) => a + b, 0);

  it('encodes with start, checksum and stop (11 modules per symbol + 13 stop)', () => {
    const w = code128('A'); // start B + "A" + checksum + stop
    expect(modules(w)).toBe(11 * 3 + 13);
  });

  it('uses the known checksum for "PJJ123C" style input', () => {
    // START B (104) + "A"(33)*1 = 137 -> 137 % 103 = 34 -> pattern 34 = 131123
    expect(code128('A').slice(12, 18)).toEqual([1, 3, 1, 1, 2, 3]);
  });

  it('rejects empty and non-ASCII input', () => {
    expect(() => code128('')).toThrow();
    expect(() => code128('é')).toThrowError(/cannot be encoded/);
  });

  it('toBars returns the dark bars only, at increasing positions', () => {
    const bars = toBars(code128('B1'));
    expect(bars[0].x).toBe(0);
    expect(bars.every((b, i) => i === 0 || b.x > bars[i - 1].x)).toBe(true);
  });
});
