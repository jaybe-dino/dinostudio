import { ExternalLink, Mail, MapPin, Building2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

export default function Footer() {
  const { lang } = useLang();

  const navLinks = [
    { labelKey: "about", href: "#about" },
    { labelKey: "solutions", href: "#solutions" },
    { labelKey: "tiktok", href: "#tiktokshop" },
    { labelKey: "channels", href: "#channels" },
    { labelKey: "cta", href: "#contact" },
  ];

  const channels = [
    { name: "의적단", nameEn: "Uijeokdan", url: "https://www.youtube.com/@studiosilok", noteKey: "ch1Note" },
    { name: "부당거래", nameEn: "Budang Gerae", url: "https://www.youtube.com/@%EB%B6%80%EB%8B%B9%EA%B1%B0%EB%9E%98-d1z", noteKey: "ch2Note" },
    { name: "문복희 (딜리버리)", nameEn: "Moonbokee (Delivery)", url: "https://www.youtube.com/@mukboki", noteKey: "ch3Note" },
  ];

  return (
    <footer
      className="relative overflow-hidden"
      style={{ background: "rgba(3,3,10,1)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.4), rgba(105,201,208,0.4), transparent)" }}
      />

      <div className="container py-14">
        <div className="grid md:grid-cols-3 gap-10 mb-10">
          {/* Brand + Company Info */}
          <div>
            <div className="flex items-baseline gap-0.5 mb-3">
              <span className="font-black text-2xl text-white" style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.03em" }}>
                DINO
              </span>
              <span
                className="font-black text-2xl"
                style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.03em", background: "linear-gradient(135deg, #c4b5fd, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
              >
                STUDIO
              </span>
            </div>
            <p className="text-xs text-white/35 leading-relaxed mb-5">
              {t("footer", "tagline", lang)}
            </p>

            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <MapPin size={12} className="flex-shrink-0 mt-0.5" style={{ color: "#c4b5fd" }} />
                <div className="text-xs text-white/30 leading-relaxed">
                  {t("footer", "address", lang)}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <Building2 size={12} className="flex-shrink-0" style={{ color: "#c4b5fd" }} />
                <div className="text-xs text-white/30">
                  {t("footer", "bizNumber", lang)}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <Mail size={12} className="flex-shrink-0" style={{ color: "#c4b5fd" }} />
                <a
                  href="mailto:contact@dinostudio.kr"
                  className="text-xs transition-colors hover:text-white/60"
                  style={{ color: "rgba(255,255,255,0.30)" }}
                >
                  contact@dinostudio.kr
                </a>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-xs font-bold text-white/25 uppercase tracking-widest mb-5">
              Navigation
            </h4>
            <ul className="space-y-2.5">
              {navLinks.map((l) => (
                <li key={l.labelKey}>
                  <a
                    href={l.href}
                    onClick={(e) => {
                      e.preventDefault();
                      document.querySelector(l.href)?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="text-sm text-white/40 hover:text-white/75 transition-colors"
                  >
                    {t("nav", l.labelKey, lang)}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Channels */}
          <div>
            <h4 className="text-xs font-bold text-white/25 uppercase tracking-widest mb-5">
              Channels
            </h4>
            <ul className="space-y-3">
              {channels.map((ch) => (
                <li key={ch.name}>
                  <a
                    href={ch.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm text-white/45 group-hover:text-white/80 transition-colors font-medium">
                        {lang === "ko" ? ch.name : ch.nameEn}
                      </div>
                      <div className="text-xs text-white/20">{t("footer", ch.noteKey, lang)}</div>
                    </div>
                    <ExternalLink size={12} className="text-white/15 group-hover:text-white/45 transition-colors" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-8"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="text-xs text-white/20">
            {t("footer", "copyright", lang)}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "#34d399", boxShadow: "0 0 6px #34d399", animation: "pulse-glow 2s ease-in-out infinite" }}
            />
            <span className="text-xs text-white/25">{t("footer", "available", lang)}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
