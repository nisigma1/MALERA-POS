import { LocalDateInput } from '../common/LocalDateInput';
import { parseLocalInput } from '../../domain/operatorInput';
import { useRef, useState, type FormEvent } from 'react';
import type { ReserveTableInput } from '../../domain/reservations';
import { Button, Field, SidePanel } from '../common/Controls';

export function ReservationDialog({
  tableId,
  tableCode,
  onClose,
  onSave,
}: {
  tableId: string;
  tableCode: string;
  onClose: () => void;
  onSave: (input: ReserveTableInput) => Promise<string | null>;
}) {
  const initial = new Date(Date.now() + 30 * 60_000);
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [guests, setGuests] = useState('2'),
    [note, setNote] = useState('');
  const [when, setWhen] = useState(() =>
    new Date(initial.getTime() - initial.getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  const lastRequest = useRef<string | undefined>(undefined);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const date = parseLocalInput(when);
    if (!date || date.getTime() < Date.now()) {
      setError('Vendos një datë dhe orë në të ardhmen.');
      return;
    }
    const values = {
      tableId,
      customerName: name.trim(),
      phone: phone.trim(),
      startsAt: date.toISOString(),
      guests: Number(guests),
      note: note.trim(),
    };
    const signature = JSON.stringify(values);
    if (lastRequest.current && lastRequest.current !== signature)
      requestId.current = crypto.randomUUID();
    lastRequest.current = signature;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const message = await onSave({ requestId: requestId.current, ...values });
      if (message) setError(message);
      else onClose();
    } catch {
      setError(
        'Rezervimi nuk u konfirmua. Mbyll formularin dhe rifresko tavolinën për ta kontrolluar.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <SidePanel
      title={`Rezervo tavolinën ${tableCode}`}
      subtitle=""
      eyebrow=""
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            Anulo
          </Button>
          <Button variant="primary" type="submit" form="reservation-form" disabled={busy}>
            {busy ? 'Duke ruajtur…' : 'Ruaj rezervimin'}
          </Button>
        </>
      }
    >
      <form id="reservation-form" onSubmit={submit}>
        <Field id="reservation-name" label="Emri">
          <input
            id="reservation-name"
            autoComplete="name"
            data-initial-focus
            required
            maxLength={100}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field id="reservation-phone" label="Telefoni (opsional)">
          <input
            id="reservation-phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            value={phone}
            disabled={busy}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field id="reservation-when" label="Data dhe ora">
          <LocalDateInput
            id="reservation-when"
            required
            value={when}
            disabled={busy}
            onChange={setWhen}
          />
        </Field>
        <Field id="reservation-guests" label="Persona">
          <input
            id="reservation-guests"
            type="number"
            required
            min={1}
            max={30}
            step={1}
            value={guests}
            disabled={busy}
            onChange={(e) => setGuests(e.target.value)}
          />
        </Field>
        <Field id="reservation-note" label="Shënim (opsional)">
          <input
            id="reservation-note"
            maxLength={500}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <p className="field-helper">
          Tavolina mbahet e rezervuar derisa të shënosh mbërritjen ose ta anulosh rezervimin.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
    </SidePanel>
  );
}
