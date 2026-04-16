import AppShell from './components/layout/AppShell'
import { usePptAgentSession } from './hooks/usePptAgentSession'
import './App.css'

export default function App() {
  const session = usePptAgentSession()

  return <AppShell session={session} />
}
