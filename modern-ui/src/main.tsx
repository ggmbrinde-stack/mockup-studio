import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

/* Browser previews have no CEP host, so the panel used to stop at "Host scripts did not
   load". installMockHost() fakes that host and adds the state switcher, and it has to be
   in place before the panel's first effect runs. Dev-only: the built panel keeps its real
   CSInterface from CEP and the mock module is tree-shaken away.

   The guard is window.__adobe_cep__ (the API CEP injects), not window.CSInterface:
   index.html loads public/csinterface.js in every environment, so the class exists even
   in a plain browser while the host behind it does not. */
async function boot() {
  if (import.meta.env.DEV && !(window as any).__adobe_cep__) {
    try {
      const mock = await import('./mock/mock-host')
      mock.installMockHost()
    } catch { }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

void boot()
