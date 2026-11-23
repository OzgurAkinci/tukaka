
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { ConnectionOptionsDto } from './connection-options.dto';

import type { SslMode } from './create-connection.dto';

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  database?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  username?: string;

  @IsOptional()
  @IsIn([
    'disable',
    'prefer',
    'require',
    'verify-ca',
    'verify-full',
  ])
  sslMode?: SslMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConnectionOptionsDto)
  options?: ConnectionOptionsDto;
}
