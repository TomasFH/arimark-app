import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyColorScheme } from './lib/theme'
import './index.css'

function subscribeTheme(): void {
  if (!window.hw?.onUiSettingsChanged) return
  window.hw.onUiSettingsChanged(settings => {
    applyColorScheme(settings.colorScheme)
  })
}

async function boot(): Promise<void> {
  applyColorScheme('light')
  try {
    const result = await window.hw.getUiSettings()
    if (result.ok) applyColorScheme(result.data.colorScheme)
  } catch {
    applyColorScheme('light')
  }
  subscribeTheme()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void boot()
