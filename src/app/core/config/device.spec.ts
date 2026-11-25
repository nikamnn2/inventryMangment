import { isMobileDevice } from './device';

describe('isMobileDevice', () => {
  const setUa = (ua: string) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  const original = navigator.userAgent;
  afterEach(() => setUa(original));

  it('detects phones by user agent', () => {
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148');
    expect(isMobileDevice()).toBe(true);
    setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36');
    expect(isMobileDevice()).toBe(true);
  });

  it('is false on a desktop with a mouse', () => {
    setUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0 Safari/537.36');
    expect(isMobileDevice()).toBe(matchMedia('(pointer: coarse)').matches);
  });
});
