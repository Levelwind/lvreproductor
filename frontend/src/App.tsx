import { Sidebar } from './components/Sidebar';
import { MainContent } from './components/MainContent';
import { CanvasPanel } from './components/CanvasPanel';
import { PlayerBar } from './components/PlayerBar';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { usePlayer } from './context/PlayerContext';
import './index.css';

function App() {
  const { isFullscreen } = usePlayer();

  return (
    <div className="app-container">
      <div className="main-layout" style={{ display: isFullscreen ? 'none' : 'flex' }}>
        <Sidebar />
        <MainContent />
        <CanvasPanel />
      </div>
      {!isFullscreen && <PlayerBar />}
      {isFullscreen && <FullscreenPlayer />}
    </div>
  );
}

export default App;
