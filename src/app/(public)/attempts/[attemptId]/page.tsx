import { AttemptRunner } from "./attempt-runner";
import { redirect } from "next/navigation";
import { authorizeVerifiedStudentDestination } from "@/server/auth/verified-student-session/destination-guard";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    attemptId: string;
  }>;
};

export default async function AttemptPage({ params }: PageProps) {
  const { attemptId } = await params;
  let authorization;
  try {
    authorization = await authorizeVerifiedStudentDestination({ destination: "ATT", attemptId });
  } catch {
    redirect("/");
  }
  if (authorization.status === "REJECTED") redirect("/");

  return (
    <main className="page-shell stack">
      <AttemptRunner attemptId={attemptId} />
    </main>
  );
}
