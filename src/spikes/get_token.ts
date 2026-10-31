
import "dotenv/config";

const clientId = process.env.PAYPAL_CLIENT_ID!;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
const baseUrl = process.env.PAYPAL_BASE_URL!;

async function getAccessToken(): Promise<string> {
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
        throw new Error(`Token fetch failed: ${JSON.stringify(data)}`);
    }

    return data.access_token;
}

const token = await getAccessToken();
console.log("ACCESS_TOKEN:", token);