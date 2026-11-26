import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';
import { Layout, RequireUser } from './components/Layout';
import { Spinner } from './components/ui';
import './index.css';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { HomePage } from './pages/HomePage';

/**
 * BFD-35: halaman yang jarang dibuka / berat (admin, bukti donasi, form, pembayaran, poin) dipecah
 * jadi chunk terpisah. Beranda & detail kampanye tetap di chunk utama.
 */
function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  const C = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  );
}

const loadAdmin = () => import('./pages/admin/AdminPages');
const loadMy = () => import('./pages/MyPages');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: false } },
});

const user = (el: React.ReactNode) => <RequireUser>{el}</RequireUser>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      // Publik
      { path: '/', element: <HomePage /> },
      { path: '/campaigns/:id', element: <CampaignDetailPage /> },
      { path: '/csr', element: page(() => import('./pages/CsrPage'), 'CsrPage') },
      { path: '/donations/:id', element: page(() => import('./pages/DonationProofPage'), 'DonationProofPage') },
      // Mahasiswa
      { path: '/campaigns/new', element: user(page(() => import('./pages/CampaignFormPage'), 'CampaignFormPage')) },
      { path: '/campaigns/:id/edit', element: user(page(() => import('./pages/CampaignFormPage'), 'CampaignFormPage')) },
      { path: '/campaigns/:id/disburse', element: user(page(() => import('./pages/DisbursePage'), 'DisbursePage')) },
      { path: '/donations/:id/pay', element: user(page(() => import('./pages/PaymentPage'), 'PaymentPage')) },
      { path: '/my/campaigns', element: user(page(loadMy, 'MyCampaignsPage')) },
      { path: '/my/donations', element: user(page(loadMy, 'MyDonationsPage')) },
      { path: '/my/points', element: user(page(() => import('./pages/PointsPage'), 'PointsPage')) },
      // Admin
      {
        path: '/admin',
        element: <RequireUser admin>{page(loadAdmin, 'AdminLayout')}</RequireUser>,
        children: [
          { index: true, element: page(loadAdmin, 'AdminDashboardPage') },
          { path: 'reviews', element: page(loadAdmin, 'AdminReviewsPage') },
          { path: 'integrity', element: page(loadAdmin, 'AdminIntegrityPage') },
          { path: 'disbursements', element: page(loadAdmin, 'AdminDisbursementsPage') },
          { path: 'audit', element: page(loadAdmin, 'AdminAuditPage') },
          { path: 'csr', element: page(() => import('./pages/admin/AdminCsrPage'), 'AdminCsrPage') },
        ],
      },
      {
        path: '*',
        element: (
          <div className="card mx-auto max-w-md p-8 text-center">
            <h1 className="text-xl font-bold">Halaman tidak ditemukan</h1>
            <Link to="/" className="btn-primary mt-4">Kembali ke beranda</Link>
          </div>
        ),
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
