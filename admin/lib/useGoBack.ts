import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * «في مشكلة عند الرجوع داخل السيستم بيرجع للصفحة الرئيسية مش مكان ما كنت موجود»
 * (13 Oct 2026). The «لوحة التحكم» crumb on a client's page, the delete and the
 * «العودة» of a missing client all went to a fixed `/dashboard` — the overview —
 * wherever the person had come from. Back is the browser's own: one step in the
 * history this app made, which is the tab (and the list) they left. Only when there
 * is no earlier entry of the app — the page was opened from a link or a bookmark —
 * does it go to `fallback`.
 */
export function useGoBack(fallback = '/dashboard') {
  const navigate = useNavigate();
  return useCallback((to?: string) => {
    // React Router numbers its history entries: 0 is the first one this app made.
    const index = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof index === 'number' && index > 0) navigate(-1);
    else navigate(to ?? fallback);
  }, [navigate, fallback]);
}
