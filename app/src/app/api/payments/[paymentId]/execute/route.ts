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

export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } }
) {
  return NextResponse.json(
    {
      success: false,
      error: 'Payment execution requires the FlowMint backend server.',
    },
    { status: 503, headers: corsHeaders }
  );
}
