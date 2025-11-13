import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, Renderer2 } from '@angular/core';

@Directive({
  selector: '[autoFitText]',
  standalone: true,
})
export class AutoFitTextDirective implements AfterViewInit, OnDestroy {
  private ro?: ResizeObserver;
  private mo?: MutationObserver;
  private cleanupFns: Array<() => void> = [];
  private maxFontPx: number | null = null;
  private minFontPx = 10; // safety floor

  constructor(private el: ElementRef<HTMLElement>, private r2: Renderer2, private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const element = this.el.nativeElement;
      // Observe container resize
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(element);
      // Observe text changes
      this.mo = new MutationObserver(() => this.fit());
      this.mo.observe(element, { childList: true, characterData: true, subtree: true });
      // Window resize
      const off = this.r2.listen(window, 'resize', () => this.fit());
      this.cleanupFns.push(off);
      // Initial
      requestAnimationFrame(() => this.fit());
    });
  }

  private fit() {
    const el = this.el.nativeElement;
    const container = el.parentElement as HTMLElement | null;
    if (!container) return;

    // Use computed style as starting max font
    const computed = window.getComputedStyle(el);
    if (!this.maxFontPx) {
      const size = parseFloat(computed.fontSize || '16');
      this.maxFontPx = isNaN(size) ? 16 : size;
    }

    // Reset to max to measure
    el.style.fontSize = `${this.maxFontPx}px`;
    el.style.lineHeight = '1';

    // Available width = container width minus any right sibling width (percentage pill)
    let available = container.clientWidth;
    const siblings = Array.from(container.children) as HTMLElement[];
    if (siblings.length > 1) {
      const last = siblings[siblings.length - 1];
      if (last !== el) available -= last.offsetWidth + 8; // small gap
    }
    available = Math.max(0, available);

    // If already fits, done
    if (el.scrollWidth <= available) return;

    // Scale down proportionally with a couple of passes
    let current = this.maxFontPx!;
    const ratio = available / Math.max(1, el.scrollWidth);
    current = Math.max(this.minFontPx, Math.floor(current * ratio));
    el.style.fontSize = `${current}px`;

    // Fine tune down until fits
    let guard = 10;
    while (guard-- > 0 && el.scrollWidth > available && current > this.minFontPx) {
      current -= 1;
      el.style.fontSize = `${current}px`;
    }
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    this.mo?.disconnect();
    this.cleanupFns.forEach(fn => fn());
  }
}
