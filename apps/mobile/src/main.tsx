import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installSystemBackHandler } from './lib/backStack'
import { installPwaAutoUpdate } from './lib/pwaUpdate'
import { installTouchGuards } from './lib/touchGuards'
import './index.css'

installPwaAutoUpdate()
installTouchGuards()
// Antes de React: el primer Atrás no puede ganar la carrera a un useEffect.
installSystemBackHandler()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
