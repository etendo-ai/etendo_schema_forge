import { useCallback, useMemo, useRef } from 'react';
import { useLocaleSwitch, useUI } from '@/i18n';
import { CurrencyRatePicker } from '@/components/contract-ui/CurrencyRatePicker.jsx';
import { DateField } from '@/components/ui/date-field';
import { formatCalendarDate } from '@/lib/dateOnly.js';
import { buildOp, confirmBlockers, currencyScale, manualPricingOf, MAX_DOCUMENT_NO, missingSet } from './invoiceInboxReviewModel.js';
import { currencyRateForPicker, currencySourceOf, unavailableCurrencyCode } from './invoiceInboxCurrency.js';
import { Button } from '@/components/ui/button';
import { DATE_FIELD_ICON, FieldError, ReviewField, ReviewTag, SectionTitle } from './InvoiceInboxReviewParts.jsx';
import { CommitInput } from './InvoiceInboxReviewInputs.jsx';
import { ReviewEditorContext, useReviewEditor } from './useInvoiceInboxReviewEditor.js';
import InvoiceInboxReviewBanners, { InvoiceInboxReviewCurrencyNotices, InvoiceInboxReviewMismatchBanner, InvoiceInboxReviewNotice, InvoiceInboxReviewRefusal } from './InvoiceInboxReviewBanners.jsx';
import InvoiceInboxReviewVendor from './InvoiceInboxReviewVendor.jsx';
import InvoiceInboxReviewLines from './InvoiceInboxReviewLines.jsx';
import InvoiceInboxReviewTotals from './InvoiceInboxReviewTotals.jsx';

// Invalid-state classes for the shared picker: it targets the trigger by testid `currency-rate-trigger` (rename it there too).
const CURRENCY_TRIGGER_INVALID = '[&_[data-testid=currency-rate-trigger]]:border-destructive [&_[data-testid=currency-rate-trigger]]:bg-[var(--status-destructive-bg)] [&_[data-testid=currency-rate-trigger]]:hover:bg-[var(--status-destructive-bg)]';

let currencyOpSequence = 0;
const currencyKey = () => `currency:${++currencyOpSequence}`;

const CURRENCY_SOURCE_LABEL = Object.freeze({
  printed: 'invoiceInboxReviewSourceOcr',
  default: 'invoiceInboxReviewSourceDefault',
  manual: 'invoiceInboxReviewSourceManual',
});

/**
 * The currency of the invoice, through the same `CurrencyRatePicker` the purchase and sales documents
 * use, so it shows "USD — 1,47". Editable while the document is: the list is the inbox spec's
 * `currencyOptions` action (only currencies the system has a conversion for on the invoice date),
 * and a pick is a `setCurrency` edit. No custom rate (`allowRateEdit` off). Read only otherwise.
 * A small tag says whether the currency was printed on the document, is the default or was chosen.
 */
function CurrencyField({ review, currency, editable, invoiceDate, id, apiBaseUrl }) {
  const ui = useUI();
  const editor = useReviewEditor();
  const picked = useRef({});
  const source = currencySourceOf(review);
  const unavailable = editable ? unavailableCurrencyCode(review.document) : '';
  // The currency cannot be converted (no rate on the invoice date, or not registered in Etendo): the field
  // itself must say so, not only the counter at the bottom. It clears with the blocker.
  const noRate = editable && confirmBlockers(review.document).includes('exchangeRate');
  const invalid = noRate || Boolean(unavailable);
  const errorText = unavailable
    ? ui('invoiceInboxReviewCurrencyUnavailableError', { code: unavailable })
    : ui('invoiceInboxReviewCurrencyNoRateError');
  // The printed currency does not exist in the tenant and the default is already shown: the picker ignores
  // re-picking the current value, so accepting it is an explicit action (setCurrency with the same id).
  const useShown = () => {
    const shown = review.currency;
    if (!shown?.id) return;
    editor?.commit(currencyKey(), buildOp.setCurrency(shown.id), {
      isoCode: shown.isoCode, rate: currencyRateForPicker(shown),
    });
  };
  const handleChange = useCallback((key, value) => {
    // COUPLING: the shared `CurrencyRatePicker.handleSelect` calls `onChange` three times in a fixed order
    // (id, ISO label, rate) and this commits on the third. A change of that order breaks the inbox
    // silently: a test must drive the REAL picker (not a mock) to catch it.
    if (key === 'currency') picked.current = { id: value };
    else if (key === 'currency$_identifier') picked.current.isoCode = value;
    else if (key === 'eTGOCurrencyRate' && picked.current.id) {
      const { id: currencyId, isoCode } = picked.current;
      picked.current = {};
      editor?.commit(currencyKey(), buildOp.setCurrency(currencyId), { isoCode, rate: value ?? null });
    }
  }, [editor]);
  const invalidClass = invalid ? ` ${CURRENCY_TRIGGER_INVALID}` : '';
  return (
    <div
      className={`relative${invalidClass}`}
      aria-invalid={invalid || undefined}
      data-testid="invoice-inbox-review-currency-wrap">
      <CurrencyRatePicker
        field={{ key: 'currency', id: 'invoice-inbox-currency' }}
        value={review.currency?.id}
        displayValue={review.currency?.isoCode ?? currency}
        formData={{ id, eTGOCurrencyRate: currencyRateForPicker(review.currency), invoiceDate }}
        rateDateField="invoiceDate"
        resolvedLabel={ui('invoiceInboxReviewFieldCurrency')}
        isReadOnly={!editable}
        onChange={handleChange}
        apiBaseUrl={editable ? apiBaseUrl : undefined}
        allowRateEdit={false}
        data-testid="CurrencyRatePicker__review" />
      {invalid && (
        <FieldError testId="invoice-inbox-review-currency-error" data-testid="FieldError__currency">
          {errorText}
        </FieldError>
      )}
      {unavailable && review.currency?.id && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1.5"
          onClick={useShown}
          data-testid="invoice-inbox-review-currency-use-shown">
          {ui('invoiceInboxReviewCurrencyUseShown', { iso: review.currency.isoCode ?? currency })}
        </Button>
      )}
      {source && (
        <span className="absolute right-0 top-0" data-testid="invoice-inbox-review-currency-source-wrap">
          <ReviewTag
            tone="neutral"
            label={ui(CURRENCY_SOURCE_LABEL[source])}
            testId="invoice-inbox-review-currency-source"
            data-testid="ReviewTag__currency-source" />
        </span>
      )}
    </div>
  );
}

/** "Cabecera": invoice number and date (2 columns), then the currency (a registered-currency selector, editable while the document is editable, with no rate editing). */
function HeaderSection({ review, currency, missing, readOnly, locked, locale }) {
  const ui = useUI();
  const editor = useReviewEditor();
  const editable = Boolean(editor) && !readOnly;
  const header = review.document?.header;
  const dateMissing = missing.has('invoiceDate');
  const tooLong = review.errorCode === 'REFERENCE_TOO_LONG';
  const date = header?.invoiceDate
    ? formatCalendarDate(header.invoiceDate, locale)
    : (header?.invoiceDateRaw ?? '');
  return (
    <section className="flex flex-col gap-3" data-testid="invoice-inbox-review-header-section">
      <SectionTitle
        testId="invoice-inbox-review-header-title"
        data-testid="SectionTitle__fd4b42">{ui('invoiceInboxReviewSectionHeader')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3.5">
        <ReviewField
          label={ui('invoiceInboxReviewFieldInvoiceNo')}
          value={header?.documentNo}
          readOnly={readOnly}
          disabled={locked}
          invalid={tooLong}
          error={tooLong ? ui('invoiceInboxReviewReferenceTooLong', { max: MAX_DOCUMENT_NO }) : null}
          testId="invoice-inbox-review-invoice-no"
          control={editable ? (
            <CommitInput
              id="invoice-inbox-review-invoice-no"
              value={header?.documentNo ?? ''}
              display={(value) => String(value ?? '')}
              invalid={tooLong}
              maxLength={200}
              onCommit={(value) => editor.commit('header:documentNo', buildOp.setHeader({ documentNo: value }))}
              testId="invoice-inbox-review-invoice-no"
              data-testid="CommitInput__fd4b42" />
          ) : null}
          data-testid="ReviewField__fd4b42" />
        <ReviewField
          label={ui('invoiceInboxReviewFieldInvoiceDate')}
          value={date}
          readOnly={readOnly}
          disabled={locked}
          required
          icon={DATE_FIELD_ICON}
          invalid={dateMissing}
          tag={dateMissing
            ? <ReviewTag
            tone="warning"
            label={ui('invoiceInboxReviewReviewTag')}
            testId="invoice-inbox-review-invoice-date-tag"
            data-testid="ReviewTag__fd4b42" />
            : null}
          error={dateMissing ? ui('invoiceInboxReviewDateRequired') : null}
          testId="invoice-inbox-review-invoice-date"
          control={editable ? (
            <div aria-invalid={dateMissing || undefined} data-testid="invoice-inbox-review-invoice-date-control">
              <DateField
                id="invoice-inbox-review-invoice-date"
                value={header?.invoiceDate ?? ''}
                className={dateMissing ? 'border-destructive bg-[var(--status-destructive-bg)]' : undefined}
                onChange={(iso) => {
                  // The shared field only reports a real day or ''; an unchanged day writes nothing.
                  if ((iso || null) === (header?.invoiceDate || null)) return;
                  editor.commit('header:invoiceDate', buildOp.setHeader({ invoiceDate: iso || null }));
                }}
                data-testid="invoice-inbox-review-invoice-date" />
              {!header?.invoiceDate && header?.invoiceDateRaw && (
                <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="invoice-inbox-review-invoice-date-raw">
                  {ui('invoiceInboxReviewDateRawHint', { date: header.invoiceDateRaw })}
                </p>
              )}
            </div>
          ) : null}
          data-testid="ReviewField__fd4b42" />
        <CurrencyField
          review={review}
          currency={currency}
          editable={editable && !locked}
          invoiceDate={header?.invoiceDate}
          id={review.id}
          apiBaseUrl={editor?.apiBaseUrl}
          data-testid="CurrencyField__review" />
      </div>
    </section>
  );
}

/**
 * ETP-6050 F5 — the right pane's content: banners (failed, confirmed, duplicate) and the reload
 * notice at the top, Proveedor, Cabecera, Líneas, the totals card and, at the bottom, the
 * total-mismatch banner. It renders the EFFECTIVE review (server answer plus pending edits, see
 * `useInvoiceInboxReviewEditor`) and provides the editor to the inputs through context; without an
 * `editor` (or with `readOnly`) it is the read-only form of S1. `locked` (nobody can edit this
 * document at all: confirmed, discarded, foreign receiver) additionally hides the add / delete
 * affordances. `settled` switches to the plain-text vendor, disabled header fields and the compact
 * line list.
 *
 * @param {{review: object, currency: string, readOnly?: boolean, locked?: boolean,
 *   settled?: boolean, editor?: object|null, apiBaseUrl?: string}} props
 */
export default function InvoiceInboxReviewForm({
  review, currency, readOnly = true, locked = false, settled = false, editor = null, apiBaseUrl = '',
}) {
  const { locale } = useLocaleSwitch();
  const document = review.document ?? {};
  const missing = missingSet(document);
  const scale = currencyScale(review.currency);
  const pricing = useMemo(() => manualPricingOf(review, document.header), [review, document.header]);
  const context = useMemo(() => (editor ? { ...editor, apiBaseUrl } : null), [editor, apiBaseUrl]);
  return (
    <ReviewEditorContext.Provider value={readOnly ? null : context}>
      <div className="flex flex-col gap-[22px]" data-testid="invoice-inbox-review-form" data-readonly={readOnly || undefined}>
        {editor?.notice && (
          <InvoiceInboxReviewNotice
            noticeKey={editor.notice.key}
            onDismiss={editor.dismissNotice}
            data-testid="InvoiceInboxReviewNotice__form" />
        )}
        {editor?.refusal && (
          <InvoiceInboxReviewRefusal
            refusalKey={editor.refusal.key}
            onDismiss={editor.dismissRefusal}
            data-testid="InvoiceInboxReviewRefusal__form" />
        )}
        <InvoiceInboxReviewBanners review={review} data-testid="InvoiceInboxReviewBanners__form" />
        {!settled && (
          <InvoiceInboxReviewCurrencyNotices
            document={document}
            currency={review.currency?.isoCode ?? currency}
            data-testid="InvoiceInboxReviewCurrencyNotices__form" />
        )}
        <InvoiceInboxReviewVendor
          document={document}
          missing={missing}
          readOnly={readOnly}
          locked={settled}
          apiBaseUrl={apiBaseUrl}
          data-testid="InvoiceInboxReviewVendor__form" />
        <HeaderSection
          review={review}
          currency={currency}
          missing={missing}
          readOnly={readOnly}
          locked={settled}
          locale={locale}
          data-testid="HeaderSection__form" />
        <InvoiceInboxReviewLines
          document={document}
          currency={currency}
          scale={scale}
          readOnly={readOnly}
          showActions={!locked}
          locked={settled}
          apiBaseUrl={apiBaseUrl}
          pricing={pricing}
          data-testid="InvoiceInboxReviewLines__form" />
        <InvoiceInboxReviewTotals
          lines={document.lines}
          currency={currency}
          scale={scale}
          invoiceTotal={review.invoice?.grandTotal ?? null}
          data-testid="InvoiceInboxReviewTotals__form" />
        <InvoiceInboxReviewMismatchBanner review={review} currency={currency} data-testid="InvoiceInboxReviewMismatchBanner__form" />
      </div>
    </ReviewEditorContext.Provider>
  );
}
