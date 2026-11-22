"use client";

/**
 * StaffRegistration — full-screen overlay for staff sign-in.
 *
 * Staff sign in with their work email + ed-admin Staff ID; both are verified
 * against the ed-admin directory server-side (see `signInMemberAction`). The
 * `onSubmit` callback returns a typed result whose `error` the overlay maps to
 * a friendly message (`not-registered`, `inactive`, `invalid-input`).
 *
 * Chrome is localised via next-intl (`member.register.*`); the caller passes the
 * server action through `onSubmit`.
 */

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { brand } from "@/lib/brand";
import styles from "./StaffRegistration.module.css";

export interface StaffRegistrationResult {
  ok: boolean;
  error?: "not-registered" | "inactive" | "invalid-input" | "invalid-code" | "failed";
}

export interface StaffRegistrationProps {
  /**
   * Establish a session for the given work email + ed-admin Staff ID. Returns
   * a typed result: `{ ok: true }` on success, or an `error` the overlay maps
   * to a friendly message.
   */
  onSubmit: (input: {
    email: string;
    staffId: string;
    code?: string;
  }) => Promise<StaffRegistrationResult>;
  /**
   * Email a one-time code to the address. Only used when `codeRequired`.
   */
  onRequestCode?: (email: string) => Promise<{ ok: boolean; error?: string }>;
  /** Ask for the emailed one-time code before signing in. */
  codeRequired?: boolean;
  /** Whether the server/db is reachable (offline notice when false). */
  dbOnline?: boolean;
  /** Show and require the ed-admin Staff ID field. Defaults to true. */
  requireStaffId?: boolean;
}

export default function StaffRegistration({
  onSubmit,
  onRequestCode,
  codeRequired = false,
  dbOnline = true,
  requireStaffId = true,
}: StaffRegistrationProps) {
  const t = useTranslations("member");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [staffId, setStaffId] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /** Email a code and move to the code step. Caller manages `submitting`. */
  const sendCode = async () => {
    const res = (await onRequestCode?.(email)) ?? { ok: false };
    if (res.ok) {
      setCode("");
      setCodeSent(true);
      return;
    }
    setError(
      res.error === "invalid-input"
        ? t(requireStaffId ? "register.invalidInput" : "register.notSchoolEmail")
        : res.error === "too-soon"
          ? t("register.tooSoon")
          : res.error === "too-many"
            ? t("register.tooMany")
            : t("register.sendFailed"),
    );
  };

  const resend = async () => {
    setError("");
    setSubmitting(true);
    try {
      await sendCode();
    } catch {
      setError(t("register.sendFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (codeRequired && !codeSent) {
        await sendCode();
        return;
      }
      const result = await onSubmit({ email, staffId, code });
      if (result.ok) {
        // Session cookie is set server-side; refresh to re-render the gate.
        router.refresh();
        return;
      }

      switch (result.error) {
        case "not-registered":
          setError(
            t(requireStaffId ? "register.notRegistered" : "register.notSchoolEmail"),
          );
          break;
        case "inactive":
          setError(t("register.inactive"));
          break;
        case "invalid-code":
          setError(t("register.invalidCode"));
          break;
        case "invalid-input":
          setError(
            t(requireStaffId ? "register.invalidInput" : "register.invalidEmail"),
          );
          break;
        default:
          setError(t("register.failed"));
      }
    } catch {
      setError(t("register.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.staffRegistrationOverlay}>
      <div className={styles.staffRegistrationCard}>
        <Image
          src={brand.logos.logomarkElectricBlue}
          alt={brand.shortName}
          width={48}
          height={48}
          className={styles.regLogo}
        />
        <h1>{t("register.welcome")}</h1>
        <p className={styles.regSub}>
          {t(requireStaffId ? "register.subtitle" : "register.subtitleEmailOnly")}
        </p>

        {!dbOnline && (
          <p className={styles.regOffline}>{t("register.offline")}</p>
        )}

        <form onSubmit={handleSubmit} className={styles.regForm}>
          {codeSent && (
            <>
              <p className={styles.regSub}>{t("register.codeSent", { email })}</p>
              <label>
                {t("register.codeLabel")}
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("register.codePlaceholder")}
                  required
                  autoFocus
                />
              </label>
            </>
          )}
          {!codeSent && (<>
          <label>
            {t("register.emailLabel")}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder={t("register.emailPlaceholder")}
              autoFocus
            />
          </label>

          {requireStaffId && (
            <label>
              {t("register.idLabel")}{" "}
              <span className={styles.optional}>{t("register.idHint")}</span>
              <input
                type="text"
                inputMode="numeric"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                placeholder={t("register.idPlaceholder")}
                required
              />
            </label>
          )}

          </>)}

          {error && <p className={styles.regError}>{error}</p>}

          <button
            type="submit"
            className={styles.regSubmit}
            disabled={submitting}
          >
            {submitting
              ? t("register.submitting")
              : codeRequired && !codeSent
                ? t("register.sendCode")
                : t("register.continue")}
          </button>
          {codeSent && (
            <>
              <button type="button" className={styles.regSubmit} onClick={resend} disabled={submitting}>
                {t("register.resend")}
              </button>
              <button
                type="button"
                className={styles.regSubmit}
                onClick={() => {
                  setCodeSent(false);
                  setError("");
                }}
                disabled={submitting}
              >
                {t("register.changeEmail")}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
