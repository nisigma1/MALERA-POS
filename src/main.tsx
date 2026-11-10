import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './components/common/AppErrorBoundary';
import './styles/tokens.css';
import './styles/app.css';
import './styles/orderDraft.css';
import './styles/tableReference.css';
const root = document.getElementById('root');
if (!root) throw new Error('FOX root element is missing');
createRoot(root).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
