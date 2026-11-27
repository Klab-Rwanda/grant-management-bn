import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { EnvService } from '../config/env';

@Injectable()
export class AuthMailerService {
  constructor(private readonly env: EnvService) {}

  async sendInvitation(email: string, invitationUrl: string): Promise<void> {
    const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM } = this.env.config;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
    });

    await transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: 'You are invited to Grant Ledger',
      text: `You have been invited to Grant Ledger. Accept the invitation within 24 hours: ${invitationUrl}`,
      html: `<p>You have been invited to Grant Ledger.</p><p><a href="${invitationUrl}">Accept the invitation</a> within 24 hours.</p>`,
    });
  }
}
