import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { code128, toBars } from './code128';

/**
 * Purpose: draw a bundle ID as a printable, scannable barcode on the bundle label.
 * Usage: <app-barcode [value]="bundle.id" [height]="64" [moduleWidth]="2" />
 * It stays crisp when printed because it is SVG, and shows a message if the value cannot be encoded.
 */
@Component({
  selector: 'app-barcode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './barcode.component.html',
  styleUrl: './barcode.component.scss',
})
export class BarcodeComponent {
  readonly value = input.required<string>();
  readonly height = input(64);
  readonly moduleWidth = input(2);

  protected readonly shape = computed(() => {
    try {
      const widths = code128(this.value());
      const quiet = 10; // quiet zone (modules) each side, required by scanners
      return { width: widths.reduce((a, b) => a + b, 0) + quiet * 2, bars: toBars(widths).map(b => ({ x: b.x + quiet, w: b.w })) };
    } catch {
      return null;
    }
  });
}
