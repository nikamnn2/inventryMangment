import { TestBed } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { baseProviders, fillData } from '../../testing/fixtures';
import { SettingsComponent } from './settings.component';

describe('SettingsComponent', () => {
  let data: DataService;
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SettingsComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    const fixture = TestBed.createComponent(SettingsComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('edits a copy of the current settings', () => {
    c.form.company = 'Changed';
    expect(data.settings()!.company).toBe('Acme');
  });

  it('saves and confirms', async () => {
    const save = spyOn(data, 'saveSettings').and.resolveTo(null);
    await c.save(new Event('submit'));
    expect(save).toHaveBeenCalledWith(c.form);
    expect(c.saved()).toBeTrue();
    expect(c.error()).toBe('');
  });

  it('shows the error and no confirmation when saving fails', async () => {
    spyOn(data, 'saveSettings').and.resolveTo('Company name is required.');
    await c.save(new Event('submit'));
    expect(c.saved()).toBeFalse();
    expect(c.error()).toBe('Company name is required.');
  });
});
