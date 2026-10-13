import { LocalDateInput } from './LocalDateInput';
import { amountError, parseLocalInput } from '../domain/operatorInput';
import {useRef,useState} from 'react';
import {EXPENSE_CATEGORIES,localDateTime,type ExpenseRecord,type ExpenseCategory} from '../domain/finance';
import {parseEuro,formatMoney} from '../domain/money';
import {Button,Field,SidePanel,useFieldErrorFocus} from './ui';
export function ExpensePanel({expense,onClose,onSaved}:{expense?:ExpenseRecord;onClose:()=>void;onSaved:()=>void}) {
 const [amount,setAmount]=useState(expense?(expense.amountCents/100).toFixed(2):''),[category,setCategory]=useState<ExpenseCategory>(expense?.category??'OTHER'),[date,setDate]=useState(localDateTime(expense?new Date(expense.occurredAt):new Date())),[description,setDescription]=useState(expense?.description??''),[note,setNote]=useState(expense?.note??''),[cash,setCash]=useState(expense?.paidFromTill??false),[errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[requestId]=useState(()=>crypto.randomUUID());const submitting=useRef(false);
 useFieldErrorFocus(errors,busy,'expense-form');
 async function save(e:React.FormEvent){e.preventDefault();if(submitting.current)return;const invalidAmount=amountError(amount);if(invalidAmount){setErrors({amount:invalidAmount});return;}const cents=parseEuro(amount)!;const occurred=parseLocalInput(date);if(!occurred){setErrors({date:'Vendos datën dhe orën.'});return;}submitting.current=true;setBusy(true);setErrors({});try{const r=await window.fox.finance.saveExpense({requestId,amountCents:cents,category,occurredAt:occurred.toISOString(),description,note,paidFromTill:cash,...(expense?{expenseId:expense.id,expectedRevision:expense.revisionId}:{})});if(r.ok)onSaved();else setErrors(r.errors);}catch{setErrors({form:'Shpenzimi nuk u konfirmua. Provo përsëri me të njëjtat të dhëna.'});}finally{submitting.current=false;setBusy(false);}}
 return <SidePanel eyebrow="" title={expense?'Korrigjo shpenzimin':'Shto shpenzim'} subtitle={expense?'Vlera e mëparshme ruhet në histori.':'Qira, paga dhe shpenzime të tjera.'} busy={busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>Anulo</Button><Button variant="primary" type="submit" form="expense-form" disabled={busy}>{busy?'Duke ruajtur…':'Ruaj shpenzimin'}</Button></>}>
 <form id="expense-form" onSubmit={save} noValidate>{errors.form&&<p role="alert" className="form-error">{errors.form}</p>}<fieldset disabled={busy}>
 {expense&&<p className="notice">Vlera e mëparshme: {formatMoney(expense.amountCents)}</p>}
 <Field id="expense-amount" label="Shuma (€)" error={errors.amount}><input id="expense-amount" data-initial-focus inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} aria-invalid={!!errors.amount}/></Field>
 <Field id="expense-category" label="Kategoria"><select id="expense-category" value={category} onChange={e=>setCategory(e.target.value as ExpenseCategory)}>{Object.entries(EXPENSE_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
 <Field id="expense-date" label="Data dhe ora" error={errors.date}><LocalDateInput id="expense-date" value={date} onChange={setDate} aria-invalid={!!errors.date}/></Field>
 <Field id="expense-description" label="Për çka? (opsional)"><input id="expense-description" value={description} maxLength={500} onChange={e=>setDescription(e.target.value)}/></Field>
 <Field id="expense-note" label="Shënim (opsional)"><input id="expense-note" value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></Field>
 <Field id="expense-source" label="U pagua nga"><select id="expense-source" value={cash?'DRAWER':'OTHER'} onChange={e=>setCash(e.target.value==='DRAWER')}><option value="OTHER">Jashtë arkës</option><option value="DRAWER">Arka</option></select></Field><p className="field-helper">Arka: i ul paratë në arkë. Jashtë arkës: nuk e ndryshon arkën.</p><p className="notice">Blerja e mallit regjistrohet te Stoku → Shto stok, jo si shpenzim.</p>
 </fieldset></form></SidePanel>;
}
