/**
 * User Intents API Route (Proxy)
 *
 * Proxies requests to backend /api/v1/intents/user/:publicKey
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(_request: NextRequest, { params }: { params: { userPublicKey: string } }) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const resp = await fetch(
      `${backend}/api/v1/intents/user/${encodeURIComponent(params.userPublicKey)}`,
      { method: 'GET' }
    );
    const payload = await resp
      .json()
      .catch(() => ({ success: false, error: 'Invalid backend response' }));
    return NextResponse.json(payload, { status: resp.status, headers: corsHeaders });
  } catch (error) {
    console.error('User intents proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}
