import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateSavedQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  sql!: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  connectionId?: string | null;
}

export class UpdateSavedQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  sql?: string;

  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  connectionId?: string | null;
}
