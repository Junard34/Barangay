import { useEffect, useRef } from 'react';

export function useComplaintStatusSync(refreshStatuses, enabled = true) {
  const refreshRef = useRef(refreshStatuses);

  useEffect(() => {
    refreshRef.current = refreshStatuses;
  }, [refreshStatuses]);

  useEffect(() => {
    if (!enabled) return undefined;

    let isRefreshing = false;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || isRefreshing) return;
      isRefreshing = true;
      Promise.resolve()
        .then(() => refreshRef.current())
        .catch((error) => console.error('Failed to synchronize complaint statuses:', error))
        .finally(() => {
          isRefreshing = false;
        });
    };

    const intervalId = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);
}
