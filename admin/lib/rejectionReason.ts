import { promptDialog } from '../../shared/ui/promptDialog';

/**
 * «لما المحاسب يرفض دفعة لازم نسأله عن السبب»: the question every reject button asks
 * before it sends anything. The answer is kept on the payment and sent to whoever
 * took it (api/lib/paymentRejection.js). Asked again until there is a reason;
 * null when the person backs out, so nothing is rejected.
 */
export async function askRejectionReason(what = 'الدفعة', who?: string): Promise<string | null> {
  let hint = '';
  for (;;) {
    const answer = await promptDialog({
      title: `سبب رفض ${what}`,
      message: `${hint}${who ? `${who} — ` : ''}اكتب سبب الرفض، هيوصل للموظف اللي سجّلها.`,
      placeholder: 'مثال: التحويل مش وصل — المبلغ مش مطابق — الإيصال غير واضح',
      confirmLabel: 'ارفض',
      multiline: true,
    });
    if (answer === null) return null;
    const reason = answer.replace(/\s+/g, ' ').trim();
    if (reason.length >= 3) return reason;
    hint = 'السبب مطلوب (3 حروف على الأقل). ';
  }
}
