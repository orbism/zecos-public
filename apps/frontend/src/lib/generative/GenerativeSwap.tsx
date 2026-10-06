/* Public build: the generative layer is not part of this distribution, so it is always off. */
import type { ReactNode } from 'react';
export function GenerativeSwap({ children }: { children?: ReactNode; fmt?: (v: number) => string; [k: string]: unknown }) { return <>{children ?? null}</>; }
export default GenerativeSwap;
