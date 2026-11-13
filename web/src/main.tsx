import React from 'react';
import ReactDOM from 'react-dom/client';
// Inter — один вариативный файл на все начертания (67 КБ вместо ~157 КБ и 10 файлов)
import '@fontsource-variable/inter/wght.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'leaflet/dist/leaflet.css';
import './native';
import './design';
import './index.css';
import './design-upk.css';
import './delta.css';
import App from './App';
import { initTheme } from './theme';
import { initUpkMotion } from './upkMotion';
import { ecoMode } from './motion';
import { initUpkUi } from './upkUi';
import { initSceneLight } from './sceneLight';

initTheme();
// экономный режим: CSS-анимации стоят (см. index.css html.eco)
if (ecoMode()) document.documentElement.classList.add('eco');
initUpkMotion();
initUpkUi();
initSceneLight();   // листы и док освещены солнцем или луной с неба   // указатель-искра, искры выделения, магнитные кнопки — только в оформлении «УПК»   // тема — до первой отрисовки, без вспышки

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
