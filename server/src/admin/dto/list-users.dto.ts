import { IsIn, IsOptional, IsString } from 'class-validator';

/** Query params for GET /admin/users. Booleans/numbers arrive as strings. */
export class ListUsersDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() verified?: string; // 'true' | 'false'
  @IsOptional() @IsString() figma?: string; // 'true' | 'false'
  @IsOptional() @IsString() anthropic?: string; // 'true' | 'false'
  @IsOptional() @IsString() disabled?: string; // 'true' | 'false'
  @IsOptional() @IsIn(['USER', 'ADMIN']) role?: string;
  @IsOptional() @IsIn(['password', 'google']) authMethod?: string;
  @IsOptional() @IsIn(['createdAt', 'email', 'name', 'role', 'runs']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
