import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // importe Tailwind puis leaflet.css, dans cet ordre
import App from './App.jsx';
import GardeErreur from './components/GardeErreur.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GardeErreur nom="application">
      <App />
    </GardeErreur>
  </React.StrictMode>
);
