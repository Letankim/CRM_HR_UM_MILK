import { useEffect, useState } from 'react';

/**
 * Custom hook Debounce giá trị đầu vào (mặc định 400ms) chuẩn hệ thống.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
