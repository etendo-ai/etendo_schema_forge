// @covers tools/app-shell/src/windows/custom/remittance/index.jsx
// @covers artifacts/remittance/decisions.json
// Same shape as invoice-inbox/__tests__/index.vitest.jsx: both routes guard a window behind a
// per-account capability AND the role's window access.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import menuConfig from '../../../../menu.json';
import decisions from '@generated/remittance/decisions.json';
import enUS from '@/locales/en_US.json';
import esES from '@/locales/es_ES.json';
import esAR from '@/locales/es_AR.json';

let mockCapabilities = {};
let mockTier = 'full';
let mockAuth = {};
const mockWindowIds = [];

vi.mock('@etendosoftware/app-shell-core/auth', () => ({ useAuthOptional: () => mockAuth }));
vi.mock('@/auth/AuthContext.jsx', () => ({ useWindowAccess: (id) => { mockWindowIds.push(id); return mockTier; } }));
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => mockCapabilities }));
vi.mock('@/components/access/ProcessAccessGuard.jsx', () => ({
  AccessDeniedMessage: () => <div data-testid="window-access-denied" />,
}));
let mockAppProps = {};
const mockApiFetch = vi.fn();
const mockRootFetch = vi.fn();
vi.mock('@/auth/useApiFetch.js', () => ({
  useApiFetch: (base) => (base === '/root-base' ? mockRootFetch : mockApiFetch),
}));
vi.mock('@/hooks/useNeoResource.js', async (importOriginal) => ({ ...(await importOriginal()), getApiBase: () => '/root-base' }));
const mockDownloadBlobAsFile = vi.fn();
vi.mock('@/windows/custom/shared/pdfUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadBlobAsFile: (...args) => mockDownloadBlobAsFile(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@generated/remittance/custom/RemittanceSentDialog.jsx', () => ({
  default: (props) => (
    <div data-testid="row-sent-dialog" data-record={props.record?.id} data-api={props.apiBaseUrl}>
      <button type="button" data-testid="row-dialog-refresh" onClick={() => props.onRefresh()}>refresh</button>
      <button type="button" data-testid="row-dialog-close" onClick={() => props.onClose()}>close</button>
    </div>
  ),
}));
vi.mock('@generated/remittance/custom/RemittanceCollectDialog.jsx', () => ({
  default: (props) => <div data-testid="row-collect-dialog" data-record={props.record?.id} />,
}));
vi.mock('@generated/remittance/generated/web/remittance/index.jsx', () => ({
  default: (props) => {
    mockAppProps = props;
    return (
      <div data-testid="remittance-app" data-api={props.apiBaseUrl} data-save-actions-first={String(props.saveActionsFirst)} data-status-variants={JSON.stringify(props.statusEnumVariants)} data-refresh-trigger={String(props.refreshTrigger)} />
    );
  },
}));

import RemittanceRoute, { REMITTANCE_WINDOW_ID } from '../index.jsx';
import { evalDisplayLogicRaw } from '@/components/contract-ui/detailViewHelpers.jsx';
import { act, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import { resolveStatusTone } from '@/lib/statusToneOverride.js';

beforeEach(() => {
  mockCapabilities = { sepaRemittances: true };
  mockTier = 'full';
  mockAuth = { accessLoaded: true };
  mockWindowIds.length = 0;
});

const renderRoute = () => render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" />);

describe('Remittance route guard', () => {
  it('renders the generated window, forwarding props, when the capability is on and the window access is granted', () => {
    renderRoute();
    expect(screen.getByTestId('remittance-app')).toHaveAttribute('data-api', '/sws/neo/remittance');
    expect(screen.queryByTestId('window-access-denied')).toBeNull();
    expect(mockWindowIds).toContain(REMITTANCE_WINDOW_ID);
    expect(REMITTANCE_WINDOW_ID).toBe('FF8080812E71F7C7012E71FD0499001B');
  });

  // ETP-6148 round 3 — Guardar renders before Procesar / Reactivar, so the toolbar reads
  // trash · Guardar · Procesar. The ordering itself is DetailView's (DetailView.saveButtons
  // .vitest.jsx › "toolbar order — saveActionsFirst"); this guards that the route opts in.
  it('opts the generated window into saveActionsFirst', () => {
    renderRoute();
    expect(screen.getByTestId('remittance-app')).toHaveAttribute('data-save-actions-first', 'true');
  });

  it('a caller cannot drop saveActionsFirst by passing it as false', () => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" saveActionsFirst={false} />);
    expect(screen.getByTestId('remittance-app')).toHaveAttribute('data-save-actions-first', 'true');
  });

  it('checks the same window id the sidebar entry is gated by', () => {
    const item = menuConfig.menu.flatMap(group => group.items).find(entry => entry.name === 'remittance');
    expect(item.accessWindowId).toBe(REMITTANCE_WINDOW_ID);
    expect(item.capability).toBe('sepaRemittances');
  });

  it('denies access without the sepaRemittances capability', () => {
    mockCapabilities = { sepaRemittances: false };
    renderRoute();
    expect(screen.getByTestId('window-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('remittance-app')).toBeNull();
  });

  it('fails closed when the capability key is absent', () => {
    mockCapabilities = {};
    renderRoute();
    expect(screen.getByTestId('window-access-denied')).toBeInTheDocument();
  });

  it('denies access when the window access tier is none', () => {
    mockTier = 'none';
    renderRoute();
    expect(screen.getByTestId('window-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('remittance-app')).toBeNull();
  });

  it('renders the window for a read-only tier (only none is refused)', () => {
    mockTier = 'read-only';
    renderRoute();
    expect(screen.getByTestId('remittance-app')).toBeInTheDocument();
  });

  it('an admin without the capability is still denied (capability is its own axis)', () => {
    mockCapabilities = { isAdminOrClientAdmin: true };
    renderRoute();
    expect(screen.getByTestId('window-access-denied')).toBeInTheDocument();
  });

  it('shows a loading state, not access denied, while the access maps are loading', () => {
    mockAuth = { accessLoaded: false };
    mockCapabilities = {};
    renderRoute();
    expect(screen.getByTestId('remittance-access-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('window-access-denied')).toBeNull();
    expect(screen.queryByTestId('remittance-app')).toBeNull();
  });

  it('fails closed once loaded', () => {
    mockAuth = { accessLoaded: true };
    mockCapabilities = {};
    renderRoute();
    expect(screen.getByTestId('window-access-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('remittance-access-loading')).toBeNull();
  });

  it('treats a missing accessLoaded (no AuthProvider / older core) as loaded', () => {
    mockAuth = undefined;
    renderRoute();
    expect(screen.getByTestId('remittance-app')).toBeInTheDocument();
  });
});

// The remittance status codes (Remittance_Status) are labelled through i18n keys declared in the
// window's decisions; the AD list ships English names only, so a missing key shows the raw key.
describe('Remittance status labels', () => {
  const statusKeys = Object.values(decisions.window.statusEnumLabels);

  it('declares a label for each remittance status code', () => {
    expect(Object.keys(decisions.window.statusEnumLabels).sort()).toEqual(['AN', 'CP', 'CT', 'PE', 'PP', 'PR', 'PT', 'SB']);
  });

  it.each([['en_US', enUS], ['es_ES', esES], ['es_AR', esAR]])('every status label key exists in %s', (_loc, json) => {
    for (const key of statusKeys) expect(json.genericLabels[key], key).toEqual(expect.stringMatching(/\S/));
  });

  it('hands DetailView the status field enumVariants from decisions.json, so the detail pill matches the grid chip', () => {
    renderRoute();
    const variants = JSON.parse(screen.getByTestId('remittance-app').dataset.statusVariants);
    expect(variants).toEqual(decisions.entities.remittance.fields.remittanceStatus.enumVariants);
    expect(variants).toMatchObject({ CT: 'success', PT: 'success', PE: 'neutral', PR: 'warning', SB: 'info', AN: 'destructive' });
  });

  it('declares «Devolver» as a confirmModal header process gated on the status, and names a voided receipt «Devuelto»', () => {
    const ret = decisions.entities.remittance.processOverrides?.returnLines ?? decisions.window.processOverrides?.returnLines;
    expect(ret).toMatchObject({ add: true, confirmModal: true, requiresLines: true, displayLogicRaw: expect.stringContaining('@RemittanceStatus@') });
    const names = Object.fromEntries(decisions.entities.lines.fields.status.enumValues.map((e) => [e.value, e.name]));
    expect(names.RPVOID).toBe('remittanceReceiptReturned');
    expect(names.RPAP).toBe('statusRpap');
  });
});

describe('Remittance route — statusEnumVariants precedence', () => {
  it('an explicit statusEnumVariants from the caller wins over the one from decisions.json', () => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" statusEnumVariants={{ PE: 'destructive' }} />);
    expect(JSON.parse(screen.getByTestId('remittance-app').dataset.statusVariants)).toEqual({ PE: 'destructive' });
  });

  it('without a caller map it hands exactly the decisions.json one', () => {
    renderRoute();
    expect(JSON.parse(screen.getByTestId('remittance-app').dataset.statusVariants)).toEqual(decisions.entities.remittance.fields.remittanceStatus.enumVariants);
  });
});

describe('Remittance status chip tones (grid chip and detail pill read the same map)', () => {
  const variants = decisions.entities.remittance.fields.remittanceStatus.enumVariants;

  it.each([
    ['PE', 'neutral'], ['PR', 'warning'], ['SB', 'info'], ['CT', 'success'], ['PT', 'success'], ['CP', 'warning'], ['PP', 'warning'], ['AN', 'destructive'],
  ])('%s resolves to the %s tone', (code, tone) => {
    expect(resolveStatusTone(code, variants)).toBe(tone);
  });

  it('declares a tone for exactly the status codes that have a label, and nothing else', () => {
    expect(Object.keys(variants).sort()).toEqual(Object.keys(decisions.window.statusEnumLabels).sort());
    expect(Object.keys(variants).sort()).toEqual(decisions.entities.remittance.fields.remittanceStatus.enumValues.map((e) => e.value).sort());
  });
});

describe('header action visibility by status (displayLogicRaw)', () => {
  const overrides = decisions.window.processOverrides;
  const visible = (name, status) => evalDisplayLogicRaw(overrides[name].displayLogicRaw, { remittanceStatus: status });
  const ALL = ['PE', 'PR', 'SB', 'CT', 'PT', 'CP', 'PP', 'AN'];
  const shown = (name) => ALL.filter((status) => visible(name, status));

  it('«Pasar a Enviada al banco» only on PR', () => { expect(shown('markSent')).toEqual(['PR']); });
  it('«Pasar a Cobrada» only on SB (no longer straight from PR in the UI)', () => { expect(shown('markCollected')).toEqual(['SB']); });
  it('«Reactivar» on PR and SB', () => { expect(shown('reactivate')).toEqual(['PR', 'SB']); });
  it('«Devolver» only on CT and CP, never before collected', () => { expect(shown('returnLines')).toEqual(['CT', 'CP']); });
  it('«Confirmar» only while unprocessed', () => {
    expect(evalDisplayLogicRaw(overrides.confirm.displayLogicRaw, { processed: 'N' })).toBe(true);
    expect(evalDisplayLogicRaw(overrides.confirm.displayLogicRaw, { processed: 'Y' })).toBe(false);
  });
  it('a record without a status keeps the actions visible (the generic default)', () => {
    expect(evalDisplayLogicRaw(overrides.markSent.displayLogicRaw, {})).toBe(true);
  });
});

// Every key the remittance custom files ask `useUI()` for must exist, or the user reads the raw key.
describe('Remittance i18n keys', () => {
  const customDir = join(__dirname, '../../../../../../../artifacts/remittance/custom');
  const sources = readdirSync(customDir).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => readFileSync(join(customDir, f), 'utf8'));
  const literal = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/\b(?:ui|t)\(\s*'([A-Za-z][\w.]*)'/g)) literal.add(m[1]);
    for (const m of src.matchAll(/'((?:backendError\.)?remittance[A-Z]\w*)'/g)) literal.add(m[1]);
  }
  const keys = [...literal].sort();
  const own = keys.filter((k) => /^(backendError\.)?remittance[A-Z]/.test(k));

  it('finds the keys it is supposed to check (guards against a regex that matches nothing)', () => {
    expect(keys.length).toBeGreaterThan(60);
    expect(keys).toEqual(expect.arrayContaining(['remittanceReturnTitle', 'remittanceFileDownload', 'remittanceFileIncludesReturned', 'remittanceFileIncludesReturnedOne']));
  });

  it.each([['en_US', enUS], ['es_ES', esES]])('every key the custom files use exists in %s', (_loc, json) => {
    const missing = keys.filter((k) => !/\S/.test(json.genericLabels[k] ?? ''));
    expect(missing).toEqual([]);
  });

  it('every remittance-specific key exists in es_AR (generic keys such as «cancel» fall back to es_ES)', () => {
    const missing = own.filter((k) => !/\S/.test(esAR.genericLabels[k] ?? ''));
    expect(missing).toEqual([]);
  });

  it('the parameterized messages keep their placeholders in the three locales', () => {
    for (const json of [enUS, esES, esAR]) {
      expect(json.genericLabels.remittanceReturnSuccess).toContain('{count}');
      expect(json.genericLabels.remittanceReturnReturnedOn).toContain('{date}');
      expect(json.genericLabels.remittanceFileIncludesReturned).toContain('{count}');
      expect(json.genericLabels.remittanceFileIncludesReturnedOne).toContain('{count}');
    }
  });
});

// ETP-6247 — the grid's row menu (⋮): one «Cambiar estado» entry with a submenu of status chips.
describe('Row menu (grid ⋮) «Cambiar estado»', () => {
  const menuFor = (status) => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" />);
    return mockAppProps.rowQuickActions.menuActions({ row: { id: 'rem-7', remittanceStatus: status } });
  };
  const item = (menu, status) => menu[0].submenu.find((i) => i.key === status);
  const withoutFile = (menu) => menu.filter((a) => a.key !== 'downloadFile');

  it('keeps decisions.json\' duplicate/email opt-outs and hands the menu as a function of the row', () => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" />);
    expect(mockAppProps.rowQuickActions.actions).toEqual(decisions.window.rowQuickActions.actions);
    expect(typeof mockAppProps.rowQuickActions.menuActions).toBe('function');
  });

  it('is the first entry, with the clock icon and the three flow statuses as chips, in flow order', () => {
    const menu = menuFor('PR');
    expect(menu).toHaveLength(2);
    expect(menu[0]).toMatchObject({ key: 'changeStatus', labelKey: 'remittanceChangeStatus' });
    expect(menu[0].icon).toBeTruthy();
    expect(menu[0].submenu.map((i) => i.key)).toEqual(['PR', 'SB', 'CT']);
  });

  it.each([['PE'], ['CT'], ['PT'], ['CP'], ['PP'], ['AN']])('a %s row has no «Cambiar estado» (no transition today)', (status) => {
    expect(withoutFile(menuFor(status))).toEqual([]);
  });

  it('from PR only «Enviada al banco» is clickable; the current status and Cobrada are dimmed but listed', () => {
    const menu = menuFor('PR');
    expect(menu[0].submenu.map((i) => [i.key, i.disabled])).toEqual([['PR', true], ['SB', false], ['CT', true]]);
  });

  it('from SB only «Cobrada» is clickable (no way back, current status dimmed)', () => {
    const menu = menuFor('SB');
    expect(menu[0].submenu.map((i) => [i.key, i.disabled])).toEqual([['PR', true], ['SB', true], ['CT', false]]);
  });

  it('is driven by the process overrides\' own displayLogicRaw, so the grid and the detail cannot drift', () => {
    const overrides = decisions.window.processOverrides;
    for (const status of ['PE', 'PR', 'SB', 'CT', 'PT', 'CP', 'PP', 'AN']) {
      const row = { remittanceStatus: status };
      const menu = withoutFile(menuFor(status));
      const sent = evalDisplayLogicRaw(overrides.markSent.displayLogicRaw, row);
      const collected = evalDisplayLogicRaw(overrides.markCollected.displayLogicRaw, row);
      expect(item(menu.length ? menu : [{ submenu: [] }], 'SB')?.disabled === false).toBe(sent);
      expect(item(menu.length ? menu : [{ submenu: [] }], 'CT')?.disabled === false).toBe(collected);
    }
  });

  it('a caller\'s own rowQuickActions wins', () => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" rowQuickActions={{ actions: {} }} />);
    expect(mockAppProps.rowQuickActions).toEqual({ actions: {} });
  });

  it('choosing a status opens its dialog on that row; finishing refreshes the grid and closing removes it', () => {
    const menu = menuFor('PR');
    act(() => { item(menu, 'SB').onClick({ row: { id: 'rem-7', remittanceStatus: 'PR' } }); });
    expect(screen.getByTestId('row-sent-dialog')).toHaveAttribute('data-record', 'rem-7');
    expect(screen.getByTestId('row-sent-dialog')).toHaveAttribute('data-api', '/sws/neo/remittance');
    expect(screen.getByTestId('remittance-app')).toHaveAttribute('data-refresh-trigger', '0');
    fireEvent.click(screen.getByTestId('row-dialog-refresh'));
    expect(screen.getByTestId('remittance-app')).toHaveAttribute('data-refresh-trigger', '1');
    fireEvent.click(screen.getByTestId('row-dialog-close'));
    expect(screen.queryByTestId('row-sent-dialog')).toBeNull();
  });

  it('choosing «Cobrada» from an SB row opens the collect dialog', () => {
    const menu = menuFor('SB');
    act(() => { item(menu, 'CT').onClick({ row: { id: 'rem-8', remittanceStatus: 'SB' } }); });
    expect(screen.getByTestId('row-collect-dialog')).toHaveAttribute('data-record', 'rem-8');
  });
});

// ETP-6247 — «Descargar fichero» in the grid's row menu.
describe('Row menu (grid ⋮) «Descargar fichero»', () => {
  const menuFor = (status) => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" />);
    return mockAppProps.rowQuickActions.menuActions({ row: { id: 'rem-7', remittanceStatus: status } });
  };
  const downloadEntry = (status) => menuFor(status).find((a) => a.key === 'downloadFile');
  const fileAnswer = (extra = {}) => ({ ok: true, status: 200, json: async () => ({ response: { data: { fileName: 'remesa.xml', content: '<Document/>', returnedCount: 0, ...extra } } }) });

  beforeEach(() => {
    mockApiFetch.mockReset();
    mockRootFetch.mockReset();
    mockDownloadBlobAsFile.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it.each([['PR'], ['SB'], ['CT'], ['PT'], ['CP'], ['PP']])('a %s row offers it, after «Cambiar estado»', (status) => {
    const keys = menuFor(status).map((a) => a.key);
    expect(keys[keys.length - 1]).toBe('downloadFile');
    expect(downloadEntry(status)).toMatchObject({ labelKey: 'remittanceFileDownload' });
    expect(downloadEntry(status).icon).toBeTruthy();
  });

  it.each([['PE'], ['AN']])('a %s row does not', (status) => {
    expect(downloadEntry(status)).toBeUndefined();
  });

  it('downloads the file generated on the fly (downloadFile, no attachment) and opens nothing', async () => {
    mockApiFetch.mockResolvedValue(fileAnswer());
    await act(async () => { await downloadEntry('SB').onClick({ row: { id: 'rem-7' } }); });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch.mock.calls[0][0]).toBe('/remittance/rem-7/action/downloadFile');
    expect(mockRootFetch).not.toHaveBeenCalled();
    expect(mockDownloadBlobAsFile).toHaveBeenCalledWith(expect.any(Blob), 'remesa.xml');
    expect(screen.queryByTestId('row-sent-dialog')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('adds an informative toast when the file carries returned receipts', async () => {
    mockApiFetch.mockResolvedValue(fileAnswer({ returnedCount: 1 }));
    await act(async () => { await downloadEntry('CP').onClick({ row: { id: 'rem-7' } }); });
    expect(toast.info).toHaveBeenCalledWith('remittanceFileIncludesReturnedOne');
  });

  it('toasts a failed download with the translated fallback', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await act(async () => { await downloadEntry('PR').onClick({ row: { id: 'rem-7' } }); });
    expect(toast.error).toHaveBeenCalledWith('remittanceFileDownloadError');
    expect(mockDownloadBlobAsFile).not.toHaveBeenCalled();
  });
});

// ETP-6247 — the detail: «Descargar fichero» in the top bar. There is no «Regenerar fichero» any more: the file is
// generated on the fly at every download, nothing is stored.
describe('Detail file actions', () => {

  it('hands the top-bar slot the download button (topbarSecondary)', () => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" />);
    expect(mockAppProps.topbarSecondary.name ?? mockAppProps.topbarSecondary.displayName).toBe('RemittanceDownloadButton');
  });

  it.each([['PE'], ['PR'], ['SB'], ['CT'], ['PT'], ['CP'], ['PP'], ['AN']])('a %s remittance gets no detail kebab entry (no «Regenerar fichero»)', () => {
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" />);
    expect(mockAppProps.menuActions).toBeUndefined();
  });

  it('a caller\'s own menuActions / topbarSecondary win', () => {
    const own = () => [];
    render(<RemittanceRoute apiBaseUrl="/sws/neo/remittance" menuActions={own} topbarSecondary={null} />);
    expect(mockAppProps.menuActions).toBe(own);
    expect(mockAppProps.topbarSecondary).toBeNull();
  });
});
