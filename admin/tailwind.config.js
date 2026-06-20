/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Tajawal', 'sans-serif'],
      },
      colors: {
        // Dynamic brand palette — driven by CSS vars set at runtime by lib/brandTheme.ts
        // (admin sets brand.primary in Settings → Identity). `primary` is aliased to the
        // same vars so the ENTIRE admin (465 existing primary-* usages) follows the brand
        // color from one place. Fallbacks = classic red so first paint is never broken.
        brand: {
          50:  'var(--brand-50, #fef2f2)',
          100: 'var(--brand-100, #fee2e2)',
          200: 'var(--brand-200, #fecaca)',
          300: 'var(--brand-300, #fca5a5)',
          400: 'var(--brand-400, #f87171)',
          500: 'var(--brand-500, #ef4444)',
          600: 'var(--brand-600, #dc2626)',
          700: 'var(--brand-700, #b91c1c)',
          800: 'var(--brand-800, #991b1b)',
          900: 'var(--brand-900, #7f1d1d)',
          fg:  'var(--brand-fg, #ffffff)',
          DEFAULT: 'var(--brand-600, #dc2626)',
        },
        primary: {
          50:  'var(--brand-50, #fef2f2)',
          100: 'var(--brand-100, #fee2e2)',
          200: 'var(--brand-200, #fecaca)',
          300: 'var(--brand-300, #fca5a5)',
          400: 'var(--brand-400, #f87171)',
          500: 'var(--brand-500, #ef4444)',
          600: 'var(--brand-600, #dc2626)',
          700: 'var(--brand-700, #b91c1c)',
          800: 'var(--brand-800, #991b1b)',
          900: 'var(--brand-900, #7f1d1d)',
        },
        secondary: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'bounce-slow': 'bounce 3s infinite',
        'float': 'float 3s ease-in-out infinite',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-in-from-bottom-2': 'slideInFromBottom 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInFromBottom: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shrink: {
          '0%': { width: '100%' },
          '100%': { width: '0%' },
        },
      },
    },
  },
  plugins: [],
};
