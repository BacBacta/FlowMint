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

export async function GET(
  request: NextRequest,
  { params }: { params: { intentId: string } }
) {
  // Return empty array for user intents
  return NextResponse.json([], { headers: corsHeaders });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { intentId: string } }
) {
  return NextResponse.json(
    {
      success: false,
      error: 'Intent management requires the FlowMint backend server.',
    },
    { status: 503, headers: corsHeaders }
  );
}
