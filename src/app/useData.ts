import { useCallback, useEffect, useState } from 'react';
export function useData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    setData(undefined);
    load().then(value => { if (active) setData(value); }).catch(error => {
      console.error('FOX data loading failed', error);
      if (active) setError(true);
    });
    return () => { active = false; };
  }, [load, attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { data, error, retry, setData };
}
