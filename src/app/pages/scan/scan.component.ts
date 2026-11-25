import { DecimalPipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Bundle, DataService } from '../../core/services/data.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

/** Minimal typing for the browser's built-in BarcodeDetector (Chrome / Edge / Android). */
interface Detector {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<{ rawValue: string; format?: string; boundingBox?: { x: number; y: number; width: number; height: number } }[]>;
}
declare const BarcodeDetector: { new (opts: { formats: string[] }): Detector } | undefined;

/** What kind of code was read: a QR code is shown with a square box, a barcode with a rectangular one. */
export type CodeKind = 'qr' | 'barcode';

/** A code read from one camera frame; `box` is its position in that frame's pixels (when the reader reports it). */
interface Read { text: string; kind: CodeKind; box?: { x: number; y: number; w: number; h: number } }

/** Where to draw the highlight box, as percentages of the viewfinder. */
export interface ViewBox { left: number; top: number; width: number; height: number }

/** Purpose: how long the "Processing…" screen stays up after a scan (the lookup runs meanwhile). */
export const PROCESSING_MS = 5000;

/**
 * Purpose: turns a code's position in the camera frame into a highlight box on screen.
 * The video fills the viewfinder with object-fit: cover, so the frame is scaled and cropped; a QR code
 * gets a square box, a barcode a rectangle. Without a position the box is centred at a default size.
 */
export function viewBox(
  kind: CodeKind, box: Read['box'], video: { width: number; height: number }, view: { width: number; height: number }, crop = { x: 0, y: 0 },
): ViewBox {
  let cx = view.width / 2;
  let cy = view.height / 2;
  let w = kind === 'qr' ? Math.min(view.width, view.height) * 0.55 : view.width * 0.8;
  let h = kind === 'qr' ? w : view.height * 0.28;
  if (box && video.width && video.height) {
    const scale = Math.max(view.width / video.width, view.height / video.height);
    const offX = (video.width * scale - view.width) / 2;
    const offY = (video.height * scale - view.height) / 2;
    const bw = box.w * scale;
    const bh = box.h * scale;
    cx = (crop.x + box.x) * scale - offX + bw / 2;
    cy = (crop.y + box.y) * scale - offY + bh / 2;
    if (kind === 'qr') {
      w = h = Math.max(bw, bh) * 1.15; // square, a little larger than the code
    } else {
      w = bw * 1.1;
      h = Math.max(bh * 1.4, w * 0.25); // rectangle, never a thin line
    }
  }
  const left = Math.max(0, cx - w / 2);
  const top = Math.max(0, cy - h / 2);
  return {
    left: (left / view.width) * 100,
    top: (top / view.height) * 100,
    width: (Math.min(w, view.width - left) / view.width) * 100,
    height: (Math.min(h, view.height - top) / view.height) * 100,
  };
}

/** One row per bundle: scanning the same bundle again increases `count` instead of adding a row. */
interface ScanEntry { bundle: Bundle; count: number; at: Date; }

/** Purpose: how many distinct bundles the "Scanned this session" list keeps (oldest drop off). */
const MAX_HISTORY = 8;

/** Purpose: zoom levels tried in turn when nothing is readable, so a far-away label is found without the user touching the screen. */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const MISSES_PER_STEP = 4; // ~1.2 s without a barcode before zooming in one step
const LOCK_READS = 2; // the same code must be seen on this many camera frames (~0.6 s) before it is looked up
const LOST_FRAMES = 2; // frames without a code before the box goes back to the plain scanning frame
const REPEAT_GUARD_MS = 2000; // the camera sees the same label for several frames; count it once

/**
 * Purpose: mobile-only "Scan bundle" page used in the warehouse / at the loading bay.
 *
 * Flow: tap "Ready to scan" → camera opens → a barcode OR QR code on a bundle label is read →
 * the bundle is fetched from the API and its details are shown → the camera turns off until the
 * next tap. From the details card the user can mark the bundle "out for delivery" (status Shipped).
 * Scanning the same bundle again increases its quantity in the session list instead of adding a row.
 * The bundle ID can also be typed (or sent by a hardware scanner) when the camera is unavailable.
 */
@Component({
  selector: 'app-scan',
  imports: [FormsModule, IconComponent, DecimalPipe],
  templateUrl: './scan.component.html',
  styleUrl: './scan.component.scss',
})
export class ScanComponent implements OnInit, OnDestroy {
  protected readonly data = inject(DataService);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly manual = signal('');
  protected readonly bundle = signal<Bundle | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly cameraOn = signal(false);
  /** True while a scanned code is being looked up: the camera pauses, then is ready again. */
  protected readonly busy = signal(false);
  /** Type of the code just read (drives the box shape) and where to draw the box; both clear when processing ends. */
  protected readonly kind = signal<CodeKind | null>(null);
  protected readonly foundBox = signal<ViewBox | null>(null);
  /** How long "Processing…" is shown after a scan. A field (not a constant) so tests can shorten it. */
  protected processingMs = PROCESSING_MS;
  /** Current zoom factor (hardware zoom when the camera supports it, otherwise a digital crop). */
  protected readonly zoom = signal(1);
  protected readonly history = signal<ScanEntry[]>([]);

  /** Purpose: grand totals (scans, pieces, kg) shown under the "Scanned this session" title. */
  protected readonly totals = computed(() => this.history().reduce(
    (t, e) => ({ scans: t.scans + e.count, pieces: t.pieces + e.bundle.pieces * e.count, weight: t.weight + e.bundle.weight * e.count }),
    { scans: 0, pieces: 0, weight: 0 }));

  // Camera / scan-loop state. Kept private: the template only needs the signals above.
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastValue = '';
  private lastAt = 0;
  private misses = 0;
  private candidate = '';
  private steady = 0;
  private lost = 0;
  private zoomIdx = 0;
  private hwZoom: { min: number; max: number } | null = null;
  private canvas?: HTMLCanvasElement;

  /** Re-open the camera automatically when the user already allowed it, so there is no prompt each visit. */
  async ngOnInit(): Promise<void> {
    try {
      const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
      if (status?.state === 'granted') await this.startCamera();
    } catch { /* Permissions API unavailable (Safari): the user taps Start camera once */ }
  }

  async startCamera(): Promise<void> {
    this.error.set('');
    if (!window.isSecureContext) {
      this.error.set('The camera only works on a secure page. Open this app with https:// (run npm run start:mobile), not http://.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('This browser cannot access the camera. Type the bundle ID below instead.');
      return;
    }
    try {
      // high resolution keeps small / distant barcodes readable
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch {
      this.error.set('Camera permission was denied or no camera was found. Allow camera access for this site and try again.');
      return;
    }
    await this.setupZoom();
    this.cameraOn.set(true);
    // wait one tick: the <video> element only exists after Angular renders cameraOn()
    setTimeout(async () => {
      const el = this.video()?.nativeElement;
      if (!el || !this.stream) return;
      el.srcObject = this.stream;
      await el.play().catch(() => undefined);
      const read = await this.createReader();
      this.timer = setInterval(async () => {
        if (this.busy()) return;
        let hit: Read | undefined;
        try { hit = await read(this.frame(el)); } catch { /* no code in this frame */ }
        if (!hit) { this.noCode(); return; }
        this.lost = 0;
        this.misses = 0;
        // live: the frame follows the code and switches shape (square = QR, rectangle = barcode) on every camera frame
        this.showBox(el, hit);
        this.steady = hit.text === this.candidate ? this.steady + 1 : 1;
        this.candidate = hit.text;
        if (this.steady < LOCK_READS) return; // not steady yet: keep tracking
        if (hit.text === this.lastValue && Date.now() - this.lastAt < REPEAT_GUARD_MS) return;
        this.lastValue = hit.text;
        this.lastAt = Date.now();
        try {
          await this.lookup(hit.text);
          this.stopCamera(); // one scan per tap: the user presses "Ready to scan" for the next one
        } catch { /* lookup failures are shown by lookup() itself */ }
      }, 300);
    });
  }

  /** Purpose: nothing readable this frame: after a couple of empty frames the box returns to the plain frame, and the zoom may step in. */
  private noCode(): void {
    if (++this.lost >= LOST_FRAMES) {
      this.kind.set(null);
      this.foundBox.set(null);
      this.candidate = '';
      this.steady = 0;
    }
    this.autoZoom();
  }

  /** Purpose: draw the square (QR) or rectangular (barcode) box over the code that was just read. */
  private showBox(el: HTMLVideoElement, hit: Read): void {
    const z = this.hwZoom ? 1 : this.zoom();
    const crop = z > 1 && el.videoWidth ? { x: (el.videoWidth - el.videoWidth / z) / 2, y: (el.videoHeight - el.videoHeight / z) / 2 } : { x: 0, y: 0 };
    this.kind.set(hit.kind);
    this.foundBox.set(viewBox(hit.kind, hit.box, { width: el.videoWidth, height: el.videoHeight }, { width: el.clientWidth, height: el.clientHeight }, crop));
  }

  /** Uses the camera's real optical/hardware zoom when it has one (most Android phones); otherwise zooms digitally. */
  private async setupZoom(): Promise<void> {
    this.zoomIdx = 0;
    this.misses = 0;
    this.zoom.set(1);
    const track = this.stream?.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number }; focusMode?: string[] };
    this.hwZoom = caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max } : null;
    if (caps.focusMode?.includes('continuous')) {
      await track!.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
  }

  /** No barcode found for a while: step the zoom in (1× → 4×), then start over wide. */
  private autoZoom(): void {
    if (++this.misses < MISSES_PER_STEP) return;
    this.misses = 0;
    this.zoomIdx = (this.zoomIdx + 1) % ZOOM_STEPS.length;
    this.applyZoom(ZOOM_STEPS[this.zoomIdx]);
  }

  private applyZoom(level: number): void {
    const track = this.stream?.getVideoTracks()[0];
    if (this.hwZoom && track) {
      const z = Math.min(this.hwZoom.max, Math.max(this.hwZoom.min, level));
      track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).catch(() => undefined);
      this.zoom.set(z);
    } else {
      this.zoom.set(level); // digital zoom: frame() crops the centre
    }
  }

  /** The image to decode: the live video, or its centre crop when zooming digitally. */
  private frame(el: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
    const z = this.hwZoom ? 1 : this.zoom();
    if (z <= 1 || !el.videoWidth) return el;
    const sw = el.videoWidth / z;
    const sh = el.videoHeight / z;
    const c = (this.canvas ??= document.createElement('canvas'));
    c.width = sw;
    c.height = sh;
    c.getContext('2d')!.drawImage(el, (el.videoWidth - sw) / 2, (el.videoHeight - sh) / 2, sw, sh, 0, 0, sw, sh);
    return c;
  }

  /** Native BarcodeDetector where available (Chrome / Edge); ZXing everywhere else (iPhone Safari, Firefox). */
  private async createReader(): Promise<(src: HTMLVideoElement | HTMLCanvasElement) => Promise<Read | undefined>> {
    if (typeof BarcodeDetector !== 'undefined') {
      const detector = new BarcodeDetector({ formats: ['code_128', 'qr_code'] });
      return async src => {
        const hit = (await detector.detect(src))[0];
        if (!hit) return undefined;
        const b = hit.boundingBox;
        return { text: hit.rawValue, kind: hit.format === 'qr_code' ? 'qr' : 'barcode', box: b && { x: b.x, y: b.y, w: b.width, h: b.height } };
      };
    }
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
    const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]]]));
    return async src => {
      const result = src instanceof HTMLCanvasElement ? reader.decodeFromCanvas(src) : reader.decode(src);
      const xs = result.getResultPoints().map(p => p.getX());
      const ys = result.getResultPoints().map(p => p.getY());
      const box = xs.length ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } : undefined;
      return { text: result.getText(), kind: result.getBarcodeFormat() === BarcodeFormat.QR_CODE ? 'qr' : 'barcode', box };
    };
  }

  /** Purpose: release the camera (turns the phone's camera light off) and stop the scan loop. */
  stopCamera(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.lastValue = '';
    this.candidate = '';
    this.steady = 0;
    this.lost = 0;
    this.cameraOn.set(false);
  }

  /** Purpose: look up a bundle from the typed / hardware-scanned ID instead of the camera. */
  protected async submitManual(event: Event): Promise<void> {
    event.preventDefault();
    await this.lookup(this.manual());
    this.manual.set('');
  }

  /**
   * Purpose: fetch the bundle for a scanned code, show it, and add it to the session list
   * (re-scans bump the quantity). `busy` shows the "Processing…" screen, which stays up for `processingMs`
   * (5 s) even when the API answers sooner, so the result appears after a short, steady pause.
   */
  protected async lookup(code: string): Promise<void> {
    this.busy.set(true);
    this.notice.set('');
    try {
      const [found] = await Promise.all([this.data.findBundle(code), this.pause(this.processingMs)]);
      if (typeof found === 'string') {
        this.bundle.set(null);
        this.error.set(found);
        return;
      }
      this.error.set('');
      this.bundle.set(found);
      this.history.update(h => {
        const prev = h.find(e => e.bundle.id === found.id);
        return [{ bundle: found, count: (prev?.count ?? 0) + 1, at: new Date() }, ...h.filter(e => e.bundle.id !== found.id)].slice(0, MAX_HISTORY);
      });
      navigator.vibrate?.(60);
    } finally {
      this.busy.set(false); // ready for the next scan
      this.kind.set(null);
      this.foundBox.set(null);
    }
  }

  private pause(ms: number): Promise<void> {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }

  /** Purpose: record that the bundle left for delivery by saving its status as Shipped. */
  protected async markOut(b: Bundle): Promise<void> {
    const err = await this.data.updateBundle(b.id, { ...b, status: 'Shipped' });
    if (err) { this.error.set(err); return; }
    const updated: Bundle = { ...b, status: 'Shipped' };
    this.bundle.set(updated);
    this.history.update(h => h.map(e => (e.bundle.id === b.id ? { ...e, bundle: updated } : e)));
    this.notice.set(`${b.id} marked out for delivery.`);
  }

  /** Purpose: manually correct the scanned quantity of one bundle (+ / − buttons); at 0 the row is removed. */
  protected adjust(id: string, delta: number): void {
    this.history.update(h => h.flatMap(e => (e.bundle.id !== id ? [e] : e.count + delta < 1 ? [] : [{ ...e, count: e.count + delta }])));
  }

  /** Purpose: empty the session list and totals. */
  protected clearHistory(): void { this.history.set([]); }

  /** Purpose: dismiss the current bundle card so the next scan starts from a clean screen. */
  protected scanAgain(): void {
    this.bundle.set(null);
    this.notice.set('');
    this.lastValue = '';
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop()); // keep the remembered preference for the next visit
  }
}
