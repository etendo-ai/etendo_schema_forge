// @covers artifacts/remittance/custom/remittanceFileApi.js
//
// The SEPA file of a remittance: fileReadiness / confirm / downloadFile (generated on the fly, nothing
// attached), and the helpers that turn a readiness answer or a refusal into what the UI lists.
// `apiFetch` is the injected boundary (docs/request-policy.md); the browser download is stubbed.
const mockDownloadBlobAsFile = vi.fn();
vi.mock('@/windows/custom/shared/pdfUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadBlobAsFile: (...args) => mockDownloadBlobAsFile(...args),
}));

import {
  GROUPING_NONE,
  confirmRemittance,
  downloadRemittanceFile,
  fetchFileReadiness,
  fetchRemittanceLines,
  fetchReturnState,
  downloadRemittanceFileNotifying,
  fileActionErrorMessage,
  groupReadinessProblems,
  normalizeDownloadedFile,
  normalizeFileReadiness,
  normalizeFileResult,
  problemsFromError,
  readinessProblemText,
  returnedReceiptsNotice,
  returnProblemsFromError,
  returnRemittanceLines,
} from '@generated/remittance/custom/remittanceFileApi.js';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function brokenJsonResponse({ ok = false, status = 500 } = {}) {
  return { ok, status, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
}

const bodyOf = (apiFetch, call = 0) => JSON.parse(apiFetch.mock.calls[call][1].body);

beforeEach(() => {
  mockDownloadBlobAsFile.mockReset();
});

describe('normalizeFileReadiness', () => {
  it('defaults every key for an empty payload', () => {
    const empty = { ready: false, scheme: null, problems: [], summary: null, returnedCount: 0 };
    expect(normalizeFileReadiness(undefined)).toEqual(empty);
    expect(normalizeFileReadiness({})).toEqual(empty);
  });

  it('is ready only with ready:true and no problem', () => {
    expect(normalizeFileReadiness({ ready: true }).ready).toBe(true);
    expect(normalizeFileReadiness({ ready: 'true' }).ready).toBe(false);
    expect(normalizeFileReadiness({ ready: true, problems: [{ scope: 'org', code: 'X' }] }).ready).toBe(false);
  });

  it('keeps the CORE / SCT scheme only', () => {
    expect(normalizeFileReadiness({ scheme: 'CORE' }).scheme).toBe('CORE');
    expect(normalizeFileReadiness({ scheme: 'SCT' }).scheme).toBe('SCT');
    expect(normalizeFileReadiness({ scheme: 'B2B' }).scheme).toBeNull();
  });

  it('normalizes each problem: known scope (else line), text ids, positional params', () => {
    const [p] = normalizeFileReadiness({
      problems: [{ scope: 'weird', lineId: 7, businessPartnerId: 'bp-1', businessPartnerName: 'Acme', documentNo: '', code: 'ETGO_RemittanceFileBpIban', message: 'Sin IBAN', params: ['Acme', 'FAC-1'] }],
    }).problems;
    expect(p).toEqual({
      scope: 'line', lineId: '7', lineIds: ['7'], businessPartnerId: 'bp-1', businessPartnerName: 'Acme', documentNo: null,
      suggestedCreditorId: null, organizationId: null, accountId: null, code: 'ETGO_RemittanceFileBpIban', message: 'Sin IBAN', params: ['Acme', 'FAC-1'],
    });
  });

  it('keeps every line a contact problem affects (`lineIds`), else the single lineId, else none', () => {
    const [many, one, none] = normalizeFileReadiness({
      problems: [{ lineId: 'l1', lineIds: ['l1', 'l2', 3] }, { lineId: 'l9' }, { scope: 'org' }],
    }).problems;
    expect(many.lineIds).toEqual(['l1', 'l2', '3']);
    expect(one.lineIds).toEqual(['l9']);
    expect(none.lineIds).toEqual([]);
  });

  it('keeps an object of params, and drops a scalar one', () => {
    const [a, b] = normalizeFileReadiness({ problems: [{ params: { 0: 'x' } }, { params: 'x' }] }).problems;
    expect(a.params).toEqual({ 0: 'x' });
    expect(b.params).toBeNull();
  });

  it('turns the summary into numbers (or null) and keeps currency and due date', () => {
    expect(normalizeFileReadiness({ summary: { invoiceCount: '3', lineCount: 4, totalAmount: '1202.3', currency: 'EUR', dueDate: '2026-12-01' } }).summary)
      .toEqual({ invoiceCount: 3, lineCount: 4, totalAmount: 1202.3, currency: 'EUR', dueDate: '2026-12-01' });
    expect(normalizeFileReadiness({ summary: { invoiceCount: 'n/a', totalAmount: '', currency: '' } }).summary)
      .toEqual({ invoiceCount: null, lineCount: null, totalAmount: null, currency: null, dueDate: null });
    expect(normalizeFileReadiness({ summary: 'x' }).summary).toBeNull();
  });

  it('reads returnedCount as a non-negative whole number (0 when absent or not a number), and no latestFile', () => {
    expect(normalizeFileReadiness({ returnedCount: 3 }).returnedCount).toBe(3);
    expect(normalizeFileReadiness({ returnedCount: '2' }).returnedCount).toBe(2);
    expect(normalizeFileReadiness({ returnedCount: -1 }).returnedCount).toBe(0);
    expect(normalizeFileReadiness({ returnedCount: 'x' }).returnedCount).toBe(0);
    expect(normalizeFileReadiness({ latestFile: { attachmentId: 'a' } })).not.toHaveProperty('latestFile');
  });
});

describe('normalizeFileResult', () => {
  it('keeps status and fileName as text or null (nothing is attached any more)', () => {
    expect(normalizeFileResult({ status: 'PR', attachmentId: 'a', fileName: 'f.xml', downloadUrl: 'u' }))
      .toEqual({ status: 'PR', fileName: 'f.xml' });
    expect(normalizeFileResult(undefined)).toEqual({ status: null, fileName: null });
  });
});

describe('normalizeDownloadedFile', () => {
  it('defaults the content type to XML, the content to empty and the returned count to 0', () => {
    expect(normalizeDownloadedFile(undefined)).toEqual({ fileName: null, contentType: 'application/xml', content: '', returnedCount: 0 });
    expect(normalizeDownloadedFile({ fileName: '1000016_Cobros_nandu_enero.xml', contentType: 'application/xml', content: '<a/>', returnedCount: 2 }))
      .toEqual({ fileName: '1000016_Cobros_nandu_enero.xml', contentType: 'application/xml', content: '<a/>', returnedCount: 2 });
  });
});

describe('remittance file actions', () => {
  it('fileReadiness posts {} to <spec>/remittance/{id}/action/fileReadiness and normalizes either envelope', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ response: { data: { ready: true, scheme: 'CORE' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ready: false } }));
    expect(await fetchFileReadiness(apiFetch, 'rem/1')).toMatchObject({ ready: true, scheme: 'CORE' });
    expect(apiFetch.mock.calls[0][0]).toBe('/remittance/rem%2F1/action/fileReadiness');
    expect(apiFetch.mock.calls[0][1].method).toBe('POST');
    expect(bodyOf(apiFetch)).toEqual({});
    expect(await fetchFileReadiness(apiFetch, 'rem-1')).toMatchObject({ ready: false });
  });

  it('confirm posts the grouping in fieldValues, P by default', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ response: { data: { status: 'PR', fileName: 'r.xml' } } }));
    expect(GROUPING_NONE).toBe('P');
    expect(await confirmRemittance(apiFetch, 'rem-1')).toEqual({ status: 'PR', fileName: 'r.xml' });
    await confirmRemittance(apiFetch, 'rem-1', 'GGPD');
    await confirmRemittance(apiFetch, 'rem-1', '');
    expect(apiFetch.mock.calls[0][0]).toBe('/remittance/rem-1/action/confirm');
    expect(bodyOf(apiFetch, 0)).toEqual({ fieldValues: { grouping: 'P' } });
    expect(bodyOf(apiFetch, 1)).toEqual({ fieldValues: { grouping: 'GGPD' } });
    expect(bodyOf(apiFetch, 2)).toEqual({ fieldValues: { grouping: 'P' } });
  });

  it.each([
    ['fileReadiness', (f) => fetchFileReadiness(f, 'rem-1')],
    ['confirm', (f) => confirmRemittance(f, 'rem-1')],
    ['downloadFile', (f) => downloadRemittanceFile(f, 'rem-1')],
  ])('%s throws with status and body on a refusal, and a label without JSON', async (label, call) => {
    const body = { error: { message: 'No listo', messageKeys: ['ETGO_RemittanceFileNotReady'], problems: [] } };
    await expect(call(vi.fn().mockResolvedValue(jsonResponse(body, { ok: false, status: 422 }))))
      .rejects.toMatchObject({ status: 422, body, message: 'No listo' });
    await expect(call(vi.fn().mockResolvedValue(brokenJsonResponse({ status: 500 }))))
      .rejects.toMatchObject({ status: 500, body: null, message: `${label} 500` });
  });
});

describe('downloadRemittanceFile', () => {
  // The file is not attached to the remittance: the read-only `downloadFile` action generates it on the fly.
  it('posts {} to <spec>/remittance/{id}/action/downloadFile and saves the XML under its file name, with no attachment', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ response: { data: {
      fileName: 'remesa.xml', contentType: 'application/xml', content: '<Document/>', returnedCount: 0,
    } } }));
    expect(await downloadRemittanceFile(apiFetch, 'rem/1')).toEqual({ fileName: 'remesa.xml', returnedCount: 0 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe('/remittance/rem%2F1/action/downloadFile');
    expect(apiFetch.mock.calls[0][1].method).toBe('POST');
    expect(bodyOf(apiFetch)).toEqual({});
    const [blob, name] = mockDownloadBlobAsFile.mock.calls[0];
    expect(name).toBe('remesa.xml');
    expect(blob.type).toBe('application/xml');
    expect(await blob.text()).toBe('<Document/>');
  });

  it('names the file after the remittance when the answer has no name (a bare payload works too)', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ fileName: null, content: '<a/>', returnedCount: 2 }));
    expect(await downloadRemittanceFile(apiFetch, 'rem-2')).toEqual({ fileName: 'remittance-rem-2.xml', returnedCount: 2 });
    const [blob, name] = mockDownloadBlobAsFile.mock.calls[0];
    expect(name).toBe('remittance-rem-2.xml');
    expect(await blob.text()).toBe('<a/>');
  });

  it('throws on a refused download (422 not ready, with its problems) without saving anything', async () => {
    const body = { error: { message: 'No listo', messageKeys: ['ETGO_RemittanceFileNotReady'], problems: [{ scope: 'org', code: 'X' }] } };
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse(body, { ok: false, status: 422 }));
    await expect(downloadRemittanceFile(apiFetch, 'a')).rejects.toMatchObject({ status: 422, body });
    expect(mockDownloadBlobAsFile).not.toHaveBeenCalled();
  });
});

describe('downloadRemittanceFileNotifying / returnedReceiptsNotice', () => {
  const ui = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
  const notify = () => ({ info: vi.fn(), error: vi.fn() });

  it('words the notice in the singular for one returned receipt and the plural otherwise', () => {
    expect(returnedReceiptsNotice(1, ui)).toBe('remittanceFileIncludesReturnedOne:{"count":1}');
    expect(returnedReceiptsNotice(3, ui)).toBe('remittanceFileIncludesReturned:{"count":3}');
  });

  it('downloads, and adds an informative toast only when the file carries returned receipts', async () => {
    const quiet = notify();
    await downloadRemittanceFileNotifying(vi.fn().mockResolvedValue(jsonResponse({ fileName: 'r.xml', content: '<a/>', returnedCount: 0 })), 'r', ui, quiet);
    expect(quiet.info).not.toHaveBeenCalled();
    const loud = notify();
    expect(await downloadRemittanceFileNotifying(vi.fn().mockResolvedValue(jsonResponse({ fileName: 'r.xml', content: '<a/>', returnedCount: 2 })), 'r', ui, loud))
      .toEqual({ fileName: 'r.xml', returnedCount: 2 });
    expect(loud.info).toHaveBeenCalledWith('remittanceFileIncludesReturned:{"count":2}');
    expect(loud.error).not.toHaveBeenCalled();
    expect(mockDownloadBlobAsFile).toHaveBeenCalledTimes(2);
  });

  it('toasts a refusal with the translated fallback and resolves to null', async () => {
    const n = notify();
    expect(await downloadRemittanceFileNotifying(vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })), 'r', ui, n)).toBeNull();
    expect(n.error).toHaveBeenCalledWith('remittanceFileDownloadError');
  });
});

describe('problemsFromError / readinessProblemText', () => {
  it('reads error.problems (and the top-level / response shapes), normalized', () => {
    const problem = { scope: 'line', code: 'C', message: 'M', businessPartnerId: 'bp-1' };
    expect(problemsFromError({ body: { error: { problems: [problem] } } })).toEqual([expect.objectContaining({ code: 'C', message: 'M', businessPartnerId: 'bp-1' })]);
    expect(problemsFromError({ body: { problems: [problem] } })).toHaveLength(1);
    expect(problemsFromError({ body: { response: { problems: [problem] } } })).toHaveLength(1);
  });

  it('is empty without problems or without a body', () => {
    expect(problemsFromError({ body: { error: { message: 'x' } } })).toEqual([]);
    expect(problemsFromError(new Error('x'))).toEqual([]);
    expect(problemsFromError(undefined)).toEqual([]);
  });

  it('prefers the backend’s localized message over the key', () => {
    expect(readinessProblemText({ message: 'Acme no tiene IBAN.', code: 'ETGO_RemittanceAccountNotBank' }, (k) => `T:${k}`)).toBe('Acme no tiene IBAN.');
  });

  it('falls back to the key route when the problem has no text', () => {
    const dict = { 'backendError.remittanceAccountNotBank': 'T:accountNotBank' };
    const t = (key) => dict[key] ?? key;
    expect(readinessProblemText({ message: null, code: 'ETGO_RemittanceAccountNotBank' }, t)).toBe('T:accountNotBank');
  });

  it('falls back to remittanceFileProblemUnknown without text or a known key', () => {
    expect(readinessProblemText({ message: null, code: 'ETGO_Unmapped' }, (k) => k)).toBe('remittanceFileProblemUnknown');
    expect(readinessProblemText({}, (k) => k)).toBe('remittanceFileProblemUnknown');
  });
});

describe('groupReadinessProblems', () => {
  it('orders org, account, then one group per business partner in first-seen order', () => {
    const problems = [
      { scope: 'line', businessPartnerId: 'bp-2', businessPartnerName: 'Beta', lineId: 'l1', code: 'a' },
      { scope: 'account', accountId: 'acc-1', code: 'b' },
      { scope: 'line', businessPartnerId: 'bp-1', businessPartnerName: 'Alfa', lineId: 'l2', code: 'c' },
      { scope: 'org', organizationId: 'org-1', code: 'd' },
      { scope: 'line', businessPartnerId: 'bp-2', businessPartnerName: 'Beta', lineId: 'l3', code: 'e' },
    ];
    const groups = groupReadinessProblems(problems);
    expect(groups.org.map((p) => p.code)).toEqual(['d']);
    expect(groups.account.map((p) => p.code)).toEqual(['b']);
    expect(groups.partners.map((g) => g.businessPartnerId)).toEqual(['bp-2', 'bp-1']);
    expect(groups.partners[0]).toMatchObject({ businessPartnerName: 'Beta' });
    expect(groups.partners[0].problems.map((p) => p.code)).toEqual(['a', 'e']);
  });

  it('keeps line problems without a business partner in their own groups', () => {
    const groups = groupReadinessProblems([
      { scope: 'line', businessPartnerId: null, lineId: 'l1', code: 'a' },
      { scope: 'line', businessPartnerId: null, lineId: 'l2', code: 'b' },
    ]);
    expect(groups.partners).toHaveLength(2);
  });

  it('is empty for no problems', () => {
    expect(groupReadinessProblems()).toEqual({ org: [], account: [], partners: [] });
  });
});

describe('fileActionErrorMessage', () => {
  it('translates by messageKeys, shows the backend text otherwise, then the fallback', () => {
    const dict = { 'backendError.remittanceAccountNotBank': 'T:accountNotBank', fallbackKey: 'T:fallback' };
    const t = (key) => dict[key] ?? key;
    expect(fileActionErrorMessage({ body: { error: { message: 'x', messageKeys: ['ETGO_RemittanceAccountNotBank'] } } }, t, 'fallbackKey')).toBe('T:accountNotBank');
    expect(fileActionErrorMessage({ body: { error: { message: 'Texto del backend.' } } }, t, 'fallbackKey')).toBe('Texto del backend.');
    expect(fileActionErrorMessage({ body: null }, t, 'fallbackKey')).toBe('T:fallback');
    expect(fileActionErrorMessage(undefined, t, 'fallbackKey')).toBe('T:fallback');
  });
});

describe('returns: returnState / returnLines / lines', () => {
  it('returnState posts {} to <spec>/remittance/{id}/action/returnState and normalizes the envelope', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ response: { data: {
      collection: true, hasReturns: true,
      lines: { a: { state: 'RETURNED', returnable: false, reasonCode: 'ALREADY_RETURNED', returnDate: '2026-11-10', paymentId: 'p', paymentLineIds: ['a', 'b'] } },
    } } }));
    const state = await fetchReturnState(apiFetch, 'rem 1');
    expect(apiFetch.mock.calls[0][0]).toBe('/remittance/rem%201/action/returnState');
    expect(apiFetch.mock.calls[0][1].method).toBe('POST');
    expect(bodyOf(apiFetch)).toEqual({});
    expect(state).toEqual({ collection: true, hasReturns: true, lines: { a: { state: 'RETURNED', returnable: false, reasonCode: 'ALREADY_RETURNED', returnDate: '2026-11-10', paymentId: 'p', paymentLineIds: ['a', 'b'] } } });
  });

  it('returnState: only a literal true counts as returnable / collection, and an empty payment group falls back to the line', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ collection: 'Y', lines: { a: { returnable: 'true', paymentLineIds: [] } } }));
    const state = await fetchReturnState(apiFetch, 'r');
    expect(state.collection).toBe(false);
    expect(state.hasReturns).toBe(false);
    expect(state.lines.a).toMatchObject({ returnable: false, paymentLineIds: ['a'] });
  });

  it('returnState throws with status and body when refused', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'no' } }, { ok: false, status: 403 }));
    await expect(fetchReturnState(apiFetch, 'r')).rejects.toMatchObject({ status: 403, message: 'no' });
  });

  it('returnLines posts { fieldValues: { lineIds, returnDate } } and reads the answer', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ response: { data: { status: 'CP', returned: ['l1'], returnPaymentId: 'pay', returnPaymentDocumentNo: '10001' } } }));
    const result = await returnRemittanceLines(apiFetch, 'rem-1', ['l1'], '2026-11-12');
    expect(apiFetch.mock.calls[0][0]).toBe('/remittance/rem-1/action/returnLines');
    expect(bodyOf(apiFetch)).toEqual({ fieldValues: { lineIds: ['l1'], returnDate: '2026-11-12' } });
    expect(result).toEqual({ status: 'CP', returned: ['l1'], returnPaymentId: 'pay', returnPaymentDocumentNo: '10001' });
  });

  it('returnLines omits returnDate when none is given and defaults the answer', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    const result = await returnRemittanceLines(apiFetch, 'rem-1', ['l1', 'l2']);
    expect(bodyOf(apiFetch)).toEqual({ fieldValues: { lineIds: ['l1', 'l2'] } });
    expect(result).toEqual({ status: null, returned: [], returnPaymentId: null, returnPaymentDocumentNo: null });
  });

  it('returnLines throws with the 422 body (messageKeys, problems) and status', async () => {
    const body = { error: { message: 'm', messageKeys: ['ETGO_RemittanceReturnNotAllowed'], problems: [{ lineId: 'l1', reasonCode: 'POSTED' }] } };
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse(body, { ok: false, status: 422 }));
    const err = await returnRemittanceLines(apiFetch, 'r', ['l1'], '2026-11-12').catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.body).toEqual(body);
    expect(returnProblemsFromError(err)).toEqual([{ lineId: 'l1', reasonCode: 'POSTED', documentNo: null, message: null }]);
  });

  it('returnProblemsFromError also reads a top-level problems list', () => {
    expect(returnProblemsFromError({ body: { problems: [{ lineId: 'l2', message: 'x' }] } })).toEqual([{ lineId: 'l2', reasonCode: null, documentNo: null, message: 'x' }]);
    expect(returnProblemsFromError({ body: { error: { problems: 'nope' } } })).toEqual([]);
  });

  it('fetchRemittanceLines asks for the parent lines, drops grid summaries and null rows', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ response: { data: [{ id: 'l1' }, { id: 'sum', isGridSummary: true }, null, { id: 'l2' }] } }));
    const lines = await fetchRemittanceLines(apiFetch, 'rem 1');
    // Relative path only: the window's apiFetch carries the base URL, so no options override it.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]).toEqual(['/lines?parentId=rem%201&_sortBy=lineNo%20asc&_startRow=0&_endRow=199']);
    expect(lines.map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it('fetchRemittanceLines pages through every line instead of stopping at the first 1000', async () => {
    const page = (start, count) => Array.from({ length: count }, (_, i) => ({ id: `l${start + i}` }));
    const total = 1203;
    const apiFetch = vi.fn(async (url) => {
      const start = Number(/_startRow=(\d+)/.exec(url)[1]);
      const end = Number(/_endRow=(\d+)/.exec(url)[1]);
      return jsonResponse({ response: { data: page(start, Math.max(0, Math.min(end + 1, total) - start)) } });
    });
    const lines = await fetchRemittanceLines(apiFetch, 'r');
    expect(lines).toHaveLength(total);
    expect(lines.at(-1).id).toBe('l1202');
    // Seven pages of 200: the seventh is short (3 rows), so no eighth request.
    expect(apiFetch).toHaveBeenCalledTimes(7);
    expect(apiFetch.mock.calls.at(-1)[0]).toBe('/lines?parentId=r&_sortBy=lineNo%20asc&_startRow=1200&_endRow=1399');
  });

  it('fetchRemittanceLines reads a bare data array and refuses a payload that is not a list', async () => {
    expect(await fetchRemittanceLines(vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'x' }] })), 'r')).toEqual([{ id: 'x' }]);
    await expect(fetchRemittanceLines(vi.fn().mockResolvedValue(jsonResponse({ response: { data: { id: 'x' } } })), 'r')).rejects.toThrow(/no readable row array/);
    await expect(fetchRemittanceLines(vi.fn().mockResolvedValue(jsonResponse({})), 'r')).rejects.toThrow(/no readable row array/);
  });

  it('fetchRemittanceLines throws when refused', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
    await expect(fetchRemittanceLines(apiFetch, 'r')).rejects.toMatchObject({ name: 'NeoListError', status: 500 });
  });
});

describe('fileActionErrorMessage — return and file refusals', () => {
  const ui = (key) => `T:${key}`;
  const refusal = (key, message) => ({ body: { error: { message, messageKeys: [key] } } });

  it.each([
    'ETGO_RemittanceReturnLineNotFound',
    'ETGO_RemittanceReturnDateInvalid',
    'ETGO_RemittanceReturnFailed',
    // downloadFile's generator / XSD / EPC refusals.
    'ETGO_RemittanceFileGenerationFailed',
    'ETGO_RemittanceFileInvalid',
    'ETGO_RemittanceFileSchemaMissing',
  ])('%s shows the backend sentence (already localized in the request language)', (key) => {
    expect(fileActionErrorMessage(refusal(key, 'Frase del servidor'), ui, 'remittanceReturnError')).toBe('Frase del servidor');
  });

  it('shows the fallback when the refusal carries no text at all', () => {
    expect(fileActionErrorMessage(refusal('ETGO_RemittanceReturnFailed', ''), ui, 'remittanceReturnError')).toBe('T:remittanceReturnError');
  });
});
