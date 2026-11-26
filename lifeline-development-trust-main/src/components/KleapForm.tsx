"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

/**
 * KleapForm — built-in form collection for Astro apps (React island).
 *
 * Submissions go straight to the user's Kleap dashboard with ZERO setup, exactly
 * like the Next.js KleapForm: it POSTs multipart/form-data to https://form.kleap.co
 * with { app_id, form_id, form_name, ...fields }. The endpoint is public + CORS-open
 * and resolves the app from PUBLIC_APP_ID when inlined, otherwise from the request
 * Origin hostname ({slug}.kleap.io or a custom domain) — so a static site on
 * Cloudflare Workers collects submissions without any server code.
 *
 * Self-contained on purpose: plain inputs + Tailwind, no shadcn/react-hook-form/zod
 * imports, so it always builds regardless of which ui primitives an app has.
 *
 * Usage (hydrate with a client directive — it's interactive):
 *   import KleapForm from "@/components/KleapForm";
 *   <KleapForm client:load formId="contact" title="Contact Us" fields={[
 *     { name: "name", label: "Name", type: "text", required: true },
 *     { name: "email", label: "Email", type: "email", required: true },
 *     { name: "message", label: "Message", type: "textarea", required: true },
 *   ]} submitText="Send" successMessage="Thanks — we'll be in touch!" />
 *
 * Extra field types (KLE-1208 D):
 *   { name: "phone", label: "Phone", type: "phone" }            country code picker + light format check
 *   { name: "slot", label: "Preferred", type: "radio", options: ["Morning", "Evening"] }
 *   { name: "day", label: "Date", type: "date", min: "today" }  also "time" and "datetime"
 *   { name: "source", label: "Source", type: "hidden", param: "utm" }  records utm_* / gclid / referrer
 * "tel" stays a plain input on purpose: forms already published keep their exact look.
 * Files (photos, CV, any document): `{ name: "photos", label: "Photos", type: "file",
 * accept: "image/*", multiple: true }`. Kleap stores them privately and the owner
 * sees them in the dashboard and in the notification e-mail. Limits: 10 MB per
 * file, 25 MB and 10 files per message; programs and scripts are refused.
 */

export interface KleapFormField {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "tel"
    | "url"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio"
    | "date"
    | "time"
    | "datetime"
    | "phone"
    | "hidden"
    | "file";
  placeholder?: string;
  /** file: allowed types, as the HTML attribute ("image/*", ".pdf,.doc,.docx"). */
  accept?: string;
  /** file: let the visitor pick several files. */
  multiple?: boolean;
  required?: boolean;
  // A select option is either a bare string or the standard {value,label} pair.
  // The type used to allow only strings while the model writes the pair — the
  // shape every React/HTML tutorial uses — and the component then rendered the
  // OBJECT as a child: "Objects are not valid as a React child (found: object
  // with keys {value, label})", which fails `astro build` and ships NO site at
  // all. Accepting both is one line here and removes a total build failure.
  options?: (string | { value: string; label: string })[]; // for select / radio
  rows?: number; // for textarea
  /** date / time / datetime bounds. "today" = the visitor's current date. */
  min?: string;
  max?: string;
  /** phone: ISO country preselected (e.g. "CH"). Default follows the site language. */
  defaultCountry?: string;
  /** hidden: fixed value used when the URL carries nothing. */
  value?: string;
  /**
   * hidden: URL query parameter to copy (default: the field name). "utm" =
   * every utm_* parameter plus gclid / fbclid, else the referring site, else "direct".
   */
  param?: string;
}

export interface KleapFormProps {
  /** Logical form name shown in the dashboard, e.g. "contact" | "newsletter" | "booking". */
  formId: string;
  title?: string;
  description?: string;
  fields: KleapFormField[];
  submitText?: string;
  successMessage?: string;
  className?: string;
}

/**
 * Textes par défaut dans la langue du SITE (même résolution que KleapAuth :
 * PUBLIC_KLEAP_LANG estampé au build → <html lang> → anglais). Banc qualité
 * KLE-548 : sur des sites français, la relecture visuelle relevait « Select… »
 * et « Sending… » en anglais au milieu d'une page en français.
 */
const FORM_STRINGS: Record<
  string,
  {
    select: string;
    sending: string;
    error: string;
    submit: string;
    success: string;
    phoneInvalid: string;
    country: string;
    fileTooBig: string;
    fileType: string;
    tooManyFiles: string;
    busy: string;
  }
> = {
  en: {
    phoneInvalid: "Please enter a valid phone number.",
    country: "Country code",
    select: "Select…",
    sending: "Sending…",
    error: "Something went wrong — please try again.",
    submit: "Submit",
    success: "Thank you! Your submission has been received.",
    fileTooBig: "A file is too large (max 10 MB per file, 25 MB in total).",
    fileType: "This type of file is not accepted.",
    tooManyFiles: "Too many files (max 10).",
    busy: "Too many messages sent — please try again later.",
  },
  fr: {
    phoneInvalid: "Merci d'indiquer un numéro de téléphone valide.",
    country: "Indicatif",
    select: "Choisir…",
    sending: "Envoi…",
    error: "Une erreur est survenue — merci de réessayer.",
    submit: "Envoyer",
    success: "Merci ! Votre message a bien été reçu.",
    fileTooBig:
      "Un fichier est trop lourd (10 Mo maximum par fichier, 25 Mo au total).",
    fileType: "Ce type de fichier n'est pas accepté.",
    tooManyFiles: "Trop de fichiers (10 maximum).",
    busy: "Trop d'envois — merci de réessayer plus tard.",
  },
  es: {
    phoneInvalid: "Introduce un número de teléfono válido.",
    country: "Prefijo",
    select: "Elegir…",
    sending: "Enviando…",
    error: "Algo salió mal — inténtalo de nuevo.",
    submit: "Enviar",
    success: "¡Gracias! Hemos recibido tu mensaje.",
    fileTooBig:
      "Un archivo es demasiado grande (máx. 10 MB por archivo, 25 MB en total).",
    fileType: "Este tipo de archivo no se acepta.",
    tooManyFiles: "Demasiados archivos (máx. 10).",
    busy: "Demasiados envíos — inténtalo más tarde.",
  },
  de: {
    phoneInvalid: "Bitte geben Sie eine gültige Telefonnummer ein.",
    country: "Vorwahl",
    select: "Auswählen…",
    sending: "Wird gesendet…",
    error: "Etwas ist schiefgelaufen — bitte erneut versuchen.",
    submit: "Senden",
    success: "Danke! Ihre Nachricht ist eingegangen.",
    fileTooBig:
      "Eine Datei ist zu groß (max. 10 MB pro Datei, 25 MB insgesamt).",
    fileType: "Dieser Dateityp wird nicht akzeptiert.",
    tooManyFiles: "Zu viele Dateien (max. 10).",
    busy: "Zu viele Sendungen — bitte später erneut versuchen.",
  },
  it: {
    phoneInvalid: "Inserisci un numero di telefono valido.",
    country: "Prefisso",
    select: "Scegli…",
    sending: "Invio…",
    error: "Qualcosa è andato storto — riprova.",
    submit: "Invia",
    success: "Grazie! Abbiamo ricevuto il tuo messaggio.",
    fileTooBig:
      "Un file è troppo grande (max 10 MB per file, 25 MB in totale).",
    fileType: "Questo tipo di file non è accettato.",
    tooManyFiles: "Troppi file (max 10).",
    busy: "Troppi invii — riprova più tardi.",
  },
  pt: {
    phoneInvalid: "Introduza um número de telefone válido.",
    country: "Indicativo",
    select: "Escolher…",
    sending: "Enviando…",
    error: "Algo deu errado — tente novamente.",
    submit: "Enviar",
    success: "Obrigado! Recebemos a sua mensagem.",
    fileTooBig:
      "Um arquivo é grande demais (máx. 10 MB por arquivo, 25 MB no total).",
    fileType: "Este tipo de arquivo não é aceito.",
    tooManyFiles: "Arquivos demais (máx. 10).",
    busy: "Envios demais — tente novamente mais tarde.",
  },
  nl: {
    phoneInvalid: "Vul een geldig telefoonnummer in.",
    country: "Landcode",
    select: "Kiezen…",
    sending: "Verzenden…",
    error: "Er ging iets mis — probeer het opnieuw.",
    submit: "Verzenden",
    success: "Bedankt! We hebben je bericht ontvangen.",
    fileTooBig:
      "Een bestand is te groot (max. 10 MB per bestand, 25 MB in totaal).",
    fileType: "Dit bestandstype wordt niet geaccepteerd.",
    tooManyFiles: "Te veel bestanden (max. 10).",
    busy: "Te veel verzendingen — probeer het later opnieuw.",
  },
};

function resolveFormLang(): string {
  let raw = "";
  try {
    raw = (
      ((import.meta as any).env?.PUBLIC_KLEAP_LANG as string) || ""
    ).trim();
  } catch {
    /* import.meta.env indisponible */
  }
  if (!raw && typeof document !== "undefined") {
    raw = (document.documentElement.getAttribute("lang") || "").trim();
  }
  const code = raw.toLowerCase().split("-")[0];
  return Object.prototype.hasOwnProperty.call(FORM_STRINGS, code) ? code : "en";
}

const FORMS_ENDPOINT =
  // PUBLIC_FORMS_API_URL lets self-hosted/staging override; defaults to prod.
  (import.meta as any).env?.PUBLIC_FORMS_API_URL || "https://form.kleap.co";

function resolveAppId(): string {
  // 1) Inlined at build (PUBLIC_* — only inside Vite-processed islands).
  const fromEnv = (import.meta as any).env?.PUBLIC_APP_ID;
  if (fromEnv) return String(fromEnv);
  if (typeof window !== "undefined") {
    // 2) window._kleap.id — injected on EVERY deployed Kleap page by /_kleap.js.
    //    The reliable post-deploy source: works even in plain public assets (no
    //    import.meta.env there) and on {slug}.kleap.io (Origin isn't a custom
    //    domain the form endpoint can resolve).
    const fromKleap = (window as any)._kleap?.id;
    if (fromKleap) return String(fromKleap);
    // 3) ?app_id= on the URL (used by the live preview).
    const fromUrl = new URLSearchParams(window.location.search).get("app_id");
    if (fromUrl) return fromUrl;
  }
  // 4) Empty → the server resolves the app from the Origin hostname (custom domains).
  return "";
}

/* ───────────── Extra field types (KLE-1208 D) ───────────── */

/** [ISO, dial code, flag]. Common markets first; the picker lists them as is. */
export const PHONE_COUNTRIES: ReadonlyArray<readonly [string, string, string]> =
  [
    ["CH", "+41", "🇨🇭"],
    ["FR", "+33", "🇫🇷"],
    ["BE", "+32", "🇧🇪"],
    ["LU", "+352", "🇱🇺"],
    ["MC", "+377", "🇲🇨"],
    ["DE", "+49", "🇩🇪"],
    ["AT", "+43", "🇦🇹"],
    ["IT", "+39", "🇮🇹"],
    ["ES", "+34", "🇪🇸"],
    ["PT", "+351", "🇵🇹"],
    ["NL", "+31", "🇳🇱"],
    ["GB", "+44", "🇬🇧"],
    ["IE", "+353", "🇮🇪"],
    ["US", "+1", "🇺🇸"],
    ["CA", "+1", "🇨🇦"],
    ["BR", "+55", "🇧🇷"],
    ["MX", "+52", "🇲🇽"],
    ["AR", "+54", "🇦🇷"],
    ["CO", "+57", "🇨🇴"],
    ["CL", "+56", "🇨🇱"],
    ["PE", "+51", "🇵🇪"],
    ["MA", "+212", "🇲🇦"],
    ["DZ", "+213", "🇩🇿"],
    ["TN", "+216", "🇹🇳"],
    ["SN", "+221", "🇸🇳"],
    ["CI", "+225", "🇨🇮"],
    ["CM", "+237", "🇨🇲"],
    ["PL", "+48", "🇵🇱"],
    ["SE", "+46", "🇸🇪"],
    ["NO", "+47", "🇳🇴"],
    ["DK", "+45", "🇩🇰"],
    ["FI", "+358", "🇫🇮"],
    ["GR", "+30", "🇬🇷"],
    ["RO", "+40", "🇷🇴"],
    ["TR", "+90", "🇹🇷"],
    ["IL", "+972", "🇮🇱"],
    ["AE", "+971", "🇦🇪"],
    ["SA", "+966", "🇸🇦"],
    ["IN", "+91", "🇮🇳"],
    ["CN", "+86", "🇨🇳"],
    ["JP", "+81", "🇯🇵"],
    ["AU", "+61", "🇦🇺"],
    ["ZA", "+27", "🇿🇦"],
  ];

const LANG_DEFAULT_COUNTRY: Record<string, string> = {
  en: "US",
  fr: "FR",
  es: "ES",
  de: "DE",
  it: "IT",
  pt: "PT",
  nl: "NL",
};

function knownCountry(code: string | undefined | null): string | null {
  const c = String(code || "").toUpperCase();
  return PHONE_COUNTRIES.some(([iso]) => iso === c) ? c : null;
}

/** Full language tag of the site ("fr-CH" | "fr" | ""). */
function resolveSiteLangTag(): string {
  let raw = "";
  try {
    raw = (
      ((import.meta as any).env?.PUBLIC_KLEAP_LANG as string) || ""
    ).trim();
  } catch {
    /* import.meta.env indisponible */
  }
  if (!raw && typeof document !== "undefined") {
    raw = (document.documentElement.getAttribute("lang") || "").trim();
  }
  return raw;
}

/**
 * Country preselected in the phone picker: explicit field setting, else the
 * region of the site language ("fr-CH" → CH), else the visitor's browser region
 * when it speaks the site language (a Swiss visitor on a French site → CH),
 * else the language's main country.
 */
export function defaultPhoneCountry(
  siteLangTag: string,
  explicit?: string,
  browserLangs: readonly string[] = [],
): string {
  const fixed = knownCountry(explicit);
  if (fixed) return fixed;
  const [lang, region] = siteLangTag.toLowerCase().split(/[-_]/);
  const fromSite = knownCountry(region);
  if (fromSite) return fromSite;
  for (const tag of browserLangs) {
    const [bl, br] = String(tag).toLowerCase().split(/[-_]/);
    if (bl === (lang || bl)) {
      const fromBrowser = knownCountry(br);
      if (fromBrowser) return fromBrowser;
    }
  }
  return LANG_DEFAULT_COUNTRY[lang] || "US";
}

/** Light check: 6 to 15 digits, only phone punctuation. Never stricter. */
export function isPlausiblePhone(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true; // emptiness is `required`'s job
  if (!/^[+]?[\d\s().\-/]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15;
}

/**
 * The value stored for a phone field: "+41 79 123 45 67". A number typed in
 * international form (+… or 00…) keeps its own code; a national one gets the
 * picked code and loses its trunk 0 (except Italy, where the 0 is part of it).
 */
export function formatPhoneValue(country: string, raw: string): string {
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("00")) return `+${v.slice(2).trim()}`;
  const entry = PHONE_COUNTRIES.find(([iso]) => iso === country);
  if (!entry) return v;
  const national = country === "IT" ? v : v.replace(/^0\s*/, "");
  return `${entry[1]} ${national}`;
}

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
];

/**
 * Value of a hidden field. `param` (default: the field name) is read from the
 * page URL; "utm" collects every campaign parameter, else names the referring
 * site, else "direct". Falls back to the field's fixed `value`.
 */
export function resolveHiddenValue(
  field: Pick<KleapFormField, "name" | "param" | "value">,
  search: string,
  referrer = "",
  ownHost = "",
): string {
  const params = new URLSearchParams(search);
  const param = (field.param || field.name || "").trim();
  if (param.toLowerCase() === "utm") {
    const parts = UTM_KEYS.flatMap((k) => {
      const v = (params.get(k) || "").trim();
      return v ? [`${k}=${v.slice(0, 200)}`] : [];
    });
    if (parts.length) return parts.join(", ");
    if (field.value) return field.value;
    try {
      const host = referrer ? new URL(referrer).hostname : "";
      if (host && host !== ownHost) return host.replace(/^www\./, "");
    } catch {
      /* referrer illisible */
    }
    return "direct";
  }
  const fromUrl = param ? (params.get(param) || "").trim() : "";
  return fromUrl ? fromUrl.slice(0, 500) : field.value || "";
}

/** "today" → the visitor's local date (YYYY-MM-DD), anything else untouched. */
function resolveBound(
  bound: string | undefined,
  type: string,
): string | undefined {
  if (bound !== "today") return bound;
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (type === "datetime") return `${day}T00:00`;
  return type === "date" ? day : undefined;
}

function optionPair(o: string | { value: string; label: string }) {
  return typeof o === "string"
    ? { value: o, label: o }
    : { value: o.value, label: o.label };
}

function PhoneInput({
  field,
  id,
  className,
  lang,
}: {
  field: KleapFormField;
  id: string;
  className: string;
  lang: string;
}) {
  const t = FORM_STRINGS[lang] || FORM_STRINGS.en;
  const [country, setCountry] = useState(() =>
    defaultPhoneCountry(resolveSiteLangTag(), field.defaultCountry),
  );
  const [number, setNumber] = useState("");
  const [showError, setShowError] = useState(false);
  const touched = useRef(false);
  const errorId = `${id}_error`;
  useEffect(() => {
    // The browser region is only known client-side: refine after hydration.
    if (touched.current || typeof navigator === "undefined") return;
    setCountry(
      defaultPhoneCountry(
        resolveSiteLangTag(),
        field.defaultCountry,
        navigator.languages || [navigator.language],
      ),
    );
  }, [field.defaultCountry]);
  return (
    <>
      <div className="flex gap-2">
        <select
          aria-label={t.country}
          value={country}
          onChange={(e) => {
            touched.current = true;
            setCountry(e.target.value);
          }}
          className={`${className} w-auto shrink-0`}
        >
          {PHONE_COUNTRIES.map(([iso, dial, flag]) => (
            <option key={iso} value={iso}>
              {`${flag} ${dial}`}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={field.required}
          placeholder={field.placeholder}
          value={number}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          onChange={(e) => {
            setNumber(e.target.value);
            const ok = isPlausiblePhone(e.target.value);
            e.target.setCustomValidity(ok ? "" : t.phoneInvalid);
            if (ok) setShowError(false);
          }}
          onBlur={(e) => {
            if (!isPlausiblePhone(e.target.value)) setShowError(true);
          }}
          onInvalid={(e) => {
            // Our own message under the field: the browser bubble covered the
            // next field on mobile. An empty required field keeps the browser's.
            if (e.currentTarget.validity.customError) {
              e.preventDefault();
              setShowError(true);
              e.currentTarget.focus();
            }
          }}
          className={`${className} min-w-0 flex-1`}
        />
        <input
          type="hidden"
          name={field.name}
          value={formatPhoneValue(country, number)}
        />
      </div>
      {showError && (
        <p id={errorId} className="text-sm text-[#b91c1c]">
          {t.phoneInvalid}
        </p>
      )}
    </>
  );
}

export default function KleapForm({
  formId,
  title,
  description,
  fields = [],
  submitText,
  successMessage,
  className = "",
}: KleapFormProps) {
  const [lang] = useState(resolveFormLang);
  const t = FORM_STRINGS[lang] || FORM_STRINGS.en;
  const submitLabel = submitText || t.submit;
  const successLabel = successMessage || t.success;
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">(
    "idle",
  );
  const [errorText, setErrorText] = useState<string | null>(null);

  const startedAt = useRef<number | null>(null);
  const sending = useRef(false);
  const safeFields = Array.isArray(fields) ? fields : [];
  const [hiddenValues, setHiddenValues] = useState<Record<string, string>>({});
  useEffect(() => {
    startedAt.current = Date.now();
    // Hidden fields read the page URL, which only exists in the browser.
    const values: Record<string, string> = {};
    for (const f of safeFields) {
      if (f.type === "hidden")
        values[f.name] = resolveHiddenValue(
          f,
          window.location.search,
          document.referrer,
          window.location.hostname,
        );
    }
    setHiddenValues(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;

    const formEl = e.currentTarget;
    // Honeypot: bots fill hidden fields. Silently "succeed" without submitting.
    const trap = (formEl.elements.namedItem("_kleap_hp") as HTMLInputElement)
      ?.value;
    if (trap) {
      setStatus("ok");
      return;
    }

    // Files: the same limits as the server, checked here so the visitor
    // knows at once instead of after a long upload.
    const picked = Array.from(new FormData(formEl).values()).filter(
      (v): v is File => v instanceof File && (v.size > 0 || !!v.name),
    );
    const total = picked.reduce((n, f) => n + f.size, 0);
    const MB = 1024 * 1024;
    const localError =
      picked.length > 10
        ? t.tooManyFiles
        : picked.some((f) => f.size > 10 * MB) || total > 25 * MB
          ? t.fileTooBig
          : null;
    if (localError) {
      setErrorText(localError);
      setStatus("error");
      return;
    }

    setErrorText(null);
    sending.current = true;
    setStatus("sending");
    try {
      const body = new FormData();
      body.append("app_id", resolveAppId());
      body.append("form_id", formId);
      body.append("form_name", title || formId);
      if (startedAt.current !== null)
        body.append("_kleap_started_at", String(startedAt.current));
      // Newer field types describe themselves so the owner's e-mail shows
      // their label and a readable date / source. Older forms send nothing new.
      const described = safeFields.filter((f) =>
        ["radio", "date", "time", "datetime", "hidden"].includes(f.type),
      );
      if (described.length)
        body.append(
          "_kleap_fields",
          JSON.stringify({
            lang: resolveSiteLangTag() || lang,
            fields: Object.fromEntries(
              described.map((f) => [
                f.name,
                { label: f.label, type: f.type, param: f.param || f.name },
              ]),
            ),
          }),
        );
      const datetimeNames = new Set(
        safeFields.filter((f) => f.type === "datetime").map((f) => f.name),
      );
      for (const [k, v] of new FormData(formEl).entries()) {
        // "2026-11-12T14:30" reads as "2026-11-12 14:30" in the dashboard,
        // the owner's e-mail and the CSV export.
        if (datetimeNames.has(k) && typeof v === "string") {
          body.append(k, v.replace("T", " "));
          continue;
        }
        // A File must be passed through as a File. `String(file)` yields the
        // literal "[object File]", so the attachment was destroyed in the
        // browser and the site owner saw that string where a CV should be —
        // with no error anywhere. FormData carries File natively; the server
        // decides what it can store.
        body.append(k, v);
      }
      const res = await fetch(FORMS_ENDPOINT, { method: "POST", body });
      if (!res.ok) {
        // The server says why (file too large, refused type, too many…):
        // show it, and keep everything the visitor typed.
        const data = await res.json().catch(() => ({}));
        const code = String((data as any)?.error || "");
        setErrorText(
          code === "file_too_large" || code === "files_too_large"
            ? t.fileTooBig
            : code === "file_type_blocked" || code === "file_type_mismatch"
              ? t.fileType
              : code === "too_many_files"
                ? t.tooManyFiles
                : code === "rate_limited" || res.status === 429
                  ? t.busy
                  : null,
        );
        throw new Error(`HTTP ${res.status}`);
      }
      setStatus("ok");
      formEl.reset();
    } catch {
      setStatus("error");
    } finally {
      sending.current = false;
    }
  }

  if (status === "ok") {
    return (
      <div
        className={`rounded-xl border border-green-200 bg-green-50 p-6 text-green-800 ${className}`}
      >
        <p className="font-medium">{successLabel}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`flex max-w-md flex-col gap-4 ${className}`}
    >
      {title && <h3 className="text-xl font-semibold">{title}</h3>}
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}

      {safeFields.map((f) => {
        const id = `kf_${formId}_${f.name}`;
        const base =
          "rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary";
        if (f.type === "hidden") {
          return (
            <input
              key={f.name}
              type="hidden"
              name={f.name}
              value={hiddenValues[f.name] ?? f.value ?? ""}
            />
          );
        }
        if (f.type === "radio") {
          return (
            <fieldset key={f.name} className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
              </legend>
              {(f.options ?? []).map((o, i) => {
                const { value, label } = optionPair(o);
                return (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-0"
                  >
                    <input
                      type="radio"
                      name={f.name}
                      value={value}
                      required={f.required && i === 0}
                      className="h-4 w-4"
                    />
                    {label}
                  </label>
                );
              })}
            </fieldset>
          );
        }
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {f.label}
              {f.required && <span className="text-red-500"> *</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea
                id={id}
                name={f.name}
                required={f.required}
                rows={f.rows ?? 4}
                placeholder={f.placeholder}
                className={base}
              />
            ) : f.type === "select" ? (
              <select
                id={id}
                name={f.name}
                required={f.required}
                className={base}
              >
                <option value="">{f.placeholder || t.select}</option>
                {(f.options ?? []).map((o) => {
                  const value = typeof o === "string" ? o : o.value;
                  const label = typeof o === "string" ? o : o.label;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </select>
            ) : f.type === "phone" ? (
              <PhoneInput field={f} id={id} className={base} lang={lang} />
            ) : f.type === "date" ||
              f.type === "time" ||
              f.type === "datetime" ? (
              <input
                id={id}
                name={f.name}
                type={f.type === "datetime" ? "datetime-local" : f.type}
                required={f.required}
                min={resolveBound(f.min, f.type)}
                max={resolveBound(f.max, f.type)}
                className={base}
              />
            ) : f.type === "file" ? (
              <input
                id={id}
                name={f.name}
                type="file"
                required={f.required}
                accept={f.accept}
                multiple={f.multiple}
                className={`${base} file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm`}
              />
            ) : f.type === "checkbox" ? (
              <input
                id={id}
                name={f.name}
                type="checkbox"
                required={f.required}
                className="h-4 w-4"
              />
            ) : (
              <input
                id={id}
                name={f.name}
                type={f.type || "text"}
                required={f.required}
                placeholder={f.placeholder}
                className={base}
              />
            )}
          </div>
        );
      })}

      {/* Honeypot — hidden from humans, catches bots. */}
      <input
        type="text"
        name="_kleap_hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {status === "sending" ? t.sending : submitLabel}
      </button>

      {status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {errorText || t.error}
        </p>
      )}
    </form>
  );
}
