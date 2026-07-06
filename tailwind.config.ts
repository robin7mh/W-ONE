import type { Config } from 'tailwindcss'

/**
 * Colors map to CSS variables declared in src/index.css so the whole app has a
 * single source of truth. Never hardcode hex in components — use these tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: 'rgb(var(--bg-void) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface) / <alpha-value>)',
        panel: 'rgb(var(--bg-panel) / <alpha-value>)',
        elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        hud: 'rgb(var(--border-hud) / <alpha-value>)',
        'hud-strong': 'rgb(var(--border-hud-strong) / <alpha-value>)',
        cyan: 'rgb(var(--accent-cyan) / <alpha-value>)',
        blue: 'rgb(var(--accent-blue) / <alpha-value>)',
        purple: 'rgb(var(--accent-purple) / <alpha-value>)',
        amber: 'rgb(var(--accent-amber) / <alpha-value>)',
        danger: 'rgb(var(--accent-danger) / <alpha-value>)',
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent-cyan) / 0.25), 0 0 18px -2px rgb(var(--accent-cyan) / 0.35)',
        'glow-sm': '0 0 12px -2px rgb(var(--accent-cyan) / 0.30)',
        panel: '0 1px 0 0 rgb(var(--border-hud) / 0.6), inset 0 1px 0 0 rgb(255 255 255 / 0.02)'
      },
      letterSpacing: {
        label: '0.18em'
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 0 0 rgb(var(--accent-cyan) / 0.55)' },
          '50%': { opacity: '0.55', boxShadow: '0 0 0 5px rgb(var(--accent-cyan) / 0)' }
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '92%': { opacity: '1' },
          '94%': { opacity: '0.72' },
          '96%': { opacity: '1' }
        }
      },
      animation: {
        'pulse-dot': 'pulseDot 2.2s ease-in-out infinite',
        scan: 'scan 7s linear infinite',
        flicker: 'flicker 6s linear infinite'
      }
    }
  },
  plugins: []
} satisfies Config
