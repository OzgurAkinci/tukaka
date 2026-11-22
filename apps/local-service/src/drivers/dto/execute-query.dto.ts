import {
  IsArray,
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class ExecuteQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  sql: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  parameters?: unknown[];
}