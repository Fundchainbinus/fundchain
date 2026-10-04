/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Biru BINUSMAYA untuk aksi utama; navy untuk kartu peran di banner.
        brand: { DEFAULT: '#0A8FD6', dark: '#0773AE', light: '#E5F4FC', 50: '#F2F9FD' },
        navy: { DEFAULT: '#0B3D5C', dark: '#072B42' },
        accent: { DEFAULT: '#F18A00', light: '#FEF1E0' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
