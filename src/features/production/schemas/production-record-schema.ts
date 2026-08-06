import { z } from "zod";

export const productionRecordSchema = z.object({
  productionDate: z.string().date(),
  labourId: z.string().uuid(),
  labourName: z.string().min(1),
  brickType: z.string().min(1),
  quantity: z.number().int().positive(),
});

export type ProductionRecordInput = z.infer<typeof productionRecordSchema>;
