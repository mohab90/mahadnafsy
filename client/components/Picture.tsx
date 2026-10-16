import React from 'react';

// The site's own photos (client/assets/photos). Imported through Vite, so each
// file is served from /assets/ under a hashed name and cached by the browser for
// a year — files in public/ are not, the server sends them with no-store.
const FILES = import.meta.glob('../assets/photos/*.{webp,jpg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The URL of one of the site's photos, e.g. photoUrl('celebration-480.webp'). */
export const photoUrl = (file: string): string => FILES[`../assets/photos/${file}`] || '';

/**
 * One of the site's photos, as WebP in the sizes that exist beside it —
 * `name-360.webp`, `name-640.webp`… — with `name.jpg` as the fallback for the
 * few browsers without WebP. The browser picks the smallest file that fills the
 * box on that screen, so a phone never downloads the desktop size.
 */
const Picture: React.FC<{
  photo: string;
  widths: number[];
  sizes: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
}> = ({ photo, widths, sizes, alt, width, height, className, style, priority }) => (
  <picture>
    <source type="image/webp" sizes={sizes} srcSet={widths.map(w => `${photoUrl(`${photo}-${w}.webp`)} ${w}w`).join(', ')} />
    <img
      src={photoUrl(`${photo}.jpg`)}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? undefined : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={className}
      style={style}
    />
  </picture>
);

export default Picture;
