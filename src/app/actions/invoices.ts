'use server';

import { auth } from '@/auth';
import { db } from '@/db';
import { invoices, invoiceLines, jobs, settings, catalogue, photos } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { aud, addDays, formatDateAU, sumLines } from '@/lib/money';
import { sendDraftInvoiceEmail } from '@/lib/email';
import type { ExtractedInvoice } from '@/lib/extract-invoice';

export async function createDraftFromExtraction({
  jobId, extracted,
}: { jobId: string; extracted: ExtractedInvoice }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error('Job not found');

  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  const cat = await db.select().from(catalogue);
  const codeToCat = new Map(cat.map((c) => [c.code, c]));

  const lines = extracted.lines.map((l, i) => ({
    position: i,
    catalogueId: l.catalogueCode ? codeToCat.get(l.catalogueCode)?.id ?? null : null,
    description: l.description,
    quantity: l.quantity.toString(),
    unit: l.unit,
    unitPriceExGst: l.unitPriceExGst.toString(),
    gstApplies: l.gstApplies,
    lineTotalExGst: (l.quantity * l.unitPriceExGst).toFixed(2),
  }));

  const totals = sumLines(
    lines.map((l) => ({
      quantity: l.quantity,
      unitPriceExGst: l.unitPriceExGst,
      gstApplies: l.gstApplies,
    }))
  );

  const [invoice] = await db
    .insert(invoices)
    .values({
      jobId: job.id,
      customerId: job.customerId,
      customerNameSnapshot: job.customerNameSnapshot,
      addressSnapshot: job.addressSnapshot,
      issueDate: new Date(),
      dueDate: addDays(new Date(), s?.paymentTermsDays ?? 7),
      subtotalExGst: totals.subtotalExGst.toFixed(2),
      gstAmount: totals.gstAmount.toFixed(2),
      totalIncGst: totals.totalIncGst.toFixed(2),
      notes: extracted.summary,
      extractionNotes: extracted.reviewNotes,
      status: 'draft',
    })
    .returning();

  for (const line of lines) {
    await db.insert(invoiceLines).values({ invoiceId: invoice.id, ...line });
  }

  await db.update(jobs).set({ status: 'invoiced', updatedAt: new Date() }).where(eq(jobs.id, jobId));

  revalidatePath('/');
  revalidatePath(`/invoice/${invoice.id}`);
  redirect(`/invoice/${invoice.id}`);
}

export async function updateInvoiceLine({
  lineId, description, quantity, unit, unitPriceExGst, gstApplies,
}: {
  lineId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceExGst: number;
  gstApplies: boolean;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');
  await db
    .update(invoiceLines)
    .set({
      description,
      quantity: quantity.toString(),
      unit,
      unitPriceExGst: unitPriceExGst.toString(),
      gstApplies,
      lineTotalExGst: (quantity * unitPriceExGst).toFixed(2),
    })
    .where(eq(invoiceLines.id, lineId));

  const [line] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, lineId));
  if (line) await recomputeInvoiceTotals(line.invoiceId);
}

export async function deleteInvoiceLine(lineId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');
  const [line] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, lineId));
  if (!line) return;
  await db.delete(invoiceLines).where(eq(invoiceLines.id, lineId));
  await recomputeInvoiceTotals(line.invoiceId);
}

export async function addInvoiceLine(invoiceId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');
  const existing = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  await db.insert(invoiceLines).values({
    invoiceId,
    position: existing.length,
    description: 'New line',
    quantity: '1',
    unit: 'each',
    unitPriceExGst: '0',
    gstApplies: true,
    lineTotalExGst: '0',
  });
  await recomputeInvoiceTotals(invoiceId);
  revalidatePath(`/invoice/${invoiceId}`);
}

async function recomputeInvoiceTotals(invoiceId: string) {
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  const totals = sumLines(lines);
  await db
    .update(invoices)
    .set({
      subtotalExGst: totals.subtotalExGst.toFixed(2),
      gstAmount: totals.gstAmount.toFixed(2),
      totalIncGst: totals.totalIncGst.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
  revalidatePath(`/invoice/${invoiceId}`);
}

export async function sendDraftToAdmin(invoiceId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorised');

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error('ADMIN_EMAIL not configured');

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new Error('Invoice not found');
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));

  let jobPhotos: { blobUrl: string; caption: string | null }[] = [];
  if (invoice.jobId) {
    jobPhotos = await db
      .select({ blobUrl: photos.blobUrl, caption: photos.caption })
      .from(photos)
      .where(eq(photos.jobId, invoice.jobId));
  }

  const lineRows = lines
    .map(
      (l) => `<tr>
        <td style="padding:6px 8px;">${l.description}</td>
        <td style="padding:6px 8px; text-align:right;">${l.quantity} ${l.unit}</td>
        <td style="padding:6px 8px; text-align:right;">${aud(l.unitPriceExGst)}</td>
        <td style="padding:6px 8px; text-align:right;">${aud(l.lineTotalExGst)}</td>
      </tr>`
    )
    .join('');

  const photoHtml = jobPhotos.length
    ? `<h3 style="margin-top:24px;">Photos</h3>` +
      jobPhotos.map((p) =>
        `<div style="margin:8px 0;"><img src="${p.blobUrl}" style="max-width:480px; border-radius:8px;" />${
          p.caption ? `<p style="color:#666; font-size:13px;">${p.caption}</p>` : ''
        }</div>`
      ).join('')
    : '';

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 640px;">
      <h2>Draft invoice ready for Xero</h2>
      <p style="color:#666;">Generated by SCP Pocket EA on ${formatDateAU(new Date())}.</p>
      <table style="border-collapse:collapse; width:100%; margin:16px 0;">
        <tr><td style="padding:6px 8px;"><strong>Customer</strong></td><td style="padding:6px 8px;">${invoice.customerNameSnapshot}</td></tr>
        <tr><td style="padding:6px 8px;"><strong>Address</strong></td><td style="padding:6px 8px;">${invoice.addressSnapshot}</td></tr>
        <tr><td style="padding:6px 8px;"><strong>Due</strong></td><td style="padding:6px 8px;">${formatDateAU(invoice.dueDate)}</td></tr>
      </table>
      ${invoice.notes ? `<p><strong>Summary:</strong> ${invoice.notes}</p>` : ''}
      <table style="border-collapse:collapse; width:100%; border-top:1px solid #e5e5e0; margin-top:8px;">
        <thead><tr style="background:#fafaf7;">
          <th style="text-align:left; padding:6px 8px;">Description</th>
          <th style="text-align:right; padding:6px 8px;">Qty</th>
          <th style="text-align:right; padding:6px 8px;">Unit</th>
          <th style="text-align:right; padding:6px 8px;">Total ex-GST</th>
        </tr></thead>
        <tbody>${lineRows}</tbody>
        <tfoot>
          <tr><td colspan="3" style="padding:6px 8px; text-align:right;">Subtotal ex-GST</td><td style="padding:6px 8px; text-align:right;">${aud(invoice.subtotalExGst)}</td></tr>
          <tr><td colspan="3" style="padding:6px 8px; text-align:right;">GST</td><td style="padding:6px 8px; text-align:right;">${aud(invoice.gstAmount)}</td></tr>
          <tr><td colspan="3" style="padding:6px 8px; text-align:right;"><strong>Total inc GST</strong></td><td style="padding:6px 8px; text-align:right;"><strong>${aud(invoice.totalIncGst)}</strong></td></tr>
        </tfoot>
      </table>
      ${invoice.extractionNotes && invoice.extractionNotes.trim()
        ? `<div style="background:#fff7e6; border-left:3px solid #c75300; padding:12px; margin:16px 0;">
            <strong>Review notes from Claude:</strong><br/>${invoice.extractionNotes}
          </div>` : ''}
      ${photoHtml}
      <p style="color:#666; font-size:13px; margin-top:24px;">
        Action this in Xero. From ${s?.businessName ?? 'SCP'} ABN ${s?.abn ?? ''}
      </p>
    </div>`;

  await sendDraftInvoiceEmail({
    to: adminEmail,
    subject: `Draft invoice - ${invoice.customerNameSnapshot} - ${aud(invoice.totalIncGst)}`,
    html,
  });

  await db
    .update(invoices)
    .set({ status: 'sent_to_admin', sentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  revalidatePath(`/invoice/${invoiceId}`);
}
