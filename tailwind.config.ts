import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1a1a1a',
        paper: '#fafaf7',
        accent: '#0066cc',
        muted: '#666',
        line: '#e5e5e0',
        success: '#0a7d3e',
        warn: '#c75300',
        danger: '#b3261e',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
