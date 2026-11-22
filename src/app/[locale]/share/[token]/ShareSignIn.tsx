"use client";

/**
 * ShareSignIn — asks for a Silverleaf Academy email address before a shared
 * link opens. When email is configured (`codeRequired`) it then asks for the
 * one-time code emailed to that address, so people can only open the link with
 * their own mailbox. The cookie it sets opens the share pages only.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

import { requestLoginCodeAction } from "@/lib/actions/loginCode";
import { shareAccessAction } from "@/lib/actions/shareAccess";
import { useRouter } from "@/i18n/navigation";

import styles from "../share.module.css";

export default function ShareSignIn({ codeRequired = false }: { codeRequired?: boolean }) {
  const t = useTranslations("share.access");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const res = await requestLoginCodeAction(email);
    if (res.ok) {
      setCode("");
      setCodeSent(true);
      return;
    }
    setError(
      res.error === "invalid-input"
        ? "not-school-email"
        : res.error === "too-soon" || res.error === "too-many"
          ? res.error
          : "send-failed",
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (codeRequired && !codeSent) {
        await sendCode();
        return;
      }
      const res = await shareAccessAction(email, code);
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(
        res.error === "not-school-email" || res.error === "invalid-input" || res.error === "invalid-code"
          ? res.error
          : "failed",
      );
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await sendCode();
    } catch {
      setError("send-failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.gone}>
      <h1>{t("heading")}</h1>
      <p>{codeSent ? t("codeSent", { email }) : t("body")}</p>
      <form className={styles.search} onSubmit={submit}>
        {codeSent ? (
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("codePlaceholder")}
            aria-label={t("codePlaceholder")}
          />
        ) : (
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
          />
        )}
        <button type="submit" disabled={busy}>
          {codeRequired && !codeSent ? t("sendCode") : t("submit")}
        </button>
      </form>
      {codeSent ? (
        <p>
          <button type="button" onClick={resend} disabled={busy}>
            {t("resend")}
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              setCodeSent(false);
              setError(null);
            }}
            disabled={busy}
          >
            {t("changeEmail")}
          </button>
        </p>
      ) : null}
      {error ? <p role="alert">{t(`error.${error}`)}</p> : null}
    </main>
  );
}
