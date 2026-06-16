import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetFigmaPatDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  token!: string;
}

export class SetAnthropicKeyDto {
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  key!: string;
}
