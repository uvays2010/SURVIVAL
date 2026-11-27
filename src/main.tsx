import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {FirestoreErrorBoundary} from './components/FirestoreErrorBoundary.tsx';
import './index.css';

registerSW({immediate: true});

createRoot(document.getElementById('root')!).render(
  <FirestoreErrorBoundary>
    <App />
  </FirestoreErrorBoundary>
);
