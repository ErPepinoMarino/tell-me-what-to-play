import { OAuth2Client } from "google-auth-library";

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url === "https://oauth2.googleapis.com/token") {
    const body = init?.body?.toString() ?? "";

    if (body.includes("code=google-error")) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (body.includes("code=without-id-token")) {
      return new Response(
        JSON.stringify({ access_token: "test-access-token" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const idToken = body.includes("code=without-sub")
      ? "test-id-token-without-sub"
      : body.includes("code=without-email")
        ? "test-id-token-without-email"
        : "test-id-token";

    return new Response(JSON.stringify({ id_token: idToken }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return originalFetch(input, init);
};

OAuth2Client.prototype.verifyIdToken = (async ({
  idToken,
}: Parameters<OAuth2Client["verifyIdToken"]>[0]) => {
  if (idToken === "test-id-token-without-sub") {
    return {
      getPayload: () => ({ email: "oauth-test@example.com" }),
    };
  }

  if (idToken === "test-id-token-without-email") {
    return {
      getPayload: () => ({ sub: "google-test-sub" }),
    };
  }

  return {
    getPayload: () => ({
      sub: "google-test-sub",
      email: "oauth-test@example.com",
    }),
  };
}) as unknown as OAuth2Client["verifyIdToken"];
