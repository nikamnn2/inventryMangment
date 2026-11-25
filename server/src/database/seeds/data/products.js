/** Purpose: demo product catalogue loaded by the seed. */
export const products = [
  ['AL-1001', 'Sliding Window Frame 27mm', 'Aluminium', '6063-T5 · 6.0 m', 'Anodised Silver', '15/FT'],
  ['AL-1002', 'Door Frame 50×40', 'Aluminium', '6063-T6 · 6.0 m', 'Powder Coat Black', '18/FT'],
  ['AL-2010', 'Curtain Wall Mullion 60×150', 'Aluminium', '6063-T6 · 6.0 m', 'Mill Finish', '12/FT'],
  ['AL-3005', 'Glazing Bead 12mm', 'Aluminium', '6063-T5 · 5.8 m', 'Anodised Bronze', '14/FT'],
  ['GL-1010', 'Toughened Clear 10mm', 'Glass', '2440 × 1830 mm', 'Clear', ''],
  ['GL-0806', 'Tinted Bronze 6mm', 'Glass', '2140 × 1650 mm', 'Bronze Tint', ''],
  ['GL-1276', 'Laminated 12.76mm', 'Glass', '3210 × 2250 mm', 'Clear PVB', ''],
  ['GL-0808', 'Frosted 8mm', 'Glass', '2140 × 1650 mm', 'Acid Frosted', ''],
].map(([dieNo, name, category, size, finish, clValue]) => ({ dieNo, name, category, size, finish, clValue }));
