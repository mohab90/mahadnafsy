import { useCallback, useEffect, useRef, useState } from 'react';

type UseFetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<T | null>;
};

export function useFetch<T = unknown>(url: string, options?: RequestInit): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const json = (await response.json()) as T;
      setData(json);
      return json;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      setError((err as Error).message || 'Request failed');
      return null;
    } finally {
      setLoading(false);
    }
  }, [url, options]);

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, [reload]);

  return { data, loading, error, reload };
}

export const fetcher = (url: string) => fetch(url).then((res) => res.json());
