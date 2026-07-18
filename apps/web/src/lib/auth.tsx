import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setToken, getToken } from "./api";

export type Role = "ADMIN" | "MANAGER" | "VIEWER";
export interface User { id: string; name: string; email: string; }
export interface Organization { id: string; name: string; }

interface AuthState {
  user: User | null;
  organization: Organization | null;
  role: Role | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: { name: string; email: string; password: string; organizationName: string }) => Promise<void>;
  logout: () => void;
  can: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

interface Session { token: string; user: User; organization: Organization; role: Role; }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrg] = useState<Organization | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.get<{ user: User; organization: Organization; role: Role }>("/auth/me")
      .then((d) => { setUser(d.user); setOrg(d.organization); setRole(d.role); })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  function apply(s: Session) {
    setToken(s.token); setUser(s.user); setOrg(s.organization); setRole(s.role);
  }

  const login = async (email: string, password: string) => {
    apply(await api.post<Session>("/auth/login", { email, password }));
  };
  const signup = async (data: { name: string; email: string; password: string; organizationName: string }) => {
    apply(await api.post<Session>("/auth/signup", data));
  };
  const logout = () => { setToken(null); setUser(null); setOrg(null); setRole(null); location.href = "/login"; };
  const can = (...roles: Role[]) => !!role && roles.includes(role);

  return <AuthContext.Provider value={{ user, organization, role, loading, login, signup, logout, can }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
