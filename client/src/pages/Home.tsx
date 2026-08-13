import { lazy, Suspense, useEffect } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import StarCanvas from "@/components/StarCanvas";

// 초기 뷰포트 밖 컴포넌트들은 lazy load → 초기 번들 크기 감소
const AboutSection = lazy(() => import("@/components/AboutSection"));
const SolutionsSection = lazy(() => import("@/components/SolutionsSection"));
const TikTokSection = lazy(() => import("@/components/TikTokSection"));
const YouTubeNetworkSection = lazy(() => import("@/components/YouTubeNetworkSection"));
const ResultsSection = lazy(() => import("@/components/ResultsSection"));
const ChannelsSection = lazy(() => import("@/components/ChannelsSection"));
const TeamSection = lazy(() => import("@/components/TeamSection"));
const ContactSection = lazy(() => import("@/components/ContactSection"));
const Footer = lazy(() => import("@/components/Footer"));

// 섹션 로딩 중 표시할 최소 스켈레톤
function SectionSkeleton() {
  return (
    <div
      style={{
        minHeight: "200px",
        background: "transparent",
      }}
    />
  );
}

export default function Home() {
  useEffect(() => {
    // Scroll reveal observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.08 }
    );

    // 약간의 딜레이 후 observe (lazy 컴포넌트 마운트 대기)
    const timer = setTimeout(() => {
      const elements = document.querySelectorAll(".reveal, .reveal-left, .reveal-scale");
      elements.forEach((el) => observer.observe(el));
    }, 300);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen" style={{ background: "var(--cosmos-void)" }}>
      {/* Global star particle canvas */}
      <StarCanvas />
      <Navbar />
      <HeroSection />

      <Suspense fallback={<SectionSkeleton />}>
        <AboutSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <SolutionsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <TikTokSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <YouTubeNetworkSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <ResultsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <ChannelsSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <TeamSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <ContactSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <Footer />
      </Suspense>
    </div>
  );
}
