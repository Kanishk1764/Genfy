"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "@/context/auth-context";
import { ThemeProvider } from "@/context/theme-context";
import { AuthModalProvider } from "@/context/auth-modal-context";
import { AuthModal } from "@/components/auth/auth-modal";
import { TosModal } from "@/components/legal/tos-modal";
import React from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || "";
  const isGoogleConfigured = Boolean(clientId);

  const authContent = (
    <ThemeProvider>
      <AuthProvider>
        <AuthModalProvider>
          {children}
          <AuthModal />
          <TosModal />
        </AuthModalProvider>
      </AuthProvider>
    </ThemeProvider>
  );

  if (!isGoogleConfigured) {
    return authContent;
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {authContent}
    </GoogleOAuthProvider>
  );
}
