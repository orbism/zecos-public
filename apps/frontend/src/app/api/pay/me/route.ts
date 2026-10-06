import { NextRequest } from 'next/server';
import { fwd } from '../../_fwd';

/** Pay Me: the caller's own page (verified accounts). */
export const GET = (req: NextRequest) => fwd(req, '/api/pay/me');
export const PUT = (req: NextRequest) => fwd(req, '/api/pay/me');
