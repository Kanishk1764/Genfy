import React from "react";
import AuthLayout from "@landing/auth/auth-layout";
import Link from "next/link";

export default function TermsPage() {
  return (
    <AuthLayout title="Terms of Service" subtitle="Please read our terms carefully">
      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        <p>Welcome to Genfy. By using our services, you agree to be bound by the following terms and conditions.</p>
        <h3 className="text-white font-bold text-base mt-4">1. Acceptance of Terms</h3>
        <p>By accessing or using any part of the service, you agree to become bound by the terms and conditions of this agreement.</p>
        <h3 className="text-white font-bold text-base mt-4">2. Description of Service</h3>
        <p>Genfy provides a platform for generative AI image creation and management.</p>
        <div className="pt-4 border-t border-white/10 text-center">
          <Link href="/signup" className="text-[#f95738] font-bold hover:underline">Back to Sign Up</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
