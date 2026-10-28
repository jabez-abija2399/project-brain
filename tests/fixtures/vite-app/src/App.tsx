import { BrowserRouter, Route, Routes } from "react-router-dom";
import Billing from "./pages/Billing";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ReviewDetail from "./pages/ReviewDetail";
import Reviews from "./pages/Reviews";
import Settings from "./pages/Settings";

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/reviews" element={<Reviews />} />
      <Route path="/reviews/:id" element={<ReviewDetail />} />
      <Route path="/billing" element={<Billing />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
