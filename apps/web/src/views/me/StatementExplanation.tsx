import { useState } from "react";
import { Languages, Sparkles } from "lucide-react";
import { api, ApiError } from "../../api.ts";
import type { Explanation } from "../../types.ts";
import { Button } from "../../ui/Button.tsx";
import type { ToastMessage } from "../../components/Toasts.tsx";

type Language = "en" | "es" | "fr" | "hi" | "zh" | "pt";
type PushToast = (toast: Omit<ToastMessage, "id">) => void;

const LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "hi", label: "हिन्दी" },
  { code: "zh", label: "中文" },
  { code: "pt", label: "Português" },
];

function defaultLanguage(): Language {
  const browserLanguage = typeof navigator === "undefined" ? "" : navigator.language.toLowerCase().split("-")[0];
  return LANGUAGES.find((language) => language.code === browserLanguage)?.code ?? "en";
}

export function StatementExplanation({ roundId, businessId, onToast }: {
  roundId: string;
  businessId: string;
  onToast: PushToast;
}) {
  const [language, setLanguage] = useState<Language>(defaultLanguage);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setLoading(true);
    setError(null);
    try {
      setExplanation(await api.explainStatement(roundId, businessId, language));
    } catch (requestError) {
      setExplanation(null);
      setError(requestError instanceof Error ? requestError.message : "The explanation could not be written.");
      onToast(requestError instanceof ApiError
        ? { kind: "error", title: requestError.message, code: requestError.code, debugId: requestError.debugId }
        : { kind: "error", title: requestError instanceof Error ? requestError.message : "The explanation could not be written.", code: null, debugId: null });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border-t line pt-4">
      <h3 className="text-sm font-semibold">Explain in plain words</h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          <Languages size={14} aria-hidden="true" />
          <span className="sr-only">Explanation language</span>
          <select
            className="rounded-md border line bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--ink)]"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value as Language);
              setExplanation(null);
              setError(null);
            }}
            disabled={loading}
          >
            {LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <Button size="sm" onClick={() => void explain()} loading={loading} disabled={loading}>
          {!loading && <Sparkles size={14} />}
          {loading ? "Writing your explanation…" : "Explain"}
        </Button>
      </div>
      {loading && <p role="status" className="mt-3 text-xs text-muted">Writing your explanation…</p>}
      {error !== null && <div className="mt-3 rounded-lg border border-[var(--red)]/30 bg-[var(--red-tint)] p-3 text-sm text-[var(--red)]">
        <p>{error}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void explain()} loading={loading}>Try again</Button>
      </div>}
      {explanation !== null && <div className="mt-4 space-y-3 text-sm">
        <p className="font-semibold">{explanation.headline}</p>
        {explanation.paragraphs.map((paragraph, index) => <p key={`paragraph-${index}`} className="leading-6 text-soft">{paragraph}</p>)}
        <div>
          <h4 className="font-semibold">What to do next</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-soft">
            {explanation.actions.map((action, index) => <li key={`action-${index}`}>{action}</li>)}
          </ul>
        </div>
      </div>}
      <p className="mt-3 text-[10px] leading-4 text-muted">Written by Gemini from your signed statement. Every amount is checked against it.</p>
    </section>
  );
}
