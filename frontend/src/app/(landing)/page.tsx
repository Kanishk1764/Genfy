"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import GenfyHero from "@landing/components/ui/genfy-hero";
import Example from "@landing/components/ui/image-gallery";
import ToolsTray from "@landing/components/ui/tools-tray";
import StoryMode from "@landing/components/ui/story-mode";
import CinemaGallery from "@landing/components/ui/cinema-gallery";
import Footer from "@landing/components/ui/footer";
import { useTheme } from "@/context/theme-context";

export default function Home() {
  const { isDark } = useTheme();
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.replace("/studio");
    }
  }, [isAuthenticated, loading, router]);

  if (loading || isAuthenticated) {
    return null; // Prevents flashing the landing page content
  }

  return (
    <>
      <GenfyHero isDark={isDark} />
      <Example isDark={isDark} />
      <ToolsTray isDark={isDark} />
      <StoryMode isDark={isDark} />
      <CinemaGallery isDark={isDark} />
      <Footer isDark={isDark} />
    </>
  );
}

