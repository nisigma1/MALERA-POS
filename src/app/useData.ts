import { useCallback, useEffect, useRef, useState } from 'react';
export function useData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState({ version: 0, preserveData: false });
  const previousLoad = useRef(load);
  useEffect(() => {
    let active = true;
    setError(false);
    // Mutation refreshes retain the current view only for the same query.
    // A new loader/query must never display the previous period's data.
    if (!attempt.preserveData || previousLoad.current !== load) setData(undefined);
    previousLoad.current = load;
    load().then(value => { if (active) setData(value); }).catch(error => {
      if (!active) return;
      console.error('FOX data loading failed', error);
      if (active) { setData(undefined); setError(true); }
    });
    return () => { active = false; };
  }, [load, attempt]);
  const retry = useCallback(() => setAttempt(value => ({ version: value.version + 1, preserveData: false })), []);
  const refresh = useCallback(() => setAttempt(value => ({ version: value.version + 1, preserveData: true })), []);
  return { data, error, retry, refresh, setData };
}
