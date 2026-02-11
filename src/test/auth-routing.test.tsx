import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../app/AuthContext";
import { AppRouter } from "../app/router";
import { ServiceProvider } from "../app/ServiceContext";
import { services } from "../services/mock/mockServices";

function renderApp(path: string) {
  window.history.pushState({}, "", path);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ServiceProvider>
    </QueryClientProvider>
  );
}

describe("auth routing", () => {
  it("redirects unauthenticated users from protected routes to welcome", async () => {
    renderApp("/dashboard");
    expect(await screen.findByText(/Create your Challenger Profile/i)).toBeInTheDocument();
  });

  it("supports password sign in flow", async () => {
    renderApp("/auth/login");
    fireEvent.click(await screen.findByRole("button", { name: /log in/i }));
    expect(await screen.findByText(/Group Dashboard/i)).toBeInTheDocument();
  });

  it("supports google sign in flow", async () => {
    renderApp("/auth/login");
    fireEvent.click(await screen.findByRole("button", { name: /continue with google/i }));
    expect(await screen.findByText(/Group Dashboard/i)).toBeInTheDocument();
  });

  it("supports microsoft sign in flow", async () => {
    renderApp("/auth/login");
    fireEvent.click(await screen.findByRole("button", { name: /continue with microsoft/i }));
    expect(await screen.findByText(/Group Dashboard/i)).toBeInTheDocument();
  });

  it("clears session on logout", async () => {
    await services.authService.loginWithPassword("alex@incentapply.dev", "password123");
    renderApp("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: /log out/i }));
    expect(await screen.findByText(/Create your Challenger Profile/i)).toBeInTheDocument();
  });

  it("renders labeled fields on registration form", async () => {
    renderApp("/auth/register");
    expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
