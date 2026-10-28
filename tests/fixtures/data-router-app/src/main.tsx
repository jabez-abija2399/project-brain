import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import Billing from "./screens/Billing";
import Home from "./screens/Home";
import Overview from "./screens/Overview";
import Reviews from "./screens/Reviews";

const Settings = lazy(() => import("./screens/Settings"));

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      {
        path: "dashboard",
        children: [
          { index: true, Component: Overview },
          { path: "reviews", element: <Reviews /> },
          { path: "billing", Component: Billing },
          { path: "settings", element: <Settings /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(<RouterProvider router={router} />);
