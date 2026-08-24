<p align="center">
  <img src="chat.png" alt="chat-adapter-sendblue" />
</p>

# chat-adapter-sendblue

[Sendblue](https://sendblue.co) adapter for [Chat SDK](https://chat-sdk.dev) — send and receive iMessage and SMS from your bot.

## Install

```bash
npm install chat-adapter-sendblue
```

## Quick start

```ts
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";

const chat = new Chat({
  userName: "my-bot",
  adapters: {
    sendblue: createSendblueAdapter(),
  },
});
```

The factory reads credentials from environment variables by default:

| Variable | Required | Description |
|---|---|---|
| `SENDBLUE_API_KEY` | Yes | Sendblue API key ID |
| `SENDBLUE_API_SECRET` | Yes | Sendblue API secret key |
| `SENDBLUE_FROM_NUMBER` | Yes | Your registered Sendblue phone number (E.164) |
| `SENDBLUE_WEBHOOK_SECRET` | No | Secret for webhook signature verification |
| `SENDBLUE_STATUS_CALLBACK_URL` | No | URL for outbound message status updates |

Or pass them explicitly:

```ts
createSendblueAdapter({
  apiKey: "sb-api-key-...",
  apiSecret: "sb-api-secret-...",
  defaultFromNumber: "+14155551234",
});
```

### Lazy access tokens

For deployments that obtain a short-lived bearer token at runtime, pass an
`accessToken` resolver. The adapter invokes it for every outbound API operation,
so token rotation does not require rebuilding the adapter:

```ts
const phoneNumbers = ["+14155551234", "+14155559876"];
const selectedFromNumber = "+14155551234"; // Required when more than one line exists

createSendblueAdapter({
  accessToken: async () => "short-lived-token",
  // The host chooses the outgoing line; webhook routing never fetches the token.
  defaultFromNumber: selectedFromNumber,
  allowedFromNumbers: phoneNumbers,
});
```

Bearer tokens are sent as `Authorization: Bearer <token>` and are never
converted into API-key headers. When multiple lines are available, the consumer
must choose the sending line; only a single returned line can be selected
automatically. A lazy access token should use `await createSdk()` when direct
SDK access is needed; it returns a fresh client so callers that retain it are
responsible for their own refresh policy.

## Webhooks

Point your Sendblue webhook URLs to your server. The adapter handles three webhook types:

- **Inbound messages** — incoming iMessage/SMS routed to your bot
- **Outbound status** — delivery confirmations for messages you sent
- **Typing indicators** — when a contact starts typing

```ts
// Example: Hono / Express handler
app.post("/webhooks/sendblue", async (c) => {
  await chat.initialize();
  return chat.webhooks.sendblue(c.req.raw);
});
```

### Webhook verification

If you configure a webhook secret in Sendblue, pass it as `SENDBLUE_WEBHOOK_SECRET` (or in the config). The adapter checks the `sb-signing-secret` header on every request. You can override the header name:

```ts
createSendblueAdapter({
  webhookSecret: "my-secret",
  webhookSecretHeader: "x-custom-header",
});
```

For webhook delivery through a trusted proxy, use `webhookVerifier`. It
receives a readable clone of the request and the unparsed request body, runs
before JSON parsing, and replaces the shared-secret check:

```ts
createSendblueAdapter({
  webhookVerifier: async (request, rawBody) => {
    // Verify the proxy assertion using the request headers and raw body.
    return true;
  },
});
```

## Features

### Sending messages

The adapter sends outbound iMessages (with SMS fallback) through Chat SDK's standard `postMessage` interface. Markdown is automatically stripped to plain text since iMessage does not render it.

```ts
await chat.send("sendblue", threadId, "Hello from the bot!");
```

### Attachments

Inbound media URLs from Sendblue are parsed into Chat SDK attachment objects with auto-detected MIME types. To send media, use Sendblue's `media_url` parameter through the SDK directly:

```ts
const adapter = chat.getAdapter("sendblue") as SendblueAdapter;
const sdk = adapter.getSdk();
await sdk.messages.send({
  number: "+15551234567",
  from_number: "+14155551234",
  content: "Check this out",
  media_url: "https://example.com/photo.jpg",
});
```

### Reactions (tapbacks)

iMessage tapbacks are supported via `addReaction`. The adapter maps common emoji names to Sendblue's six tapback types:

| Tapback | Aliases |
|---|---|
| `love` | `heart` |
| `like` | `thumbs_up`, `thumbsup`, `+1` |
| `dislike` | `thumbs_down`, `thumbsdown`, `-1` |
| `laugh` | `haha` |
| `emphasize` | `exclamation`, `!!` |
| `question` | `?` |

### Typing indicators

`startTyping()` sends the animated "..." bubble to the recipient. Only supported for 1:1 conversations (not group chats).

### Message history

`fetchMessages()` retrieves conversation history from the Sendblue API with cursor-based pagination.

### Number lookup

Check whether a phone number supports iMessage or SMS:

```ts
const adapter = chat.getAdapter("sendblue") as SendblueAdapter;
const result = await adapter.evaluateService("+15551234567");
// { number: "+15551234567", service: "iMessage" }
```

### Read receipts

Read receipts are never sent automatically. Send one explicitly after your host has processed a conversation (requires Sendblue account-level activation):

```ts
const adapter = chat.getAdapter("sendblue") as SendblueAdapter;
await adapter.markRead(threadId);
```

### Sendblue client access

With direct API-key credentials, `getSdk()` returns the stable official
[Sendblue SDK](https://www.npmjs.com/package/sendblue) client:

```ts
const adapter = chat.getAdapter("sendblue") as SendblueAdapter;
const client = adapter.getSdk();
await client.groups.sendMessage({ ... });
```

When configured with a lazy `accessToken`, use `await createSdk()` instead. It
resolves the token for the call and returns a freshly authenticated client:

```ts
const client = await adapter.createSdk();
await client.groups.sendMessage({ ... });
```

## Service filtering

By default, the adapter only processes inbound messages delivered via iMessage. To also accept SMS and RCS:

```ts
createSendblueAdapter({
  allowedServices: ["iMessage", "SMS", "RCS"],
});
```

## Sending-line isolation

Inbound webhooks are accepted only for `defaultFromNumber` by default. This
keeps unrelated lines in the same Sendblue account from sharing a bot webhook.
For an intentional multi-line bot, specify every accepted line:

```ts
createSendblueAdapter({
  allowedFromNumbers: ["+14155551234", "+14155559876"],
});
```

A lazy `accessToken` must configure either `allowedFromNumbers` or
`defaultFromNumber`. Webhook line filtering is intentionally independent of
token resolution, so receiving a webhook never depends on fetching an API
token.

## Adapter capabilities

- Sendblue does not support editing or unsending a recipient-visible message,
  or removing a tapback.


## Thread ID format

Thread IDs encode the Sendblue line number and contact (or group) so that conversations are sticky to a specific phone line:

```
sendblue:<from_base64url>:<contact_base64url>       // 1:1
sendblue:<from_base64url>:g:<group_id_base64url>    // group
```

Use `encodeThreadId` / `decodeThreadId` to work with them programmatically.

## Platform limitations

- **No message editing** — iMessage does not support editing sent messages via API. `editMessage` throws.
- **No unsend** — `deleteMessage` is a soft-delete in Sendblue's database only.
- **No reaction removal** — tapbacks can be added but not removed via the API.
- **Inbound media expiry** — Sendblue inbound `media_url` values expire after 30 days. Persist them if needed.
- **Typing indicators** — only work for 1:1 chats, not group conversations.

## License

MIT
