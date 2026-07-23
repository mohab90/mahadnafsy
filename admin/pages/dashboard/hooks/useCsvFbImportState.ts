import { useState } from 'react';
import type { FacebookLeadAdsConfig } from '../../../types';

/**
 * CSV bulk-import + Facebook Lead Ads sync UI state, lifted out of the
 * Dashboard god-hub. Pure UI state (no effects) — the handler *functions*
 * that read/write this state (handleCsvFileChangeFn, handleCsvImportFn,
 * handleFetchFbFormsFn, handleFbApiSyncFn) already live in
 * dashboardCsvFbHandlers.ts as plain functions taking a deps object, and
 * stay there unchanged; this hook only owns the state those deps objects
 * are built from.
 */
export function useCsvFbImportState(
  fbLeadAdsConfig: FacebookLeadAdsConfig | null,
  defaultFacebookLeadAdsConfig: () => FacebookLeadAdsConfig,
) {
  const [fbDraft, setFbDraft] = useState<FacebookLeadAdsConfig>(() => fbLeadAdsConfig || defaultFacebookLeadAdsConfig());
  const [bulkUploadNotice, setBulkUploadNotice] = useState('');
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [fbSyncLoading, setFbSyncLoading] = useState(false);
  const [fbSyncNotice, setFbSyncNotice] = useState('');
  const [fbFormsLoading, setFbFormsLoading] = useState(false);
  const [fbAvailableForms, setFbAvailableForms] = useState<{id: string; name: string; status: string}[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});

  return {
    fbDraft, setFbDraft,
    bulkUploadNotice, setBulkUploadNotice,
    csvImportOpen, setCsvImportOpen,
    csvHeaders, setCsvHeaders,
    csvImporting, setCsvImporting,
    fbSyncLoading, setFbSyncLoading,
    fbSyncNotice, setFbSyncNotice,
    fbFormsLoading, setFbFormsLoading,
    fbAvailableForms, setFbAvailableForms,
    csvRows, setCsvRows,
    csvMapping, setCsvMapping,
  };
}
