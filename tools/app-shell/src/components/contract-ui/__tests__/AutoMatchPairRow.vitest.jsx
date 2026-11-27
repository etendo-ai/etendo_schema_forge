// @covers tools/app-shell/src/components/contract-ui/AutoMatchPairRow.jsx
/**
 * The single reusable row of the automatch modal: variants, the disabled (ambiguous) row, the
 * separate badge / reason elements, the action under the amount and the continuous column divider.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/i18n', () => ({ useUI: () => (key) => key }));
vi.mock('@/components/ui/money-amount', () => ({
  MoneyAmount: ({ value, currency }) => <span data-testid="money">{`${value} ${currency}`}</span>,
}));

import {
  AutoMatchPairRow, AutoMatchPairSide, AUTOMATCH_COLUMNS, AUTOMATCH_LEFT_CELL, AUTOMATCH_RIGHT_CELL,
} from '../AutoMatchPairRow.jsx';

const row = () => screen.getByTestId('row-1');
const checkbox = () => within(screen.getByTestId('check-1')).getByRole('checkbox');

function renderRow(overrides = {}) {
  const props = {
    checked: false,
    onToggle: vi.fn(),
    checkLabel: 'check-label',
    checkTestId: 'check-1',
    testId: 'row-1',
    left: <span data-testid="left-content">L</span>,
    right: <span data-testid="right-content">R</span>,
    ...overrides,
  };
  return { ...render(<AutoMatchPairRow {...props} />), props };
}

describe('AutoMatchPairRow — variants', () => {
  it('default: white card background, checkbox unchecked, hover shadow class', () => {
    renderRow();
    expect(row().className).toContain('bg-card');
    expect(row().className).not.toContain('bg-[hsl(var(--muted))]');
    expect(row().className).toContain('hover:shadow-lg');
    expect(checkbox()).toHaveAttribute('aria-checked', 'false');
  });

  it('selected: muted background and a filled checkbox', () => {
    renderRow({ checked: true });
    expect(row().className).toContain('bg-[hsl(var(--muted))]');
    expect(row().className).not.toContain('bg-card');
    expect(checkbox()).toHaveAttribute('aria-checked', 'true');
  });

  it('renders both cells with the passed content', () => {
    renderRow();
    expect(within(row()).getByTestId('left-content')).toBeInTheDocument();
    expect(within(row()).getByTestId('right-content')).toBeInTheDocument();
  });
});

describe('AutoMatchPairRow — toggling', () => {
  it('calls onToggle when the checkbox is clicked', () => {
    const { props } = renderRow();
    fireEvent.click(checkbox());
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it('a disabled row (ambiguous pair) cannot be toggled and keeps its label as the title', () => {
    const { props } = renderRow({ disabled: true });
    expect(checkbox()).toBeDisabled();
    fireEvent.click(screen.getByTestId('check-1'));
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('check-1')).toHaveAttribute('title', 'check-label');
  });

  it('an enabled row carries no title on the checkbox', () => {
    renderRow();
    expect(screen.getByTestId('check-1')).not.toHaveAttribute('title');
  });

  it('names the checkbox from checkLabel', () => {
    renderRow();
    expect(checkbox()).toHaveAccessibleName('check-label');
  });
});

describe('AutoMatchPairRow — no swap mark', () => {
  it('renders no arrow / swap icon between the two cells', () => {
    renderRow();
    expect(row().querySelector('svg')).toBeNull();
    expect(row().innerHTML).not.toMatch(/arrow|swap/i);
  });
});

describe('AutoMatchPairRow — continuous column divider (shared layout constants)', () => {
  it('the right cell is the bordered one and carries the shared AUTOMATCH_RIGHT_CELL classes', () => {
    renderRow();
    const rightCell = within(row()).getByTestId('right-content').parentElement.parentElement;
    for (const cls of AUTOMATCH_RIGHT_CELL.split(' ')) expect(rightCell.classList).toContain(cls);
    expect(rightCell.className).toContain('border-l');
  });

  it('the left cell carries AUTOMATCH_LEFT_CELL and no divider of its own', () => {
    renderRow();
    const leftCell = within(row()).getByTestId('left-content').parentElement.parentElement;
    for (const cls of AUTOMATCH_LEFT_CELL.split(' ')) expect(leftCell.classList).toContain(cls);
    expect(leftCell.className).not.toContain('border-l');
  });

  it('the two cells sit in the shared AUTOMATCH_COLUMNS grid', () => {
    renderRow();
    const grid = within(row()).getByTestId('right-content').parentElement.parentElement.parentElement;
    for (const cls of AUTOMATCH_COLUMNS.split(' ')) expect(grid.classList).toContain(cls);
  });

  it('the bordered element has no vertical padding or margin (the padding is on the inner wrapper)', () => {
    renderRow();
    const rightCell = within(row()).getByTestId('right-content').parentElement.parentElement;
    const tokens = rightCell.className.split(/\s+/);
    const vertical = tokens.filter((t) => /^-?(p|m)[tby]-/.test(t) || /^-?(pt|pb|mt|mb)-/.test(t));
    expect(vertical).toEqual([]);
    // The inner wrapper is where the vertical padding lives.
    expect(within(row()).getByTestId('right-content').parentElement.className).toContain('py-3');
  });
});

describe('AutoMatchPairSide', () => {
  const renderSide = (props = {}) => render(
    <AutoMatchPairSide
      description="Pago proveedor" amount={-120} currency="EUR" dateText="02/05/2026"
      testId="side" metaTestId="side-meta" {...props} />,
  );

  it('shows the description, the date meta and the amount', () => {
    renderSide();
    expect(screen.getByTestId('side-desc')).toHaveTextContent('Pago proveedor');
    expect(screen.getByTestId('side-meta')).toHaveTextContent('02/05/2026');
    expect(screen.getByTestId('money')).toHaveTextContent('-120 EUR');
  });

  it('falls back to a dash for a missing description and to EUR for a missing currency', () => {
    renderSide({ description: '', currency: '' });
    expect(screen.getByTestId('side-desc')).toHaveTextContent('—');
    expect(screen.getByTestId('money')).toHaveTextContent('EUR');
  });

  it('renders no date element when there is no date text', () => {
    renderSide({ dateText: '' });
    expect(screen.queryByTestId('side-meta')).toBeNull();
  });

  it('renders the badge and the reason as SEPARATE elements', () => {
    renderSide({
      badge: <span data-testid="badge">Confianza alta</span>,
      reason: <span data-testid="reason">2 salidas posibles</span>,
    });
    const badge = screen.getByTestId('badge');
    const reason = screen.getByTestId('reason');
    expect(badge).not.toContainElement(reason);
    expect(reason).not.toContainElement(badge);
    expect(badge.parentElement).toBe(reason.parentElement);
    expect(badge).toHaveTextContent(/^Confianza alta$/);
    expect(reason).toHaveTextContent(/^2 salidas posibles$/);
  });

  it('puts the action ("Revisar en el panel") in the amount column, under the amount, and it is callable', () => {
    const onReview = vi.fn();
    renderSide({ action: <button type="button" data-testid="review" onClick={onReview}>Revisar en el panel</button> });
    const amount = screen.getByTestId('money');
    const review = screen.getByTestId('review');
    expect(amount.parentElement).toBe(review.parentElement);
    expect(amount.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(review);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('renders no action slot content when none is given', () => {
    renderSide();
    expect(screen.queryByTestId('review')).toBeNull();
  });
});

describe('AutoMatchPairRow + AutoMatchPairSide together', () => {
  it('passes the test ids through: the row, the check and the sides keep their own', () => {
    renderRow({
      left: <AutoMatchPairSide description="A" amount={1} currency="EUR" testId="left-side" />,
      right: <AutoMatchPairSide description="B" amount={2} currency="EUR" testId="right-side" />,
    });
    expect(within(row()).getByTestId('left-side')).toBeInTheDocument();
    expect(within(row()).getByTestId('right-side')).toBeInTheDocument();
    expect(screen.getByTestId('check-1')).toBeInTheDocument();
  });
});
