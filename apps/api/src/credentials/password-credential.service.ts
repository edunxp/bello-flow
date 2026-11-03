import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { assertValidPassword } from './password-policy.js';

const ARGON2_VERSION = 0x13;
const ARGON2_MEMORY_COST_KIB = 65_536;
const ARGON2_TIME_COST = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_SALT_LENGTH_BYTES = 16;
const ARGON2_HASH_LENGTH_BYTES = 32;

const APPROVED_PHC_PATTERN =
  /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

const NEGATIVE_VERIFICATION_PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$8MKt8caHI17upM+R+IdN/w$d0z4f9hKUXod+zE4W2CHpGPomGE0tfZQUBwOvMO10C4';
const NEGATIVE_VERIFICATION_CANDIDATE = 'bello-negative-verification-work';

export type PasswordVerificationResult =
  | { readonly status: 'MATCH' }
  | { readonly status: 'NO_MATCH' }
  | { readonly status: 'INVALID_CANDIDATE' }
  | { readonly status: 'INVALID_STORED_HASH' }
  | { readonly status: 'OPERATIONAL_FAILURE' };

export type NegativePasswordVerificationResult =
  | {
      readonly status: 'COMPLETED';
      readonly candidateStatus: 'VALID' | 'INVALID';
    }
  | { readonly status: 'OPERATIONAL_FAILURE' };

function hasApprovedPhcProfile(encodedHash: string): boolean {
  const match = APPROVED_PHC_PATTERN.exec(encodedHash);
  if (!match) {
    return false;
  }

  return (
    Buffer.from(match[1], 'base64').length === ARGON2_SALT_LENGTH_BYTES &&
    Buffer.from(match[2], 'base64').length === ARGON2_HASH_LENGTH_BYTES
  );
}

@Injectable()
export class PasswordCredentialService {
  validatePassword(password: unknown): asserts password is string {
    assertValidPassword(password);
  }

  async hashPassword(password: unknown): Promise<string> {
    assertValidPassword(password);

    return hash(password, {
      type: argon2id,
      version: ARGON2_VERSION,
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
      salt: randomBytes(ARGON2_SALT_LENGTH_BYTES),
      hashLength: ARGON2_HASH_LENGTH_BYTES,
    });
  }

  async verifyPassword(
    password: unknown,
    encodedHash: unknown,
  ): Promise<PasswordVerificationResult> {
    try {
      assertValidPassword(password);
    } catch {
      return { status: 'INVALID_CANDIDATE' };
    }

    if (
      typeof encodedHash !== 'string' ||
      !hasApprovedPhcProfile(encodedHash)
    ) {
      return { status: 'INVALID_STORED_HASH' };
    }

    try {
      return (await verify(encodedHash, password))
        ? { status: 'MATCH' }
        : { status: 'NO_MATCH' };
    } catch {
      return { status: 'OPERATIONAL_FAILURE' };
    }
  }

  async performNegativeVerification(
    password: unknown,
  ): Promise<NegativePasswordVerificationResult> {
    const result = await this.verifyPassword(
      password,
      NEGATIVE_VERIFICATION_PHC,
    );
    if (result.status === 'OPERATIONAL_FAILURE') {
      return result;
    }
    if (result.status === 'INVALID_STORED_HASH') {
      return { status: 'OPERATIONAL_FAILURE' };
    }
    if (result.status !== 'INVALID_CANDIDATE') {
      return { status: 'COMPLETED', candidateStatus: 'VALID' };
    }

    const substitute = await this.verifyPassword(
      NEGATIVE_VERIFICATION_CANDIDATE,
      NEGATIVE_VERIFICATION_PHC,
    );
    if (substitute.status === 'MATCH' || substitute.status === 'NO_MATCH') {
      return { status: 'COMPLETED', candidateStatus: 'INVALID' };
    }
    return { status: 'OPERATIONAL_FAILURE' };
  }
}
