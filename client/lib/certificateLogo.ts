import type React from 'react';
import { logoFallback } from './brand';

// The old hosted logo first if the domain's own is missing, then nothing.
export const certificateLogoError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  if (e.currentTarget.dataset.logoFallback) e.currentTarget.style.display = 'none';
  else logoFallback(e);
};
