/**
 * Email Notification Channel
 *
 * Sends email notifications using Resend API.
 * Supports DCA, stop-loss, and swap notifications.
 */

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

import { NotificationType, NotificationPriority } from './notificationService.js';

const log = logger.child({ service: 'EmailChannel' });

/**
 * Email template types
 */
type EmailTemplate =
  | 'dca_executed'
  | 'stop_loss_triggered'
  | 'swap_success'
  | 'swap_failed'
  | 'intent_completed'
  | 'generic';

/**
 * Email notification configuration
 */
interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}

/**
 * Email recipient
 */
interface EmailRecipient {
  email: string;
  name?: string;
}

/**
 * Email content
 */
interface EmailContent {
  to: EmailRecipient[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email Channel for notifications
 */
export class EmailChannel {
  private apiKey: string;
  private fromEmail: string;
  private fromName: string;
  private enabled: boolean;

  constructor(emailConfig?: Partial<EmailConfig>) {
    this.apiKey = emailConfig?.apiKey || process.env.RESEND_API_KEY || '';
    this.fromEmail =
      emailConfig?.fromEmail || process.env.EMAIL_FROM || 'notifications@flowmint.io';
    this.fromName = emailConfig?.fromName || 'FlowMint';
    this.enabled = !!this.apiKey;

    if (!this.enabled) {
      log.warn('Email notifications disabled: RESEND_API_KEY not configured');
    }
  }

  /**
   * Check if email channel is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send an email notification
   */
  async send(
    recipient: EmailRecipient,
    type: NotificationType,
    title: string,
    message: string,
    priority: NotificationPriority,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.enabled) {
      log.debug('Email notification skipped: channel not enabled');
      return false;
    }

    try {
      const template = this.getTemplateForType(type);
      const html = this.renderTemplate(template, {
        title,
        message,
        priority,
        type,
        ...metadata,
      });

      const subject = this.getSubjectLine(type, title, priority);

      await this.sendEmail({
        to: [recipient],
        subject,
        html,
        text: message,
      });

      log.info({ recipient: recipient.email, type }, 'Email notification sent');
      return true;
    } catch (error) {
      log.error({ error, recipient: recipient.email, type }, 'Failed to send email notification');
      return false;
    }
  }

  /**
   * Send raw email via Resend API
   */
  private async sendEmail(content: EmailContent): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: content.to.map(r => r.email),
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Resend API error: ${response.status} - ${errorData}`);
    }
  }

  /**
   * Get template name for notification type
   */
  private getTemplateForType(type: NotificationType): EmailTemplate {
    const templateMap: Partial<Record<NotificationType, EmailTemplate>> = {
      [NotificationType.DCA_EXECUTED]: 'dca_executed',
      [NotificationType.DCA_COMPLETED]: 'dca_executed',
      [NotificationType.DCA_FAILED]: 'swap_failed',
      [NotificationType.STOP_LOSS_TRIGGERED]: 'stop_loss_triggered',
      [NotificationType.STOP_LOSS_EXECUTED]: 'stop_loss_triggered',
      [NotificationType.STOP_LOSS_FAILED]: 'swap_failed',
      [NotificationType.SWAP_SUCCESS]: 'swap_success',
      [NotificationType.SWAP_FAILED]: 'swap_failed',
      [NotificationType.PRICE_ALERT]: 'generic',
      [NotificationType.SYSTEM_ALERT]: 'generic',
    };

    return templateMap[type] || 'generic';
  }

  /**
   * Generate subject line
   */
  private getSubjectLine(
    type: NotificationType,
    title: string,
    priority: NotificationPriority
  ): string {
    const priorityPrefix =
      priority === NotificationPriority.URGENT
        ? '🚨 '
        : priority === NotificationPriority.HIGH
          ? '⚠️ '
          : '';

    return `${priorityPrefix}[FlowMint] ${title}`;
  }

  /**
   * Render email template
   */
  private renderTemplate(template: EmailTemplate, data: Record<string, unknown>): string {
    const baseStyles = `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
      .footer { background: #1f2937; color: #9ca3af; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
      .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
      .success { color: #10b981; }
      .error { color: #ef4444; }
      .warning { color: #f59e0b; }
      .metric { background: white; padding: 15px; border-radius: 6px; margin: 10px 0; border: 1px solid #e5e7eb; }
      .metric-value { font-size: 24px; font-weight: bold; color: #3b82f6; }
      .metric-label { font-size: 12px; color: #6b7280; }
    `;

    const templates: Record<EmailTemplate, string> = {
      dca_executed: `
        <!DOCTYPE html>
        <html>
        <head><style>${baseStyles}</style></head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔄 DCA Exécuté</h1>
            </div>
            <div class="content">
              <h2>${data.title}</h2>
              <p>${data.message}</p>
              ${
                data.executionNumber
                  ? `
                <div class="metric">
                  <div class="metric-value">#${data.executionNumber}</div>
                  <div class="metric-label">Exécution</div>
                </div>
              `
                  : ''
              }
              ${
                data.amount
                  ? `
                <div class="metric">
                  <div class="metric-value">${data.amount}</div>
                  <div class="metric-label">Montant swappé</div>
                </div>
              `
                  : ''
              }
              <a href="https://flowmint.io/intents" class="button">Voir mes intents →</a>
            </div>
            <div class="footer">
              <p>FlowMint - Trading intelligent sur Solana</p>
              <p><a href="https://flowmint.io/settings" style="color: #9ca3af;">Gérer mes notifications</a></p>
            </div>
          </div>
        </body>
        </html>
      `,

      stop_loss_triggered: `
        <!DOCTYPE html>
        <html>
        <head><style>${baseStyles}</style></head>
        <body>
          <div class="container">
            <div class="header" style="background: linear-gradient(135deg, #ef4444, #f59e0b);">
              <h1>⚠️ Stop-Loss Déclenché</h1>
            </div>
            <div class="content">
              <h2>${data.title}</h2>
              <p>${data.message}</p>
              ${
                data.triggerPrice
                  ? `
                <div class="metric">
                  <div class="metric-value">$${data.triggerPrice}</div>
                  <div class="metric-label">Prix de déclenchement</div>
                </div>
              `
                  : ''
              }
              ${
                data.currentPrice
                  ? `
                <div class="metric">
                  <div class="metric-value warning">$${data.currentPrice}</div>
                  <div class="metric-label">Prix actuel</div>
                </div>
              `
                  : ''
              }
              <a href="https://flowmint.io/intents" class="button">Voir les détails →</a>
            </div>
            <div class="footer">
              <p>FlowMint - Protection automatique de vos positions</p>
            </div>
          </div>
        </body>
        </html>
      `,

      swap_success: `
        <!DOCTYPE html>
        <html>
        <head><style>${baseStyles}</style></head>
        <body>
          <div class="container">
            <div class="header" style="background: linear-gradient(135deg, #10b981, #3b82f6);">
              <h1>✅ Swap Réussi</h1>
            </div>
            <div class="content">
              <h2 class="success">${data.title}</h2>
              <p>${data.message}</p>
              ${
                data.inputAmount && data.outputAmount
                  ? `
                <div class="metric">
                  <div class="metric-value">${data.inputAmount} → ${data.outputAmount}</div>
                  <div class="metric-label">Montant échangé</div>
                </div>
              `
                  : ''
              }
              ${
                data.signature
                  ? `
                <a href="https://solscan.io/tx/${data.signature}" class="button">Voir sur Solscan →</a>
              `
                  : ''
              }
            </div>
            <div class="footer">
              <p>FlowMint - Exécution fiable sur Solana</p>
            </div>
          </div>
        </body>
        </html>
      `,

      swap_failed: `
        <!DOCTYPE html>
        <html>
        <head><style>${baseStyles}</style></head>
        <body>
          <div class="container">
            <div class="header" style="background: linear-gradient(135deg, #ef4444, #dc2626);">
              <h1>❌ Swap Échoué</h1>
            </div>
            <div class="content">
              <h2 class="error">${data.title}</h2>
              <p>${data.message}</p>
              ${
                data.error
                  ? `
                <div class="metric" style="border-color: #fecaca; background: #fef2f2;">
                  <div class="metric-label">Erreur</div>
                  <div style="color: #dc2626;">${data.error}</div>
                </div>
              `
                  : ''
              }
              <a href="https://flowmint.io/swap" class="button">Réessayer →</a>
            </div>
            <div class="footer">
              <p>FlowMint - Besoin d'aide ? contact@flowmint.io</p>
            </div>
          </div>
        </body>
        </html>
      `,

      intent_completed: `
        <!DOCTYPE html>
        <html>
        <head><style>${baseStyles}</style></head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Intent Complété</h1>
            </div>
            <div class="content">
              <h2 class="success">${data.title}</h2>
              <p>${data.message}</p>
              <a href="https://flowmint.io/history" class="button">Voir l'historique →</a>
            </div>
            <div class="footer">
              <p>FlowMint - Mission accomplie!</p>
            </div>
          </div>
        </body>
        </html>
      `,

      generic: `
        <!DOCTYPE html>
        <html>
        <head><style>${baseStyles}</style></head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📢 FlowMint</h1>
            </div>
            <div class="content">
              <h2>${data.title}</h2>
              <p>${data.message}</p>
              <a href="https://flowmint.io" class="button">Ouvrir FlowMint →</a>
            </div>
            <div class="footer">
              <p>FlowMint - Trading intelligent sur Solana</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    return templates[template] || templates.generic;
  }
}

// Export singleton instance
export const emailChannel = new EmailChannel();
