import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
// Police embarquée (aucune dépendance réseau externe : l’application fonctionne hors ligne)
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-ext-400.css';
import '@fontsource/source-sans-3/latin-500.css';
import '@fontsource/source-sans-3/latin-ext-500.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-ext-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import '@fontsource/source-sans-3/latin-ext-700.css';
// Typographie principale de la charte graphique (titres et chiffres clés)
import '@fontsource/cooper-hewitt/500.css';
import '@fontsource/cooper-hewitt/600.css';
import '@fontsource/cooper-hewitt/700.css';
import './index.css';

// Routeur « de données » : indispensable à useBlocker (protection des saisies non enregistrées,
// y compris le bouton Retour du navigateur). Les routes restent déclarées dans App.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

// Une erreur d’API déjà affichée à l’utilisateur (runAction) remonte jusqu’au formulaire qui l’a déclenchée
// pour l’interrompre ; elle ne doit pas être signalée une seconde fois comme « non interceptée ».
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.dejaSignale) e.preventDefault(); });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
