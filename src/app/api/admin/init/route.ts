import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { db } from '@/db';
import { users, settings, catalogue } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * One-shot database initialiser.
 *
 * Hit this URL ONCE after first deploy, with a Bearer token equal to CRON_SECRET:
 *
 *   curl -X POST https://your-app.vercel.app/api/admin/init \
 *        -H "Authorization: Bearer YOUR_CRON_SECRET"
 *
 * Or in a browser dev tools console:
 *
 *   fetch('/api/admin/init', {
 *     method: 'POST',
 *     headers: { Authorization: 'Bearer YOUR_CRON_SECRET' }
 *   }).then(r => r.json()).then(console.log)
 *
 * Idempotent. Safe to run multiple times.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 });
  }

  // --- Step 1: run schema migration ---
  let migrationResult = 'skipped';
  try {
    const sqlText = readFileSync(
      join(process.cwd(), 'drizzle', '0000_initial.sql'),
      'utf8'
    );
    // Strip comments and split on semicolons that end statements.
    const sql = neon(process.env.DATABASE_URL);
    // Execute the whole script as one transaction by splitting carefully.
    // We use Neon's HTTP driver which doesn't support multi-statement directly,
    // so split on statement boundaries.
    const statements = splitSqlStatements(sqlText);
    for (const stmt of statements) {
      if (stmt.trim().length === 0) continue;
      await sql.query(stmt);
    }
    migrationResult = `${statements.length} statements`;
  } catch (err) {
    return NextResponse.json(
      { error: 'Migration failed', detail: String(err) },
      { status: 500 }
    );
  }

  // --- Step 2: seed users ---
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'd8urger@gmail.com';
  const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL ?? 'shanecollinsplumbing@gmail.com';

  const seedReport: Record<string, string> = {};

  const existingUsers = await db.select().from(users);
  const emails = new Set(existingUsers.map((u) => u.email));

  if (!emails.has(ADMIN_EMAIL)) {
    await db
      .insert(users)
      .values({ email: ADMIN_EMAIL, name: 'Danielle (admin)', role: 'admin' });
    seedReport.admin = 'created';
  } else {
    seedReport.admin = 'exists';
  }
  if (!emails.has(OPERATOR_EMAIL)) {
    await db
      .insert(users)
      .values({ email: OPERATOR_EMAIL, name: 'Shane (operator)', role: 'operator' });
    seedReport.operator = 'created';
  } else {
    seedReport.operator = 'exists';
  }

  // --- Step 3: seed settings ---
  const existingSettings = await db.select().from(settings).where(eq(settings.id, 1));
  if (existingSettings.length === 0) {
    await db.insert(settings).values({
      id: 1,
      businessName: 'Shane Collins Plumbing',
      abn: '36 203 735 053',
      gstRegistered: true,
      addressLine: 'Byron Bay NSW 2481',
      email: OPERATOR_EMAIL,
      defaultHourlyRate: '140.00',
      defaultCalloutFee: '120.00',
      paymentTermsDays: 7,
      gstInclusive: false,
    });
    seedReport.settings = 'created';
  } else {
    seedReport.settings = 'exists';
  }

  // --- Step 4: seed catalogue ---
  const existingCat = await db.select().from(catalogue);
  if (existingCat.length === 0) {
    const seeds = catalogueSeed();
    for (const item of seeds) {
      await db.insert(catalogue).values({
        code: item.code,
        name: item.name,
        kind: item.kind,
        unit: item.unit,
        priceExGst: item.priceExGst,
        gstApplies: true,
        aliases: [...item.aliases],
        active: true,
      });
    }
    seedReport.catalogue = `${seeds.length} items`;
  } else {
    seedReport.catalogue = `${existingCat.length} items already present`;
  }

  return NextResponse.json({
    ok: true,
    migration: migrationResult,
    seed: seedReport,
  });
}

// --- Helpers ---

function splitSqlStatements(sql: string): string[] {
  // Strip line comments.
  const cleaned = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  // Split on semicolons, but ignore semicolons inside DO $$ ... $$ blocks.
  const statements: string[] = [];
  let buf = '';
  let inDollar = false;
  let i = 0;
  while (i < cleaned.length) {
    const remaining = cleaned.slice(i);
    if (remaining.startsWith('$$')) {
      inDollar = !inDollar;
      buf += '$$';
      i += 2;
      continue;
    }
    const ch = cleaned[i];
    if (ch === ';' && !inDollar) {
      statements.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim().length > 0) statements.push(buf.trim());
  return statements;
}

function catalogueSeed() {
  return [
    { code: 'LABOUR-STD', name: 'Standard labour', kind: 'labour' as const, unit: 'hr', priceExGst: '140.00', aliases: ['labour', 'hours', 'on site', 'work'] },
    { code: 'LABOUR-AFTERHOURS', name: 'After-hours labour', kind: 'labour' as const, unit: 'hr', priceExGst: '220.00', aliases: ['after hours', 'overtime', 'weekend', 'night'] },
    { code: 'CALLOUT-STD', name: 'Standard callout fee', kind: 'callout' as const, unit: 'each', priceExGst: '120.00', aliases: ['callout', 'service call', 'attendance'] },
    { code: 'CALLOUT-EMERGENCY', name: 'Emergency callout', kind: 'callout' as const, unit: 'each', priceExGst: '250.00', aliases: ['emergency', 'urgent', 'burst pipe callout'] },
    { code: 'HWS-RHEEM-STELLAR-250', name: 'Rheem Stellaris 250L gas storage HWS', kind: 'material' as const, unit: 'each', priceExGst: '2350.00', aliases: ['rheem stellar', 'rheem stellaris', 'gas 250'] },
    { code: 'HWS-RHEEM-STELLAR-360', name: 'Rheem Stellaris 360L gas storage HWS', kind: 'material' as const, unit: 'each', priceExGst: '2780.00', aliases: ['rheem stellar 360', 'rheem 360'] },
    { code: 'HWS-RINNAI-INF-26', name: 'Rinnai Infinity 26L continuous flow HWS', kind: 'material' as const, unit: 'each', priceExGst: '1690.00', aliases: ['rinnai infinity', 'rinnai 26', 'continuous flow'] },
    { code: 'HWS-VULCAN-160', name: 'Vulcan 160L electric HWS', kind: 'material' as const, unit: 'each', priceExGst: '1320.00', aliases: ['vulcan', 'electric hws', 'storage electric'] },
    { code: 'HWS-TEMPERING-VALVE', name: 'Tempering valve (50C)', kind: 'material' as const, unit: 'each', priceExGst: '95.00', aliases: ['tempering', 'tmv', 'mixing valve'] },
    { code: 'TAP-WASHER-KIT', name: 'Tap washer kit (set of 10)', kind: 'material' as const, unit: 'each', priceExGst: '14.00', aliases: ['tap washer', 'washer', 'jumper valve'] },
    { code: 'TAP-MIXER-KITCHEN', name: 'Kitchen mixer tap (standard chrome)', kind: 'material' as const, unit: 'each', priceExGst: '210.00', aliases: ['kitchen mixer', 'kitchen tap'] },
    { code: 'TAP-MIXER-BASIN', name: 'Basin mixer tap (standard chrome)', kind: 'material' as const, unit: 'each', priceExGst: '165.00', aliases: ['basin mixer', 'basin tap', 'bathroom tap'] },
    { code: 'TAP-SET-LAUNDRY', name: 'Laundry tap set (hot/cold)', kind: 'material' as const, unit: 'each', priceExGst: '95.00', aliases: ['laundry tap', 'laundry set'] },
    { code: 'TOILET-CISTERN-INLET', name: 'Cistern inlet valve', kind: 'material' as const, unit: 'each', priceExGst: '38.00', aliases: ['inlet valve', 'cistern valve', 'fill valve'] },
    { code: 'TOILET-FLUSH-VALVE', name: 'Cistern flush valve', kind: 'material' as const, unit: 'each', priceExGst: '42.00', aliases: ['flush valve', 'outlet valve'] },
    { code: 'TOILET-PAN-SEAL', name: 'Toilet pan connector / seal', kind: 'material' as const, unit: 'each', priceExGst: '28.00', aliases: ['pan seal', 'pan connector', 'toilet seal'] },
    { code: 'TOILET-SUITE-STD', name: 'Standard toilet suite', kind: 'material' as const, unit: 'each', priceExGst: '480.00', aliases: ['toilet suite', 'new toilet', 'toilet pan'] },
    { code: 'DRAIN-CLEAR-STANDARD', name: 'Drain clearing service (basic)', kind: 'service' as const, unit: 'each', priceExGst: '220.00', aliases: ['blocked drain', 'drain clear', 'drain clean'] },
    { code: 'DRAIN-JET-BLAST', name: 'Hydro-jet drain blasting', kind: 'service' as const, unit: 'each', priceExGst: '480.00', aliases: ['jet blast', 'hydro jet', 'high pressure clean'] },
    { code: 'DRAIN-CCTV', name: 'Drain CCTV inspection', kind: 'service' as const, unit: 'each', priceExGst: '350.00', aliases: ['cctv', 'camera inspection', 'drain camera'] },
    { code: 'DRAIN-PVC-100MM', name: 'PVC stormwater pipe 100mm', kind: 'material' as const, unit: 'm', priceExGst: '18.00', aliases: ['stormwater pipe', '100mm pvc', 'pvc 100'] },
    { code: 'PIPE-COPPER-15MM', name: '15mm copper pipe', kind: 'material' as const, unit: 'm', priceExGst: '24.00', aliases: ['copper 15', 'half inch copper', '15mm pipe'] },
    { code: 'PIPE-COPPER-20MM', name: '20mm copper pipe', kind: 'material' as const, unit: 'm', priceExGst: '32.00', aliases: ['copper 20', '20mm pipe', 'three quarter inch'] },
    { code: 'PIPE-PEX-15MM', name: '15mm PEX pipe', kind: 'material' as const, unit: 'm', priceExGst: '8.50', aliases: ['pex 15', 'pex pipe'] },
    { code: 'FITTING-ELBOW-15-90', name: '15mm 90 degree elbow', kind: 'material' as const, unit: 'each', priceExGst: '4.50', aliases: ['elbow', '90 degree', 'corner fitting'] },
    { code: 'FITTING-TEE-15', name: '15mm tee fitting', kind: 'material' as const, unit: 'each', priceExGst: '5.50', aliases: ['tee', 'tee fitting', 't piece'] },
    { code: 'SILICONE-NEUTRAL', name: 'Neutral cure silicone (300ml)', kind: 'material' as const, unit: 'each', priceExGst: '14.00', aliases: ['silicone', 'sealant'] },
    { code: 'TEFLON-TAPE', name: 'Teflon thread tape', kind: 'material' as const, unit: 'each', priceExGst: '3.50', aliases: ['teflon', 'thread tape', 'plumbers tape'] },
    { code: 'INSULATION-PIPE-15', name: 'Pipe insulation 15mm (per metre)', kind: 'material' as const, unit: 'm', priceExGst: '6.00', aliases: ['lagging', 'insulation', 'pipe wrap'] },
    { code: 'TRAVEL-FEE', name: 'Travel surcharge (outside std zone)', kind: 'service' as const, unit: 'each', priceExGst: '80.00', aliases: ['travel', 'distance fee'] },
  ];
}
