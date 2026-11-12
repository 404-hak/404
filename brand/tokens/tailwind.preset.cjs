/** 404 · пресет Tailwind · версия 2.1 — цвета из CSS-переменных (темы «Ночь» и «День», brand/tokens/tokens.css) */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--rgb-bg) / <alpha-value>)',          // Ночной · днём — Пенный
        surface: 'rgb(var(--rgb-surface) / <alpha-value>)',
        primary: 'rgb(var(--rgb-primary) / <alpha-value>)',     // текст: Пенный · днём — Ночной
        grey: 'rgb(var(--rgb-grey) / <alpha-value>)',
        accent: 'rgb(var(--rgb-accent) / <alpha-value>)',      // Шалфейный
        ok: 'rgb(var(--rgb-accent) / <alpha-value>)',
        warn: 'rgb(var(--rgb-warn) / <alpha-value>)',          // Янтарный
        alert: 'rgb(var(--rgb-alert) / <alpha-value>)',        // Коралловый
        white: 'rgb(var(--rgb-veil) / <alpha-value>)',        // вуаль подсветок: ночью белая, днём тёмная
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '18px', chip: '6px' },
    },
  },
};
