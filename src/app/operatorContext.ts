import { createContext } from 'react';
import type { OperatorSession } from '../domain/operators';
export const openSession: OperatorSession = { required: false, configured: true, operator: null };
export const OperatorContext = createContext(openSession);
