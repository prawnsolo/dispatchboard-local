import { StrictMode } from 'react'
import { ensureMapLibreWorker } from './lib/maplibre-worker.ts'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ThemeProvider } from './lib/theme.tsx'
import './index.css'

ensureMapLibreWorker()

document.title = 'DispatchBoard (Local)'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
