import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import type {
  FilterOperator,
  SortDirection,
} from '@tukaka/contracts';

export const FILTER_OPERATORS: FilterOperator[] = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'isNull',
  'isNotNull',
];

export class TableFilterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  column!: string;

  @IsIn(FILTER_OPERATORS)
  operator!: FilterOperator;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  value?: string;
}

export class TableSortDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  column!: string;

  @IsIn(['asc', 'desc'])
  direction!: SortDirection;
}

export class TableDataDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TableSortDto)
  sort?: TableSortDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TableFilterDto)
  filters?: TableFilterDto[];

  @IsOptional()
  @IsBoolean()
  includeTotal?: boolean;
}
