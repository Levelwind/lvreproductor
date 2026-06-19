import { Library, Plus } from 'lucide-react';
import './Sidebar.css';

export function Sidebar() {
  return (
    <aside className="panel sidebar">
      <div className="sidebar-header">
        <h2>
          <Library size={24} strokeWidth={2.5} />
          Tu biblioteca
        </h2>
        <button className="btn-icon">
          <Plus size={20} strokeWidth={2.5} />
        </button>
      </div>

      <div className="filters">
        <button className="pill-btn">Playlists</button>
        <button className="pill-btn">Artistas</button>
      </div>

      <div className="library-list">
        <div className="library-item">
          <div className="item-cover" style={{ backgroundColor: 'var(--color-brand)' }}></div>
          <div className="item-info">
            <span className="item-title">Canciones que te gustan</span>
            <span className="item-subtitle">Playlist • 120 canciones</span>
          </div>
        </div>
        <div className="library-item">
          <div className="item-cover"></div>
          <div className="item-info">
            <span className="item-title">Rock HiFi</span>
            <span className="item-subtitle">Carpeta local</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
