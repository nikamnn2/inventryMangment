/** Purpose: reads a barcode or QR code from a camera frame; shared by the Scan bundle page and the new-sale scanner. */

/** Minimal typing for the browser's built-in BarcodeDetector (Chrome / Edge / Android). */
interface Detector {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<{ rawValue: string; format?: string; boundingBox?: { x: number; y: number; width: number; height: number } }[]>;
}
declare const BarcodeDetector: { new (opts: { formats: string[] }): Detector } | undefined;

/** What kind of code was read: a QR code is shown with a square box, a barcode with a rectangular one. */
export type CodeKind = 'qr' | 'barcode';

/** A code read from one camera frame; `box` is its position in that frame's pixels (when the reader reports it). */
export interface Read { text: string; kind: CodeKind; box?: { x: number; y: number; w: number; h: number } }

export type CodeReader = (source: HTMLVideoElement | HTMLCanvasElement) => Promise<Read | undefined>;

/** Native BarcodeDetector where available (Chrome / Edge); ZXing everywhere else (iPhone Safari, Firefox). */
export async function createCodeReader(): Promise<CodeReader> {
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
