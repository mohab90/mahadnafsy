import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Detect stale chunk errors (after a new deploy the old JS chunk hashes no longer exist)
const isChunkLoadError = (err: Error): boolean => {
  const msg = err?.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    (err?.name === 'TypeError' && msg.includes('fetch'))
  );
};

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);

    // Auto-reload once if it's a stale chunk error (new deploy invalidated old hashes)
    if (isChunkLoadError(error)) {
      const reloadKey = 'eb-chunk-reload';
      const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
      const now = Date.now();
      // Reload at most once per 30 seconds to avoid infinite reload loop
      if (now - lastReload > 30_000) {
        sessionStorage.setItem(reloadKey, String(now));
        window.location.reload();
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isChunk = this.state.error ? isChunkLoadError(this.state.error) : false;

      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-4 text-center" dir="rtl">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-red-500 text-3xl">⚠</div>
          <h1 className="text-xl font-bold text-gray-800">حدث خطأ غير متوقع</h1>
          <p className="text-gray-500 text-sm max-w-md">
            {isChunk
              ? 'تم تحديث الموقع — جاري إعادة التحميل تلقائياً...'
              : 'نعتذر عن هذا الخطأ. يمكنك المحاولة مرة أخرى أو العودة للصفحة الرئيسية.'}
            {this.state.error && (
              <span className="block mt-2 font-mono text-xs text-red-400 bg-red-50 px-3 py-2 rounded-lg">
                {this.state.error.message}
              </span>
            )}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition"
            >
              إعادة التحميل
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition"
            >
              الرئيسية
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
