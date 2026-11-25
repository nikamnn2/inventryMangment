/**
 * Purpose: generate Code 128 barcodes for bundle labels without any third-party library.
 * Code 128 is what warehouse scanners and phone cameras read most reliably for alphanumeric IDs.
 */

/** Bar/space widths for each Code 128 symbol (index = symbol value); 106 is STOP (7 elements). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/**
 * Encodes printable ASCII text as Code 128 (subset B) and returns the bar layout as
 * alternating bar/space module widths, starting with a bar. Throws for unsupported characters.
 */
export function code128(text: string): number[] {
  if (!text) throw new Error('Nothing to encode.');
  const values = [START_B];
  let sum = START_B;
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 95) throw new Error(`Character "${text[i]}" cannot be encoded in Code 128 B.`);
    values.push(v);
    sum += v * (i + 1);
  }
  values.push(sum % 103, STOP);
  return values.flatMap(v => [...PATTERNS[v]].map(Number));
}

/** Turns module widths into drawable bars: [x, width] for every dark bar. */
export function toBars(widths: number[]): { x: number; w: number }[] {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return bars;
}
