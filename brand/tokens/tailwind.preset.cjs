/** 404 · пресет Tailwind · версия 2.0 */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: '#0B1628',        // Ночной
        surface: '#142236',   // Глубинный
        primary: '#E2E8F0',   // Пенный
        grey: '#64748B',      // Сланцевый
        accent: '#7A866F',    // Шалфейный
        ok: '#7A866F',
        warn: '#F59E0B',      // Янтарный
        alert: '#EF4444',     // Коралловый
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '18px', chip: '6px' },
    },
  },
};
