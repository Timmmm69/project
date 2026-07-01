export type SendEmailInput = {
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  type: string;
};

export type SendEmailResult = {
  provider: string;
  providerMessageId?: string;
};

export interface EmailAdapter {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export class DisabledEmailAdapter implements EmailAdapter {
  async send(): Promise<SendEmailResult> {
    return {
      provider: "disabled"
    };
  }
}
