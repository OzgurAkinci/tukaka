import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class SetCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}