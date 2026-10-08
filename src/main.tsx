import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/app.css';
const root = document.getElementById('root');
if (!root) throw new Error('FOX root element is missing');
createRoot(root).render(<App />);
