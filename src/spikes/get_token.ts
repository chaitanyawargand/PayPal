import "dotenv/config";

const clientId = process.env.PAYPAL_CLIENT_ID!;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
const baseUrl = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

let cachedToken: string | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`PayPal OAuth failed: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  return cachedToken!;
}

// When executed directly: npx tsx src/spikes/get_token.ts
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("get_token.ts")) {
  getAccessToken().then((token) => console.log(token)).catch(console.error);
}
