import { TestBed } from '@angular/core/testing';
import { Bundle, DataService } from '../../core/services/data.service';
import { BUNDLES, baseProviders, fillData } from '../../testing/fixtures';
import { PROCESSING_MS, ScanComponent, viewBox } from './scan.component';
import { fakeAsync, tick } from '@angular/core/testing';

const win = window as unknown as Record<string, unknown>;

describe('ScanComponent', () => {
  let data: DataService;
  let fixture: ReturnType<typeof TestBed.createComponent<ScanComponent>>;
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ScanComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(ScanComponent);
    c = fixture.componentInstance;
    c.processingMs = 0; // the 5 s processing screen has its own tests below
    fixture.detectChanges();
  });

  afterEach(() => {
    delete win['BarcodeDetector'];
    c.stopCamera();
  });

  describe('looking up a bundle', () => {
    it('shows the bundle and remembers it in the history', async () => {
      spyOn(data, 'findBundle').and.resolveTo(BUNDLES[0]);
      await c.lookup('b1');
      fixture.detectChanges();
      expect(c.bundle().id).toBe('b1');
      expect(c.error()).toBe('');
      expect(c.history().length).toBe(1);
      expect(fixture.nativeElement.textContent).toContain('Window Frame');
    });

    it('shows the error and clears the previous bundle when nothing matches', async () => {
      const find = spyOn(data, 'findBundle');
      find.and.resolveTo(BUNDLES[0]);
      await c.lookup('b1');
      find.and.resolveTo('Bundle not found.');
      await c.lookup('zzzz');
      expect(c.bundle()).toBeNull();
      expect(c.error()).toBe('Bundle not found.');
    });

    it('lists a re-scanned bundle once, newest first, and keeps at most eight', async () => {
      const find = spyOn(data, 'findBundle');
      find.and.resolveTo(BUNDLES[0]);
      await c.lookup('b1');
      find.and.resolveTo(BUNDLES[1]);
      await c.lookup('b2');
      find.and.resolveTo(BUNDLES[0]);
      await c.lookup('b1');
      expect(c.history().map((e: { bundle: Bundle }) => e.bundle.id)).toEqual(['b1', 'b2']);
      for (let i = 0; i < 10; i++) {
        find.and.resolveTo({ ...BUNDLES[0], id: `x${i}` });
        await c.lookup(`x${i}`);
      }
      expect(c.history().length).toBe(8);
    });

    it('looks up the typed ID and clears the box', async () => {
      const find = spyOn(data, 'findBundle').and.resolveTo(BUNDLES[1]);
      c.manual.set('b2');
      await c.submitManual(new Event('submit'));
      expect(find).toHaveBeenCalledWith('b2');
      expect(c.manual()).toBe('');
    });
  });

  describe('sending a bundle out for delivery', () => {
    it('marks it Shipped and tells the user', async () => {
      const update = spyOn(data, 'updateBundle').and.resolveTo(null);
      c.bundle.set(BUNDLES[0]);
      c.history.set([{ bundle: BUNDLES[0], at: new Date() }]);
      await c.markOut(BUNDLES[0]);
      expect(update).toHaveBeenCalledWith('b1', jasmine.objectContaining({ status: 'Shipped' }));
      expect(c.bundle().status).toBe('Shipped');
      expect(c.history()[0].bundle.status).toBe('Shipped');
      expect(c.notice()).toBe('b1 marked out for delivery.');
    });

    it('shows the error and leaves the bundle alone when the update fails', async () => {
      spyOn(data, 'updateBundle').and.resolveTo('Bundle not found.');
      c.bundle.set(BUNDLES[0]);
      await c.markOut(BUNDLES[0]);
      expect(c.error()).toBe('Bundle not found.');
      expect(c.bundle().status).toBe('Packed');
    });

    it('only offers the button for packed bundles', async () => {
      spyOn(data, 'findBundle').and.resolveTo(BUNDLES[1]); // Shipped
      await c.lookup('b2');
      fixture.detectChanges();
      const buttons = [...fixture.nativeElement.querySelectorAll('button.btn.primary')] as HTMLButtonElement[];
      const out = buttons.find(b => b.textContent?.includes('Already out for delivery'))!;
      expect(out.disabled).toBeTrue();
    });

    it('can scan the next bundle', () => {
      c.bundle.set(BUNDLES[0]);
      c.notice.set('x');
      c.scanAgain();
      expect(c.bundle()).toBeNull();
      expect(c.notice()).toBe('');
    });
  });

  describe('camera', () => {
    it('explains that the camera needs a secure (https) page', async () => {
      const original = Object.getOwnPropertyDescriptor(window, 'isSecureContext')!;
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      try {
        await c.startCamera();
      } finally {
        Object.defineProperty(window, 'isSecureContext', original);
      }
      expect(c.cameraOn()).toBeFalse();
      expect(c.error()).toContain('https://');
    });

    it('explains when the browser has no camera access at all', async () => {
      spyOnProperty(navigator, 'mediaDevices').and.returnValue(undefined as unknown as MediaDevices);
      await c.startCamera();
      expect(c.cameraOn()).toBeFalse();
      expect(c.error()).toContain('cannot access the camera');
    });

    it('explains when the camera is blocked', async () => {
      win['BarcodeDetector'] = class { detect = async () => []; };
      spyOn(navigator.mediaDevices, 'getUserMedia').and.rejectWith(new Error('denied'));
      await c.startCamera();
      expect(c.cameraOn()).toBeFalse();
      expect(c.error()).toContain('permission was denied');
    });

    it('starts the video and looks up what the detector reads, once per code', async () => {
      const stop = jasmine.createSpy('stop');
      const stream = new MediaStream();
      spyOn(stream, 'getTracks').and.returnValue([{ stop }] as unknown as MediaStreamTrack[]);
      spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(stream);
      const detect = jasmine.createSpy('detect').and.resolveTo([{ rawValue: 'b1' }]);
      win['BarcodeDetector'] = class { detect = detect; };
      spyOn(HTMLMediaElement.prototype, 'play').and.resolveTo();
      const find = spyOn(data, 'findBundle').and.resolveTo(BUNDLES[0]);

      await c.startCamera();
      fixture.detectChanges();
      expect(c.cameraOn()).toBeTrue();

      await new Promise(r => setTimeout(r, 1000)); // a couple of detection ticks
      const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
      expect(video.srcObject).toBe(stream);
      expect(detect).toHaveBeenCalled();
      expect(find).toHaveBeenCalledTimes(1); // the same code is not looked up again
      expect(c.bundle().id).toBe('b1');

      c.stopCamera();
      expect(stop).toHaveBeenCalled();
      expect(c.cameraOn()).toBeFalse();
    });
  });
});

describe('viewBox (where the highlight box is drawn)', () => {
  const video = { width: 1000, height: 1000 };
  const view = { width: 400, height: 300 }; // 4:3 viewfinder over a square video => cover scale 0.4, 50px cropped top and bottom

  it('draws a square for a QR code, a little larger than the code', () => {
    const b = viewBox('qr', { x: 400, y: 400, w: 100, h: 100 }, video, view);
    const widthPx = (b.width / 100) * view.width;
    const heightPx = (b.height / 100) * view.height;
    expect(widthPx).toBeCloseTo(heightPx, 3);
    expect(widthPx).toBeCloseTo(100 * 0.4 * 1.15, 3);
  });

  it('draws a wide rectangle for a barcode', () => {
    const b = viewBox('barcode', { x: 300, y: 450, w: 400, h: 80 }, video, view);
    const widthPx = (b.width / 100) * view.width;
    const heightPx = (b.height / 100) * view.height;
    expect(widthPx).toBeGreaterThan(heightPx * 2);
  });

  it('never draws a barcode as a thin line', () => {
    const b = viewBox('barcode', { x: 300, y: 450, w: 400, h: 2 }, video, view);
    expect((b.height / 100) * view.height).toBeGreaterThanOrEqual((b.width / 100) * view.width * 0.25 - 0.001);
  });

  it('centres the box on the code, allowing for the cropped video edges', () => {
    // a code in the exact middle of the frame must be in the middle of the viewfinder
    const b = viewBox('qr', { x: 450, y: 450, w: 100, h: 100 }, video, view);
    expect(b.left + b.width / 2).toBeCloseTo(50, 3);
    expect(b.top + b.height / 2).toBeCloseTo(50, 3);
  });

  it('adds the crop offset when the image was zoomed digitally', () => {
    const full = viewBox('qr', { x: 500, y: 500, w: 50, h: 50 }, video, view);
    const zoomed = viewBox('qr', { x: 500 - 250, y: 500 - 250, w: 50, h: 50 }, video, view, { x: 250, y: 250 });
    expect(zoomed.left).toBeCloseTo(full.left, 3);
    expect(zoomed.top).toBeCloseTo(full.top, 3);
  });

  it('uses a centred default when the reader gives no position', () => {
    const qr = viewBox('qr', undefined, video, view);
    expect((qr.width / 100) * view.width).toBeCloseTo((qr.height / 100) * view.height, 3);
    expect(qr.left + qr.width / 2).toBeCloseTo(50, 3);
    const bar = viewBox('barcode', undefined, video, view);
    expect(bar.width).toBeCloseTo(80, 3);
    expect(bar.height).toBeCloseTo(28, 3);
  });

  it('keeps the box inside the viewfinder', () => {
    const b = viewBox('qr', { x: 0, y: 0, w: 1000, h: 1000 }, video, view);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.left + b.width).toBeLessThanOrEqual(100.001);
    expect(b.top + b.height).toBeLessThanOrEqual(100.001);
  });
});

describe('ScanComponent processing screen', () => {
  let data: DataService;
  let fixture: ReturnType<typeof TestBed.createComponent<ScanComponent>>;
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ScanComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(ScanComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('holds the processing screen for 5 seconds before showing the bundle', fakeAsync(() => {
    expect(PROCESSING_MS).toBe(5000);
    expect(c.processingMs).toBe(5000);
    spyOn(data, 'findBundle').and.resolveTo(BUNDLES[0]); // the API answers at once
    c.lookup('b1');
    tick(0);
    fixture.detectChanges();
    expect(c.busy()).toBeTrue();
    expect(c.bundle()).toBeNull();
    expect(fixture.nativeElement.querySelector('.processing')).not.toBeNull();

    tick(4999);
    expect(c.busy()).toBeTrue();
    expect(c.bundle()).toBeNull();

    tick(1);
    fixture.detectChanges();
    expect(c.busy()).toBeFalse();
    expect(c.bundle().id).toBe('b1');
    expect(fixture.nativeElement.querySelector('.processing')).toBeNull();
  }));

  it('waits for a slow API instead of cutting it off at 5 seconds', fakeAsync(() => {
    spyOn(data, 'findBundle').and.returnValue(new Promise(resolve => setTimeout(() => resolve(BUNDLES[0]), 8000)));
    c.lookup('b1');
    tick(5000);
    expect(c.busy()).toBeTrue();
    tick(3000);
    expect(c.busy()).toBeFalse();
    expect(c.bundle().id).toBe('b1');
  }));

  it('names what is being read and clears the box afterwards', fakeAsync(() => {
    spyOn(data, 'findBundle').and.resolveTo(BUNDLES[0]);
    c.kind.set('qr');
    c.foundBox.set({ left: 10, top: 10, width: 30, height: 30 });
    c.lookup('b1');
    tick(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.processing').textContent).toContain('Reading QR code');
    tick(5000);
    expect(c.kind()).toBeNull();
    expect(c.foundBox()).toBeNull();
  }));

  it('says "Reading barcode" for a barcode', fakeAsync(() => {
    spyOn(data, 'findBundle').and.resolveTo(BUNDLES[0]);
    c.kind.set('barcode');
    c.lookup('b1');
    tick(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.processing').textContent).toContain('Reading barcode');
    tick(5000);
  }));

  it('shows a square box for a QR code and a rectangle for a barcode while the camera is on', fakeAsync(() => {
    spyOn(data, 'findBundle').and.resolveTo(BUNDLES[0]);
    c.cameraOn.set(true);
    c.kind.set('qr');
    c.foundBox.set({ left: 20, top: 20, width: 40, height: 40 });
    c.busy.set(true);
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector('.found') as HTMLElement;
    expect(box.classList.contains('square')).toBeTrue();
    expect(box.classList.contains('rect')).toBeFalse();
    expect(box.style.left).toBe('20%');

    c.kind.set('barcode');
    c.foundBox.set({ left: 10, top: 35, width: 80, height: 25 });
    fixture.detectChanges();
    const rect = fixture.nativeElement.querySelector('.found') as HTMLElement;
    expect(rect.classList.contains('rect')).toBeTrue();
    expect(rect.classList.contains('square')).toBeFalse();
    c.busy.set(false);
    c.cameraOn.set(false);
  }));
});

describe('ScanComponent camera reading', () => {
  let data: DataService;
  let fixture: ReturnType<typeof TestBed.createComponent<ScanComponent>>;
  let c: any;
  const stopTracks = jasmine.createSpy('stop');

  function fakeStream(track?: object) {
    const stream = new MediaStream();
    spyOn(stream, 'getTracks').and.returnValue([{ stop: stopTracks }] as unknown as MediaStreamTrack[]);
    spyOn(stream, 'getVideoTracks').and.returnValue((track ? [track] : []) as unknown as MediaStreamTrack[]);
    return stream;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ScanComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(ScanComponent);
    c = fixture.componentInstance;
    c.processingMs = 0;
    spyOn(HTMLMediaElement.prototype, 'play').and.resolveTo();
    fixture.detectChanges();
  });

  afterEach(() => {
    delete win['BarcodeDetector'];
    c.stopCamera();
  });

  it('shows a square box while a QR code is being processed, then clears it', async () => {
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream());
    win['BarcodeDetector'] = class {
      detect = async () => [{ rawValue: 'b1', format: 'qr_code', boundingBox: { x: 10, y: 10, width: 50, height: 50 } }];
    };
    let release!: (b: Bundle) => void;
    spyOn(data, 'findBundle').and.returnValue(new Promise<Bundle>(res => (release = res)));

    await c.startCamera();
    fixture.detectChanges();
    await new Promise(r => setTimeout(r, 1000));
    fixture.detectChanges();

    expect(c.busy()).toBeTrue();
    expect(c.kind()).toBe('qr');
    expect(c.foundBox()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.found.square')).not.toBeNull();

    release(BUNDLES[0]);
    await new Promise(r => setTimeout(r, 50));
    expect(c.kind()).toBeNull();
    expect(c.cameraOn()).toBeFalse(); // one scan per tap
    expect(c.bundle().id).toBe('b1');
  });

  it('shows a rectangular box for a barcode', async () => {
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream());
    win['BarcodeDetector'] = class { detect = async () => [{ rawValue: 'b1', format: 'code_128' }]; };
    spyOn(data, 'findBundle').and.returnValue(new Promise<Bundle>(() => undefined));

    await c.startCamera();
    fixture.detectChanges();
    await new Promise(r => setTimeout(r, 1000));
    fixture.detectChanges();

    expect(c.kind()).toBe('barcode');
    expect(fixture.nativeElement.querySelector('.found.rect')).not.toBeNull();
  });

  it('switches the frame live: square for a QR code, rectangle for a barcode, plain again when nothing is seen', async () => {
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream());
    let seen: { rawValue: string; format: string }[] = [{ rawValue: 'q-1', format: 'qr_code' }];
    win['BarcodeDetector'] = class { detect = async () => seen; };
    const find = spyOn(data, 'findBundle').and.returnValue(new Promise<Bundle>(() => undefined));

    await c.startCamera();
    fixture.detectChanges();
    await new Promise(r => setTimeout(r, 350)); // one frame: tracked, not yet locked
    fixture.detectChanges();
    expect(c.kind()).toBe('qr');
    expect(fixture.nativeElement.querySelector('.found.square')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.status').textContent).toContain('QR code');
    expect(find).not.toHaveBeenCalled();

    seen = [{ rawValue: 'b-2', format: 'code_128' }]; // the camera moves to a barcode
    await new Promise(r => setTimeout(r, 350));
    fixture.detectChanges();
    expect(c.kind()).toBe('barcode');
    expect(fixture.nativeElement.querySelector('.found.rect')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.found.square')).toBeNull();
    expect(fixture.nativeElement.querySelector('.status').textContent).toContain('Barcode');

    seen = []; // nothing in view
    await new Promise(r => setTimeout(r, 750));
    fixture.detectChanges();
    expect(c.kind()).toBeNull();
    expect(fixture.nativeElement.querySelector('.found')).toBeNull();
    expect(fixture.nativeElement.querySelector('.reticle')).not.toBeNull();
    expect(find).not.toHaveBeenCalled(); // the code never stayed steady, so nothing was looked up
  });

  it('zooms in step by step when nothing can be read (digital zoom)', async () => {
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream());
    win['BarcodeDetector'] = class { detect = async () => []; };
    await c.startCamera();
    fixture.detectChanges();
    await new Promise(r => setTimeout(r, 1700));
    expect(c.zoom()).toBeGreaterThan(1);
  });

  it('uses the camera hardware zoom when it has one', async () => {
    const applyConstraints = jasmine.createSpy('applyConstraints').and.resolveTo();
    const track = { getCapabilities: () => ({ zoom: { min: 1, max: 5 }, focusMode: ['continuous'] }), applyConstraints };
    spyOn(navigator.mediaDevices, 'getUserMedia').and.resolveTo(fakeStream(track));
    win['BarcodeDetector'] = class { detect = async () => []; };
    await c.startCamera();
    fixture.detectChanges();
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] }); // continuous focus
    await new Promise(r => setTimeout(r, 1700));
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1.5 }] });
    expect(c.zoom()).toBe(1.5);
  });
});
