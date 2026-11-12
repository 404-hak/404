// 404 · дизайн-токены (единый источник — geometry.mjs COLORS и COLORS_DAY)
import { COLORS as C, COLORS_DAY as D, mix, rgbOf } from './geometry.mjs';
import { T_DARK } from './ui.mjs';

const rgb = (h) => rgbOf(h).join(' ');
const T_DAY = mix(D.primary, D.bg, 0.68);

export const tokensCss = `/* 404 · дизайн-токены · версия 2.1 · темы «Ночь» (по умолчанию) и «День» */
:root {
  /* бренд */
  --c-bg: ${C.bg};        /* Ночной · фон интерфейса */
  --c-surface: ${C.surface};   /* Глубинный · карточки, панели */
  --c-primary: ${C.primary};   /* Пенный · знак, основной текст */
  --c-grey: ${C.grey};      /* Сланцевый · крупный вторичный текст, линии */
  --c-accent: ${C.accent};    /* Шалфейный · акцент, узлы сети */

  /* статусы — только для состояний системы */
  --c-ok: ${C.accent};        /* Норма */
  --c-warn: ${C.warn};      /* Предупреждение */
  --c-alert: ${C.alert};     /* Тревога */

  /* тона для текста и линий */
  --c-text: var(--c-primary);
  --c-text-2: ${T_DARK};    /* Primary 70 % — мелкие подписи на тёмном */
  --c-line: rgba(226, 232, 240, 0.15);

  /* каналы RGB — для прозрачности в Tailwind (bg-surface/70) */
  --rgb-bg: ${rgb(C.bg)}; --rgb-surface: ${rgb(C.surface)}; --rgb-primary: ${rgb(C.primary)};
  --rgb-grey: ${rgb(C.grey)}; --rgb-accent: ${rgb(C.accent)}; --rgb-warn: ${rgb(C.warn)}; --rgb-alert: ${rgb(C.alert)};
  --rgb-veil: 255 255 255;   /* светлая вуаль подсветок */

  /* шрифты */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* форма */
  --r-card: 18px;
  --r-chip: 6px;
  color-scheme: dark;
}

/* тема «День»: инверсная версия бренда, статусные цвета затемнены для светлого фона */
:root[data-theme="day"] {
  --c-bg: ${D.bg}; --c-surface: ${D.surface}; --c-primary: ${D.primary}; --c-grey: ${D.grey}; --c-accent: ${D.accent};
  --c-ok: ${D.accent}; --c-warn: ${D.warn}; --c-alert: ${D.alert};
  --c-text-2: ${T_DAY};
  --c-line: rgba(11, 22, 40, 0.14);
  --rgb-bg: ${rgb(D.bg)}; --rgb-surface: ${rgb(D.surface)}; --rgb-primary: ${rgb(D.primary)};
  --rgb-grey: ${rgb(D.grey)}; --rgb-accent: ${rgb(D.accent)}; --rgb-warn: ${rgb(D.warn)}; --rgb-alert: ${rgb(D.alert)};
  --rgb-veil: 11 22 40;      /* тёмная вуаль подсветок */
  color-scheme: light;
}

body {
  background: var(--c-bg);
  color: var(--c-text);
  font-family: var(--font-sans);
}
`;

const v = (n) => `rgb(var(--rgb-${n}) / <alpha-value>)`;
export const tailwindPreset = `/** 404 · пресет Tailwind · версия 2.1 — цвета из CSS-переменных (темы «Ночь» и «День», brand/tokens/tokens.css) */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: '${v('bg')}',          // Ночной · днём — Пенный
        surface: '${v('surface')}',
        primary: '${v('primary')}',     // текст: Пенный · днём — Ночной
        grey: '${v('grey')}',
        accent: '${v('accent')}',      // Шалфейный
        ok: '${v('accent')}',
        warn: '${v('warn')}',          // Янтарный
        alert: '${v('alert')}',        // Коралловый
        white: '${v('veil')}',        // вуаль подсветок: ночью белая, днём тёмная
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
