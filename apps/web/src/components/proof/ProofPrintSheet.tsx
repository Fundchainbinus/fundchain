import { dateTime, rupiah } from '../../lib/format';
import type { DonationDetail, DonationProof } from '../../lib/types';
import { onChainPlaceholder } from './HashComparison';
import { type ProofVerdict, verdictText } from './proofState';

/**
 * Versi cetak bukti donasi (Unduh PDF → window.print() → "Save as PDF").
 * Tersembunyi di layar; @media print di index.css menyembunyikan chrome aplikasi.
 * Semua status ditulis sebagai teks karena browser biasanya tidak mencetak warna latar.
 */
export function ProofPrintSheet({ d, proof, verdict }: { d: DonationDetail; proof: DonationProof | undefined; verdict: ProofVerdict | null }) {
  const bc = d.blockchain;
  const txHash = proof?.txHash ?? bc?.txHash ?? null;
  const block = proof?.blockNumber ?? bc?.blockNumber ?? null;
  const rows: [string, string][] = [
    ['ID donasi', d.id],
    ['Campaign', d.campaign.title],
    ['Nominal', rupiah(d.amount)],
    ['Tanggal donasi', d.donatedAt ? dateTime(d.donatedAt) : '—'],
    ['Hash database', proof?.hashDb ?? d.hash ?? '—'],
    ['Hash on-chain', proof?.hashOnChain ?? onChainPlaceholder(verdict)],
    ...(proof?.currentHash && proof.currentHash !== proof.hashDb
      ? ([['Hash dari data saat ini', proof.currentHash]] as [string, string][])
      : []),
    ['Transaction hash', txHash ?? '—'],
    ['Blok', block != null ? block.toLocaleString('id-ID') : '—'],
    ['Waktu konfirmasi', dateTime(proof?.timestamp ?? bc?.confirmedAt ?? null)],
    ['Jaringan', `${proof?.network ?? bc?.network ?? '—'} (chain ID ${proof?.chainId ?? bc?.chainId ?? '—'})`],
    ['Smart contract', proof?.contractAddress ?? bc?.contractAddress ?? '—'],
    ['Etherscan', proof?.etherscanUrl ?? bc?.explorerUrl ?? '—'],
    ['Waktu verifikasi', proof ? dateTime(proof.checkedAt) : '—'],
  ];
  return (
    <section className="proof-print-sheet hidden print:block" aria-hidden="true">
      <h1 className="text-xl font-semibold">FundChain · Bukti Donasi & Notarisasi Blockchain</h1>
      <p className="mt-1 text-xs">Dokumen ini dicetak dari halaman bukti donasi FundChain.</p>
      <p className="proof-print-verdict mt-4 border-2 border-black px-3 py-2 text-sm font-semibold">Hasil verifikasi: {verdictText(verdict)}</p>
      <table className="mt-4 w-full border-collapse text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-300">
              <th className="w-40 py-1.5 pr-3 text-left align-top font-semibold">{k}</th>
              <td className="break-all py-1.5 font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[11px]">
        Hash adalah bukti integritas Keccak-256 atas data donasi, bukan transfer dana di blockchain. Tidak ada data pribadi yang disimpan on-chain.
        Siapa pun dapat mencocokkan hash on-chain melalui URL Etherscan di atas.
      </p>
    </section>
  );
}
