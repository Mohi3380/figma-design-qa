import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import nodemailer, { Transporter } from 'nodemailer';

/**
 * Sends transactional email. In dev with no SMTP credentials it logs the email
 * (including the action link) to the console — so password reset / verification
 * work with zero mail-server setup. Provide SMTP_HOST/USER/PASS to send for real.
 */
@Injectable()
export class MailService {
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Mail');
    this.from = this.config.get<string>('MAIL_FROM') ?? 'Pixparity <no-reply@koderlabs.local>';

    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') ?? 587),
        secure: Number(this.config.get('SMTP_PORT') ?? 587) === 465,
        auth: { user, pass },
      });
    } else {
      this.transporter = null; // console mode
    }
  }

  private async send(to: string, subject: string, text: string, html: string): Promise<void> {
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.from, to, subject, text, html });
      this.logger.info({ to, subject }, 'Email sent via SMTP');
    } else {
      this.logger.info({ to, subject }, `📧 [dev mail] ${subject}\n${text}`);
    }
  }

  async sendVerificationEmail(to: string, link: string): Promise<void> {
    await this.send(
      to,
      'Verify your Pixparity email',
      `Confirm your email by opening: ${link}`,
      `<p>Welcome to Pixparity.</p><p><a href="${link}">Verify your email</a></p><p>${link}</p>`,
    );
  }

  async sendPasswordResetEmail(to: string, link: string): Promise<void> {
    await this.send(
      to,
      'Reset your Pixparity password',
      `Reset your password by opening: ${link} (expires in 1 hour)`,
      `<p>We received a request to reset your password.</p><p><a href="${link}">Reset password</a></p><p>${link}</p><p>This link expires in 1 hour. If you didn't request it, ignore this email.</p>`,
    );
  }
}
