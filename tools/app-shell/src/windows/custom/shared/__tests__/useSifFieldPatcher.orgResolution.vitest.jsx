// @covers tools/app-shell/src/windows/custom/shared/useSifFieldPatcher.js
// @covers tools/app-shell/src/windows/custom/shared/importDua.js
//
// ETP-5087 follow-up: useSifFieldPatcher must key useFiscalConfig by the
// INVOICE's own org (data.adOrgId), not the top-nav org selector. A mismatch
// used to silently fetch the wrong TBAI/SII config (and territory), leaving
// the SIF tab's editable-field gating and options blind to the real invoice.
//
// Mocks must be declared before any imports that pull in the mocked modules.

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
}));

vi.mock('@/auth/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedOrg: { id: 'ORG-SELECTED' } }),
}));

const useFiscalConfigMock = vi.fn(() => ({ profile: 'sii+tbai', tbaiRecord: { etsgSifTerritory: 'BIZKAIA' } }));
vi.mock('@/windows/custom/fiscal-config/useFiscalConfig.js', () => ({
  useFiscalConfig: (...args) => useFiscalConfigMock(...args),
}));

// The `siiImportDua` capability that gates the F5 auto-switch (off unless a test turns it on).
const caps = { siiImportDua: false };
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => caps }));

vi.mock('@/windows/custom/fiscal-config/fiscalConfig.utils.js', () => ({
  normalizeDateInputValue: (v) => v ?? '',
}));

import { renderHook } from '@testing-library/react';
import { useSifFieldPatcher } from '../useSifFieldPatcher.js';

function renderPatcher(overrides = {}) {
  const props = {
    data: { documentStatus: 'DR' },
    recordId: 'inv-001',
    apiBaseUrl: '/sws/neo/purchase-invoice',
    onChange: vi.fn(),
    ...overrides,
  };
  return renderHook(() => useSifFieldPatcher(props));
}

describe('useSifFieldPatcher — org resolution (ETP-5087 follow-up)', () => {
  beforeEach(() => {
    useFiscalConfigMock.mockClear();
  });

  it('resolves fiscal config using the invoice record adOrgId, not the top-nav selected org', () => {
    renderPatcher({ data: { documentStatus: 'DR', adOrgId: 'ORG-INVOICE' } });
    expect(useFiscalConfigMock).toHaveBeenCalledWith('ORG-INVOICE', '/sws/neo/purchase-invoice');
  });

  it('falls back to the selected org when the invoice record has no adOrgId', () => {
    renderPatcher({ data: { documentStatus: 'DR' } });
    expect(useFiscalConfigMock).toHaveBeenCalledWith('ORG-SELECTED', '/sws/neo/purchase-invoice');
  });

  it('still resolves showTbai correctly (territory-aware) when the invoice org differs from the selected org', () => {
    const { result } = renderPatcher({ data: { documentStatus: 'DR', adOrgId: 'ORG-INVOICE' } });
    expect(useFiscalConfigMock).toHaveBeenCalledWith('ORG-INVOICE', '/sws/neo/purchase-invoice');
    expect(result.current.showTbai).toBe(true);
    expect(result.current.showSii).toBe(true);
  });
});

// The F5 auto-switch of the SIF tab (`importDuaInvoiceTypeToSet`, run as an effect): an import with
// DUA of an organization in SII gets Tipo factura F5 as a PENDING edit (onChange), never LC.
describe('useSifFieldPatcher — import with DUA sets F5', () => {
  const F5_CALL = ['aeatsiiClaveTipoFc', 'F5'];
  const checkedDraft = { documentStatus: 'DR', adOrgId: 'ORG-INVOICE', etgoImportDua: true, aeatsiiClaveTipoFc: 'F1' };

  beforeEach(() => {
    caps.siiImportDua = true;
    useFiscalConfigMock.mockReset();
    useFiscalConfigMock.mockReturnValue({ profile: 'sii', tbaiRecord: null });
  });

  it('writes F5 as a pending edit on a draft SII invoice with the check on', () => {
    const onChange = vi.fn();
    renderPatcher({ data: checkedDraft, onChange });
    expect(onChange.mock.calls).toEqual([F5_CALL]);
  });

  it('also writes F5 when the stored check reads Y', () => {
    const onChange = vi.fn();
    renderPatcher({ data: { ...checkedDraft, etgoImportDua: 'Y' }, onChange });
    expect(onChange).toHaveBeenCalledWith(...F5_CALL);
  });

  it('never overrides LC', () => {
    const onChange = vi.fn();
    renderPatcher({ data: { ...checkedDraft, aeatsiiClaveTipoFc: 'LC' }, onChange });
    expect(onChange).not.toHaveBeenCalledWith('aeatsiiClaveTipoFc', expect.anything());
  });

  it('does nothing for an organization that does not file SII', () => {
    useFiscalConfigMock.mockReturnValue({ profile: 'unconfigured', tbaiRecord: null });
    const onChange = vi.fn();
    renderPatcher({ data: checkedDraft, onChange });
    expect(onChange).not.toHaveBeenCalledWith('aeatsiiClaveTipoFc', expect.anything());
  });

  it('does nothing while the fiscal config is still loading', () => {
    useFiscalConfigMock.mockReturnValue({ profile: undefined, tbaiRecord: null });
    const onChange = vi.fn();
    renderPatcher({ data: checkedDraft, onChange });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['completed', { documentStatus: 'CO', processed: true }, {}],
    ['processed draft', { processed: true }, {}],
    ['sent to SII', { aeatsiiIssent: 'Y' }, {}],
    ['opened by a read-only role', {}, { locked: true }],
    ['new (no record id yet)', {}, { recordId: null }],
  ])('does nothing on a %s invoice', (_label, patch, extra) => {
    const onChange = vi.fn();
    renderPatcher({ data: { ...checkedDraft, ...patch }, onChange, ...extra });
    expect(onChange).not.toHaveBeenCalledWith('aeatsiiClaveTipoFc', expect.anything());
  });

  it('does nothing with the siiImportDua capability off', () => {
    caps.siiImportDua = false;
    const onChange = vi.fn();
    renderPatcher({ data: checkedDraft, onChange });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing on a sales invoice (the F5 field is purchase-only)', () => {
    const onChange = vi.fn();
    renderPatcher({ data: checkedDraft, onChange, apiBaseUrl: '/sws/neo/sales-invoice' });
    expect(onChange).not.toHaveBeenCalledWith('aeatsiiClaveTipoFc', expect.anything());
    expect(onChange).not.toHaveBeenCalledWith('aeatsiiClaveTipo', 'F5');
  });

  it('does not set F5 back once the record is unchecked to N + F1', () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ data }) => useSifFieldPatcher({ data, recordId: 'inv-001', apiBaseUrl: '/sws/neo/purchase-invoice', onChange }),
      { initialProps: { data: { ...checkedDraft, aeatsiiClaveTipoFc: 'F5' } } },
    );
    expect(onChange).not.toHaveBeenCalled();

    // The Lines-tab uncheck batch (check off, then F1), and later the saved record (N + F1).
    rerender({ data: { ...checkedDraft, etgoImportDua: false, aeatsiiClaveTipoFc: 'F1' } });
    rerender({ data: { ...checkedDraft, etgoImportDua: 'N', aeatsiiClaveTipoFc: 'F1' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
