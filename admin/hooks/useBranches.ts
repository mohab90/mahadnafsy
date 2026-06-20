import { useMemo } from 'react';
import { useSiteData } from '../context/SiteDataContext';

export type BranchOption = { id: string; label: string };

/**
 * Returns the dynamic institute branches array derived from content['institute.branches'].
 * Single source of truth — use this instead of duplicating the useMemo everywhere.
 */
export function useBranches(): BranchOption[] {
  const { content } = useSiteData();
  return useMemo(() => {
    try {
      const parsed = JSON.parse(content['institute.branches'] || '[]');
      return Array.isArray(parsed) ? (parsed as BranchOption[]) : [];
    } catch {
      return [];
    }
  }, [content]);
}
