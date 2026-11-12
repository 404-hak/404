# 404 · брендбук

- `404-brandbook.pdf` — бренд-гайд, версия 2.0 (35 стр., A4 landscape)
- `logo-package/` — пакет логотипов (65 файлов) и архив `404-logo-package.zip`
- `tokens/tokens.css`, `tokens/tailwind.preset.cjs` — цвета и шрифты для кода
- `src/` — генератор: знак, надпись, пакет и страницы брендбука собираются из `src/geometry.mjs`
- `src/source/mark-source.png` — исходник знака; `src/trace_mark.py` переводит его в симметричный вектор `src/mark-data.mjs`

Пересборка (нужен `playwright`, шрифты Inter и JetBrains Mono в системе):

    python3 brand/src/trace_mark.py   # только если поменялся исходник знака (pip install potracer numpy pillow)
    node brand/src/build.mjs

Палитра: Ночной `#0B1628`, Глубинный `#142236`, Пенный `#E2E8F0`, Сланцевый `#64748B`,
Бирюзовый `#2DD4BF`; статусы — Янтарный `#F59E0B`, Коралловый `#EF4444`.
