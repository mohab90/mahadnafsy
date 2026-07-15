import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface State { hasError: boolean; message: string }

const isChunkLoadError = (err: Error): boolean => {
  const msg = err?.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Loading chunk')
  );
};

export class TabErrorBoundary extends React.Component<React.PropsWithChildren<{ tabName?: string }>, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[TabErrorBoundary]', error, info.componentStack);
    if (isChunkLoadError(error)) {
      const reloadKey = 'eb-chunk-reload';
      const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
      if (Date.now() - lastReload > 30_000) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <AlertCircle size={48} className="text-red-400 mb-4" />
          <h3 className="text-lg font-bold text-gray-700 mb-1">حدث خطأ في {this.props.tabName || 'هذا القسم'}</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-xs">{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium"
          >
            <RefreshCw size={14} /> إعادة التحميل
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
