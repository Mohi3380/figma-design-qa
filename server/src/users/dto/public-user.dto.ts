import { Expose, Transform } from 'class-transformer';

/**
 * The ONLY shape of a user that may reach a client. Built with
 * `plainToInstance(…, { excludeExtraneousValues: true })`, so it is a strict
 * whitelist: anything not `@Expose()`d here is dropped. Adding a sensitive
 * column to the User model (passwordHash, googleId, a future mfaSecret, …)
 * therefore cannot accidentally leak through this projection — it simply won't
 * appear unless someone deliberately exposes it.
 */
export class PublicUserDto {
  @Expose() id!: string;
  @Expose() email!: string;
  @Expose() name!: string | null;
  @Expose() emailVerified!: boolean;
  @Expose() avatarUrl!: string | null;
  @Expose() role!: string;
  // Derived: whether a local password is set — never the hash itself.
  @Expose()
  @Transform(({ obj }) => Boolean((obj as { passwordHash?: string | null }).passwordHash))
  hasPassword!: boolean;
  @Expose() createdAt!: Date;
}
