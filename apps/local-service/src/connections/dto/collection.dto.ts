import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export class CreateCollectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  /** null: varsayılan renk. */
  @IsOptional()
  @Matches(COLOR_PATTERN, { message: 'color must be a #rrggbb value' })
  color?: string | null;
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(COLOR_PATTERN, { message: 'color must be a #rrggbb value' })
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
