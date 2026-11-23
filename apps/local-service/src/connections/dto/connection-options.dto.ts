import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class SshTunnelDto {
  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((dto: SshTunnelDto) => dto.enabled)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @ValidateIf((dto: SshTunnelDto) => dto.enabled)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  username!: string;

  @IsIn(['password', 'privateKey'])
  authMethod!: 'password' | 'privateKey';

  @ValidateIf((dto: SshTunnelDto) => dto.enabled && dto.authMethod === 'privateKey')
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  privateKeyPath?: string;
}

export class ConnectionOptionsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SshTunnelDto)
  ssh?: SshTunnelDto;
}
