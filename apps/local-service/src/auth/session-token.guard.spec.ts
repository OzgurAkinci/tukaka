import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SESSION_TOKEN_ENV, SessionTokenGuard } from './session-token.guard';

function contextFor(authorization?: string, isPublic = false) {
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;

  return { reflector, context };
}

describe('SessionTokenGuard', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  describe('with a token configured', () => {
    beforeEach(() => {
      process.env[SESSION_TOKEN_ENV] = 'abc123';
    });

    it('accepts the correct bearer token', () => {
      const { reflector, context } = contextFor('Bearer abc123');
      expect(new SessionTokenGuard(reflector).canActivate(context)).toBe(true);
    });

    it.each([undefined, 'Bearer wrong', 'Bearer abc1234', 'Basic abc123'])(
      'rejects %p',
      (header) => {
        const { reflector, context } = contextFor(header);
        expect(() => new SessionTokenGuard(reflector).canActivate(context)).toThrow(
          UnauthorizedException,
        );
      },
    );

    it('allows public routes without a token', () => {
      const { reflector, context } = contextFor(undefined, true);
      expect(new SessionTokenGuard(reflector).canActivate(context)).toBe(true);
    });
  });

  it('is disabled without a token outside production', () => {
    delete process.env[SESSION_TOKEN_ENV];
    process.env.NODE_ENV = 'development';

    const { reflector, context } = contextFor(undefined);
    expect(new SessionTokenGuard(reflector).canActivate(context)).toBe(true);
  });

  it('refuses to start without a token in production', () => {
    delete process.env[SESSION_TOKEN_ENV];
    process.env.NODE_ENV = 'production';

    const { reflector } = contextFor(undefined);
    expect(() => new SessionTokenGuard(reflector)).toThrow(SESSION_TOKEN_ENV);
  });
});
