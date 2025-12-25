import { createHash } from 'crypto';

export function computeMerkleRootSorted(hashes: string[]): string {
  if (hashes.length === 0) {
    return createHash('sha256').update('empty').digest('hex');
  }

  if (hashes.length === 1) {
    return hashes[0];
  }

  let level = [...hashes];

  while (level.length > 1) {
    const next: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? a; // duplicate if odd
      const left = a < b ? a : b;
      const right = a < b ? b : a;
      next.push(
        createHash('sha256')
          .update(left + right)
          .digest('hex')
      );
    }

    level = next;
  }

  return level[0];
}

export function computeMerkleProofSorted(hashes: string[], leafIndex: number): string[] {
  if (leafIndex < 0 || leafIndex >= hashes.length) {
    throw new Error('leafIndex out of bounds');
  }

  const proof: string[] = [];
  let index = leafIndex;
  let level = [...hashes];

  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (siblingIndex < level.length) {
      proof.push(level[siblingIndex]);
    } else {
      // Odd node duplicated: sibling is itself
      proof.push(level[index]);
    }

    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? a;
      const left = a < b ? a : b;
      const right = a < b ? b : a;
      next.push(
        createHash('sha256')
          .update(left + right)
          .digest('hex')
      );
    }

    level = next;
    index = Math.floor(index / 2);
  }

  return proof;
}

export function verifyMerkleProofSorted(leafHash: string, proof: string[], root: string): boolean {
  let currentHash = leafHash;

  for (const siblingHash of proof) {
    const left = currentHash < siblingHash ? currentHash : siblingHash;
    const right = currentHash < siblingHash ? siblingHash : currentHash;
    currentHash = createHash('sha256')
      .update(left + right)
      .digest('hex');
  }

  return currentHash === root;
}
