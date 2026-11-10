import { useRef, useState } from 'react';
import { OPERATORS, type OperatorId, type OperatorSession } from '../../domain/operators';
import { Button } from '../common/Controls';
import { MaleraMark } from './MaleraMark';

export function OperatorLogin({
  configured,
  onLogin,
}: {
  configured: boolean;
  onLogin: (session: OperatorSession) => void;
}) {
  const [id, setId] = useState<OperatorId | ''>('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return (
    <main className="workspace operator-login">
      <form
        className="settings-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!id || pending.current || !/^\d{4}$/.test(pin)) return;
          pending.current = true;
          setBusy(true);
          setMessage('');
          const entered = pin;
          setPin('');
          try {
            onLogin(await window.fox.operators.login({ id, pin: entered }));
          } catch (error) {
            const text = error instanceof Error ? error.message : '';
            setMessage(
              text.includes('Prit një minutë')
                ? 'Prit një minutë para provës tjetër.'
                : 'Hyrja nuk u pranua. Kontrollo përdoruesin dhe PIN-in.',
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <MaleraMark />
        <h1>Hyrja në DUO</h1>
        {configured ? (
          <>
            <label>
              Përdoruesi
              <select
                value={id}
                onChange={(event) => {
                  setId(event.target.value as OperatorId);
                  setPin('');
                }}
                disabled={busy}
              >
                <option value="">Zgjidh përdoruesin</option>
                {Object.entries(OPERATORS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                disabled={busy}
              />
            </label>
            {message && (
              <p role="alert" className="form-error">
                {message}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy || !id || pin.length !== 4}>
              Hyr
            </Button>
          </>
        ) : (
          <p role="alert">Pronari duhet t’i konfigurojë PIN-et në HP përpara hyrjes.</p>
        )}
      </form>
    </main>
  );
}
