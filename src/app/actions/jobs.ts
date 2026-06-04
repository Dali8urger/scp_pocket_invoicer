'use server';

import { auth } from '@/auth';
import { db } from '@/db';
import { jobs, customers, photos } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const StartJobSchema = z.object({
  customerName: z.string().min(1).max(200),
  address: z.string().min(1).max(300),
  initialNote: z.string().max(500).optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
  gpsAccuracy: z.number().optional(),
});

export async function startJob(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');

  const parsed = StartJobSchema.parse({
    customerName: formData.get('customerName'),
    address: formData.get('address'),
    initialNote: formData.get('initialNote') || undefined,
    gpsLat: formData.get('gpsLat') ? Number(formData.get('gpsLat')) : undefined,
    gpsLng: formData.get('gpsLng') ? Number(formData.get('gpsLng')) : undefined,
    gpsAccuracy: formData.get('gpsAccuracy') ? Number(formData.get('gpsAccuracy')) : undefined,
  });

  let customerId: string | null = null;
  const existing = await db.select().from(customers).where(eq(customers.name, parsed.customerName));
  if (existing.length > 0) {
    customerId = existing[0].id;
  } else {
    const [created] = await db
      .insert(customers)
      .values({ name: parsed.customerName, address: parsed.address })
      .returning();
    customerId = created.id;
  }

  const gps =
    parsed.gpsLat !== undefined && parsed.gpsLng !== undefined
      ? { lat: parsed.gpsLat, lng: parsed.gpsLng, accuracy: parsed.gpsAccuracy ?? null }
      : null;

  const [job] = await db
    .insert(jobs)
    .values({
      customerId,
      customerNameSnapshot: parsed.customerName,
      addressSnapshot: parsed.address,
      arrivedGps: gps,
      initialNote: parsed.initialNote ?? null,
      status: 'in_progress',
      createdBy: session.user.id,
    })
    .returning();

  revalidatePath('/');
  redirect(`/job/${job.id}`);
}

export async function leaveJob({
  jobId, gps, voiceTranscript, voiceDurationSec,
}: {
  jobId: string;
  gps: { lat: number; lng: number; accuracy: number | null } | null;
  voiceTranscript: string | null;
  voiceDurationSec: number | null;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');

  await db
    .update(jobs)
    .set({
      leftAt: new Date(),
      leftGps: gps,
      voiceTranscript: voiceTranscript ?? null,
      voiceDurationSec: voiceDurationSec ?? null,
      status: 'completed',
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));

  revalidatePath('/');
  revalidatePath(`/job/${jobId}`);
}

export async function cancelJob(jobId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');
  await db.update(jobs).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(jobs.id, jobId));
  revalidatePath('/');
}
