"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { createShareLinkAction, revokeShareLinkAction } from "@/lib/actions/shareLinks";

export interface ShareLinkRow {
  id: string;
  label: string;
  url: string;
  createdAt: string;
  active: boolean;
}

export default function ShareLinksAdmin({ links }: { links: ShareLinkRow[] }) {
  const t = useTranslations("share.admin");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const show = (code?: string) =>
    setError(code ? (["invalid-input", "failed", "not-found"].includes(code) ? code : "failed") : null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createShareLinkAction(label);
      show(res.ok ? undefined : res.error);
      if (res.ok) setLabel("");
    });
  }

  function revoke(id: string) {
    if (!window.confirm(t("confirmRevoke"))) return;
    start(async () => {
      const res = await revokeShareLinkAction(id);
      show(res.ok ? undefined : res.error);
    });
  }

  async function copy(row: ShareLinkRow) {
    await navigator.clipboard.writeText(row.url);
    setCopied(row.id);
  }

  return (
    <div>
      <form onSubmit={create} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <label style={{ display: "grid", gap: "0.25rem", flex: "1 1 18rem" }}>
          <span>{t("labelField")}</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("labelPlaceholder")}
            maxLength={120}
            style={{ padding: "0.5rem", font: "inherit" }}
          />
        </label>
        <button type="submit" disabled={pending} style={{ alignSelf: "end", padding: "0.5rem 1rem" }}>
          {t("create")}
        </button>
      </form>
      {error ? <p role="alert" style={{ color: "#b3261e" }}>{t(`error.${error}`)}</p> : null}

      {links.length === 0 ? <p>{t("none")}</p> : null}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
        {links.map((row) => (
          <li key={row.id} style={{ border: "1px solid #e0e3e8", borderRadius: 8, padding: "0.75rem 1rem" }}>
            <strong>{row.label}</strong>{" "}
            <span style={{ color: row.active ? "#1b6e3c" : "#b3261e" }}>
              · {row.active ? t("active") : t("off")}
            </span>
            <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
              {t("created", { date: row.createdAt })}
            </div>
            {row.active ? (
              <>
                <input
                  readOnly
                  value={row.url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={row.label}
                  style={{ width: "100%", margin: "0.5rem 0", padding: "0.4rem", font: "inherit", fontSize: "0.85rem" }}
                />
                <button type="button" onClick={() => copy(row)}>
                  {copied === row.id ? t("copied") : t("copy")}
                </button>{" "}
                <button type="button" onClick={() => revoke(row.id)} disabled={pending}>
                  {t("revoke")}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
