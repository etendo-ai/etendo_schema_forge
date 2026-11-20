// @covers tools/app-shell/src/windows/custom/shared/RemittanceLink.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import RemittanceLink from '../RemittanceLink.jsx';

const caps = vi.hoisted(() => ({ current: { sepaRemittances: true } }));
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => caps.current }));

// Interpolating translator: proves the label is built from the key AND the remittance number.
const ui = (key, params = {}) => `${key}(${params.documentNo ?? ''})`;

describe('RemittanceLink', () => {
  beforeEach(() => { caps.current = { sepaRemittances: true }; });

  it('shows the number as plain text, not a link, without the sepaRemittances capability', () => {
    // The remittance route is guarded by the flag: a tenant whose flag was turned off after
    // remitting still sees which remittance owns the payment, but gets no link into a closed page.
    caps.current = {};
    const onOpen = vi.fn();
    render(<RemittanceLink payment={{ remittanceId: 'R1', remittanceDocumentNo: '7' }} ui={ui} onOpen={onOpen} />);
    expect(screen.queryByTestId('remittance-link')).toBeNull();
    const label = screen.getByTestId('remittance-link-label');
    expect(label).toHaveTextContent('remittancePaymentLink(7)');
    fireEvent.click(label);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders the remittance label with its document number', () => {
    render(<RemittanceLink payment={{ remittanceId: 'R1', remittanceDocumentNo: '1000123' }} ui={ui} onOpen={vi.fn()} />);
    const link = screen.getByTestId('remittance-link');
    expect(link).toHaveTextContent('remittancePaymentLink(1000123)');
    expect(link).toHaveAttribute('title', 'remittancePaymentLink(1000123)');
  });

  it('calls onOpen with the remittance id on click', () => {
    const onOpen = vi.fn();
    render(<RemittanceLink payment={{ remittanceId: 'R1', remittanceDocumentNo: '7' }} ui={ui} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('remittance-link'));
    expect(onOpen).toHaveBeenCalledWith('R1');
  });

  it('stops propagation so the click does not also open the row it sits in', () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick} data-testid="row">
        <RemittanceLink payment={{ remittanceId: 'R1' }} ui={ui} onOpen={onOpen} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('remittance-link'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('builds the label with an empty number when remittanceDocumentNo is missing', () => {
    render(<RemittanceLink payment={{ remittanceId: 'R1' }} ui={ui} onOpen={vi.fn()} />);
    expect(screen.getByTestId('remittance-link')).toHaveTextContent('remittancePaymentLink()');
  });

  it('honours a custom testid and merges the extra style', () => {
    render(
      <RemittanceLink payment={{ remittanceId: 'R1' }} ui={ui} onOpen={vi.fn()} testid="custom-link" style={{ fontSize: 11 }} />,
    );
    const link = screen.getByTestId('custom-link');
    expect(link.style.fontSize).toBe('11px');
    expect(link).toHaveAttribute('type', 'button');
  });

  it('renders nothing for a payment without remittanceId', () => {
    const { container } = render(<RemittanceLink payment={{ id: 'p1', remittanceDocumentNo: '7' }} ui={ui} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('remittance-link')).toBeNull();
  });

  it('renders nothing without a payment', () => {
    const { container } = render(<RemittanceLink payment={null} ui={ui} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
