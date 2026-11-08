import {describe,expect,it} from "vitest";
import {ATTACK_MANIFEST,getAttackById,getAttackForSku} from "../src/attacks.js";

describe("DealDemon attack manifest",()=>{
 it("contains one stable attack for every canonical SKU",()=>{expect(ATTACK_MANIFEST).toHaveLength(20);expect(new Set(ATTACK_MANIFEST.map(a=>a.sku)).size).toBe(20);expect(ATTACK_MANIFEST.map(a=>a.id)).toEqual(Array.from({length:20},(_,i)=>`DD-${String(i+1).padStart(2,"0")}`));});
 it("looks attacks up case-insensitively by SKU and exactly by ID",()=>{expect(getAttackForSku("jkt-001")?.id).toBe("DD-01");expect(getAttackById("DD-20")?.sku).toBe("BPK-005");expect(getAttackById("dd-20")).toBeUndefined();});
});
