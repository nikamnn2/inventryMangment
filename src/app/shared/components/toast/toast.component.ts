import { Component, effect, input, output } from '@angular/core';

/** How long a toast stays on screen. */
export const TOAST_MS = 5000;

/**
 * Purpose: a short success message in the bottom corner that closes itself after five seconds.
 * The parent holds the text: it passes it in, and clears it when `closed` fires.
 */
@Component({
  selector: 'app-toast',
  template: `
    <!-- always in the page, so screen readers hear a message that appears in it -->
    <div class="toast-area no-print" role="status">
      @if (message()) { <div class="toast notice ok">{{ message() }}</div> }
    </div>
  `,
  styles: `
    .toast-area { position: fixed; right: 24px; bottom: 24px; z-index: 120; max-width: min(420px, calc(100vw - 32px)); }
    .toast { box-shadow: var(--shadow); margin: 0; overflow-wrap: anywhere; }
    @media (max-width: 600px) { .toast-area { right: 16px; left: 16px; bottom: 16px; max-width: none; } }
  `,
})
export class ToastComponent {
  readonly message = input('');
  readonly closed = output<void>();

  constructor() {
    // a new message starts the five seconds again; leaving the page cancels them
    effect(onCleanup => {
      if (!this.message()) return;
      const timer = setTimeout(() => this.closed.emit(), TOAST_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }
}
