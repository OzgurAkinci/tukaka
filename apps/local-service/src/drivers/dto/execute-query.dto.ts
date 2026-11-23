import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ExecuteQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  sql!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  parameters?: unknown[];

  /**
   * Döndürülecek en fazla satır sayısı. Varsayılan: 1000.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxRows?: number;

  /**
   * Sorgu zaman aşımı (ms). Varsayılan: 30 sn. SQLite için uygulanmaz.
   */
  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(600_000)
  timeoutMs?: number;
}
