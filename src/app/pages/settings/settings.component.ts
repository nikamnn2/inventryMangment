import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';

/** Purpose: Settings page: company details, low-stock threshold and price per kg. */
@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly data = inject(DataService);
  protected form = structuredClone(this.data.settings()!);
  protected readonly saved = signal(false);
  protected readonly error = signal('');

  /** Saves the settings and shows a success or error message. */
  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.saved.set(false);
    const err = await this.data.saveSettings(this.form);
    this.error.set(err ?? '');
    this.saved.set(!err);
  }
}
