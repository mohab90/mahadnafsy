import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, X, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; type: ToastType; message: string }
interface ToastContextValue { show: (message: string, type?: ToastType) => void }

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function ToastProvider({ children }: React.PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++counter.current;
    setToasts(prev => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const icons: Record<ToastType, React.ReactNode> = {
    success:  <CheckCircle   size={18} className="text-emerald-500 shrink-0" />,
    error:    <AlertCircle   size={18} className="text-red-500 shrink-0" />,
    warning:  <AlertTriangle size={18} className="text-amber-500 shrink-0" />,
    info:     <AlertCircle   size={18} className="text-blue-500 shrink-0" />,
  };

  const bars: Record<ToastType, string> = {
    success: 'bg-emerald-500',
    error:   'bg-red-500',
    warning: 'bg-amber-500',
    info:    'bg-blue-500',
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-6 left-6 z-[9999] flex flex-col gap-2 min-w-[260px] max-w-xs" dir="rtl">
        {toasts.map(t => (
          <div key={t.id} className="relative overflow-hidden flex items-start gap-3 bg-white border border-gray-200 shadow-lg rounded-xl px-4 py-3 animate-in slide-in-from-bottom-2 duration-200">
            {icons[t.type]}
            <span className="text-sm text-gray-800 leading-snug flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-gray-600 shrink-0 mt-0.5"><X size={14} /></button>
            <span className={`absolute bottom-0 right-0 left-0 h-0.5 ${bars[t.type]} animate-[shrink_3.5s_linear_forwards]`} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }
