import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Query params for GET /api/qa/run (EventSource). Booleans arrive as strings. */
export class RunQaDto {
  @IsString()
  @IsNotEmpty()
  figma!: string;

  @IsString()
  @IsNotEmpty()
  target!: string;

  @IsOptional()
  @IsString()
  vision?: string;

  @IsOptional()
  @IsString()
  pdf?: string;

  @IsOptional()
  @IsString()
  viewport?: string;
}

export interface RunInput {
  figma: string;
  target: string;
  vision: boolean;
  pdf: boolean;
  viewport?: number;
}
