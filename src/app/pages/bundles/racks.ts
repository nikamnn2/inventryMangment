/** Purpose: the rack choices: three fixed ones plus every other rack already used on a bundle. */
import { Bundle } from '../../core/services/data.service';

export const DEFAULT_RACKS = ['Black', 'Silver', 'Gold'];

/** An empty rack is saved as "—". */
export const hasRack = (rack: string): boolean => !!rack.trim() && !['—', '-'].includes(rack.trim());

/** The matching choice, ignoring capitals and extra spaces: "BLACK " is "Black". Otherwise the text, trimmed. */
export function matchRack(value: string, options: string[]): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  return options.find(o => o.toLowerCase() === clean.toLowerCase()) ?? clean;
}

/**
 * Black, Silver, Gold, then the racks typed under "Other", oldest first. They come from the bundles, so
 * everyone sees the same list, and a mistyped one disappears once no bundle uses it.
 */
export function rackOptions(bundles: Bundle[]): string[] {
  const options = [...DEFAULT_RACKS];
  // the list arrives newest first
  for (const b of [...bundles].reverse()) {
    if (!hasRack(b.rack)) continue;
    const rack = matchRack(b.rack, options);
    if (!options.includes(rack)) options.push(rack);
  }
  return options;
}
