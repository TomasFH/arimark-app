/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1a1a1a',
          accent: '#e53e3e',
        },
      },
    },
  },
  plugins: [],
}
