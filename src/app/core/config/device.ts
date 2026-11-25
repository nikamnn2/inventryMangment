/**
 * Purpose: decide whether the device is a phone/tablet, so camera-only features (the Scan bundle
 * page) are offered on mobile and hidden on desktop.
 * True on phones and tablets (touch-first or mobile user agent). False on the server / during prerender. */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const touchFirst = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return ua || touchFirst;
}
