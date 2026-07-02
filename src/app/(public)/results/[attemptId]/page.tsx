import { ResultView } from "./result-view";

type PageProps = {
  params: Promise<{
    attemptId: string;
  }>;
};

export default async function ResultPage({ params }: PageProps) {
  const { attemptId } = await params;

  return (
    <main className="page-shell stack">
      <ResultView attemptId={attemptId} />
    </main>
  );
}
