// Temporary integration fixture for PR #15; never merge this test branch.
// This file is not wired into package scripts, exports, or production paths.
import { timingSafeEqual } from 'node:crypto';

export function equalTokens(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
