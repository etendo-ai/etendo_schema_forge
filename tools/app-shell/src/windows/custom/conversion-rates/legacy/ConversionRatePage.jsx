// ETP-6365 — FROZEN COPY of the generated Conversion Rates window as it was before ETP-6365
// (artifacts/conversion-rates/generated/web/conversion-rates/, revision 0aa24ca6b^). Owned by the
// per-account flag currency-conversion-v2: with the flag off, LegacyConversionRatesWindow renders
// it so the user sees the window exactly as before the redesign (read-only, date-only validity,
// no Status column). Never regenerated and never edited to follow decisions.json; deleted with
// the flag. The current generated window (regenerated from the new decisions.json) is not used.
import { useMemo, useEffect } from 'react';
import { ListView } from '@/components/contract-ui/ListView.jsx';
import { DetailView } from '@/components/contract-ui/DetailView.jsx';
import { useWindowAccess, WindowAccessGuard } from '@/auth/AuthContext.jsx';
import ConversionRateTable from './ConversionRateTable';
import ConversionRateForm from './ConversionRateForm';
import { AttachmentsTab } from '@/components/attachments';
import catalogs from './mockCatalogs';


const breadcrumb = 'Finance / Conversion Rates';


const summary = [
  { key: 'sMFCRSynced', column: 'EM_SMFCR_Is_Synced', type: 'boolean' },
];

const statusField = null;

const extraBadges = [

];

const processes = [

];

const draftMode = null;

const requiredHeaderFields = ['currency', 'toCurrency', 'validFromDate', 'multipleRateBy', 'divideRateBy'];



export const api = {
  "specName": "conversion-rates",
  "baseUrl": "/sws/neo/conversion-rates",
  "crud": {
    "conversionRate": {
      "get": true,
      "getById": true,
      "post": false,
      "put": false,
      "patch": false,
      "delete": false,
      "listUrl": "/sws/neo/conversion-rates/conversionRate",
      "detailUrl": "/sws/neo/conversion-rates/conversionRate/{id}",
      "supportedFilters": [
        "currency",
        "toCurrency"
      ]
    }
  },
  "selectors": [
    {
      "entity": "conversionRate",
      "field": "currency",
      "column": "C_Currency_ID",
      "reference": "Currency",
      "inputMode": "selector",
      "url": "/sws/neo/conversion-rates/conversionRate/selectors/currency"
    },
    {
      "entity": "conversionRate",
      "field": "toCurrency",
      "column": "C_Currency_ID_To",
      "reference": "Currency",
      "inputMode": "selector",
      "url": "/sws/neo/conversion-rates/conversionRate/selectors/toCurrency"
    }
  ],
  "actions": [],
  "queryParams": {
    "pagination": {
      "startRow": "_startRow",
      "endRow": "_endRow",
      "default": "0-100"
    },
    "sorting": {
      "param": "_sortBy",
      "example": "_sortBy=creationDate desc"
    },
    "filtering": "Use field name as query param: ?fieldName=value",
    "parentFilter": "parentId={id} for child entities"
  },
  "window": {
    "category": "finance",
    "readOnly": true
  }
};

export default function ConversionRatePage({ windowName, recordId, ...props }) {
  const windowAccessTier = useWindowAccess('116');
  const effectiveWindow = useMemo(() => (
    windowAccessTier === 'read-only' ? { ...(props.window || {}), readOnly: true } : props.window
  ), [windowAccessTier, props.window]);
  if (windowAccessTier === 'none') {
    return <WindowAccessGuard windowId="116" data-testid="WindowAccessGuard__9c8f84" />;
  }
  if (recordId) {
    return (
      <>
        <DetailView
          entity="conversionRate"
          Form={ConversionRateForm}
          summary={summary}
          statusField={statusField}
          extraBadges={extraBadges}
          processes={processes}
          catalogs={catalogs}
          entityLabel="Conversion Rate"
          windowName={windowName}
          recordId={recordId}
          breadcrumb={breadcrumb}
          api={api}
          customTabs={[{ key: 'attachments', labelKey: 'attachments', Component: AttachmentsTab, placement: 'tab', props: { tableName: "C_Conversion_Rate", config: {} } }]}
          requiredHeaderFields={requiredHeaderFields}
          {...props}
          window={effectiveWindow}
          data-testid="DetailView__9c8f84" />
      </>
    );
  }

  return (
    <ListView
      entity="conversionRate"
      Table={ConversionRateTable}
      entityLabel="Conversion Rates"
      windowName={windowName}
      breadcrumb={breadcrumb}
      api={api}
      hideCreate
      rowQuickActions={{}}
      {...props}
      window={effectiveWindow}
      data-testid="ListView__9c8f84" />
  );
}
