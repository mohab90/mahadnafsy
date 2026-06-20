// ── Paymob gateway is currently SUSPENDED ─────────────────────────────────────
// All functions throw a user-friendly Arabic error so callers show the right message.

export interface PaymobInitResult {
  paymentKey: string;
  iframeUrl: string;
}

const SUSPENDED_MSG = 'بوابة الدفع الإلكتروني غير متاحة حالياً — يرجى التواصل معنا عبر واتساب لإتمام الدفع.';

export async function paymobInit(
  _amountCents: number,
  _merchantOrderId: string,
  _method: 'card' | 'wallet',
  _billing: { firstName: string; lastName: string; email: string; phone: string },
): Promise<PaymobInitResult> {
  throw new Error(SUSPENDED_MSG);
}

export async function paymobAuth(): Promise<string> { throw new Error(SUSPENDED_MSG); }
export async function paymobCreateOrder(_t: string, _c: number, _o: string): Promise<number> { throw new Error(SUSPENDED_MSG); }
export async function paymobGetPaymentKey(_t: string, _o: number, _c: number, _m: 'card' | 'wallet', _b: object): Promise<string> { throw new Error(SUSPENDED_MSG); }
export function buildPaymobIframeUrl(_method: 'card' | 'wallet', _paymentKey: string): string { throw new Error(SUSPENDED_MSG); }



