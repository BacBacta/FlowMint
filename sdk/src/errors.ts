/**
 * FlowMint SDK Errors
 */

export class FlowMintError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode?: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FlowMintError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NetworkError extends FlowMintError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'NetworkError';
  }
}

export class ApiError extends FlowMintError {
  constructor(message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message, 'API_ERROR', statusCode, details);
    this.name = 'ApiError';
  }
}

export class QuoteError extends FlowMintError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'QUOTE_ERROR', undefined, details);
    this.name = 'QuoteError';
  }
}

export class SwapError extends FlowMintError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SWAP_ERROR', undefined, details);
    this.name = 'SwapError';
  }
}

export class SlippageError extends SwapError {
  constructor(expected: number, actual: number) {
    super(`Slippage exceeded: expected ${expected} bps, got ${actual} bps`, {
      expected,
      actual,
    });
    this.name = 'SlippageError';
  }
}

export class PriceImpactError extends SwapError {
  constructor(priceImpact: number, maxAllowed: number) {
    super(`Price impact too high: ${priceImpact}% (max: ${maxAllowed}%)`, {
      priceImpact,
      maxAllowed,
    });
    this.name = 'PriceImpactError';
  }
}

export class IntentError extends FlowMintError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INTENT_ERROR', undefined, details);
    this.name = 'IntentError';
  }
}

export class PaymentError extends FlowMintError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PAYMENT_ERROR', undefined, details);
    this.name = 'PaymentError';
  }
}

export class ValidationError extends FlowMintError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400, { field });
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends FlowMintError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends FlowMintError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter} seconds` : ''}`,
      'RATE_LIMIT_ERROR',
      429,
      { retryAfter },
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}
