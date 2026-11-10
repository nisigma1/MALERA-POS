import { useData } from '../app/useData';
import { DataState } from '../components/common/DataState';
import { Icon, PageHeader } from '../components/common/Controls';
import { ReceiptSettingsPanel } from '../components/receipts/ReceiptSettingsPanel';
import { DataProtectionPanel } from '../components/data-protection/DataProtectionPanel';
import { useState } from 'react';
import { Button, Field } from '../components/common/Controls';
import type { Settings as BusinessSettings } from '../domain/types';
const load = () => window.fox.settings.get();
function BusinessName({
  settings,
  onNameChanged,
}: {
  settings: BusinessSettings;
  onNameChanged?: () => void;
}) {
  const [name, setName] = useState(settings.businessName),
    [saved, setSaved] = useState(settings.businessName),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await window.fox.settings.updateBusinessName({ businessName: name });
      if (result.ok) {
        setName(result.data.businessName);
        setSaved(result.data.businessName);
        setMessage('Emri u ruajt.');
        onNameChanged?.();
      } else setError(result.errors.businessName ?? result.message);
    } catch {
      setError('Emri nuk u ruajt. Provo përsëri.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} data-business-form>
      <Field id="business-name" label="Emri i biznesit" error={error}>
        <input
          id="business-name"
          value={name}
          maxLength={100}
          required
          disabled={busy}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
            setMessage('');
          }}
        />
      </Field>
      <Button type="submit" disabled={busy || name === saved}>
        {busy ? 'Duke ruajtur…' : 'Ruaj emrin'}
      </Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function Settings({ onNameChanged }: { onNameChanged?: () => void } = {}) {
  const { data, error, retry } = useData(load);
  const header = <PageHeader title="Cilësimet" helper="Të dhënat bazë të MALERA POS." />;
  if (!data)
    return (
      <>
        {header}
        <DataState error={error} retry={retry} />
      </>
    );
  return (
    <div data-page="settings">
      {header}
      <div className="settings-grid">
        <section className="settings-panel business-settings">
          <div className="settings-section-header">
            <Icon name="settings" />
            <div>
              <h2>Biznesi</h2>
              <p>Informacioni i biznesit në këtë pajisje.</p>
            </div>
          </div>
          <BusinessName settings={data} onNameChanged={onNameChanged} />
        </section>
        <ReceiptSettingsPanel />
        <DataProtectionPanel />
      </div>
    </div>
  );
}
