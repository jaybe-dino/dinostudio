import React, { createContext, useContext, useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  loading: boolean;
}

const LangContext = createContext<LangContextValue>({
  lang: "ko",
  setLang: () => {},
  loading: true,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ko");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user has manually set a language preference
    const saved = localStorage.getItem("dinostudio_lang") as Lang | null;
    if (saved === "ko" || saved === "en") {
      setLangState(saved);
      setLoading(false);
      return;
    }

    // Auto-detect based on IP country
    fetch("/api/geo")
      .then((r) => r.json())
      .then((data: { country: string }) => {
        const detectedLang: Lang = data.country === "KR" ? "ko" : "en";
        setLangState(detectedLang);
      })
      .catch(() => {
        // Fallback: use browser language
        const browserLang = navigator.language?.toLowerCase();
        setLangState(browserLang.startsWith("ko") ? "ko" : "en");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("dinostudio_lang", l);
  };

  return (
    <LangContext.Provider value={{ lang, setLang, loading }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
