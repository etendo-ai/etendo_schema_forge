// @covers artifacts/remittance/custom/RemittanceAdvancedOptions.jsx
//
// The collection option of a remittance header: the scheme (Core | B2B), handed to the header form (`onChange`),
// read-only once processed. Only the i18n hook is mocked.
vi.mock('@/i18n', () => ({ useUI: () => (key) => key }));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemittanceAdvancedOptions, { advancedOptionValues } from '@generated/remittance/custom/RemittanceAdvancedOptions.jsx';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const info = (extra = {}) => ({ directDebitScheme: 'CORE', ...extra });
const renderOptions = (props = {}) => {
  const onChange = vi.fn();
  const onTouched = vi.fn();
  const view = render(<RemittanceAdvancedOptions info={info()} processed={false} onChange={onChange} onTouched={onTouched} {...props} />);
  return { onChange, onTouched, ...view };
};

describe('advancedOptionValues', () => {
  it('defaults to Core and lets a choice win over the server value', () => {
    expect(advancedOptionValues(null, {})).toEqual({ scheme: 'CORE' });
    expect(advancedOptionValues({ directDebitScheme: 'B2B' }, {})).toEqual({ scheme: 'B2B' });
    expect(advancedOptionValues({ directDebitScheme: 'B2B' }, { scheme: 'CORE' })).toEqual({ scheme: 'CORE' });
  });
});

describe('RemittanceAdvancedOptions', () => {
  it('shows the scheme right away as a header field, with the default Core', () => {
    renderOptions();
    expect(screen.getByTestId('remittance-scheme-trigger')).toHaveTextContent('remittanceSchemeCore');
    expect(screen.queryByTestId('remittance-advanced-toggle')).toBeNull();
  });

  it('on a new remittance hands nothing to the header form', () => {
    const { onChange, onTouched } = renderOptions({ info: null });
    expect(onChange).not.toHaveBeenCalled();
    expect(onTouched).not.toHaveBeenCalled();
  });

  it('shows the server scheme', () => {
    renderOptions({ info: info({ directDebitScheme: 'B2B' }) });
    expect(screen.getByTestId('remittance-scheme-trigger')).toHaveTextContent('remittanceSchemeB2b');
  });

  it('has a short help (i), from the shared info button', () => {
    renderOptions();
    expect(screen.getByTestId('remittance-scheme-info')).toHaveAttribute('aria-label', 'remittanceDirectDebitSchemeInfo');
  });

  it('hands the chosen scheme to the header form and marks it as touched', async () => {
    const user = userEvent.setup();
    const { onChange, onTouched } = renderOptions();
    await user.click(screen.getByTestId('remittance-scheme-trigger'));
    await user.click(await screen.findByTestId('remittance-scheme-option-b2b'));
    expect(onChange).toHaveBeenCalledWith('directDebitScheme', 'B2B');
    expect(onTouched).toHaveBeenCalled();
    expect(screen.getByTestId('remittance-scheme-trigger')).toHaveTextContent('remittanceSchemeB2b');
  });

  it('is read-only with the value once processed', () => {
    renderOptions({ info: info({ directDebitScheme: 'B2B' }), processed: true });
    // The same disabled grey input as the other read-only header fields, holding the value.
    expect(screen.getByTestId('remittance-scheme-value')).toHaveValue('remittanceSchemeB2b');
    expect(screen.getByTestId('remittance-scheme-value')).toBeDisabled();
    expect(screen.queryByTestId('remittance-scheme-trigger')).toBeNull();
  });
});
