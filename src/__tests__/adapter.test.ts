import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SendblueMessagePayload } from "../types";

const sendMock = mock(() =>
  Promise.resolve({ message_handle: "msg_123", status: "QUEUED" }),
);
const groupSendMock = mock(() =>
  Promise.resolve({ message_handle: "grp_123", status: "QUEUED" }),
);
const postMock = mock(() => Promise.resolve({}));
const listMock = mock(() => Promise.resolve({ data: [] }));
const sdkConstructorMock = mock();

mock.module("sendblue", () => ({
  default: class FakeSendblue {
    constructor(options: unknown) {
      sdkConstructorMock(options);
    }

    messages = { send: sendMock, list: listMock };
    groups = { sendMessage: groupSendMock };
    lookups = { lookupNumber: mock(() => Promise.resolve({})) };
    post = postMock;
    get = mock(() => Promise.resolve({}));
  },
}));

const { SendblueAdapter } = await import("../adapter");
const { createSendblueAdapter } = await import("../index");

function createAdapter(overrides: Record<string, unknown> = {}) {
  return createSendblueAdapter({
    apiKey: "test-key",
    apiSecret: "test-secret",
    defaultFromNumber: "+13137386158",
    webhookSecret: "test-webhook-secret",
    ...overrides,
  });
}

function installChatProcessMessageSpy(
  adapter: InstanceType<typeof SendblueAdapter>,
) {
  const processMessage = mock(() => Promise.resolve());
  adapter.initialize({
    getLogger: () => ({
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    }),
    processMessage,
  } as never);
  return processMessage;
}

function makePayload(
  overrides: Partial<SendblueMessagePayload> = {},
): SendblueMessagePayload {
  return {
    content: "Hello from iMessage",
    is_outbound: false,
    status: "RECEIVED",
    error_code: null,
    error_message: null,
    error_reason: null,
    error_detail: null,
    message_handle: "msg_abc",
    date_sent: "2026-04-04T10:00:00Z",
    date_updated: "2026-04-04T10:00:00Z",
    from_number: "+14155551234",
    number: "+13137386158",
    to_number: "+13137386158",
    was_downgraded: null,
    media_url: "",
    message_type: "message",
    group_id: "",
    participants: [],
    send_style: "",
    opted_out: false,
    sendblue_number: null,
    service: "iMessage",
    group_display_name: null,
    ...overrides,
  };
}

describe("SendblueAdapter", () => {
  beforeEach(() => {
    sendMock.mockClear();
    groupSendMock.mockClear();
    postMock.mockClear();
    listMock.mockClear();
    sdkConstructorMock.mockClear();
  });

  test("requires a sending line", () => {
    expect(() =>
      createSendblueAdapter({
        accessToken: "connect-token",
      }),
    ).toThrow("Sendblue from_number is required");
  });

  test("resolves a lazy access token only when an SDK operation needs it", async () => {
    const accessToken = mock(() => "connect-token");
    const adapter = createSendblueAdapter({
      accessToken,
      defaultFromNumber: "+13137386158",
      allowedFromNumbers: ["+13137386158"],
    });

    expect(accessToken).not.toHaveBeenCalled();
    await adapter.createSdk();
    expect(accessToken).toHaveBeenCalledTimes(1);
  });

  test("validates a lazy access token when an SDK operation needs it", async () => {
    const adapter = createSendblueAdapter({
      accessToken: () => "",
      defaultFromNumber: "+13137386158",
      allowedFromNumbers: ["+13137386158"],
    });

    await expect(adapter.createSdk()).rejects.toThrow(
      "Sendblue access token is required",
    );
  });

  test("uses the official SDK with key-pair credentials", () => {
    const adapter = createAdapter();

    adapter.getSdk();

    expect(sdkConstructorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      apiSecret: "test-secret",
    });
  });

  test("rejects an empty direct bearer token", () => {
    expect(() =>
      createSendblueAdapter({
        accessToken: "",
        defaultFromNumber: "+13137386158",
      }),
    ).toThrow("Sendblue access token is required");
  });

  test("uses the official SDK with a direct bearer token", () => {
    const adapter = createSendblueAdapter({
      accessToken: "connect-token",
      defaultFromNumber: "+13137386158",
      allowedFromNumbers: ["+13137386158"],
    });

    adapter.getSdk();

    expect(sdkConstructorMock).toHaveBeenCalledWith({
      accessToken: "connect-token",
    });
  });

  test("getSdk returns the stable client for direct credentials", () => {
    const adapter = createAdapter();

    expect(adapter.getSdk()).toBe(adapter.getSdk());
  });

  test("getSdk rejects a lazy access token", () => {
    const adapter = createSendblueAdapter({
      accessToken: () => "connect-token",
      defaultFromNumber: "+13137386158",
    });

    expect(() => adapter.getSdk()).toThrow(
      "getSdk() is unavailable with a lazy accessToken; use await createSdk() instead.",
    );
  });

  test("resolves a rotating bearer token for every operation", async () => {
    let tokenNumber = 0;
    const accessToken = mock(() => `token-${++tokenNumber}`);
    const adapter = createSendblueAdapter({
      accessToken,
      defaultFromNumber: "+13137386158",
      allowedFromNumbers: ["+13137386158"],
    });
    const threadId = adapter.encodeThreadId({
      fromNumber: "+13137386158",
      contactNumber: "+14155551234",
    });

    await adapter.postMessage(threadId, "First");
    await adapter.postMessage(threadId, "Second");

    expect(accessToken).toHaveBeenCalledTimes(2);
    expect(sdkConstructorMock).toHaveBeenNthCalledWith(1, {
      accessToken: "token-1",
    });
    expect(sdkConstructorMock).toHaveBeenNthCalledWith(2, {
      accessToken: "token-2",
    });
  });

  // -------------------------------------------------------------------------
  // Thread ID round-trip
  // -------------------------------------------------------------------------

  describe("encodeThreadId / decodeThreadId", () => {
    test("round-trips a 1:1 thread ID", () => {
      const adapter = createAdapter();
      const data = {
        fromNumber: "+13137386158",
        contactNumber: "+14155551234",
      };
      const encoded = adapter.encodeThreadId(data);
      expect(encoded).toStartWith("sendblue:");
      expect(adapter.decodeThreadId(encoded)).toEqual(data);
    });

    test("round-trips a group thread ID", () => {
      const adapter = createAdapter();
      const data = { fromNumber: "+13137386158", groupId: "group_xyz" };
      const encoded = adapter.encodeThreadId(data);
      expect(encoded).toContain(":g:");
      expect(adapter.decodeThreadId(encoded)).toEqual(data);
    });

    test("throws on invalid thread ID", () => {
      const adapter = createAdapter();
      expect(() => adapter.decodeThreadId("bad_id")).toThrow(
        "Invalid Sendblue thread ID",
      );
    });
  });

  // -------------------------------------------------------------------------
  // parseMessage
  // -------------------------------------------------------------------------

  describe("parseMessage", () => {
    test("produces correct Message fields from webhook payload", () => {
      const adapter = createAdapter();
      const payload = makePayload();
      const msg = adapter.parseMessage(payload);

      expect(msg.id).toBe("msg_abc");
      expect(msg.text).toBe("Hello from iMessage");
      expect(msg.author.userId).toBe("+14155551234");
      expect(msg.author.isBot).toBe(false);
      expect(msg.author.isMe).toBe(false);
      expect(msg.attachments).toHaveLength(0);
    });

    test("parses media_url as HTTP attachment", () => {
      const adapter = createAdapter();
      const payload = makePayload({
        media_url: "https://cdn.sendblue.co/photo.jpg",
      });
      const msg = adapter.parseMessage(payload);

      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]!.type).toBe("image");
      expect(msg.attachments[0]!.mimeType).toBe("image/jpeg");
      expect(msg.attachments[0]!.url).toBe("https://cdn.sendblue.co/photo.jpg");
    });

    test("parses data: URI as attachment with decoded buffer", () => {
      const adapter = createAdapter();
      const b64 = Buffer.from("fake-image-data").toString("base64");
      const payload = makePayload({
        media_url: `data:image/png;base64,${b64}`,
      });
      const msg = adapter.parseMessage(payload);

      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]!.type).toBe("image");
      expect(msg.attachments[0]!.mimeType).toBe("image/png");
      expect(msg.attachments[0]!.data).toBeInstanceOf(Buffer);
    });
  });

  // -------------------------------------------------------------------------
  // postMessage
  // -------------------------------------------------------------------------

  describe("postMessage", () => {
    test("sends via sdk.messages.send with correct params", async () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        fromNumber: "+13137386158",
        contactNumber: "+14155551234",
      });

      await adapter.postMessage(threadId, "Hello!");

      expect(sendMock).toHaveBeenCalledTimes(1);
      const args = (sendMock.mock.calls as unknown[][])[0]![0] as Record<
        string,
        unknown
      >;
      expect(args.number).toBe("+14155551234");
      expect(args.from_number).toBe("+13137386158");
      expect(args.content).toBe("Hello!");
    });

    test("skips sending empty content", async () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        fromNumber: "+13137386158",
        contactNumber: "+14155551234",
      });

      const result = await adapter.postMessage(threadId, "   ");

      expect(sendMock).not.toHaveBeenCalled();
      expect(result.id).toBe("");
    });

    test("strips markdown from outbound messages", async () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        fromNumber: "+13137386158",
        contactNumber: "+14155551234",
      });

      await adapter.postMessage(threadId, { markdown: "**bold** text" });

      const args = (sendMock.mock.calls as unknown[][])[0]![0] as Record<
        string,
        unknown
      >;
      expect(args.content).toBe("bold text");
    });
  });

  // -------------------------------------------------------------------------
  // sendMediaMessage
  // -------------------------------------------------------------------------

  describe("sendMediaMessage", () => {
    test("sends message with media_url", async () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        fromNumber: "+13137386158",
        contactNumber: "+14155551234",
      });

      await adapter.sendMediaMessage(
        threadId,
        "https://app.midday.ai/midday-contact.vcf",
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      const args = (sendMock.mock.calls as unknown[][])[0]![0] as Record<
        string,
        unknown
      >;
      expect(args.media_url).toBe("https://app.midday.ai/midday-contact.vcf");
      expect(args.content).toBe("");
    });

    test("skips sending for group threads", async () => {
      const adapter = createAdapter();
      const threadId = adapter.encodeThreadId({
        fromNumber: "+13137386158",
        groupId: "group_xyz",
      });

      await adapter.sendMediaMessage(threadId, "https://example.com/file.vcf");

      expect(sendMock).not.toHaveBeenCalled();
      expect(groupSendMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleWebhook
  // -------------------------------------------------------------------------

  describe("handleWebhook", () => {
    test("rejects request with wrong webhook secret", async () => {
      const adapter = createAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "wrong-secret" },
        body: JSON.stringify(makePayload()),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(401);
    });

    test("rejects a bad secret without reading an already-consumed body", async () => {
      const adapter = createAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "wrong-secret" },
        body: JSON.stringify(makePayload()),
      });
      await request.text();

      expect((await adapter.handleWebhook(request)).status).toBe(401);
    });

    test("dispatches an event for the configured Sendblue line", async () => {
      const adapter = createAdapter();
      const processMessage = installChatProcessMessageSpy(adapter);
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "test-webhook-secret" },
        body: JSON.stringify(makePayload()),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(processMessage).toHaveBeenCalledTimes(1);
    });

    test("uses webhookVerifier before parsing and instead of the shared secret", async () => {
      const verify = mock(
        (_request: Request, rawBody: string) => rawBody === "{} ",
      );
      const adapter = createAdapter({ webhookVerifier: verify });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "wrong-secret" },
        body: "{} ",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(verify).toHaveBeenCalledWith(expect.any(Request), "{} ");
    });

    test("gives webhookVerifier a readable request body", async () => {
      const adapter = createAdapter({
        webhookVerifier: async (request, rawBody) =>
          (await request.text()) === rawBody,
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "{}",
      });

      expect((await adapter.handleWebhook(request)).status).toBe(200);
    });

    test("rejects a webhookVerifier failure before parsing", async () => {
      const adapter = createAdapter({ webhookVerifier: () => false });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "not json",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(401);
    });

    test("returns a response from webhookVerifier", async () => {
      const adapter = createAdapter({
        webhookVerifier: () => new Response("forbidden", { status: 403 }),
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "{}",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(403);
    });

    test("fails closed when webhookVerifier throws", async () => {
      const adapter = createAdapter({
        webhookVerifier: () => {
          throw new Error("invalid OIDC token");
        },
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "{}",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(401);
    });

    test("fails closed when webhookVerifier rejects", async () => {
      const adapter = createAdapter({
        webhookVerifier: async () =>
          Promise.reject(new Error("invalid OIDC token")),
      });
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        body: "{}",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(401);
    });

    test("returns 400 for invalid JSON body", async () => {
      const adapter = createAdapter();
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "test-webhook-secret" },
        body: "not json",
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(400);
    });

    test("does not resolve the access token while handling an inbound webhook", async () => {
      const accessToken = mock(() => "connect-token");
      const adapter = createSendblueAdapter({
        accessToken,
        defaultFromNumber: "+13137386158",
        allowedFromNumbers: ["+13137386158"],
        webhookSecret: "test-webhook-secret",
      });
      const processMessage = installChatProcessMessageSpy(adapter);
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "test-webhook-secret" },
        body: JSON.stringify(makePayload()),
      });

      expect((await adapter.handleWebhook(request)).status).toBe(200);
      expect(processMessage).toHaveBeenCalledTimes(1);
      expect(accessToken).not.toHaveBeenCalled();
    });

    test("does not dispatch events for a different Sendblue line", async () => {
      const adapter = createAdapter();
      const processMessage = installChatProcessMessageSpy(adapter);
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "test-webhook-secret" },
        body: JSON.stringify(makePayload({ to_number: "+19995550123" })),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(processMessage).not.toHaveBeenCalled();
    });

    test("dispatches events for explicitly allowed Sendblue lines", async () => {
      const adapter = createAdapter({ allowedFromNumbers: ["+19995550123"] });
      const processMessage = installChatProcessMessageSpy(adapter);
      const request = new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "sb-signing-secret": "test-webhook-secret" },
        body: JSON.stringify(makePayload({ to_number: "+19995550123" })),
      });

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(processMessage).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // channelIdFromThreadId
  // -------------------------------------------------------------------------

  test("channelIdFromThreadId returns adapter:from prefix", () => {
    const adapter = createAdapter();
    const threadId = adapter.encodeThreadId({
      fromNumber: "+13137386158",
      contactNumber: "+14155551234",
    });
    const channelId = adapter.channelIdFromThreadId(threadId);
    expect(channelId).toStartWith("sendblue:");
    expect(channelId.split(":")).toHaveLength(2);
  });
});
