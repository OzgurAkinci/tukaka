
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'tukaka:isPublic';

/**
 * Oturum token'ı gerektirmeyen uç noktaları işaretler (ör. /health).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
