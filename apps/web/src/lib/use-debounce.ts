import { useEffect, useState } from 'react';

/**
 * Hook trì hoãn giá trị (debounce) cho ô tìm kiếm và bộ lọc,
 * tránh gọi API liên tục trên từng ký tự gõ phím.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
