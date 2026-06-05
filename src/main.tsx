import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lightTheme.css';
import { initColorTheme } from './lib/colorTheme';
import { applyPwaIconsToDocument } from './lib/pwaIconStorage';

initColorTheme();
applyPwaIconsToDocument();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
