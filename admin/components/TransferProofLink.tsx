import { ImageIcon } from 'lucide-react';

/**
 * The screenshot of a transfer the client uploaded, kept on Google Drive (api/lib/transferScreenshot.js):
 * «صورة التحويل» opens it in a new tab, wherever the accounts desk confirms or links the payment.
 */
export function TransferProofLink({ url, className = '' }: { url?: string | null; className?: string }) {
  if (!url || !/^https:\/\/drive\.google\.com\//.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-bold text-sky-700 hover:bg-sky-100 ${className}`}>
      <ImageIcon size={11} /> صورة التحويل
    </a>
  );
}
