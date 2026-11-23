
import { Controller, Delete, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

import { SshTunnelService } from './ssh-tunnel.service';

class KnownHostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;
}

@Controller('ssh')
export class SshController {
  constructor(private readonly tunnels: SshTunnelService) {}

  /** Sunucu anahtarı bilerek değiştirildiyse kayıtlı anahtarı unutur. */
  @Delete('known-hosts')
  forgetHostKey(@Query() query: KnownHostDto) {
    const removed = this.tunnels.forgetHostKey(query.host, query.port);

    return {
      success: true,
      message: removed
        ? 'Saved host key removed. The new key will be trusted on next connect.'
        : 'No saved host key for this server.',
    };
  }
}
