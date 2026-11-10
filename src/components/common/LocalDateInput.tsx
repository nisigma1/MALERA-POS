import type { InputHTMLAttributes } from 'react';
import { localInputDisplay, localInputValue } from '../../domain/operatorInput';

export function LocalDateInput({
  value,
  onChange,
  withTime = true,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
}) {
  return (
    <input
      {...props}
      type="text"
      inputMode="text"
      autoComplete="off"
      placeholder={withTime ? 'DD.MM.YYYY HH:mm' : 'DD.MM.YYYY'}
      value={localInputDisplay(value)}
      onChange={(e) => onChange(localInputValue(e.target.value, withTime))}
    />
  );
}
