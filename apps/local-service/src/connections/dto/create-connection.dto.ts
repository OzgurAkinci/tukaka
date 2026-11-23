
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { DatabaseType } from '@tukaka/contracts';

import { ConnectionOptionsDto } from './connection-options.dto';

export type ConnectionType = DatabaseType;

export const CONNECTION_TYPES: ConnectionType[] = [
  'postgresql',
  'mysql',
  'mariadb',
  'sqlite',
  'mssql',
  'clickhouse',
];

export type SslMode =
  | 'disable'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full';

export class CreateConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsIn(CONNECTION_TYPES)
  type!: ConnectionType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  database!: string;

  @ValidateIf((dto: CreateConnectionDto) => dto.type !== 'sqlite')
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host?: string;

  @ValidateIf((dto: CreateConnectionDto) => dto.type !== 'sqlite')
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ValidateIf((dto: CreateConnectionDto) => dto.type !== 'sqlite')
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
