/**
 * Payment Execute API Route
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest, { params }: { params: { paymentId: string } }) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Missing NEXT_PUBLIC_API_URL' },
      { status: 503, headers: corsHeaders }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400, headers: corsHeaders }
    );
  }

  const resp = await fetch(
    `${backend}/api/v1/payments/${encodeURIComponent(params.paymentId)}/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const payload = await resp.json().catch(() => ({ success: false, error: 'Bad response' }));
  return NextResponse.json(payload, { status: resp.status, headers: corsHeaders });
}
