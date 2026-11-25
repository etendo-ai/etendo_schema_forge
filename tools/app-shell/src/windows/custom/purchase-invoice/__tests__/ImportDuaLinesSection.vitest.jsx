// @covers tools/app-shell/src/windows/custom/purchase-invoice/ImportDuaLinesSection.jsx
//
// The "Importación con DUA" switch must not be locked by the F5 the SIF tab set after the user
// checked it; only a legacy F5 / LC (stored check off) locks it. Unchecking writes the check off
// plus Tipo factura F1 in the same batch when the organization files SII.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fiscal = { profile: 'sii' };
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => ({ siiImportDua: true }) }));
vi.mock('@/auth/AuthContext.jsx', () => ({ useAuth: () => ({ selectedOrg: { id: 'org-1' } }) }));
vi.mock('@/windows/custom/fiscal-config/useFiscalConfig.js', () => ({
  useFiscalConfig: () => ({ profile: fiscal.profile, tbaiRecord: null }),
}));
vi.mock('@/windows/custom/shared/SiiImportDuaSection.jsx', () => ({
  default: () => null,
  useSiiImportDuaEnabled: () => true,
}));
vi.mock('@/windows/custom/shared/SiiImportTaxesSection.jsx', () => ({
  default: () => null,
  useSiiDeferredVat: () => false,
}));

import { createElement as h } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ImportDuaLinesSection from '../ImportDuaLinesSection.jsx';

const draft = { id: 'inv-1', adOrgId: 'org-1', documentStatus: 'DR', processed: false };

function renderSection(data, onFieldChange = vi.fn()) {
  render(h(ImportDuaLinesSection, { data, recordId: 'inv-1', apiBaseUrl: '/api/purchase-invoice', onFieldChange }));
  return { onFieldChange, switchEl: screen.getByTestId('Switch__importDua') };
}

describe('ImportDuaLinesSection — lock and uncheck', () => {
  beforeEach(() => { fiscal.profile = 'sii'; });

  it('keeps the switch toggleable when the user checked it and the SIF tab set F5', () => {
    const { switchEl } = renderSection({ ...draft, etgoImportDua: true, aeatsiiClaveTipoFc: 'F5' });
    expect(switchEl).not.toBeDisabled();
  });

  it('locks it on a legacy F5 / LC with the stored check off', () => {
    const { switchEl } = renderSection({ ...draft, etgoImportDua: false, aeatsiiClaveTipoFc: 'LC' });
    expect(switchEl).toBeDisabled();
  });

  it('unchecking writes the check off, then Tipo factura F1, in one batch', () => {
    const { switchEl, onFieldChange } = renderSection({ ...draft, etgoImportDua: 'Y', aeatsiiClaveTipoFc: 'F5' });
    fireEvent.click(switchEl);
    expect(onFieldChange.mock.calls).toEqual([['etgoImportDua', false], ['aeatsiiClaveTipoFc', 'F1']]);
  });

  it('writes only the check when the organization does not file SII', () => {
    fiscal.profile = 'unconfigured';
    const { switchEl, onFieldChange } = renderSection({ ...draft, etgoImportDua: true, aeatsiiClaveTipoFc: 'F5' });
    fireEvent.click(switchEl);
    expect(onFieldChange.mock.calls).toEqual([['etgoImportDua', false]]);
  });

  it('with manual tax lines, asks first and applies the same combined write on confirm', () => {
    const { switchEl, onFieldChange } = renderSection({
      ...draft, etgoImportDua: true, aeatsiiClaveTipoFc: 'F5', hasManualTaxLines: true,
    });
    fireEvent.click(switchEl);
    expect(onFieldChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('Button__importDuaUncheck-confirm'));
    expect(onFieldChange.mock.calls).toEqual([['etgoImportDua', false], ['aeatsiiClaveTipoFc', 'F1']]);
  });
});
