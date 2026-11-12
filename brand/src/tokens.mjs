// 404 · дизайн-токены (единый источник — geometry.mjs COLORS)
import { COLORS as C, mix } from './geometry.mjs';
import { T_DARK } from './ui.mjs';

export const tokensCss = `/* 404 · дизайн-токены · версия 2.0 */
:root {
  /* бренд */
  --c-bg: ${C.bg};        /* Ночной · фон интерфейса */
  --c-surface: ${C.surface};   /* Глубинный · карточки, панели */
  --c-primary: ${C.primary};   /* Пенный · знак, основной текст */
  --c-grey: ${C.grey};      /* Сланцевый · крупный вторичный текст, линии */
  --c-accent: ${C.accent};    /* Бирюзовый · акцент, узлы сети */

  /* статусы — только для состояний системы */
  --c-ok: ${C.accent};        /* Норма */
  --c-warn: ${C.warn};      /* Предупреждение */
  --c-alert: ${C.alert};     /* Тревога */

  /* тона для текста и линий */
  --c-text: var(--c-primary);
  --c-text-2: ${T_DARK};    /* Primary 70 % — мелкие подписи на тёмном */
  --c-line: rgba(226, 232, 240, 0.15);

  /* шрифты */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* форма */
  --r-card: 18px;
  --r-chip: 6px;
}

body {
  background: var(--c-bg);
  color: var(--c-text);
  font-family: var(--font-sans);
}
`;

export const tailwindPreset = `/** 404 · пресет Tailwind · версия 2.0 */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: '${C.bg}',        // Ночной
        surface: '${C.surface}',   // Глубинный
        primary: '${C.primary}',   // Пенный
        grey: '${C.grey}',      // Сланцевый
        accent: '${C.accent}',    // Бирюзовый
        ok: '${C.accent}',
        warn: '${C.warn}',      // Янтарный
        alert: '${C.alert}',     // Коралловый
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '18px', chip: '6px' },
    },
  },
};
`;
