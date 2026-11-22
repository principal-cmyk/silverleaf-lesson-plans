"use client";

/**
 * ShareSignIn — asks for a Silverleaf Academy email address before a shared
 * link opens. Anyone with a school address gets in; the cookie it sets opens
 * the share pages only.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

import { shareAccessAction } from "@/lib/actions/shareAccess";
import { useRouter } from "@/i18n/navigation";

import styles from "../share.module.css";

export default function ShareSignIn() {
  const t = useTranslations("share.access");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await shareAccessAction(email);
    if (res.ok) {
      router.refresh();
      return;
    }
    setError(res.error === "not-school-email" ? "not-school-email" : res.error === "invalid-input" ? "invalid-input" : "failed");
    setBusy(false);
  }

  return (
    <main className={styles.gone}>
      <h1>{t("heading")}</h1>
      <p>{t("body")}</p>
      <form className={styles.search} onSubmit={submit}>
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
        <button type="submit" disabled={busy}>
          {t("submit")}
        </button>
      </form>
      {error ? <p role="alert">{t(`error.${error}`)}</p> : null}
    </main>
  );
}
