import { generateKeyPairSync, sign, verify } from "node:crypto";

export interface SigningKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return {
    publicKeyPem: publicKey as string,
    privateKeyPem: privateKey as string,
  };
}

export function signReceiptHash(receiptHash: string, privateKeyPem: string): string {
  const signature = sign(null, Buffer.from(receiptHash, "utf8"), privateKeyPem);
  return signature.toString("base64");
}

export function verifyReceiptSignature(
  receiptHash: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(receiptHash, "utf8"),
      publicKeyPem,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}