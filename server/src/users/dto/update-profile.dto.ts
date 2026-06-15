import { IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @Length(1, 80, { message: 'Name must be 1–80 characters.' })
  name!: string;
}
