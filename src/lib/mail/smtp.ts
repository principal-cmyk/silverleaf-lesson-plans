import "server-only";

/**
 * Minimal SMTP sender (implicit TLS, AUTH LOGIN) — enough to send a plain-text
 * email through a Google Workspace mailbox with an app password. No
 * dependencies, so it needs no native packages.
 */
import { randomUUID } from "node:crypto";
import tls from "node:tls";

import { env } from "@/lib/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** True when an SMTP account is configured (host defaults to Gmail). */
export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_USER && env.SMTP_PASSWORD);
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Build the RFC 5322 message (exported for tests). */
export function buildMessage(from: string, msg: MailMessage, now = new Date()): string {
  const domain = from.split("@")[1]?.replace(/[>\s]/g, "") || "localhost";
  const body = b64(msg.text).replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: =?UTF-8?B?${b64(msg.subject)}?=`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Send one email. Throws on any SMTP or network failure. */
export async function sendMail(msg: MailMessage): Promise<void> {
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  if (!user || !pass) throw new Error("SMTP is not configured");
  const from = env.MAIL_FROM ?? user;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;

  const socket = tls.connect({ host: env.SMTP_HOST, port: env.SMTP_PORT, servername: env.SMTP_HOST });
  socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP timeout")));

  let buffer = "";
  let waiter: ((line: string) => void) | null = null;
  let failure: Error | null = null;
  const lines: string[] = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\r\n")) >= 0) {
      lines.push(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
    waiter?.("");
  });
  socket.on("error", (err) => {
    failure = err;
    waiter?.("");
  });
  socket.on("close", () => {
    failure ??= new Error("SMTP connection closed");
    waiter?.("");
  });

  /** Next full reply (handles multi-line "250-" replies). Returns its status code. */
  const reply = async (): Promise<number> => {
    for (;;) {
      const last = lines.find((l) => /^\d{3} /.test(l) || (/^\d{3}$/.test(l)));
      if (last) {
        const code = Number(last.slice(0, 3));
        lines.length = 0;
        return code;
      }
      if (failure) throw failure;
      await new Promise<void>((resolve) => {
        waiter = () => resolve();
      });
    }
  };
  const send = (line: string) => socket.write(`${line}\r\n`);
  const expect = async (want: number, step: string) => {
    const got = await reply();
    if (got !== want) throw new Error(`SMTP ${step} failed (${got})`);
  };

  try {
    await expect(220, "greeting");
    send("EHLO silverleaf.co.tz");
    await expect(250, "EHLO");
    send("AUTH LOGIN");
    await expect(334, "AUTH");
    send(b64(user));
    await expect(334, "AUTH user");
    send(b64(pass));
    await expect(235, "AUTH password");
    send(`MAIL FROM:<${address}>`);
    await expect(250, "MAIL FROM");
    send(`RCPT TO:<${msg.to}>`);
    await expect(250, "RCPT TO");
    send("DATA");
    await expect(354, "DATA");
    send(`${buildMessage(from, msg)}\r\n.`);
    await expect(250, "message");
    send("QUIT");
  } finally {
    socket.destroy();
  }
}
