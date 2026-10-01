import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';
import { Layout, RequireUser } from './components/Layout';
import './index.css';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { CampaignFormPage } from './pages/CampaignFormPage';
import { DisbursePage } from './pages/DisbursePage';
import { DonationProofPage } from './pages/DonationProofPage';
import { HomePage } from './pages/HomePage';
import { MyCampaignsPage, MyDonationsPage } from './pages/MyPages';
import { PaymentPage } from './pages/PaymentPage';
import {
  AdminAuditPage,
  AdminDashboardPage,
  AdminDisbursementsPage,
  AdminIntegrityPage,
  AdminLayout,
  AdminReviewsPage,
} from './pages/admin/AdminPages';

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
      { path: '/donations/:id', element: <DonationProofPage /> },
      // Mahasiswa
      { path: '/campaigns/new', element: user(<CampaignFormPage />) },
      { path: '/campaigns/:id/edit', element: user(<CampaignFormPage />) },
      { path: '/campaigns/:id/disburse', element: user(<DisbursePage />) },
      { path: '/donations/:id/pay', element: user(<PaymentPage />) },
      { path: '/my/campaigns', element: user(<MyCampaignsPage />) },
      { path: '/my/donations', element: user(<MyDonationsPage />) },
      // Admin
      {
        path: '/admin',
        element: <RequireUser admin><AdminLayout /></RequireUser>,
        children: [
          { index: true, element: <AdminDashboardPage /> },
          { path: 'reviews', element: <AdminReviewsPage /> },
          { path: 'integrity', element: <AdminIntegrityPage /> },
          { path: 'disbursements', element: <AdminDisbursementsPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
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
