import { setRequestLocale } from "next-intl/server";

import { getCurrentUser } from "@/lib/auth";
import { signInMemberAction } from "@/lib/actions/member";
import { requestLoginCodeAction } from "@/lib/actions/loginCode";
import { isLoginCodeRequired } from "@/lib/auth/loginCodePolicy";
import { redirect } from "@/i18n/navigation";
import { findLatestActiveShareLink } from "@/lib/share/links";
import { isFeedbackHour } from "@/lib/time/eat";
import { isStaffIdRequired } from "@/lib/auth/staffIdPolicy";
import StaffRegistration from "@/components/StaffRegistration";
import FeedbackHourHome from "@/components/lesson/FeedbackHourHome";
import NormalHome from "@/components/lesson/NormalHome";

/**
 * Teacher home.
 *
 * - Unauthenticated → the StaffRegistration sign-in overlay.
 * - Authenticated teacher (any time, including Feedback Hour) → the folder library (grade → subject →
 *   term → lessons), i.e. the working share link's page. Admins, and any
 *   deployment with no working share link, get <FeedbackHourHome /> during the
 *   daily Feedback Hour (15:00–17:00 EAT), else <NormalHome />.
 *
 * Dynamic: reads the session cookie and the server clock, so it must render
 * per-request (never prerendered or cached).
 */
export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) {
    return <StaffRegistration
        onSubmit={signInMemberAction}
        onRequestCode={requestLoginCodeAction}
        codeRequired={isLoginCodeRequired()}
        requireStaffId={isStaffIdRequired()}
      />;
  }

  if (!user.isAdmin) {
    const link = await findLatestActiveShareLink();
    if (link) redirect({ href: `/share/${link.token}`, locale });
  }

  return isFeedbackHour() ? <FeedbackHourHome /> : <NormalHome />;
}
