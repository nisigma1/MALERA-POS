import { useEffect, useState } from 'react';
import { Tables } from '../pages/Tables';
import { Inventory } from '../pages/Inventory';
import { Reports } from '../pages/Reports';
import { Settings } from '../pages/Settings';
import { formatLocalDateTime } from '../domain/display';
import { Icon } from '../components/ui';
import { PrintNotices } from '../components/PrintNotices';
const sections = [
  { id: 'tables', label: 'Tavolinat', component: Tables },
  { id: 'inventory', label: 'Inventari', component: Inventory },
  { id: 'reports', label: 'Raportet', component: Reports },
  { id: 'settings', label: 'Cilësimet', component: Settings },
] as const;
export function App() {
  const [section, setSection] = useState<(typeof sections)[number]>(sections[0]);
  const Page = section.component;
  const [now, setNow] = useState(new Date());
  const [date, time] = formatLocalDateTime(now).split(' ');
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><strong>FOX</strong><span>KAFETERI</span></div>
      <nav aria-label="Navigimi kryesor">{sections.map(item=><button key={item.id} data-nav={item.id} aria-current={section.id===item.id?'page':undefined} onClick={()=>setSection(item)}><Icon name={item.id}/>{item.label}</button>)}</nav>
      <div className="local-label"><span className="local-dot"/>Lokale<span className="local-helper">Të dhënat në këtë pajisje</span></div>
    </aside>
    <div className="workspace"><div className="topbar"><time dateTime={now.toISOString()}>{date}<strong>{time}</strong></time></div><PrintNotices/><main className="content"><Page/></main></div>
  </div>;
}
