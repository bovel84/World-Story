import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui/ToastProvider';
import './styles/foundations.css';
import './index.css';
import './editorial.css';
// Light editorial palette follows legacy styles so the browser sees one coherent theme.
import './styles/light-palette.css';
import './styles/operational-mobile-fixes.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
