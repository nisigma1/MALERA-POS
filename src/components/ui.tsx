import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { STOCK_LABELS, type StockState } from '../domain/configuration';
export type IconName = 'tables' | 'inventory' | 'reports' | 'settings' | 'search' | 'plus' | 'minus' | 'trash' | 'edit' | 'close' | 'box' | 'check';
const paths: Record<IconName, ReactNode> = {
  minus: <path d="M5 12h14"/>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  tables: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  inventory: <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8m-4.5-15.5 9 5"/></>,
  reports: <><path d="M4 3v18h17M8 16v-5m5 5V6m5 10v-8"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, edit: <><path d="m15 4 5 5-11 11-6 1 1-6L15 4Z"/><path d="m13 6 5 5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>, box: <><path d="M4 8h16v12H4V8Zm-1-4h18v4H3V4Z"/><path d="M9 12h6"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
};
export function Icon({ name }: { name: IconName }) { return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button type="button" {...props} className={`button button-${variant} ${className}`} />;
}
export function PageHeader({ title, helper, actions }: { title: string; helper: string; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{helper}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{children}</span>;
}
export function StockBadge({ state }: { state: StockState }) {
  return <StatusBadge tone={state === 'OUT' ? 'danger' : state === 'LOW' ? 'warning' : state === 'IN_STOCK' ? 'success' : 'neutral'}>{STOCK_LABELS[state]}</StatusBadge>;
}
export function EmptyState({ title, helper, icon = 'box' }: { title: string; helper: string; icon?: IconName }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon}/></span><h2>{title}</h2><p>{helper}</p></div>;
}
export function Field({ id, label, error, helper, children }: { id: string; label: string; error?: string; helper?: string; children: ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{error ? <p id={`${id}-error`} className="field-error">{error}</p> : helper && <p className="field-helper">{helper}</p>}</div>;
}
export function useFieldErrorFocus(errors: Record<string, string>, busy: boolean, formId: string) {
  const previousCount = useRef(0);
  useEffect(() => {
    const count = Object.keys(errors).length;
    // Clearing a field error while typing must not move focus to another field.
    if (!busy && count > 0 && count >= previousCount.current) document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    previousCount.current = count;
  }, [errors, busy, formId]);
}
export function SidePanel({ title, subtitle, children, footer, busy, onClose, eyebrow='INVENTARI' }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode; busy: boolean; onClose: () => void; eyebrow?:string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => { dialog?.close(); opener?.focus(); };
  }, []);
  return <dialog className="side-panel" ref={ref} aria-labelledby="panel-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="panel-header"><div><span className="eyebrow">{eyebrow}</span><h2 id="panel-title">{title}</h2><p>{subtitle}</p></div>
      <Button variant="ghost" className="icon-button" aria-label="Mbyll panelin" disabled={busy} onClick={onClose}><Icon name="close"/></Button></div>
    <div className="panel-body">{children}</div><footer className="panel-footer">{footer}</footer>
  </dialog>;
}
