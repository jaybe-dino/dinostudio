import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

export default function Navbar() {
  const { lang, setLang } = useLang();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("");

  const navLinks = [
    { labelKey: "about", href: "#about" },
    { labelKey: "solutions", href: "#solutions" },
    { labelKey: "tiktok", href: "#tiktokshop", highlight: true },
    { labelKey: "partners", href: "#results" },
    { labelKey: "channels", href: "#channels" },
    { labelKey: "contact", href: "#contact" },
  ];

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 60);
      const sections = navLinks.map((l) => l.href.slice(1));
      for (const id of [...sections].reverse()) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) {
          setActiveSection(id);
          break;
        }
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleNavClick = (href: string) => {
    setMobileOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={{
        background: scrolled ? "rgba(3,3,10,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(124,58,237,0.15)" : "none",
        boxShadow: scrolled ? "0 4px 30px rgba(0,0,0,0.5)" : "none",
      }}
    >
      <div className="container flex items-center justify-between h-16 md:h-20">
        {/* Logo */}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex items-center gap-2 group"
        >
          <div className="relative w-8 h-8 mr-1">
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)", boxShadow: "0 0 15px rgba(124,58,237,0.5)" }}
            />
            <div className="absolute inset-1 rounded-full" style={{ background: "rgba(3,3,10,0.8)" }} />
            <div className="absolute inset-0 flex items-center justify-center text-white font-black text-xs" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              D
            </div>
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="font-black text-lg md:text-xl text-white tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.03em" }}>
              DINO
            </span>
            <span
              className="font-black text-lg md:text-xl tracking-tight"
              style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.03em", background: "linear-gradient(135deg, #c4b5fd, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              STUDIO
            </span>
          </div>
        </a>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const id = link.href.slice(1);
            const isActive = activeSection === id;
            const isHighlight = (link as any).highlight;
            const label = t("nav", link.labelKey, lang);
            return (
              <button
                key={link.href}
                onClick={() => handleNavClick(link.href)}
                className="relative px-4 py-2 text-sm font-medium transition-all duration-200 flex items-center gap-1.5"
                style={{
                  color: isHighlight
                    ? isActive ? "#69C9D0" : "rgba(105,201,208,0.75)"
                    : isActive ? "white" : "rgba(255,255,255,0.5)",
                }}
              >
                {isHighlight && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z" fill="currentColor"/>
                  </svg>
                )}
                {label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                    style={{ background: isHighlight ? "#69C9D0" : "#7c3aed", boxShadow: isHighlight ? "0 0 6px #69C9D0" : "0 0 6px #7c3aed" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* CTA + Lang Toggle */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language Toggle */}
          <div
            className="flex items-center text-xs font-bold rounded-full overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)" }}
          >
            <button
              onClick={() => setLang("ko")}
              className="px-3 py-1.5 transition-all duration-200"
              style={{
                color: lang === "ko" ? "#fff" : "rgba(255,255,255,0.35)",
                background: lang === "ko" ? "rgba(124,58,237,0.4)" : "transparent",
              }}
            >
              KO
            </button>
            <button
              onClick={() => setLang("en")}
              className="px-3 py-1.5 transition-all duration-200"
              style={{
                color: lang === "en" ? "#fff" : "rgba(255,255,255,0.35)",
                background: lang === "en" ? "rgba(124,58,237,0.4)" : "transparent",
              }}
            >
              EN
            </button>
          </div>
          <button
            onClick={() => handleNavClick("#contact")}
            className="btn-cosmic-primary text-sm px-5 py-2.5"
          >
            {t("nav", "cta", lang)}
          </button>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden text-white/70 hover:text-white p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div
          className="md:hidden"
          style={{ background: "rgba(3,3,10,0.97)", borderTop: "1px solid rgba(124,58,237,0.15)", backdropFilter: "blur(20px)" }}
        >
          <div className="container py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <button
                key={link.href}
                onClick={() => handleNavClick(link.href)}
                className="text-left px-4 py-3 text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                {t("nav", link.labelKey, lang)}
              </button>
            ))}
            {/* Mobile lang toggle */}
            <div className="flex items-center gap-2 px-4 py-2">
              <button
                onClick={() => setLang("ko")}
                className="text-xs font-bold px-3 py-1.5 rounded-full transition-all"
                style={{
                  color: lang === "ko" ? "#fff" : "rgba(255,255,255,0.4)",
                  background: lang === "ko" ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                KO
              </button>
              <button
                onClick={() => setLang("en")}
                className="text-xs font-bold px-3 py-1.5 rounded-full transition-all"
                style={{
                  color: lang === "en" ? "#fff" : "rgba(255,255,255,0.4)",
                  background: lang === "en" ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                EN
              </button>
            </div>
            <button
              onClick={() => handleNavClick("#contact")}
              className="btn-cosmic-primary text-sm px-5 py-3 mt-2 text-center"
            >
              {t("nav", "cta", lang)}
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
