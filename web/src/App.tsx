import { AppProvider, useApp } from './store'
import { TopBar } from './components/TopBar'
import { BottomBar } from './components/BottomBar'
import { LeftColumn } from './components/LeftColumn'
import { CenterColumn } from './components/CenterColumn'
import { RightColumn } from './components/RightColumn'
import { NewChatWizard } from './components/NewChatWizard'
import { ConfigEditor } from './components/ConfigEditor'
import { CharacterEditor } from './components/CharacterEditor'
import { LorebookEditor } from './components/LorebookEditor'
import { ScenarioEditor } from './components/ScenarioEditor'

function Shell() {
  const { overlay, error } = useApp()
  return (
    <div className="app">
      <TopBar />
      <div className="columns">
        <LeftColumn />
        <CenterColumn />
        <RightColumn />
      </div>
      <BottomBar />
      {error && (
        <div style={{ position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}>
          <span className="error">{error}</span>
        </div>
      )}
      {overlay === 'new-chat' && <NewChatWizard />}
      {overlay === 'config' && <ConfigEditor />}
      {overlay === 'characters' && <CharacterEditor />}
      {overlay === 'lorebooks' && <LorebookEditor />}
      {overlay === 'scenarios' && <ScenarioEditor />}
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}