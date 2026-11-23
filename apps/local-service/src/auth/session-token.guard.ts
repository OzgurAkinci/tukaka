
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from './public.decorator';

export const SESSION_TOKEN_ENV = 'TUKAKA_SESSION_TOKEN';

/**
 * Local service'e yalnızca uygulamanın kendisinin erişmesini sağlar.
 *
 * Electron her açılışta rastgele bir token üretir, servisi bu token ile
 * başlatır ve aynı token'ı preload üzerinden arayüze verir. Arayüz her
 * isteği `Authorization: Bearer <token>` başlığıyla gönderir.
 *
 * Token tanımlı değilse (yalnızca geliştirme ortamında) doğrulama kapalıdır.
 */
@Injectable()
export class SessionTokenGuard implements CanActivate {
  private readonly logger = new Logger(SessionTokenGuard.name);

  private readonly expectedToken: Buffer | null;

  constructor(private readonly reflector: Reflector) {
    const token = process.env[SESSION_TOKEN_ENV]?.trim();

    if (token) {
      this.expectedToken = Buffer.from(token, 'utf8');
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `${SESSION_TOKEN_ENV} must be set when running in production.`,
      );
    }

    this.expectedToken = null;
    this.logger.warn(
      `${SESSION_TOKEN_ENV} is not set; request authentication is DISABLED (development only).`,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expectedToken) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing session token.');
    }

    const provided = Buffer.from(token, 'utf8');

    if (
      provided.length !== this.expectedToken.length ||
      !timingSafeEqual(provided, this.expectedToken)
    ) {
      throw new UnauthorizedException('Invalid session token.');
    }

    return true;
  }
}
