import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Fondo de app: zinc-950 se iguala a zinc-900 (menos negro, un solo token).
        zinc: {
          950: '#18181b',
        },
      },
    },
  },
  plugins: [],
}

export default config
