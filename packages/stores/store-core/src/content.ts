import type { ContentBlock } from "./types.js";
export function partitionContentBlocks(blocks:readonly ContentBlock[]){return {visible:blocks.filter(b=>b.visibility==="VISIBLE"),hidden:blocks.filter(b=>b.visibility==="HIDDEN")};}
export function visibleContentText(blocks:readonly ContentBlock[]):string{return blocks.filter(b=>b.visibility==="VISIBLE").map(b=>b.text).join("\n");}
