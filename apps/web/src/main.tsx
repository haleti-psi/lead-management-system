import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';

// QueryClientProvider, router, i18n, and auth context are wired in Stage 7.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
