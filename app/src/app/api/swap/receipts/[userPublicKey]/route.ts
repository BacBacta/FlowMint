/**
 * Swap Receipts API Route
 *
 * Returns swap receipts for a user. Requires backend database.
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
  { params }: { params: { userPublicKey: string } }
) {
  const userPublicKey = params.userPublicKey;

  // TODO: Implement database query for receipts
  // For now, return empty array
  return NextResponse.json([], { headers: corsHeaders });
}
