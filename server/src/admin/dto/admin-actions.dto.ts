import { IsBoolean, IsIn } from 'class-validator';

export class SetRoleDto {
  @IsIn(['USER', 'ADMIN'])
  role!: string;
}

export class SetDisabledDto {
  @IsBoolean()
  disabled!: boolean;
}
