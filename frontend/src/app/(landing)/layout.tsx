import "./landing.css";
import { LandingShell } from "@/components/layout/landing-shell";

export default function LandingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <LandingShell>{children}</LandingShell>;
}
