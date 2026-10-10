import { useData } from '../app/useData';
import { DataState } from '../components/DataState';
import { Icon, PageHeader } from '../components/ui';
import { ReceiptSettingsPanel } from '../components/ReceiptSettingsPanel';
import { DataProtectionPanel } from '../components/DataProtectionPanel';
const load = () => window.fox.settings.get();
export function Settings() {
  const { data, error, retry } = useData(load);
  const header = <PageHeader title="Cilësimet" helper="Të dhënat bazë të FOX Kafeteri."/>;
  if (!data) return <>{header}<DataState error={error} retry={retry}/></>;
  return <div data-page="settings">{header}<div className="settings-grid"><section className="settings-panel business-settings"><div className="settings-section-header"><Icon name="settings"/><div><h2>Biznesi</h2><p>Informacioni i biznesit në këtë pajisje.</p></div></div><dl className="settings"><dt>Emri i biznesit</dt><dd>{data.businessName}</dd></dl></section><ReceiptSettingsPanel/><DataProtectionPanel/></div></div>;
}
