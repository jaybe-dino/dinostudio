import { useState } from "react";
import { Send, Rocket, Mail, Calendar, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLang } from "@/contexts/LangContext";
import { t } from "@/lib/i18n";

export default function ContactSection() {
  const { lang } = useLang();
  const [form, setForm] = useState({ name: "", company: "", solution: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submitMutation = trpc.contact.submit.useMutation({
    onSuccess: () => { setSubmitted(true); setErrorMsg(null); },
    onError: (err) => { setErrorMsg(err.message || t("contact", "errorMsg", lang)); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.company.trim()) return;
    submitMutation.mutate({
      name: form.name,
      company: form.company,
      solution: form.solution || undefined,
      message: form.message || undefined,
    });
  };

  return (
    <section id="contact" className="py-20 md:py-28 relative overflow-hidden"
      style={{ background: "linear-gradient(180deg, var(--cosmos-void) 0%, var(--cosmos-nebula) 100%)" }}
    >
      <div className="cosmic-orb" style={{ width: "600px", height: "600px", background: "radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }} />
      <div className="cosmic-grid absolute inset-0 opacity-20" />

      <div className="container">
        <div className="grid lg:grid-cols-2 gap-14 items-start">
          {/* Left */}
          <div>
            <div className="cosmic-label mb-5">{t("contact", "sectionLabel", lang)}</div>
            <h2 className="font-black text-4xl md:text-5xl text-white mb-6"
              style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif", letterSpacing: "-0.04em", lineHeight: "1.05" }}
            >
              {t("contact", "headline1", lang)}
              <br />
              <span className="text-cosmic-gradient">{t("contact", "headline2", lang)}</span>
            </h2>

            <div className="space-y-3">
              <a href="mailto:chief@dinostudio.kr"
                className="cosmic-card flex items-center gap-4 p-5 hover:border-violet-500/40 transition-all"
              >
                <div className="w-10 h-10 flex items-center justify-center" style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}>
                  <Mail size={16} />
                </div>
                <div>
                  <div className="text-xs text-white/30 mb-0.5">{t("contact", "emailLabel", lang)}</div>
                  <div className="text-sm font-bold text-white">chief@dinostudio.kr</div>
                </div>
              </a>

              <a href="https://scheduler.zoom.us/jeong-bal-hur/pvt-meeting-25min" target="_blank" rel="noopener noreferrer"
                className="cosmic-card flex items-center gap-4 p-5 hover:border-cyan-500/40 transition-all"
              >
                <div className="w-10 h-10 flex items-center justify-center" style={{ background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", color: "#67e8f9" }}>
                  <Calendar size={16} />
                </div>
                <div>
                  <div className="text-xs text-white/30 mb-0.5">{t("contact", "meetingLabel", lang)}</div>
                  <div className="text-sm font-bold text-white">{t("contact", "meetingCta", lang)}</div>
                </div>
              </a>
            </div>
          </div>

          {/* Right: Form */}
          <div>
            {submitted ? (
              <div className="cosmic-card p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center rounded-full animate-pulse-glow"
                  style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)" }}
                >
                  <Rocket size={28} style={{ color: "#c4b5fd" }} />
                </div>
                <h3 className="font-black text-2xl text-white mb-3" style={{ fontFamily: "'Space Grotesk', 'Pretendard', sans-serif" }}>
                  {t("contact", "successTitle", lang)}
                </h3>
                <p className="text-white/45 text-sm">{t("contact", "successSub", lang)}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="cosmic-card p-8 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-white/35 mb-2 uppercase tracking-wider">{t("contact", "fieldName", lang)}</label>
                    <input type="text" required value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      placeholder={t("contact", "placeholderName", lang)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-white/35 mb-2 uppercase tracking-wider">{t("contact", "fieldCompany", lang)}</label>
                    <input type="text" required value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      placeholder={t("contact", "placeholderCompany", lang)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-white/35 mb-2 uppercase tracking-wider">{t("contact", "fieldSolution", lang)}</label>
                  <select required value={form.solution}
                    onChange={(e) => setForm({ ...form, solution: e.target.value })}
                    className="w-full px-4 py-3 text-sm text-white outline-none transition-all"
                    style={{ background: "rgba(13,13,43,0.95)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <option value="" style={{ background: "#0d0d2b" }}>{t("contact", "solutionPlaceholder", lang)}</option>
                    <option value="commerce-gonggu" style={{ background: "#0d0d2b" }}>{t("contact", "sol1", lang)}</option>
                    <option value="commerce-youtube" style={{ background: "#0d0d2b" }}>{t("contact", "sol2", lang)}</option>
                    <option value="commerce-tiktok" style={{ background: "#0d0d2b" }}>{t("contact", "sol3", lang)}</option>
                    <option value="ip" style={{ background: "#0d0d2b" }}>{t("contact", "sol4", lang)}</option>
                    <option value="finance-fund" style={{ background: "#0d0d2b" }}>{t("contact", "sol5", lang)}</option>
                    <option value="finance-invest" style={{ background: "#0d0d2b" }}>{t("contact", "sol6", lang)}</option>
                    <option value="finance-equity" style={{ background: "#0d0d2b" }}>{t("contact", "sol7", lang)}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-white/35 mb-2 uppercase tracking-wider">{t("contact", "fieldMessage", lang)}</label>
                  <textarea required rows={4} value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    placeholder={t("contact", "placeholderMessage", lang)}
                  />
                </div>

                {errorMsg && (
                  <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
                    <AlertCircle size={15} />{errorMsg}
                  </div>
                )}
                <button type="submit" disabled={submitMutation.isPending} className="btn-cosmic-primary w-full flex items-center justify-center gap-2 py-4 text-sm" style={{ opacity: submitMutation.isPending ? 0.6 : 1 }}>
                  {submitMutation.isPending
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("contact", "sending", lang)}</>
                    : <><Send size={15} />{t("contact", "submitBtn", lang)}</>
                  }
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
