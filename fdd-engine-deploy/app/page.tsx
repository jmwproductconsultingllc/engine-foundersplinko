"use client";

import { useState } from "react";
import IntakeForm, { IntakeData } from "@/components/IntakeForm";
import FDDUpload from "@/components/FDDUpload";
import DiligenceReport from "@/components/DiligenceReport";
import type { DiligenceResult } from "@/lib/types";

export default function Page() {
  const [intake, setIntake] = useState<IntakeData | null>(null);
  const [result, setResult] = useState<DiligenceResult | null>(null);

  return (
    <main className="min-h-screen bg-[#0B1220] text-[#F1F5F9] px-4 py-10 md:px-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-bold tracking-[0.2em] uppercase text-[#38BDF8] mb-2">
            Franchise Edge
          </p>
          <h1 className="text-3xl md:text-4xl font-extrabold">Franchise Edge Parsing Module</h1>
          <p className="text-[#8194B0] mt-2">
            Turn a 300-page FDD into a clear, scored diligence read — measured against your own capital.
          </p>
        </header>

        {/* Step 1: intake */}
        {!intake && <IntakeForm onContinue={setIntake} />}

        {/* Step 2a: has FDD → upload + analyze */}
        {intake && intake.hasFdd && !result && (
          <div className="space-y-5">
            <ContextBar intake={intake} onReset={() => { setIntake(null); setResult(null); }} />
            <FDDUpload intake={intake} onResult={setResult} />
          </div>
        )}

        {/* Step 2b: no FDD → explore */}
        {intake && intake.hasFdd === false && (
          <div className="space-y-5">
            <ContextBar intake={intake} onReset={() => setIntake(null)} />
            <div className="bg-[#16223B] border border-[#34D399]/30 rounded-xl p-6">
              <h2 className="text-lg font-bold text-[#34D399] mb-1">Let&apos;s find the right fit.</h2>
              <p className="text-sm text-[#CBD5E1]">
                Based on your capital and goals, we&apos;ll curate verified franchise playbooks that match
                your profile. (Hook this up to your playbook discovery flow.)
              </p>
            </div>
          </div>
        )}

        {/* Step 3: results */}
        {result && (
          <div className="space-y-5">
            <ContextBar intake={intake!} onReset={() => { setIntake(null); setResult(null); }} />
            <DiligenceReport result={result} />
          </div>
        )}
      </div>
    </main>
  );
}

function ContextBar({ intake, onReset }: { intake: IntakeData; onReset: () => void }) {
  return (
    <div className="flex items-center justify-between bg-[#16223B] border border-[#27344F] rounded-lg px-4 py-3 text-sm">
      <div className="flex gap-6 text-[#CBD5E1]">
        <span>
          <span className="text-[#8194B0]">Liquid:</span> ${intake.liquidCapital.toLocaleString()}
        </span>
        <span>
          <span className="text-[#8194B0]">Net worth:</span> ${intake.netWorth.toLocaleString()}
        </span>
        <span className="hidden md:inline">
          <span className="text-[#8194B0]">Role:</span> {intake.role}
        </span>
      </div>
      <button onClick={onReset} className="text-[#38BDF8] hover:underline text-xs font-medium">
        Start over
      </button>
    </div>
  );
}
