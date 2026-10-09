import { z } from "zod";

// Schémas zod des opérations de synchronisation (cf. SPECS.md § 6/7).
// Validation de forme uniquement — aucune règle métier côté serveur.

const uuidSchema = z.uuid();
const deviceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "deviceId invalide");

// HLC encodé : wall paddé sur 15 chiffres : compteur paddé sur 6 : deviceId.
const hlcSchema = z
  .string()
  .max(96)
  .regex(/^\d{15}:\d{6}:[a-z0-9][a-z0-9-]{0,63}$/, "hlc invalide");

const barcodeRegex = /^[0-9A-Za-z_-]{3,64}$/;

const barcodesSchema = z.array(z.string().regex(barcodeRegex)).max(20);

const shortText = z
  .string()
  .trim()
  .min(1)
  .max(64);
const nameText = z
  .string()
  .trim()
  .min(1)
  .max(256);

const createPayloadSchema = z
  .object({
    name: nameText,
    // Codes-barres associés (forme courante) ; `barcode` = forme legacy (v1), conservée pour le
    // replay des journaux existants.
    barcodes: barcodesSchema.optional(),
    barcode: z.union([z.string().regex(barcodeRegex), z.literal("")]).optional(),
    location: shortText.optional(),
    category: shortText.optional(),
  })
  .strict();

const adjustPayloadSchema = z
  .object({
    delta: z.number().int().min(-1_000_000).max(1_000_000),
  })
  .strict();

const setPayloadSchema = z
  .object({
    field: z.enum(["name", "barcode", "location", "category"]),
    // Valeur trimmée à la sortie du parse (normalisation).
    value: z.string().max(256).trim(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const value = payload.value;
    if (payload.field === "name" && value.length === 0) {
      ctx.addIssue({ code: "custom", message: "Nom invalide." });
    }
    if (payload.field === "barcode" && value !== "" && !barcodeRegex.test(value)) {
      ctx.addIssue({ code: "custom", message: "Code-barres invalide." });
    }
    if ((payload.field === "location" || payload.field === "category") && value.length > 64) {
      ctx.addIssue({ code: "custom", message: "Valeur trop longue." });
    }
  });

const deletePayloadSchema = z.object({}).strict();

const barcodesPayloadSchema = z
  .object({
    barcodes: barcodesSchema,
  })
  .strict();

const opFields = {
  uuid: uuidSchema,
  deviceId: deviceIdSchema,
  hlc: hlcSchema,
  entityId: uuidSchema,
} as const;

export const opSchema = z.discriminatedUnion("type", [
  z.object({ ...opFields, type: z.literal("item.create"), payload: createPayloadSchema }).strict(),
  z.object({ ...opFields, type: z.literal("item.adjust"), payload: adjustPayloadSchema }).strict(),
  z.object({ ...opFields, type: z.literal("item.set"), payload: setPayloadSchema }).strict(),
  z
    .object({ ...opFields, type: z.literal("item.barcodes.set"), payload: barcodesPayloadSchema })
    .strict(),
  z.object({ ...opFields, type: z.literal("item.delete"), payload: deletePayloadSchema }).strict(),
]);

export type Op = z.output<typeof opSchema>;

export const pushBodySchema = z
  .object({
    ops: z.array(opSchema).min(1).max(500),
  })
  .strict();

export const pullQuerySchema = z.object({
  cursor: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200),
});

export const barcodeParamSchema = z
  .string()
  .max(64)
  .regex(barcodeRegex, "Code-barres invalide");
