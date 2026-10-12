import { Component, StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './accessibility.css';
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="fatal-error"><h1>The console could not display this screen.</h1><p>No signing or publishing action was taken by this error screen. Reload to restore the workspace.</p><button className="button primary" onClick={() => location.reload()}>Reload console</button></main> : this.props.children; }
}
const root = document.getElementById('root');
if (!root) throw new Error('Application root missing.');
createRoot(root).render(<StrictMode><Boundary><App/></Boundary></StrictMode>);
