import React from 'react';

/**
 * The top of every inner page, in the home page's language: warm paper, a
 * soft burgundy glow, a gold eyebrow, a heavy title and one line under it.
 * Anything passed as children (a search box, filters, buttons) sits beneath.
 */
const PageHeader: React.FC<{
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: 'center' | 'start';
  children?: React.ReactNode;
}> = ({ eyebrow, title, subtitle, align = 'center', children }) => (
  <section className="relative overflow-hidden border-b border-line bg-paper">
    <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.12),transparent)]" />
    <div aria-hidden="true" className="pointer-events-none absolute -right-32 -bottom-40 h-[360px] w-[360px] rounded-full bg-[radial-gradient(closest-side,rgba(200,150,46,.14),transparent)]" />
    <div className={`container relative mx-auto px-4 py-10 sm:py-14 ${align === 'center' ? 'text-center' : 'text-center lg:text-right'}`}>
      {eyebrow && <span className="text-sm font-extrabold text-gold-deep">{eyebrow}</span>}
      <h1 className="mt-2 text-balance text-3xl font-black leading-tight text-ink sm:text-4xl lg:text-[44px]">{title}</h1>
      {subtitle && <p className={`mt-3 max-w-2xl text-base leading-relaxed text-muted-body sm:text-lg ${align === 'center' ? 'mx-auto' : 'mx-auto lg:mx-0'}`}>{subtitle}</p>}
      {children && <div className="mt-6">{children}</div>}
    </div>
  </section>
);

export default PageHeader;
