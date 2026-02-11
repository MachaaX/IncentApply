import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ServiceProvider } from "./app/ServiceContext";
import { AuthProvider } from "./app/AuthContext";
import { AppRouter } from "./app/router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServiceProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ServiceProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
