/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			bg: 'var(--bg)',
  			surface: 'var(--surface)',
  			'surface-alt': 'var(--surface-alt)',
  			border: 'var(--border)',
  			'border-strong': 'var(--border-strong)',
  			'border-soft': 'var(--border-soft)',
  			fg: 'var(--fg)',
  			'text-body': 'var(--text-body)',
  			muted: 'var(--muted)',
  			'muted-2': 'var(--muted-2)',
  			'text-hint': 'var(--text-hint)',
  			accent: 'var(--accent)',
  			'accent-hover': 'var(--accent-hover)',
  			'accent-tint': 'var(--accent-tint)',
  			'status-info': 'var(--status-info)',
  			success: 'var(--success)',
  			danger: 'var(--danger)',
  			warning: 'var(--warning)',
  			panel: 'var(--panel-bg)',
  			focus: 'var(--focus)'
  		},
  		borderRadius: {
  			DEFAULT: 'var(--radius)',
  			card: 'var(--radius-card)'
  		},
  		fontFamily: {
  			ui: [
  				'var(--font-ui)'
  			],
  			mono: [
  				'Consolas',
  				'SF Mono',
  				'monospace'
  			]
  		},
  		spacing: {
  			'1': 'var(--space-1)',
  			'2': 'var(--space-2)',
  			'3': 'var(--space-3)',
  			'4': 'var(--space-4)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [],
}
