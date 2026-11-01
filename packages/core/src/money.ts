import { z } from 'zod';

export const MoneyCents = z
  .number()
  .int('Money must be an integer number of cents')
  .nonnegative('Money cannot be negative');

export type MoneyCents = z.infer<typeof MoneyCents>;