import type SendblueAPI from "sendblue";

export interface SendblueKeyPairCredentials {
  apiKey: string;
  apiSecret: string;
}

/** Direct bearer token or a lazy resolver for managed credentials. */
export type SendblueAccessToken = string | (() => string | Promise<string>);

/**
 * Verifies a webhook before its payload is parsed. A trusted proxy can
 * validate its assertion here instead of requiring a Sendblue secret.
 */
export type SendblueWebhookVerifier = (
  request: Request,
  rawBody: string,
) => boolean | Response | Promise<boolean | Response>;

/** Resolves the selected Sendblue line after managed credentials are available. */
export type SendblueFromNumber = string | (() => Promise<string>);

export interface SendblueAdapterConfig extends SendblueKeyPairCredentials {
  /** Bearer token used instead of `apiKey` and `apiSecret` when provided. */
  accessToken?: SendblueAccessToken;
  /** Default Sendblue line for this adapter. */
  defaultFromNumber: SendblueFromNumber;
  webhookSecret?: string;
  /**
   * Header name Sendblue uses to deliver the webhook secret.
   * @default "sb-signing-secret"
   */
  webhookSecretHeader?: string;
  /** Takes precedence over `webhookSecret` when provided. */
  webhookVerifier?: SendblueWebhookVerifier;
  statusCallbackUrl?: string;
  /**
   * Which messaging services to accept from inbound webhooks.
   * @default ["iMessage"]
   */
  allowedServices?: SendblueService[];
  /**
   * Sendblue lines accepted by this adapter. Defaults to the configured
   * `defaultFromNumber` so unrelated lines cannot share the same webhook.
   */
  allowedFromNumbers?: readonly string[] | (() => Promise<readonly string[]>);
}

export type SendblueService = "iMessage" | "SMS" | "RCS" | "sms";

export interface SendblueThreadId {
  fromNumber: string;
  contactNumber?: string;
  groupId?: string;
}

// ---------------------------------------------------------------------------
// Inbound webhook payload shapes (not fully covered by the SDK's types)
// ---------------------------------------------------------------------------

export interface SendblueMessagePayload {
  accountEmail?: string;
  content: string;
  is_outbound: boolean;
  status: string;
  error_code: number | null;
  error_message: string | null;
  error_reason: string | null;
  error_detail: string | null;
  message_handle: string;
  date_sent: string;
  date_updated: string;
  from_number: string;
  number: string;
  to_number: string;
  was_downgraded: boolean | null;
  plan?: string;
  media_url: string;
  message_type: "message" | "group" | string;
  group_id: string;
  participants: string[];
  send_style: string;
  opted_out: boolean;
  sendblue_number: string | null;
  service: string;
  group_display_name: string | null;
}

export interface SendblueTypingPayload {
  number: string;
  is_typing: boolean;
  from_number: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Reactions (Sendblue tapbacks — not in the official SDK)
// ---------------------------------------------------------------------------

export type SendblueReaction =
  "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";

export const VALID_REACTIONS: ReadonlySet<string> = new Set<SendblueReaction>([
  "love",
  "like",
  "dislike",
  "laugh",
  "emphasize",
  "question",
]);

export const REACTION_ALIASES: Record<string, SendblueReaction> = {
  heart: "love",
  thumbs_up: "like",
  thumbsup: "like",
  "+1": "like",
  thumbs_down: "dislike",
  thumbsdown: "dislike",
  "-1": "dislike",
  haha: "laugh",
  exclamation: "emphasize",
  "!!": "emphasize",
  "?": "question",
};

// Re-export SDK types for convenience
export type { SendblueAPI };
export type MessageResponse = SendblueAPI.MessageResponse;
export type MessageListResponse = SendblueAPI.MessageListResponse;
export type MessageSendParams = SendblueAPI.MessageSendParams;
