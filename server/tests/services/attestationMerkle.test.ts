import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { DatabaseService } from '../../src/db/database';
import { AttestationService } from '../../src/services/attestationService';
import { computeMerkleProofSorted, computeMerkleRootSorted } from '../../src/services/merkle';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

describe('AttestationService Merkle proofs', () => {
  let db;
  let service;

  beforeAll(async () => {
    db = new DatabaseService(':memory:');
    await db.initialize();
    service = new AttestationService(db, 'http://localhost');
  });

  afterAll(async () => {
    await db.close();
  });

  it('verifies per-leg Merkle proof for 2 legs', async () => {
    const attestationId = randomUUID();
    const invoiceId = randomUUID();
    const policyHash = 'no_policy';

    const leafHashes = ['leafA', 'leafB'].map(x => x.padEnd(64, '0'));
    const merkleRoot = computeMerkleRootSorted(leafHashes);

    const legProofs = [0, 1].map(legIndex => ({
      legIndex,
      leafHash: leafHashes[legIndex],
      merkleProof: computeMerkleProofSorted(leafHashes, legIndex),
    }));

    await db.saveAttestation({
      id: attestationId,
      invoiceId,
      policyHash,
      payloadJson: JSON.stringify({
        version: '2.0',
        invoiceId,
        policyHash,
        timestamp: Date.now(),
        merkleRoot,
      }),
      plannedJson: '{}',
      actualJson: '{}',
      merkleRoot,
      legProofs,
      signerPubkey: 'dummy',
      signature: 'dummy',
      verificationUrl: 'http://localhost',
      createdAt: Date.now(),
    });

    const r0 = await service.verifyLegProof(attestationId, 0);
    const r1 = await service.verifyLegProof(attestationId, 1);

    expect(r0.valid).toBe(true);
    expect(r0.errors).toEqual([]);
    expect(r0.proof?.legIndex).toBe(0);

    expect(r1.valid).toBe(true);
    expect(r1.errors).toEqual([]);
    expect(r1.proof?.legIndex).toBe(1);
  });

  it('rejects tampered Merkle proof', async () => {
    const attestationId = randomUUID();
    const invoiceId = randomUUID();
    const policyHash = 'no_policy';

    const leafHashes = ['leafA', 'leafB'].map(x => x.padEnd(64, '0'));
    const merkleRoot = computeMerkleRootSorted(leafHashes);

    const goodProof = computeMerkleProofSorted(leafHashes, 0);
    const tamperedProof = goodProof.slice();
    tamperedProof[0] = tamperedProof[0].replace(/./g, 'f');

    await db.saveAttestation({
      id: attestationId,
      invoiceId,
      policyHash,
      payloadJson: JSON.stringify({
        version: '2.0',
        invoiceId,
        policyHash,
        timestamp: Date.now(),
        merkleRoot,
      }),
      plannedJson: '{}',
      actualJson: '{}',
      merkleRoot,
      legProofs: [
        {
          legIndex: 0,
          leafHash: leafHashes[0],
          merkleProof: tamperedProof,
        },
      ],
      signerPubkey: 'dummy',
      signature: 'dummy',
      verificationUrl: 'http://localhost',
      createdAt: Date.now(),
    });

    const r0 = await service.verifyLegProof(attestationId, 0);
    expect(r0.valid).toBe(false);
    expect(r0.errors.join(' ')).toMatch(/Merkle proof verification failed/);
  });
});
