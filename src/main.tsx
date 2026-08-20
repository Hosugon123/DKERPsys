import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lightTheme.css';
import { initColorTheme } from './lib/colorTheme';
import { installCompressedLocalStorage } from './lib/compressedLocalStorage';
import { installPerformanceDebug } from './lib/performanceDebug';
import { applyPwaIconsToDocument } from './lib/pwaIconStorage';

installCompressedLocalStorage();
installPerformanceDebug();
initColorTheme();
applyPwaIconsToDocument();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
