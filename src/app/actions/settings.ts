'use server';

import { auth } from '@/auth';
import { db } from '@/db';
import { settings, catalogue } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const SettingsSchema = z.object({
  businessName: z.string().min(1),
  abn: z.string(),
  gstRegistered: z.boolean(),
  licenceNumber: z.string(),
  addressLine: z.string(),
  phone: z.string(),
  email: z.string(),
  bankAccountName: z.string(),
  bankBsb: z.string(),
  bankAccountNumber: z.string(),
  defaultHourlyRate: z.number(),
  defaultCalloutFee: z.number(),
  paymentTermsDays: z.number().int().positive(),
  gstInclusive: z.boolean(),
});

export async function updateSettings(input: z.infer<typeof SettingsSchema>) {
  const session = await auth();
  if (session?.user?.role !== 'admin') throw new Error('Admin only');

  const parsed = SettingsSchema.parse(input);

  await db
    .update(settings)
    .set({
      ...parsed,
      defaultHourlyRate: parsed.defaultHourlyRate.toFixed(2),
      defaultCalloutFee: parsed.defaultCalloutFee.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  revalidatePath('/settings');
}

export async function upsertCatalogueItem(input: {
  id?: string;
  code: string;
  name: string;
  kind: 'material' | 'service' | 'labour' | 'callout';
  unit: string;
  priceExGst: number;
  gstApplies: boolean;
  aliases: string[];
  active: boolean;
}) {
  const session = await auth();
  if (session?.user?.role !== 'admin') throw new Error('Admin only');

  if (input.id) {
    await db
      .update(catalogue)
      .set({
        code: input.code,
        name: input.name,
        kind: input.kind,
        unit: input.unit,
        priceExGst: input.priceExGst.toFixed(2),
        gstApplies: input.gstApplies,
        aliases: input.aliases,
        active: input.active,
      })
      .where(eq(catalogue.id, input.id));
  } else {
    await db.insert(catalogue).values({
      code: input.code,
      name: input.name,
      kind: input.kind,
      unit: input.unit,
      priceExGst: input.priceExGst.toFixed(2),
      gstApplies: input.gstApplies,
      aliases: input.aliases,
      active: input.active,
    });
  }
  revalidatePath('/catalogue');
}

export async function deleteCatalogueItem(id: string) {
  const session = await auth();
  if (session?.user?.role !== 'admin') throw new Error('Admin only');
  await db.delete(catalogue).where(eq(catalogue.id, id));
  revalidatePath('/catalogue');
}
