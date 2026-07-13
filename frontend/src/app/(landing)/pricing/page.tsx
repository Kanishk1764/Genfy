"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import GenfyNav, { LogoAsterisk } from "@landing/ui/genfy-nav";
import Footer from "@landing/components/ui/footer";
import { useTheme } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";
import api from "@/utils/api";
import { toast } from "sonner";

const CheckIcon = ({ isDark }: { isDark: boolean }) => (
  <svg className={`w-4 h-4 shrink-0 ${isDark ? "text-[#f95738]" : "text-[#f95738]"}`} viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

const tiers = [
  { name: "Starter", price: "Free", sub: "forever", description: "Perfect for individuals exploring AI image generation.", features: ["25 image generations / month", "Standard resolution (512×512)", "5 art styles", "Community gallery access", "Email support"], cta: "Get Started Free", highlighted: false, badge: null },
  { name: "Pro", price: "$19", sub: "/ month", description: "For creators who want to push their creative limits.", features: ["500 image generations / month", "HD resolution (1024×1024)", "50+ art styles", "Priority rendering queue", "Advanced prompt editor", "Download in PNG & SVG", "Priority support"], cta: "Start Pro Trial", highlighted: true, badge: "Most Popular" },
  { name: "Enterprise", price: "$79", sub: "/ month", description: "Full power for high-volume production pipelines.", features: ["Unlimited image generations", "4K Ultra resolution", "Custom-trained models", "API access", "Priority support", "Custom art style uploads", "Dedicated account manager"], cta: "Contact Sales", highlighted: false, badge: null },
];

const enterpriseTiles = [
  {
    title: "Security & Compliance",
    desc: "Designed for privacy and security, SOC 2 Type 2 coming soon, and your data is never used for model training",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04M12 2.944a11.955 11.955 0 01-8.618 3.04m0 0a11.955 11.955 0 00-3.382 8.57c0 5.273 4.117 9.591 9.364 10.383a11.955 11.955 0 001.272 0c5.247-.792 9.364-5.11 9.364-10.383a11.955 11.955 0 00-3.382-8.57z" />
      </svg>
    ),
  },
  {
    title: "Data & usage rights",
    desc: "You retain your rights in every AI generated output - no restrictions to use, edit, or publish anywhere",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
  {
    title: "Admin control",
    desc: "Stay in control - manage settings and usage rights from a single, centralized dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
];

const faqData = [
  { q: "How do credits work?", a: "Credits are the currency of Genfy. Each generation (image or video) consumes a specific number of credits based on the model and resolution. You can track your usage in your dashboard." },
  { q: "Is my subscription automatically renewed?", a: "Yes, all our plans are recurring. However, you can cancel your subscription at any time from your account settings without any cancellation fees." },
  { q: "How many images or videos can I generate?", a: "It depends on your plan. Starter gives you 25, Pro gives you 500, and Enterprise is unlimited. Each model and resolution may have different credit costs." },
  { q: "How can I purchase extra credits?", a: "If you run out of credits, you can purchase one-time credit packs or upgrade your plan to get a higher monthly allowance." },
  { q: "How does Unlimited work?", a: "Unlimited plans allow you to generate as many images as you want. There may be throughput limits to ensure fair usage among all users." },
  { q: "How does 365 Unlimited promo work?", a: "The 365 Unlimited promo is an annual plan that gives you unlimited generations for an entire year at a discounted rate compared to monthly billing." },
  { q: "Can I change my subscription after purchase?", a: "Absolutely! You can upgrade or downgrade your plan at any time. The changes will be applied immediately, and your billing will be prorated." },
];

function FAQAccordion({ isDark }: { isDark: boolean }) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {faqData.map((item, idx) => (
        <div key={idx} className={`rounded-2xl overflow-hidden transition-all duration-300 ${isDark ? "bg-white/[0.04] border border-white/5" : "bg-slate-50 border border-slate-200 text-black"}`}>
          <button onClick={() => setOpenIndex(openIndex === idx ? null : idx)} className="w-full px-8 py-6 flex items-center justify-between text-left">
            <span className={`text-[17px] md:text-[19px] font-bold font-sans ${isDark ? "text-slate-100" : "text-slate-900"}`}>{item.q}</span>
            <svg className={`w-5 h-5 transition-transform duration-300 ${openIndex === idx ? "rotate-180" : ""} ${isDark ? "text-slate-500" : "text-slate-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div className={`transition-all duration-300 ease-in-out ${openIndex === idx ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0"}`}>
            <div className={`px-8 pb-8 text-[15px] leading-relaxed font-sans ${isDark ? "text-slate-300" : "text-slate-700"}`}>{item.a}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PricingPage() {
  const { isDark } = useTheme();
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [trialLoading, setTrialLoading] = useState(false);

  const handleStartTrial = async () => {
    if (!user) {
      router.push("/signup");
      return;
    }

    setTrialLoading(true);
    try {
      const response = await api.post("/api/users/start-trial");
      if (response.data.status === "success") {
        toast.success("Trial started", { description: "Your 7-day trial is now active." });
        await refreshUser();
        router.push("/studio");
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      if (detail === "Trial already used.") {
        toast.info("Trial already used", { description: "You can continue in the studio or choose a paid plan." });
        router.push("/studio");
        return;
      }
      toast.error("Unable to start trial", { description: detail || "Please try again." });
    } finally {
      setTrialLoading(false);
    }
  };

  return (
    <>
      <section className="max-w-[1400px] mx-auto px-6 pt-20 pb-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 mb-5">
            <LogoAsterisk className="text-[#f95738] w-4 h-4" />
            <span className="text-[#f95738] text-[13px] font-semibold tracking-widest uppercase">Pricing</span>
            <LogoAsterisk className="text-[#f95738] w-4 h-4" />
          </div>
          <h1 id="pricing-plans" className={`text-[40px] md:text-[58px] font-black tracking-[-0.03em] leading-[1.05] uppercase mb-4 ${isDark ? "text-transparent bg-clip-text bg-gradient-to-tr from-slate-500 via-slate-100 to-white" : "text-black"}`}>
            Simple Transparent<br />Pricing
          </h1>
          <p className={`text-[16px] md:text-[17px] max-w-lg mx-auto leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Choose a plan that fits your workflow. No hidden fees, no surprises — just pure creative freedom.
          </p>
        </div>

        {/* Pricing Cards Grid Container */}
        <div className="relative z-20 mt-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {tiers.map((tier) => (
              <div key={tier.name} className={`relative rounded-[28px] p-8 flex flex-col gap-7 transition-all duration-300 ${tier.highlighted ? "bg-[#f95738] shadow-2xl shadow-[#f95738]/30 scale-[1.03]" : isDark ? "bg-white/[0.04] border border-white/[0.07] hover:border-white/[0.15] hover:bg-white/[0.07]" : "bg-slate-50 border border-slate-200 hover:border-slate-300 hover:shadow-lg"}`}>
                {tier.badge && <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-white text-[#f95738] text-[11px] font-bold px-4 py-1 rounded-full tracking-wider uppercase shadow-md">{tier.badge}</span>}
                <div>
                  <p className={`text-[12px] font-bold tracking-widest uppercase mb-3 ${tier.highlighted ? "text-white/70" : "text-[#f95738]"}`}>{tier.name}</p>
                  <div className="flex items-end gap-1 mb-3">
                    <span className={`text-[48px] font-black leading-none tracking-tight ${tier.highlighted ? "text-white" : isDark ? "text-white" : "text-black"}`}>{tier.price}</span>
                    <span className={`text-[15px] font-semibold mb-2 ${tier.highlighted ? "text-white/60" : "text-slate-400"}`}>{tier.sub}</span>
                  </div>
                  <p className={`text-[14px] leading-relaxed ${tier.highlighted ? "text-white/75" : isDark ? "text-slate-400" : "text-slate-500"}`}>{tier.description}</p>
                </div>
                <div className={`h-px w-full ${tier.highlighted ? "bg-white/20" : isDark ? "bg-white/10" : "bg-slate-200"}`}></div>
                <ul className="flex flex-col gap-3 flex-1">
                  {tier.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-3">
                      <span className={`mt-0.5 rounded-full p-0.5 shrink-0 ${tier.highlighted ? "bg-white/20" : "bg-[#f95738]/10"}`}>
                        <svg className={`w-3 h-3 ${tier.highlighted ? "text-white" : "text-[#f95738]"}`} viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                      <span className={`text-[14px] leading-snug ${tier.highlighted ? "text-white/85" : isDark ? "text-slate-300" : "text-slate-600"}`}>{feat}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={tier.name === "Starter" ? handleStartTrial : undefined}
                  disabled={tier.name === "Starter" && trialLoading}
                  className={`w-full py-3.5 rounded-full text-[15px] font-bold tracking-wide transition-all duration-200 ${tier.highlighted ? "bg-white text-[#f95738] hover:bg-slate-100 shadow-lg" : "bg-[#f95738] text-white hover:bg-[#e04e2d] shadow-lg shadow-[#f95738]/20"} disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {tier.name === "Starter" && trialLoading ? "Starting Trial..." : tier.name === "Starter" ? "Start 7-Day Trial" : tier.cta}
                </button>
              </div>
            ))}
          </div>
        </div>

        <p className={`text-center mt-12 mb-32 text-[13px] ${isDark ? "text-slate-600" : "text-slate-400"}`}>
          All plans include a 7-day free trial. No credit card required for Starter.
        </p>

        {/* Enterprise Section */}
        <div className={`relative rounded-[40px] overflow-hidden p-8 md:p-12 mb-32 transition-colors duration-300 ${isDark ? "bg-white/[0.03] border border-white/10" : "bg-slate-50 border border-slate-200"
          }`}>
          {isDark && (
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#f95738]/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          )}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-0">
            <div className="lg:col-span-8 lg:pr-12 lg:border-r border-white/10">
              <h2 className={`text-3xl md:text-[44px] font-black tracking-tight leading-[1.1] mb-6 ${isDark ? "text-white" : "text-black"}`}>
                Enterprise solutions for high-performance creative production at scale
              </h2>
              <p className={`text-lg mb-10 leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Tailored workflows, dedicated support, seamless onboarding, full control at scale, and no training on your data
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {enterpriseTiles.map((tile) => (
                  <div key={tile.title} className={`p-5 rounded-2xl ${isDark ? "bg-white/[0.05]" : "bg-white border border-slate-200"}`}>
                    <div className="text-[#f95738] mb-3">{tile.icon}</div>
                    <h4 className={`text-sm font-bold mb-2 ${isDark ? "text-white" : "text-black"}`}>{tile.title}</h4>
                    <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>{tile.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 lg:pl-12 flex flex-col justify-between">
              <div>
                <p className={`text-sm font-bold mb-6 ${isDark ? "text-slate-400" : "text-slate-500"}`}>Everything on Business Plan and...</p>
                <ul className="grid grid-cols-1 gap-3.5 mb-12">
                  {[
                    "Custom credits amount",
                    "Higher custom concurrency",
                    "Access to any unlimited model you need",
                    "Volume-based discounts at the best rates",
                    "Priority queue for faster task processing",
                    "Dedicated support and training"
                  ].map((feat) => (
                    <li key={feat} className="flex items-center gap-3">
                      <CheckIcon isDark={isDark} />
                      <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-4">
                <button className={`w-full py-4 rounded-full font-bold transition-all shadow-lg ${isDark ? "bg-white text-black hover:bg-slate-100" : "bg-black text-white hover:bg-slate-800"}`}>
                  Contact Sales
                </button>
                <button className={`w-full py-4 rounded-full font-bold transition-all border ${isDark ? "border-white/10 text-white hover:bg-white/5" : "border-slate-200 text-black hover:bg-slate-50"}`}>
                  Learn More
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="relative z-10 max-w-4xl mx-auto mb-32">
          <h2 className={`text-[32px] md:text-[50px] font-bold tracking-tight text-center mb-16 font-sans ${isDark ? "text-white" : "text-black"}`}>
            Frequently Asked Questions
          </h2>
          <FAQAccordion isDark={isDark} />
          <div className="flex flex-col md:flex-row items-center justify-center gap-6 mt-20">
            <span className={`text-xl md:text-2xl font-bold ${isDark ? "text-slate-400" : "text-slate-500"}`}>Are you ready?</span>
            <button onClick={() => document.getElementById("pricing-plans")?.scrollIntoView({ behavior: "smooth" })} className="px-10 py-4 rounded-full bg-[#f95738] text-white font-bold text-lg hover:scale-105 transition-transform shadow-lg shadow-[#f95738]/20">
              Choose your plan
            </button>
          </div>
        </div>
      </section>

      <Footer isDark={isDark} />
    </>
  );
}
