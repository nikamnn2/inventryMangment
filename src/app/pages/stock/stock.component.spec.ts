import { TestBed } from '@angular/core/testing';
import { DataService } from '../../core/services/data.service';
import { baseProviders, fillData } from '../../testing/fixtures';
import { StockComponent } from './stock.component';

describe('StockComponent', () => {
  let data: DataService;
  let c: any;
  let fixture: ReturnType<typeof TestBed.createComponent<StockComponent>>;
  const ids = () => c.rows().map((b: { id: string }) => b.id);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StockComponent], providers: baseProviders() });
    data = TestBed.inject(DataService);
    fillData(data);
    fixture = TestBed.createComponent(StockComponent);
    c = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('sorts rows by product name', () => {
    expect(ids()).toEqual(['b2', 'b1', 'b3']);
  });

  it('filters by availability, product and search text', () => {
    c.state.set('available');
    expect(ids()).toEqual(['b2', 'b1']);
    c.state.set('sold');
    expect(ids()).toEqual(['b3']);
    c.state.set('all');
    c.profile.set('GL-1');
    expect(ids()).toEqual(['b2']);
    c.profile.set('');
    c.q.set('a-02');
    expect(ids()).toEqual(['b3']);
  });

  it('summarises stock per category', () => {
    const [al, gl] = c.summary();
    expect(al).toEqual(jasmine.objectContaining({ cat: 'Aluminium', pcs: 40, bundles: 2, weight: 200 }));
    expect(gl).toEqual(jasmine.objectContaining({ cat: 'Glass', pcs: 8 }));
    expect(al.share + gl.share).toBeCloseTo(100);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Low-stock bundles');
  });

  it('exports a CSV using the current filters', () => {
    const download = spyOn(data, 'download').and.resolveTo();
    c.state.set('available');
    c.profile.set('AL-1');
    c.q.set(' rack ');
    c.exportCsv();
    expect(download).toHaveBeenCalledWith('/api/stock/export.csv?state=available&dieNo=AL-1&q=rack', 'stock-overview.csv');
  });

  it('exports with only the state when nothing is filtered', () => {
    const download = spyOn(data, 'download').and.resolveTo();
    c.exportCsv();
    expect(download).toHaveBeenCalledWith('/api/stock/export.csv?state=all', 'stock-overview.csv');
  });
});
