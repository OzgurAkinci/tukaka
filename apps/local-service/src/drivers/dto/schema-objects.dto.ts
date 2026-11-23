import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RowChangeDto {
  @IsIn(['insert', 'update', 'delete'])
  type!: 'insert' | 'update' | 'delete';

  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  key?: Record<string, unknown>;
}

export class ApplyChangesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RowChangeDto)
  changes!: RowChangeDto[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class ExplainDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  sql!: string;
}

export class RoutineDefinitionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsIn(['function', 'procedure'])
  type!: 'function' | 'procedure';
}
