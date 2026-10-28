import { Auth } from "./components/Auth";
import { Dashboard } from "./components/Dashboard";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

function Screen() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <Auth />;
}

export default function App() {
  return (
    <AuthProvider>
      <Screen />
    </AuthProvider>
  );
}
