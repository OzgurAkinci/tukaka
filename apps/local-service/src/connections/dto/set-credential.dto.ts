import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class SetCredentialDto {
  /** Veritabanı şifresi. */
  @ValidateIf((dto: SetCredentialDto) => dto.password !== undefined || dto.sshSecret === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password?: string;

  /** SSH şifresi ya da özel anahtar parolası. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  sshSecret?: string;
}
