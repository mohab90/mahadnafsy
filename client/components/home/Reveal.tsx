import React, { useEffect, useRef, useState } from 'react';

/**
 * True once the element has scrolled into view (and stays true). Without
 * IntersectionObserver — old browsers, some crawlers — everything is shown at once.
 */
export function useInView<T extends Element>(rootMargin = '0px 0px -8% 0px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen];
}

/** Fades and lifts its children in the first time they scroll into view. */
export const Reveal: React.FC<{ className?: string; delay?: number; children: React.ReactNode }> = ({ className = '', delay = 0, children }) => {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`transition duration-700 ease-out motion-reduce:transition-none ${seen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100'} ${className}`}
    >
      {children}
    </div>
  );
};

/**
 * Counts a figure such as «12K», «50+» or «4.9» up from zero once `run` turns
 * true, keeping whatever surrounds the number. Anything without a number is
 * shown as it is.
 */
export function useCountUp(value: string, run: boolean, ms = 1400): string {
  const match = /^(\D*)(\d+(?:[.,]\d+)?)(.*)$/.exec(value.trim());
  const target = match ? Number(match[2].replace(',', '')) : 0;
  const decimals = match && /[.]/.test(match[2]) ? match[2].split('.')[1].length : 0;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!match || !run) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(target); return undefined; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, target, ms]);
  if (!match) return value;
  return `${match[1]}${shown.toFixed(decimals)}${match[3]}`;
}
