import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AiProvider } from './components/AiPanel';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inbox from './pages/Inbox';
import Jobs from './pages/Jobs';
import NewJob from './pages/NewJob';
import JobDetail from './pages/JobDetail';
import Schedule from './pages/Schedule';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import SiteDetail from './pages/SiteDetail';
import Equipment from './pages/Equipment';
import AssetDetail from './pages/AssetDetail';
import Contracts from './pages/Contracts';
import ContractDetail from './pages/ContractDetail';
import Ppm from './pages/Ppm';
import Quotes from './pages/Quotes';
import QuoteDetail from './pages/QuoteDetail';
import QuotePrint from './pages/QuotePrint';
import Engineers from './pages/Engineers';
import EngineerDetail from './pages/EngineerDetail';
import Stock from './pages/Stock';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import PartDetail from './pages/PartDetail';
import Compliance from './pages/Compliance';
import Invoicing from './pages/Invoicing';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';
import MobileApp from './mobile/MobileApp';

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return location.pathname === '/login' ? <Login /> : <Navigate to="/login" replace />;
  return (
    <AiProvider>
      <Routes>
        <Route path="/login" element={<Navigate to={user.role === 'engineer' ? '/m' : '/'} replace />} />
        <Route path="/m/*" element={<MobileApp />} />
        <Route path="/quotes/:id/print" element={<QuotePrint />} />
        <Route element={<Layout />}>
          <Route index element={user.role === 'engineer' ? <Navigate to="/m" replace /> : <Dashboard />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="inbox/:id" element={<Inbox />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/new" element={<NewJob />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="sites/:id" element={<SiteDetail />} />
          <Route path="equipment" element={<Equipment />} />
          <Route path="assets/:id" element={<AssetDetail />} />
          <Route path="contracts" element={<Contracts />} />
          <Route path="contracts/:id" element={<ContractDetail />} />
          <Route path="ppm" element={<Ppm />} />
          <Route path="quotes" element={<Quotes />} />
          <Route path="quotes/:id" element={<QuoteDetail />} />
          <Route path="engineers" element={<Engineers />} />
          <Route path="engineers/:id" element={<EngineerDetail />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/parts/:id" element={<PartDetail />} />
          <Route path="stock/purchase-orders/:id" element={<PurchaseOrderDetail />} />
          <Route path="compliance" element={<Compliance />} />
          <Route path="invoicing" element={<Invoicing />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<div className="p-8 text-muted">Page not found.</div>} />
        </Route>
      </Routes>
    </AiProvider>
  );
}
