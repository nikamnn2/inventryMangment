
import { Component, DestroyRef, Signal, computed, inject, input, linkedSignal, signal, DOCUMENT } from '@angular/core';

/** Records per page on a desktop, and per "Show more" step on a phone. */
export const PAGE_SIZE = 8;
/**
 * Screens this narrow (phones, small tablets) get "Show more" instead of pages. Tables turn into cards
 * by the room they have (see `.stack` in styles.scss), so a narrow desktop window can show cards with pages.
 */
const LIST_QUERY = '(max-width: 820px)';

/** Which records of a table to show, and how to move through them. */
export interface Pager<T> {
  /** The records to draw: one page on a desktop; everything loaded so far on a phone. */
  readonly rows: Signal<T[]>;
  readonly total: Signal<number>;
  /** Records per page. */
  readonly size: Signal<number>;
  readonly page: Signal<number>;
  readonly pages: Signal<number>;
  /** True while tables are shown as card lists. */
  readonly list: Signal<boolean>;
  /** Position (from 1) of the first and last record shown. */
  readonly from: Signal<number>;
  readonly to: Signal<number>;
  go(page: number): void;
}

/**
 * Pages through `items`. When `resetOn` changes (a search or filter) it goes back to the first page;
 * when only the records change (an edit, a refresh) it stays where it was. Call from a field initialiser.
 */
export function createPager<T>(items: () => T[], resetOn: () => unknown = () => null, perPage: () => number = () => PAGE_SIZE): Pager<T> {
  const view = inject(DOCUMENT).defaultView;
  const media = view?.matchMedia?.(LIST_QUERY);
  const list = signal(!!media?.matches);
  if (media?.addEventListener) {
    const follow = () => list.set(media.matches);
    media.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', follow));
  }

  const wanted = linkedSignal({ source: resetOn, computation: () => 1 });
  const total = computed(() => items().length);
  const size = computed(perPage);
  const pages = computed(() => Math.max(1, Math.ceil(total() / size())));
  // never past the end, for example after the last record of the last page is removed
  const page = computed(() => Math.min(wanted(), pages()));
  const from = computed(() => (!total() ? 0 : list() ? 1 : (page() - 1) * size() + 1));
  const to = computed(() => Math.min(page() * size(), total()));

  return {
    rows: computed(() => items().slice(Math.max(0, from() - 1), to())),
    total, size, page, pages, list, from, to,
    go: n => wanted.set(Math.min(Math.max(1, n), pages())),
  };
}

/** Purpose: the controls under a table: Previous / Next on a desktop, "Show more" under a phone's card list. */
@Component({
  selector: 'app-pager',
  template: `
    @if (pager(); as p) {
      @if (p.total() > p.size()) {
        <nav class="pager" [class.list]="p.list()" aria-label="Pagination">
          @if (p.list()) {
            <span class="count" aria-live="polite">Showing {{ p.to() }} of {{ p.total() }}</span>
            @if (p.page() < p.pages()) { <button class="btn block" type="button" (click)="p.go(p.page() + 1)">Show more</button> }
          } @else {
            <span class="count">{{ p.from() }}–{{ p.to() }} of {{ p.total() }}</span>
            <div class="moves">
              <button class="btn sm" type="button" [disabled]="p.page() === 1" (click)="p.go(p.page() - 1)">Previous</button>
              <span aria-live="polite">Page {{ p.page() }} of {{ p.pages() }}</span>
              <button class="btn sm" type="button" [disabled]="p.page() === p.pages()" (click)="p.go(p.page() + 1)">Next</button>
            </div>
          }
        </nav>
      }
    }
  `,
  styles: `
    .pager { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 14px; margin-top: 8px; border-top: 1px solid var(--line); font-size: 14.5px; color: var(--muted); }
    .moves { display: flex; align-items: center; gap: 12px; }
    .pager.list { flex-direction: column; align-items: stretch; text-align: center; }
  `,
})
export class PagerComponent {
  readonly pager = input.required<Pager<unknown>>();
}
