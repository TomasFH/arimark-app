import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SandboxBanner } from './components/SandboxBanner'

export default function App() {
  return (
    <BrowserRouter>
      <SandboxBanner />
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={<div className="p-8 text-gray-700">Cargando...</div>} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
