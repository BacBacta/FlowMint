/**
 * Payment Create Link API Route
 *
 * Creates a payment link. Requires backend.
 */

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
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

  const resp = await fetch(`${backend}/api/v1/payments/create-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await resp.json().catch(() => ({ success: false, error: 'Bad response' }));
  if (!resp.ok || !payload?.success) {
    return NextResponse.json(payload, { status: resp.status || 502, headers: corsHeaders });
  }

  const data = payload.data;
  const paymentUrl = `${request.nextUrl.origin}/payments?tab=pay&paymentId=${encodeURIComponent(
    data.paymentId
  )}`;

  // Generate QR code as data URL
  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(paymentUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    // QR generation failed, leave empty
  }

  return NextResponse.json(
    {
      success: true,
      paymentId: data.paymentId,
      paymentUrl,
      qrCode: qrCodeDataUrl,
      expiresAt: new Date(data.expiresAt).toISOString(),
      // Include message if an existing link was returned (duplicate orderId)
      ...(data.message && { message: data.message }),
    },
    { headers: corsHeaders }
  );
}
