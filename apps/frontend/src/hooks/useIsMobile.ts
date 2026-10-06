'use client';

import { useEffect, useState } from 'react';

// True on small / touch viewports. SSR-safe (false until mounted).
export function useIsMobile(breakpoint = 640): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const on = () => setMobile(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [breakpoint]);
  return mobile;
}
