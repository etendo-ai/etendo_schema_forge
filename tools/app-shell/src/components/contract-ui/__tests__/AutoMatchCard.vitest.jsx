// @covers tools/app-shell/src/components/contract-ui/AutoMatchCard.jsx
/**
 * The card shell of the automatch modal (yellow for the possible rejections, green for the
 * statement lines): tinted frame, header row aligned with the rows, footer with info and button.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';

import { AutoMatchCard, AutoMatchCardHeader } from '../AutoMatchCard.jsx';
import {
  AutoMatchPairRow, AUTOMATCH_COLUMNS, AUTOMATCH_LEFT_CELL, AUTOMATCH_RIGHT_CELL,
} from '../AutoMatchPairRow.jsx';

function renderCard(overrides = {}) {
  const onAction = vi.fn();
  const props = {
    tone: 'warning',
    title: 'Card title',
    description: 'Card description',
    info: 'Card info sentence',
    testId: 'card',
    action: (
      <button
        type="button" data-testid="card-action" disabled={overrides.disabled}
        onClick={onAction}>
        Excluir (0)
      </button>
    ),
    children: <div data-testid="card-body">rows</div>,
    ...overrides,
  };
  delete props.disabled;
  return { ...render(<AutoMatchCard {...props} />), onAction };
}

describe('AutoMatchCard — shell', () => {
  it('renders the title, the description, the rows and the info sentence', () => {
    renderCard();
    const card = screen.getByTestId('card');
    expect(within(card).getByRole('heading', { name: 'Card title' })).toBeInTheDocument();
    expect(within(card).getByText('Card description')).toBeInTheDocument();
    expect(within(card).getByTestId('card-body')).toBeInTheDocument();
    expect(within(card).getByText('Card info sentence')).toBeInTheDocument();
    expect(within(card).getByTestId('Info__automatch-card')).toBeInTheDocument();
  });

  it('the yellow (warning) and green (success) shells use their own status tokens', () => {
    const { unmount } = renderCard({ tone: 'warning' });
    const warning = screen.getByTestId('card').className;
    expect(warning).toContain('--status-warning-bg');
    expect(warning).not.toContain('--status-success-bg');
    unmount();
    renderCard({ tone: 'success' });
    const success = screen.getByTestId('card').className;
    expect(success).toContain('--status-success-bg');
    expect(success).not.toContain('--status-warning-bg');
    expect(warning).not.toBe(success);
  });

  it('an unknown tone falls back to the green shell', () => {
    renderCard({ tone: 'nope' });
    expect(screen.getByTestId('card').className).toContain('--status-success-bg');
  });

  it('the footer holds the info sentence and the action, with the action after the info', () => {
    renderCard();
    const info = screen.getByText('Card info sentence');
    const action = screen.getByTestId('card-action');
    expect(info.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(info.closest('div[class*="justify-between"]')).toContainElement(action);
  });
});

describe('AutoMatchCard — the action button', () => {
  it('fires its handler when enabled', () => {
    const { onAction } = renderCard();
    fireEvent.click(screen.getByTestId('card-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('is disabled at N=0 and its handler does not fire', () => {
    const { onAction } = renderCard({ disabled: true });
    expect(screen.getByTestId('card-action')).toBeDisabled();
    fireEvent.click(screen.getByTestId('card-action'));
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('AutoMatchCardHeader', () => {
  const renderHeader = () => render(
    <AutoMatchCardHeader
      selectAll={<input type="checkbox" data-testid="select-all" aria-label="select all" />}
      leftTitle="Movimiento original"
      count={3}
      countTestId="count"
      rightTitle="Rechazo bancario" />,
  );

  it('renders select-all, the left title with its counter and the right title', () => {
    renderHeader();
    expect(screen.getByTestId('select-all')).toBeInTheDocument();
    expect(screen.getByText('Movimiento original')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.getByText('Rechazo bancario')).toBeInTheDocument();
    const left = screen.getByText('Movimiento original');
    expect(left.parentElement).toContainElement(screen.getByTestId('count'));
  });

  it('uses the SAME column constants as the row, so the divider cannot drift', () => {
    renderHeader();
    const leftCell = screen.getByText('Movimiento original').parentElement;
    const rightCell = screen.getByText('Rechazo bancario').parentElement;
    const grid = leftCell.parentElement;
    for (const cls of AUTOMATCH_COLUMNS.split(' ')) expect(grid.classList).toContain(cls);
    for (const cls of AUTOMATCH_LEFT_CELL.split(' ')) expect(leftCell.classList).toContain(cls);
    for (const cls of AUTOMATCH_RIGHT_CELL.split(' ')) expect(rightCell.classList).toContain(cls);
    expect(rightCell.className).toContain('border-l');
    expect(leftCell.className).not.toContain('border-l');
  });

  it('header and a row agree on the grid, the left cell and the right cell classes', () => {
    render(
      <>
        <AutoMatchCardHeader selectAll={null} leftTitle="L" count={1} rightTitle="R" />
        <AutoMatchPairRow
          checked={false} onToggle={() => {}} checkLabel="c" checkTestId="c" testId="r"
          left={<span data-testid="rl" />} right={<span data-testid="rr" />} />
      </>,
    );
    const headerGrid = screen.getByText('L').parentElement.parentElement;
    const rowGrid = screen.getByTestId('rl').parentElement.parentElement.parentElement;
    expect(headerGrid.className).toBe(rowGrid.className);
    expect(screen.getByText('R').parentElement.className).toContain(AUTOMATCH_RIGHT_CELL);
    expect(screen.getByTestId('rr').parentElement.parentElement.className).toContain(AUTOMATCH_RIGHT_CELL);
  });
});
