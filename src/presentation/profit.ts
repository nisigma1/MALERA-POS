import { formatMoney } from '../domain/money';

export function profitPresentation(cents: number | null, missingUnits: number, missingLosses: number) {
  return {
    value: cents === null ? 'Nuk llogaritet' : formatMoney(cents),
    reason: cents !== null ? null : `Fitimi s’mund të llogaritet. ${[missingUnits > 0 ? `${missingUnits} copë të shitura s’kanë kosto.` : '', missingLosses > 0 ? `${missingLosses} humbje s’kanë kosto.` : ''].filter(Boolean).join(' ') || 'Mungojnë kostot.'}`,
  };
}
