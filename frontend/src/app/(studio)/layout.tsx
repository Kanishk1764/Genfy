import { AuthGuard } from "@/components/auth/auth-guard";
import { StudioShell } from "./studio-shell";

export default function StudioLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthGuard requireAuth={true}>
      <StudioShell>{children}</StudioShell>
    </AuthGuard>
  );
}

