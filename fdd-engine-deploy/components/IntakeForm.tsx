"use client";

import { useState } from "react";

export interface IntakeData {
  liquidCapital: number;
  netWorth: number;
  role: string;
  timeline: string;
  businessType: string;
  partners: string;
  hasFdd: boolean | null;
}

const ROLES = ["Owner-Operator", "Semi-Absentee", "Passive Investor"];
const TIMELINES = ["< 3 months", "3-6 months", "6-12 months"];
const TYPES = ["Brick & Mortar", "Mobile / Remote"];

const card = "bg-[#16223B] border border-[#27344F] rounded-xl";
const label = "block text-xs font-semibold tracking-wide uppercase text-[#8194B0] mb-1.5";
const input =
  "w-full p-2.5 bg-[#0B1220] border border-[#27344F] rounded-lg text-[#F1F5F9] " +
  "focus:outline-none focus:border-[#34D399] transition-colors";

function Choice({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
            value === o
              ? "border-[#34D399] bg-[#34D399]/10 text-[#34D399]"
              : "border-[#27344F] text-[#CBD5E1] hover:border-[#38BDF8]"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function IntakeForm({ onContinue }: { onContinue: (d: IntakeData) => void }) {
  const [data, setData] = useState<IntakeData>({
    liquidCapital: 100000,
    netWorth: 300000,
    role: "Owner-Operator",
    timeline: "3-6 months",
    businessType: "Brick & Mortar",
    partners: "No",
    hasFdd: null,
  });

  const set = <K extends keyof IntakeData>(k: K, v: IntakeData[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  return (
    <div className={`${card} p-6 md:p-8`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={label}>Liquid Capital ($)</label>
          <input
            type="number"
            className={input}
            value={data.liquidCapital}
            onChange={(e) => set("liquidCapital", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={label}>Net Worth ($)</label>
          <input
            type="number"
            className={input}
            value={data.netWorth}
            onChange={(e) => set("netWorth", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={label}>Intended Role</label>
          <Choice options={ROLES} value={data.role} onChange={(v) => set("role", v)} />
        </div>
        <div>
          <label className={label}>Timeline</label>
          <Choice options={TIMELINES} value={data.timeline} onChange={(v) => set("timeline", v)} />
        </div>
        <div>
          <label className={label}>Business Type</label>
          <Choice options={TYPES} value={data.businessType} onChange={(v) => set("businessType", v)} />
        </div>
        <div>
          <label className={label}>Partners?</label>
          <Choice options={["No", "Yes"]} value={data.partners} onChange={(v) => set("partners", v)} />
        </div>
      </div>

      <div className="mt-8 border-t border-[#27344F] pt-6">
        <label className={label}>Do you have a specific FDD to evaluate?</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              set("hasFdd", true);
              onContinue({ ...data, hasFdd: true });
            }}
            className="px-5 py-2.5 rounded-lg font-semibold bg-[#34D399] text-[#0B1220] hover:brightness-110 transition"
          >
            Yes — run deep diligence
          </button>
          <button
            type="button"
            onClick={() => {
              set("hasFdd", false);
              onContinue({ ...data, hasFdd: false });
            }}
            className="px-5 py-2.5 rounded-lg font-semibold border border-[#27344F] text-[#CBD5E1] hover:border-[#38BDF8] transition"
          >
            No — I'm still exploring
          </button>
        </div>
      </div>
    </div>
  );
}
