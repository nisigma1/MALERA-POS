import { useCallback, useEffect, useState } from 'react';
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
import { DataState } from '../components/common/DataState';
import { OperatorLogin } from '../components/branding/OperatorLogin';
import { OperatorContext, openSession } from './operatorContext';
import { OPERATORS, type OperatorSession } from '../domain/operators';
import type { TableDraft } from '../domain/orderDraft';

const loadIdentity = () => window.fox.settings.get();
const sections = [
  { id: 'tables', label: 'Tavolinat', component: Tables },
  { id: 'inventory', label: 'Stoku', component: Inventory },
  { id: 'reports', label: 'Raportet', component: Reports },
  { id: 'settings', label: 'Cilësimet', component: Settings },
] as const;
const loadSession = () => window.fox.operators?.status() ?? Promise.resolve(openSession);
export function App() {
  const { data, error, retry, setData } = useData(loadSession);
  const [logoutError, setLogoutError] = useState(false);
  if (!data) return <DataState error={error} retry={retry} />;
  if (data.required && !data.operator)
    return <OperatorLogin configured={data.configured} onLogin={setData} />;
  return (
    <OperatorContext.Provider value={data}>
      <AppScreen
        key={data.operator ?? 'local'}
        session={data}
        logoutError={logoutError}
        onLogout={async () => {
          setLogoutError(false);
          try {
            setData(await window.fox.operators.logout());
          } catch {
            setLogoutError(true);
          }
        }}
      />
    </OperatorContext.Provider>
  );
}
function AppScreen({
  session,
  logoutError,
  onLogout,
}: {
  session: OperatorSession;
  logoutError: boolean;
  onLogout: () => Promise<void>;
}) {
  const employee = session.required && session.operator !== 'OWNER';
  const [section, setSection] = useState<(typeof sections)[number]>(sections[0]);
  const [compact, setCompact] = useState(false);
  const [drafts, setDrafts] = useState(() => new Map<string, TableDraft>());
  const loadBusiness = useCallback(
    () => (employee ? Promise.resolve({ businessName: 'DUO' }) : loadIdentity()),
    [employee],
  );
  const identity = useData(loadBusiness);
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
            {(employee ? sections.slice(0, 1) : sections).map((item) => (
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
            {session.operator && (
              <Button onClick={() => void onLogout()}>{OPERATORS[session.operator]} · Dil</Button>
            )}
            {logoutError && <span role="alert">Dalja nuk u krye. Provo përsëri.</span>}
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
          {!employee && <PrintNotices />}
          <main className="content">
            {session.setupPending && (
              <p className="notice">
                Konfiguroni PIN-et në HP për të aktivizuar llogaritë, raportet e turneve dhe stokun
                e kafesë në kg.
              </p>
            )}
            {section.id === 'settings' ? <Settings onNameChanged={identity.refresh} /> : <Page />}
          </main>
        </div>
      </div>
    </OrderDraftContext.Provider>
  );
}
