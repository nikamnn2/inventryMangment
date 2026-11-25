import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/**
 * Purpose: draw a bundle ID as a QR code on the bundle label, next to the barcode.
 * QR codes are easier for phone cameras to read from a distance or at an angle.
 * Usage: <app-qrcode [value]="bundle.id" [px]="110" />
 */
@Component({
  selector: 'app-qrcode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (model(); as m) {
      <svg [attr.viewBox]="'0 0 ' + m.size + ' ' + m.size" shape-rendering="crispEdges" role="img" [attr.aria-label]="'QR code ' + value()" [style.width.px]="px()" [style.height.px]="px()">
        <rect [attr.width]="m.size" [attr.height]="m.size" fill="#fff" />
        <path [attr.d]="m.path" fill="#000" />
      </svg>
    }
  `,
  styles: `:host { display: inline-block; line-height: 0; } svg { display: block; }`,
})
export class QrcodeComponent {
  readonly value = input.required<string>();
  readonly px = input(110);

  protected readonly model = computed(() => {
    const qr = qrcode(0, 'M'); // type 0 = pick the smallest version that fits
    qr.addData(this.value());
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 3;
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return { size: n + quiet * 2, path };
  });
}
