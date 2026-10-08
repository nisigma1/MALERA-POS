import { Button } from './ui';
export function DataState({ error, retry }: { error: boolean; retry: () => void }) {
  return error ? <div className="notice error-state" role="alert"><div><strong>Nuk u arrit të ngarkohen të dhënat.</strong><p>Provo përsëri për të lexuar të dhënat lokale.</p></div><Button onClick={retry}>Provo përsëri</Button></div>
    : <p role="status">Duke ngarkuar të dhënat…</p>;
}
