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
  error?: "not-registered" | "inactive" | "invalid-input" | "failed";
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
  }) => Promise<StaffRegistrationResult>;
  /** Whether the server/db is reachable (offline notice when false). */
  dbOnline?: boolean;
}

export default function StaffRegistration({
  onSubmit,
  dbOnline = true,
}: StaffRegistrationProps) {
  const t = useTranslations("member");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await onSubmit({ email, staffId });
      if (result.ok) {
        // Session cookie is set server-side; refresh to re-render the gate.
        router.refresh();
        return;
      }

      switch (result.error) {
        case "not-registered":
          setError(t("register.notRegistered"));
          break;
        case "inactive":
          setError(t("register.inactive"));
          break;
        case "invalid-input":
          setError(t("register.invalidInput"));
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
        <p className={styles.regSub}>{t("register.subtitle")}</p>

        {!dbOnline && (
          <p className={styles.regOffline}>{t("register.offline")}</p>
        )}

        <form onSubmit={handleSubmit} className={styles.regForm}>
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

          {error && <p className={styles.regError}>{error}</p>}

          <button
            type="submit"
            className={styles.regSubmit}
            disabled={submitting}
          >
            {submitting ? t("register.submitting") : t("register.continue")}
          </button>
        </form>
      </div>
    </div>
  );
}
