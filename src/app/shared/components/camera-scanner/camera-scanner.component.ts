import { Component, ElementRef, OnDestroy, OnInit, inject, output, signal, viewChild } from '@angular/core';
import { createCodeReader } from '../../../core/scan/code-reader';

/** The same code must be seen on this many frames (about 0.6 s) before it counts. */
const LOCK_READS = 2;
/** A label stays in front of the camera for many frames: it counts again only after this long. */
const REPEAT_GUARD_MS = 4000;

/**
 * Purpose: a camera that keeps scanning bundle labels one after another, for building a sales list.
 * Emits each code once; it is created when the camera should open and releases it when removed.
 */
@Component({
  selector: 'app-camera-scanner',
  template: `
    @if (error()) {
      <div class="notice err" role="alert">{{ error() }}</div>
    } @else {
      <div class="view">
        <video #video playsinline muted></video>
        <span class="frame" aria-hidden="true"></span>
      </div>
      <p class="card-note" aria-live="polite">Hold each label's barcode or QR code inside the frame. The camera stays open for the next one.</p>
    }
    <button class="btn block" type="button" (click)="closed.emit()">Close camera</button>
  `,
  styles: `
    :host { display: grid; gap: 10px; }
    .view { position: relative; aspect-ratio: 4 / 3; max-height: 52vh; width: 100%; overflow: hidden; border-radius: 14px; background: #0b1520; }
    video { width: 100%; height: 100%; object-fit: cover; }
    .frame { position: absolute; inset: 22% 8%; border: 3px solid rgba(255, 255, 255, .85); border-radius: 12px; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .28); }
  `,
})
export class CameraScannerComponent implements OnInit, OnDestroy {
  /** A code read from a label. */
  readonly scanned = output<string>();
  readonly closed = output<void>();
  protected readonly error = signal('');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly host = inject(ElementRef<HTMLElement>);
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private candidate = '';
  private steady = 0;
  private readonly seen = new Map<string, number>();

  async ngOnInit(): Promise<void> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.error.set('The camera cannot be used here. Type the bundle number instead.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (this.stopped) return this.release();
      const el = this.video()!.nativeElement;
      el.srcObject = this.stream;
      await el.play().catch(() => undefined);
      const read = await createCodeReader();
      this.host.nativeElement.scrollIntoView?.({ block: 'nearest' });
      // one frame at a time, so a slow phone never piles up work
      const next = async () => {
        if (this.stopped) return;
        const hit = await read(el).catch(() => undefined);
        if (hit) this.consider(hit.text);
        this.timer = setTimeout(next, 300);
      };
      void next();
    } catch {
      this.release();
      this.error.set('Camera permission was denied or no camera was found. Allow camera access and try again.');
    }
  }

  /** Counts a read; emits once the same code is steady and was not just emitted. */
  protected consider(text: string, now = Date.now()): void {
    this.steady = text === this.candidate ? this.steady + 1 : 1;
    this.candidate = text;
    if (this.steady < LOCK_READS) return;
    const last = this.seen.get(text);
    this.seen.set(text, now); // while it stays in view the wait starts again
    if (last !== undefined && now - last < REPEAT_GUARD_MS) return;
    navigator.vibrate?.(60);
    this.scanned.emit(text);
  }

  private release(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  ngOnDestroy(): void {
    this.stopped = true;
    this.release();
  }
}
