import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModalKeyboard } from './useModalKeyboard';

/**
 * One dialog for both apps.
 *
 * Sixty-five overlays were written by hand — fifty-one in the admin, fourteen
 * in the client — and they had drifted into twenty different spellings of the
 * same backdrop: `bg-black/40`, `/50`, `/60`, with and without blur, at z-50,
 * z-[60] and z-[80], some centered and some not. Of the fifty-one in the admin,
 * five handled the Escape key and five moved focus into the panel, so for
 * everyone else a keyboard user opening a dialog was left on <body> behind it:
 * to reach the first field they tabbed through the whole page underneath, and
 * to leave they had to find the mouse. Fifteen had no visible close button at
 * all.
 *
 * None of that is a crash. It is the kind of thing that only shows up as "the
 * system feels inconsistent", which is exactly what it is.
 *
 * The API is deliberately small. Everything a dialog varies by — how wide, how
 * it sits, what colour its header is, which layer it is on — is a named choice
 * here rather than a class string each caller reinvents.
 */

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalTone = 'neutral' | 'indigo' | 'red' | 'emerald' | 'amber' | 'violet';

/**
 * Where the panel sits.
 *   center — the default dialog.
 *   sheet  — full width at the bottom on a phone, centered from `sm` up. For
 *            long forms a thumb has to reach.
 *   drawer — pinned to the side, full height. For lists and detail panes.
 */
export type ModalAlign = 'center' | 'sheet' | 'drawer';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: ModalTone;
  size?: ModalSize;
  align?: ModalAlign;
  /**
   * `over` puts a dialog above another dialog. `top` is reserved for the
   * confirm and prompt primitives, which have to sit above whatever asked the
   * question — including an `over` dialog. Three named levels is the whole
   * scale; a fourth means the flow is wrong, not that another number is needed.
   */
  layer?: 'base' | 'over' | 'top';
  /** Footer row, pinned below the scrolling body. */
  footer?: ReactNode;
  /** Hide the × — only for a dialog whose own body carries the way out. */
  hideClose?: boolean;
  /** Some dialogs guard unsaved work and must not close on a stray click. */
  closeOnBackdrop?: boolean;
  /** Extra classes for the panel, for the rare dialog that needs one. */
  panelClassName?: string;
  /**
   * Replaces the body's padding. For a dialog whose content runs edge to edge
   * — a full-bleed header image, a celebration banner — pass 'p-0' and let the
   * content own its own spacing. Everything else should leave this alone.
   */
  bodyClassName?: string;
  /**
   * A control that belongs in the header rather than the body — the payment
   * screen keeps its currency selector there, beside the customer's name,
   * because it changes what every figure below it means.
   */
  headerExtra?: ReactNode;
  children: ReactNode;
}

const SIZE: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-6xl',
};

const TONE: Record<ModalTone, string> = {
  neutral: 'bg-gray-50 text-gray-900 border-b border-gray-200',
  indigo: 'bg-gradient-to-l from-indigo-700 to-indigo-500 text-white',
  red: 'bg-gradient-to-l from-red-700 to-red-500 text-white',
  emerald: 'bg-gradient-to-l from-emerald-700 to-teal-600 text-white',
  amber: 'bg-gradient-to-l from-amber-600 to-orange-500 text-white',
  violet: 'bg-gradient-to-l from-violet-700 to-purple-500 text-white',
};

/** Close-button colours that stay legible on their header. */
const CLOSE_TONE: Record<ModalTone, string> = {
  neutral: 'bg-gray-200 hover:bg-gray-300 text-gray-600',
  indigo: 'bg-white/20 hover:bg-white/30 text-white',
  red: 'bg-white/20 hover:bg-white/30 text-white',
  emerald: 'bg-white/20 hover:bg-white/30 text-white',
  amber: 'bg-white/20 hover:bg-white/30 text-white',
  violet: 'bg-white/20 hover:bg-white/30 text-white',
};

/** The whole stacking scale, named. Nothing else may invent a number. */
const LAYER = { base: 'z-50', over: 'z-[60]', top: 'z-[80]' } as const;

const BACKDROP: Record<ModalAlign, string> = {
  center: 'flex items-center justify-center p-4',
  sheet: 'flex items-end sm:items-center justify-center p-0 sm:p-4',
  drawer: 'flex items-stretch justify-end',
};

const PANEL: Record<ModalAlign, string> = {
  center: 'rounded-2xl max-h-[90vh]',
  sheet: 'rounded-t-3xl sm:rounded-2xl max-h-[95vh]',
  drawer: 'h-full rounded-l-2xl',
};

let autoId = 0;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = 'neutral',
  size = 'md',
  align = 'center',
  layer = 'base',
  footer,
  hideClose = false,
  closeOnBackdrop = true,
  panelClassName = '',
  bodyClassName = 'p-5',
  headerExtra,
  children,
}: ModalProps) {
  // Called before the early return and told whether it is live: a hook placed
  // after `if (!open) return null` runs on some renders and not others, which
  // React forbids.
  const panelRef = useModalKeyboard(onClose, open);
  if (!open) return null;

  autoId += 1;
  const titleId = `modal-title-${autoId}`;

  return (
    <div
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm ${LAYER[layer]} ${BACKDROP[align]}`}
      onClick={closeOnBackdrop ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}
      dir="rtl"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`bg-white shadow-2xl w-full flex flex-col overflow-hidden ${SIZE[size]} ${PANEL[align]} ${panelClassName}`}
      >
        {(title || !hideClose) && (
          <div className={`flex items-center justify-between gap-3 px-5 py-4 shrink-0 ${TONE[tone]}`}>
            <div className="flex items-center gap-3 min-w-0">
              {icon && <div className={tone === 'neutral' ? '' : 'bg-white/20 rounded-xl p-2'}>{icon}</div>}
              <div className="min-w-0">
                {title && <h3 id={titleId} className="font-extrabold text-base leading-tight truncate">{title}</h3>}
                {subtitle && (
                  <p className={`text-xs mt-0.5 truncate ${tone === 'neutral' ? 'text-gray-500' : 'text-white/80'}`}>
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
            {headerExtra}
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق"
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition ${CLOSE_TONE[tone]}`}
              >
                <X size={16} />
              </button>
            )}
            </div>
          </div>
        )}

        <div className={`overflow-y-auto grow ${bodyClassName}`}>{children}</div>

        {footer && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 shrink-0 flex items-center gap-2 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
