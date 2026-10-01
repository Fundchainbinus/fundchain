# Frontend Project Initialization

**Stack:** React + TypeScript + Vite + Tailwind + React Router + React Query + Zustand.

## 1. Bootstrap

```bash
cd apps/web
pnpm create vite . --template react-ts

pnpm add react-router-dom @tanstack/react-query axios \
        react-hook-form zod @hookform/resolvers zustand
pnpm add -D tailwindcss postcss autoprefixer @types/node
pnpm dlx tailwindcss init -p
```

## 2. Folder Structure

```
apps/web/src/
├── main.tsx
├── App.tsx
├── router.tsx
├── lib/                # axios, query client, utils
├── stores/             # zustand (auth.store.ts)
├── features/           # auth/ campaigns/ donations/ blockchain/ admin/
│   └── <feature>/      # api.ts, hooks.ts, components/
├── components/         # Layout, ProtectedRoute, ErrorBoundary
├── pages/              # route-level pages
└── styles/index.css
```

Feature-based: setiap fitur punya folder sendiri dengan `api.ts` (fetch calls), `hooks.ts` (React Query), dan komponen lokal.

## 3. Tailwind Config

`tailwind.config.js`:

```javascript
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#003D7C', dark: '#002A57', light: '#E6EEF8' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
};
```

`src/styles/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## 4. Vite Config

`vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
```

## 5. API Client — Axios + Interceptor

`src/lib/axios.ts`:

```typescript
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,  // session cookie
});

api.interceptors.response.use(
  (res) => res.data.data,  // unwrap { success, data } → data
  (err) => {
    if (err.response?.status === 401) window.location.href = '/login';
    return Promise.reject(err.response?.data?.error ?? err);
  },
);
```

## 6. React Query Setup

`src/lib/query.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
```

Wrap `<App />` di `main.tsx` dengan `<QueryClientProvider client={queryClient}>`.

## 7. Auth State (Zustand)

`src/stores/auth.store.ts`:

```typescript
import { create } from 'zustand';

interface AuthState {
  user: { id: string; email: string; name: string; role: 'STUDENT' | 'ADMIN' } | null;
  setUser: (user: AuthState['user']) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  logout: () => set({ user: null }),
}));
```

Populate dari `GET /auth/me` saat app mount (`useEffect` di `App.tsx`).

## 8. Router

`src/router.tsx`:

```typescript
import { createBrowserRouter } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
// ...imports

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/campaigns', element: <CampaignCatalogPage /> },
          { path: '/campaigns/:id', element: <CampaignDetailPage /> },
          { path: '/profile', element: <ProfilePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
```

`ProtectedRoute` — kalau `!user`, redirect ke `/login`. `Layout` — top nav + sidebar + `<Outlet />`.

## 9. Base Layout Structure

```
<Layout>
  <TopNav>  Logo · Notifications · Avatar menu </TopNav>
  <Sidebar> Home · Campaigns · My Campaigns · History · (Admin section) </Sidebar>
  <main> <Outlet /> </main>
</Layout>
```

Design lengkap di file UI/UX brief.

## 10. Definition of Done

- [ ] `pnpm dev` boots di port 5173
- [ ] Tailwind classes render benar
- [ ] Axios interceptor configured (unwrap + 401 redirect)
- [ ] React Query provider di root
- [ ] Router configured dengan protected routes
- [ ] Login page render, klik tombol hits `/api/v1/auth/login`
- [ ] Base layout (top nav + sidebar) jalan