import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
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
import { initSceneLight } from './sceneLight';

initTheme();
initUpkMotion();
initSceneLight();   // листы и док освещены солнцем или луной с неба   // указатель-искра, искры выделения, магнитные кнопки — только в оформлении «УПК»   // тема — до первой отрисовки, без вспышки

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
