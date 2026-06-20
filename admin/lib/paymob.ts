// ── Paymob gateway is SUSPENDED ──────────────────────────────────────────────
// All functions throw a clear error. Re-enable when account is reactivated.

const SUSPENDED_MSG = 'بوابة الدفع الإلكتروني غير متاحة حالياً.';

export const PAYMOB_CARD_INTEGRATION_ID = 0;
export const PAYMOB_WALLET_INTEGRATION_ID = 0;

export async function paymobAuth(): Promise<string> { throw new Error(SUSPENDED_MSG); }
export async function paymobCreateOrder(_t: string, _c: number, _o: string): Promise<number> { throw new Error(SUSPENDED_MSG); }
export async function paymobGetPaymentKey(_t: string, _o: number, _c: number, _m: 'card' | 'wallet', _b: object): Promise<string> { throw new Error(SUSPENDED_MSG); }
export function buildPaymobIframeUrl(_method: 'card' | 'wallet', _paymentKey: string): string { throw new Error(SUSPENDED_MSG); }

