/**
 * Token Delegation Routes
 *
 * API endpoints for managing SPL token delegations for non-custodial DCA.
 */

import { Router, Request, Response } from 'express';

import { DatabaseService } from '../../db/database.js';
import { getTokenDelegationService } from '../../services/tokenDelegationService.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ route: 'delegation' });

/**
 * Create delegation routes with database injection
 */
export function createDelegationRoutes(db: DatabaseService): Router {
  const router = Router();
  const delegationService = getTokenDelegationService(db);

  /**
   * GET /api/v1/delegation/authority
   *
   * Get the FlowMint delegate authority public key.
   * NOTE: This route must be before /:id to avoid conflicts
   */
  router.get('/authority', async (_req: Request, res: Response) => {
    try {
      const authority = delegationService.getDelegateAuthority();
      return res.json({ authority: authority.toBase58() });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to get authority');
      return res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/delegation/create
   *
   * Create a delegation approval request.
   * Returns an unsigned transaction for the user to sign.
   */
  router.post('/create', async (req: Request, res: Response) => {
    try {
      const { userPublicKey, tokenMint, amount, intentId } = req.body;

      if (!userPublicKey || !tokenMint || !amount) {
        return res.status(400).json({
          error: 'Missing required fields: userPublicKey, tokenMint, amount',
        });
      }

      const result = await delegationService.createDelegation({
        userPublicKey,
        tokenMint,
        amount,
        intentId,
      });

      log.info({ delegationId: result.delegationId, userPublicKey }, 'Delegation created');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to create delegation');
      return res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/v1/delegation/user/:userPublicKey
   *
   * Get all delegations for a user.
   * NOTE: This route must be before /:id to avoid conflicts
   */
  router.get('/user/:userPublicKey', async (req: Request, res: Response) => {
    try {
      const { userPublicKey } = req.params;

      const delegations = await delegationService.getUserDelegations(userPublicKey);

      return res.json({ delegations, count: delegations.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to get user delegations');
      return res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/v1/delegation/:id
   *
   * Get delegation details by ID.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const delegation = await delegationService.getDelegation(id);

      if (!delegation) {
        return res.status(404).json({ error: 'Delegation not found' });
      }

      return res.json({ delegation });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to get delegation');
      return res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/delegation/:id/confirm
   *
   * Confirm a delegation after user signs and submits the approval transaction.
   */
  router.post('/:id/confirm', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { signature } = req.body;

      if (!signature) {
        return res.status(400).json({ error: 'Missing signature' });
      }

      const delegation = await delegationService.confirmDelegation(id, signature);

      log.info({ delegationId: id, signature }, 'Delegation confirmed');

      return res.json({ success: true, delegation });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { error: message, delegationId: req.params.id },
        'Failed to confirm delegation'
      );
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/delegation/:id/verify
   *
   * Verify that a delegation is valid for a given amount.
   */
  router.post('/:id/verify', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { amount } = req.body;

      if (!amount) {
        return res.status(400).json({ error: 'Missing amount' });
      }

      const delegation = await delegationService.getDelegation(id);
      if (!delegation) {
        return res.status(404).json({ error: 'Delegation not found' });
      }

      const verification = await delegationService.verifyDelegation(
        delegation.userPublicKey,
        delegation.tokenMint,
        amount
      );

      return res.json(verification);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to verify delegation');
      return res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/v1/delegation/:id/revoke
   *
   * Create a revocation transaction for a delegation.
   */
  router.post('/:id/revoke', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const result = await delegationService.createRevocation(id);

      log.info({ delegationId: id }, 'Revocation transaction created');

      return res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error(
        { error: message, delegationId: req.params.id },
        'Failed to create revocation'
      );
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/v1/delegation/:id/revoke/confirm
   *
   * Confirm revocation after user signs.
   */
  router.post('/:id/revoke/confirm', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { signature } = req.body;

      if (!signature) {
        return res.status(400).json({ error: 'Missing signature' });
      }

      await delegationService.confirmRevocation(id, signature);

      log.info({ delegationId: id }, 'Delegation revoked');

      return res.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ error: message }, 'Failed to confirm revocation');
      return res.status(400).json({ error: message });
    }
  });

  return router;
}

export default createDelegationRoutes;
