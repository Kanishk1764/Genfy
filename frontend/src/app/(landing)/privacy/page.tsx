import React from "react";
import AuthLayout from "@landing/auth/auth-layout";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <AuthLayout title="Privacy Policy" subtitle="How we handle your data">
      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        <p>Your privacy is important to us. This policy explains how we collect, use, and protect your personal information.</p>
        <h3 className="text-white font-bold text-base mt-4">1. Data Collection</h3>
        <p>We collect information you provide directly to us when you create an account or use our AI generation tools.</p>
        <h3 className="text-white font-bold text-base mt-4">2. Use of Information</h3>
        <p>We use the information we collect to provide, maintain, and improve our services.</p>
        <div className="pt-4 border-t border-white/10 text-center">
          <Link href="/signup" className="text-[#f95738] font-bold hover:underline">Back to Sign Up</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
