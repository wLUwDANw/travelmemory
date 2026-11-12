import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('#root not found in index.html');
}

// index.html 里的加载骨架会在首次 render 时被整棵替换掉。
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
