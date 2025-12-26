/**
 * User Intent API Route
 *
 * Returns intents for a specific user.
 */

import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(_request: NextRequest, { params }: { params: { intentId: string } }) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const resp = await fetch(`${backend}/api/v1/intents/${encodeURIComponent(params.intentId)}`);
    const payload = await resp.json().catch(() => ({ success: false, error: 'Invalid backend response' }));
    return NextResponse.json(payload, { status: resp.status, headers: corsHeaders });
  } catch (error) {
    console.error('Intent GET proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { intentId: string } }
) {
  const backend = process.env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    return NextResponse.json(
      { success: false, error: 'Backend server not configured. Set NEXT_PUBLIC_API_URL.' },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const resp = await fetch(`${backend}/api/v1/intents/${encodeURIComponent(params.intentId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await resp.json().catch(() => ({ success: false, error: 'Invalid backend response' }));
    return NextResponse.json(payload, { status: resp.status, headers: corsHeaders });
  } catch (error) {
    console.error('Intent DELETE proxy error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Proxy error' },
      { status: 502, headers: corsHeaders }
    );
  }
}
