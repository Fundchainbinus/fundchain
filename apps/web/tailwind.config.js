/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palet dari Figma "BINUSMAYA — Design System".
        // Diukur langsung dari frame ekspor Figma (FundChain figma/*.png).
        navy: { DEFAULT: '#0097DA', dark: '#007DB5', light: '#EEF7FC', 50: '#F5FAFD', deep: '#014769' },
        accent: { DEFAULT: '#F19218', light: '#FEF3E2' },
        ink: { DEFAULT: '#333333', muted: '#6B7280' },
        line: '#C8CED3',
        footer: '#414042',
      },
      fontFamily: {
        sans: ['"Open Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
