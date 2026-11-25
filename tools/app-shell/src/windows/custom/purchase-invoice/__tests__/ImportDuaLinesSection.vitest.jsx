// @covers tools/app-shell/src/windows/custom/purchase-invoice/ImportDuaLinesSection.jsx
//
// The "Importación con DUA" switch must not be locked by the F5 the SIF tab set after the user
// checked it; only a legacy F5 / LC (stored check off) locks it. Unchecking writes the check off
// plus Tipo factura F1 in the same batch when the organization files SII. While checked, one block
// follows (the DUA section wrapping the import tax lines); DUA and Fecha DUA are required only when
// the organization files SII for the invoice (SII profile + accounting date on/after adoption).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fiscal = { profile: 'sii', earliestSiiCutoverDate: '2020-01-01' };
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => ({ siiImportDua: true }) }));
vi.mock('@/auth/AuthContext.jsx', () => ({ useAuth: () => ({ selectedOrg: { id: 'org-1' } }) }));
vi.mock('@/windows/custom/fiscal-config/useFiscalConfig.js', () => ({
  useFiscalConfig: () => ({
    profile: fiscal.profile, tbaiRecord: null, earliestSiiCutoverDate: fiscal.earliestSiiCutoverDate,
  }),
}));
// The two sections stubbed at their contract: the DUA section renders its children (one block).
vi.mock('@/windows/custom/shared/SiiImportDuaSection.jsx', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ duaRequired, step, children }) => createElement('section', {
      'data-testid': 'stub-dua-block', 'data-required': String(duaRequired), 'data-step': String(step),
    }, children),
    useSiiImportDuaEnabled: () => true,
  };
});
vi.mock('@/windows/custom/shared/SiiImportTaxesSection.jsx', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ duaRequired, step }) => createElement('div', {
      'data-testid': 'stub-import-taxes', 'data-required': String(duaRequired), 'data-step': String(step),
    }),
    useSiiDeferredVat: () => false,
  };
});

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

describe('ImportDuaLinesSection — one block, DUA required only for SII', () => {
  beforeEach(() => { fiscal.profile = 'sii'; fiscal.earliestSiiCutoverDate = '2020-01-01'; });

  const checked = { ...draft, etgoImportDua: true, accountingDate: '2026-11-01' };

  it('renders the import tax lines inside the DUA block, with no step numbers', () => {
    renderSection(checked);
    const block = screen.getByTestId('stub-dua-block');
    expect(block).toContainElement(screen.getByTestId('stub-import-taxes'));
    expect(block).toHaveAttribute('data-step', 'undefined');
    expect(screen.getByTestId('stub-import-taxes')).toHaveAttribute('data-step', 'undefined');
  });

  it('requires the DUA for an organization in SII adopted on or before the accounting date', () => {
    renderSection(checked);
    expect(screen.getByTestId('stub-dua-block')).toHaveAttribute('data-required', 'true');
    expect(screen.getByTestId('stub-import-taxes')).toHaveAttribute('data-required', 'true');
  });

  it('keeps the DUA optional for an organization not in SII', () => {
    fiscal.profile = 'verifactu';
    renderSection(checked);
    expect(screen.getByTestId('stub-dua-block')).toHaveAttribute('data-required', 'false');
    expect(screen.getByTestId('stub-import-taxes')).toHaveAttribute('data-required', 'false');
  });

  it('keeps it optional for an invoice dated before the SII adoption', () => {
    fiscal.earliestSiiCutoverDate = '2027-01-01';
    renderSection(checked);
    expect(screen.getByTestId('stub-dua-block')).toHaveAttribute('data-required', 'false');
  });

  it('shows no block while unchecked', () => {
    renderSection({ ...draft, etgoImportDua: false });
    expect(screen.queryByTestId('stub-dua-block')).toBeNull();
  });
});
