/**
 * What shows while a lazily-loaded dialog is still arriving.
 *
 * Four screens wrote `<Suspense fallback={<div className="fixed inset-0 z-[60]
 * bg-black/20" />}>` by hand. It is not a dialog — it is the dimmed ground a
 * dialog is about to appear on — but it was counted as one by every scan
 * looking for overlays, and it had drifted a shade darker in some places than
 * others.
 *
 * It also showed nothing at all, so a slow connection got a grey screen with no
 * sign that anything was loading.
 */
export function ModalFallback() {
  return (
    <div className="fixed inset-0 z-[60] bg-black/20 flex items-center justify-center" aria-busy="true">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
    </div>
  );
}

export default ModalFallback;
