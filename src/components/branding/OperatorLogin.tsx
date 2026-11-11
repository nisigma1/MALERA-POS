import { useRef, useState } from 'react';
import { OPERATORS, type OperatorId, type OperatorSession } from '../../domain/operators';
import { Button } from '../common/Controls';
import duoBarMark from '../../assets/duo-bar-mark.png';

const accounts = Object.entries(OPERATORS) as [OperatorId, string][];

function PinField({ name, label, disabled }: { name: string; label: string; disabled: boolean }) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4}"
        title="Katër shifra"
        maxLength={4}
        required
        disabled={disabled}
      />
    </label>
  );
}

export function OperatorLogin({
  session,
  onSession,
}: {
  session: OperatorSession;
  onSession: (session: OperatorSession) => void;
}) {
  const [id, setId] = useState<OperatorId | ''>('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const settingUp = session.setupPending && id === 'OWNER';
  const signingIn = session.configured && id !== '';
  return (
    <main className="workspace operator-login">
      <form
        className="settings-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if ((!settingUp && !signingIn) || pending.current || !id) return;
          const form = event.currentTarget;
          const fields = new FormData(form);
          const pins = {
            OWNER: String(fields.get('OWNER') ?? ''),
            AM: String(fields.get('AM') ?? ''),
            PM: String(fields.get('PM') ?? ''),
          };
          if (settingUp && (pins.OWNER === pins.AM || pins.OWNER === pins.PM)) {
            setMessage('PIN-i i pronarit duhet të jetë i ndryshëm nga PIN-et e punonjësve.');
            return;
          }
          pending.current = true;
          setBusy(true);
          setMessage('');
          form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
            input.value = '';
          });
          try {
            if (settingUp) {
              onSession(await window.fox.operators.enroll(pins));
              setId('');
              setMessage('PIN-et u ruajtën. Zgjidh llogarinë për të hyrë.');
            } else {
              onSession(
                await window.fox.operators.login({ id, pin: String(fields.get('pin') ?? '') }),
              );
            }
          } catch (error) {
            const text = error instanceof Error ? error.message : '';
            setMessage(
              settingUp
                ? 'PIN-et nuk u ruajtën. Provo përsëri ose rihape aplikacionin.'
                : text.includes('Prit një minutë')
                  ? 'Prit një minutë para provës tjetër.'
                  : 'Hyrja nuk u pranua. Kontrollo përdoruesin dhe PIN-in.',
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <img className="operator-duo-mark" src={duoBarMark} alt="DUO BAR" />
        <h1>Hyrja në DUO</h1>
        {(session.configured || session.setupPending) && (
          <label>
            Përdoruesi
            <select
              value={id}
              onChange={(event) => {
                setId(event.target.value as OperatorId | '');
                setMessage('');
              }}
              disabled={busy}
            >
              <option value="">Zgjidh përdoruesin</option>
              {accounts.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {settingUp && (
          <>
            <p>Cakto PIN-et për herën e parë. Secili PIN duhet të ketë katër shifra.</p>
            {accounts.map(([key, label]) => (
              <PinField key={key} name={key} label={'PIN · ' + label} disabled={busy} />
            ))}
          </>
        )}
        {session.setupPending && !settingUp && (
          <p>Zgjidh PRONARI DUO për të caktuar PIN-et herën e parë.</p>
        )}
        {!session.configured && !session.setupPending && (
          <p role="alert">PIN-et e këtij terminali nuk mund të lexohen.</p>
        )}
        {signingIn && <PinField key={id} name="pin" label="PIN" disabled={busy} />}
        {message && <p role="status">{message}</p>}
        {(settingUp || signingIn) && (
          <Button type="submit" variant="primary" disabled={busy}>
            {settingUp ? 'Ruaj PIN-et' : 'Hyr'}
          </Button>
        )}
      </form>
    </main>
  );
}
