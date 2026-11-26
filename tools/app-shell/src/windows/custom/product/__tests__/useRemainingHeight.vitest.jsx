// @covers tools/app-shell/src/windows/custom/product/useRemainingHeight.js
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { computeRemainingHeight, useRemainingHeight } from '../useRemainingHeight';

const base = { containerTop: 100, containerClientHeight: 600, containerScrollTop: 0, bottomGap: 20, minHeight: 200 };

const mockLayout = (boxTop, clientHeight) => {
  const origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect() {
    const top = this.dataset?.testid === 'box' ? boxTop : 100;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} };
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight });
  return () => { Element.prototype.getBoundingClientRect = origRect; delete HTMLElement.prototype.clientHeight; };
};

describe('computeRemainingHeight', () => {
  it('returns the room left below the box in the column', () => {
    expect(computeRemainingHeight({ ...base, boxTop: 300 })).toBe(380); // 600 - 200 - 20
  });
  it('does not depend on how far the column is scrolled', () => {
    const still = computeRemainingHeight({ ...base, boxTop: 300 });
    const scrolled = computeRemainingHeight({ ...base, boxTop: 250, containerScrollTop: 50 });
    expect(scrolled).toBe(still);
  });
  it('never goes below the minimum height (short viewport, tall header)', () => {
    expect(computeRemainingHeight({ ...base, boxTop: 650 })).toBe(200);
  });
  it('returns null when it cannot be measured', () => {
    expect(computeRemainingHeight({ ...base, boxTop: NaN })).toBeNull();
    expect(computeRemainingHeight({ ...base, boxTop: 300, containerClientHeight: 0 })).toBeNull();
  });
});

function Probe({ active = true, minHeight, fill, fitContent, scrollTolerance, rows = 0 }) {
  const { ref, style } = useRemainingHeight({ active, minHeight, fill, fitContent, scrollTolerance });
  return (
    <div ref={ref} style={style} data-testid="box">
      {Array.from({ length: rows }, (_, i) => <div key={i} data-testid="kid" />)}
    </div>
  );
}

// Layout where every kid of the box is `kidHeight` tall and the box has `hBar` px of horizontal scrollbar
// (offsetHeight - clientHeight); the column is `columnHeight` tall and the box starts `boxTop` px into it.
const mockFitLayout = ({ boxTop = 150, columnHeight = 700, kidHeight = 40, hBar = 0 }) => {
  const origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect() {
    const testid = this.dataset?.testid;
    const top = testid === 'box' ? boxTop : 100;
    const height = testid === 'kid' ? kidHeight : 0;
    return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON() {} };
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.dataset?.testid === 'box' ? 100 : columnHeight; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.dataset?.testid === 'box' ? 100 + hBar : 0; } });
  return () => {
    Element.prototype.getBoundingClientRect = origRect;
    delete HTMLElement.prototype.clientHeight;
    delete HTMLElement.prototype.offsetHeight;
  };
};

describe('useRemainingHeight', () => {
  it('bounds the box by the scrolling ancestor', () => {
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect() {
      const top = this.dataset?.testid === 'box' ? 300 : 100;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} };
    };
    const origCh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
    try {
      render(<div style={{ overflowY: 'auto' }}><Probe /></div>);
      expect(screen.getByTestId('box').style.maxHeight).toBe('380px');
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
      if (origCh) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origCh); else delete HTMLElement.prototype.clientHeight;
    }
  });
  it('leaves the box unconstrained while inactive', () => {
    render(<div style={{ overflowY: 'auto' }}><Probe active={false} /></div>);
    expect(screen.getByTestId('box').style.maxHeight).toBe('');
  });
  it('defaults its generic floor to 200 px when the room left is negative', () => {
    const restore = mockLayout(650, 600);
    try {
      render(<div style={{ overflowY: 'auto' }}><Probe /></div>);
      expect(screen.getByTestId('box').style.maxHeight).toBe('200px');
    } finally { restore(); }
  });
  it('honours an explicit floor (340 for the Movements table)', () => {
    const restore = mockLayout(650, 600);
    try {
      render(<div style={{ overflowY: 'auto' }}><Probe minHeight={340} /></div>);
      expect(screen.getByTestId('box').style.maxHeight).toBe('340px');
    } finally { restore(); }
  });
  it('uses the room left when it is above the floor', () => {
    const restore = mockLayout(150, 700); // 700 - 50 - 20
    try {
      render(<div style={{ overflowY: 'auto' }}><Probe /></div>);
      expect(screen.getByTestId('box').style.maxHeight).toBe('630px');
    } finally { restore(); }
  });
  it('only caps the box by default and also sets its height with fill (never below the floor)', () => {
    const restore = mockLayout(150, 700);
    try {
      const { unmount } = render(<div style={{ overflowY: 'auto' }}><Probe /></div>);
      expect(screen.getByTestId('box').style.height).toBe('');
      unmount();
      render(<div style={{ overflowY: 'auto' }}><Probe fill /></div>);
      expect(screen.getByTestId('box').style.height).toBe('630px');
      expect(screen.getByTestId('box').style.maxHeight).toBe('630px');
    } finally { restore(); }
    const restoreShort = mockLayout(650, 600);
    try {
      render(<div style={{ overflowY: 'auto' }}><Probe fill minHeight={340} /></div>);
      expect(screen.getAllByTestId('box').at(-1).style.height).toBe('340px');
    } finally { restoreShort(); }
  });

  describe('fitContent (floor = min(minHeight, natural content height))', () => {
    const renderFit = (props) => render(<div style={{ overflowY: 'auto' }}><Probe fitContent fill {...props} /></div>);

    it('lowers the floor to the content height when the content is shorter than minHeight', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40 });
      try {
        renderFit({ minHeight: 200, rows: 3 }); // content 120 < 200, room left is negative
        const box = screen.getByTestId('box');
        expect(box.style.minHeight).toBe('120px');
        expect(box.style.height).toBe('120px');
      } finally { restore(); }
    });

    it('with the scroll tolerance active the floor is content - tolerance, absorbed by the hidden overflow', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40 });
      try {
        renderFit({ minHeight: 200, rows: 3, scrollTolerance: 4 }); // content 120, room left negative
        const box = screen.getByTestId('box');
        expect(box.style.minHeight).toBe('116px');
        expect(box.style.height).toBe('116px');
        expect(box.style.overflowY).toBe('hidden'); // shortfall 4 = tolerance
      } finally { restore(); }
    });

    it('with tolerance 0 (more pages to load) the floor stays exactly the content height', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40 });
      try {
        renderFit({ minHeight: 200, rows: 3, scrollTolerance: 0 });
        const box = screen.getByTestId('box');
        expect(box.style.minHeight).toBe('120px');
        expect(box.style.overflowY).toBe('');
      } finally { restore(); }
    });

    it('counts the horizontal scrollbar before taking the tolerance off, and never goes negative', () => {
      let restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40, hBar: 10 });
      try {
        renderFit({ minHeight: 200, rows: 3, scrollTolerance: 4 }); // 120 + 10 - 4
        expect(screen.getByTestId('box').style.minHeight).toBe('126px');
      } finally { restore(); }
      document.body.innerHTML = '';
      restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 1 });
      try {
        renderFit({ minHeight: 200, rows: 3, scrollTolerance: 10 }); // content 3 < tolerance 10
        expect(Number.parseFloat(screen.getByTestId('box').style.minHeight)).toBeGreaterThanOrEqual(0);
      } finally { restore(); }
    });

    it('keeps a taller content at minHeight whatever the tolerance (7 rows: floor 200)', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40 });
      try {
        renderFit({ minHeight: 200, rows: 8, scrollTolerance: 4 }); // content 320
        expect(screen.getByTestId('box').style.minHeight).toBe('200px');
      } finally { restore(); }
    });

    it('caps the floor at minHeight when the content is taller', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40 });
      try {
        renderFit({ minHeight: 200, rows: 8 }); // content 320 > 200
        const box = screen.getByTestId('box');
        expect(box.style.minHeight).toBe('200px');
        expect(box.style.height).toBe('200px');
      } finally { restore(); }
    });

    it('counts the box own horizontal scrollbar in the content height', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600, kidHeight: 40, hBar: 10 });
      try {
        renderFit({ minHeight: 200, rows: 3 });
        expect(screen.getByTestId('box').style.minHeight).toBe('130px');
      } finally { restore(); }
    });

    it('still fills the room left when it is above the floor (height = max(floor, remaining))', () => {
      const restore = mockFitLayout({ boxTop: 150, columnHeight: 700, kidHeight: 40 });
      try {
        renderFit({ minHeight: 200, rows: 3 }); // remaining = 700 - 50 - 20 = 630
        const box = screen.getByTestId('box');
        expect(box.style.minHeight).toBe('120px');
        expect(box.style.height).toBe('630px');
      } finally { restore(); }
    });

    it('keeps minHeight as the floor when the content cannot be measured (no kids)', () => {
      const restore = mockFitLayout({ boxTop: 650, columnHeight: 600 });
      try {
        renderFit({ minHeight: 200, rows: 0 });
        expect(screen.getByTestId('box').style.minHeight).toBe('200px');
      } finally { restore(); }
    });

    it('does not emit minHeight without fitContent', () => {
      const restore = mockFitLayout({ boxTop: 150, columnHeight: 700, kidHeight: 40 });
      try {
        render(<div style={{ overflowY: 'auto' }}><Probe fill minHeight={200} rows={3} /></div>);
        expect(screen.getByTestId('box').style.minHeight).toBe('');
      } finally { restore(); }
    });
  });

  describe('scrollTolerance (no tiny scrollbar for a shortfall of a few px)', () => {
    // 5 kids x 40 = 200 content; box height = column(700) - (boxTop - 100) - 20, so boxTop sets the shortfall.
    const overflowFor = (shortfall, scrollTolerance) => {
      const restore = mockFitLayout({ boxTop: 100 + 700 - 20 - (200 - shortfall), columnHeight: 700, kidHeight: 40 });
      try {
        render(<div style={{ overflowY: 'auto' }}><Probe fitContent fill minHeight={100} scrollTolerance={scrollTolerance} rows={5} /></div>);
        return screen.getByTestId('box').style.overflowY;
      } finally { restore(); }
    };

    it.each([1, 2, 3, 4])('hides vertical overflow at a %i px shortfall', (shortfall) => {
      expect(overflowFor(shortfall, 4)).toBe('hidden');
    });
    it.each([0, 5, 20])('keeps the default overflow at a %i px shortfall', (shortfall) => {
      expect(overflowFor(shortfall, 4)).toBe('');
    });
    it('never hides anything with tolerance 0 (more pages can still load)', () => {
      expect(overflowFor(2, 0)).toBe('');
    });
    it('keeps the default overflow when the box is taller than its content', () => {
      expect(overflowFor(-30, 4)).toBe('');
    });
  });
});
