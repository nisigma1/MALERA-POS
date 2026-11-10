import { useEffect, useState } from 'react';
import { Tables } from '../pages/Tables';
import { Inventory } from '../pages/Inventory';
import { Reports } from '../pages/Reports';
import { Settings } from '../pages/Settings';
import { formatLocalDateTime } from '../domain/display';
import { Button, Icon } from '../components/common/Controls';
import { MaleraMark } from '../components/branding/MaleraMark';
import { PrintNotices } from '../components/receipts/PrintNotices';
import { useData } from './useData';
import { OrderDraftContext } from './orderDraftContext';
import { PRODUCT_NAME } from '../domain/brand';
import type { TableDraft } from '../domain/orderDraft';

const loadIdentity = () => window.fox.settings.get();
const sections = [
  { id: 'tables', label: 'Tavolinat', component: Tables },
  { id: 'inventory', label: 'Stoku', component: Inventory },
  { id: 'reports', label: 'Raportet', component: Reports },
  { id: 'settings', label: 'Cilësimet', component: Settings },
] as const;
export function App() {
  const [section, setSection] = useState<(typeof sections)[number]>(sections[0]);
  const [compact, setCompact] = useState(false);
  const [drafts, setDrafts] = useState(() => new Map<string, TableDraft>());
  const identity = useData(loadIdentity);
  const businessName = identity.data?.businessName.trim();
  const Page = section.component;
  const [now, setNow] = useState(new Date());
  const [date, time] = formatLocalDateTime(now).split(' ');
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.title = businessName ? `${businessName} · ${PRODUCT_NAME}` : PRODUCT_NAME;
    return () => {
      document.title = PRODUCT_NAME;
    };
  }, [businessName]);
  const menuLabel = compact ? 'Zgjero menynë' : 'Tkurre menynë';
  return (
    <OrderDraftContext.Provider value={{ drafts, setDrafts }}>
      <div className="shell" data-sidebar-compact={compact}>
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="sidebar-wordmark">
              <MaleraMark />
              <span>POS · Malera Studio</span>
            </div>
            <Button
              variant="ghost"
              className="icon-button sidebar-toggle"
              aria-controls="main-nav"
              aria-expanded={!compact}
              aria-label={menuLabel}
              title={menuLabel}
              onClick={() => setCompact((value) => !value)}
            >
              <Icon name="menu" />
            </Button>
          </div>
          <nav id="main-nav" aria-label="Navigimi kryesor">
            {sections.map((item) => (
              <button
                key={item.id}
                data-nav={item.id}
                title={compact ? item.label : undefined}
                aria-current={section.id === item.id ? 'page' : undefined}
                onClick={() => setSection(item)}
              >
                <Icon name={item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="local-label" data-ready={Boolean(identity.data)}>
            <div className="brand" title={businessName ?? PRODUCT_NAME}>
              <Icon name="cup" />
              <strong>{businessName ?? PRODUCT_NAME}</strong>
            </div>
            <span className="local-helper">
              <strong>Në këtë pajisje</strong>
              <span>Të dhënat ruhen këtu</span>
            </span>
          </div>
        </aside>
        <div className="workspace">
          <div className="topbar">
            <time dateTime={now.toISOString()}>
              <span>
                <Icon name="calendar" />
                {date}
              </span>
              <strong>
                <Icon name="clock" />
                {time}
              </strong>
            </time>
          </div>
          <PrintNotices />
          <main className="content">
            {section.id === 'settings' ? <Settings onNameChanged={identity.refresh} /> : <Page />}
          </main>
        </div>
      </div>
    </OrderDraftContext.Provider>
  );
}
