
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
} from 'class-validator';

export type ConnectionType = 'postgresql' | 'mysql' | 'sqlite';

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

  @IsIn(['postgresql', 'mysql', 'sqlite'])
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
}
