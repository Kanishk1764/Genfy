"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/utils/api";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
  plan_type: string;
  email_verified: boolean;
  can_generate_video?: boolean;
  next_action: string;
  tos_accepted_at?: string | null;
  tos_version?: string | null;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (userData: any) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const hasChecked = React.useRef(false);

  const refreshUser = useCallback(async () => {
    try {
      const response = await api.get("/api/users/me");
      if (response.data.status === "success") {
        setUser(response.data.user);
      } else {
        setUser(null);
      }
    } catch (error: any) {
      // 401 means no valid session — clear user and stop
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;
    refreshUser();
  }, [refreshUser]);

  const login = (userData: any) => {
    setUser(userData);
    setLoading(false);
  };

  const logout = async () => {
    try {
      await api.post("/api/users/logout");
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setUser(null);
      router.push("/login");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
