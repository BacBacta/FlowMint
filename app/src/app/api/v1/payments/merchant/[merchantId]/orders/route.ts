/**
 * Merchant Orders API Route (Proxy)
 *
 * Proxies requests to backend /api/v1/payments/merchant/:merchantId/orders
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Missing NEXT_PUBLIC_API_URL' },
      { status: 503, headers: corsHeaders }
    );
  }

  const { merchantId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();

  try {
    const url = queryString
      ? `${backend}/api/v1/payments/merchant/${encodeURIComponent(merchantId)}/orders?${queryString}`
      : `${backend}/api/v1/payments/merchant/${encodeURIComponent(merchantId)}/orders`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const payload = await resp.json().catch(() => ({ success: false, error: 'Invalid backend response' }));

    return NextResponse.json(payload, {
      status: resp.status,
      headers: corsHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `Failed to fetch orders: ${message}` },
      { status: 502, headers: corsHeaders }
    );
  }
}
