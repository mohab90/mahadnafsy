import React from 'react';

/**
 * A photo shipped with the site (client/public), served as WebP in the sizes
 * that exist beside it — `name-360.webp`, `name-640.webp`… — with the JPEG as
 * the fallback for the few browsers without WebP. The browser picks the
 * smallest file that fills the box on that screen, so a phone never downloads
 * the desktop size.
 */
const Picture: React.FC<{
  base: string;
  widths: number[];
  sizes: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
  priority?: boolean;
}> = ({ base, widths, sizes, alt, width, height, className, style, priority }) => {
  const root = `${import.meta.env.BASE_URL}${base}`;
  return (
    <picture>
      <source type="image/webp" sizes={sizes} srcSet={widths.map(w => `${root}-${w}.webp ${w}w`).join(', ')} />
      <img
        src={`${root}.jpg`}
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
};

export default Picture;
