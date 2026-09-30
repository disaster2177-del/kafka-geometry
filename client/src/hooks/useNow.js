import { useEffect, useState } from 'react';

/** Re-render every `intervalMs` with the current time (for ages / stale flags). */
export default function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
