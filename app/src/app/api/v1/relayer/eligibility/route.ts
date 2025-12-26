/**
 * Relayer Eligibility API Route (Proxy)
 *
 * Proxies requests to backend /api/v1/relayer/eligibility
 * to check if a user is eligible for relayed transactions.
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

export async function GET(request: NextRequest) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { error: 'Missing NEXT_PUBLIC_API_URL' },
      { status: 503, headers: corsHeaders }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();

  try {
    const url = queryString
      ? `${backend}/api/v1/relayer/eligibility?${queryString}`
      : `${backend}/api/v1/relayer/eligibility`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const payload = await resp.json().catch(() => ({ error: 'Invalid backend response' }));

    return NextResponse.json(payload, {
      status: resp.status,
      headers: corsHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to check eligibility: ${message}` },
      { status: 502, headers: corsHeaders }
    );
  }
}
