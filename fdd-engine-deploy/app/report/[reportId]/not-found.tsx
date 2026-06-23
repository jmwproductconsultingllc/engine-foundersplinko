// fdd-engine-deploy/app/report/[reportId]/not-found.tsx
//
// Shown when a report is missing or past its 18-month retention window.

export default function ReportNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B1220] px-4 text-[#F1F5F9]">
      <div className="max-w-md text-center">
        <h1 className="mb-3 text-2xl font-bold">Report not found</h1>
        <p className="mb-6 text-[#8194B0]">
          This report may have expired or the link is incorrect. Reports are
          available for 18 months after they&apos;re generated.
        </p>
        <a
          href="/"
          className="inline-block rounded-xl bg-[#34D399] px-5 py-3 font-bold text-[#0B1220] hover:brightness-110"
        >
          Analyze an FDD
        </a>
      </div>
    </main>
  );
}
