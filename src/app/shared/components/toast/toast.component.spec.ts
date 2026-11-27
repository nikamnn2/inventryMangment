import { TestBed } from '@angular/core/testing';
import { ToastComponent } from './toast.component';

describe('ToastComponent', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the message for five seconds, starting again for a new one', () => {
        vi.useFakeTimers();
        const fixture = TestBed.createComponent(ToastComponent);
        const closed = vi.fn();
        fixture.componentInstance.closed.subscribe(closed);
        const show = (message: string) => {
            fixture.componentRef.setInput('message', message);
            fixture.detectChanges();
        };
        const text = () => fixture.nativeElement.textContent.trim();

        show('');
        vi.advanceTimersByTime(10000);
        expect([text(), closed.mock.calls.length]).toEqual(['', 0]);

        show('2 bundles added.');
        expect(text()).toBe('2 bundles added.');
        vi.advanceTimersByTime(4000);
        show('Bundle 1008 was deleted.');
        vi.advanceTimersByTime(4999);
        expect(closed).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(closed).toHaveBeenCalledTimes(1);
        show('');
        expect(text()).toBe('');
    });
});
