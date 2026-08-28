import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installPwaAutoUpdate } from './lib/pwaUpdate'
import { installTouchGuards } from './lib/touchGuards'
import './index.css'

installPwaAutoUpdate()
installTouchGuards()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
