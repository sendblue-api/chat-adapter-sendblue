import type { Logger } from "chat";
import SendblueAPI from "sendblue";
import { SendblueAdapter } from "./adapter";
import type { SendblueAdapterConfig } from "./types";

export { SendblueAdapter } from "./adapter";
export { toPlainText } from "./format-converter";
export type {
  SendblueAccessToken,
  SendblueAdapterConfig,
  SendblueKeyPairCredentials,
  SendblueMessagePayload,
  SendblueWebhookVerifier,
  SendblueReaction,
  SendblueService,
  SendblueThreadId,
  SendblueTypingPayload,
} from "./types";
export { REACTION_ALIASES, VALID_REACTIONS } from "./types";

export type SendblueAdapterOptions = Partial<SendblueAdapterConfig> & {
  logger?: Logger;
};

export function createSendblueAdapter(
  options: SendblueAdapterOptions = {},
): SendblueAdapter {
  const defaultFromNumber =
    options.defaultFromNumber ?? process.env.SENDBLUE_FROM_NUMBER;
  if (!defaultFromNumber) {
    throw new Error(
      "Sendblue from_number is required. Pass it in config or set SENDBLUE_FROM_NUMBER.",
    );
  }
  const allowedFromNumbers =
    options.allowedFromNumbers ??
    (typeof defaultFromNumber === "string"
      ? [defaultFromNumber]
      : async () => [await defaultFromNumber()]);

  const accessToken = options.accessToken;
  if (accessToken === "") {
    throw new Error("Sendblue access token is required.");
  }
  const hasAccessToken = accessToken !== undefined;
  const apiKey = options.apiKey ?? process.env.SENDBLUE_API_KEY;
  const apiSecret = options.apiSecret ?? process.env.SENDBLUE_API_SECRET;
  if (!hasAccessToken && !apiKey) {
    throw new Error(
      "Sendblue API key is required. Pass apiKey or accessToken in config, or set SENDBLUE_API_KEY.",
    );
  }
  if (!hasAccessToken && !apiSecret) {
    throw new Error(
      "Sendblue API secret is required. Pass apiSecret or accessToken in config, or set SENDBLUE_API_SECRET.",
    );
  }

  return new SendblueAdapter({
    defaultFromNumber,
    ...(typeof accessToken === "function"
      ? { accessToken }
      : {
          sdk:
            accessToken !== undefined
              ? new SendblueAPI({ accessToken })
              : new SendblueAPI({ apiKey, apiSecret }),
        }),
    webhookSecret: options.webhookSecret ?? process.env.SENDBLUE_WEBHOOK_SECRET,
    webhookSecretHeader: options.webhookSecretHeader,
    webhookVerifier: options.webhookVerifier,
    statusCallbackUrl:
      options.statusCallbackUrl ?? process.env.SENDBLUE_STATUS_CALLBACK_URL,
    allowedServices: options.allowedServices,
    allowedFromNumbers,
    logger: options.logger,
  });
}
