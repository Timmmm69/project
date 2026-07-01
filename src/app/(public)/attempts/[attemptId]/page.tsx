import { AttemptRunner } from "./attempt-runner";

type PageProps = {
  params: Promise<{
    attemptId: string;
  }>;
};

export default async function AttemptPage({ params }: PageProps) {
  const { attemptId } = await params;

  return (
    <main className="page-shell stack">
      <AttemptRunner attemptId={attemptId} />
    </main>
  );
}
