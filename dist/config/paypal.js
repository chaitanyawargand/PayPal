import "dotenv/config";
export const paypalConfig = {
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    baseUrl: process.env.PAYPAL_BASE_URL,
    appUrl: process.env.APP_URL,
};
if (!paypalConfig.clientId ||
    !paypalConfig.clientSecret ||
    !paypalConfig.baseUrl) {
    throw new Error("Missing PayPal environment variables");
}
//# sourceMappingURL=paypal.js.map