import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type { AuthSession, User } from "../domain/types";
import { useServices } from "./ServiceContext";

interface AuthContextValue {
  session: AuthSession | null;
  user: User | null;
  loading: boolean;
  updateProfile: (input: {
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl?: string | null;
  }) => Promise<void>;
  signInWithGoogle: (email?: string) => Promise<void>;
  signUpWithGoogle: (email?: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  registerWithEmail: (input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { authService } = useServices();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextSession = await authService.getSession();
      const nextUser = await authService.getCurrentUser();
      setSession(nextSession);
      setUser(nextUser);
    } finally {
      setLoading(false);
    }
  }, [authService]);

  useEffect(() => {
    void load();
  }, [load]);

  const signInWithGoogle = useCallback(
    async (email?: string) => {
      setLoading(true);
      try {
        const nextSession = await authService.loginWithGoogle(email);
        const nextUser = await authService.getCurrentUser();
        setSession(nextSession);
        setUser(nextUser);
      } finally {
        setLoading(false);
      }
    },
    [authService]
  );

  const signUpWithGoogle = useCallback(
    async (email?: string) => {
      setLoading(true);
      try {
        const nextSession = await authService.registerWithGoogle(email);
        const nextUser = await authService.getCurrentUser();
        setSession(nextSession);
        setUser(nextUser);
      } finally {
        setLoading(false);
      }
    },
    [authService]
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const nextSession = await authService.loginWithPassword(email, password);
        const nextUser = await authService.getCurrentUser();
        setSession(nextSession);
        setUser(nextUser);
      } finally {
        setLoading(false);
      }
    },
    [authService]
  );

  const registerWithEmail = useCallback(
    async (input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
    }) => {
      setLoading(true);
      try {
        const nextSession = await authService.registerWithEmail(input);
        const nextUser = await authService.getCurrentUser();
        setSession(nextSession);
        setUser(nextUser);
      } finally {
        setLoading(false);
      }
    },
    [authService]
  );

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await authService.logout();
      setSession(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [authService]);

  const updateProfile = useCallback(
    async (input: {
      firstName: string;
      lastName: string;
      email: string;
      avatarUrl?: string | null;
    }) => {
      const updated = await authService.updateProfile(input);
      setUser(updated);
    },
    [authService]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      loading,
      updateProfile,
      signInWithGoogle,
      signUpWithGoogle,
      signInWithPassword,
      registerWithEmail,
      signOut
    }),
    [
      loading,
      registerWithEmail,
      session,
      signInWithGoogle,
      signUpWithGoogle,
      signInWithPassword,
      signOut,
      updateProfile,
      user
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
