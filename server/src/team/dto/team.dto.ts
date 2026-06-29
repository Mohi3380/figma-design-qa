import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// URLs are validated as plain strings (not @IsUrl) so admins can clear a link
// by sending "" and paste relative/mailto values without tripping URL rules.
export class CreateTeamMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  xUrl?: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// All fields optional on update (partial edit). Re-declared rather than using
// PartialType to avoid pulling in @nestjs/mapped-types just for this.
export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  xUrl?: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class ReorderTeamDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
