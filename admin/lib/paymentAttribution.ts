// «الدفعات من غير اسم موظف»: 104 of 110 payments in September were recorded
// from the owner's account, which has no staff row, so none of them said whose
// money it was. The payment dialog asks the owner, and the answer rides on the
// next payment the dialog sends — whichever of its twelve callers builds it —
// as the staff id the API already accepts from an approver
// (api/routes/subscriber-payments.js).

let pending: string | null = null;

/** Set by the dialog just before it submits; '' clears it. */
export function attributeNextPayment(staffId: string | null) {
  pending = staffId || null;
}

/** Read once by the API call that sends the payment. */
export function takePaymentAttribution(): string | null {
  const value = pending;
  pending = null;
  return value;
}
