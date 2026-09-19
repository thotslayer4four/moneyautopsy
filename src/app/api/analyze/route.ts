import { NextRequest, NextResponse } from "next/server";
import { extractStatement } from "@/lib/extraction";
import { categorizeTransactions } from "@/lib/categorization";
import { computeFinancialAnalysis } from "@/lib/analysis";
import { generateInsights } from "@/lib/llm";
import { computeIncomeCheck, generateMoneyPlan } from "@/lib/plan";
import { buildReport, shapeForStatus } from "@/lib/report";
import { createSession } from "@/lib/session";
import { userProfileSchema } from "@/lib/profileSchema";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a file and profile." }, { status: 400 });
  }

  const file = formData.get("file");
  const profileRaw = formData.get("profile");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No statement file was uploaded." }, { status: 400 });
  }
  if (typeof profileRaw !== "string") {
    return NextResponse.json({ error: "Missing user profile." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large. Please upload a statement under 15MB." }, { status: 400 });
  }

  let profileJson: unknown;
  try {
    profileJson = JSON.parse(profileRaw);
  } catch {
    return NextResponse.json({ error: "Profile data was not valid JSON." }, { status: 400 });
  }
  const profileParse = userProfileSchema.safeParse(profileJson);
  if (!profileParse.success) {
    return NextResponse.json({ error: "Profile data failed validation.", details: profileParse.error.flatten() }, { status: 400 });
  }
  const profile = profileParse.data;

  const buffer = Buffer.from(await file.arrayBuffer());

  const extraction = await extractStatement({ buffer, filename: file.name, mimeType: file.type });

  if (extraction.needsReview) {
    return NextResponse.json(
      {
        error: "We couldn't reliably read this statement.",
        issues: extraction.issues,
        needsReview: true,
      },
      { status: 422 }
    );
  }

  const categorized = await categorizeTransactions(extraction.transactions, {
    accountHolderName: extraction.accountHolderName,
    profile,
  });
  const analysis = computeFinancialAnalysis(categorized, profile);
  // Independent of each other, so they run side by side rather than one after the other.
  const [insights, { plan: moneyPlan, narrative }] = await Promise.all([
    generateInsights(profile, analysis),
    generateMoneyPlan(categorized, profile, analysis),
  ]);
  const report = buildReport(analysis, insights, moneyPlan, computeIncomeCheck(categorized, profile, analysis));

  createSession(report, profile, categorized, insights, narrative);

  return NextResponse.json({
    reportId: report.id,
    report: shapeForStatus(report, "free"),
    extractionIssues: extraction.issues,
  });
}
