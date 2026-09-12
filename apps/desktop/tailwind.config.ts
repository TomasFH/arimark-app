import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Fallback para pantallas aún no migradas a tokens (theme-pass).
        zinc: {
          950: '#18181b',
        },
        app: 'var(--bg-app)',
        panel: 'var(--bg-panel)',
        raised: 'var(--bg-raised)',
        input: 'var(--bg-input)',
        hover: 'var(--bg-hover)',
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        subtle: 'var(--text-subtle)',
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
          accent: 'var(--border-accent)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          fg: 'var(--accent-fg)',
          soft: 'var(--bg-accent-soft)',
        },
        danger: 'var(--danger)',
        success: 'var(--success)',
        overlay: 'var(--overlay)',
      },
    },
  },
  plugins: [],
}

export default config
