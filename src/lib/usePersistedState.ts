import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useState that survives page refresh (localStorage). The stored value is removed when it equals
 * the default, so "Clear filters" leaves nothing behind. `override` (e.g. a URL parameter) wins
 * on first render when provided.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  override?: T | null
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const defaultRef = useRef(defaultValue);
  const [value, setValue] = useState<T>(() => {
    if (override !== undefined && override !== null && (override as unknown) !== '') return override;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // storage unavailable: fall through to the default
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      if (JSON.stringify(value) === JSON.stringify(defaultRef.current)) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      // ignore (private mode / quota)
    }
  }, [key, value]);

  const set = useCallback<React.Dispatch<React.SetStateAction<T>>>((next) => setValue(next), []);
  return [value, set];
}
