// Which product the admin is: one institute's system, or the multi-institute
// (SaaS) platform.
//
// «نظام ساس علي جمب دلوقتي او اخفيه لحد ما نظبط سيستم لشركة واحدة كامله».
// Off by default: the SaaS setup wizard and the custom-domain box are hidden,
// and nothing else changes — the tenant isolation underneath stays, and the
// /api/admin/saas routes are platform-admin only anyway. A build with
// VITE_SAAS_UI=1 shows them again.
export const SAAS_UI = import.meta.env.VITE_SAAS_UI === '1';
