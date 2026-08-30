import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CbHelpMonitor from './CbHelpMonitor';
import CameraSetupScreen from './CameraSetupScreen';
import './index.css';

// Same bundle, multiple roots: cbHelpWindow.ts/cameraSetupWindow.ts (main
// process) open their windows by loading this exact page with a distinct
// hash instead of building a second Vite entry point per small view. See
// each module's own doc comment for why that window exists at all.
function pickRoot() {
  switch (window.location.hash) {
    case '#cb-help':
      return <CbHelpMonitor />;
    case '#camera-setup':
      return <CameraSetupScreen />;
    default:
      return <App />;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{pickRoot()}</React.StrictMode>
);
