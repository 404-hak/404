/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Ключ JavaScript API Яндекс Карт (developer.tech.yandex.ru). Без него работает офлайн-схема. */
  readonly VITE_YANDEX_MAPS_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
