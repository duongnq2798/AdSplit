import { NextRequest } from 'next/server';
import { POST as attestationPost } from '../attestation/route';

export async function POST(req: NextRequest) {
  return attestationPost(req);
}
