import { randomBytes } from "node:crypto";
export type DealDemonConfig={port:number;quoteSecret:string;quoteSigning:"configured"|"ephemeral-dev"};
export function loadDealDemonConfigFromEnv():DealDemonConfig{
 const raw=process.env.DEALDEMON_PORT;const port=raw?Number(raw):8802;
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error("DEALDEMON_PORT must be an integer between 0 and 65535");
 const quoteSecret=process.env.DEALDEMON_QUOTE_SECRET;if(quoteSecret)return{port,quoteSecret,quoteSigning:"configured"};
 if(process.env.NODE_ENV==="production")throw new Error("DEALDEMON_QUOTE_SECRET is required in production");
 console.warn("DEALDEMON_QUOTE_SECRET is unset; using an ephemeral development quote key.");
 return{port,quoteSecret:randomBytes(32).toString("base64url"),quoteSigning:"ephemeral-dev"};
}
