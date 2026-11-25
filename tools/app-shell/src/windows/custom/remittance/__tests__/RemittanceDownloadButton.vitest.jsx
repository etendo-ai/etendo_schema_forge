// @covers artifacts/remittance/custom/RemittanceDownloadButton.jsx
// @covers artifacts/remittance/custom/remittanceFileApi.js
//
// ETP-6247 — «Descargar fichero» in the detail's top bar. The file is generated on the fly by the read-only
// `downloadFile` action (nothing is attached). Real remittanceFileApi and backendErrors; only `useApiFetch`, the
// browser download and the toasts are mocked.
const mockApiFetch = vi.fn();
vi.mock('@/auth/useApiFetch.js', () => ({ useApiFetch: () => mockApiFetch }));
const mockDownloadBlobAsFile = vi.fn();
vi.mock('@/windows/custom/shared/pdfUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadBlobAsFile: (...args) => mockDownloadBlobAsFile(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const mockUi = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
vi.mock('@/i18n', () => ({ useUI: () => mockUi }));

import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import RemittanceDownloadButton from '@generated/remittance/custom/RemittanceDownloadButton.jsx';

const json = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
const fileAnswer = (extra = {}) => json({ response: { data: { fileName: 'remesa.xml', contentType: 'application/xml', content: '<Document/>', returnedCount: 0, ...extra } } });
const renderButton = (status) => render(<RemittanceDownloadButton data={{ id: 'rem-1', remittanceStatus: status }} apiBaseUrl="/sws/neo/remittance" />);
const click = async () => { await act(async () => { fireEvent.click(screen.getByTestId('remittance-file-download')); }); };

beforeEach(() => { vi.clearAllMocks(); mockApiFetch.mockReset(); });

describe('RemittanceDownloadButton', () => {
  it.each([['PR'], ['SB'], ['CT'], ['PT'], ['CP'], ['PP']])('is offered on a %s remittance', (status) => {
    renderButton(status);
    // Icon-only (the standard topbar action chrome): the label is the accessible name, with a tooltip.
    expect(screen.getByTestId('remittance-file-download')).toHaveAttribute('aria-label', 'remittanceFileDownload');
    expect(screen.getByTestId('remittance-file-download')).toHaveTextContent('');
    expect(screen.getByTestId('remittance-file-download')).toHaveClass('h-10', 'w-10');
  });

  it.each([['PE'], ['AN'], [undefined]])('is not offered on %s', (status) => {
    const { container } = renderButton(status);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not offered without a record id', () => {
    const { container } = render(<RemittanceDownloadButton data={{ remittanceStatus: 'PR' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('downloads the file generated on the fly by downloadFile, without any attachment', async () => {
    mockApiFetch.mockResolvedValue(fileAnswer());
    renderButton('PR');
    await click();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch.mock.calls[0][0]).toBe('/remittance/rem-1/action/downloadFile');
    expect(mockApiFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockDownloadBlobAsFile).toHaveBeenCalledWith(expect.any(Blob), 'remesa.xml');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(screen.getByTestId('remittance-file-download')).toBeEnabled();
  });

  it('adds an informative, non-blocking toast, with no count, when the file carries returned receipts', async () => {
    mockApiFetch.mockResolvedValue(fileAnswer({ returnedCount: 2 }));
    renderButton('CP');
    await click();
    expect(mockDownloadBlobAsFile).toHaveBeenCalledWith(expect.any(Blob), 'remesa.xml');
    expect(toast.info).toHaveBeenCalledWith('remittanceFileIncludesReturnedLines');
  });

  it('toasts a refused download with the translated fallback and leaves the button usable', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('no json'); } });
    renderButton('PR');
    await click();
    expect(toast.error).toHaveBeenCalledWith('remittanceFileDownloadError');
    expect(mockDownloadBlobAsFile).not.toHaveBeenCalled();
    expect(screen.getByTestId('remittance-file-download')).toBeEnabled();
  });

  it('is disabled with a spinner while it runs', async () => {
    let finish;
    mockApiFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderButton('PR');
    fireEvent.click(screen.getByTestId('remittance-file-download'));
    expect(screen.getByTestId('remittance-file-download')).toBeDisabled();
    expect(screen.getByTestId('Loader2__download')).toBeInTheDocument();
    await act(async () => { finish(fileAnswer()); });
    expect(screen.getByTestId('remittance-file-download')).toBeEnabled();
  });
});
