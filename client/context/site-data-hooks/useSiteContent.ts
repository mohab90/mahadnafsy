import { useRef, useState } from 'react';

/** Read-only public site copy, hydrated from the catalog API. */
export function useSiteContent(initialContent: Record<string, string>) {
  const [content, setContent] = useState<Record<string, string>>(initialContent);
  const contentRef = useRef<Record<string, string>>(initialContent);

  const mergeContent = (incoming: Record<string, string>) => {
    contentRef.current = { ...contentRef.current, ...incoming };
    setContent(contentRef.current);
  };

  return { content, mergeContent };
}
