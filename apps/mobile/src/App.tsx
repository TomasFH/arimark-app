import { useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { StoreSelector } from './components/StoreSelector'
import { ScannerScreen } from './components/ScannerScreen'
import { signOut } from './lib/auth'

type AppScreen = 'login' | 'store-select' | 'scanner'

interface SessionState {
  uid: string
  displayName: string
  role: string
  authorizedStores: string[]
  selectedStore: string | null
}

function App() {
  const [screen, setScreen] = useState<AppScreen>('login')
  const [session, setSession] = useState<SessionState | null>(null)

  function handleLoginSuccess(
    uid: string,
    displayName: string,
    role: string,
    authorizedStores: string[]
  ) {
    const newSession: SessionState = { uid, displayName, role, authorizedStores, selectedStore: null }
    setSession(newSession)

    if (authorizedStores.length === 1) {
      setSession({ ...newSession, selectedStore: authorizedStores[0]! })
      setScreen('scanner')
    } else {
      setScreen('store-select')
    }
  }

  function handleStoreSelect(storeId: string) {
    if (!session) return
    setSession({ ...session, selectedStore: storeId })
    setScreen('scanner')
  }

  async function handleLogout() {
    await signOut()
    setSession(null)
    setScreen('login')
  }

  if (screen === 'login') {
    return <LoginScreen onSuccess={handleLoginSuccess} />
  }

  if (screen === 'store-select' && session) {
    return (
      <StoreSelector
        stores={session.authorizedStores}
        onSelect={handleStoreSelect}
      />
    )
  }

  if (screen === 'scanner' && session && session.selectedStore) {
    return (
      <ScannerScreen
        uid={session.uid}
        displayName={session.displayName}
        storeId={session.selectedStore}
        onLogout={handleLogout}
      />
    )
  }

  return <LoginScreen onSuccess={handleLoginSuccess} />
}

export default App
