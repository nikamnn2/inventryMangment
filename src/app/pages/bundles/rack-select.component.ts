import { Component, computed, input, model } from '@angular/core';
import { matchRack } from './racks';

/** The value of the "Other" entry in the list (never a rack name). */
const OTHER = '__other__';

/** Purpose: rack drop-down with the saved choices and, always last, "Other" which opens a box to type a new one. */
@Component({
  selector: 'app-rack-select',
  template: `
    <select class="input" [id]="inputId()" name="rack" (change)="pick($any($event.target).value)">
      <option value="" [selected]="!showOther() && !value()">No rack</option>
      @for (r of options(); track r) { <option [value]="r" [selected]="!showOther() && selected() === r">{{ r }}</option> }
      <option [value]="otherValue" [selected]="showOther()">Other…</option>
    </select>
    @if (showOther()) {
      <input class="input" name="rack-other" maxlength="20" autocomplete="off" aria-label="New rack value" placeholder="Type the new value" [value]="value()" (input)="value.set($any($event.target).value)" />
    }
  `,
  styles: `:host { display: grid; gap: 8px; }`,
})
export class RackSelectComponent {
  readonly options = input.required<string[]>();
  readonly inputId = input('rack');
  /** The chosen or typed rack; empty for no rack. */
  readonly value = model('');
  /** True while "Other" is chosen, even before anything is typed. */
  readonly other = model(false);

  protected readonly otherValue = OTHER;
  protected readonly selected = computed(() => matchRack(this.value(), this.options()));
  // a saved value that is not in the list is shown as typed text
  protected readonly showOther = computed(() => this.other() || (!!this.value() && !this.options().includes(this.selected())));

  protected pick(choice: string): void {
    this.other.set(choice === OTHER);
    this.value.set(choice === OTHER ? '' : choice);
  }
}
