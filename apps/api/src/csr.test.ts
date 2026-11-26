import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CSR_PROVIDER, CsrService } from './modules/csr/csr.service';

const admin = { id: 'admin-1', role: 'ADMIN', email: 'admin@binus.ac.id', name: 'Admin' } as never;
const company = { id: 'co-1', name: 'PT Nusantara Hijau Lestari', sector: 'Energi', userId: 'u-co-1' };
const activeCampaign = { id: 'camp-1', status: 'ACTIVE', deadline: new Date(Date.now() + 86_400_000) };

function setup(opts: { campaign?: object | null; createPaymentError?: unknown } = {}) {
  const donationCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'don-1', ...data }));
  const paymentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (opts.createPaymentError) throw opts.createPaymentError;
    return data;
  });
  const tx = { donation: { create: donationCreate }, payment: { create: paymentCreate } };
  const prisma = {
    company: { findUnique: vi.fn(async () => company) },
    campaign: { findUnique: vi.fn(async () => (opts.campaign === undefined ? activeCampaign : opts.campaign)) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const payments = { applyEvent: vi.fn(async () => ({ received: true, replayed: false, donationId: 'don-1', status: 'PAID' })) };
  const service = new CsrService(prisma as never, audit as never, payments as never);
  return { service, payments, donationCreate, paymentCreate, audit };
}

const input = { companyId: 'co-1', campaignId: 'camp-1', amount: 2_500_000, reference: 'TRF/2026/11/0042' };

describe('CsrService.recordContribution', () => {
  it('membuat donasi atas nama akun perusahaan lalu men-settle lewat jalur yang sama dengan QRIS', async () => {
    const { service, payments, donationCreate, paymentCreate, audit } = setup();
    const r = await service.recordContribution(input, admin, null);
    expect(r).toMatchObject({ donationId: 'don-1', amount: 2_500_000, status: 'PAID', company: company.name });
    expect(donationCreate.mock.calls[0][0].data).toMatchObject({ donorId: 'u-co-1', amount: 2_500_000, status: 'PENDING' });
    expect(paymentCreate.mock.calls[0][0].data).toMatchObject({ provider: CSR_PROVIDER, method: 'TRANSFER', externalPaymentId: 'CSR-TRF/2026/11/0042' });
    expect(payments.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'don-1', status: 'SETTLED', amount: 2_500_000 }));
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'CSR_CONTRIBUTION_RECORDED', actorId: 'admin-1' });
  });

  it('referensi transfer yang sama ditolak (dana tidak tercatat dua kali)', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
    const { service, payments } = setup({ createPaymentError: dup });
    await expect(service.recordContribution(input, admin, null)).rejects.toMatchObject({ code: 'CSR_REFERENCE_DUPLICATE' });
    expect(payments.applyEvent).not.toHaveBeenCalled();
  });

  it('campaign yang tidak ACTIVE atau lewat deadline ditolak', async () => {
    const frozen = setup({ campaign: { ...activeCampaign, status: 'FROZEN' } });
    await expect(frozen.service.recordContribution(input, admin, null)).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_ACTIVE' });
    const late = setup({ campaign: { ...activeCampaign, deadline: new Date(Date.now() - 1000) } });
    await expect(late.service.recordContribution(input, admin, null)).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_ACTIVE' });
  });

  it('nominal di luar batas donasi ditolak sebelum menyentuh database', async () => {
    const { service, donationCreate } = setup();
    await expect(service.recordContribution({ ...input, amount: 5_000 }, admin, null)).rejects.toMatchObject({ code: 'DONATION_AMOUNT_INVALID' });
    expect(donationCreate).not.toHaveBeenCalled();
  });
});
