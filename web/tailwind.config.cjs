/** Цвета, шрифты и радиусы — из брендбука (brand/tokens) */
module.exports = {
  presets: [require('../brand/tokens/tailwind.preset.cjs')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { muted: 'var(--c-text-2)', line: 'var(--c-line)' },
    },
  },
};
